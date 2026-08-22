/**
 * Week in Review — an autobiographical projection over recorded life
 * (LIFEOS-064 §1, §2, §5, §6).
 *
 * ## Stored information is not autobiographical memory
 *
 * The store knows a hundred things. What it has never been able to say is what
 * HAPPENED. This module answers that, and only from evidence: every line it
 * produces traces to a field on a record — a `completedAt`, an `occurrenceDate`,
 * an `Event.date`, a `waitingSince`, a history entry. Nothing is inferred, and
 * nothing is scored.
 *
 * ## Nothing is persisted (§30)
 *
 * No migration, no store domain, no autobiographical event table. This is a
 * function of `(state, range)`, which buys three things that persistence would
 * have to re-implement: deleting a source record removes its memory for free,
 * editing one updates it for free, and a derived sentence can never be mistaken
 * for something the user wrote.
 *
 * ## The three confusions this file exists to refuse (§7)
 *
 *   created  ≠ completed   — separate kinds, never merged, never summed
 *   scheduled ≠ attended   — the kind is `event_scheduled`; no attendance
 *                            evidence exists anywhere in the schema
 *   touched  ≠ progressed  — `Project` has no history at all, so a project line
 *                            counts dated facts linked to it and never claims
 *                            movement
 *
 * ## Where the facts come from
 *
 * `buildActivityIndex` already flattens action and capture history into one
 * sorted stream, and it is reused rather than re-derived. It predates LIFEOS-061
 * and LIFEOS-060's notes, though, so it carries **no** event, note or project
 * entries — those three arrays are read directly here, once each. Extending the
 * shared index instead would change what `dormancyView`, `periodSummary` and
 * Today's Return card consider a record, which is a different change with a
 * blast radius this sprint has no business creating.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { addDays, weekStartKey, todayKey, formatDayKey } from "@/lib/reviews/dates";
import type { LifeEvent, NextAction, Project, RecordRefLite, StoreState } from "@/types/mvp";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { buildActivityIndex, eventsInRange, type ActivityEvent } from "@/lib/insights/activity";
import { occurrencesBetween, readRule, describeRule } from "@/lib/time/recurrence";
import { classifyOrigin } from "@/lib/provenance/classify";
import { isMachineProduced, type OriginType } from "@/lib/provenance";
import { isLive, overdueActions, upcomingActions, sortByDue } from "@/lib/actions/due";

/** Stated on every review surface. No claim of exhaustive life memory (§23). */
export const COVERAGE_NOTE =
  "This reflects what was recorded in Conqify. It is not a complete record of your week.";

/** Shown when the range holds nothing. Never "you did nothing" (§28E). */
export const EMPTY_WEEK =
  "Nothing was recorded in Conqify during this period.";

/**
 * Words a review of someone's week may never use about them.
 *
 * Shorter than Today's list and pointed at a different failure: Today can slip
 * into nagging, a review can slip into appraisal. Both are the same mistake —
 * describing the person instead of the records.
 */
export const FORBIDDEN_REVIEW_WORDS: readonly string[] = [
  "productive", "unproductive", "neglected", "failing", "failed to",
  "great progress", "strong progress", "good week", "bad week", "slacking",
  "lazy", "behind", "on track", "off track", "streak", "score", "grade",
  "you should have", "well done", "keep it up",
];

// ------------------------------------------------------------------- kinds --

/**
 * What kinds of thing can be said to have happened.
 *
 * Every member has a field behind it. There is no `event_happened`, no
 * `project_progressed`, and no `follow_up_completed`, because nothing in the
 * schema records attendance, progress, or a follow-up actually being made.
 */
export type AutobiographicalKind =
  | "completed_action"
  | "recurring_completion"
  | "event_scheduled"
  | "action_created"
  | "action_deferred"
  | "action_rescheduled"
  | "action_cancelled"
  | "waiting_started"
  | "note_created"
  | "reflection_captured"
  | "decision_recorded"
  | "capture_created";

/** Kinds that mean something finished. Never mixed with the ones that don't. */
export const COMPLETION_KINDS: readonly AutobiographicalKind[] = ["completed_action", "recurring_completion"];

