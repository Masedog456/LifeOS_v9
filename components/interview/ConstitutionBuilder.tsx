"use client";

/**
 * The Life Architecture Interview (LIFEOS-058).
 *
 * ## The chain this screen implements, and never collapses
 *
 *   USER EXPERIENCE → USER ANSWER → AI INTERPRETATION → PROPOSAL
 *     → EXPLICIT HUMAN ADOPTION → CONSTITUTION → OPERATIONAL LINKS
 *
 * Every arrow is a separate step with a separate surface. Nothing skips one.
 *
 * ## What this component may and may not do
 *
 * It may ask, record, and request suggestions. It may NOT create a Constitution
 * element — only `InterviewReview`'s buttons do that, and only through
 * `createConstitutionElement` + `adoptConstitutionElement`. There is no code
 * path from an answer to the store that does not pass through a click.
 *
 * ## Cost discipline (§24)
 *
 * AI is called at exactly two moments, both after a *batch* of answers:
 *
 *   1. when the user finishes a domain — one follow-up call
 *   2. when the user opens the review — one synthesis call
 *
 * Never on keystroke, never on blur, never on a timer, never in the background.
 * `session.aiCalls` counts them and the tests assert the count.
 *
 * ## Failure behaviour
 *
 * `lib/aiClient` already falls back to deterministic output on any failure, so
 * an outage costs the user suggestion QUALITY, never their answers. The screen
 * says which happened rather than pretending the offline output came from a
 * model.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useStore, createNote } from "@/lib/mvpStore";
import { DEGRADED_MESSAGE, interviewFollowups, interviewSynthesis, type DegradedReason } from "@/lib/aiClient";
import {
  LIFE_DOMAINS, DOMAIN_BY_ID, START_MODE_LABEL, START_MODE_BLURB, FRICTION_EXAMPLES,
  domainOrder, questionsForDomain, QUESTION_BY_ID,
} from "@/lib/interview/questions";
import type { DomainId, StartMode } from "@/lib/interview/questions";
import {
  startSession, recordAnswer, answerFor, answeredIds, skipDomain, addFollowups,
  mergeProposals, countAiCall, domainProgress, addInfluence, removeInfluence, addNamedInfluence,
  loadInterviewSession, saveInterviewSession, clearInterviewSession,
} from "@/lib/interview/session";
import type { InterviewSession } from "@/lib/interview/session";
import { buildInterviewContext, citableIds, citableRefs, contextDisclosure } from "@/lib/interview/context";
import { validateFollowups, validateProposals, validateTensions } from "@/lib/interview/proposals";
import { answersAsNoteBody } from "@/lib/interview/adopt";
import { toast } from "@/lib/ux/feedback";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import InterviewReview from "@/components/interview/InterviewReview";

type Phase = "disclosure" | "mode" | "questions" | "influences" | "review";

/** One entry in the question queue: a bank question or a model follow-up. */
interface QueueItem {
  id: string;
  domain: DomainId;
  text: string;
  help?: string;
  fromAi: boolean;
}

/**
 * The starting point, read ONCE from the browser.
 *
 * A lazy `useState` initialiser rather than an effect: resuming is a synchronous
 * read of an external store that is already available by the time this component
 * mounts (the route gates on `mounted`), so an effect would only add a wasted
 * render and a flash of the disclosure screen to a user who is mid-interview.
 */
function initialState(): { session: InterviewSession | null; phase: Phase } {
  const existing = loadInterviewSession();
  if (!existing) return { session: null, phase: "disclosure" };
  return { session: existing, phase: existing.proposals.length > 0 ? "review" : "questions" };
}

/** Flatten the session into the ordered list of questions currently askable. */
function buildQueue(session: InterviewSession): QueueItem[] {
  const answered = answeredIds(session);
  const out: QueueItem[] = [];
  for (const domain of domainOrder(session.mode)) {
    if (session.skippedDomains.includes(domain)) continue;
    for (const q of questionsForDomain(domain, answered)) {
      out.push({ id: q.id, domain, text: q.text, help: q.help, fromAi: false });
    }
    for (const f of session.followups.filter((x) => x.domain === domain)) {
      out.push({ id: f.id, domain, text: f.text, fromAi: true });
    }
  }
  return out;
}

