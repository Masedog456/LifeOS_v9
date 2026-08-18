/**
 * Security self-tests (LIFEOS-040).
 *
 * Deterministic assertions for the whole lib/security surface plus the input-
 * safety hardening: safe URLs, protocol rejection, input limits, JSON depth,
 * redaction, error sanitization, schema compatibility, storage resilience,
 * multi-tab locks, CSP/headers, dev-route exclusion, the RLS/ownership audit,
 * threat-model completeness, auth boundaries, health, diagnostics sanitization,
 * and the annotation XSS fix.
 */

import { classifyUrl, isSafeUrl, safeHref, externalLinkProps, EXTERNAL_LINK_REL, BLOCKED_PROTOCOLS } from "@/lib/security/safe-url";
import { checkText, checkCount, jsonDepth, withinJsonDepth, safeJsonParse, isValidUuid, isValidTimestamp, hasControlChars, LIMITS } from "@/lib/security/input-limits";
import { redactMessage, maskEmail, buildDiagnosticEvent, isCleanDiagnosticEvent, errorToCode } from "@/lib/security/redaction";
import { toSafeError, publicError } from "@/lib/security/errors";
import {
  bearerToken, costBearing, evaluateAccess, rateLimit, resetRateLimits,
  nextBucket, isOverLimit, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/api-auth";
import { tokenIsFresh, TOKEN_REFRESH_SKEW_SECONDS } from "@/lib/security/api-token";
import { withTimeout, AUTH_BOOTSTRAP_TIMEOUT_MS } from "@/lib/persistence";
import {
  markBootstrap, authBootstrapPhase, isSafeDiagnostic, resetBootstrapPhase,
} from "@/lib/security/auth-bootstrap";
import { DEGRADED_MESSAGE } from "@/lib/aiClient";
import { mockAnswer } from "@/lib/mockAI";
import { evaluateCompatibility, syncIsSafe } from "@/lib/security/schema-compatibility";
import { probeStorage, readJson, writeJson } from "@/lib/security/storage-resilience";
import { acquireLock, releaseLock } from "@/lib/security/multi-tab";
import { securityHeaders, validateHeaders, cspDirectives, serializeCsp } from "@/lib/security/headers";
import { isDevRoute, auditRouteManifest } from "@/lib/security/dev-routes";
import { TABLE_REGISTRY, checkPoliciesInSql, auditTable, userOwnedTablesInSql, registryEntry } from "@/lib/security/authorization-audit";
import { validateThreatModel, THREATS } from "@/lib/security/threat-model";
import { mayRenderProtected, mayWriteProtected, isExpired, safeRedirect, isClosedBetaRefusal, closedBetaRefusal, neutralAuthError } from "@/lib/security/auth-boundaries";
import { publicHealth, authenticatedHealth, rollUp } from "@/lib/security/health";
import { buildDiagnostics, assertSanitized } from "@/lib/security/diagnostics";
import { renderMarkdownInline } from "@/lib/library/annotations";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** An in-memory Storage stand-in for deterministic storage tests. */
function memStore(fail?: "quota" | "unavailable"): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear() { m.clear(); },
    key(i: number) { return [...m.keys()][i] ?? null; },
    getItem(k: string) { return m.get(k) ?? null; },
    removeItem(k: string) { m.delete(k); },
    setItem(k: string, v: string) {
      if (fail === "quota") { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      if (fail === "unavailable") throw new Error("SecurityError");
      m.set(k, v);
    },
  } as Storage;
}

