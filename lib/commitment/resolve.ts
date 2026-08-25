/**
 * Commitment resolution — turning a signal into the smallest safe set of things
 * you can do about it (LIFEOS-071).
 *
 * ## A signal is not a command
 *
 * LIFEOS-070 made Conqify able to say "this may be slipping". This module makes
 * that sentence actionable without making it autonomous. Three rules hold the
 * line, and each is enforced by the shape of the code rather than by care:
 *
 *   SIGNAL ≠ COMMAND      — nothing here mutates; it returns descriptions of
 *                           mutations the user may choose to run
 *   SUGGESTION ≠ MUTATION — every `run` is invoked by a click, never by a render
 *   RESOLUTION ≠ AUTONOMY — no batch, no "fix everything", no silent cancel
 *
 * ## The record is authoritative; the signal is derived
 *
 * Every action targets the underlying record through an existing store
 * primitive. Nothing mutates a `CommitmentSignal` — it is recomputed from state
 * on the next render, so a resolved commitment stops being surfaced because its
 * EVIDENCE changed, not because something crossed it off a list (§20).
 *
 * ## Bounded per signal, not a generic menu
 *
 * `RESOLUTIONS_BY_KIND` is a fixed table. An overdue action cannot offer "open
 * blocker" and a blocked one cannot offer "complete" as its primary move,
 * because those entries do not exist — §6's bounded sets are data, not a
 * filter someone has to remember to apply.
 *
 * ## What is deliberately absent
 *
 * There is no `mark_followed_up`. Nothing in the schema records that a follow-up
 * occurred, and §13 forbids inventing it — so the two honest operations are
 * offered instead: move the next follow-up date, or end the wait explicitly.
 * Neither claims a follow-up happened, and neither resets how long the wait has
 * run.
 */

