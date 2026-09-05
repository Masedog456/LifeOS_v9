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
} from "@/lib/mvpStore";
import type { StoreState } from "@/types/mvp";
import { interpret, wholeCaptureAsNote, dateNotKept, type Candidate } from "@/lib/capture/interpret";
import { toCommitCandidate, isCommittable, type CommitCandidate } from "@/lib/capture/commit";
import { buildEscalationContext, mergeAiCandidates, validateAiCandidates } from "@/lib/capture/escalation";
import { authorityNote, authorityFor, preselected, isSuggestOnly, type CandidateKind } from "@/lib/capture/authority";
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

function rowsFrom(candidates: Candidate[], state: StoreState): Row[] {
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
    title: BODY_KINDS.includes(c.kind) ? (c.fields.body ?? c.fields.title ?? "") : (c.fields.title ?? c.fields.body ?? ""),
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

export default function CaptureComposer() {
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
      setRows(remainder.trim() ? rowsFrom(interpret(remainder, state, today).candidates, state) : null);
      setBusy(false);
      return;
    }

    // Deterministic first, and it renders before any model is considered.
    let interpretation = interpret(src, state, today);
    setRaw(src);
    setRows(rowsFrom(interpretation.candidates, state));

    // Escalate only when the rules said they were out of their depth (§11).
    // Failure here is a no-op: the candidates above already stand.
    if (interpretation.escalate) {
      setAsked(true);
      try {
        const { result } = await interpretCapture(src, projectTitles);
        const extra = validateAiCandidates(result, interpretation.candidates.length);
        if (extra.length > 0) {
          interpretation = mergeAiCandidates(interpretation, extra);
          setRows(rowsFrom(interpretation.candidates, state));
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
    setRows(rowsFrom(interpret(raw || text.trim(), state, today).candidates, state));
  }

  /** The rows the user ticked, reduced to what becomes a record. */
  function pickedPairs(): { candidate: CommitCandidate; row: Row }[] {
    return live
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

  function confirmSelected() {
    const pairs = pickedPairs();
    const { created } = commitCapture(raw, pairs.map((x) => x.candidate));

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
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">You live. Conqify keeps track.</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          What&apos;s on your mind?
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          Errands, appointments, ideas, things you&apos;re waiting on — say it however it comes out. Conqify sorts it and you confirm.
        </p>
      </div>

      <label htmlFor="capture" className="sr-only">What&apos;s on your mind?</label>
      <textarea
        id="capture"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void look(); } }}
        placeholder="Call the dentist tomorrow, finish the report, and Marcus still owes me the file…"
        rows={4}
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

      {!rows && !edits && (
        <p className="mt-6 text-sm leading-relaxed text-zinc-400">
          Start messy. Nothing is created until you confirm it, and{" "}
          <Link href="/notes" className="underline underline-offset-2">a note</Link> is always a valid answer.
        </p>
      )}
    </section>
  );
}
