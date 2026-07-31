"use client";

/**
 * Account deletion workflow (LIFEOS-040, Feature 16).
 *
 * Staged, honest, and reversible until the final confirmation: explain scope →
 * offer export → require the exact confirmation phrase → (re-auth where
 * supported) → run → report. Never implies instant irreversible erasure;
 * discloses tombstone + backup retention. Keyboard-operable (Feature 30).
 */

import { useState } from "react";
import Link from "next/link";
import { initialDeletionState, nextDeletionStage, mayRunDeletion, CONFIRM_PHRASE } from "@/lib/privacy/deletion";
import { deletionDisclosure } from "@/lib/privacy/retention";
import { exportableCategories } from "@/lib/privacy/data-map";

export default function AccountDeletion() {
  const [dstate, setDstate] = useState(initialDeletionState());
  const [phrase, setPhrase] = useState("");
  const send = (event: Parameters<typeof nextDeletionStage>[1]) => setDstate((s) => nextDeletionStage(s, event));

  return (
    <div className="flex flex-col gap-5" data-account-deletion>
      <section className="rounded-2xl border border-rose-500/30 bg-rose-500/[.04] p-4">
        <h2 className="text-sm font-semibold text-rose-700 dark:text-rose-300">Delete your account</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">This permanently deletes your account and content. Before you continue, here is exactly what happens:</p>
        <ul className="mt-2 list-disc pl-5 text-[13px] text-zinc-600 dark:text-zinc-300" data-deletion-disclosure>
          {deletionDisclosure().map((d) => <li key={d}>{d}</li>)}
        </ul>
      </section>

      {dstate.stage === "explain" && (
        <button type="button" onClick={() => send({ type: "start" })} data-deletion-start className="self-start rounded-full border border-rose-500/40 px-4 py-1.5 text-[13px] text-rose-600 dark:text-rose-400">Continue</button>
      )}

      {dstate.stage === "offer-export" && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-deletion-export-offer>
          <h3 className="text-sm font-semibold">Export first?</h3>
          <p className="mt-1 text-[13px] text-zinc-500">You can download a full copy of everything ({exportableCategories().length} categories) before deleting. This is irreversible after you confirm.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            <Link href="/backup" className="rounded-full bg-zinc-900 px-4 py-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Export my data</Link>
            <button type="button" onClick={() => send({ type: "export-then-continue" })} className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]" data-export-then-continue>I&apos;ve exported — continue</button>
            <button type="button" onClick={() => send({ type: "skip-export" })} className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]" data-skip-export>Skip export</button>
          </div>
        </section>
      )}

      {dstate.stage === "confirm" && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-deletion-confirm>
          <h3 className="text-sm font-semibold">Confirm</h3>
          <label className="mt-2 block text-[13px] text-zinc-500">Type <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">{CONFIRM_PHRASE}</span> to confirm.</label>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} data-confirm-phrase aria-label="Confirmation phrase" className="mt-1 w-full rounded-lg border border-black/[.12] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-rose-500 dark:border-white/[.15]" />
          {dstate.error && <p className="mt-1 text-[12px] text-rose-600 dark:text-rose-400" role="alert">{dstate.error}</p>}
          <div className="mt-3 flex gap-2 text-[13px]">
            <button type="button" onClick={() => send({ type: "confirm-phrase", phrase, supportsReauth: false })} data-confirm-delete className="rounded-full bg-rose-600 px-4 py-1.5 font-medium text-white">Delete permanently</button>
            <button type="button" onClick={() => { setPhrase(""); send({ type: "cancel" }); }} data-cancel-delete className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Cancel</button>
          </div>
        </section>
      )}

      {dstate.stage === "running" && mayRunDeletion(dstate) && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-deletion-running>
          <p className="text-sm">Deletion confirmed. New changes are frozen. In production this hands off to account deletion; here your local data can be cleared from the Reliability Center.</p>
          <button type="button" onClick={() => send({ type: "complete" })} className="mt-3 rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Mark complete</button>
        </section>
      )}

      {dstate.stage === "done" && <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[.06] p-4 text-sm" data-deletion-done role="status">Deletion request recorded. Tombstones will propagate to other devices on next sign-in.</p>}
    </div>
  );
}
