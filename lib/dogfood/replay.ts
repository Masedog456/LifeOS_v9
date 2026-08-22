/**
 * The dogfood replay (LIFEOS-063 §1, §5, §7).
 *
 * Runs `SCENARIO` through the real loop:
 *
 *   text → interpret() → toCommitCandidate() → commitCapture()
 *        → buildTodayIndexes() → buildTodayView() → recommendNextAction()
 *
 * and records what happened at every step. Nothing is simulated. The only code
 * this file adds is the bookkeeping: which surface a step lives on, how many
 * interactions it cost, and what Today said afterwards.
 *
 * ## Interactions are counted the way the UI actually works
 *
 * `CaptureComposer` is: type, press Capture, press Confirm. Three. Unticking a
 * candidate or switching its kind through the "Or:" row costs one more each.
 * That is the number §19 asks for — "interactions to useful saved state" — and
 * it is derived from the component rather than estimated.
 *
 * ## Surfaces are recorded because leaving is the finding
 *
 * §15 asks why the user left Conqify. A cheaper version of the same question is
 * how often they had to leave the two surfaces the product is built around.
 * Every step names the surface it lives on, so the report can count instead of
 * remember.
 */

import { addDays, dayDiff, type DayKey } from "@/lib/reviews/dates";
import type { NextAction, StoreState } from "@/types/mvp";
import type { CandidateKind } from "@/lib/capture/authority";
import { interpret, wholeCaptureAsNote, type Candidate } from "@/lib/capture/interpret";
import { toCommitCandidate, isCommittable, type CommitCandidate } from "@/lib/capture/commit";
import { preselected } from "@/lib/capture/authority";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildTodayView, type TodayView } from "@/lib/today/view";
import { describeRule } from "@/lib/time/recurrence";
import { buildActivityIndex, type ActivityEvent } from "@/lib/insights/activity";
import { buildInsightTimeline } from "@/lib/memory/timeline";
import { SCENARIO, WEEK_START, type DogfoodDay, type DogfoodStep } from "@/lib/dogfood/scenario";
import type { DogfoodOps } from "@/lib/dogfood/ops";

/**
 * Where a step happens.
 *
 * `capture` and `today` are the two surfaces the product claims you can live
 * in. Anything else is a trip somewhere the user had to know existed.
 */
export type Surface = "capture" | "today" | "action detail" | "projects";

const SURFACE_OF: Record<DogfoodStep["do"], Surface> = {
  capture: "capture",
  // Completing and deferring are offered inline on Today.
  complete: "today",
  defer: "today",
  completeOccurrence: "today",
  // These are not. Each is a trip.
  stopRecurrence: "action detail",
  waitOn: "action detail",
  blocks: "action detail",
  fileUnder: "action detail",
  project: "projects",
};

/** What one candidate proposed, flattened for the report. */
export interface CandidateTrace {
  kind: CandidateKind;
  title: string;
  confidence: string;
  reason: string;
  dueDate?: DayKey;
  time?: string;
  recurrence?: string;
  waitingOn?: string;
  /** Preselected by the authority gradient — i.e. arrives ticked. */
  ticked: boolean;
  unresolved: { phrase: string; reason?: string }[];
  /** A resolved date this kind cannot store, disclosed rather than dropped. */
  dateNotKept: boolean;
}

export interface CaptureTrace {
  text: string;
  intent: string;
  candidates: CandidateTrace[];
  committedKinds: CandidateKind[];
  createdKinds: string[];
  interactions: number;
  /** The capture row still holds the sentence exactly as typed. */
  rawPreserved: boolean;
  escalated: boolean;
  /**
   * Nothing arrived ticked, so Confirm was disabled and the user took the
   * always-present escape hatch instead — "Keep the whole thing as a note".
   *
   * Worth counting on its own. It is the product working as designed, and it is
   * also the shape of a capture the rules could not place.
   */
  usedEscapeHatch: boolean;
}

export interface StepTrace {
  kind: DogfoodStep["do"];
  surface: Surface;
  detail: string;
  interactions: number;
  ok: boolean;
}

export interface DayTrace {
  day: number;
  date: DayKey;
  now: string;
  label: string;
  brief: string;
  captures: CaptureTrace[];
  steps: StepTrace[];
  view: TodayView;
  /** Section names Today actually rendered, in page order. */
  sections: string[];
  suggestion: { title: string | null; reasons: string[]; note?: string; considered: number };
  interactions: number;
  /** Interactions that happened somewhere other than Capture or Today. */
  awayInteractions: number;
  counts: { actions: number; events: number; notes: number; projects: number; captures: number };
  /** Every action and its state at the end of the day, for inspection. */
  actions: { title: string; status: string; dueDate?: string; dueTime?: string; recurrence?: string }[];
}

