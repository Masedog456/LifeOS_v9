/**
 * What Home does with a capture once the engine has read it (LIFEOS-095).
 *
 * ## This adds no intelligence
 *
 * `interpret` classifies, `suggestContext` matches, `authorityFor` decides how
 * much authority a reading has earned, and `commitCapture` writes. All four
 * already existed and none are touched here. This module answers the two
 * questions the front door was not asking:
 *
 *   1. can this capture just be DONE, or does it need the person? (§31, §32)
 *   2. what should Home say afterwards? (§10, §15, §16)
 *
 * ## The tier was already computed and already ignored
 *
 * The audit's sharpest finding. `authorityFor` grades a high-confidence Action,
 * Waiting, Note and Event as `auto_with_undo` — and that grade decided only
 * whether the row's checkbox arrived ticked. The commit still waited for a
 * second press, so the most ordinary sentence in the product took
 *
 *     type → Capture → read a card → Confirm all → a toast that named nothing
 *
 * `canFinishWithoutAsking` is that tier finally being used for the decision it
 * describes. It grants nothing new: every kind it lets through was already
 * `auto_with_undo`, and everything else still asks.
 *
 * ## Nothing here is stored
 *
 * The recent list is a read over `capture.linkedEntityRefs`, which
 * `commitCapture` already writes. No new field, no dismissed state, no
 * migration (§34, §38).
 */

import type { Capture, RecordRefLite as RefLite, StoreState } from "@/types/mvp";
import { dateNotKept, type Candidate } from "@/lib/capture/interpret";
import { preselected } from "@/lib/capture/authority";
import type { CaptureContextSuggestion } from "@/lib/capture/context";
import { formatDayKey } from "@/lib/reviews/dates";
import { formatLocalTime } from "@/lib/time/localtime";

// ------------------------------------------------------------------ copy ---

/**
 * §7. The shortest form of the question the page exists to ask.
 *
 * It replaces a slogan ("You live. Conqify keeps track."), a heading and a
 * two-line instructional paragraph — 148 px of copy above the primary input of
 * a capture product, measured.
 */
export const HOME_PROMPT = "What's happening?";

/**
 * §8. One example, not a gallery and not a paragraph.
 *
 * The old placeholder was three clauses and wrapped to three lines inside the
 * field, which reads as prose the user has to finish reading before typing.
 */
export const HOME_PLACEHOLDER = "Email Marcus about the lease tomorrow";

/** §15. Bounded, and small. Home is not the capture inbox. */
export const MAX_RECENT_CAPTURES = 4;

/** §16. What a captured moment BECAME, in product words. */
export const OUTCOME_LABEL: Record<string, string> = {
  action: "Action",
  note: "Note",
  event: "Event",
  protocol: "Protocol",
  formation: "Reflection",
  project: "Project",
  goal: "Goal",
  // `/process` can convert a capture to a belief, and a capture filed that way
  // is filed. Leaving it out made those rows read "Not filed yet".
  belief: "Belief",
};

/**
 * The product word for a kind that must be confirmed (§32).
 *
 * Lower-case, because it appears mid-sentence. Deliberately the SAME words the
 * composer's own labels use — a kind called "Rule" in one place and "Standard"
 * two lines below it is two products.
 */
export const CONFIRM_WORD: Record<string, string> = {
  note: "note",
  protocol: "protocol",
  reflection: "reflection",
  project: "project",
  goal: "goal",
  standard: "rule",
  action: "action",
  waiting: "wait",
  event: "event",
};

/** §10. The finished state's first line. */
export const SAVED_LEAD = "Saved as";

/** §29. Truthful when interpretation failed but the words are safe. */
export const KEPT_UNORGANISED =
  "Saved your capture. I couldn't fully organize it yet.";

// -------------------------------------------------------- the auto decision --

export interface FinishInput {
  candidates: readonly Candidate[];
  /** The context 089 suggested, flattened across every candidate. */
  context: readonly CaptureContextSuggestion[];
  /** True when the capture also proposes a change to an EXISTING record. */
  hasPendingEdit: boolean;
}

