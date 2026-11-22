/**
 * Test isolation guard (PR 2). Loaded in-process by scripts/run-tests.mjs and
 * preloaded (`node --require scripts/test-guard.cjs`) into every harness it
 * spawns, so the same rules hold in child processes:
 *
 *   1. Credential-shaped environment variables are DELETED before any test code
 *      loads. A test cannot use, log or leak what is not there.
 *   2. Network egress is refused: real DNS lookups, `fetch`, and every TCP
 *      connection whose resolved address is not loopback (127.0.0.0/8, ::1).
 *      Suites that need a server start one on loopback; suites that exercise
 *      hostnames (the SSRF fetcher) supply their own resolver mapping them to
 *      loopback, and the check is on the address actually connected to.
 *
 * Refusals raise errors with code ETESTNETWORK and are counted, so a run can
 * report them. `probe()` proves the guard is active; the runner fails without it.
 */
"use strict";
const dns = require("node:dns");
const net = require("node:net");

const SECRET_ENV = /(SUPABASE|POSTGRES|DATABASE_URL|STRIPE|ANTHROPIC|OPENAI|EMBEDDING|VERCEL_(TOKEN|OIDC)|SERVICE_ROLE|JWT_SECRET|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN)/i;

const state = globalThis.__lifeosTestGuard ?? { scrubbed: [], blocked: [], installed: false };
globalThis.__lifeosTestGuard = state;

if (!state.installed) {
  state.installed = true;

  for (const k of Object.keys(process.env)) {
    if (SECRET_ENV.test(k)) {
      state.scrubbed.push(k);
      delete process.env[k];
    }
  }
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  const isLoopback = (host) => {
    if (host === undefined || host === null || host === "" || host === "localhost") return true;
    const h = String(host).replace(/^\[|\]$/g, "");
    if (h === "::1" || h === "::ffff:127.0.0.1") return true;
    return net.isIPv4(h) && h.startsWith("127.");
  };
  state.isLoopback = isLoopback;
  const netError = (what) => Object.assign(new Error(`test-guard: outbound network to ${what} is blocked in tests`), { code: "ETESTNETWORK" });

  // ---- DNS: only localhost / loopback literals resolve.
  const realLookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, opts, cb) {
    if (typeof opts === "function") [cb, opts] = [opts, {}];
    if (isLoopback(hostname)) return realLookup.call(dns, hostname, opts, cb);
    state.blocked.push(`dns:${hostname}`);
    process.nextTick(() => cb(netError(`DNS for ${hostname}`)));
    return {};
  };
  dns.promises.lookup = (hostname, opts = {}) => {
    if (!isLoopback(hostname)) {
      state.blocked.push(`dns:${hostname}`);
      return Promise.reject(netError(`DNS for ${hostname}`));
    }
    return new Promise((res, rej) =>
      realLookup.call(dns, hostname, opts, (e, a, f) => (e ? rej(e) : res(typeof opts === "object" && opts.all ? a : { address: a, family: f }))),
    );
  };
  for (const fn of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveTxt", "resolveSrv", "resolveNs", "reverse"]) {
    dns.promises[fn] = async (h) => {
      state.blocked.push(`dns:${h}`);
      throw netError(`DNS for ${h}`);
    };
    dns[fn] = (h, ...rest) => {
      state.blocked.push(`dns:${h}`);
      const cb = rest.at(-1);
      if (typeof cb === "function") process.nextTick(() => cb(netError(`DNS for ${h}`)));
    };
  }

  // ---- TCP: every connection must land on loopback.
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...a) {
    const o = Array.isArray(a[0]) ? a[0][0] : a[0];
    if (o && typeof o === "object") {
      if (o.path) return realConnect.apply(this, a); // unix socket
      const host = o.host ?? "localhost";
      if (net.isIP(String(host).replace(/^\[|\]$/g, ""))) {
        if (!isLoopback(host)) {
          state.blocked.push(String(host));
          process.nextTick(() => this.destroy(netError(host)));
          return this;
        }
      } else if (host !== "localhost") {
        const inner = o.lookup ?? dns.lookup;
        o.lookup = (hostname, lopts, cb) =>
          inner(hostname, lopts, (err, addr, fam) => {
            if (err) return cb(err, addr, fam);
            const list = Array.isArray(addr) ? addr.map((x) => x.address) : [addr];
            const bad = list.filter((x) => !isLoopback(x));
            if (bad.length) {
              state.blocked.push(`${hostname}→${bad.join(",")}`);
              return cb(netError(`${hostname} (${bad.join(",")})`));
            }
            cb(null, addr, fam);
          });
      }
      return realConnect.apply(this, a);
    }
    const host = typeof a[1] === "string" ? a[1] : "localhost"; // connect(port, host?)
    if (!isLoopback(host)) {
      state.blocked.push(host);
      process.nextTick(() => this.destroy(netError(host)));
      return this;
    }
    return realConnect.apply(this, a);
  };

  // ---- fetch (undici does not go through net.Socket.connect's hostname path).
  const realFetch = globalThis.fetch;
  if (typeof realFetch === "function") {
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input?.url ?? String(input));
      if (!isLoopback(url.hostname)) {
        state.blocked.push(url.hostname);
        throw netError(url.hostname);
      }
      return realFetch(input, init);
    };
  }
}

/** Resolve true only if all three egress paths are refused. */
async function probe() {
  const before = state.blocked.length;
  const tcp = await new Promise((res) => {
    const s = net.connect({ host: "192.0.2.1", port: 443 }); // TEST-NET-1
    s.on("error", (e) => res(e.code === "ETESTNETWORK"));
    s.on("connect", () => { s.destroy(); res(false); });
  });
  const f = await globalThis.fetch("https://example.com/").then(() => false, (e) => e.code === "ETESTNETWORK");
  const d = await new Promise((res) => dns.lookup("example.com", (e) => res(e?.code === "ETESTNETWORK")));
  state.blocked.splice(before); // probes are not test traffic
  return { tcp, fetch: f, dns: d };
}

module.exports = { state, probe };
