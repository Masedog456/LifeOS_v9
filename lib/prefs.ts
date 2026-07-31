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
   * Capture-processing queue memory (LIFEOS-035, Feature 18): the selected view,
   * sort, filters, active capture, scroll, and desktop split-pane width — so the
   * inbox resumes safely after reload. UI preferences only (no record content).
   */
  inbox?: {
    view?: string;
    sort?: string;
    filter?: { text?: string; tags?: string[]; sourceId?: string; workspaceId?: string; goalId?: string; projectId?: string; linked?: "linked" | "unlinked"; minAgeDays?: number };
    activeCaptureId?: string;
    scroll?: number;
    paneWidth?: number;
  };
  /**
   * Action-queue navigation memory (LIFEOS-036, Feature 21): the selected view,
   * sort, filters, active action, scroll, split-pane width, and collapsed groups
   * — so the action queue resumes safely after reload. UI preferences only.
   */
  actions?: {
    view?: string;
    sort?: string;
    filter?: Record<string, unknown>;
    activeActionId?: string;
    scroll?: number;
    paneWidth?: number;
    collapsed?: Record<string, boolean>;
  };
  /**
   * Planning & focus preferences (LIFEOS-037, Feature 20): default board
   * filters, collapsed groups, column widths, mobile view, per-focus-target-kind
   * visible panels, capacity soft limits, selected planning view, and sort mode.
   * UI preferences only — no ephemeral dialog/hover state.
   */
  planning?: {
    view?: string;
    sort?: string;
    filter?: Record<string, unknown>;
    collapsed?: Record<string, boolean>;
    columnWidths?: Record<string, number>;
    mobileView?: boolean;
    /** Visible focus panels remembered per focus-target kind. */
    focusPanels?: Record<string, Record<string, boolean>>;
    /** Soft capacity limits per category (0/undefined = no limit). */
    capacityLimits?: Record<string, number>;
  };
  /**
   * Knowledge-maintenance preferences (LIFEOS-038, Feature 17): review-queue
   * filters, sort, dashboard layout, dismissed review-item ids, and a fast
   * mirror of ignored duplicate ids. UI/decision memory only — the durable
   * maintenance record (events, duplicate decisions) lives in the store.
   * `dismissed` and `ignoredDuplicateIds` union across devices on sync.
   */
  maintenance?: {
    view?: string;
    sort?: string;
    filter?: Record<string, unknown>;
    layout?: Record<string, boolean>;
    /** Review-queue item ids the user hid (derived items with no durable record). */
    dismissed?: string[];
    /** Fast mirror of duplicate-candidate ids the user chose to ignore. */
    ignoredDuplicateIds?: string[];
  };
  /**
   * Deterministic-insights preferences (LIFEOS-039, Feature 27): the last
   * selected range (preset + custom keys), the active grouping, the dormancy
   * threshold in days, and whether the metric-definitions drawer is open. UI
   * memory only — saved views are durable records in the store.
   */
  insights?: {
    rangeKind?: string;
    customStart?: string;
    customEnd?: string;
    grouping?: string;
    dormancyDays?: number;
    /** Whether the definitions drawer is expanded. */
    definitionsOpen?: boolean;
  };
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
  /**
   * Execution navigation memory (LIFEOS-031): the current goal/project pointers
   * plus recently-visited ids for the selector and command center. UI memory
   * only — goals/projects themselves are durable domain data in the store/DB.
   */
  execution?: {
    currentGoal?: string;
    currentProject?: string;
    recentGoals?: string[];
    recentProjects?: string[];
  };
  /**
   * First-run checklist state (LIFEOS-032): dismissal + a couple of "did an
   * action once" flags that can't be derived from domain state (opened the
   * command center, inspected a relationship). Everything else is derived.
   */
  firstRun?: {
    dismissed?: boolean;
    commandOpened?: boolean;
    inspected?: boolean;
  };
  /**
   * Restrained UI preferences (LIFEOS-041, Feature 35). Bounded personalization
   * that never alters domain content: density, inspector default, collapsed nav,
   * reduced motion, content width, default insight range, default capture
   * destination. Scalar fields; latest-write wins per the blob but differences
   * are surfaced (mergeUiPreferences), never silently overridden.
   */
  ui?: {
    density?: "compact" | "comfortable" | "spacious";
    inspectorDefault?: "open" | "closed";
    navCollapsed?: boolean;
    reducedMotion?: boolean;
    contentWidth?: "reading" | "standard" | "wide";
    defaultInsightRange?: string;
    defaultCaptureDestination?: string;
  };
  /**
   * First-run onboarding v2 (LIFEOS-041, Feature 37). Versioned; completed +
   * skipped steps UNION across devices unless a later explicit reset exists.
   * Shape mirrors lib/onboarding/state.ts OnboardingState.
   */
  onboardingV2?: {
    version: number;
    status: "not-started" | "in-progress" | "completed" | "skipped";
    completedSteps: string[];
    skippedSteps: string[];
    resetCounter: number;
    currentStep?: string;
    updatedAt: string;
    sampleWorkspaceId?: string;
  };
  /** Dismissed contextual-education lesson ids (LIFEOS-041, Feature 11). Union across devices. */
  education?: { dismissed?: string[] };
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
      const remote = data.value as Prefs;
      const local = readPrefs();
      // Most fields: local wins (this device's live state). But onboarding and
      // dismissed-education must UNION across devices (LIFEOS-041 sync rules), so
      // completing a step or dismissing a lesson on one device is never lost.
      const merged: Prefs = { ...remote, ...local };
      if (remote.onboardingV2 && local.onboardingV2) merged.onboardingV2 = mergeOnboardingBlocks(local.onboardingV2, remote.onboardingV2);
      else merged.onboardingV2 = local.onboardingV2 ?? remote.onboardingV2;
      const dl = local.education?.dismissed ?? [], dr = remote.education?.dismissed ?? [];
      if (dl.length || dr.length) merged.education = { dismissed: [...new Set([...dl, ...dr])] };
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    }
  } catch {
    // Best-effort only.
  }
}

/**
 * Union two onboarding blocks across devices (LIFEOS-041 sync rule). A later
 * explicit reset (higher resetCounter) wins; same generation unions completed +
 * skipped steps. Inlined here to avoid an import cycle with lib/onboarding.
 */
function mergeOnboardingBlocks(a: NonNullable<Prefs["onboardingV2"]>, b: NonNullable<Prefs["onboardingV2"]>): NonNullable<Prefs["onboardingV2"]> {
  if (a.resetCounter !== b.resetCounter) return a.resetCounter > b.resetCounter ? a : b;
  const uniq = (x: string[] = [], y: string[] = []) => [...new Set([...x, ...y])];
  const completedSteps = uniq(a.completedSteps, b.completedSteps);
  const skippedSteps = uniq(a.skippedSteps, b.skippedSteps).filter((s) => !completedSteps.includes(s));
  const status = a.status === "completed" || b.status === "completed" ? "completed"
    : completedSteps.length + skippedSteps.length > 0 ? "in-progress"
    : a.status === "skipped" || b.status === "skipped" ? "skipped" : "not-started";
  const latest = (a.updatedAt ?? "") >= (b.updatedAt ?? "") ? a : b;
  return { ...latest, status, completedSteps, skippedSteps, resetCounter: a.resetCounter };
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