/** Kinds that mean something new arrived. */
export const ADDED_KINDS: readonly AutobiographicalKind[] = [
  "action_created", "note_created", "waiting_started", "capture_created",
];

export interface AutobiographicalEvent {
  /** ISO instant, or midday on the day for date-only facts (see `dayOnly`). */
  at: string;
  day: DayKey;
  kind: AutobiographicalKind;
  /** The user's own words, or the record's title. Never generated prose. */
  title: string;
  recordRef: RecordRefLite;
  projectRef?: RecordRefLite;
  /** The capture this record came from, when it came from one. */
  sourceRef?: RecordRefLite;
  /** The field this line traces to. Shown in dev, asserted in tests (§6). */
  evidence: string;
  /** Extra factual detail — an occurrence date, a person, a schedule. */
  detail?: string;
  /**
   * True when the record has only a DATE, not an instant. An Event knows the
   * day it was scheduled for and nothing about when it was entered, so ordering
   * it against timestamped facts would be inventing a time.
   */
  dayOnly?: boolean;
  /** Provenance of the underlying record (§24). Derived lines are never authored. */
  origin: OriginType;
}

// ----------------------------------------------------------------- ranges ---

export type WeekRangeKind = "this_week" | "last_week" | "last_7_days";

export const WEEK_RANGE_LABEL: Record<WeekRangeKind, string> = {
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
};

/**
 * Resolve one of the three ranges §17 asks for.
 *
 * Weeks start on MONDAY, which is not a new convention — it is the one
 * `weekStartKey` already uses and the one `deferKeyFor("next_week")` already
 * schedules against. Everything else goes through `resolveRange`, so the
 * DST-safe, offset-explicit bounds engine is reused rather than reinvented.
 */
export function resolveWeekRange(kind: WeekRangeKind, today: DayKey = todayKey(), offsetMinutes?: number): ResolvedRange {
  if (kind === "last_7_days") return resolveRange("last_7_days", { today, offsetMinutes });
  const thisMonday = weekStartKey(today);
  const start = kind === "this_week" ? thisMonday : addDays(thisMonday, -7);
  // This week ends TODAY, not on Sunday: a review must not present days that
  // have not happened as though they were empty.
  const end = kind === "this_week" ? today : addDays(thisMonday, -1);
  return resolveRange("custom", { today, customStart: start, customEnd: end, offsetMinutes });
}

// --------------------------------------------------------------- timeline ---

interface Lookups {
  actions: Map<string, NextAction>;
  projects: Map<string, Project>;
  events: Map<string, LifeEvent>;
}

function lookups(state: StoreState): Lookups {
  const actions = new Map<string, NextAction>();
  for (const a of state.nextActions ?? []) actions.set(a.id, a);
  const projects = new Map<string, Project>();
  for (const p of state.projects ?? []) projects.set(p.id, p);
  const events = new Map<string, LifeEvent>();
  for (const e of state.events ?? []) events.set(e.id, e);
  return { actions, projects, events };
}

const dayOf = (iso: string): DayKey => iso.slice(0, 10);
const projectRef = (id?: string): RecordRefLite | undefined => (id ? { kind: "project", id } : undefined);

/** A date-only fact is placed at midday so it sorts inside its own day. */
const middayOf = (day: DayKey): string => `${day}T12:00:00.000Z`;

/**
 * Is this instant inside the range?
 *
 * Uses the range's half-open millisecond bounds rather than string-comparing
 * day keys, so the DST-safe, offset-explicit boundaries `resolveRange` computed
 * are the ones that actually apply — the same bounds `eventsInRange` uses for
 * the shared index. Two different notions of "inside the week" on one page is
 * how a record shows up in the timeline and not in a section.
 */
function within(iso: string | undefined, range: ResolvedRange): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= range.startMs && t < range.endMs;
}

/**
 * Build the autobiographical timeline for a range.
 *
 * Composes the shared activity index for anything it already carries (actions,
 * captures) and reads the three arrays it does not (events, notes, decisions)
 * directly, once each. `index` may be passed in when the caller already built
 * one — Today builds one every render, and a page showing both should not build
 * two (§26).
 */
