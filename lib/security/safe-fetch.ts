/**
 * Outbound fetch for user-supplied URLs (PR 1, `/api/extract` hardening).
 *
 * ## The hole this closes
 *
 * `/api/extract` used `fetch(url, { redirect: "follow" })` after a check on the
 * hostname TEXT. That check could be passed by any public DNS name pointing at
 * a private address, by a redirect to a private address, by IPv6 private
 * ranges, and — between a check and a fetch that each resolve DNS — by a
 * name whose answer changes (DNS rebinding, a time-of-check/time-of-use gap).
 *
 * ## How this closes it
 *
 * 1. **One resolution, used for the connection.** The address check runs
 *    inside the `lookup` hook Node calls to open the socket. The address that
 *    is checked is the address that is connected to; there is no second
 *    resolution for an attacker's DNS to answer differently.
 * 2. **All answers must be public.** If a name resolves to several addresses
 *    and ANY of them is non-public, the request is refused, so a mixed answer
 *    cannot be used to race the connection onto the private one.
 * 3. **The peer is re-checked.** On connect, the socket's actual remote address
 *    is checked again and the socket destroyed if it is not public. This is
 *    defence in depth for any path that bypasses `lookup`.
 * 4. **IP literals are checked directly.** Node does not call `lookup` for an
 *    IP-literal host, so those are validated before any socket is opened. The
 *    WHATWG URL parser has already normalised numeric forms (`2130706433`,
 *    `0x7f.1`, `127.1`) to dotted quads by then.
 * 5. **Redirects are followed by hand.** Each `Location` is parsed, validated
 *    and connected to through the same path, up to a small limit.
 * 6. **Bounded resources.** One overall deadline covers DNS, connect, headers,
 *    redirects and body. Bodies are capped both on the wire and after
 *    decompression (so a compression bomb is cut off), and an oversized
 *    `Content-Length` is refused before reading.
 * 7. **No ambient state.** No proxy, no connection reuse (`agent: false`), no
 *    credentials in URLs, only ports 80 and 443 by default.
 *
 * Tests may inject a resolver and an address policy so the behaviour can be
 * exercised against local servers; production callers use the defaults.
 */

import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as zlib from "node:zlib";
import type { Readable } from "node:stream";

// ------------------------------------------------------------ address policy

/** IPv4 ranges that are never reachable from the extractor. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

const v4Block = new net.BlockList();
for (const [addr, prefix] of BLOCKED_V4) v4Block.addSubnet(addr, prefix, "ipv4");

/**
 * IPv6 is decided by allowlist: only global unicast (2000::/3) may pass, minus
 * the parts of it that are documentation or that embed / tunnel to IPv4.
 * Everything else — loopback, unspecified, unique-local fc00::/7, link-local
 * fe80::/10, multicast, NAT64 64:ff9b::/96, IPv4-mapped ::ffff:0:0/96 — falls
 * outside 2000::/3 and is refused by default.
 */
const v6Global = new net.BlockList();
v6Global.addSubnet("2000::", 3, "ipv6");
const v6BlockedInsideGlobal = new net.BlockList();
v6BlockedInsideGlobal.addSubnet("2001:db8::", 32, "ipv6"); // documentation
v6BlockedInsideGlobal.addSubnet("2001::", 32, "ipv6"); // Teredo (embeds IPv4)
v6BlockedInsideGlobal.addSubnet("2002::", 16, "ipv6"); // 6to4 (embeds IPv4)
v6BlockedInsideGlobal.addSubnet("2001:10::", 28, "ipv6"); // ORCHID (deprecated)

/** Strip IPv6 brackets and any zone index (`fe80::1%eth0`). */
function bareAddress(address: string): string {
  let a = address.trim();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  return a;
}

/** True only for a globally routable unicast address. Anything unparseable is false. */
export function isPublicAddress(address: string): boolean {
  const a = bareAddress(address);
  const family = net.isIP(a);
  if (family === 4) return !v4Block.check(a, "ipv4");
  if (family === 6) {
    // An IPv4-mapped address is judged as the IPv4 address it carries.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
    if (mapped) return isPublicAddress(mapped[1]);
    return v6Global.check(a, "ipv6") && !v6BlockedInsideGlobal.check(a, "ipv6");
  }
  return false;
}