/** One of the six questions §14 asks of the surfaces that already exist. */
export interface WeekAnswer {
  question: string;
  /** Can the current product answer it at all, and from where? */
  verdict: "answerable" | "partial" | "unanswerable";
  /** The route a user would have to be on. `—` when no surface shows it. */
  surface: string;
  /** What the data actually yielded, so the verdict is checkable. */
  evidence: string;
}

export interface DogfoodRun {
  days: DayTrace[];
  /** The store as it stood at the end of the carried-forward week. */
  weekEnd: StoreState;
  weekReview: WeekAnswer[];
  totalInteractions: number;
  totalAwayInteractions: number;
  escapeHatchCaptures: number;
}

// ------------------------------------------------------------------ util ----

function find(state: StoreState, match: string): NextAction | undefined {
  const needle = match.toLowerCase();
  return (state.nextActions ?? []).find((a) => a.title.toLowerCase().includes(needle));
}

/**
 * Mirrors `CaptureComposer.rowsFrom` + `confirmSelected`.
 *
 * Kept in step with the component by construction: the two decisions that
 * matter — what arrives ticked (`preselected`) and what is committable
 * (`isCommittable`) — are the component's own functions, imported.
 */
function confirm(
  text: string,
  candidates: Candidate[],
  drop: number[],
  switchTo: { index: number; kind: CandidateKind }[],
): { picked: CommitCandidate[]; kinds: CandidateKind[]; escapeHatch: boolean } {
  const picked: CommitCandidate[] = [];
  const kinds: CandidateKind[] = [];
  candidates.forEach((c, i) => {
    if (drop.includes(i)) return;
    const swap = switchTo.find((s) => s.index === i);
    const effective = swap ? { ...c, kind: swap.kind } : c;
    if (!preselected(effective.authority) && !swap) return;
    const cc = toCommitCandidate(effective);
    if (!isCommittable(cc)) return;
    picked.push(cc);
    kinds.push(effective.kind);
  });

  // Confirm is disabled when nothing is ticked, so a user standing in front of
  // this screen cannot press it. What they CAN press is the escape hatch, which
  // is always rendered and never depends on interpretation having worked. That
  // is the honest model of what happens next — not a silent no-op.
  if (picked.length === 0 && candidates.length > 0) {
    const whole = toCommitCandidate(wholeCaptureAsNote(text));
    return { picked: [whole], kinds: ["note"], escapeHatch: true };
  }
  return { picked, kinds, escapeHatch: false };
}

function traceCandidate(c: Candidate, dropped: boolean): CandidateTrace {
  const f = c.fields;
  const kindHoldsDate = c.kind === "action" || c.kind === "waiting" || c.kind === "event";
  return {
    kind: c.kind,
    title: f.title ?? f.body ?? "",
    confidence: c.confidence,
    reason: c.reason,
    dueDate: f.dueDate,
    time: f.time,
    recurrence: f.recurrence ? describeRule(f.recurrence) : undefined,
    waitingOn: f.waitingOn,
    ticked: preselected(c.authority) && !dropped,
    unresolved: c.unresolved.map((u) => ({ phrase: u.phrase, reason: u.reason })),
    dateNotKept: !!f.dueDate && !kindHoldsDate,
  };
}

/** Section names in the order `TodayCommandCenter` renders them. */
export function sectionsOf(view: TodayView): string[] {
  const out: string[] = [];
  if (view.nowEvent || view.nextEvent) out.push("NOW");
  if (view.suggestion.recommendation) out.push("SUGGESTED NEXT");
  if (view.occurrences.length || view.dueToday.length || view.recurringToday.length || view.alsoToday.length) out.push("TODAY");
  if (view.overdue.length || view.returnedToday.length || view.blocked.length) out.push("NEEDS ATTENTION");
  if (view.waiting.length) out.push("WAITING");
  if (view.pulse.length) out.push("PROJECT PULSE");
  if (view.returnItem) out.push("RETURN");
  if (view.upcoming.length) out.push("UPCOMING");
  return out;
}

// ----------------------------------------------------------------- replay ----

/**
 * Shift a scripted date onto the run's anchor week.
 *
 * `dayDiff(a, b)` is a minus b, so this is "how far into the script is this
 * date" added to the anchor. With no anchor the script's own dates stand.
 */
function shift(date: DayKey, anchor?: DayKey): DayKey {
  if (!anchor) return date;
  return addDays(anchor, dayDiff(date, WEEK_START));
}