export function buildAutobiographicalTimeline(
  state: StoreState,
  range: ResolvedRange,
  index?: ActivityEvent[],
): AutobiographicalEvent[] {
  const ix = index ?? buildActivityIndex(state);
  const lk = lookups(state);
  const inRange = eventsInRange(ix, range);
  const out: AutobiographicalEvent[] = [];

  // ---- from the shared activity index: actions and captures ---------------
  for (const e of inRange) {
    if (e.recordKind === "action") {
      const a = lk.actions.get(e.recordId);
      // The record may have been deleted since the history was written. A
      // timeline entry with no record behind it is exactly the fabricated
      // memory §6 forbids, so it is dropped rather than shown as "(untitled)".
      if (!a) continue;
      const base = {
        at: e.at, day: dayOf(e.at), title: a.title,
        recordRef: { kind: "action", id: a.id } as RecordRefLite,
        projectRef: projectRef(a.projectId),
        sourceRef: a.sourceCaptureId ? ({ kind: "capture", id: a.sourceCaptureId } as RecordRefLite) : undefined,
        origin: classifyOrigin({ kind: "action", text: a.title }),
      };

      switch (e.type) {
        case "action_completed": {
          // A recurring occurrence completion is recorded as a `completed`
          // history entry whose detail is the OCCURRENCE DATE — that is what
          // `completeOccurrence` writes, and it is the only thing separating
          // "this standing responsibility was kept on Tuesday" from "this task
          // is finished forever". Reading it wrong would claim a recurring
          // action had ended.
          const occurrence = /^\d{4}-\d{2}-\d{2}$/.test(e.detail ?? "") ? e.detail : undefined;
          out.push(occurrence
            ? { ...base, kind: "recurring_completion", detail: occurrence, evidence: "recurrenceCompletions[].occurrenceDate" }
            : { ...base, kind: "completed_action", evidence: "action.completedAt" });
          break;
        }
        case "action_created":
          out.push({ ...base, kind: "action_created", evidence: "action.createdAt" });
          break;
        case "action_deferred":
          // §12 asked whether the historical transition survives. It does:
          // `deferAction` appends a history entry carrying the target day. So
          // "deferred during this week" is a recorded fact, not a guess from
          // the current `deferredUntil`.
          out.push({
            ...base, kind: "action_deferred", evidence: "action.history[].deferred",
            detail: e.detail ? `until ${formatDayKey(e.detail)}` : "with no date",
          });
          break;
        case "action_cancelled":
          out.push({ ...base, kind: "action_cancelled", evidence: "action.cancelledAt" });
          break;
        case "action_waiting":
          out.push({ ...base, kind: "waiting_started", detail: e.detail, evidence: "action.waitingSince" });
          break;
        default:
          break;
      }
      continue;
    }

    if (e.recordKind === "capture" && e.type === "capture_created") {
      const c = (state.captures ?? []).find((x) => x.id === e.recordId);
      if (!c) continue;
      // A capture that BECAME something is already represented by the thing it
      // became. Listing both would double-count one sentence and turn the
      // review into a database log (§11). A capture that produced nothing is
      // the only trace of that moment, so it stays.
      if ((c.linkedEntityRefs ?? []).length > 0) continue;
      out.push({
        at: e.at, day: dayOf(e.at), kind: "capture_created", title: c.text,
        recordRef: { kind: "capture", id: c.id },
        evidence: "capture.createdAt",
        origin: classifyOrigin({ kind: "capture", text: c.text }),
      });
    }
  }

  // ---- reschedules: read from action history, which the index omits -------
  //
  // LIFEOS-065 made "move the deadline to Friday" a sentence, so a review that
  // could not report it would answer "what changed?" worse than the product now
  // behaves. `setActionDueDate` already appends a `due_set` entry carrying the
  // new day; `buildActivityIndex` maps only status transitions, so it is read
  // here instead of widening the shared index (same reasoning as events above).
  //
  // EVENT reschedules stay invisible: `LifeEvent` has no history at all. That
  // asymmetry is why "what changed?" remains PARTIAL, and it is stated rather
  // than papered over.
  for (const a of state.nextActions ?? []) {
    for (const h of a.history ?? []) {
      if (h.action !== "due_set" || !within(h.at, range)) continue;
      // The creation of a dated record already appears as `action_created`;
      // calling that a reschedule would invent a change that never happened.
      if (dayOf(h.at) === dayOf(a.createdAt) && Math.abs(Date.parse(h.at) - Date.parse(a.createdAt)) < 2000) continue;
      out.push({
        at: h.at, day: dayOf(h.at), kind: "action_rescheduled", title: a.title,
        recordRef: { kind: "action", id: a.id },
        projectRef: projectRef(a.projectId),
        detail: h.detail ? `to ${formatDayKey(h.detail)}` : undefined,
        evidence: "action.history[].due_set",
        origin: classifyOrigin({ kind: "action", text: a.title }),
      });
    }
  }

  // ---- events: scheduled, never attended (§7, §10) ------------------------
  for (const ev of state.events ?? []) {
    const rule = readRule(ev.recurrence);
    const days = rule
      ? occurrencesBetween(rule, ev.date, range.startKey, range.endKey)
      : (ev.date >= range.startKey && ev.date <= range.endKey ? [ev.date] : []);
    for (const day of days) {
      out.push({
        at: middayOf(day), day, kind: "event_scheduled", title: ev.title,
        recordRef: { kind: "event", id: ev.id },
        sourceRef: ev.sourceCaptureId ? { kind: "capture", id: ev.sourceCaptureId } : undefined,
        detail: [ev.allDay || !ev.startTime ? "All day" : ev.startTime, rule ? describeRule(rule) : undefined]
          .filter(Boolean).join(" · "),
        evidence: rule ? "event.recurrence occurrence" : "event.date",
        dayOnly: true,
        origin: classifyOrigin({ kind: "event", text: ev.title, fromAiText: ev.fromAiText }),
      });
    }
  }

  // ---- notes and reflections: the user's own words ------------------------
  for (const n of state.notes ?? []) {
    // `createdAt`, never `updatedAt`. An old note edited this week is not a new
    // reflection, and there is no edit log that could honestly say otherwise
    // (§28D).
    if (!within(n.createdAt, range)) continue;
    if (n.archived) continue;
    out.push({
      at: n.createdAt, day: dayOf(n.createdAt), kind: "note_created",
      title: (n.title?.trim() || n.body).trim(),
      recordRef: { kind: "note", id: n.id },
      sourceRef: n.sourceCaptureId ? { kind: "capture", id: n.sourceCaptureId } : undefined,
      evidence: "note.createdAt",
      origin: classifyOrigin({ kind: "note", text: n.body, fromAiText: n.fromAiText }),
    });
  }

  for (const r of state.reflections ?? []) {
    if (!within(r.createdAt, range)) continue;
    out.push({
      at: r.createdAt, day: dayOf(r.createdAt), kind: "reflection_captured",
      title: (r.response || r.prompt).trim(),
      recordRef: { kind: "formation", id: r.id },
      evidence: "reflection.createdAt",
      origin: classifyOrigin({ kind: "reflection", text: r.response }),
    });
  }

  for (const d of state.decisions ?? []) {
    if (!within(d.createdAt, range)) continue;
    out.push({
      at: d.createdAt, day: dayOf(d.createdAt), kind: "decision_recorded", title: d.title,
      recordRef: { kind: "decision", id: d.id },
      evidence: "decision.createdAt",
      origin: classifyOrigin({ kind: "decision", text: d.title }),
    });
  }

  // One fact per (kind, record, day). `markActionWaiting` can legitimately be
  // called twice for one item — once at capture, once from the action page —
  // and "started waiting on Marcus" is one thing that happened, not two.
  const seen = new Set<string>();
  const deduped = out.filter((e) => {
    const key = `${e.kind}:${e.recordRef.kind}:${e.recordRef.id}:${e.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at.localeCompare(b.at)));
  return deduped;
}

// ------------------------------------------------------------ week review ---

export interface WaitingLine {
  action: NextAction;
  /** The user's own string. Never a Person record. */
  waitingOn?: string;
  since?: DayKey;
  /** True when a recorded follow-up date fell on or before the range end. */
  followUpDue: boolean;
  followUpDate?: DayKey;
}

export interface OpenLine {
  action: NextAction;
  reason: "overdue" | "due_soon" | "waiting" | "project_next";
  detail: string;
}

/**
 * One project's week, in counts of dated facts.
 *
 * `Project` carries `createdAt` and `updatedAt` and NO history, so there is no
 * way to know what an edit changed or when work on it moved. Every field here
 * is therefore a count of things that are themselves dated and linked — which
 * supports "2 linked actions completed" and refuses "made progress" (§16).
 */
export interface ProjectRollup {
  project: Project;
  completed: number;
  added: number;
  eventsScheduled: number;
  waiting: number;
  /** True only when at least one LINKED ACTION was completed in the range. */
  hadCompletion: boolean;
}

export interface WeekReview {
  range: ResolvedRange;
  rangeKind: WeekRangeKind;
  timeline: AutobiographicalEvent[];
  completed: AutobiographicalEvent[];
  scheduled: AutobiographicalEvent[];
  added: AutobiographicalEvent[];
  deferred: AutobiographicalEvent[];
  rescheduled: AutobiographicalEvent[];
  reflections: AutobiographicalEvent[];
  waiting: WaitingLine[];
  stillOpen: OpenLine[];
  projects: ProjectRollup[];
  /** Arithmetic over recorded facts. Never an evaluation (§21). */
  summary: string;
  coverage: string;
  /** What this review cannot tell you, stated where it applies (§23). */
  limitations: string[];
  empty: boolean;
}

const MAX_ADDED = 12;
const MAX_OPEN = 8;
const MAX_PROJECTS = 6;
const DUE_SOON_DAYS = 7;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The deterministic summary (§21).
 *
 * Arithmetic over recorded facts and nothing else. Every clause is a count the
 * reader could verify by looking at the sections below it, and the sentence is
 * assembled from only the clauses that have a non-zero count — a summary that
 * lists what did NOT happen is an appraisal wearing a count's clothes.
 */
export function summarise(review: Omit<WeekReview, "summary" | "coverage" | "limitations" | "empty">): string {
  const parts: string[] = [];
  const oneTime = review.completed.filter((e) => e.kind === "completed_action").length;
  const recurring = review.completed.filter((e) => e.kind === "recurring_completion").length;
  if (oneTime) parts.push(`completed ${plural(oneTime, "action")}`);
  if (recurring) parts.push(`kept ${plural(recurring, "recurring commitment")}`);
  if (review.scheduled.length) parts.push(`had ${plural(review.scheduled.length, "event")} on the calendar`);
  // Counted from the TIMELINE, not from `added`.
  //
  // `added` is capped so the section stays readable, and counting it would make
  // the headline number silently become the cap — "added 12 actions" for a week
  // with thirty, which is arithmetic that has stopped being about the week. The
  // section is a bounded view; the sentence is the fact.
  const newActions = review.timeline.filter((e) => e.kind === "action_created").length;
  if (newActions) parts.push(`added ${plural(newActions, "action")}`);
  if (review.reflections.length) parts.push(`captured ${plural(review.reflections.length, "note or reflection", "notes and reflections")}`);
  if (review.deferred.length) parts.push(`deferred ${plural(review.deferred.length, "item")}`);
  if (review.rescheduled.length) parts.push(`rescheduled ${plural(review.rescheduled.length, "item")}`);

  const lead = parts.length === 0
    ? "Nothing was recorded in this period."
    : `In this period you ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}.`;

  const tail = review.waiting.length
    ? ` ${plural(review.waiting.length, "item")} ${review.waiting.length === 1 ? "is" : "are"} still waiting on someone.`
    : "";
  return lead + tail;
}

export function buildWeekReview(
  state: StoreState,
  rangeKind: WeekRangeKind = "this_week",
  opts: { today?: DayKey; offsetMinutes?: number; index?: ActivityEvent[] } = {},
): WeekReview {
  const today = opts.today ?? todayKey();
  const range = resolveWeekRange(rangeKind, today, opts.offsetMinutes);
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);
  const lk = lookups(state);

  const completed = timeline.filter((e) => (COMPLETION_KINDS as string[]).includes(e.kind));
  const scheduled = timeline.filter((e) => e.kind === "event_scheduled");
  const deferred = timeline.filter((e) => e.kind === "action_deferred");
  const rescheduled = timeline.filter((e) => e.kind === "action_rescheduled");
  // A reflection is the user's own words. Machine prose kept as a note is a
  // record of what a model said, not of what the user thought, so it is not
  // presented as a reflection (§24).
  const reflections = timeline.filter(
    (e) => (e.kind === "note_created" || e.kind === "reflection_captured" || e.kind === "capture_created")
      && !isMachineProduced(e.origin),
  );
  const reflectionIds = new Set(reflections.map((e) => e.recordRef.id));
  // A record appears ONCE in Added. "Marcus still hasn't sent the document" is
  // created and marked waiting in the same breath, and listing both lines makes
  // one thing look like two — the database-log failure §11 warns about. The
  // wait is the more informative of the two, so it wins.
  const waitingRecordIds = new Set(
    timeline.filter((e) => e.kind === "waiting_started").map((e) => e.recordRef.id),
  );
  const added = timeline
    .filter((e) => {
      if (!(ADDED_KINDS as string[]).includes(e.kind)) return false;
      if (reflectionIds.has(e.recordRef.id)) return false;
      if (e.kind === "action_created" && waitingRecordIds.has(e.recordRef.id)) return false;
      return true;
    })
    .slice(0, MAX_ADDED);

  // ---- WAITING: current state, dated from what was recorded ---------------
  // A wait that began AFTER the period under review did not exist during it.
  // Showing it under "last week" would be the current state impersonating
  // history — the one way a projection can lie about a past range.
  const startedBy = (a: NextAction) => !a.waitingSince || dayOf(a.waitingSince) <= range.endKey;
  const waiting: WaitingLine[] = (state.nextActions ?? [])
    .filter((a) => a.status === "waiting" && startedBy(a))
    .map((a) => ({
      action: a,
      waitingOn: a.waitingOn?.trim() || undefined,
      since: a.waitingSince ? dayOf(a.waitingSince) : undefined,
      followUpDate: a.followUpDate,
      followUpDue: !!a.followUpDate && a.followUpDate <= range.endKey,
    }))
    .sort((x, y) => (x.since ?? "").localeCompare(y.since ?? ""));

  // ---- STILL OPEN: a bounded, explained selection — not a backlog (§14) ---
  // Status is CURRENT status — reconstructing "what was open last Tuesday"
  // would mean replaying every history transition, and this section does not
  // claim to. What it can honestly exclude is anything that did not exist yet
  // during the range; `limitationsFor` states the rest.
  const existedBy = (a: NextAction) => dayOf(a.createdAt) <= range.endKey;
  const live = (state.nextActions ?? []).filter((a) => isLive(a) && existedBy(a));
  const nonRecurring = live.filter((a) => !readRule(a.recurrence));
  const openSeen = new Set<string>();
  const stillOpen: OpenLine[] = [];
  const pushOpen = (action: NextAction, reason: OpenLine["reason"], detail: string) => {
    if (openSeen.has(action.id) || stillOpen.length >= MAX_OPEN) return;
    openSeen.add(action.id);
    stillOpen.push({ action, reason, detail });
  };
  for (const a of sortByDue(overdueActions(nonRecurring, range.endKey), range.endKey)) {
    pushOpen(a, "overdue", `Was due ${formatDayKey(a.dueDate!)}`);
  }
  for (const a of upcomingActions(nonRecurring, range.endKey, DUE_SOON_DAYS)) {
    pushOpen(a, "due_soon", `Due ${formatDayKey(a.dueDate!)}`);
  }
  for (const w of waiting) {
    pushOpen(w.action, "waiting", w.waitingOn ? `Waiting on ${w.waitingOn}` : "Waiting");
  }
  for (const p of state.projects ?? []) {
    if (p.status !== "active") continue;
    const next = sortByDue(nonRecurring.filter((a) => a.projectId === p.id && a.status !== "waiting"), range.endKey)[0];
    if (next) pushOpen(next, "project_next", `Next in ${p.title}`);
  }

  // ---- PROJECTS: counts of dated facts, never movement (§16) --------------
  const rollups: ProjectRollup[] = [];
  for (const p of state.projects ?? []) {
    if (p.status !== "active") continue;
    const mine = (id?: string) => id === p.id;
    const completedN = completed.filter((e) => mine(e.projectRef?.id)).length;
    const addedN = timeline.filter((e) => e.kind === "action_created" && mine(e.projectRef?.id)).length;
    const eventsN = scheduled.filter((e) => {
      const ev = lk.events.get(e.recordRef.id);
      return (ev?.linkedEntityRefs ?? []).some((r) => r.kind === "project" && r.id === p.id);
    }).length;
    const waitingN = waiting.filter((w) => w.action.projectId === p.id).length;
    if (completedN + addedN + eventsN + waitingN === 0) continue;
    rollups.push({
      project: p, completed: completedN, added: addedN,
      eventsScheduled: eventsN, waiting: waitingN, hadCompletion: completedN > 0,
    });
  }
  rollups.sort((a, b) => b.completed - a.completed || b.added - a.added || a.project.title.localeCompare(b.project.title));

  const core = {
    range, rangeKind, timeline, completed, scheduled, added, deferred, rescheduled, reflections,
    waiting, stillOpen, projects: rollups.slice(0, MAX_PROJECTS),
  };

  return {
    ...core,
    summary: summarise(core),
    coverage: COVERAGE_NOTE,
    limitations: limitationsFor(core, today),
    empty: timeline.length === 0 && waiting.length === 0 && stillOpen.length === 0,
  };
}

/**
 * What this particular review cannot tell you (§23).
 *
 * Conditional on purpose: a blanket disclaimer at the bottom of every page is
 * read once and then never again. A limitation stated because the section above
 * it triggered it is the one a reader actually takes in.
 */
export function limitationsFor(
  review: Pick<WeekReview, "scheduled" | "projects" | "waiting" | "stillOpen" | "range">,
  today: DayKey = todayKey(),
): string[] {
  const out: string[] = [];
  if (review.stillOpen.length > 0 && review.range.endKey < today) {
    out.push("“Still open” reflects where things stand now, not where they stood at the end of this period.");
  }
  if (review.scheduled.length > 0) {
    out.push("Events show what was on the calendar. Conqify has no record of whether you attended.");
  }
  if (review.projects.length > 0) {
    out.push("Project lines count linked records. Conqify keeps no history of project changes, so it cannot say what moved.");
  }
  if (review.waiting.some((w) => w.followUpDue)) {
    out.push("A follow-up date having arrived is recorded; whether you followed up is not.");
  }
  if (review.scheduled.length > 0) {
    // Stated wherever events appear, because LIFEOS-065 lets a user move one by
    // saying so — and moving it leaves no trace at all.
    out.push("Events carry no change history, so a rescheduled event shows only where it stands now.");
  }
  return out;
}

// ---------------------------------------------------------------- queries ---

/**
 * The programmatic answers §20 asks for.
 *
 * Thin by design — each is a filter over the model above, so a caller cannot
 * get a different answer from the one on screen.
 */
export const weekQueries = {
  completed: (r: WeekReview) => r.completed,
  scheduled: (r: WeekReview) => r.scheduled,
  added: (r: WeekReview) => r.added,
  waitingOn: (r: WeekReview) => r.waiting,
  projectsWithActivity: (r: WeekReview) => r.projects,
  reflections: (r: WeekReview) => r.reflections,
};

/** Does any string this review produces characterise the reader? Used by tests. */
export function violatesReviewLanguage(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return FORBIDDEN_REVIEW_WORDS.filter((w) => low.includes(w));
}

/** Every generated string in a review — user content is excluded by design. */
export function reviewStrings(review: WeekReview): string[] {
  return [
    review.summary, review.coverage, ...review.limitations,
    ...review.stillOpen.map((o) => o.detail),
    ...review.deferred.map((e) => e.detail ?? ""),
    EMPTY_WEEK,
  ];
}