/**
 * Whether this capture can be finished on submit, with undo (§31).
 *
 * Every clause is a reason to ask rather than a reason to act, which is the
 * safe direction for the default to fail in:
 *
 *   nothing found        there is no capture to finish, only text to keep
 *   any confirm tier     Protocol, Reflection, Project, Goal, Rule, and every
 *                        low-confidence reading of anything — `authorityFor`
 *                        already demotes those and §32 lists them by name
 *   unresolved fragments  something could not be stored, and §19 of 060 says
 *                        that gets said out loud rather than compressed away
 *   a date the kind drops the same argument, one field down
 *   ambiguous context     §11: ambiguity only when real — and this is real
 *   a pending edit        it changes a record that already exists (§33)
 */
export function canFinishWithoutAsking(input: FinishInput): boolean {
  if (input.hasPendingEdit) return false;
  if (input.candidates.length === 0) return false;
  if (!input.candidates.every((c) => preselected(c.authority))) return false;
  if (input.candidates.some((c) => c.unresolved.length > 0)) return false;
  if (input.candidates.some((c) => dateNotKept(c))) return false;
  if (input.context.some((s) => s.ambiguousAlternatives.length > 0)) return false;
  return true;
}

/**
 * Why the capture is being shown rather than finished — one short sentence, or
 * null when it was finished.
 *
 * Stated because a surface that sometimes asks and sometimes does not owes the
 * reader the difference. Ordered to match `canFinishWithoutAsking`, so the
 * sentence and the decision cannot drift.
 */
export function askingBecause(input: FinishInput): string | null {
  if (canFinishWithoutAsking(input)) return null;
  if (input.hasPendingEdit) return "This changes something you already have.";
  if (input.candidates.length === 0) return null;
  if (input.context.some((s) => s.ambiguousAlternatives.length > 0)) return "More than one thing matches.";
  if (input.candidates.some((c) => c.unresolved.length > 0)) return "Part of this couldn't be stored.";
  if (input.candidates.some((c) => dateNotKept(c))) return "A date here wouldn't be kept.";
  const needs = input.candidates.find((c) => !preselected(c.authority));
  // The kind is the reason, so the kind is what the sentence says. "This one
  // needs you" is true of every branch here and therefore informative in none.
  if (needs) return `A ${CONFIRM_WORD[needs.kind] ?? "record"} is yours to confirm.`;
  return "This one needs you.";
}

// ----------------------------------------------------------- the outcomes ---

export interface CaptureOutcome {
  kind: string;
  id: string;
  /** The record's own words. Never generated prose. */
  title: string;
  /** "Action", "Note" — the product word for what it became. */
  label: string;
  /** One short fact about it, when there is one: a date, a person. */
  detail?: string;
  href: string;
}

function hrefFor(kind: string, id: string): string {
  switch (kind) {
    case "action": return `/actions/${id}`;
    case "note": return `/notes?note=${id}`;
    case "event": return `/calendar?event=${id}`;
    case "protocol": return `/protocols`;
    case "belief": return `/beliefs`;
    case "project": return `/project/${id}`;
    case "goal": return `/goal/${id}`;
    default: return "/memory";
  }
}

/**
 * What a set of just-created refs actually are, read back from the store.
 *
 * Read back rather than carried forward from the candidates: the store is what
 * decides what was written, and a summary built from the INPUT would keep
 * claiming a record that `commitCapture` declined to create — which is exactly
 * how "Saved 1 thing" could be printed for zero things.
 */