import type { NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";
import { addDays, todayKey, formatDayKey } from "@/lib/reviews/dates";
import { DEFER_LABEL } from "@/lib/actions/defer";
import { blockersOf } from "@/lib/actions/dependencies";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { CommitmentKind, CommitmentSignal } from "@/lib/commitment/signals";

// ---------------------------------------------------------------- contract --

/**
 * Every operation a signal row may offer.
 *
 * `cancel` and `delete` are absent by construction (§3, §8). Cancellation is
 * reachable from the action's own detail page, where the consequences are
 * visible; a one-click cancel next to a "you may be forgetting this" prompt is
 * how someone loses work they meant to keep.
 */
export type ResolutionKind =
  | "complete_action"
  | "complete_occurrence"
  | "defer"
  | "reschedule"
  | "open_record"
  | "open_blocker"
  | "set_follow_up"
  | "stop_waiting"
  | "create_project_next_action";

export const RESOLUTION_KINDS: readonly ResolutionKind[] = [
  "complete_action", "complete_occurrence", "defer", "reschedule",
  "open_record", "open_blocker", "set_follow_up", "stop_waiting",
  "create_project_next_action",
];

/**
 * How much authority an operation has, reusing LIFEOS-060's gradient (§8).
 *
 * `auto_with_undo` runs on click and offers an undo. `confirm` opens a small
 * bounded control first. Nothing here is `auto_safe`: every one of these
 * changes a record the user can see, so none of them should happen without the
 * user having pressed something.
 */
export type ResolutionAuthority = "auto_with_undo" | "confirm" | "navigate";

export interface ResolutionAction {
  kind: ResolutionKind;
  /** Button text. Imperative, factual, never "Fix" or "Resolve". */
  label: string;
  /** The record this targets. Always the source record, never the signal. */
  recordRef: RecordRefLite;
  enabled: boolean;
  authority: ResolutionAuthority;
  /** Why it is disabled, or what it will do. Shown when present. */
  explanation?: string;
  /** Where a `navigate` action goes. */
  href?: string;
  /** Extra bounded choices — defer presets, blocker list (§15). */
  choices?: ResolutionChoice[];
}

export interface ResolutionChoice {
  id: string;
  label: string;
  /** For a defer preset, the resolved day; for a blocker, its href. */
  day?: DayKey;
  href?: string;
  ref?: RecordRefLite;
}

// ------------------------------------------------------------ the mapping --

/**
 * §6's bounded sets, as data.
 *
 * Order is display order, and the first entry is the PRIMARY move — which is
 * why `blocked` leads with `open_blocker` and never with `complete_action`
 * (§15: a blocked item is not executable, and offering to complete it first
 * would be the product suggesting something the user cannot do).
 */
export const RESOLUTIONS_BY_KIND: Record<CommitmentKind, readonly ResolutionKind[]> = {
  overdue: ["complete_action", "reschedule", "defer", "open_record"],
  follow_up_due: ["set_follow_up", "stop_waiting", "open_record"],
  returned_today: ["open_record", "complete_action", "defer", "reschedule"],
  recurring_due: ["complete_occurrence", "open_record"],
  blocked: ["open_blocker", "open_record"],
  due_soon: ["open_record", "reschedule", "defer"],
  project_no_next_action: ["create_project_next_action", "open_record"],
  dormant: ["open_record", "reschedule", "defer", "complete_action"],
};

/** Defer presets, reusing the labels and arithmetic `lib/actions/defer` owns. */
export function deferChoices(today: DayKey = todayKey()): ResolutionChoice[] {
  return [
    { id: "tomorrow", label: DEFER_LABEL.tomorrow, day: addDays(today, 1) },
    { id: "next_week", label: DEFER_LABEL.next_week },
    { id: "someday", label: DEFER_LABEL.someday },
  ];
}

/**
 * Reschedule presets.
 *
 * Deliberately three fixed days and nothing else. A free-text or relative
 * reschedule ("push it a couple of weeks") is ambiguous, and §12 routes that
 * through LIFEOS-065's temporal-edit flow rather than growing a second
 * reschedule path here.
 */
export function rescheduleChoices(today: DayKey = todayKey()): ResolutionChoice[] {
  return [
    { id: "today", label: "Today", day: today },
    { id: "tomorrow", label: "Tomorrow", day: addDays(today, 1) },
    { id: "next_week", label: `Next ${formatDayKey(addDays(today, 7), { weekday: "long" })}`, day: addDays(today, 7) },
  ];
}

const hrefFor = (ref: RecordRefLite): string =>
  ref.kind === "project" ? `/project/${ref.id}` : `/actions/${ref.id}`;

export interface ResolveContext {
  today?: DayKey;
  ix: TodayIndexes;
}

/**
 * The bounded set of things you can do about one signal.
 *
 * Pure — it reads the record to decide what is ENABLED, and returns
 * descriptions. Nothing is executed here; `lib/commitment/apply.ts` owns that,
 * and only when a caller passes it an action the user selected.
 */
export function resolutionsFor(
  state: StoreState,
  signal: CommitmentSignal,
  ctx: ResolveContext,
): ResolutionAction[] {
  return buildResolutions(state, signal.recordRef, RESOLUTIONS_BY_KIND[signal.kind] ?? [], ctx);
}

/**
 * The set offered on a Suggested Next recommendation (LIFEOS-072 §20).
 *
 * A recommended action does not necessarily carry a commitment signal — it may
 * simply be the only executable thing — so this takes the RECORD rather than
 * synthesising a signal that no evidence supports. Same builder, same controls,
 * same authority; only the entry point differs.
 */
export const RECOMMENDATION_RESOLUTIONS: readonly ResolutionKind[] = [
  "complete_action", "complete_occurrence", "defer", "reschedule", "open_record",
];

export function resolutionsForAction(
  state: StoreState,
  actionId: string,
  ctx: ResolveContext,
): ResolutionAction[] {
  return buildResolutions(state, { kind: "action", id: actionId }, RECOMMENDATION_RESOLUTIONS, ctx);
}

function buildResolutions(
  state: StoreState,
  recordRef: RecordRefLite,
  kinds: readonly ResolutionKind[],
  ctx: ResolveContext,
): ResolutionAction[] {
  const today = ctx.today ?? ctx.ix.today ?? todayKey();
  const action = recordRef.kind === "action" ? ctx.ix.actionsById.get(recordRef.id) : undefined;
  const out: ResolutionAction[] = [];
  for (const kind of kinds) {
    const built = build(kind, state, recordRef, action, ctx, today);
    if (built) out.push(built);
  }
  return out;
}

function build(
  kind: ResolutionKind,
  state: StoreState,
  ref: RecordRefLite,
  action: NextAction | undefined,
  ctx: ResolveContext,
  today: DayKey,
): ResolutionAction | null {
  const base = { kind, recordRef: ref, enabled: true } as const;

  switch (kind) {
    case "open_record":
      return { ...base, label: ref.kind === "project" ? "Open project" : "Open", authority: "navigate", href: hrefFor(ref) };

    case "complete_action": {
      // A recurring action is a standing source. Completing IT would end the
      // series, which is never what "done for today" means (§10).
      if (!action || action.recurrence) return null;
      return {
        ...base, label: "Complete", authority: "auto_with_undo",
        explanation: "Marks it done and records the completion.",
      };
    }

    case "complete_occurrence": {
      if (!action?.recurrence) return null;
      const done = (ctx.ix.completions.get(action.id) ?? []).includes(today);
      return {
        ...base, label: "Done for today", authority: "auto_with_undo",
        enabled: !done,
        // §10, said out loud on the control itself. The most valuable sentence
        // in this module: it is the difference between keeping a commitment and
        // ending one.
        explanation: done
          ? "Today's occurrence is already recorded."
          : "Closes today's occurrence only — the repeat stays.",
      };
    }

    case "defer": {
      if (!action) return null;
      return {
        ...base, label: "Defer", authority: "confirm",
        explanation: "Steps away until the day you pick. It comes back then.",
        choices: deferChoices(today),
      };
    }

    case "reschedule": {
      if (!action) return null;
      return {
        ...base, label: "Reschedule", authority: "confirm",
        explanation: action.dueDate
          ? `Currently due ${formatDayKey(action.dueDate)}.`
          : "Sets a due date.",
        choices: rescheduleChoices(today),
      };
    }

    case "set_follow_up": {
      if (!action || action.status !== "waiting") return null;
      return {
        ...base, label: "Set next follow-up", authority: "confirm",
        // Stated because the alternative reading is the dangerous one.
        explanation: "Moves the follow-up date. It doesn't record that you followed up.",
        choices: rescheduleChoices(today),
      };
    }

    case "stop_waiting": {
      if (!action || action.status !== "waiting") return null;
      return {
        ...base, label: "Stop waiting", authority: "confirm",
        explanation: action.waitingOn
          ? `Ends the wait on ${action.waitingOn} and returns this to your open work. It is not marked complete.`
          : "Ends the wait and returns this to your open work. It is not marked complete.",
      };
    }

    case "open_blocker": {
      if (!action) return null;
      const blockers = blockersOf(action.id, ctx.ix.blockedByMap, ctx.ix.actionsById)
        .filter((b) => b.status !== "completed" && b.status !== "cancelled");
      if (blockers.length === 0) return null;
      // §15. One blocker links straight through; several ask. Never a silent
      // pick, and never by recency.
      if (blockers.length === 1) {
        return {
          ...base, kind: "open_blocker", label: "Open blocker", authority: "navigate",
          recordRef: { kind: "action", id: blockers[0].id },
          href: `/actions/${blockers[0].id}`,
          explanation: `Goes to ${blockers[0].title}.`,
        };
      }
      return {
        ...base, kind: "open_blocker", label: `Open blocker (${blockers.length})`, authority: "confirm",
        explanation: "More than one thing is blocking this. Which one?",
        choices: blockers.map((b) => ({
          id: b.id, label: b.title, href: `/actions/${b.id}`,
          ref: { kind: "action", id: b.id },
        })),
      };
    }

    case "create_project_next_action": {
      if (ref.kind !== "project") return null;
      const project = (state.projects ?? []).find((p) => p.id === ref.id);
      if (!project) return null;
      return {
        ...base, label: "Add next action", authority: "confirm",
        // §16. The user writes it. Conqify does not invent a commitment and
        // attribute it to them.
        explanation: `Adds an action to ${project.title}. You write it.`,
      };
    }

    default:
      return null;
  }
}

/** The primary move for a signal — the first entry, or nothing. */
export function primaryResolution(actions: ResolutionAction[]): ResolutionAction | undefined {
  return actions.find((a) => a.enabled);
}

/**
 * Words a resolution control may never use.
 *
 * A button is the most pressured surface in the product: it is short, it is
 * imperative, and it is read at the moment of deciding. "Fix", "resolve" and
 * "clean up" all imply the item was a mess; "dismiss" and "ignore" imply
 * Conqify has an opinion about whether it should have been done.
 */
export const RESOLUTION_FORBIDDEN_WORDS: readonly string[] = [
  "fix", "resolve this", "clean up", "clear out", "dismiss", "ignore",
  "snooze", "catch up", "get on top", "sort out", "deal with", "finally",
  "mark followed up", "followed up",
];

export function violatesResolutionLanguage(text: string): string[] {
  const low = (text ?? "").toLowerCase();
  return RESOLUTION_FORBIDDEN_WORDS.filter((w) => low.includes(w));
}

/**
 * The pressured surface: every string a user reads ON a control.
 *
 * This — not the explanations — is what the language ban is checked against.
 * An explanation is allowed, and sometimes required, to NAME the thing it is
 * ruling out: "It doesn't record that you followed up" contains the forbidden
 * phrase precisely because it is denying it. Scanning that sentence for
 * "followed up" would fail the honest copy while passing a button that lies.
 */
export function resolutionLabels(actions: ResolutionAction[]): string[] {
  const out: string[] = [];
  for (const a of actions) {
    out.push(a.label);
    for (const c of a.choices ?? []) out.push(c.label);
  }
  return out;
}

/** Every generated string, labels and explanations alike. */
export function resolutionStrings(actions: ResolutionAction[]): string[] {
  const out = resolutionLabels(actions);
  for (const a of actions) if (a.explanation) out.push(a.explanation);
  return out;
}
