/**
 * What can be put right, and what honestly cannot (LIFEOS-097).
 *
 * ## The distinction this whole sprint rests on
 *
 * The user said what they said. The system got the interpretation wrong. So a
 * correction changes the DERIVED RECORD and never the raw capture (§3) — and
 * every field below is reached through the setter the record's own page already
 * uses (§41). This module adds no mutation path; it decides which of the
 * existing ones apply to a given outcome, and which corrections are not
 * available at all.
 *
 * ## Why "not available" is a first-class answer
 *
 * There is no record-type conversion primitive in this product. Action → Note
 * would be `deleteAction` + `createNote`, losing the action's history, its
 * dependency edges, its completion state, its `waitingSince`, its id and every
 * reference to it. §17 says do not fake that, so `unsupported` is part of the
 * model rather than an omission — the surface says what it cannot do instead of
 * quietly not offering it.
 *
 * ## Nothing here is persisted
 *
 * A derivation over the store (§40). No correction history, no learning, no
 * preference model (§37).
 */

import type { NextAction, RecordRefLite as RefLite, StoreState } from "@/types/mvp";
import type { DayKey } from "@/lib/reviews/dates";

// ------------------------------------------------------------------ model ---

/** The fields a correction sheet may offer, by name. */
export type CorrectableField =
  | "title"
  | "dueDate"
  | "dueTime"
  | "project"
  | "goal"
  | "waitingOn";

export interface CorrectionField {
  field: CorrectableField;
  label: string;
  /** The value the store holds right now. */
  value?: string;
}

export interface UnsupportedCorrection {
  id: string;
  /** What the user might reasonably want, in their words. */
  label: string;
  /** Why it is not offered — a fact about the data, never an apology. */
  reason: string;
}

export interface CorrectableOutcome {
  kind: string;
  id: string;
  /** The record's own name, as it stands. */
  title: string;
  label: string;
  fields: CorrectionField[];
  unsupported: UnsupportedCorrection[];
  /**
   * True when THIS capture created the record, so undoing it removes something
   * the capture is responsible for (§19, §20).
   */
  createdByCapture: boolean;
}

export interface CaptureCorrection {
  captureId: string;
  /** §4. The sentence, verbatim, always. */
  source: string;
  outcomes: CorrectableOutcome[];
}

// ------------------------------------------------------------------- copy ---

export const SOURCE_LEAD = "You said";
export const CORRECTION_HEADING = "Fix this";

/**
 * §17, §18. The conversion this product cannot do without losing data.
 *
 * Stated once, in one place, so the surface and the tests cannot describe the
 * boundary differently.
 */
export const NO_TYPE_CONVERSION: UnsupportedCorrection = {
  id: "convert_kind",
  label: "Change what kind of record this is",
  reason: "Conqify would have to delete this and make a new one, losing its history and links. Open the record and recreate it deliberately instead.",
};

/** §13. `waitingFor` is interpretation data; the record never stored it. */
export const NO_WAITING_OBJECT: UnsupportedCorrection = {
  id: "waiting_for",
  label: "Change what you're waiting for",
  reason: "That isn't stored separately — it's part of the title, so edit the title.",
};

const FIELD_LABEL: Record<CorrectableField, string> = {
  title: "Title",
  dueDate: "Date",
  dueTime: "Time",
  project: "Project",
  goal: "Goal",
  waitingOn: "Waiting on",
};

const field = (f: CorrectableField, value?: string): CorrectionField =>
  ({ field: f, label: FIELD_LABEL[f], value: value || undefined });

// ------------------------------------------------------------ the builder ---

/**
 * Which corrections apply to one action.
 *
 * A wait gets `waitingOn` and no `dueTime`: a follow-up is a day, and offering a
 * clock on it would invent a precision the field does not have. An ordinary
 * action gets the reverse. Both get title, project and goal — the three the
 * audit found had a setter and no user interface.
 */
