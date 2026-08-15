/**
 * Reactive auth UI state (LIFEOS-004.1).
 *
 * LifeOS uses durable EMAIL identity for remote sync (magic link / OTP).
 * Anonymous auth is intentionally not used for remote persistence: we never
 * sync private data until a permanent, email-verified account exists. Before
 * that, the app runs fully in local-only mode.
 *
 * This module holds only the UI-facing auth state + the sign-in/out actions.
 * The persistence facade owns the auth *listener* and calls applySession().
 */

import { useSyncExternalStore } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { isClosedBetaRefusal, closedBetaRefusal } from "@/lib/security/auth-boundaries";

export type AuthPhase = "idle" | "sending" | "sent" | "error";

export interface AuthState {
  /** Supabase is configured (remote sync is possible with sign-in). */
  configured: boolean;
  /** Still resolving the initial session. */
  loading: boolean;
  /** The signed-in user's email, or null when signed out. */
  email: string | null;
  /** Transient state of a magic-link request. */
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
  loading: configured, // if unconfigured we already know: local-only
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

// ---- called by the persistence facade ----

export function setUnconfigured(): void {
  set({ configured: false, loading: false });
}
export function setConfigured(): void {
  set({ configured: true });
}
export function applySession(session: { user?: { email?: string | null } } | null): void {
  set({ loading: false, email: session?.user?.email ?? null, phase: "idle", error: undefined });
}

// ---- user actions ----

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
      // Closed beta: signing in must NEVER create an account. Supabase defaults
      // this to `true`, which quietly turned every magic-link request from an
      // unknown address into a self-registration — the invited-user model was a
      // promise in CLOSED_BETA.md that nothing enforced (LIFEOS-050C). Testers
      // are pre-created by the founder in the Supabase dashboard; this option is
      // the client-side half of that control, and the dashboard's "allow new
      // users to sign up" setting is the half that holds even if a client is
      // bypassed. See BETA_RUNBOOK.md §5.
      shouldCreateUser: false,
    },
  });
  if (error) {
    set({ phase: "error", error: isClosedBetaRefusal(error.code) ? closedBetaRefusal() : error.message });
  } else set({ phase: "sent" });
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
  // The auth listener (in the persistence facade) handles teardown:
  // remote sync stops, local data is kept as fallback.
}
