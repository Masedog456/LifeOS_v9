"use client";

/**
 * "Send beta feedback" (LIFEOS-059 §6).
 *
 * Two things sit side by side here, and the copy keeps them apart because they
 * are governed by different rules:
 *
 *   - the AUTOMATIC record — counts only, content-free by construction
 *   - THIS — free text, written on purpose, by a person who chose to write it
 *
 * What is typed here stays on the device until the tester copies or sends it.
 * There is no upload in this component, deliberately: `FeedbackLink` already
 * routes to whatever channel the deployment configured, and a second, quieter
 * path would make the disclosure above it false.
 *
 * The text is feedback. It is never promoted into a Note, a belief, or
 * Constitution material, and it never enters an AI request — asserted by the
 * beta suite, not merely intended.
 */

import { useState } from "react";
import {
  FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABEL, makeFeedback, saveFeedback, readFeedback,
  type FeedbackCategory,
} from "@/lib/beta/feedback";
import { record as recordBeta } from "@/lib/beta/store";
import { BETA_DISCLOSURE, BETA_DISCLOSURE_HEADING } from "@/lib/beta/disclosure";
import { toast } from "@/lib/ux/feedback";

export default function BetaFeedbackPanel() {
  const [happened, setHappened] = useState("");
  const [expected, setExpected] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("other");
  const [showWhat, setShowWhat] = useState(false);
  const [saved, setSaved] = useState(() => 0);

  const submit = () => {
    const entry = makeFeedback({ happened, expected, category }, new Date().toISOString());
    if (!entry) return;
    saveFeedback(entry);
    // Only that feedback happened, and in which bucket. Never a word of it.
    recordBeta("feedback_submitted", { category: entry.category });
    setHappened(""); setExpected(""); setCategory("other");
    setSaved(readFeedback().length);
    toast({ kind: "success", message: "Saved on this device. Nothing was sent." });
  };

  return (
    <section aria-labelledby="beta-feedback-heading" className="mb-6 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
      <h2 id="beta-feedback-heading" className="text-sm font-semibold">Send beta feedback</h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Tell us what happened in your own words. This is saved on this device only — you choose whether to send it.
      </p>

      <label className="mt-3 block text-xs text-zinc-500" htmlFor="beta-happened">What happened?</label>
      <textarea id="beta-happened" value={happened} onChange={(e) => setHappened(e.target.value)} rows={3}
        className="mt-1 w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]" />

      <label className="mt-3 block text-xs text-zinc-500" htmlFor="beta-expected">What did you expect instead? (optional)</label>
      <textarea id="beta-expected" value={expected} onChange={(e) => setExpected(e.target.value)} rows={2}
        className="mt-1 w-full rounded-lg border border-black/[.10] bg-transparent p-2 text-sm dark:border-white/[.12]" />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FEEDBACK_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-[11px] ${c === category ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>
            {FEEDBACK_CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button type="button" onClick={submit} disabled={!happened.trim()}
          className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          Save feedback
        </button>
        <button type="button" onClick={() => setShowWhat((v) => !v)} className="text-xs text-zinc-500 underline underline-offset-2">
          {BETA_DISCLOSURE_HEADING}
        </button>
        {saved > 0 && <span className="text-xs text-zinc-400">{saved} saved on this device</span>}
      </div>

      {showWhat && (
        <ul className="mt-3 space-y-1 border-t border-black/[.06] pt-3 text-xs text-zinc-500 dark:border-white/[.08]">
          {BETA_DISCLOSURE.map((line) => <li key={line}>· {line}</li>)}
        </ul>
      )}
    </section>
  );
}
