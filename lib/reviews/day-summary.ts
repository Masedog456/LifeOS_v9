/**
 * Deterministic day summary (LIFEOS-034, Feature 2).
 *
 * A pure projection over `StoreState` for a single LOCAL calendar date. It
 * reports WHAT happened — counts plus the underlying source records — and infers
 * no meaning. Every item links back to its source record or activity event so
 * the UI can navigate to it. Nothing here writes, and viewing it changes
 * nothing.
 *
 * Determinism: pass `offsetMinutes` (minutes east of UTC) to match days at a
 * fixed offset independent of the host timezone (used by the self-tests and for
 * explicit timezone handling); omit it to use the machine-local timezone.
 * Live-only signals (unresolved conflicts, unsynced changes) are not derivable
 * from `StoreState`, so callers pass them in via `live`.
 */

import type { StoreState } from "@/types/mvp";
import { isoOnLocalDay, isoOnDayAtOffset, type DayKey } from "@/lib/reviews/dates";

export interface DaySummaryItem {
  kind: string;
  id: string;
  label: string;
  at: string;
  detail?: string;
}
export interface DaySummaryGroup {
  key: string;
  label: string;
  count: number;
  items: DaySummaryItem[];
}
export interface DaySummaryLive {
  unresolvedConflicts?: number;
  syncFailed?: boolean;
  unsyncedPending?: boolean;
}
export interface DaySummary {
  date: DayKey;
  groups: DaySummaryGroup[];
  sessionCount: number;
  totalSessionMs: number;
  live: Required<DaySummaryLive>;
}

const snip = (s: string | undefined, n = 70): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

/** Format a duration in ms as a compact "1h 20m" / "45m" / "0m". */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export interface DaySummaryOptions { offsetMinutes?: number; live?: DaySummaryLive }

/**
 * Build the deterministic summary for `date`. Groups are always present (empty
 * groups are dropped) and ordered for a stable, readable review.
 */
