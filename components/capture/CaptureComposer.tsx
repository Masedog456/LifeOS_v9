"use client";

/**
 * Universal Capture (LIFEOS-060 §5, §14, §16, §17).
 *
 * ## What this replaces
 *
 * The old surface sent every capture to a model and answered with *"N beliefs
 * waiting in your Inbox."* — so the primary input of a life-management product
 * produced philosophy, and an errand needed five more steps through two other
 * inboxes to become a task.
 *
 * Now: type, see what Conqify made of it, confirm. On this page. Once.
 *
 * ## Transparency without fake precision (§17)
 *
 * Every candidate says what it is ("Likely action"), what was extracted (the
 * due date, the person being waited on), and — where it is not obvious — why.
 * No percentages. "87% confident" is a number the system cannot honestly
 * produce, and printing one buys trust it has not earned.
 *
 * ## Nothing here is a dead end (§13, §16)
 *
 * "Keep the whole thing as a note" is always present, always one click, and
 * never depends on interpretation having worked. If every rule in the parser
 * were wrong, that button still saves what the person typed.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  attachProposals, commitCapture, useStore,
  setActionDueDate, setActionDueTime, setActionRecurrence, stopActionRecurrence,
  deferAction, updateEvent, stopEventRecurrence, deleteEvent,
  completeAction, completeOccurrence,
  // LIFEOS-089 §29. The existing domain setter — never a raw store write.
  linkGoalKnowledge,
  // LIFEOS-095 §31. The undo behind an auto-finished capture. Every one of
  // these already exists; nothing new was written to make undo possible.
  deleteAction, deleteNote, unlinkCaptureRef, restoreCapture, getSnapshot,
  // LIFEOS-095 §9. The existing setter behind the finished state's context
  // offer. Nothing new was written to make that chip work.
  updateAction,
} from "@/lib/mvpStore";
import type { StoreState } from "@/types/mvp";
import { interpret, wholeCaptureAsNote, dateNotKept, type Candidate } from "@/lib/capture/interpret";
import { toCommitCandidate, isCommittable, type CommitCandidate } from "@/lib/capture/commit";
import { buildEscalationContext, mergeAiCandidates, validateAiCandidates } from "@/lib/capture/escalation";
import { authorityNote, authorityFor, preselected, isSuggestOnly, type CandidateKind } from "@/lib/capture/authority";
import { cleanCandidateTitle } from "@/lib/capture/titles";
import { correctableOutcome, createdBy } from "@/lib/capture/corrections";
import CorrectionSheet from "@/components/capture/CorrectionSheet";
import { personalCodeHandoffHref, HANDOFF_ACTION_LABEL, MAX_HANDOFF_CHARS } from "@/lib/code/handoff";
import { UNRESOLVED_LABEL } from "@/lib/capture/dates";
import { formatLocalTime } from "@/lib/time/localtime";
import { describeRule } from "@/lib/time/recurrence";
import type { MatchOption } from "@/lib/capture/match";
import { generateBeliefs, interpretCapture } from "@/lib/aiClient";
import { todayKey, formatDayKey } from "@/lib/reviews/dates";
import { toast } from "@/lib/ux/feedback";
import { buildProposal, type EditTarget, type TemporalEditIntent } from "@/lib/capture/temporal-edit";
import { readChanges } from "@/lib/capture/completion";
import { applyTemporalEdit, type EditOps } from "@/lib/capture/apply-edit";
import ChangeConfirm from "@/components/capture/ChangeConfirm";
import CaptureContext, { defaultChoice, type ContextChoice } from "@/components/capture/CaptureContext";
import {
  canFinishWithoutAsking, askingBecause, describeCreated, contextOffers,
  HOME_PROMPT, HOME_PLACEHOLDER, SAVED_LEAD, KEPT_UNORGANISED,
  type CaptureOutcome, type ContextOffer,
} from "@/lib/capture/home";
import {
  buildCaptureContextIndex, suggestContext, contextFields, contextKnowledgeGoal,
  type CaptureContextSuggestion,
} from "@/lib/capture/context";

/**
 * The store writers the change path may use (LIFEOS-065 §4).
 *
 * Every one already exists and already enforces its own invariants. Listing
 * them explicitly is the point: this component cannot reach any writer that is
 * not on this line.
 */
const EDIT_OPS: EditOps = {
  setActionDueDate, setActionDueTime, setActionRecurrence, stopActionRecurrence,
  deferAction, updateEvent, stopEventRecurrence, deleteEvent,
  // LIFEOS-066 §6. Both already exist and already keep their own contracts:
  // `completeOccurrence` closes ONE day of a repeating action without touching
  // the action's status, and is idempotent by `(action, day)`.
  completeAction: (actionId: string) => completeAction(actionId),
  completeOccurrence,
};

