/**
 * Lightweight per-user preferences (LIFEOS-025) — currently onboarding state.
 *
 * Local-first like everything else: preferences live in their own localStorage
 * key (NOT inside the domain-state blob, so clearing prefs never touches
 * knowledge and vice versa). When Supabase is configured and the user is signed
 * in, the same values are mirrored to the own-rows `user_prefs` table
 * (migration 0020) so onboarding state follows the user across devices.
 * Mirroring is best-effort — a failed upsert never blocks the UI.
 */

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

const PREFS_KEY = "lifeos.prefs.v1";

/** A stored reference to a record (recent history / pinning). Never a copy. */
export interface RecordRef {
  kind: string;
  id: string;
  title: string;
  at: string; // ISO
}

export interface Prefs {
  /** "done" | "skipped" | undefined (never started). */
  onboarding?: "done" | "skipped";
  /** Which onboarding step the user is on (resume support). */
  onboardingStep?: number;
  /**
   * Recently-viewed records (LIFEOS-027). Most-recent-first, capped, deduped by
   * kind+id. Titles are a convenience cache — the live title is re-resolved
   * from the store on read so renames/deletions are handled gracefully. Stored
   * here (not in the domain blob) and mirrored to `user_prefs` when signed in,
   * so it is per-user and needs no schema migration.
   */
  recent?: RecordRef[];
  /** Pinned/favorite records (LIFEOS-027). Same storage + reconciliation model. */
  pinned?: RecordRef[];
  /**
   * Unified inspector navigation memory (LIFEOS-029): the last-viewed entity,
   * the open tab, which sections are expanded, and the panel scroll position —
   * so the workspace resumes where the user left off across sessions.
   */
  inspector?: {
    last?: { kind: string; id: string };
    tab?: string;
    expanded?: Record<string, boolean>;
    scroll?: number;
  };
  /**
   * Workspace navigation memory (LIFEOS-030): the current workspace pointer plus
   * recently-visited and pinned workspace ids. UI memory only (which workspace
   * am I in), so it lives in prefs and follows the user across devices — the
   * workspace RECORDS themselves are durable domain data in the store/DB.
   */
  workspace?: {
    current?: string;
    recent?: string[];
    pinned?: string[];
  };
}

export function readPrefs(): Prefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function writePrefs(patch: Partial<Prefs>): void {
  if (typeof window === "undefined") return;
  const next = { ...readPrefs(), ...patch };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Preferences are non-critical; never crash on quota.
  }
  void mirrorRemote(next);
}

/** Best-effort mirror to the `user_prefs` table when signed in (cross-device). */
async function mirrorRemote(prefs: Prefs): Promise<void> {
  try {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (!data.session) return;
    await client.from("user_prefs").upsert({ key: "prefs", value: prefs });
  } catch {
    // Never let a prefs mirror failure surface as an app error.
  }
}

/** Pull remotely-stored prefs once signed in (called opportunistically). */
export async function adoptRemotePrefs(): Promise<void> {
  try {
    if (!isSupabaseConfigured() || typeof window === "undefined") return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data: s } = await client.auth.getSession();
    if (!s.session) return;
    const { data } = await client.from("user_prefs").select("value").eq("key", "prefs").maybeSingle();
    if (data?.value && typeof data.value === "object") {
      const merged = { ...(data.value as Prefs), ...readPrefs() };
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    }
  } catch {
    // Best-effort only.
  }
}

export function isOnboardingDone(): boolean {
  const p = readPrefs();
  return p.onboarding === "done" || p.onboarding === "skipped";
}

export function completeOnboarding(mode: "done" | "skipped"): void {
  writePrefs({ onboarding: mode, onboardingStep: undefined });
}

/** Restart the tour: forget completion so /welcome runs again. */
export function restartOnboarding(): void {
  writePrefs({ onboarding: undefined, onboardingStep: 0 });
}
