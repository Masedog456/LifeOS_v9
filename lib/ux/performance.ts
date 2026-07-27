/**
 * Performance budget helpers (LIFEOS-032, Feature 12).
 *
 * Tiny deterministic timing utilities used by the self-tests to measure realistic
 * large-state behavior (hydration, search, dashboard derivation, backup/restore)
 * and assert against a budget. No analytics — these run only in tests / the dev
 * diagnostics page and report nothing anywhere.
 */

export interface Measurement { label: string; ms: number }

/** Time a synchronous function; returns its result and elapsed ms. */
export function measure<T>(label: string, fn: () => T): { label: string; ms: number; result: T } {
  const t0 = Date.now();
  const result = fn();
  return { label, ms: Date.now() - t0, result };
}

export interface BudgetResult { label: string; ms: number; budgetMs: number; pass: boolean }

/** Run a function and check it completes under a budget (ms). */
export function budget(label: string, budgetMs: number, fn: () => void): BudgetResult {
  const { ms } = measure(label, fn);
  return { label, ms, budgetMs, pass: ms <= budgetMs };
}