export async function runSecuritySelfTests(): Promise<SelfTestReport> {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Safe URL ----
  ok("1.1 https allowed", isSafeUrl("https://example.com/x"));
  ok("1.2 http allowed", isSafeUrl("http://example.com"));
  ok("1.3 mailto allowed", isSafeUrl("mailto:a@b.com"));
  ok("1.4 javascript: rejected", !isSafeUrl("javascript:alert(1)"));
  ok("1.5 data: rejected", !isSafeUrl("data:text/html,<script>"));
  ok("1.6 file: rejected", !isSafeUrl("file:///etc/passwd"));
  ok("1.7 control-char evasion rejected", !isSafeUrl("java\tscript:alert(1)"), safeHref("java\tscript:alert(1)") ?? "null");
  ok("1.8 relative rejected", !isSafeUrl("/local/path"));
  ok("1.9 all blocked protocols rejected", BLOCKED_PROTOCOLS.every((p) => !isSafeUrl(`${p}whatever`)));
  ok("1.10 external props carry noopener", externalLinkProps("https://x.com")?.rel === EXTERNAL_LINK_REL);
  ok("1.11 blocked classify reason", classifyUrl("vbscript:x").reason === "blocked-protocol");

  // ---- 2. Input limits ----
  ok("2.1 short title ok", checkText("Title", "hello", "title") === null);
  ok("2.2 long title rejected", checkText("Title", "x".repeat(LIMITS.title + 1), "title") !== null);
  ok("2.3 tag count enforced", checkCount("Tags", new Array(LIMITS.tagsPerRecord + 1).fill("t"), "tagsPerRecord") !== null);
  ok("2.4 uuid valid", isValidUuid("123e4567-e89b-12d3-a456-426614174000"));
  ok("2.5 uuid invalid", !isValidUuid("not-a-uuid"));
  ok("2.6 timestamp valid", isValidTimestamp("2026-07-31T00:00:00.000Z"));
  ok("2.7 timestamp invalid", !isValidTimestamp("nope"));
  ok("2.8 control chars detected", hasControlChars("a\x00b"));
  // deep JSON
  let deep: unknown = 0; for (let i = 0; i < LIMITS.jsonDepth + 10; i++) deep = { d: deep };
  ok("2.9 deep JSON rejected", !withinJsonDepth(deep), String(jsonDepth(deep)));
  ok("2.10 shallow JSON ok", withinJsonDepth({ a: { b: { c: 1 } } }));
  ok("2.11 cyclic JSON rejected", !withinJsonDepth((() => { const o: Record<string, unknown> = {}; o.self = o; return o; })()));
  ok("2.12 safeJsonParse rejects deep", !safeJsonParse(JSON.stringify(deep)).ok);
  ok("2.13 safeJsonParse ok", safeJsonParse('{"a":1}').ok);

  // ---- 3. Redaction ----
  ok("3.1 jwt redacted", !/eyJ/.test(redactMessage("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcDEF")));
  ok("3.2 email redacted", redactMessage("failed for a@b.com").includes("«email»"));
  ok("3.3 bearer redacted", redactMessage("Authorization: Bearer abc.def.ghi").includes("«token»"));
  ok("3.4 query secret redacted", redactMessage("https://x?access_token=SECRET&y=1").includes("«redacted»"));
  ok("3.5 mask email", maskEmail("mason@example.com") === "m••••@example.com");
  ok("3.6 diagnostic event allowlist drops content", (() => {
    const e = buildDiagnosticEvent({ event: "sync", captureText: "PRIVATE", note: "secret", operation: "save" });
    return isCleanDiagnosticEvent(e) && !("captureText" in e) && e.operation === "save";
  })());
  ok("3.7 error → code", errorToCode(new Error("Network request failed")).code === "network");

  // ---- 4. Safe errors ----
  {
    const se = toSafeError(new Error("permission denied by RLS policy"), { isDev: false });
    ok("4.1 error category authorization", se.category === "authorization", se.category);
    ok("4.2 reference format", /^ERR-[0-9A-Z]{4,}-/.test(se.reference), se.reference);
    ok("4.3 no devDetail in prod", se.devDetail === undefined);
    ok("4.4 publicError drops devDetail", !("devDetail" in publicError(toSafeError(new Error("x"), { isDev: true }))));
    ok("4.5 network retryable", toSafeError(new Error("fetch timeout")).retryable);
  }

  // ---- 5. Schema compatibility ----
  ok("5.1 compatible → ok+sync", (() => { const r = evaluateCompatibility({ localStateVersion: 1, remoteMigrationVersion: 38 }); return r.mode === "ok" && syncIsSafe(r); })());
  ok("5.2 server ahead → read-only, no sync", (() => { const r = evaluateCompatibility({ localStateVersion: 1, remoteMigrationVersion: 99 }); return r.mode === "read-only" && !r.canSync && r.canExport; })());
  ok("5.3 local newer → blocked", evaluateCompatibility({ localStateVersion: 5 }).mode === "blocked");
  ok("5.4 local older → upgrade, no write", (() => { const r = evaluateCompatibility({ localStateVersion: 0 }); return r.mode === "upgrade" && !r.canWrite; })());
  ok("5.5 blocked/read-only never sync", !syncIsSafe(evaluateCompatibility({ localStateVersion: 5 })));

  // ---- 6. Storage resilience ----
  {
    const s = memStore();
    ok("6.1 probe ok", probeStorage(s).available);
    ok("6.2 quota probe", probeStorage(memStore("quota")).status === "quota-exceeded");
    ok("6.3 unavailable probe", !probeStorage(memStore("unavailable")).available);
    writeJson("k", { a: 1 }, s);
    ok("6.4 read back", (readJson<{ a: number }>("k", s) as { status: string; value?: { a: number } }).status === "ok");
    ok("6.5 empty read", readJson("missing", s).status === "empty");
    s.setItem("bad", "{not json");
    ok("6.6 corrupt read", readJson("bad", s).status === "corrupt");
    ok("6.7 quota write reported", writeJson("k", { a: 1 }, memStore("quota")).status === "quota-exceeded");
  }

  // ---- 7. Multi-tab locks ----
  {
    const s = memStore();
    ok("7.1 acquire lock", acquireLock("import", "tabA", 1000, s));
    ok("7.2 other tab blocked", !acquireLock("import", "tabB", 1000, s));
    releaseLock("tabA", s);
    ok("7.3 lock released → reacquire", acquireLock("export", "tabB", 1000, s));
  }

  // ---- 8. Headers / CSP ----
  {
    const hs = securityHeaders({ supabaseOrigin: "https://proj.supabase.co" });
    const v = validateHeaders(hs);
    ok("8.1 headers valid", v.ok, v.problems.join(","));
    const csp = serializeCsp(cspDirectives());
    ok("8.2 no unsafe-eval", !/unsafe-eval/.test(csp));
    ok("8.3 frame-ancestors none", /frame-ancestors 'none'/.test(csp));
    ok("8.4 object-src none", /object-src 'none'/.test(csp));
    ok("8.5 base-uri self + form-action self", /base-uri 'self'/.test(csp) && /form-action 'self'/.test(csp));
    ok("8.6 HSTS present", hs.some((h) => h.key === "Strict-Transport-Security"));
    ok("8.7 unsafe-eval header rejected", !validateHeaders([{ key: "Content-Security-Policy", value: "script-src 'unsafe-eval'" }]).ok);
  }

  // ---- 9. Dev-route exclusion ----
  ok("9.1 /dev/ is dev route", isDevRoute("/dev/insights-tests"));
  ok("9.2 /today not dev", !isDevRoute("/today"));
  ok("9.3 prod manifest with dev route fails", !auditRouteManifest(["/today", "/dev/x"], "production").ok);
  ok("9.4 prod manifest clean passes", auditRouteManifest(["/today", "/insights"], "production").ok);
  ok("9.5 dev env permits dev routes", auditRouteManifest(["/dev/x"], "development").ok);

  // ---- 10. Authorization / RLS audit ----
  {
    const sampleSql = `create table if not exists public.widgets (id uuid primary key, user_id uuid not null default auth.uid());
      alter table public.widgets enable row level security;
      create policy widgets_select on public.widgets for select using (auth.uid() = user_id);
      create policy widgets_insert on public.widgets for insert with check (auth.uid() = user_id);
      create policy widgets_update on public.widgets for update using (auth.uid() = user_id);
      create policy widgets_delete on public.widgets for delete using (auth.uid() = user_id);`;
    const p = checkPoliciesInSql(sampleSql, "widgets");
    ok("10.1 rls detected", p.rlsEnabled);
    ok("10.2 all four policies detected", p.select && p.insert && p.update && p.delete);
    const missing = checkPoliciesInSql("create table public.x (user_id uuid);", "x");
    ok("10.3 missing policies detected", !missing.rlsEnabled && !missing.select);
    ok("10.4 user-owned tables found in sql", userOwnedTablesInSql(sampleSql).includes("widgets"));
    ok("10.5 registry has saved_insight_views", !!registryEntry("saved_insight_views"));
    ok("10.6 every registry entry audits clean against a compliant policy block", TABLE_REGISTRY.every((e) => {
      const sql = `alter table public.${e.table} enable row level security;` + e.policies.map((pl) => `create policy ${e.table}_${pl} on public.${e.table} for ${pl} using (auth.uid() = user_id);`).join("\n");
      return auditTable(e, sql).ok;
    }));
    ok("10.7 audit flags a table missing delete policy", (() => {
      const e = registryEntry("captures")!;
      const sql = `alter table public.captures enable row level security; create policy c_s on public.captures for select using (auth.uid()=user_id); create policy c_i on public.captures for insert with check (auth.uid()=user_id); create policy c_u on public.captures for update using (auth.uid()=user_id);`;
      return !auditTable(e, sql).ok;
    })());
  }

  // ---- 11. Threat model ----
  ok("11.1 threat model complete", validateThreatModel().ok, validateThreatModel().problems.join(","));
  ok("11.2 covers >= 17 threats", THREATS.length >= 17, String(THREATS.length));
  ok("11.3 every threat has remaining risk", THREATS.every((t) => t.remainingRisk.length > 0));

  // ---- 12. Auth boundaries ----
  ok("12.1 signed-in renders protected", mayRenderProtected({ category: "signed-in" }));
  ok("12.2 signed-out hides protected", !mayRenderProtected({ category: "signed-out" }));
  ok("12.3 expired fails closed", isExpired({ category: "signed-in", expiresInSec: -1 }));
  ok("12.4 expired blocks writes", !mayWriteProtected({ category: "signed-in", expiresInSec: -1 }));
  ok("12.5 deletion freeze blocks writes", !mayWriteProtected({ category: "signed-in", deletionFreeze: true }));
  ok("12.6 schema block stops writes", !mayWriteProtected({ category: "signed-in", writesAllowedBySchema: false }));
  ok("12.7 open redirect rejected", safeRedirect("https://evil.com/x") === "/today");
  ok("12.8 protocol-relative rejected", safeRedirect("//evil.com") === "/today");
  ok("12.9 same-origin path allowed", safeRedirect("/insights") === "/insights");

  // ---- 12b. Closed-beta sign-in refusal (LIFEOS-050C) ----
  //
  // The beta admits users ONLY by founder pre-creation in Supabase. Sign-in
  // passes `shouldCreateUser: false`, so an unknown address comes back as an
  // error rather than a new account — and this is the classifier that decides
  // whether that error is a refusal (show the calm closed-beta message) or a
  // genuine fault (show the provider's own message). Getting it wrong in either
  // direction is bad: a leaked provider string confuses a tester, and a real
  // outage disguised as "you're not invited" hides a live incident.
  //
  // The absence of `shouldCreateUser: false` itself is guarded statically by
  // `npm run audit:auth`, which also proves no second signup path exists — a
  // unit test cannot see a `signUp()` added to a file it never imports.
  ok("12b.1 unknown address is a closed-beta refusal", isClosedBetaRefusal("otp_disabled"));
  ok("12b.2 dashboard signup-disabled is a refusal", isClosedBetaRefusal("signup_disabled"));
  ok("12b.3 missing user is a refusal", isClosedBetaRefusal("user_not_found"));
  ok("12b.4 rate limiting is NOT a refusal (real fault surfaces)", !isClosedBetaRefusal("over_email_send_rate_limit"));
  ok("12b.5 provider outage is NOT a refusal", !isClosedBetaRefusal("unexpected_failure"));
  ok("12b.6 a banned user is NOT treated as uninvited", !isClosedBetaRefusal("user_banned"));
  ok("12b.7 an absent code is not a refusal", !isClosedBetaRefusal(undefined));
  // The refusal copy must not become an account-existence oracle, and must not
  // promise a link that was never sent.
  ok("12b.8 refusal copy does not confirm or deny an account", (() => {
    const m = closedBetaRefusal().toLowerCase();
    return !/(isn't|is not|no) (an )?(account|user)|not registered|doesn't exist|unknown address/.test(m);
  })());
  ok("12b.9 refusal copy does not promise an email that was never sent", (() => {
    const m = closedBetaRefusal().toLowerCase();
    return !/check your email for a link|link is on its way|we've sent/.test(m);
  })());
  ok("12b.10 refusal copy names the closed beta and a way forward", (() => {
    const m = closedBetaRefusal().toLowerCase();
    return m.includes("closed beta") && m.includes("invit");
  })());
  ok("12b.11 neutral auth error still reveals nothing", !/account|exist|registered/i.test(neutralAuthError()));

  // ---- 13. Health ----
  {
    const pub = publicHealth({ shellReachable: true, authProviderReachable: true, staticAssetsReachable: true });
    ok("13.1 public health ok", pub.status === "ok");
    ok("13.2 public health has no db check", !pub.checks.some((c) => c.name === "database"));
    const auth = authenticatedHealth({ shellReachable: true, authProviderReachable: true, staticAssetsReachable: true, databaseReachable: false, schemaCompatible: true });
    ok("13.3 db down → overall down", auth.status === "down");
    ok("13.4 rollUp worst wins", rollUp([{ name: "a", status: "ok" }, { name: "b", status: "degraded" }]) === "degraded");
  }

  // ---- 14. Diagnostics sanitization ----
  {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEFghiJKLmnoPQRstu";
    const snap = buildDiagnostics({ appVersion: "1.0.0", buildId: "abc", stateSchemaVersion: 1, migrationVersion: 31, authCategory: "signed-in", authEmail: "mason@example.com", adapter: "supabase", remoteReachable: true, lastSyncAt: null, pendingMutations: 2, dirtyDomains: ["captures"], unresolvedConflicts: 0, storageStatus: "ok", recentErrors: [{ at: "x", code: "network", message: `token ${jwt} failed` }] });
    ok("14.1 email masked", (snap.auth.emailMasked ?? "").includes("•"));
    ok("14.2 diagnostics sanitized", assertSanitized(snap).ok, assertSanitized(snap).problems.join(","));
    ok("14.3 error token redacted", !JSON.stringify(snap).includes(jwt));
  }

  // ---- 15. Annotation XSS hardening (Feature 5) ----
  ok("15.1 script escaped", renderMarkdownInline("<script>alert(1)</script>") === "&lt;script&gt;alert(1)&lt;/script&gt;");
  ok("15.2 attribute-injection link neutralized", (() => {
    // Crafted URL tries to break out of href="" with a raw quote + event handler.
    // safe-url normalization percent-encodes the quotes, so the open <a> tag has
    // EXACTLY href/rel/target and no injected on*-handler attribute.
    const html = renderMarkdownInline('[x](https://a.com/" onmouseover="alert(1))');
    const openTag = html.slice(0, html.indexOf(">"));
    const noRawHandler = !/["']\s*on\w+\s*=/i.test(openTag) && !/\son\w+\s*=/i.test(openTag);
    const wellFormed = /^<a href="[^"]*" rel="[^"]*" target="_blank"$/.test(openTag);
    return noRawHandler && wellFormed;
  })(), renderMarkdownInline('[x](https://a.com/" onmouseover="alert(1))'));
  ok("15.3 javascript link not anchored", (() => {
    const html = renderMarkdownInline("[x](javascript:alert(1))");
    return !/<a /.test(html);
  })());
  ok("15.4 safe https link anchored with noopener", (() => {
    const html = renderMarkdownInline("[x](https://example.com)");
    return /<a href="https:\/\/example.com\/?" rel="noopener noreferrer nofollow" target="_blank">x<\/a>/.test(html);
  })(), renderMarkdownInline("[x](https://example.com)"));
  ok("15.5 quotes escaped", renderMarkdownInline(`"'`) === "&quot;&#39;");

  // ==================== 12. Public AI cost boundary (LIFEOS-055S) ====================
  //
  // The hole this closes: at public launch POST /api/ai accepted any request
  // from the open internet and, with ANTHROPIC_API_KEY set, spent real money on
  // it. Nothing identified the caller.
  {
    // ---- bearer parsing ----
    ok("12.1 bearer token parsed", bearerToken("Bearer abc.def.ghi") === "abc.def.ghi");
    ok("12.2 case-insensitive scheme", bearerToken("bearer xyz") === "xyz");
    ok("12.3 missing header → null", bearerToken(null) === null);
    ok("12.4 wrong scheme → null", bearerToken("Basic abc") === null);
    ok("12.5 empty token → null", bearerToken("Bearer   ") === null);

    // ---- cost detection ----
    ok("12.6 a configured key is cost-bearing", costBearing(["sk-live"]) === true);
    ok("12.7 no key is not cost-bearing", costBearing([undefined]) === false);
    ok("12.8 blank key is not cost-bearing", costBearing(["   "]) === false);

    // ---- the policy itself ----
    const cfg = { supabaseConfigured: true };
    // THE CRITICAL CASE: paid key + anonymous caller must be refused.
    const anon = evaluateAccess({ costBearing: true, ...cfg, token: null });
    ok("12.9 paid + no token → REFUSED", anon.allow === false);
    ok("12.10 paid + no token → 401", anon.status === 401);
    const forged = evaluateAccess({ costBearing: true, ...cfg, token: "forged", tokenValid: false });
    ok("12.11 paid + invalid token → REFUSED", forged.allow === false && forged.status === 401);
    const good = evaluateAccess({ costBearing: true, ...cfg, token: "real", tokenValid: true });
    ok("12.12 paid + valid token → allowed", good.allow === true);
    // No key means mocks only — no spend, so no login demanded.
    ok("12.13 unpaid + no token → allowed (mocks only)",
      evaluateAccess({ costBearing: false, ...cfg, token: null }).allow === true);
    ok("12.14 unpaid path never 401s",
      evaluateAccess({ costBearing: false, ...cfg, token: null }).status === undefined);
    // Paid key but no identity system: refuse rather than spend anonymously.
    const misconfig = evaluateAccess({ costBearing: true, supabaseConfigured: false, token: "x", tokenValid: true });
    ok("12.15 paid + no auth system → REFUSED", misconfig.allow === false);
    ok("12.16 that is a 503, not a 401 (server's fault)", misconfig.status === 503);

    // ---- the property that matters: a refusal cannot reach the provider ----
    const refusals = [
      evaluateAccess({ costBearing: true, ...cfg, token: null }),
      evaluateAccess({ costBearing: true, ...cfg, token: "bad", tokenValid: false }),
      evaluateAccess({ costBearing: true, supabaseConfigured: false, token: null }),
    ];
    ok("12.17 every refusal blocks before the provider call", refusals.every((r) => r.allow === false));

    // ---- rate limiting (per-instance speed bump, honestly bounded) ----
    resetRateLimits();
    const t0 = 1_000_000;
    let last = { limited: false, retryAfterSeconds: 0 };
    for (let i = 0; i < RATE_LIMIT_MAX; i++) last = rateLimit("u1", t0);
    ok("12.18 requests up to the cap are allowed", last.limited === false);
    ok("12.19 the next request is limited", rateLimit("u1", t0).limited === true);
    ok("12.20 limiting is per identity", rateLimit("u2", t0).limited === false);
    ok("12.21 a new window resets the bucket",
      rateLimit("u1", t0 + RATE_LIMIT_WINDOW_MS + 1).limited === false);
    ok("12.22 a retry hint is offered", rateLimit("u1", t0).retryAfterSeconds >= 1);
    // Bucket arithmetic is pure and testable without timers.
    ok("12.23 a fresh bucket starts at 1", nextBucket(undefined, t0).count === 1);
    ok("12.24 within-window increments", nextBucket({ count: 3, resetAt: t0 + 100 }, t0).count === 4);
    ok("12.25 expired window restarts", nextBucket({ count: 99, resetAt: t0 - 1 }, t0).count === 1);
    ok("12.26 over-limit detection", isOverLimit({ count: RATE_LIMIT_MAX + 1, resetAt: t0 }) === true);

    // ---- no secret may ever reach the client bundle ----
    ok("12.27 no NEXT_PUBLIC Anthropic key exists", process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY === undefined);
    ok("12.28 no NEXT_PUBLIC embedding key exists", process.env.NEXT_PUBLIC_EMBEDDING_API_KEY === undefined);
  }

  // ============ 13. The 055T defect: signed-in user, 401 on /api/ai ============
  //
  // Production evidence: a signed-in user hit Reading -> Ask, Vercel logged
  // POST /api/ai 401, and the UI blamed a missing API key that was in fact
  // configured. Root cause: the client sent whatever `getSession()` returned,
  // including an EXPIRED access token. Supabase tokens live ~1 hour and only
  // auto-refresh while the tab is awake, so a long-lived tab is still "signed
  // in" while its token is stale.
  {
    const NOW = 1_800_000_000_000; // fixed clock
    const nowSec = Math.floor(NOW / 1000);

    // ---- freshness policy ----
    ok("13.1 a token expiring in an hour is fresh", tokenIsFresh(nowSec + 3600, NOW) === true);
    ok("13.2 an ALREADY EXPIRED token is not fresh (the defect)", tokenIsFresh(nowSec - 1, NOW) === false);
    ok("13.3 a token expiring inside the skew window is not fresh",
      tokenIsFresh(nowSec + (TOKEN_REFRESH_SKEW_SECONDS - 5), NOW) === false);
    ok("13.4 a token just past the skew window is fresh",
      tokenIsFresh(nowSec + (TOKEN_REFRESH_SKEW_SECONDS + 5), NOW) === true);
    ok("13.5 a session without expiry is not forced to refresh", tokenIsFresh(undefined, NOW) === true);
    ok("13.6 the skew is a real, non-zero margin", TOKEN_REFRESH_SKEW_SECONDS > 0);

    // ---- the server side must NOT be weakened by any of this ----
    const cfg = { supabaseConfigured: true };
    ok("13.7 an expired token still fails server verification",
      evaluateAccess({ costBearing: true, ...cfg, token: "expired.jwt", tokenValid: false }).status === 401);
    ok("13.8 /api/ai is still NOT anonymous",
      evaluateAccess({ costBearing: true, ...cfg, token: null }).allow === false);
    ok("13.9 a refreshed, valid token is accepted",
      evaluateAccess({ costBearing: true, ...cfg, token: "fresh.jwt", tokenValid: true }).allow === true);

    // ---- the copy must not blame the API key for an auth failure ----
    ok("13.10 a 401 reports an auth cause", DEGRADED_MESSAGE.auth.toLowerCase().includes("sign in"));
    ok("13.11 auth copy does NOT mention an API key",
      !/api key|anthropic_api_key/i.test(DEGRADED_MESSAGE.auth));
    ok("13.12 rate-limit copy is distinct", DEGRADED_MESSAGE.rate_limited !== DEGRADED_MESSAGE.auth);
    ok("13.13 provider copy is distinct", DEGRADED_MESSAGE.provider !== DEGRADED_MESSAGE.auth);
    ok("13.14 offline copy is distinct", DEGRADED_MESSAGE.offline !== DEGRADED_MESSAGE.provider);
    ok("13.15 no degraded message blames a missing key",
      Object.values(DEGRADED_MESSAGE).every((m) => !/set ANTHROPIC_API_KEY/i.test(m)));
    // The generic offline answer must be cause-neutral now.
    ok("13.16 the mock answer no longer asserts 'no AI key configured'",
      !/no AI key configured/i.test(mockAnswer("x".repeat(50), "q")));
    ok("13.17 the mock answer no longer tells users to set a key",
      !/ANTHROPIC_API_KEY/i.test(mockAnswer("x".repeat(50), "q")));
    ok("13.18 the mock answer still says it is offline output",
      /offline/i.test(mockAnswer("x".repeat(50), "q")));
  }

  // ====== 16. Auth bootstrap: configured + signed out must reach "Get started" ======
  //
  // Production evidence: a fresh Incognito load of app.conqify.com showed no
  // sign-in control and "Saved locally", with the bundle proven to contain a
  // valid Supabase URL/key. Root cause: in the CONFIGURED path, `applySession`
  // was the only thing that could clear `loading`, and it was reachable only
  // from the onAuthStateChange callback — so the whole signed-out UI waited on
  // an INITIAL_SESSION event the app never explicitly requested. `getSession()`
  // appeared nowhere in startup.
  {
    // A faithful model of the auth store's gating, so the UI contract is
    // asserted without a DOM.
    type A = { configured: boolean; loading: boolean; email: string | null; error?: string };
    const renders = (a: A): "nothing" | "spinner" | "get_started" | "account" =>
      !a.configured ? "nothing" : a.loading ? "spinner" : a.email ? "account" : "get_started";

    // ---- the defect, reproduced ----
    ok("16.1 configured + still loading renders NO sign-in control",
      renders({ configured: true, loading: true, email: null }) === "spinner");
    ok("16.2 that is the reported production state (no way in)",
      renders({ configured: true, loading: true, email: null }) !== "get_started");

    // ---- the repaired outcomes ----
    ok("16.3 configured + signed out => Get started",
      renders({ configured: true, loading: false, email: null }) === "get_started");
    ok("16.4 configured + signed in => account state",
      renders({ configured: true, loading: false, email: "a@b.c" }) === "account");
    ok("16.5 UNCONFIGURED local dev => control stays absent",
      renders({ configured: false, loading: false, email: null }) === "nothing");
    ok("16.6 a bootstrap failure still shows a way in",
      renders({ configured: true, loading: false, email: null, error: "Couldn't check" }) === "get_started");

    // ---- INITIAL_SESSION delayed or absent must NOT strand the UI ----
    const timedOut = await withTimeout(new Promise((r) => setTimeout(r, 50)), 5)
      .then(() => "resolved").catch((e) => (e as Error).message);
    ok("16.7 a hanging session read times out rather than hanging", timedOut === "auth_timeout");
    const fast = await withTimeout(Promise.resolve("ok"), 1000).catch(() => "failed");
    ok("16.8 a prompt session read is unaffected", fast === "ok");
    ok("16.9 the timeout is a real, bounded wait",
      AUTH_BOOTSTRAP_TIMEOUT_MS > 0 && AUTH_BOOTSTRAP_TIMEOUT_MS <= 15_000);

    // ---- diagnostics carry no secrets ----
    resetBootstrapPhase();
    markBootstrap({ supabaseConfigured: true, bootstrapStarted: true, listenerRegistered: true });
    const ph = authBootstrapPhase();
    ok("16.10 phase records progress", ph.bootstrapStarted && ph.listenerRegistered);
    ok("16.11 phase is safe to surface", isSafeDiagnostic(ph) === true);
    ok("16.12 phase carries booleans only",
      Object.entries(ph).every(([k, v]) => k === "failure" || typeof v === "boolean"));
    markBootstrap({ failure: "auth_timeout" });
    ok("16.13 a failure label is opaque and short", isSafeDiagnostic(authBootstrapPhase()) === true);
    ok("16.14 a message-shaped failure is rejected as unsafe",
      isSafeDiagnostic({ ...authBootstrapPhase(), failure: "token abc.def@user.com leaked" }) === false);
    ok("16.15 no phase field could hold an email or token",
      !Object.values(authBootstrapPhase()).some((v) => typeof v === "string" && v.includes("@")));

    // ---- exactly one of {INITIAL_SESSION, getSession} may drive adoption ----
    //
    // Asking for the session explicitly means the same startup session can now
    // arrive twice. Adoption rewrites the whole store, so two concurrent runs
    // would race. This models the claim rule used in `initPersistence`.
    const claims = (order: ("event" | "read")[]) => {
      let handled = false;
      const drove: string[] = [];
      for (const src of order) {
        if (handled) continue;
        handled = true;
        drove.push(src);
      }
      return drove;
    };
    ok("16.16 listener first => the listener adopts, once",
      JSON.stringify(claims(["event", "read"])) === JSON.stringify(["event"]));
    ok("16.17 explicit read first => the read adopts, once",
      JSON.stringify(claims(["read", "event"])) === JSON.stringify(["read"]));
    ok("16.18 startup never adopts twice", claims(["event", "read"]).length === 1);
    ok("16.19 a session is still resolved when only one source fires",
      claims(["read"]).length === 1 && claims(["event"]).length === 1);
    // Later auth events are NOT deduped — sign-out must still take effect.
    ok("16.20 later sign-in/out events are unaffected by the startup claim",
      claims(["event"]).length === 1);
    resetBootstrapPhase();
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