/** User-facing kind labels. Product words, not ontology. */
const KIND_LABEL: Record<CandidateKind, string> = {
  action: "Action",
  waiting: "Waiting on someone",
  note: "Note",
  protocol: "Protocol",
  reflection: "Reflection",
  project: "Project",
  goal: "Goal",
  event: "Event",
  // LIFEOS-079. The product word, not the domain word — a person writing a rule
  // for themselves should not have to learn what a Constitution standard is.
  standard: "Rule",
};

/** Hedge language matched to confidence — never a number (§17). */
function kindHeading(c: Candidate): string {
  const label = KIND_LABEL[c.kind];
  if (c.confidence === "high") return label;
  return c.confidence === "likely" ? `Likely ${label.toLowerCase()}` : `Possible ${label.toLowerCase()}`;
}

interface Row {
  candidate: Candidate;
  selected: boolean;
  /** Local edits. The candidate itself is never mutated. */
  title: string;
  trigger: string;
  response: string;
  chosen?: MatchOption;
  /** LIFEOS-089. Existing context this capture may belong to. Never persisted. */
  context: CaptureContextSuggestion[];
  /** What the user has accepted of it. Empty means "no link". */
  choice: ContextChoice;
  removed: boolean;
}

/** Kinds whose editable text is the BODY, not the shortened title. */
const BODY_KINDS: CandidateKind[] = ["note", "reflection"];

function rowsFrom(candidates: Candidate[], state: StoreState, today: string): Row[] {
  // §42. Built once per interpretation, not once per candidate: Capture is a
  // hot path and a capture can hold several clauses.
  const index = buildCaptureContextIndex(state);
  return candidates.map((c) => {
    const context = suggestContext(c, state, index);
    return {
    candidate: c,
    // The authority gradient decides what arrives ticked (§4).
    selected: preselected(c.authority),
    // A note is edited as its FULL text. Showing the shortened title here would
    // commit the shortened title as the note body — and a resolved date that a
    // note cannot store ("Tuesday") is stripped from the title, so the word
    // would vanish from the record entirely. That is exactly the silent drop
    // §18 forbids: an action moves its date into a field, a note keeps its
    // sentence whole.
    /**
     * LIFEOS-096. The name the record will carry, not the sentence that made it.
     *
     * Applied HERE and nowhere else, because this is the one place both commit
     * paths read from: the review panel renders this value in an editable
     * field, and the auto-finish path commits it. A cleanup applied at the
     * write site instead would save a title the review panel never showed.
     *
     * The user's own edit still wins — `pairsFrom` prefers `r.title` over the
     * candidate's, and this only changes what that field starts as.
     */
    title: BODY_KINDS.includes(c.kind)
      ? (c.fields.body ?? c.fields.title ?? "")
      : cleanCandidateTitle(c, today).title || (c.fields.body ?? ""),
    trigger: c.fields.trigger ?? "",
    response: c.fields.response ?? "",
    // LIFEOS-089 replaces the 060 association chip: `suggestContext`'s exact
    // tier IS `matchRecords`, so keeping both would print the same match twice.
    chosen: undefined,
    context,
    choice: defaultChoice(context),
    removed: false,
    };
  });
}

