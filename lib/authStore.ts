/**
 * Reactive auth UI state.
 *
 * Conqify uses durable EMAIL identity for remote sync (magic link / OTP).
 * Anonymous auth is intentionally not used for remote persistence: we never
 * sync private data until a permanent, email-verified account exists. Before
 * that, the app runs fully in local-only mode.
 *
 * This module holds only the UI-facing auth state + the sign-in/out actions.
 * The persistence facade owns the auth listener and calls applySession().
 */

import { useSyncExternalStore } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export type AuthPhase = "idle" | "sending" | "sent" | "error";

export interface AuthState {
  configured: boolean;
  loading: boolean;
  email: string | null;
  phase: AuthPhase;
  error?: string;
}

const SERVER_SNAPSHOT: AuthState = {
  configured: false,
  loading: true,
  email: null,
  phase: "idle",
};

const configured = isSupabaseConfigured();
let state: AuthState = {
  configured,
  loading: configured,
  email: null,
  phase: "idle",
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  emit();
}

export function subscribeAuth(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function getAuth(): AuthState {
  return state;
}
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribeAuth, getAuth, () => SERVER_SNAPSHOT);
}

export function setUnconfigured(): void {
  set({ configured: false, loading: false });
}
export function setConfigured(): void {
  set({ configured: true });
}
/**
 * End the loading state WITHOUT claiming to know the session (LIFEOS-055U).
 *
 * Before this existed, `applySession` was the only thing that could clear
 * `loading` in the configured path — and it was reachable only from the
 * `onAuthStateChange` callback. If that event was slow or never arrived, the app
 * sat in `loading: true` forever, rendering neither the sign-in control nor an
 * error. A user saw an empty header and no way in.
 *
 * The UI treats this as "signed out, and we had trouble checking" — the sign-in
 * control renders, so the person can always act, and `error` says why the check
 * did not complete.
 */
export function setAuthUnavailable(message: string): void {
  set({ loading: false, email: null, phase: "idle", error: message });
}

export function applySession(session: { user?: { email?: string | null } } | null): void {
  set({ loading: false, email: session?.user?.email ?? null, phase: "idle", error: undefined });
}

export async function signInWithEmail(email: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const trimmed = email.trim();
  if (!trimmed) return;
  set({ phase: "sending", error: undefined });
  const emailRedirectTo =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo,
      // Public Early Access: a verified email may create an account through the
      // same passwordless flow used for returning users. Anonymous auth remains
      // disabled, so remote sync still begins only after durable email identity.
      shouldCreateUser: true,
    },
  });
  if (error) {
    set({ phase: "error", error: error.message });
  } else set({ phase: "sent" });
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}
