/**
 * Corruption isolation & recovery mode (LIFEOS-033, Feature 10).
 *
 * During hydration a single malformed row must never crash the whole app. Each
 * domain is validated record-by-record: recoverable records are kept, malformed
 * ones are ISOLATED (skipped, counted, and reported in diagnostics) — never
 * silently deleted from the source. If a domain is so broken it can't be read at
 * all, the app can enter a read-only "recovery mode" that still lets the user
 * export a raw backup before repair. Pure and deterministic.
 */

export interface DomainRecovery { domain: string; kept: number; skipped: number; skippedIds: string[] }
export interface RecoveryReport {
  domains: DomainRecovery[];
  totalSkipped: number;
  recoveryMode: boolean;
  at: string;
}

/** A record is minimally valid if it is an object with a non-empty string id. */
export function isValidRecord(r: unknown): r is { id: string } {
  return !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && (r as { id: string }).id.length > 0;
}

/**
 * Isolate malformed records in one domain. Returns the valid records plus a
 * per-domain recovery summary. A custom `validate` can add domain-specific
 * checks; it must never throw (wrapped defensively).
 */
export function isolateDomain<T extends { id: string }>(domain: string, raw: unknown, validate?: (r: T) => boolean): { valid: T[]; recovery: DomainRecovery } {
  const kept: T[] = [];
  const skippedIds: string[] = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    let ok = isValidRecord(r);
    if (ok && validate) { try { ok = validate(r as T); } catch { ok = false; } }
    if (ok) kept.push(r as T);
    else skippedIds.push(isValidRecord(r) ? r.id : `#${i}`);
  }
  return { valid: kept, recovery: { domain, kept: kept.length, skipped: skippedIds.length, skippedIds } };
}

/** Whether a set of domain recoveries indicates the app should enter recovery mode. */
export function shouldEnterRecoveryMode(recoveries: DomainRecovery[], threshold = 0.5): boolean {
  for (const d of recoveries) {
    const total = d.kept + d.skipped;
    if (total > 0 && d.skipped / total >= threshold && d.skipped >= 3) return true;
  }
  return false;
}

export function buildRecoveryReport(recoveries: DomainRecovery[], at: string): RecoveryReport {
  const meaningful = recoveries.filter((d) => d.skipped > 0);
  return {
    domains: meaningful,
    totalSkipped: meaningful.reduce((n, d) => n + d.skipped, 0),
    recoveryMode: shouldEnterRecoveryMode(recoveries),
    at,
  };
}

// ---- last recovery event (metadata only; for diagnostics) ----
const KEY = "lifeos.sync.recovery.v1";
export function recordRecoveryEvent(report: RecoveryReport): void {
  if (typeof window === "undefined" || report.totalSkipped === 0) return;
  try { window.localStorage.setItem(KEY, JSON.stringify({ at: report.at, totalSkipped: report.totalSkipped, domains: report.domains.map((d) => ({ domain: d.domain, skipped: d.skipped })), recoveryMode: report.recoveryMode })); }
  catch { /* non-critical */ }
}
export function lastRecoveryEvent(): { at: string; totalSkipped: number; recoveryMode: boolean } | null {
  if (typeof window === "undefined") return null;
  try { const raw = window.localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
