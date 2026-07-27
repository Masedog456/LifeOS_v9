/**
 * Unsaved-changes / dirty-form protection (LIFEOS-032, Feature 2).
 *
 * Deterministic dirty detection plus a tiny registry so the app can warn before
 * navigating away, closing a modal, switching workspace/project, or reloading —
 * but ONLY when real unsaved changes exist. `isDirty` is a pure structural
 * comparison of a form's initial vs. current snapshot. Forms register their dirty
 * state; `anyDirty()` and the `beforeunload` guard read the registry. A
 * successful save clears the flag, so navigation is never blocked afterwards. No
 * second state library — a small module store like the others.
 */

import { useEffect } from "react";

/** Pure structural equality via canonical JSON (order-independent for objects). */
function canonical(v: unknown): string {
  const seen = new WeakSet();
  const norm = (x: unknown): unknown => {
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x as object)) return null;
    seen.add(x as object);
    if (Array.isArray(x)) return x.map(norm);
    const obj = x as Record<string, unknown>;
    return Object.keys(obj).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = norm(obj[k]); return acc; }, {});
  };
  return JSON.stringify(norm(v));
}

/** Whether `current` differs from `initial` (deterministic; whitespace-trimmed strings). */
export function isDirty(initial: unknown, current: unknown): boolean {
  return canonical(initial) !== canonical(current);
}

/** Trim + collapse so trailing whitespace in a text field isn't "dirty". */
export function normalizeText(s: string): string {
  return s.replace(/\s+$/g, "");
}

// ---- registry ----
const dirtyIds = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setDirty(id: string, dirty: boolean): void {
  const had = dirtyIds.has(id);
  if (dirty && !had) { dirtyIds.add(id); emit(); }
  else if (!dirty && had) { dirtyIds.delete(id); emit(); }
}
export function clearDirty(id: string): void { setDirty(id, false); }
export function anyDirty(): boolean { return dirtyIds.size > 0; }
export function dirtyCount(): number { return dirtyIds.size; }
export function subscribeDirty(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

/**
 * React hook: keep a form's dirty flag registered and install a `beforeunload`
 * guard while dirty. Unregisters on unmount (and after a save clears `dirty`).
 * The message is browser-controlled; returning a string arms the native prompt.
 */
export function useUnsavedGuard(id: string, dirty: boolean): void {
  useEffect(() => {
    setDirty(id, dirty);
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("beforeunload", handler);
    return () => { window.removeEventListener("beforeunload", handler); };
  }, [id, dirty]);
  useEffect(() => () => { clearDirty(id); }, [id]);
}