function runDay(ops: DogfoodOps, day: DogfoodDay, anchor?: DayKey): DayTrace {
  if (day.freshStore) ops.reset();
  const date = shift(day.date, anchor);

  const captures: CaptureTrace[] = [];
  const steps: StepTrace[] = [];

  for (const step of day.steps) {
    const surface = SURFACE_OF[step.do];

    if (step.do === "capture") {
      const before = ops.snapshot();
      const interpretation = interpret(step.text, before, date);
      const drop = step.drop ?? [];
      const switchTo = step.switchTo ?? [];
      const { picked, kinds, escapeHatch } = confirm(step.text, interpretation.candidates, drop, switchTo);
      const { captureId, created } = ops.commit(step.text, picked);
      const after = ops.snapshot();
      const saved = (after.captures ?? []).find((c) => c.id === captureId);
      // type + Capture + Confirm, then one per correction, and one more if the
      // user had to reach for the escape hatch because nothing arrived ticked.
      const interactions = 3 + drop.length + switchTo.length + (escapeHatch ? 1 : 0);

      captures.push({
        text: step.text,
        intent: step.intent,
        candidates: interpretation.candidates.map((c, i) => traceCandidate(c, drop.includes(i))),
        committedKinds: kinds,
        createdKinds: created.map((r) => r.kind),
        interactions,
        rawPreserved: saved?.text === step.text,
        escalated: interpretation.escalate,
        usedEscapeHatch: escapeHatch,
      });
      steps.push({ kind: "capture", surface, detail: step.text, interactions, ok: true });
      continue;
    }

    const state = ops.snapshot();
    let ok = false;
    let detail = "";

    switch (step.do) {
      case "complete": {
        const a = find(state, step.match);
        if (a) { ops.complete(a.id); ok = true; }
        detail = `completed “${a?.title ?? step.match}”`;
        break;
      }
      case "defer": {
        const a = find(state, step.match);
        if (a) {
          const opt = typeof step.option === "object" ? { date: shift(step.option.date, anchor) } : step.option;
          ops.defer(a.id, opt); ok = true;
        }
        detail = `deferred “${a?.title ?? step.match}”`;
        break;
      }
      case "waitOn": {
        const a = find(state, step.match);
        if (a) { ops.waitOn(a.id, step.person, step.followUp ? shift(step.followUp, anchor) : undefined); ok = true; }
        detail = `waiting on ${step.person} for “${a?.title ?? step.match}”`;
        break;
      }
      case "completeOccurrence": {
        const a = find(state, step.match);
        {
          const on = shift(step.on, anchor);
          ok = a ? ops.completeOccurrence(a.id, on) : false;
          detail = `closed the ${on} occurrence of “${a?.title ?? step.match}”`;
        }
        break;
      }
      case "stopRecurrence": {
        const a = find(state, step.match);
        ok = a ? ops.stopRecurrence(a.id, shift(step.from, anchor)) : false;
        detail = `stopped recurrence on “${a?.title ?? step.match}”`;
        break;
      }
      case "blocks": {
        const blocker = find(state, step.blocker);
        const blocked = find(state, step.blocked);
        if (blocker && blocked) { ops.dependency(blocker.id, blocked.id); ok = true; }
        detail = `“${blocker?.title ?? step.blocker}” blocks “${blocked?.title ?? step.blocked}”`;
        break;
      }
      case "project": {
        ops.project(step.title);
        ok = true;
        detail = `created project “${step.title}”`;
        break;
      }
      case "fileUnder": {
        const a = find(state, step.match);
        const p = (state.projects ?? []).find((x) => x.title === step.project);
        if (a && p) { ops.fileUnder(a.id, p.id); ok = true; }
        detail = `filed “${a?.title ?? step.match}” under ${step.project}`;
        break;
      }
    }

    steps.push({ kind: step.do, surface, detail, interactions: 1, ok });
  }

  const state = ops.snapshot();
  const ix = buildTodayIndexes(state, date, day.now);
  const view = buildTodayView(state, ix);
  const rec = view.suggestion;

  const interactions = steps.reduce((n, s) => n + s.interactions, 0);
  const awayInteractions = steps
    .filter((s) => s.surface !== "capture" && s.surface !== "today")
    .reduce((n, s) => n + s.interactions, 0);

  return {
    day: day.day,
    date,
    now: day.now,
    label: day.label,
    brief: day.brief,
    captures,
    steps,
    view,
    sections: sectionsOf(view),
    suggestion: {
      title: rec.recommendation?.action.title ?? null,
      reasons: (rec.recommendation?.reasons ?? []).map((r) => r.text),
      note: rec.note,
      considered: rec.consideredCount,
    },
    interactions,
    awayInteractions,
    counts: {
      actions: (state.nextActions ?? []).length,
      events: (state.events ?? []).length,
      notes: (state.notes ?? []).length,
      projects: (state.projects ?? []).length,
      captures: (state.captures ?? []).length,
    },
    actions: (state.nextActions ?? []).map((a) => ({
      title: a.title,
      status: a.status,
      dueDate: a.dueDate,
      dueTime: a.dueTime,
      recurrence: a.recurrence ? describeRule(a.recurrence) : undefined,
    })),
  };
}