function actionFields(a: NextAction, state: StoreState): CorrectionField[] {
  const project = a.projectId
    ? (state.projects ?? []).find((p) => p.id === a.projectId)?.title
    : undefined;
  const goal = a.goalId
    ? (state.goals ?? []).find((g) => g.id === a.goalId)?.title
    : undefined;
  const out: CorrectionField[] = [field("title", a.title)];
  if (a.status === "waiting") {
    out.push(field("waitingOn", a.waitingOn), field("dueDate", a.followUpDate ?? a.dueDate));
  } else {
    out.push(field("dueDate", a.dueDate));
    // A time without a day is not something the store will keep, so it is only
    // offered once there is a day for it to hang on. `setActionDueTime` refuses
    // it otherwise, and offering a control that will be refused is worse than
    // not offering it.
    if (a.dueDate) out.push(field("dueTime", a.dueTime));
  }
  out.push(field("project", project), field("goal", goal));
  return out;
}

/**
 * The correctable shape of one created record (§40).
 *
 * Returns `null` for a kind this surface has no safe setter for, so the caller
 * offers the record's own page instead of a sheet that could not save.
 */
export function correctableOutcome(
  state: StoreState,
  ref: RefLite,
  opts: { createdByCapture: boolean },
): CorrectableOutcome | null {
  if (ref.kind === "action") {
    const a = (state.nextActions ?? []).find((x) => x.id === ref.id);
    if (!a) return null;
    return {
      kind: ref.kind, id: ref.id, title: a.title,
      label: a.status === "waiting" ? "Waiting" : "Action",
      fields: actionFields(a, state),
      unsupported: a.status === "waiting"
        ? [NO_WAITING_OBJECT, NO_TYPE_CONVERSION]
        : [NO_TYPE_CONVERSION],
      createdByCapture: opts.createdByCapture,
    };
  }
  if (ref.kind === "note") {
    const n = (state.notes ?? []).find((x) => x.id === ref.id);
    if (!n) return null;
    return {
      kind: ref.kind, id: ref.id, title: n.title || n.body, label: "Note",
      // A note's body IS the record (LIFEOS-096 §12), and it is what the title
      // field edits here — there is nothing else on a note to get wrong.
      fields: [field("title", n.title || n.body)],
      unsupported: [NO_TYPE_CONVERSION],
      createdByCapture: opts.createdByCapture,
    };
  }
  if (ref.kind === "event") {
    const e = (state.events ?? []).find((x) => x.id === ref.id);
    if (!e) return null;
    return {
      kind: ref.kind, id: ref.id, title: e.title, label: "Event",
      fields: [field("title", e.title), field("dueDate", e.date), field("dueTime", e.startTime)],
      unsupported: [NO_TYPE_CONVERSION],
      createdByCapture: opts.createdByCapture,
    };
  }
  // Every other domain a capture can reach — a Decision, a Belief, a Protocol —
  // has its own page and its own editing rules. §33's principle from LIFEOS-096
  // applies here too: offer the record rather than a sheet that half works.
  return null;
}

/**
 * Everything correctable about one capture (§21, §29).
 *
 * One entry per record the capture is linked to, so a sentence that produced
 * three records produces three sheets and three undos rather than one of each.
 *
 * `createdByCapture` is decided by the record's own `sourceCaptureId`, not by
 * the link: `commitCapture` links what it creates AND `convertCapture` links
 * what it converts, but a record that merely MATCHED during interpretation is
 * not attributable to this capture and must never be removed by undoing it
 * (§20). Only actions, notes, events and protocols carry that field; anything
 * else is reported as not-created, which is the safe direction.
 */
export function buildCaptureCorrection(
  state: StoreState,
  captureId: string,
): CaptureCorrection | null {
  const capture = (state.captures ?? []).find((c) => c.id === captureId);
  if (!capture) return null;
  const outcomes: CorrectableOutcome[] = [];
  for (const ref of capture.linkedEntityRefs ?? []) {
    const built = correctableOutcome(state, ref, {
      createdByCapture: createdBy(state, ref, captureId),
    });
    if (built) outcomes.push(built);
  }
  return { captureId, source: capture.workingText?.trim() || capture.text, outcomes };
}