export function describeCreated(state: StoreState, refs: readonly RefLite[]): CaptureOutcome[] {
  const out: CaptureOutcome[] = [];
  for (const ref of refs) {
    const label = OUTCOME_LABEL[ref.kind] ?? "Record";
    if (ref.kind === "action") {
      const a = (state.nextActions ?? []).find((x) => x.id === ref.id);
      if (!a) continue;
      const bits: string[] = [];
      if (a.waitingOn) bits.push(`Waiting on ${a.waitingOn}`);
      if (a.dueDate) bits.push(formatDayKey(a.dueDate));
      if (a.dueTime) bits.push(formatLocalTime(a.dueTime));
      out.push({
        kind: ref.kind, id: ref.id, title: a.title,
        // A wait is its own word on this surface, because "Action" would hide
        // the one fact that makes it different: somebody else has to move.
        label: a.waitingOn ? "Waiting" : label,
        detail: bits.join(" · ") || undefined,
        href: hrefFor(ref.kind, ref.id),
      });
      continue;
    }
    if (ref.kind === "note") {
      const n = (state.notes ?? []).find((x) => x.id === ref.id);
      if (!n) continue;
      out.push({ kind: ref.kind, id: ref.id, title: n.title || n.body, label, href: hrefFor(ref.kind, ref.id) });
      continue;
    }
    if (ref.kind === "event") {
      const e = (state.events ?? []).find((x) => x.id === ref.id);
      if (!e) continue;
      out.push({
        kind: ref.kind, id: ref.id, title: e.title, label,
        detail: [e.date && formatDayKey(e.date), e.startTime && formatLocalTime(e.startTime)]
          .filter(Boolean).join(" · ") || undefined,
        href: hrefFor(ref.kind, ref.id),
      });
      continue;
    }
    if (ref.kind === "protocol") {
      const p = (state.protocols ?? []).find((x) => x.id === ref.id);
      if (!p) continue;
      out.push({ kind: ref.kind, id: ref.id, title: `${p.trigger} → ${p.response}`, label, href: hrefFor(ref.kind, ref.id) });
      continue;
    }
    if (ref.kind === "project" || ref.kind === "goal") {
      const r = ref.kind === "project"
        ? (state.projects ?? []).find((x) => x.id === ref.id)
        : (state.goals ?? []).find((x) => x.id === ref.id);
      if (!r) continue;
      out.push({ kind: ref.kind, id: ref.id, title: r.title, label, href: hrefFor(ref.kind, ref.id) });
      continue;
    }
    if (ref.kind === "belief") {
      const b = (state.beliefs ?? []).find((x) => x.id === ref.id);
      if (!b) continue;
      out.push({ kind: ref.kind, id: ref.id, title: b.text, label, href: hrefFor(ref.kind, ref.id) });
      continue;
    }
    if (ref.kind === "formation") {
      const r = (state.reflections ?? []).find((x) => x.id === ref.id);
      if (!r) continue;
      out.push({ kind: ref.kind, id: ref.id, title: r.response, label, href: hrefFor(ref.kind, ref.id) });
    }
  }
  return out;
}

// ------------------------------------------------------------ recent list ---

export interface RecentCapture {
  id: string;
  /** §17. What the person actually typed, always. */
  text: string;
  at: string;
  /** What it became — possibly empty even when it was filed; see `unfiled`. */
  outcomes: CaptureOutcome[];
  /**
   * True when nothing has been made of it yet — it is waiting in `/process`.
   *
   * Read from `processingStatus`, which is the STORE's answer, and not from
   * whether this module managed to describe the outcomes. `convertCapture` can
   * file a capture as a concept, a dialogue, a practice and six other kinds
   * this surface has no reader for; deriving "unfiled" from an empty outcome
   * list told the user their filed capture was still waiting, and pointed them
   * at an inbox it is not in.
   */
  unfiled: boolean;
}

/**
 * The last few captures and what each became (§15, §16, §17).
 *
 * Derived from `capture.linkedEntityRefs`, which `commitCapture` already writes
 * in one history event. Nothing new is persisted and no pipeline state is
 * exposed — a row says the person's own sentence and the product word for what
 * it turned into, never a candidate kind or a processing status.
 *
 * §18: ONE row per captured moment. A capture that produced three records is
 * one row with three outcomes, not four cards.
 */
export function recentCaptures(state: StoreState, limit = MAX_RECENT_CAPTURES): RecentCapture[] {
  return (state.captures ?? [])
    .filter((c: Capture) => !c.archivedAt && !c.discardedAt)
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, Math.max(0, limit))
    .map((c) => {
      const refs = c.linkedEntityRefs ?? [];
      return {
        id: c.id,
        text: c.workingText?.trim() || c.text,
        at: c.createdAt,
        outcomes: describeCreated(state, refs),
        unfiled: (c.processingStatus ?? "inbox") === "inbox" && refs.length === 0,
      };
    });
}

/** Every string this layer can produce, for the language guards to sweep. */
export function captureHomeStrings(rows: readonly RecentCapture[]): string[] {
  return [
    HOME_PROMPT, HOME_PLACEHOLDER, SAVED_LEAD, KEPT_UNORGANISED,
    ...rows.flatMap((r) => [r.text, ...r.outcomes.flatMap((o) => [o.label, o.title, o.detail ?? ""])]),
  ];
}