// ------------------------------------------------------------------ options

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SafeFetchOptions {
  /** Overall deadline for the whole operation, redirects included. */
  timeoutMs?: number;
  /** Maximum response body, measured after decompression. */
  maxBytes?: number;
  /** Maximum redirects followed. */
  maxRedirects?: number;
  /** Ports a URL may name. Default: 80 and 443 only. */
  allowedPorts?: number[];
  /** Extra request headers (no Host, Cookie or Authorization are ever sent). */
  headers?: Record<string, string>;
  /** Test seam: DNS resolver. Default: the system resolver, all addresses. */
  resolve?: Resolver;
  /** Test seam: address policy. Default: `isPublicAddress`. */
  isAllowedAddress?: (address: string) => boolean;
  /** Test seam: observe each address actually connected to. */
  onConnect?: (info: { hostname: string; address: string }) => void;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  redirects: number;
}

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_scheme"
  | "blocked_credentials"
  | "blocked_port"
  | "blocked_address"
  | "dns_failure"
  | "too_many_redirects"
  | "bad_redirect"
  | "timeout"
  | "too_large"
  | "network_error";

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SafeFetchError";
  }
}

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 3_000_000,
  maxRedirects: 3,
  allowedPorts: [80, 443],
} as const;

const MAX_URL_LENGTH = 2_048;

const defaultResolve: Resolver = async (hostname) => {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

// ------------------------------------------------------------- URL checking

/**
 * Parse and validate a URL before any network activity. Exported so the route
 * can reject obviously bad input without starting a fetch, and for tests.
 */
export function validateOutboundUrl(
  raw: string,
  opts: Pick<SafeFetchOptions, "allowedPorts" | "isAllowedAddress"> = {},
): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new SafeFetchError("invalid_url");
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError("invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("blocked_scheme");
  if (u.username || u.password) throw new SafeFetchError("blocked_credentials");
  const host = bareAddress(u.hostname);
  if (!host) throw new SafeFetchError("invalid_url");
  if (net.isIP(host)) {
    const allowed = opts.isAllowedAddress ?? isPublicAddress;
    if (!allowed(host)) throw new SafeFetchError("blocked_address");
  } else {
    const lower = host.toLowerCase();
    if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal")) {
      // Cheap early refusal; the connection-time check would refuse these anyway.
      throw new SafeFetchError("blocked_address");
    }
  }
  // Port after address, so an internal target is always reported as such.
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  const ports: readonly number[] = opts.allowedPorts ?? SAFE_FETCH_DEFAULTS.allowedPorts;
  if (!ports.includes(port)) throw new SafeFetchError("blocked_port");
  return u;
}

// ---------------------------------------------------------------- fetching

/**
 * GET a user-supplied URL and return its body as text, following up to
 * `maxRedirects` redirects. Every connection, including each redirect hop,
 * is made only to an address that passed the policy at connection time.
 */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const deadline = Date.now() + timeoutMs;

  let url = validateOutboundUrl(rawUrl, options);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, options, deadline);
    if (res.redirectTo === undefined) {
      return { status: res.status, contentType: res.contentType, body: res.body, finalUrl: url.toString(), redirects: hop };
    }
    if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects");
    let next: URL;
    try {
      next = new URL(res.redirectTo, url);
    } catch {
      throw new SafeFetchError("bad_redirect");
    }
    url = validateOutboundUrl(next.toString(), options);
  }
}

interface OnceResult {
  status: number;
  contentType: string;
  body: string;
  redirectTo?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function requestOnce(url: URL, options: SafeFetchOptions, deadline: number): Promise<OnceResult> {
  const resolve = options.resolve ?? defaultResolve;
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new SafeFetchError("timeout"));

  const hostname = bareAddress(url.hostname);

