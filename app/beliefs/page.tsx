"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Belief } from "@/types/mvp";
import {
  affirmBelief,
  captureById,
  questionBelief,
  resetStore,
  reviseBelief,
  useStore,
} from "@/lib/mvpStore";
import { buildRecords } from "@/lib/retrieval/records";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { buildImpact } from "@/lib/ux/confirmations";
import { toast } from "@/lib/ux/feedback";
import { relatedTo } from "@/lib/retrieval/search";
import ThreadLine from "@/components/ThreadLine";
import RetrievalResults from "@/components/RetrievalResults";

const STATUS_LABEL: Record<Belief["status"], string> = {
  accepted: "Accepted",
  questioned: "Questioned",
  revised: "Revised",
  rejected: "Rejected",
};

const STATUS_DOT: Record<Belief["status"], string> = {
  accepted: "bg-emerald-500",
  questioned: "bg-amber-500",
  revised: "bg-sky-500",
  rejected: "bg-zinc-400",
};

function BeliefRow({ belief }: { belief: Belief }) {
  const state = useStore();
  const capture = captureById(state, belief.captureId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(belief.text);
  const [showRelated, setShowRelated] = useState(false);

  // Related evidence from across the library — deterministic, explainable,
  // and collapsed by default. LifeOS never auto-resolves contradictions; it
  // only surfaces what might bear on this belief.
  const related = useMemo(() => {
    if (!open) return [];
    return relatedTo(belief.text, buildRecords(state), state.feedback, { semantic: state.embeddings.length > 0 }).filter(
      (r) => r.record.beliefId !== belief.id,
    );
  }, [open, belief.text, belief.id, state]);

  function saveRevision() {
    if (draft.trim() && draft.trim() !== belief.text) {
      reviseBelief(belief.id, draft);
    }
    setEditing(false);
  }

  return (
    <div className="border-b border-black/[.05] last:border-0 dark:border-white/[.06]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 py-4 text-left"
      >
        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[belief.status]}`} />
        <span className="flex-1">
          <span className="block leading-relaxed text-zinc-900 dark:text-zinc-100">
            {belief.text}
          </span>
          <span className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span>{STATUS_LABEL[belief.status]}</span>
            {belief.revisions.length > 1 && (
              <span>· {belief.revisions.length} versions</span>
            )}
            <span>· updated {new Date(belief.updatedAt).toLocaleDateString()}</span>
          </span>
        </span>
        <span className="mt-1 text-zinc-300 dark:text-zinc-600">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="mb-4 ml-5 flex flex-col gap-5 border-l border-black/[.06] pl-5 dark:border-white/[.08]">
          {/* Original capture */}
          {capture && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                Original capture
              </p>
              <blockquote className="mt-1 border-l-2 border-zinc-200 pl-3 text-sm text-zinc-500 dark:border-zinc-700">
                {capture.text}
              </blockquote>
            </div>
          )}

          {/* Thread line — the belief bending over time */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Thread
            </p>
            <div className="mt-2">
              <ThreadLine revisions={belief.revisions} />
            </div>
          </div>

          {/* Meta */}
          <p className="text-xs text-zinc-400">
            Created {new Date(belief.createdAt).toLocaleDateString()} ·{" "}
            {belief.judgments.length} judgment
            {belief.judgments.length === 1 ? "" : "s"}
          </p>

          {/* Compare / challenge this belief (entry points) */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href={`/compare?belief=${belief.id}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Compare this belief with sources →
            </Link>
            <Link
              href={`/inquiry?belief=${belief.id}&q=${encodeURIComponent(`What is the strongest objection to: ${belief.text}`)}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Challenge this belief →
            </Link>
            <Link
              href={`/threads?seedType=belief&seedId=${belief.id}&title=${encodeURIComponent(belief.theme || belief.text.slice(0, 40))}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Create Megathread →
            </Link>
            <Link
              href={`/reason?mode=support_audit&belief=${belief.id}&q=${encodeURIComponent(`How well supported is: ${belief.text.slice(0, 50)}`)}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Audit support →
            </Link>
            <Link
              href={`/decisions?belief=${belief.id}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Use in a decision →
            </Link>
            <Link
              href={`/formation?belief=${belief.id}&type=open`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Reflect on this →
            </Link>
            <Link
              href={`/world?tab=Concepts&name=${encodeURIComponent(belief.theme || belief.text.slice(0, 40))}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Model as a concept →
            </Link>
            <Link
              href={`/research?belief=${belief.id}&q=${encodeURIComponent(`Investigate: ${belief.text.slice(0, 60)}`)}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Investigate this →
            </Link>
            <Link
              href={`/dialogue?belief=${belief.id}&topic=${encodeURIComponent(belief.text.slice(0, 80))}`}
              className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Question in dialogue →
            </Link>
          </div>

          {/* Related evidence — collapsed, never auto-resolving */}
          {related.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRelated((s) => !s)}
                className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showRelated ? "Hide" : "Show"} related evidence ({related.length})
              </button>
              {showRelated && (
                <div className="mt-1">
                  <RetrievalResults results={related} />
                </div>
              )}
            </div>
          )}

          {/* Evolve this belief over time */}
          {editing ? (
            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-none rounded-xl border border-black/[.12] bg-transparent p-3 leading-relaxed outline-none focus:border-black/[.25] dark:border-white/[.15] dark:focus:border-white/[.30]"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={saveRevision}
                  className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Save revision
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(belief.text);
                    setEditing(false);
                  }}
                  className="rounded-full px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            belief.status !== "rejected" && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
                >
                  Revise
                </button>
                <button
                  type="button"
                  onClick={() => affirmBelief(belief.id)}
                  className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
                >
                  Still true
                </button>
                <button
                  type="button"
                  onClick={() => questionBelief(belief.id)}
                  className="rounded-full px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Question
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function BeliefsPage() {
  const state = useStore();
  const [showArchived, setShowArchived] = useState(false);

  const active = state.beliefs.filter((b) => b.status !== "rejected");
  const archived = state.beliefs.filter((b) => b.status === "rejected");

  if (state.beliefs.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <p className="text-lg text-zinc-700 dark:text-zinc-300">
          Your belief ledger is empty — for now.
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">
          As you capture thoughts and decide what you believe, your beliefs will
          gather here — and you&apos;ll be able to watch them change over time.
        </p>
        <Link
          href="/"
          className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Capture your first thought →
        </Link>
      </main>
    );
  }

  // Group active beliefs by theme.
  const groups = new Map<string, Belief[]>();
  for (const b of active) {
    const key = b.theme?.trim() || "Reflections";
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  const themes = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const questioned = active.filter((b) => b.status === "questioned").length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <header className="mb-10 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            What I currently believe
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {active.length} belief{active.length === 1 ? "" : "s"} across{" "}
            {themes.length} theme{themes.length === 1 ? "" : "s"}
            {questioned > 0 && ` · ${questioned} still open`}
          </p>
        </div>
        {active.length >= 2 && (
          <Link
            href="/reason?mode=contradiction_audit&q=What%20tensions%20exist%20among%20my%20beliefs%3F"
            className="shrink-0 rounded-full border border-black/[.12] px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/[.15] dark:hover:bg-white/[.06]"
          >
            Find tensions
          </Link>
        )}
      </header>

      <div className="flex flex-col gap-10">
        {themes.map((theme) => (
          <section key={theme}>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {theme}
            </h2>
            <div>
              {groups.get(theme)!.map((belief) => (
                <BeliefRow key={belief.id} belief={belief} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {archived.length > 0 && (
        <section className="mt-12">
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 opacity-60">
              {archived.map((belief) => (
                <BeliefRow key={belief.id} belief={belief} />
              ))}
            </div>
          )}
        </section>
      )}

      <ResetLocalData />
    </main>
  );
}

/** Prototype maintenance affordance: wipe all local (this-browser) data. */
function ResetLocalData() {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <footer className="mt-16 border-t border-black/[.05] pt-6 dark:border-white/[.06]">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Reset local prototype data
        </button>
      </footer>
    );
  }

  return (
    <footer className="mt-16 border-t border-black/[.05] pt-6 dark:border-white/[.06]">
      <p className="text-xs text-zinc-500">
        Delete all captures, proposals, and beliefs stored in this browser?
        This cannot be undone.
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            requestConfirm({ impact: buildImpact({} as never, "reset", "reset"), confirmLabel: "Reset everything", onConfirm: () => { resetStore(); toast({ kind: "success", message: "All local data reset" }); } });
          }}
          className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
        >
          Yes, delete everything
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </footer>
  );
}
