#!/usr/bin/env node
/**
 * Route harness for POST /api/extract (PR 1).
 *
 * Drives the REAL compiled handler (scripts/out/app/api/extract/route.js) with
 * Supabase and next/server stubbed, and with node:http / node:https request
 * functions wrapped so every outbound connection attempt is counted. The
 * assertion that matters for SSRF is not only "the response says blocked" but
 * "no socket was ever opened".
 *
 * Prints `=== P / T extract route assertions ===`; exit 1 on any failure.
 */

const path = require("path");
const Module = require("module");
const http = require("http");
const https = require("https");

const ROOT = path.join(__dirname, "out");
const REPO = path.join(__dirname, "..");

// -------------------------------------------------------------- stubs ----

class StubResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
  }
  async json() { return this.body; }
}
const nextServerStub = { NextResponse: { json: (body, init) => new StubResponse(body, init) } };

const sessions = new Map(); // token -> user id
function createClientStub() {
  return {
    auth: {
      async getUser(token) {
        const id = sessions.get(token);
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "invalid" } };
      },
    },
  };
}

let outbound = 0;
for (const mod of [http, https]) {
  const real = mod.request;
  mod.request = function (...args) { outbound++; return real.apply(this, args); };
}

const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  try {
    return realResolve.call(this, request, ...rest);
  } catch (e) {
    if (request.startsWith(".") || path.isAbsolute(request)) throw e;
    return require.resolve(request, { paths: [path.join(REPO, "node_modules")] });
  }
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  if (request === "next/server") return nextServerStub;
  if (request === "@supabase/supabase-js") return { createClient: createClientStub };
  return realLoad.call(this, request, ...rest);
};

// ------------------------------------------------------------- harness ----

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` — ${detail}`}`);
};

function load() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT)) delete require.cache[k];
  return require(path.join(ROOT, "app/api/extract/route.js"));
}

function req(body, { token, contentLength, raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const payload = raw ?? JSON.stringify(body);
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Request("https://app.test/api/extract", { method: "POST", headers, body: payload });
}

function streamingReq(bytes, token) {
  // No Content-Length: the body arrives as a stream and must be capped while read.
  const chunk = new Uint8Array(1024).fill(97);
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) { if (sent >= bytes) return c.close(); sent += chunk.length; c.enqueue(chunk); },
  });
  return new Request("https://app.test/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: stream,
    duplex: "half",
  });
}

(async () => {
  // 1. Supabase not configured → 503, nothing fetched.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  {
    const { POST } = load();
    const before = outbound;
    const r = await POST(req({ mode: "url", url: "https://example.com/" }));
    ok("1 unconfigured auth → 503", r.status === 503, `status ${r.status}`);
    ok("1 …and no outbound request", outbound === before, `outbound +${outbound - before}`);
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub-key";
  sessions.set("good-token", "user-a");
  sessions.set("rate-token", "user-rate");
  const { POST } = load();

  // 2. Authentication
  {
    const before = outbound;
    const r1 = await POST(req({ mode: "url", url: "https://example.com/" }));
    ok("2 missing token → 401", r1.status === 401, `status ${r1.status}`);
    const r2 = await POST(req({ mode: "url", url: "https://example.com/" }, { token: "forged" }));
    ok("2 invalid token → 401", r2.status === 401, `status ${r2.status}`);
    ok("2 …and no outbound request for either", outbound === before, `outbound +${outbound - before}`);
  }

  // 3. Request resource limits
  {
    const r1 = await POST(req(null, { token: "good-token", raw: "x".repeat(10), contentLength: 50_000 }));
    ok("3 declared body over 8 KB → 413", r1.status === 413, `status ${r1.status}`);
    const r2 = await POST(streamingReq(20_000, "good-token"));
    ok("3 streamed body over 8 KB without Content-Length → 413", r2.status === 413, `status ${r2.status}`);
    const r3 = await POST(req(null, { token: "good-token", raw: "{not json" }));
    ok("3 malformed JSON → 400", r3.status === 400, `status ${r3.status}`);
    const r4 = await POST(req({ mode: "exec" }, { token: "good-token" }));
    ok("3 unknown mode → 400", r4.status === 400, `status ${r4.status}`);
    const r5 = await POST(req({ mode: "url", url: 42 }, { token: "good-token" }));
    ok("3 non-string url → needsText, no fetch", r5.status === 200 && r5.body.needsText === true, JSON.stringify(r5.body));
  }

  // 4. Internal targets are refused without opening a socket.
  const internal = [
    "http://127.0.0.1/",
    "http://localhost:80/",
    "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://[::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "file:///etc/passwd",
    "http://example.com:6379/",
    "http://user:pass@example.com/",
  ];
  for (const url of internal) {
    const before = outbound;
    const r = await POST(req({ mode: "url", url }, { token: "good-token" }));
    ok(`4 refused without a socket: ${url}`, r.status === 200 && r.body.needsText === true && outbound === before,
      `status ${r.status}, outbound +${outbound - before}, body ${JSON.stringify(r.body)}`);
  }

  // 5. Unchanged behaviour
  {
    const r = await POST(req({ mode: "pdf" }, { token: "good-token" }));
    ok("5 pdf mode still answers needsText", r.status === 200 && r.body.needsText === true, JSON.stringify(r.body));
    const r2 = await POST(req({ mode: "url", url: "" }, { token: "good-token" }));
    ok("5 empty url still answers needsText", r2.status === 200 && r2.body.needsText === true, JSON.stringify(r2.body));
  }

  // 6. Rate limit: 20 per minute per user; the 21st is refused.
  {
    let last;
    for (let i = 0; i < 21; i++) last = await POST(req({ mode: "pdf" }, { token: "rate-token" }));
    ok("6 21st request in a minute → 429", last.status === 429, `status ${last.status}`);
    ok("6 …with a Retry-After header", Number(last.headers.get("retry-after")) >= 1, String(last.headers.get("retry-after")));
    const other = await POST(req({ mode: "pdf" }, { token: "good-token" }));
    ok("6 another user is not limited by it", other.status === 200, `status ${other.status}`);
  }

  // 7. The fetcher's own suite (local servers, injected resolver).
  {
    const { runSafeFetchSelfTests } = require(path.join(ROOT, "lib/security/safe-fetch-selftest.js"));
    const report = await runSafeFetchSelfTests();
    for (const r of report.results) if (!r.pass) console.log(`FAIL safe-fetch: ${r.name} — ${r.detail ?? ""}`);
    ok(`7 safe-fetch suite ${report.passed}/${report.total}`, report.pass && report.total >= 70, `${report.passed}/${report.total}`);
    console.log(`SAFEFETCH ${report.passed}/${report.total}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed} / ${results.length} extract route assertions ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.log("FAIL harness crashed — " + (e && e.stack || e));
  process.exit(1);
});