export function buildDaySummary(state: StoreState, date: DayKey, opts: DaySummaryOptions = {}): DaySummary {
  const onDay = (iso: string | undefined): boolean =>
    opts.offsetMinutes === undefined ? isoOnLocalDay(iso, date) : isoOnDayAtOffset(iso, date, opts.offsetMinutes);

  const groups: DaySummaryGroup[] = [];
  const push = (key: string, label: string, items: DaySummaryItem[]) => {
    if (items.length) groups.push({ key, label, count: items.length, items: items.sort((a, b) => (a.at || "").localeCompare(b.at || "")) });
  };

  // --- Sessions ---
  const sessions = state.sessions ?? [];
  const startedToday = sessions.filter((s) => onDay(s.startedAt));
  const endedToday = sessions.filter((s) => onDay(s.endedAt));
  let totalSessionMs = 0;
  for (const s of startedToday) {
    const end = s.endedAt ? Date.parse(s.endedAt) : Date.now();
    const start = Date.parse(s.startedAt);
    if (!Number.isNaN(start) && end > start) totalSessionMs += end - start;
  }
  push("sessions_started", "Sessions started", startedToday.map((s) => ({ kind: "session", id: s.id, label: s.goal || `${s.type} session`, at: s.startedAt, detail: s.type })));
  push("sessions_ended", "Sessions ended", endedToday.map((s) => ({ kind: "session", id: s.id, label: s.goal || `${s.type} session`, at: s.endedAt!, detail: s.type })));

  // Workspaces used / goals touched / projects advanced (via today's sessions).
  const wsUsed = new Map<string, string>();
  const goalsTouched = new Set<string>();
  const projectsTouched = new Set<string>();
  for (const s of startedToday) {
    if (s.workspaceId) wsUsed.set(s.workspaceId, s.workspaceId);
    if (s.goalId) goalsTouched.add(s.goalId);
    if (s.projectId) projectsTouched.add(s.projectId);
  }
  push("workspaces_used", "Workspaces used", [...wsUsed.keys()].map((id) => {
    const w = (state.workspaces ?? []).find((x) => x.id === id);
    return { kind: "workspace", id, label: w?.name ?? "Workspace", at: date };
  }));
  push("goals_touched", "Goals touched", [...goalsTouched].map((id) => {
    const g = (state.goals ?? []).find((x) => x.id === id);
    return { kind: "goal", id, label: g?.title ?? "Goal", at: date };
  }));

  // --- Milestones completed today (also count their projects as advanced) ---
  const milestonesDone: DaySummaryItem[] = [];
  for (const p of state.projects ?? []) {
    for (const m of p.milestones ?? []) {
      if (m.status === "done" && onDay(m.completedDate)) {
        milestonesDone.push({ kind: "milestone", id: m.id, label: m.title, at: m.completedDate!, detail: p.title });
        projectsTouched.add(p.id);
      }
    }
  }
  push("projects_advanced", "Projects advanced", [...projectsTouched].map((id) => {
    const p = (state.projects ?? []).find((x) => x.id === id);
    return { kind: "project", id, label: p?.title ?? "Project", at: date };
  }));
  push("milestones_completed", "Milestones completed", milestonesDone);

  // --- Reading: highlights / annotations / documents opened ---
  const highlights: DaySummaryItem[] = [];
  const annotations: DaySummaryItem[] = [];
  const docsRead = new Map<string, string>();
  for (const d of state.documents ?? []) {
    if (onDay(d.progress?.lastOpenedAt)) docsRead.set(d.id, d.title);
    for (const sec of d.sections ?? []) for (const p of sec.passages ?? []) {
      for (const h of p.highlights ?? []) if (onDay(h.createdAt)) { highlights.push({ kind: "highlight", id: h.id, label: snip(h.text, 60), at: h.createdAt, detail: d.title }); docsRead.set(d.id, d.title); }
      for (const a of p.annotations ?? []) if (onDay(a.createdAt)) { annotations.push({ kind: "annotation", id: a.id, label: snip(a.text, 60), at: a.createdAt, detail: d.title }); docsRead.set(d.id, d.title); }
    }
  }
  push("documents_read", "Documents read", [...docsRead.entries()].map(([id, title]) => ({ kind: "document", id, label: title, at: date })));
  push("highlights_created", "Highlights created", highlights);
  push("annotations_created", "Annotations created", annotations);

  // --- Captures / decisions / beliefs ---
  push("captures_created", "Captures created", (state.captures ?? []).filter((c) => onDay(c.createdAt)).map((c) => ({ kind: "capture", id: c.id, label: snip(c.workingText ?? c.text), at: c.createdAt })));
  push("captures_processed", "Captures processed", (state.captures ?? []).filter((c) => onDay(c.processedAt)).map((c) => ({ kind: "capture", id: c.id, label: snip(c.workingText ?? c.text), at: c.processedAt! })));
  // Next actions (LIFEOS-036): created / started / completed / deferred today.
  const actionEventAt = (a: { history: { action: string; at: string }[] }, kind: string) => a.history.filter((e) => e.action === kind && onDay(e.at)).map((e) => e.at)[0];
  push("actions_created", "Actions created", (state.nextActions ?? []).filter((a) => onDay(a.createdAt)).map((a) => ({ kind: "action", id: a.id, label: snip(a.title), at: a.createdAt })));
  push("actions_started", "Actions started", (state.nextActions ?? []).filter((a) => !!actionEventAt(a, "started")).map((a) => ({ kind: "action", id: a.id, label: snip(a.title), at: actionEventAt(a, "started")! })));
  push("actions_completed", "Actions completed", (state.nextActions ?? []).filter((a) => onDay(a.completedAt)).map((a) => ({ kind: "action", id: a.id, label: snip(a.title), at: a.completedAt! })));
  push("actions_deferred", "Actions deferred", (state.nextActions ?? []).filter((a) => !!actionEventAt(a, "deferred")).map((a) => ({ kind: "action", id: a.id, label: snip(a.title), at: actionEventAt(a, "deferred")! })));
  push("decisions", "Decisions created or updated", (state.decisions ?? []).filter((d) => onDay(d.createdAt) || onDay(d.updatedAt)).map((d) => ({ kind: "decision", id: d.id, label: snip((d as { title?: string; question?: string }).title || (d as { question?: string }).question), at: (onDay(d.updatedAt) ? d.updatedAt : d.createdAt) })));
  const beliefsRevised: DaySummaryItem[] = [];
  for (const b of state.beliefs ?? []) {
    const revs = (b as { revisions?: { at?: string }[] }).revisions ?? [];
    const revToday = revs.some((r) => onDay(r.at));
    if (revToday || (onDay(b.updatedAt) && b.updatedAt !== b.createdAt)) beliefsRevised.push({ kind: "belief", id: b.id, label: snip(b.text), at: b.updatedAt });
  }
  push("beliefs_revised", "Beliefs revised", beliefsRevised);

  // --- Session-activity derived: entities inspected & searches performed ---
  const inspected: DaySummaryItem[] = [];
  const searches: DaySummaryItem[] = [];
  for (const s of sessions) for (const e of s.activity ?? []) {
    if (!onDay(e.at)) continue;
    if (e.type === "opened_entity" || e.type === "inspector") inspected.push({ kind: e.entityKind || "entity", id: e.entityId || e.id, label: snip(e.label, 60), at: e.at });
    else if (e.type === "search") searches.push({ kind: "search", id: e.id, label: snip(e.label, 60), at: e.at });
  }
  push("entities_inspected", "Entities inspected", inspected);
  push("searches", "Searches performed", searches);

  const live = {
    unresolvedConflicts: opts.live?.unresolvedConflicts ?? 0,
    syncFailed: opts.live?.syncFailed ?? false,
    unsyncedPending: opts.live?.unsyncedPending ?? false,
  };

  return { date, groups, sessionCount: startedToday.length, totalSessionMs, live };
}

/** The total number of activity items across all groups (headline count). */
export function daySummaryTotal(summary: DaySummary): number {
  return summary.groups.reduce((n, g) => n + g.count, 0);
}
