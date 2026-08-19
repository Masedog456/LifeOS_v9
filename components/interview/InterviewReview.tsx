"use client";

/**
 * The review screen (LIFEOS-058 §18).
 *
 * ## The one thing this screen must get right
 *
 * Three kinds of text sit on it, and a reader must never have to guess which is
 * which:
 *
 *   YOUR ANSWERS      the person's own words
 *   CONQIFY'S READING  what the model made of them
 *   PROPOSALS          wording the model is offering
 *
 * They are separated by heading, border and label — not by tone — because a user
 * skimming quickly is exactly the user most at risk of mistaking a machine
 * sentence for something they said.
 *
 * ## Why there is no "Adopt all"
 *
 * The brief forbids it, and the reason is worth restating: a Constitution is a
 * set of decisions, and a button that makes six decisions at once is a button
 * that makes none of them. Every proposal here needs its own click.
 *
 * ## What each button actually does
 *
 *   Edit          rewrites the session-local proposal. Touches no store record.
 *   Adopt         createConstitutionElement → adoptConstitutionElement.
 *   Keep as draft createConstitutionElement only. Never adopted.
 *   Dismiss       marks the proposal dismissed in session state. Writes NOTHING.
 *
 * Dismiss is the important one: a rejected proposal leaves no trace in the
 * store, because a proposal was never in the store to begin with.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, createConstitutionElement, adoptConstitutionElement } from "@/lib/mvpStore";
import { CONSTITUTION_KIND_LABEL, CONSTITUTION_KIND_HINT } from "@/types/mvp";
import type { ConstitutionKind } from "@/types/mvp";
import type { InterviewSession, InterviewProposal } from "@/lib/interview/session";
import { editProposal, setOutcome } from "@/lib/interview/session";
import { QUESTION_BY_ID } from "@/lib/interview/questions";
import { planFromProposal, planToInput } from "@/lib/interview/adopt";
import { findDuplicate, duplicateNotice } from "@/lib/interview/duplicates";
import { classifyStatement, routeOffer } from "@/lib/interview/routing";
import { totalDailyTime, timeObservation, timeCoverageNote } from "@/lib/interview/feasibility";
import { toast } from "@/lib/ux/feedback";

/** A stable band header, so the three kinds of text never blur together. */
function Band({ title, blurb, tone, children }: {
  title: string;
  blurb: string;
  tone: "user" | "ai" | "proposal";
  children: React.ReactNode;
}) {
  const border =
    tone === "user" ? "border-l-2 border-l-zinc-400"
      : tone === "ai" ? "border-l-2 border-l-zinc-300 dark:border-l-zinc-600"
        : "border-l-2 border-l-zinc-900 dark:border-l-zinc-100";
  return (
    <section className={`mb-8 pl-4 ${border}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-zinc-500">{blurb}</p>
      {children}
    </section>
  );
}

function ProposalCard({
  proposal,
  original,
  session,
  onSession,
  onAdopted,
}: {
  proposal: InterviewProposal;
  /** The model's wording before any edit — the baseline for the authorship rule. */
  original: string;
  session: InterviewSession;
  onSession: (s: InterviewSession) => void;
  onAdopted: (elementId: string, statement: string) => void;
}) {
  const state = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(proposal.statement);
  const [kind, setKind] = useState<ConstitutionKind>(proposal.kind);

  const duplicate = useMemo(() => findDuplicate(state, proposal.statement), [state, proposal.statement]);
  const route = useMemo(() => classifyStatement(proposal.statement), [proposal.statement]);

  // The opening statement is a citable answer (it is packed into the answer
  // band), so it must be resolvable here too — otherwise a proposal grounded in
  // it reports "based on 2 answers" under a rationale that says 3, and the one
  // the user actually opened with is the one that goes missing.
  const supporting = proposal.supportingAnswerIds
    .map((id) => {
      if (id === "opening") {
        return session.opening
          ? { questionId: "opening", question: "What you said at the start", text: session.opening }
          : undefined;
      }
      const a = session.answers.find((x) => x.questionId === id);
      if (!a) return undefined;
      return {
        questionId: a.questionId,
        question: QUESTION_BY_ID[a.questionId]?.text
          ?? session.followups.find((f) => f.id === a.questionId)?.text
          ?? "Your answer",
        text: a.text,
      };
    })
    .filter((a): a is { questionId: string; question: string; text: string } => !!a);

  const commit = (adopt: boolean) => {
    const plan = planFromProposal(proposal, original, { adopt });
    const elementId = createConstitutionElement(planToInput(plan));
    if (adopt) {
      // The one and only adoption gate. Nothing else in this feature can set
      // `adoptedAt`, and this call is reachable only from this click.
      adoptConstitutionElement(elementId);
      onAdopted(elementId, proposal.statement);
    }
    onSession(setOutcome(session, proposal.id, adopt ? "adopted" : "kept_draft"));
    toast({
      kind: "success",
      message: adopt ? "Added to your Constitution" : "Saved as a draft — adopt it when you're ready",
    });
  };

  return (
    <li className="rounded-xl border border-black/[.08] p-3 dark:border-white/[.10]">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-400">
          {CONSTITUTION_KIND_LABEL[proposal.kind]}
        </span>
        <span className="text-[11px] text-zinc-400">Suggested by Conqify · not yours until you say so</span>
      </div>

      {editing ? (
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(Object.keys(CONSTITUTION_KIND_LABEL) as ConstitutionKind[]).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${k === kind ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>
                {CONSTITUTION_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="mb-2 text-[11px] text-zinc-500">{CONSTITUTION_KIND_HINT[kind]}</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            aria-label="Proposed statement"
            className="w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]"
          />
          <div className="mt-2 flex gap-3">
            <button type="button" disabled={!text.trim()}
              onClick={() => { onSession(editProposal(session, proposal.id, text, kind)); setEditing(false); }}
              className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
              Save wording
            </button>
            <button type="button" onClick={() => { setText(proposal.statement); setKind(proposal.kind); setEditing(false); }}
              className="text-xs text-zinc-500 underline underline-offset-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="leading-relaxed text-zinc-900 dark:text-zinc-100">{proposal.statement}</p>
      )}

      {proposal.rationale && (
        <p className="mt-2 text-xs text-zinc-500">
          <span className="text-zinc-400">Why Conqify suggested it: </span>{proposal.rationale}
        </p>
      )}

      {supporting.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-zinc-500">Based on {supporting.length} of your answers</summary>
          <ul className="mt-1 space-y-1 border-l border-black/[.08] pl-3 text-xs text-zinc-500 dark:border-white/[.10]">
            {supporting.map((a) => (
              <li key={a.questionId}>
                <span className="text-zinc-400">{a.question}</span>
                <br />“{a.text}”
              </li>
            ))}
          </ul>
        </details>
      )}

      {proposal.fitConfidence && (
        <p className="mt-1 text-[11px] text-zinc-400">
          Fit: {proposal.fitConfidence} — how well this fits as a suggestion, not whether it is right.
        </p>
      )}

      {duplicate && (
        <p className="mt-2 rounded-lg bg-black/[.03] p-2 text-xs text-zinc-600 dark:bg-white/[.04] dark:text-zinc-400">
          {duplicateNotice(duplicate, CONSTITUTION_KIND_LABEL[duplicate.element.kind])}
        </p>
      )}

      {route.route !== "constitution" && (
        <p className="mt-2 rounded-lg bg-black/[.03] p-2 text-xs text-zinc-600 dark:bg-white/[.04] dark:text-zinc-400">
          {routeOffer(route)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Edit
          </button>
        )}
        <button type="button" onClick={() => commit(true)}
          className="rounded-full bg-zinc-900 px-3 py-1 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Adopt
        </button>
        <button type="button" onClick={() => commit(false)} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Keep as draft
        </button>
        <button type="button" onClick={() => onSession(setOutcome(session, proposal.id, "dismissed"))}
          className="text-zinc-500 underline underline-offset-2">
          Dismiss
        </button>
      </div>
    </li>
  );
}

/** The step offered after an adoption (§20). Every option is an existing flow. */
function MakePractical({ elementId, statement }: { elementId: string; statement: string }) {
  return (
    <div className="mt-3 rounded-xl border border-black/[.08] p-3 text-xs dark:border-white/[.10]">
      <p className="text-zinc-700 dark:text-zinc-300">Added: “{statement}”</p>
      <p className="mt-1 text-zinc-500">
        Make this practical — nothing is created for you, each of these opens the normal flow.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href={`/constitution?element=${elementId}`} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Link a practice, action or note
        </Link>
        <Link href={`/protocols?fromConstitution=${elementId}`} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Create a protocol
        </Link>
        <Link href={`/actions?fromConstitution=${elementId}`} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Create an action
        </Link>
      </div>
    </div>
  );
}

export default function InterviewReview({
  session,
  onSession,
  onRestart,
  onFinish,
  originals,
}: {
  session: InterviewSession;
  onSession: (s: InterviewSession) => void;
  onRestart: () => void;
  onFinish: () => void;
  /** The model's original wording per proposal id, for the authorship rule. */
  originals: Record<string, string>;
}) {
  const [adopted, setAdopted] = useState<{ id: string; statement: string }[]>([]);

  const pending = session.proposals.filter((p) => (session.outcomes[p.id] ?? "pending") === "pending");
  const decided = session.proposals.filter((p) => (session.outcomes[p.id] ?? "pending") !== "pending");

  // The literal time arithmetic (§13), over the user's OWN answers only — never
  // over proposals, which would be Conqify totalling up its own suggestions.
  const totals = useMemo(() => totalDailyTime(session.answers.map((a) => a.text)), [session.answers]);
  const timeLine = timeObservation(totals);
  const timeNote = timeCoverageNote(totals);

  return (
    <>
      <Band title="Your answers" blurb="Your own words, exactly as you wrote them." tone="user">
        {session.answers.length === 0 && !session.opening ? (
          <p className="text-xs text-zinc-500">You have not answered anything yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {session.opening && (
              <li>
                <p className="text-xs text-zinc-400">What you said at the start</p>
                <p className="text-zinc-800 dark:text-zinc-200">{session.opening}</p>
              </li>
            )}
            {session.answers.map((a) => (
              <li key={a.questionId}>
                <p className="text-xs text-zinc-400">
                  {QUESTION_BY_ID[a.questionId]?.text ?? session.followups.find((f) => f.id === a.questionId)?.text ?? "Question"}
                </p>
                <p className="text-zinc-800 dark:text-zinc-200">{a.text}</p>
              </li>
            ))}
          </ul>
        )}
        {session.skippedDomains.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            You skipped {session.skippedDomains.length} section{session.skippedDomains.length === 1 ? "" : "s"}. Nothing from
            {session.skippedDomains.length === 1 ? " it" : " them"} was kept or sent anywhere.
          </p>
        )}
      </Band>

      <Band
        title="Conqify's reading"
        blurb="What Conqify made of your answers. This is machine-generated and it can be wrong."
        tone="ai"
      >
        {session.tensions.length === 0 && !timeLine ? (
          <p className="text-xs text-zinc-500">Nothing to add beyond the proposals below.</p>
        ) : (
          <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            {session.tensions.map((t) => (
              <li key={t.id}>{t.observation}</li>
            ))}
            {timeLine && (
              <li>
                {timeLine}
                {timeNote && <span className="block text-xs text-zinc-500">{timeNote}</span>}
              </li>
            )}
          </ul>
        )}
      </Band>

      <Band
        title="Proposed Constitution elements"
        blurb="Suggestions. None of these is part of your Constitution unless you adopt it, one at a time."
        tone="proposal"
      >
        {pending.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {session.proposals.length === 0
              ? "Nothing was proposed. That is a normal outcome — you can answer more questions, or write your own element directly."
              : "You have decided on every proposal."}
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                original={originals[p.id] ?? p.statement}
                session={session}
                onSession={onSession}
                onAdopted={(id, statement) => setAdopted((a) => [...a, { id, statement }])}
              />
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            {decided.filter((p) => session.outcomes[p.id] === "adopted").length} adopted ·{" "}
            {decided.filter((p) => session.outcomes[p.id] === "kept_draft").length} kept as draft ·{" "}
            {decided.filter((p) => session.outcomes[p.id] === "dismissed").length} dismissed
          </p>
        )}
      </Band>

      {adopted.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-medium">Make what you adopted practical</h2>
          {adopted.map((a) => <MakePractical key={a.id} elementId={a.id} statement={a.statement} />)}
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-black/[.06] pt-4 text-xs dark:border-white/[.08]">
        <button type="button" onClick={onRestart} className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          ← Back to the questions
        </button>
        <button type="button" onClick={onFinish} className="rounded-full bg-zinc-900 px-4 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Finish and clear this interview
        </button>
        <Link href="/constitution" className="text-zinc-500 underline underline-offset-2">View your Constitution</Link>
      </div>
    </>
  );
}