  /**
   * The ONLY place a hostname becomes an address for this request. Node calls
   * this while opening the socket and connects to what it returns, so the
   * address checked here is the address used.
   */
  const lookup = (
    host: string,
    lookupOpts: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ): void => {
    resolve(host).then(
      (answers) => {
        if (!answers.length) {
          callback(Object.assign(new Error("no addresses"), { code: "ENOTFOUND" }), "", 0);
          return;
        }
        if (answers.some((a) => !allowed(a.address))) {
          callback(new SafeFetchError("blocked_address") as unknown as NodeJS.ErrnoException, "", 0);
          return;
        }
        let usable = answers;
        if (lookupOpts.family === 4 || lookupOpts.family === 6) {
          usable = answers.filter((a) => a.family === lookupOpts.family);
          if (!usable.length) {
            callback(Object.assign(new Error("no address of requested family"), { code: "ENOTFOUND" }), "", 0);
            return;
          }
        }
        if (lookupOpts.all) callback(null, usable.map((a) => ({ address: a.address, family: a.family })));
        else callback(null, usable[0].address, usable[0].family);
      },
      (err) => callback(Object.assign(new Error(String(err?.message ?? err)), { code: "ENOTFOUND" }), "", 0),
    );
  };

  const headers: Record<string, string> = {
    "user-agent": "LifeOS/1.0 (+ingestion)",
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    "accept-encoding": "gzip, deflate, br",
  };
  for (const [k, v] of Object.entries(options.headers ?? {})) {
    if (/^(host|cookie|authorization|proxy-authorization)$/i.test(k)) continue;
    headers[k.toLowerCase()] = v;
  }

  const transport = url.protocol === "https:" ? https : http;

  return new Promise<OnceResult>((resolvePromise, rejectPromise) => {
    let settled = false;
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      rejectPromise(e instanceof SafeFetchError ? e : classify(e));
    };
    const succeed = (r: OnceResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolvePromise(r);
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        agent: false,
        lookup: lookup as unknown as http.RequestOptions["lookup"],
        // For https, Node verifies the certificate against `hostname`.
        ...(url.protocol === "https:" && !net.isIP(hostname) ? { servername: hostname } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");

        if (REDIRECT_STATUSES.has(status)) {
          const location = res.headers.location;
          res.resume();
          if (!location) return fail(new SafeFetchError("bad_redirect"));
          return succeed({ status, contentType, body: "", redirectTo: String(location) });
        }

        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.resume();
          return fail(new SafeFetchError("too_large"));
        }

        let stream: Readable = res;
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        // Decompression output is capped below, so a small compressed body
        // that expands enormously is cut off at maxBytes.
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        else if (encoding && encoding !== "identity") {
          res.resume();
          return fail(new SafeFetchError("network_error", `unsupported content-encoding ${encoding}`));
        }

        const chunks: Buffer[] = [];
        let total = 0;
        let wire = 0;
        res.on("data", (c: Buffer) => {
          wire += c.length;
          if (wire > maxBytes) fail(new SafeFetchError("too_large"));
        });
        stream.on("data", (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            stream.destroy();
            return fail(new SafeFetchError("too_large"));
          }
          chunks.push(c);
        });
        stream.on("end", () => succeed({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        stream.on("error", fail);
        res.on("error", fail);
      },
    );

    // Defence in depth: the peer actually connected to must also be allowed.
    req.on("socket", (socket) => {
      socket.once("connect", () => {
        const peer = socket.remoteAddress ?? "";
        if (!allowed(peer)) return fail(new SafeFetchError("blocked_address"));
        options.onConnect?.({ hostname, address: bareAddress(peer) });
      });
    });

    const timer = setTimeout(() => fail(new SafeFetchError("timeout")), remaining);
    req.on("error", fail);
    req.end();
  });
}

function classify(e: unknown): SafeFetchError {
  const err = e as { code?: string; message?: string } | undefined;
  if (e instanceof SafeFetchError) return e;
  if (err?.code === "ENOTFOUND" || err?.code === "EAI_AGAIN") return new SafeFetchError("dns_failure");
  return new SafeFetchError("network_error", err?.message);
}
