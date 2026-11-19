/**
 * Self-tests for `lib/security/safe-fetch.ts` (PR 1).
 *
 * Pure checks cover the address policy and URL validation. Network checks run
 * real HTTP servers on loopback and inject a resolver and an address policy:
 * the policy treats 127.0.0.1 as "public" and everything else — including a
 * canary server on 127.0.0.2 standing in for an internal service — as
 * private. Every network check also asserts the canary received nothing, so a
 * passing check means no request reached the "internal" side at all.
 *
 * Run by `npm run audit:extract`. Node only (opens sockets).
 */

import * as http from "node:http";
import * as zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import {
  isPublicAddress,
  safeFetchText,
  SafeFetchError,
  validateOutboundUrl,
  type ResolvedAddress,
  type SafeFetchOptions,
} from "@/lib/security/safe-fetch";

interface Result { name: string; pass: boolean; detail?: string }
export interface SafeFetchSelfTestReport { total: number; passed: number; pass: boolean; results: Result[] }

const PUBLIC_STANDIN = "127.0.0.1";
const INTERNAL_STANDIN = "127.0.0.2";

export async function runSafeFetchSelfTests(): Promise<SafeFetchSelfTestReport> {
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
  const codeOf = async (p: Promise<unknown>): Promise<string> => {
    try { await p; return "ok"; } catch (e) { return e instanceof SafeFetchError ? e.code : `other:${String((e as Error)?.message ?? e)}`; }
  };
  const syncCode = (f: () => unknown): string => {
    try { f(); return "ok"; } catch (e) { return e instanceof SafeFetchError ? e.code : "other"; }
  };

  // ------------------------------------------------------ 1. address policy
  const publicAddrs = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
  for (const a of publicAddrs) ok(`1 public: ${a}`, isPublicAddress(a), "should be public");
  const privateAddrs = [
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "192.0.2.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1",
    "2001:db8::1", "2002:7f00:1::1", "2001:0:4136:e378::1", "ff02::1", "[::1]", "not-an-ip", "",
  ];
  for (const a of privateAddrs) ok(`1 refused: ${a || "(empty)"}`, !isPublicAddress(a), "should be refused");

  // ------------------------------------------------------ 2. URL validation
  const blocked: Array<[string, string]> = [
    ["http://127.0.0.1/", "blocked_address"],
    ["http://2130706433/", "blocked_address"], // decimal 127.0.0.1
    ["http://0x7f.1/", "blocked_address"], // hex/short form
    ["http://127.1/", "blocked_address"],
    ["http://017700000001/", "blocked_address"], // octal
    ["http://[::1]/", "blocked_address"],
    ["http://[::ffff:127.0.0.1]/", "blocked_address"],
    ["http://[::ffff:7f00:1]/", "blocked_address"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["http://localhost/", "blocked_address"],
    ["http://foo.localhost/", "blocked_address"],
    ["http://printer.local/", "blocked_address"],
    ["ftp://example.com/", "blocked_scheme"],
    ["file:///etc/passwd", "blocked_scheme"],
    ["gopher://example.com/", "blocked_scheme"],
    ["javascript:alert(1)", "blocked_scheme"],
    ["http://user:pw@example.com/", "blocked_credentials"],
    ["http://example.com:8080/", "blocked_port"],
    ["https://example.com:22/", "blocked_port"],
    ["not a url", "invalid_url"],
    [`https://example.com/${"a".repeat(2100)}`, "invalid_url"],
  ];
  for (const [u, code] of blocked) {
    ok(`2 ${code}: ${u.slice(0, 60)}`, syncCode(() => validateOutboundUrl(u)) === code, `got ${syncCode(() => validateOutboundUrl(u))}`);
  }
  ok("2 plain https URL accepted", syncCode(() => validateOutboundUrl("https://example.com/a?b=c")) === "ok");
  ok("2 explicit default port accepted", syncCode(() => validateOutboundUrl("http://example.com:80/")) === "ok");

  // ------------------------------------------------------ 3. network checks
  let canaryHits = 0;
  const canary = http.createServer((_req, res) => { canaryHits++; res.end("internal secret"); });
  const servers: http.Server[] = [canary];

  const html = (s: string) => `<html><head><title>T</title></head><body>${s}</body></html>`;
  let publicPort = 0;
  const pub = http.createServer((req, res) => {
    const u = req.url ?? "/";
    if (u === "/ok") { res.writeHead(200, { "content-type": "text/html" }); return res.end(html("hello")); }
    if (u === "/to-internal-literal") { res.writeHead(302, { location: `http://${INTERNAL_STANDIN}:${canaryPort()}/` }); return res.end(); }
    if (u === "/to-internal-name") { res.writeHead(302, { location: `http://internal.test:${canaryPort()}/` }); return res.end(); }
    if (u === "/to-file") { res.writeHead(302, { location: "file:///etc/passwd" }); return res.end(); }
    if (u === "/to-metadata") { res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (u === "/relative") { res.writeHead(307, { location: "/ok" }); return res.end(); }
    if (u.startsWith("/loop")) { const n = Number(u.slice(5) || 0); res.writeHead(302, { location: `/loop${n + 1}` }); return res.end(); }
    if (u === "/no-location") { res.writeHead(302); return res.end(); }
    if (u === "/hang-headers") { return; /* never respond */ }
    if (u === "/hang-body") { res.writeHead(200, { "content-type": "text/html" }); res.write("<html>"); return; }
    if (u === "/drip") {
      res.writeHead(200, { "content-type": "text/html" });
      const t = setInterval(() => res.write("x"), 50);
      res.on("close", () => clearInterval(t));
      return;
    }
    if (u === "/big-declared") { res.writeHead(200, { "content-type": "text/html", "content-length": "5000000" }); return res.end(); }
    if (u === "/big-chunked") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(64 * 1024, 120);
      let sent = 0;
      const pump = () => { while (sent < 2_000_000) { sent += chunk.length; if (!res.write(chunk)) return res.once("drain", pump); } res.end(); };
      return pump();
    }
    if (u === "/gzip-bomb") {
      const bomb = zlib.gzipSync(Buffer.alloc(5_000_000, 0));
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip", "content-length": String(bomb.length) });
      return res.end(bomb);
    }
    if (u === "/gzip-ok") {
      const body = zlib.gzipSync(Buffer.from(html("compressed fine")));
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return res.end(body);
    }
    res.writeHead(404); res.end();
  });
  servers.push(pub);
  const canaryPort = () => (canary.address() as AddressInfo).port;

  try {
    await new Promise<void>((r) => canary.listen(0, INTERNAL_STANDIN, () => r()));
    await new Promise<void>((r) => pub.listen(0, PUBLIC_STANDIN, () => { publicPort = (pub.address() as AddressInfo).port; r(); }));
  } catch (e) {
    ok("3 test servers could start", false, String(e));
    return finish(results, servers);
  }

  const lookups: string[] = [];
  const connects: string[] = [];
  const table: Record<string, ResolvedAddress[]> = {
    "public.test": [{ address: PUBLIC_STANDIN, family: 4 }],
    "internal.test": [{ address: INTERNAL_STANDIN, family: 4 }],
    "mixed.test": [{ address: PUBLIC_STANDIN, family: 4 }, { address: INTERNAL_STANDIN, family: 4 }],
    "v6internal.test": [{ address: "::1", family: 6 }],
  };
  let rebindCalls = 0;
  const resolve = async (host: string): Promise<ResolvedAddress[]> => {
    lookups.push(host);
    if (host === "rebind.test") {
      // Classic rebinding: the first answer is public, every later one internal.
      rebindCalls++;
      return [{ address: rebindCalls === 1 ? PUBLIC_STANDIN : INTERNAL_STANDIN, family: 4 }];
    }
    if (host === "nxdomain.test") throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return table[host] ?? [];
  };
  const base: SafeFetchOptions = {
    resolve,
    isAllowedAddress: (a) => a === PUBLIC_STANDIN || a === `::ffff:${PUBLIC_STANDIN}`,
    allowedPorts: [publicPort, canaryPort()],
    onConnect: ({ address }) => connects.push(address),
    timeoutMs: 2_000,
    maxBytes: 1_000_000,
  };
  const P = (path: string, host = "public.test") => `http://${host}:${publicPort}${path}`;

  // Baseline
  {
    const r = await safeFetchText(P("/ok"), base).catch((e) => e);
    ok("3 baseline: allowed host is fetched", !(r instanceof Error) && r.status === 200 && /hello/.test(r.body), String(r));
    ok("3 baseline: connected to the resolved public address", connects.at(-1) === PUBLIC_STANDIN, `connected ${connects.at(-1)}`);
  }
  {
    const r = await safeFetchText(P("/gzip-ok"), base).catch((e) => e);
    ok("3 compressed body within limit is decoded", !(r instanceof Error) && /compressed fine/.test(r.body), String(r));
  }

  // Internal addresses via DNS
  { const c = await codeOf(safeFetchText(P("/", "internal.test"), base)); ok("3 DNS answer internal → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/", "mixed.test"), base)); ok("3 DNS answer mixed public+internal → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/", "v6internal.test"), base)); ok("3 DNS answer IPv6 loopback → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(`http://${INTERNAL_STANDIN}:${canaryPort()}/`, base)); ok("3 internal IP literal → refused before connecting", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/", "nxdomain.test"), base)); ok("3 NXDOMAIN → dns_failure", c === "dns_failure", c); }

  // DNS rebinding / time-of-check-time-of-use
  {
    lookups.length = 0; connects.length = 0;
    const first = await safeFetchText(P("/ok", "rebind.test"), base).catch((e) => e);
    ok("4 rebinding: first answer (public) is fetched", !(first instanceof Error), String(first));
    ok("4 rebinding: exactly one resolution per request — no separate pre-check lookup", lookups.length === 1, `lookups=${lookups.length}`);
    ok("4 rebinding: the connected address is the one that was checked", connects.length === 1 && connects[0] === PUBLIC_STANDIN, connects.join(","));
    const second = await codeOf(safeFetchText(P("/ok", "rebind.test"), base));
    ok("4 rebinding: re-resolved internal answer is refused at connection time", second === "blocked_address", second);
    ok("4 rebinding: no second connection was made", connects.length === 1, connects.join(","));
    // validateOutboundUrl performs no DNS at all, so it cannot create a check/use gap.
    lookups.length = 0;
    validateOutboundUrl(P("/ok", "rebind.test"), base);
    ok("4 rebinding: URL validation performs no DNS lookup", lookups.length === 0, `lookups=${lookups.length}`);
  }

  // Redirects
  { const c = await codeOf(safeFetchText(P("/to-internal-literal"), base)); ok("5 redirect to internal IP literal → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/to-internal-name"), base)); ok("5 redirect to internal hostname → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/to-metadata"), base)); ok("5 redirect to cloud metadata address → refused", c === "blocked_address", c); }
  { const c = await codeOf(safeFetchText(P("/to-file"), base)); ok("5 redirect to file: scheme → refused", c === "blocked_scheme", c); }
  { const c = await codeOf(safeFetchText(P("/no-location"), base)); ok("5 redirect without Location → bad_redirect", c === "bad_redirect", c); }
  { const c = await codeOf(safeFetchText(P("/loop0"), { ...base, maxRedirects: 3 })); ok("5 redirect loop → too_many_redirects", c === "too_many_redirects", c); }
  {
    const r = await safeFetchText(P("/relative"), base).catch((e) => e);
    ok("5 relative redirect to an allowed URL is followed", !(r instanceof Error) && r.redirects === 1 && /hello/.test(r.body), String(r));
  }
  {
    lookups.length = 0;
    await safeFetchText(P("/relative"), base).catch(() => {});
    ok("5 each redirect hop is resolved and checked again", lookups.length === 2, `lookups=${lookups.length}`);
  }

  // Timeouts
  {
    const t0 = Date.now();
    const c = await codeOf(safeFetchText(P("/hang-headers"), { ...base, timeoutMs: 300 }));
    ok("6 no response headers → timeout", c === "timeout", c);
    ok("6 timeout fires near the deadline", Date.now() - t0 < 1_500, `${Date.now() - t0}ms`);
  }
  { const c = await codeOf(safeFetchText(P("/hang-body"), { ...base, timeoutMs: 300 })); ok("6 body never finishes → timeout", c === "timeout", c); }
  { const c = await codeOf(safeFetchText(P("/drip"), { ...base, timeoutMs: 400 })); ok("6 slow drip body → timeout (deadline is total, not idle)", c === "timeout", c); }

  // Oversized responses
  { const c = await codeOf(safeFetchText(P("/big-declared"), base)); ok("7 declared Content-Length over limit → too_large", c === "too_large", c); }
  { const c = await codeOf(safeFetchText(P("/big-chunked"), base)); ok("7 undeclared streamed body over limit → too_large", c === "too_large", c); }
  { const c = await codeOf(safeFetchText(P("/gzip-bomb"), base)); ok("7 gzip bomb (small on wire, huge decoded) → too_large", c === "too_large", c); }

  // Ports
  ok("8 default policy refuses non-80/443 ports without connecting",
    (await codeOf(safeFetchText(P("/ok"), { ...base, allowedPorts: undefined }))) === "blocked_port");

  // Default policy (no test seam): real loopback is refused
  { const c = await codeOf(safeFetchText(`http://127.0.0.1:${publicPort}/ok`, { allowedPorts: [publicPort] })); ok("8 default policy refuses the real loopback address", c === "blocked_address", c); }

  ok("9 the internal canary server received no request at any point", canaryHits === 0, `canary hits: ${canaryHits}`);

  return finish(results, servers);
}

async function finish(results: Result[], servers: http.Server[]): Promise<SafeFetchSelfTestReport> {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, pass: passed === results.length, results };
}