export default function ConstitutionBuilder() {
  const state = useStore();
  const [initial] = useState(initialState);
  const [session, setSessionState] = useState<InterviewSession | null>(initial.session);
  const [phase, setPhase] = useState<Phase>(initial.phase);
  /**
   * Where the user is, tracked by QUESTION ID rather than by index.
   *
   * The queue is derived and mutable — answering unlocks stage-2 questions, a
   * model follow-up appends one, skipping a domain removes several. An index
   * into that list silently means a different question every time it changes,
   * which is how "Back" ends up on a question the user never saw. An id does
   * not move.
   */
  const [currentId, setCurrentId] = useState<string | null>(null);
  /**
   * The in-progress answer, tagged with the question it belongs to.
   *
   * Tagging lets the displayed value be DERIVED during render rather than
   * synchronised by an effect: moving to another question simply makes the tag
   * stale, and the recorded answer shows through. No effect, no cascading
   * render, and no window in which the box shows the previous question's text.
   */
  const [typed, setTyped] = useState<{ questionId: string; text: string } | null>(null);
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const [degraded, setDegraded] = useState<DegradedReason | null>(null);
  const [showShared, setShowShared] = useState(false);
  const [namedInput, setNamedInput] = useState("");
  /** Model wording per proposal id, captured at merge time (authorship rule). */
  const [originals, setOriginals] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial.session?.proposals ?? []).map((p) => [p.id, p.statement])));

  const setSession = useCallback((next: InterviewSession) => {
    setSessionState(next);
    saveInterviewSession(next);
  }, []);

  const queue = useMemo(() => (session ? buildQueue(session) : []), [session]);
  // Resolve the id to a position. A question that has vanished (its domain was
  // skipped) falls back to the front of what remains rather than to a blank
  // screen.
  const cursor = Math.max(0, queue.findIndex((q) => q.id === currentId));
  const current = queue[cursor];
  const goTo = (index: number) => {
    const clamped = Math.min(Math.max(0, index), Math.max(0, queue.length - 1));
    setCurrentId(queue[clamped]?.id ?? null);
  };

  // Derived, not synchronised: what is typed for THIS question, else what was
  // already recorded for it, else empty.
  const draft =
    typed && current && typed.questionId === current.id
      ? typed.text
      : session && current
        ? answerFor(session, current.id)?.text ?? ""
        : "";
  const setDraft = (text: string) => { if (current) setTyped({ questionId: current.id, text }); };

  // ------------------------------------------------------------ AI requests --

  /** One follow-up call, after a domain's answers are in. */
  const requestFollowups = useCallback(async (s: InterviewSession, domain: DomainId, lastAnswerId: string) => {
    setBusy(true);
    try {
      const ctx = buildInterviewContext(state, s, { includeConstitution: false, includeSources: false });
      const res = await interviewFollowups(ctx.items);
      const valid = validateFollowups(res.result);
      setDegraded(res.degradedReason ?? null);
      return addFollowups(countAiCall(s), domain, lastAnswerId, valid.value);
    } finally {
      setBusy(false);
    }
  }, [state]);

  /** One synthesis call, when the user opens the review. */
  const requestSynthesis = useCallback(async (s: InterviewSession) => {
    setBusy(true);
    try {
      const ctx = buildInterviewContext(state, s, { includeConstitution: true, includeSources: true });
      const res = await interviewSynthesis(ctx.items);
      const vctx = { knownAnswerIds: citableIds(ctx), allowedRefs: citableRefs(ctx, s) };
      const proposals = validateProposals(res.result, vctx);
      const tensions = validateTensions(res.result, vctx);
      setDegraded(res.degradedReason ?? null);
      let next = mergeProposals(countAiCall(s), proposals.value);
      next = {
        ...next,
        tensions: tensions.value.map((t, i) => ({ ...t, id: `tension_${i}` })),
      };
      setOriginals((o) => {
        const merged = { ...o };
        for (const p of next.proposals) if (!(p.id in merged)) merged[p.id] = p.statement;
        return merged;
      });
      return next;
    } finally {
      setBusy(false);
    }
  }, [state]);

  // ---------------------------------------------------------------- actions --

  const begin = (mode: StartMode) => {
    const at = new Date().toISOString();
    const s = startSession(mode, at, at);
    setSession(mode === "friction" && opening.trim() ? { ...s, opening: opening.trim() } : s);
    setCurrentId(buildQueue(s)[0]?.id ?? null);
    setPhase("questions");
  };

  const saveAndNext = async () => {
    if (!session || !current) return;
    let next = recordAnswer(session, current.id, current.domain, draft, new Date().toISOString());
    const nextItem = queue[cursor + 1];
    const leavingDomain = !!nextItem && nextItem.domain !== current.domain;
    const atEnd = cursor + 1 >= queue.length;

    // The batch boundary: one call when a domain is finished, and only if the
    // user actually answered something in it.
    if ((leavingDomain || atEnd) && next.answers.some((a) => a.domain === current.domain)) {
      next = await requestFollowups(next, current.domain, current.id);
    }
    setSession(next);
    // The queue may have grown (a follow-up was appended); advance relative to
    // the NEW queue, positioned by the id we just answered.
    const grown = buildQueue(next);
    const here = grown.findIndex((q) => q.id === current.id);
    const nextIndex = here + 1;
    if (nextIndex >= grown.length) setPhase("influences");
    else setCurrentId(grown[nextIndex].id);
  };

  const skipCurrentDomain = () => {
    if (!session || !current) return;
    const domain = current.domain;
    const next = skipDomain(session, domain);
    setSession(next);
    // Land on the first question of whatever domain comes next, not on whatever
    // happens to sit at the old index.
    const grown = buildQueue(next);
    if (grown.length === 0) { setCurrentId(null); setPhase("influences"); }
    else setCurrentId((grown.find((q) => q.domain !== domain) ?? grown[0]).id);
    toast({ kind: "info", message: `${DOMAIN_BY_ID[domain].label} skipped — nothing from it was kept.` });
  };

  const openReview = async () => {
    if (!session) return;
    setSession(await requestSynthesis(session));
    setPhase("review");
  };

  /** Both exits destroy the local answers; only the wording differs. */
  const endInterview = (verb: string, linkedNote: string, severity: "normal" | "high", done?: () => void) => {
    if (!session) return;
    requestConfirm({
      impact: {
        name: `${session.answers.length} answer${session.answers.length === 1 ? "" : "s"} in this interview`,
        typeLabel: "Constitution Builder",
        verb,
        children: [],
        linkedNote,
        undoable: false,
        severity,
      },
      confirmLabel: verb,
      onConfirm: () => {
        clearInterviewSession();
        setSessionState(null);
        setPhase("disclosure");
        done?.();
      },
    });
  };

  const finish = () =>
    endInterview(
      "Finish and clear",
      "Your answers are deleted from this browser. Anything you adopted or kept as a draft stays on your Constitution.",
      "normal",
      () => toast({ kind: "success", message: "Interview cleared. What you adopted is on your Constitution." }),
    );

  const discard = () =>
    endInterview(
      "Discard everything",
      "Every answer you have given is deleted from this browser. Nothing is added to your Constitution.",
      "high",
    );

  const keepAnswersAsNote = () => {
    if (!session || session.answers.length === 0) return;
    const body = answersAsNoteBody(
      session.answers.map((a) => ({
        question: QUESTION_BY_ID[a.questionId]?.text ?? session.followups.find((f) => f.id === a.questionId)?.text ?? "Question",
        answer: a.text,
      })),
    );
    // An ordinary Note through the ordinary action: user-authored by
    // construction, and deletable exactly like every other note.
    createNote({ title: "Constitution Builder — my answers", body, tags: [] });
    toast({ kind: "success", message: "Saved to Notes in your own words." });
  };

  // ------------------------------------------------------------------ views --

  const header = (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">Constitution Builder</h1>
      <p className="mt-2 text-xs">
        <Link href="/constitution" className="text-zinc-500 underline underline-offset-2">← Back to your Constitution</Link>
      </p>
    </header>
  );

  // ---- 1. disclosure (§2). The interview cannot start without this step. ----
  if (phase === "disclosure") {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {header}
        <section className="rounded-2xl border border-black/[.08] p-5 dark:border-white/[.10]">
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            This process helps you think through what matters, what is difficult, and how you want to
            live. Conqify may suggest wording, but nothing becomes part of your Constitution until you
            choose it.
          </p>
          <ul className="mt-4 space-y-1.5 text-xs text-zinc-500">
            <li>· AI is involved. Your answers are sent to a model to generate questions and suggestions.</li>
            <li>· Your answers may contain sensitive things. Every question is optional and every section can be skipped.</li>
            <li>· Anything Conqify proposes is a draft. Adoption is always an explicit, separate choice.</li>
            <li>· Your answers stay in this browser. They are not synced, not exported, and not backed up.</li>
            <li>· Signing out or clearing your data deletes them.</li>
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => setPhase("mode")}
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              I understand — start
            </button>
            <Link href="/constitution" className="text-xs text-zinc-500 underline underline-offset-2">
              Not now
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // ---- 2. start mode (§3) ----
  // Also the fallback for a missing session in any later phase: `startSession`
  // is the only constructor, so "no session" always means "has not chosen a
  // starting point yet" — never a crash and never a silently blank screen.
  if (phase === "mode" || !session) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {header}
        <p className="mb-4 text-sm text-zinc-500">Where would you rather start? You can move between these at any point.</p>
        <div className="space-y-3">
          <section className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
            <h2 className="text-sm font-medium">{START_MODE_LABEL.friction}</h2>
            <p className="mb-3 mt-0.5 text-xs text-zinc-500">{START_MODE_BLURB.friction}</p>
            <textarea value={opening} onChange={(e) => setOpening(e.target.value)} rows={3}
              aria-label="What feels hardest right now"
              placeholder="What feels hardest, most disorganized, or most important to change right now?"
              className="w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FRICTION_EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setOpening((o) => (o ? o : x))}
                  className="rounded-full border border-black/[.12] px-2.5 py-0.5 text-[11px] text-zinc-600 dark:border-white/[.15] dark:text-zinc-400">
                  {x}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => begin("friction")}
              className="mt-3 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Start here
            </button>
          </section>
          <section className="rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
            <h2 className="text-sm font-medium">{START_MODE_LABEL.stocktake}</h2>
            <p className="mb-3 mt-0.5 text-xs text-zinc-500">{START_MODE_BLURB.stocktake}</p>
            <button type="button" onClick={() => begin("stocktake")}
              className="rounded-full border border-black/[.12] px-4 py-1.5 text-xs dark:border-white/[.15]">
              Start here
            </button>
          </section>
        </div>
      </main>
    );
  }

  const sharedLines = contextDisclosure(
    buildInterviewContext(state, session, { includeConstitution: true, includeSources: true }),
  );

  const footer = (
    <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-black/[.06] pt-4 text-xs dark:border-white/[.08]">
      <button type="button" onClick={() => setShowShared((v) => !v)} className="text-zinc-500 underline underline-offset-2">
        What was shared with AI?
      </button>
      <button type="button" onClick={keepAnswersAsNote} disabled={session.answers.length === 0}
        className="text-zinc-500 underline underline-offset-2 disabled:opacity-40">
        Keep my answers as a note
      </button>
      <button type="button" onClick={discard} className="text-zinc-500 underline underline-offset-2">
        Discard this interview
      </button>
      {degraded && <span className="text-zinc-400">{DEGRADED_MESSAGE[degraded]}</span>}
      {showShared && (
        <ul className="w-full space-y-0.5 pt-2 text-zinc-400">
          {sharedLines.map((l, i) => <li key={i}>{l}</li>)}
          <li>AI calls made in this interview: {session.aiCalls}.</li>
        </ul>
      )}
    </div>
  );

  // ---- 3. influences (§11) ----
  if (phase === "influences") {
    const records = [
      ...(state.sources ?? []).map((s) => ({ ref: { kind: "document", id: s.id }, label: s.title, group: "Reading" })),
      ...(state.notes ?? []).filter((n) => !n.archived).map((n) => ({ ref: { kind: "note", id: n.id }, label: n.title || n.body.slice(0, 60), group: "Notes" })),
      ...(state.practices ?? []).map((p) => ({ ref: { kind: "practice", id: p.id }, label: p.userWording || p.title, group: "Practices" })),
    ];
    const attached = (r: { kind: string; id: string }) => session.influences.some((x) => x.kind === r.kind && x.id === r.id);
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {header}
        <h2 className="text-sm font-medium">What has shaped how you think about this?</h2>
        <p className="mb-4 mt-0.5 text-xs text-zinc-500">
          Optional. Anything you pick here is something Conqify already has, so it can quote it. A name you
          type is recorded as <em>your</em> statement that it matters to you — Conqify will not claim to know
          what it teaches.
        </p>

        {records.length > 0 && (
          <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto text-sm">
            {records.map((r) => (
              <li key={`${r.ref.kind}:${r.ref.id}`}>
                <button type="button"
                  onClick={() => setSession(attached(r.ref) ? removeInfluence(session, r.ref) : addInfluence(session, r.ref))}
                  className={`w-full rounded-lg border px-3 py-1.5 text-left text-xs ${attached(r.ref) ? "border-zinc-900 dark:border-zinc-100" : "border-black/[.10] dark:border-white/[.12]"}`}>
                  <span className="text-zinc-400">{r.group} · </span>{r.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input value={namedInput} onChange={(e) => setNamedInput(e.target.value)}
            aria-label="A tradition, thinker or book Conqify does not have"
            placeholder="A tradition, thinker or book Conqify does not have"
            className="flex-1 rounded-lg border border-black/[.10] bg-transparent p-2 text-xs dark:border-white/[.12]" />
          <button type="button" disabled={!namedInput.trim()}
            onClick={() => { setSession(addNamedInfluence(session, namedInput)); setNamedInput(""); }}
            className="rounded-full border border-black/[.12] px-3 py-1 text-xs disabled:opacity-40 dark:border-white/[.15]">
            Add
          </button>
        </div>
        {session.namedInfluences.length > 0 && (
          <p className="mb-4 text-xs text-zinc-500">Named: {session.namedInfluences.join(", ")}</p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={openReview} disabled={busy}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            {busy ? "Thinking…" : "See what Conqify makes of this"}
          </button>
          <button type="button" onClick={() => { goTo(queue.length - 1); setPhase("questions"); }}
            className="text-xs text-zinc-500 underline underline-offset-2">
            ← Back to the questions
          </button>
        </div>
        {footer}
      </main>
    );
  }

  // ---- 4. review (§18) ----
  if (phase === "review") {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {header}
        <InterviewReview
          session={session}
          onSession={setSession}
          onRestart={() => { goTo(queue.length - 1); setPhase("questions"); }}
          onFinish={finish}
          originals={originals}
        />
        {footer}
      </main>
    );
  }

  // ---- 5. questions (§17) — one at a time ----
  if (!current) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        {header}
        <p className="text-sm text-zinc-500">You have skipped every section. Nothing was kept.</p>
        <button type="button" onClick={() => setPhase("influences")} className="mt-3 text-xs text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
          Continue anyway
        </button>
        {footer}
      </main>
    );
  }

  const domain = DOMAIN_BY_ID[current.domain];
  const progress = domainProgress(session, current.domain);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      {header}

      {/* Section progress, never a percentage — the path branches, so a
          percentage would be invented precision (§17). */}
      <nav aria-label="Sections" className="mb-6 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        {LIFE_DOMAINS.filter((d) => domainOrder(session.mode).includes(d.id)).map((d) => {
          const p = domainProgress(session, d.id);
          const active = d.id === current.domain;
          return (
            <span key={d.id} className={active ? "text-zinc-900 dark:text-zinc-100" : p.skipped ? "line-through" : ""}>
              {d.label}
              {p.answered > 0 && !p.skipped ? ` · ${p.answered}` : ""}
            </span>
          );
        })}
      </nav>

      <section className="rounded-2xl border border-black/[.08] p-5 dark:border-white/[.10]">
        <p className="text-xs text-zinc-400">
          {domain.label} · {progress.answered} question{progress.answered === 1 ? "" : "s"} answered
          {current.fromAi && " · follow-up suggested by Conqify"}
        </p>
        <h2 className="mt-2 text-lg leading-relaxed text-zinc-900 dark:text-zinc-100">{current.text}</h2>
        {current.help && <p className="mt-1 text-xs text-zinc-500">{current.help}</p>}

        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
          aria-label={current.text}
          placeholder="In your own words. There is no right answer, and you can leave this blank."
          className="mt-4 w-full rounded-lg border border-black/[.10] bg-transparent p-3 text-sm dark:border-white/[.12]" />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <button type="button" onClick={saveAndNext} disabled={busy}
            className="rounded-full bg-zinc-900 px-4 py-1.5 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            {busy ? "Thinking…" : "Next"}
          </button>
          <button type="button" disabled={cursor === 0} onClick={() => goTo(cursor - 1)}
            className="text-zinc-600 underline underline-offset-2 disabled:opacity-40 dark:text-zinc-400">
            Back
          </button>
          <button type="button" onClick={() => goTo(cursor + 1)}
            className="text-zinc-600 underline underline-offset-2 dark:text-zinc-400">
            Skip this question
          </button>
          <button type="button" onClick={skipCurrentDomain}
            className={`underline underline-offset-2 ${domain.sensitive ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-500"}`}>
            Skip all of {domain.label}
          </button>
          {/* Stopping early still routes through the influences step. Skipping
              it would mean the only users ever asked what has shaped their
              thinking are the ones who answered every question to the end. */}
          <button type="button" onClick={() => setPhase("influences")} disabled={busy || session.answers.length === 0}
            className="text-zinc-600 underline underline-offset-2 disabled:opacity-40 dark:text-zinc-400">
            Stop here and review
          </button>
        </div>
      </section>

      {footer}
    </main>
  );
}
