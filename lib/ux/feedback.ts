/**
 * Shared feedback (toast) system (LIFEOS-032, Feature 4).
 *
 * ONE deterministic, client-only toast store — a tiny module-level reactive
 * store (like the inspector store) surfaced via `useSyncExternalStore`. Any
 * component or store action calls `toast(...)`; the `ToastProvider` renders the
 * queue with a polite live region. Deduplication keeps trivial repeats quiet
 * (the same message within a short window refreshes the existing toast instead of
 * stacking). Optional `action` (e.g. Undo) is a callback — safe because toasts
 * never persist or serialize. No analytics, no network.
 */

import { useSyncExternalStore } from "react";

export type ToastKind = "success" | "warning" | "error" | "info" | "offline" | "syncing";

export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  detail?: string;
  at: number;
  /** Milliseconds until auto-dismiss; 0 = sticky (errors/offline). */
  duration: number;
  action?: ToastAction;
  /** Stable key used for dedup; defaults to `${kind}:${message}`. */
  dedupeKey: string;
}

export interface ToastInput {
  kind?: ToastKind;
  message: string;
  detail?: string;
  duration?: number;
  action?: ToastAction;
  dedupeKey?: string;
}

const DEDUPE_WINDOW_MS = 4000;
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3500, info: 4000, warning: 6000, syncing: 0, offline: 0, error: 0,
};

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Whether a candidate should be emitted as a NEW toast given the current queue.
 * Pure and deterministic — a duplicate `dedupeKey` seen inside the window is
 * suppressed (the caller refreshes the existing one instead). Exposed for tests.
 */
export function shouldEmit(existing: Toast[], dedupeKey: string, atMs: number): boolean {
  const prior = existing.find((t) => t.dedupeKey === dedupeKey);
  if (!prior) return true;
  return atMs - prior.at > DEDUPE_WINDOW_MS;
}

function nextId(): string {
  seq += 1;
  return `toast-${seq}`;
}

/** Queue a toast (deduped). Returns the toast id (existing one when deduped). */
export function toast(input: ToastInput): string {
  const kind = input.kind ?? "info";
  const dedupeKey = input.dedupeKey ?? `${kind}:${input.message}`;
  const at = Date.now();
  if (!shouldEmit(toasts, dedupeKey, at)) {
    // Refresh the existing toast's timestamp/detail rather than stack a repeat.
    const prior = toasts.find((t) => t.dedupeKey === dedupeKey);
    if (prior) { prior.at = at; if (input.detail) prior.detail = input.detail; emit(); return prior.id; }
  }
  const t: Toast = {
    id: nextId(), kind, message: input.message, detail: input.detail, at,
    duration: input.duration ?? DEFAULT_DURATION[kind], action: input.action, dedupeKey,
  };
  toasts = [...toasts.filter((x) => x.dedupeKey !== dedupeKey), t];
  emit();
  return t.id;
}

/** Convenience helpers. */
export const toastSuccess = (message: string, detail?: string) => toast({ kind: "success", message, detail });
export const toastError = (message: string, detail?: string) => toast({ kind: "error", message, detail });
export const toastWarning = (message: string, detail?: string) => toast({ kind: "warning", message, detail });

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function clearToasts(): void {
  toasts = [];
  emit();
}

// ---- React binding ----
function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function snapshot(): Toast[] { return toasts; }
const SERVER: Toast[] = [];
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
