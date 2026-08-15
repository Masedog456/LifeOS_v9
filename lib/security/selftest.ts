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

export function runSecuritySelfTests(): SelfTestReport {
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
  ok("5.1 compatible → ok+sync", (() => { const r = evaluateCompatibility({ localStateVersion: 1, remoteMigrationVersion: 34 }); return r.mode === "ok" && syncIsSafe(r); })());
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

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