/**
 * Did THIS capture create that record? (§19, §20)
 *
 * The record's `sourceCaptureId` is the only honest evidence. A record the
 * interpreter merely matched — the existing action a completion sentence found,
 * a Project a context suggestion pointed at — has a different source or none,
 * and answering "no" for it is what stops undo deleting somebody's real work.
 */
export function createdBy(state: StoreState, ref: RefLite, captureId: string): boolean {
  const src = (): string | undefined => {
    switch (ref.kind) {
      case "action": return (state.nextActions ?? []).find((x) => x.id === ref.id)?.sourceCaptureId;
      case "note": return (state.notes ?? []).find((x) => x.id === ref.id)?.sourceCaptureId;
      case "event": return (state.events ?? []).find((x) => x.id === ref.id)?.sourceCaptureId;
      case "protocol": return (state.protocols ?? []).find((x) => x.id === ref.id)?.sourceCaptureId;
      default: return undefined;
    }
  };
  return src() === captureId;
}

/**
 * The records an "undo this capture" may remove (§19, §20).
 *
 * Only what the capture created, and only kinds with a delete primitive that
 * takes its dependents with it. Everything else is left alone and the caller
 * says so rather than pretending the undo was complete (§31).
 */
export const UNDOABLE_KINDS: ReadonlySet<string> = new Set(["action", "note", "event"]);

export function undoableRefs(state: StoreState, captureId: string): RefLite[] {
  const capture = (state.captures ?? []).find((c) => c.id === captureId);
  if (!capture) return [];
  return (capture.linkedEntityRefs ?? []).filter(
    (ref) => UNDOABLE_KINDS.has(ref.kind) && createdBy(state, ref, captureId),
  );
}

/** Records linked to the capture that an undo will deliberately leave alone. */
export function keptRefs(state: StoreState, captureId: string): RefLite[] {
  const capture = (state.captures ?? []).find((c) => c.id === captureId);
  if (!capture) return [];
  const undoable = new Set(undoableRefs(state, captureId).map((r) => `${r.kind}:${r.id}`));
  return (capture.linkedEntityRefs ?? []).filter((r) => !undoable.has(`${r.kind}:${r.id}`));
}

// ------------------------------------------------------------- staleness ---

/**
 * Is the record still the one the sheet was opened on? (§32)
 *
 * The store is one in-process singleton with no `storage` listener, so "changed
 * elsewhere" can only mean changed in THIS tab since the sheet opened — by an
 * undo, another correction, or a completion from Today. That is a real race and
 * this is the check for it. A second tab's write is not observable at all until
 * a reload, which LIFEOS-094 measured and this sprint does not change.
 */
export function outcomeStillStands(state: StoreState, outcome: CorrectableOutcome): boolean {
  switch (outcome.kind) {
    case "action": return (state.nextActions ?? []).some((x) => x.id === outcome.id);
    case "note": return (state.notes ?? []).some((x) => x.id === outcome.id);
    case "event": return (state.events ?? []).some((x) => x.id === outcome.id);
    default: return false;
  }
}

/** The value a field holds right now, for revalidating before a save (§32). */
export function currentValue(
  state: StoreState,
  outcome: CorrectableOutcome,
  f: CorrectableField,
): string | undefined {
  const rebuilt = correctableOutcome(state, { kind: outcome.kind, id: outcome.id } as RefLite,
    { createdByCapture: outcome.createdByCapture });
  return rebuilt?.fields.find((x) => x.field === f)?.value;
}

/** Every string this layer can produce, for the language guards to sweep. */
export function correctionStrings(c: CaptureCorrection): string[] {
  return [
    SOURCE_LEAD, CORRECTION_HEADING, c.source,
    ...c.outcomes.flatMap((o) => [
      o.label, o.title,
      ...o.fields.map((f) => f.label),
      ...o.unsupported.flatMap((u) => [u.label, u.reason]),
    ]),
  ];
}

/** A day key, or undefined — the one place a date string is validated here. */
export function asDayKey(v: string | undefined): DayKey | undefined {
  const t = (v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? (t as DayKey) : undefined;
}
