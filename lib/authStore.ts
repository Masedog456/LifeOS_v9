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
import { clearInterviewSession } from "@/lib/interview/session";
import { clearEvidence } from "@/lib/beta/store";
import { clearFeedback } from "@/lib/beta/feedback";

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

/**
 * Sign out, and end any in-progress Constitution Builder interview (LIFEOS-058A).
 *
 * ## Why the cleanup lives HERE and not in the auth listener
 *
 * This function has exactly one caller: the "Sign out" button's click handler.
 * It is unreachable from `INITIAL_SESSION`, from a bootstrap timeout, from a
 * provider error, and from simply loading the app signed out — all of which
 * surface as `handleSession(null)` in the persistence facade. Hooking the
 * cleanup there would have deleted a signed-out user's interview the moment
 * their own app finished loading.
 *
 * So the seam is the ACTION, not the resulting state: only a person pressing
 * "Sign out" gets here, and it happens exactly once per press.
 *
 * ## Why only the interview key
 *
 * Ordinary Conqify local data deliberately survives sign-out — the product is
 * local-first, and `handleSession(null)` says so in as many words. That is
 * unchanged. An in-progress interview is the one exception, because it holds
 * unfinished answers about faith, health, money and family that the user was
 * promised would not outlive the session, and because it is scaffolding rather
 * than a record they chose to keep. Anything they DID choose to keep — an
 * adopted element, a draft, a saved Note — is ordinary local data and stays.
 *
 * ## Why the cleanup runs first
 *
 * A privacy action must not be contingent on a network round-trip. If the
 * provider call throws or hangs, the answers are already gone; the alternative
 * ordering would leave them on a shared machine precisely when sign-out failed.
 */
export async function signOut(): Promise<void> {
  clearInterviewSession();
  // The beta disclosure says signing out deletes the beta record too. Same
  // reasoning as the interview session, and the same clear-first ordering: a
  // privacy promise must not depend on a network call succeeding.
  clearEvidence();
  clearFeedback();
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
}