export default function CaptureComposer({ onFinished }: {
  /**
   * The capture that just finished, or null.
   *
   * LIFEOS-095 §18. The finished panel and the recent list's newest row are the
   * same captured moment — the visual review found them stacked, saying the
   * same sentence and the same date twice within 150 px. Home uses this to omit
   * the row while the panel is up, so one moment stays one thing on screen.
   */
  onFinished?: (captureId: string | null) => void;
} = {}) {
  const state = useStore();
  const router = useRouter();
  const today = todayKey();

  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  /**
   * Rescheduling language switches the box into an explicit change state before
   * anything is written (§27). Ordinary capture stays exactly as it was — this
   * branch is entered only when the sentence names both a change and a schedule.
   */
  const [edits, setEdits] = useState<TemporalEditIntent[] | null>(null);
  /** True once the new half of a mixed utterance has been saved (§16). */
  const [committed, setCommitted] = useState(false);
  /**
   * LIFEOS-095 §10. What just happened, when the capture finished by itself.
   *
   * Presentation only — it is rebuilt from the store at commit time and thrown
   * away on the next submit. Nothing about it is persisted (§34).
   */
  const [finished, setFinished] = useState<{
    captureId: string;
    outcomes: CaptureOutcome[];
    /** §9. Context 089 offered that nobody has said yes to yet, by action id. */
    offers: { actionId: string; offer: ContextOffer }[];
  } | null>(null);
  /** §29. Set when interpretation failed but the words were kept anyway. */
  const [kept, setKept] = useState(false);
  /** LIFEOS-097 §5. Which just-saved record has its correction sheet open. */
  const [correcting, setCorrecting] = useState<string | null>(null);

  const projectTitles = useMemo(
    () => buildEscalationContext("", state).projectTitles,
    [state],
  );

  const live = rows?.filter((r) => !r.removed) ?? [];
  const chosenCount = live.filter((r) => r.selected).length;
  // A suggest-only row has no checkbox, so it must not count toward "all" —
  // otherwise the button reads "Confirm 2" beside two ticked boxes and a third
  // row that was never selectable (§6).
  const selectableCount = live.filter((r) => !isSuggestOnly(r.candidate.kind)).length;

  async function look() {
    const src = text.trim();
    if (!src || busy) return;
    setBusy(true);
    // A new submit answers whatever the last one said. Clearing here rather
    // than on every branch below means no path can leave a stale "Saved as…"
    // sitting above a fresh interpretation.
    setFinished(null);
    onFinished?.(null);
    setKept(false);

    // Is this a CHANGE to something that already exists, rather than something
    // new? Checked first, because reading "move the dentist to Friday" as a new
    // action would leave the user with two dentist appointments (§29).
    // Is any part of this a CHANGE to something that already exists, rather
    // than something new? Reading "move the dentist to Friday" as a new action
    // leaves the user with two dentist appointments (LIFEOS-065 §29); reading
    // "I finished the deployment" as a new one leaves the finished thing open
    // beside a note about finishing it (LIFEOS-066 §6).
    //
    // A sentence can be both at once — "I finished deployment and need to email
    // my professor tomorrow" is one completed record and one new one — so the
    // leftover text goes down the ordinary path in the SAME view rather than
    // being discarded (§16).
    const { changes, remainder } = readChanges(src, state, today);
    if (changes.length > 0) {
      setRaw(src);
      setEdits(changes);
      setRows(remainder.trim() ? rowsFrom(interpret(remainder, state, today).candidates, state, today) : null);
      setBusy(false);
      return;
    }

    // Deterministic first, and it renders before any model is considered.
    let interpretation;
    try {
      interpretation = interpret(src, state, today);
    } catch {
      /**
       * §29. The words survive an engine that did not.
       *
       * `commitCapture` with no candidates writes the raw capture and nothing
       * else, which is the honest outcome: it IS saved, and it is NOT
       * organized. Saying both is the only truthful sentence available here.
       */
      commitCapture(src, []);
      setKept(true);
      setText("");
      setBusy(false);
      return;
    }
    setRaw(src);
    const built = rowsFrom(interpretation.candidates, state, today);

    /**
     * LIFEOS-095 §31. The capture that needs nothing from you.
     *
     * Not attempted when the rules escalated: `escalate` means the parser said
     * it was out of its depth, and finishing on a reading that announced its
     * own uncertainty is precisely what the authority gradient exists to stop.
     */
    if (!interpretation.escalate && canFinishWithoutAsking({
      candidates: interpretation.candidates,
      context: built.flatMap((r) => r.context),
      hasPendingEdit: false,
    })) {
      finishNow(src, built);
      setBusy(false);
      return;
    }

    setRows(built);

    // Escalate only when the rules said they were out of their depth (§11).
    // Failure here is a no-op: the candidates above already stand.
    if (interpretation.escalate) {
      setAsked(true);
      try {
        const { result } = await interpretCapture(src, projectTitles);
        const extra = validateAiCandidates(result, interpretation.candidates.length);
        if (extra.length > 0) {
          interpretation = mergeAiCandidates(interpretation, extra);
          setRows(rowsFrom(interpretation.candidates, state, today));
        }
      } catch {
        // Deliberately silent. Nothing was lost, so there is nothing to report,
        // and blaming an API key for a network hiccup was the 055T defect.
      }
    }
    setBusy(false);
  }

  function patch(i: number, next: Partial<Row>) {
    setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...next } : r)) : prev));
  }

  function reset() {
    setText(""); setRows(null); setRaw(""); setAsked(false); setEdits(null); setCommitted(false);
  }

  /** Apply one confirmed change through the existing store setters. */
  function applyEdit(intent: TemporalEditIntent, target: EditTarget, destructive: boolean): string {
    const outcome = applyTemporalEdit(buildProposal(intent, target), EDIT_OPS, {
      confirmDestructive: destructive,
      today,
    });
    toast({ kind: outcome.applied ? "success" : "info", message: outcome.message });
    // Returned so the panel prints what actually happened, not what was asked
    // for. A refusal that reads as a success is a lie about the user's records.
    return outcome.message;
  }

  /**
   * The user disagreed with the change reading. Fall back to ordinary capture
   * on the SAME text, so nothing they typed is lost (§28).
   */
  function keepAsCapture() {
    setEdits(null);
    // The new half of a mixed utterance may already be saved. Re-reading the
    // whole sentence then would offer the user a second copy of what they just
    // confirmed, so this ends the interaction instead.
    if (committed) { reset(); return; }
    setRows(rowsFrom(interpret(raw || text.trim(), state, today).candidates, state, today));
  }

  /** The rows the user ticked, reduced to what becomes a record. */
  function pickedPairs(): { candidate: CommitCandidate; row: Row }[] {
    return pairsFrom(live);
  }

  /**
   * The rows that are actually going to be written, from any row list.
   *
   * Takes the rows rather than reading `live`, because an auto-finished capture
   * commits the rows it JUST built — they have not reached React state yet, and
   * a version of this that read state would silently commit nothing.
   */
  function pairsFrom(source: Row[]): { candidate: CommitCandidate; row: Row }[] {
    return source
      .filter((r) => !r.removed)
      .filter((r) => r.selected)
      .map((r) => {
        const base = toCommitCandidate(r.candidate, r.chosen);
        const candidate: CommitCandidate = {
          ...base,
          // LIFEOS-089 §28. The existing create path, with only the context
          // relationships the user actually left on. `contextFields` returns
          // nothing for a kind that has no field to hold them (§29).
          ...contextFields(acceptedContext(r), r.candidate.kind),
          title: r.title.trim() || base.title,
          body: r.candidate.kind === "note" || r.candidate.kind === "reflection" ? (r.title.trim() || base.body) : base.body,
          trigger: r.trigger.trim() || base.trigger,
          response: r.response.trim() || base.response,
        };
        return { candidate, row: r };
      })
      .filter((x) => isCommittable(x.candidate));
  }

  function pickedCandidates(): CommitCandidate[] {
    return pickedPairs().map((x) => x.candidate);
  }

  /**
   * Send a recognised rule to Personal Code (LIFEOS-080 §6).
   *
   * Everything else the user ticked is saved FIRST, then the navigation
   * happens — leaving the page must not cost them the errand they confirmed in
   * the same breath. The capture is written either way, so the sentence is safe
   * before anything can go wrong.
   *
   * Nothing about the rule itself is created here. The person lands on a
   * prefilled field and presses the button that adopts it, or does not.
   */
  function sendToPersonalCode(r: Row) {
    const statement = r.title.trim() || r.candidate.fields.title || r.candidate.evidence.text;
    if (!personalCodeHandoffHref(statement)) {
      toast({
        kind: "info",
        message: `That's longer than ${MAX_HANDOFF_CHARS} characters — it's saved in your capture, and you can write the rule in Personal Code.`,
      });
      return;
    }
    const { captureId } = commitCapture(raw, pickedCandidates());
    const href = personalCodeHandoffHref(statement, captureId);
    reset();
    if (href) router.push(href);
  }

  /**
   * The suggestions the user left ON, as suggestion rows (§25).
   *
   * Read back from `choice` rather than tracked twice, so the chips on screen
   * and the links that get written cannot disagree.
   */
  function acceptedContext(r: Row): CaptureContextSuggestion[] {
    const ids = new Set([r.choice.projectId, r.choice.goalId].filter(Boolean) as string[]);
    // A Project the user accepted brings its inherited Goal along as a fact,
    // which is what `contextKnowledgeGoal` reads for note-shaped kinds (§16).
    return r.context.filter((s) => !!s.contextId && ids.has(s.contextId));
  }

  /**
   * The one write path (LIFEOS-095 §31).
   *
   * Both the reviewed commit and the auto-finished one come through here, so
   * the Goal-context pairing below cannot exist on one path and be forgotten on
   * the other — which is exactly the kind of drift a second commit site
   * introduces.
   */
  function commitRows(rawText: string, pairs: ReturnType<typeof pickedPairs>) {
    const { captureId, created } = commitCapture(rawText, pairs.map((x) => x.candidate));

    /**
     * §16, §17, §33. A Reflection or a Protocol carries Goal context through
     * `goal.linkedKnowledge` — the relationship that already means "this record
     * is part of that goal's material", with its own setter and its own place
     * on the goal page. Applied AFTER the records exist, and only for the rows
     * whose context the user left on.
     */
    // Paired by position AND checked by kind. `commitCapture` skips a candidate
    // it cannot build, so a bare index would drift and attach a reflection's
    // context to somebody else's record — the kind check is what makes the
    // pairing safe rather than merely usual.
    const KIND_OF: Record<string, string> = {
      action: "action", waiting: "action", note: "note",
      reflection: "reflection", protocol: "protocol",
    };
    for (let i = 0; i < pairs.length; i++) {
      const ref = created[i];
      const { row } = pairs[i];
      if (!ref || ref.kind !== KIND_OF[row.candidate.kind]) continue;
      const goalId = contextKnowledgeGoal(acceptedContext(row), row.candidate.kind);
      if (goalId) linkGoalKnowledge(goalId, ref.kind, ref.id);
    }

    return { captureId, created };
  }

  function confirmSelected() {
    const { created } = commitRows(raw, pickedPairs());
    toast({
      kind: "success",
      message: created.length === 0
        ? "Saved your capture."
        : `Saved ${created.length} thing${created.length === 1 ? "" : "s"}.`,
    });
    // A pending change is a proposal the user has not answered yet. Clearing the
    // whole surface here would discard it and make them retype the sentence.
    if (edits) { setRows(null); setText(""); setCommitted(true); return; }
    reset();
  }

  /**
   * A capture that needed nothing from the person (LIFEOS-095 §10, §31).
   *
   * Written, then DESCRIBED FROM THE STORE — `describeCreated` reads back what
   * actually landed, so the finished state cannot name a record `commitCapture`
   * declined to write. That is the defect behind "Saved 1 thing": a count taken
   * from the input rather than the result.
   *
   * The field is cleared and stays focused, because §10's whole point is that
   * the next thing you want to say is the next thing you should be able to say.
   */
  function finishNow(rawText: string, built: Row[]) {
    const pairs = pairsFrom(built);
    const { captureId, created } = commitRows(rawText, pairs);
    if (created.length === 0) {
      // Nothing was written, so nothing may be claimed. The words are safe —
      // `commitCapture` saves the raw capture before it attempts anything.
      setKept(true);
      setText("");
      return;
    }
    /**
     * §9. The context that was offered and not taken.
     *
     * Paired by position and checked by ref kind, for the same reason
     * `commitRows` pairs its Goal links that way: `commitCapture` skips a
     * candidate it cannot build, so a bare index would attach one row's offer
     * to another row's record.
     */
    const offers: { actionId: string; offer: ContextOffer }[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const ref = created[i];
      if (!ref || ref.kind !== "action") continue;
      for (const offer of contextOffers(pairs[i].row.context, pairs[i].row.choice)) {
        if (!offer.accepted) offers.push({ actionId: ref.id, offer });
      }
    }
    setFinished({ captureId, outcomes: describeCreated(getSnapshot(), created), offers });
    onFinished?.(captureId);
    setText("");
    setRows(null);
    setRaw("");
  }

  /**
   * §31's other half. An undo that is offered has to work.
   *
   * Only the three kinds auto-finish can produce are deletable here, and every
   * primitive already exists. The capture itself is NOT deleted — it goes back
   * to the inbox, which is what "undo" means for a front door: the sentence you
   * typed is still yours (§17), it simply is not filed any more.
   */
  /**
   * §4. The sentence, read back from the store rather than from local state.
   *
   * The textarea was cleared the moment the capture finished, so the composer
   * no longer holds it — and the capture record does. Reading it from there
   * also means the correction sheet shows what was actually SAVED, not what a
   * stale variable remembers.
   */
  function rawOf(captureId: string): string {
    const c = (getSnapshot().captures ?? []).find((x) => x.id === captureId);
    return c ? (c.workingText?.trim() || c.text) : "";
  }

  function undoFinished() {
    if (!finished) return;
    for (const o of finished.outcomes) {
      if (o.kind === "action") deleteAction(o.id);
      else if (o.kind === "note") deleteNote(o.id);
      else if (o.kind === "event") deleteEvent(o.id);
      else continue;
      unlinkCaptureRef(finished.captureId, { kind: o.kind, id: o.id });
    }
    restoreCapture(finished.captureId);
    setFinished(null);
    onFinished?.(null);
    toast({ kind: "info", message: "Undone. Your words are still in the inbox." });
  }

  /**
   * The belief path, kept but demoted (§15).
   *
   * It was the DEFAULT destination of every capture, which is why an errand came
   * back as "N beliefs waiting in your Inbox". It is now a deliberate second
   * choice for text that is genuinely belief-shaped — and it does the work here
   * rather than routing to an empty queue, so the offer is not a dead link.
   */
  async function lookForBeliefs() {
    if (busy) return;
    setBusy(true);
    const src = raw || text.trim();
    const { captureId } = commitCapture(src, []);
    try {
      const { result, source } = await generateBeliefs(src);
      attachProposals(captureId, result, source);
    } catch {
      // The capture is already saved. An empty proposal list is a fine outcome.
    }
    setBusy(false);
    reset();
    router.push("/inbox");
  }

  function keepWholeAsNote() {
    const { created } = commitCapture(raw || text.trim(), [toCommitCandidate(wholeCaptureAsNote(raw || text.trim()))]);
    toast({ kind: "success", message: created.length > 0 ? "Kept as a note." : "Saved your capture." });
    reset();
  }

  return (
    <section>
      {/*
        LIFEOS-095 §7. One question, and then the field.

        This replaced a slogan, a heading and a two-line instructional
        paragraph — 148 px of copy above the primary input of a capture
        product, measured. The instructions were also the least true thing on
        the page after §31: "Nothing is created until you confirm it" stopped
        being so the moment an auto-safe capture began finishing itself.
      */}
      <h1 className="mb-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {HOME_PROMPT}
      </h1>

      <label htmlFor="capture" className="sr-only">{HOME_PROMPT}</label>
      <textarea
        id="capture"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void look(); } }}
        placeholder={HOME_PLACEHOLDER}
        rows={3}
        disabled={busy || !!rows || !!edits}
        className="w-full resize-none rounded-2xl border border-black/[.08] bg-transparent p-5 text-lg leading-relaxed outline-none transition-colors placeholder:text-zinc-400 focus:border-black/[.20] disabled:opacity-60 dark:border-white/[.10] dark:focus:border-white/[.25]"
      />

      {!rows && !edits && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" data-capture-submit onClick={() => void look()} disabled={!text.trim() || busy}
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">
            {busy ? "Reading…" : "Capture"}
          </button>
          <span className="text-xs text-zinc-400">⌘↵</span>
        </div>
      )}

      {edits && (
        <ChangeConfirm intents={edits} onApply={applyEdit} onDismiss={keepAsCapture} />
      )}

      {/* Both panels can be open at once. "I finished deployment and need to
          email my professor tomorrow" is one change and one new thing, and
          showing only the change would silently drop half the sentence (§16). */}
      {rows && (
        <div data-capture-results className="mt-5">
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {edits
              ? (live.length === 1 ? "And 1 new thing:" : `And ${live.length} new things:`)
              : (live.length === 1 ? "I found 1 thing:" : `I found ${live.length} things:`)}
          </p>
          {/*
            LIFEOS-095 §9. Why this one is being shown rather than finished.

            Since §31, most captures never reach this panel — so arriving here
            is now information, and the reader is owed the reason. The sentence
            comes from `askingBecause`, which walks the same clauses in the same
            order as the decision, so the two cannot drift apart.
          */}
          {!edits && askingBecause({
            candidates: live.map((r) => r.candidate),
            context: live.flatMap((r) => r.context),
            hasPendingEdit: false,
          }) && (
            <p data-capture-asking className="mt-0.5 text-[11px] text-zinc-500">
              {askingBecause({
                candidates: live.map((r) => r.candidate),
                context: live.flatMap((r) => r.context),
                hasPendingEdit: false,
              })}
            </p>
          )}

          <ul className="mt-3 flex flex-col gap-2">
            {rows.map((r, i) => r.removed ? null : (
              <li key={r.candidate.id} data-candidate={r.candidate.kind}
                className="rounded-2xl border border-black/[.08] p-3 dark:border-white/[.10]">
                <div className="flex items-start gap-3">
                  {/* A suggest-only kind gets no checkbox (§6). Offering one was
                      the audit's worst finding: the box could be ticked, Confirm
                      pressed, and `commitCapture` would refuse the write while
                      the toast said "Saved your capture." A control that cannot
                      do what it appears to do is worse than no control. */}
                  {isSuggestOnly(r.candidate.kind) ? (
                    <span aria-hidden className="mt-1 h-4 w-4 shrink-0" />
                  ) : (
                    <input type="checkbox" checked={r.selected} onChange={(e) => patch(i, { selected: e.target.checked })}
                      aria-label={`Include: ${r.title}`} className="mt-1 h-4 w-4 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{kindHeading(r.candidate)}</span>
                      {r.candidate.producedBy === "ai" && (
                        <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">AI suggested</span>
                      )}
                      {authorityNote(r.candidate.authority) && (
                        <span className="text-[10px] text-amber-700 dark:text-amber-400">{authorityNote(r.candidate.authority)}</span>
                      )}
                    </div>

                    {r.candidate.kind === "protocol" ? (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">When / if</label>
                        <input value={r.trigger} onChange={(e) => patch(i, { trigger: e.target.value })} aria-label="Protocol trigger"
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
                        <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Then</label>
                        <input value={r.response} onChange={(e) => patch(i, { response: e.target.value })} aria-label="Protocol response"
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12" />
                      </div>
                    ) : (
                      <input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label="Title"
                        className="mt-0.5 w-full rounded-lg border border-transparent bg-transparent px-0 py-0.5 text-sm text-zinc-900 outline-none focus:border-black/10 focus:px-2 dark:text-zinc-100 dark:focus:border-white/12" />
                    )}

                    {/* Extracted fields, stated plainly. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                      {r.candidate.fields.dueDate && !dateNotKept(r.candidate) && (
                        <span data-due>
                          {/* An event happens ON a day; a task is due BY one. */}
                          {r.candidate.kind === "event" ? "" : "Due "}{formatDayKey(r.candidate.fields.dueDate)}
                        </span>
                      )}
                      {r.candidate.fields.time && (
                        <span data-time>{formatLocalTime(r.candidate.fields.time)}</span>
                      )}
                      {r.candidate.fields.recurrence && (
                        <span data-recurrence>{describeRule(r.candidate.fields.recurrence)}</span>
                      )}
                      {r.candidate.fields.waitingOn && (
                        <span data-waiting-on>
                          Waiting on {r.candidate.fields.waitingOn}
                          {/* §10. The object of the wait, when the sentence
                              separated it. Two waits on the same person are the
                              same person, and this is how you can see which is
                              which without reading both titles. */}
                          {r.candidate.fields.waitingFor && (
                            <span data-waiting-for> · for {r.candidate.fields.waitingFor}</span>
                          )}
                        </span>
                      )}
                      {r.candidate.confidence !== "high" && <span>{r.candidate.reason}</span>}
                    </div>

                    {/* A disclosure is shown whatever the confidence — it says
                        what did NOT happen, and hiding it because the routing
                        was certain is exactly backwards (§8). */}
                    {r.candidate.disclosure && (
                      <p data-capture-disclosure className="mt-1.5 text-[11px] text-zinc-500">
                        {r.candidate.disclosure}
                      </p>
                    )}

                    {/* A date the kind cannot hold — said out loud rather than dropped (§18). */}
                    {dateNotKept(r.candidate) && (
                      <p data-date-not-kept className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                        {formatDayKey(r.candidate.fields.dueDate!)} won&apos;t be kept on a {KIND_LABEL[r.candidate.kind].toLowerCase()} —
                        {" "}switch it to an Action to keep the date.
                      </p>
                    )}

                    {/* What could NOT be stored, said out loud (§19). */}
                    {r.candidate.unresolved.length > 0 && (
                      <ul data-unresolved className="mt-1.5 flex flex-col gap-0.5">
                        {r.candidate.unresolved.map((u) => (
                          <li key={`${u.phrase}-${u.reason}`} className="text-[11px] text-amber-700 dark:text-amber-400">
                            “{u.phrase}” — {UNRESOLVED_LABEL[u.reason!]}. It stays in the text.
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* LIFEOS-089. Existing context, replacing the 060
                        association chip — that chip WAS this layer's exact
                        tier, and rendering both put the same match on screen
                        twice (§47). */}
                    <CaptureContext
                      rows={r.context}
                      choice={r.choice}
                      onChange={(choice) => patch(i, { choice })}
                    />

                    {/* The destination a suggest-only kind was missing (§6). */}
                    {isSuggestOnly(r.candidate.kind) && (
                      <div className="mt-2">
                        <button type="button" data-send-personal-code onClick={() => sendToPersonalCode(r)}
                          className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] font-medium text-zinc-700 dark:border-white/[.15] dark:text-zinc-200">
                          {HANDOFF_ACTION_LABEL} →
                        </button>
                        <span className="ml-2 text-[11px] text-zinc-400">You decide there — nothing is saved yet.</span>
                      </div>
                    )}

                    {/* Change my mind about the kind, without retyping (§17). */}
                    {r.candidate.alternates.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-zinc-400">Or:</span>
                        {r.candidate.alternates.map((k) => (
                          <button key={k} type="button"
                            // LIFEOS-080. Was a hand-written ternary that gave
                            // every unlisted kind `confirm` — including
                            // `standard`, which would have handed a checkbox to
                            // the one kind that must never have one. The
                            // authority table is the only thing that decides.
                            onClick={() => patch(i, { candidate: { ...r.candidate, kind: k, authority: authorityFor(k, r.candidate.confidence) }, selected: false })}
                            className="rounded-full border border-black/[.12] px-2 py-0.5 text-zinc-600 dark:border-white/[.15] dark:text-zinc-300">
                            {KIND_LABEL[k]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button type="button" onClick={() => patch(i, { removed: true })} aria-label={`Remove: ${r.title}`}
                    className="shrink-0 rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] text-zinc-500 dark:border-white/[.15]">Remove</button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" data-confirm-all onClick={confirmSelected} disabled={chosenCount === 0}
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900">
              {chosenCount === selectableCount ? "Confirm all" : `Confirm ${chosenCount}`}
            </button>
            {/* The escape hatch. Always here, never conditional (§16). */}
            <button type="button" data-keep-note onClick={keepWholeAsNote}
              className="rounded-full border border-black/[.12] px-4 py-2 text-sm dark:border-white/[.15]">
              Keep the whole thing as a note
            </button>
            <button type="button" onClick={reset} className="text-xs text-zinc-500 underline underline-offset-2">Start over</button>
          </div>

          {/* Belief analysis is still here — as a deliberate choice, not a default (§15). */}
          <p className="mt-4 text-[11px] text-zinc-400">
            Thinking something through rather than getting it done?{" "}
            <button type="button" onClick={() => void lookForBeliefs()} disabled={busy}
              className="underline underline-offset-2 disabled:opacity-50">Look for beliefs in this instead →</button>
          </p>

          {asked && (
            <p className="mt-2 text-[11px] text-zinc-400">
              Part of this didn&apos;t match any rule, so Conqify asked AI for help with it.
            </p>
          )}
        </div>
      )}

      {/*
        §10. What just happened, said once and then left alone.

        The field above is already empty and still focused, so the next thing
        you want to say is the next thing you can say. This block is not a step
        in a flow and there is nothing here to dismiss — the next submit
        replaces it.
      */}
      {finished && (
        <div data-capture-finished className="mt-4 rounded-2xl border border-black/[.06] bg-black/[.02] p-4 dark:border-white/[.08] dark:bg-white/[.03]">
          <ul className="flex flex-col gap-2">
            {finished.outcomes.map((o) => {
              const key = `${o.kind}:${o.id}`;
              /**
               * LIFEOS-097 §5, §21. One Edit per record, not one per capture.
               *
               * Built from the store at render, so the sheet offers the fields
               * this record actually has — a wait gets a person, an action with
               * no date gets no time control.
               */
              const correctable = correctableOutcome(state, { kind: o.kind, id: o.id } as Parameters<typeof correctableOutcome>[1],
                { createdByCapture: createdBy(state, { kind: o.kind, id: o.id } as Parameters<typeof createdBy>[1], finished.captureId) });
              return (
                <li key={key} data-capture-saved={o.kind}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {SAVED_LEAD} {o.label}
                  </p>
                  <Link href={o.href} className="text-sm text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
                    {o.title}
                  </Link>
                  {o.detail && <p className="text-[11px] text-zinc-500">{o.detail}</p>}
                  {correctable && (
                    <button type="button" data-capture-edit={o.id}
                      onClick={() => setCorrecting(correcting === key ? null : key)}
                      className="mt-0.5 text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-200">
                      {correcting === key ? "Close" : "Edit"}
                    </button>
                  )}
                  {correcting === key && correctable && (
                    <CorrectionSheet source={rawOf(finished.captureId)} outcome={correctable}
                      onClose={() => setCorrecting(null)} />
                  )}
                </li>
              );
            })}
          </ul>
          {/*
            §9, §12. The offer that would otherwise have been lost.

            089 suggests context at three tiers, and the `possible` tier arrives
            switched OFF — correctly, the evidence is weaker. In the review
            panel the person sees the offer and decides. A capture that finishes
            by itself never renders that panel, so without this the suggestion
            was declined on their behalf and silently. One chip, one tap.
          */}
          {finished.offers.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {finished.offers.map(({ actionId, offer }) => (
                <button
                  key={`${actionId}:${offer.label}`}
                  type="button"
                  data-capture-offer={offer.label}
                  onClick={() => {
                    updateAction(actionId, offer.projectId
                      ? { projectId: offer.projectId }
                      : { goalId: offer.goalId });
                    setFinished((f) => f && {
                      ...f,
                      outcomes: describeCreated(getSnapshot(), f.outcomes.map((o) => ({ kind: o.kind, id: o.id }))),
                      offers: f.offers.filter((x) => !(x.actionId === actionId && x.offer.label === offer.label)),
                    });
                  }}
                  className="rounded-full border border-black/[.12] px-3 py-1 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"
                >
                  Add to {offer.label}
                </button>
              ))}
            </div>
          )}

          <button type="button" data-capture-undo onClick={undoFinished}
            className="mt-3 rounded-full border border-black/[.12] px-3 py-1 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300">
            Undo
          </button>
        </div>
      )}

      {/* §29. Saved, and not organized. Both halves, because only both are true. */}
      {kept && (
        <p data-capture-kept className="mt-4 text-sm text-zinc-500">
          {KEPT_UNORGANISED}{" "}
          <Link href="/process" className="underline underline-offset-2">Open the inbox →</Link>
        </p>
      )}
    </section>
  );
}