/**
 * Answer §14's six questions against the surfaces that already exist.
 *
 * Every verdict below is computed from the store, not asserted from memory, so
 * it moves when the product does. The point of the exercise is to find the
 * boundary of what Conqify can already say about a week it has just lived
 * through — §14 forbids building the missing layer here.
 *
 * One caveat, stated rather than hidden: the activity index is keyed on real
 * timestamps and the replay's dates are a fixed week in March 2026, so a
 * calendar range over those dates finds nothing. Range filtering is therefore
 * left out and the whole index is read — which is generous to the product, not
 * harsh, and any "unanswerable" below survives that generosity.
 */
export function reviewWeek(state: StoreState, activity: ActivityEvent[]): WeekAnswer[] {
  const actions = state.nextActions ?? [];
  const completed = actions.filter((a) => a.status === "completed");
  const open = actions.filter((a) => a.status === "open" || a.status === "in_progress");
  const waiting = actions.filter((a) => a.status === "waiting");
  const deferred = actions.filter((a) => a.status === "deferred");
  const occurrences = (state.recurrenceCompletions ?? []).length;
  const projects = (state.projects ?? []).filter((p) => p.status === "active");
  const timeline = buildInsightTimeline(state, { limit: 200 });
  const pastEventCount = (state.events ?? []).length;

  return [
    {
      question: "What did I complete?",
      verdict: completed.length + occurrences > 0 ? "answerable" : "unanswerable",
      surface: "/actions (status filter), /insights/actions",
      evidence: `${completed.length} completed action(s) and ${occurrences} closed occurrence(s) are recorded with timestamps.`,
    },
    {
      question: "What remains open?",
      verdict: open.length > 0 ? "answerable" : "unanswerable",
      surface: "/actions, /today",
      evidence: `${open.length} open action(s), each retrievable by status.`,
    },
    {
      question: "What am I waiting on?",
      verdict: waiting.length > 0 ? "answerable" : "unanswerable",
      surface: "/today → WAITING, /actions",
      evidence: `${waiting.length} waiting item(s) with a waitingOn string and a since date.`,
    },
    {
      // The events are stored; what is missing is any surface that narrates
      // them back. Timeline is built from knowledge records, not from a week.
      question: "What happened this week?",
      verdict: timeline.length > 0 ? "partial" : "unanswerable",
      surface: "/timeline, /insights/change-log",
      evidence:
        `${activity.length} activity event(s) and ${pastEventCount} calendar event(s) exist, ` +
        `and the timeline yields ${timeline.length} entr(y|ies) — but none of these is a week narrative; ` +
        `they are per-record logs the user must assemble themselves.`,
    },
    {
      question: "What did I defer?",
      verdict: deferred.length > 0 ? "partial" : "unanswerable",
      surface: "/actions (deferred filter)",
      evidence:
        `${deferred.length} deferred action(s). The CURRENT deferral is stored; the history of ` +
        `how many times something was pushed is only in per-action history, with no surface that lists it.`,
    },
    {
      question: "What changed in my projects?",
      verdict: projects.length > 0 ? "partial" : "unanswerable",
      surface: "/projects, /today → PROJECT PULSE",
      evidence:
        `${projects.length} active project(s). Pulse states the CURRENT position (next action, blocked, waiting); ` +
        `nothing states the DELTA between last week and this one.`,
    },
  ];
}

/**
 * Replay the whole week.
 *
 * Days that carry the week forward run first, in order, on one store. Days that
 * ask for a fresh store run afterwards on a wiped one and are slotted back into
 * day order — otherwise Day 6's deliberate emptiness would erase the week that
 * Day 7 exists to review.
 */
export function replayDogfood(
  ops: DogfoodOps,
  days: readonly DogfoodDay[] = SCENARIO,
  anchor?: DayKey,
): DogfoodRun {
  ops.reset();
  const traces: DayTrace[] = [];

  for (const day of days) {
    if (day.freshStore) continue;
    traces.push(runDay(ops, day, anchor));
  }

  const weekEnd = ops.snapshot();
  const weekReview = reviewWeek(weekEnd, buildActivityIndex(weekEnd));

  for (const day of days) {
    if (!day.freshStore) continue;
    traces.push(runDay(ops, day, anchor));
  }
  traces.sort((a, b) => a.day - b.day);

  const captures = traces.flatMap((d) => d.captures);
  return {
    days: traces,
    weekEnd,
    weekReview,
    totalInteractions: traces.reduce((n, d) => n + d.interactions, 0),
    totalAwayInteractions: traces.reduce((n, d) => n + d.awayInteractions, 0),
    escapeHatchCaptures: captures.filter((c) => c.usedEscapeHatch).length,
  };
}
