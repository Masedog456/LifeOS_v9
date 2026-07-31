"use client";

/**
 * Optional sample workspace control (LIFEOS-041, Feature 36). Explicitly
 * user-created, clearly marked as sample, removable in one action. Never
 * auto-created; never claims to be the user's own data.
 */

import { useMemo, useState } from "react";
import { useStore, replaceState } from "@/lib/mvpStore";
import { readPrefs, writePrefs } from "@/lib/prefs";
import { buildSampleWorkspace, addSample, removeSample, sampleRecordCount } from "@/lib/onboarding/sample-workspace";

function newId() { return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function SampleWorkspacePreview() {
  const state = useStore();
  const existingId = (readPrefs() as { onboardingV2?: { sampleWorkspaceId?: string } }).onboardingV2?.sampleWorkspaceId;
  const count = useMemo(() => (existingId ? sampleRecordCount(state, existingId) : 0), [state, existingId]);
  const [busy, setBusy] = useState(false);

  const onCreate = () => {
    setBusy(true);
    const build = buildSampleWorkspace({ id: newId, now: () => new Date().toISOString() });
    replaceState(addSample(state, build));
    const prev = (readPrefs().onboardingV2) ?? { version: 1, status: "in-progress" as const, completedSteps: [], skippedSteps: [], resetCounter: 0, updatedAt: new Date().toISOString() };
    writePrefs({ onboardingV2: { ...prev, sampleWorkspaceId: build.sampleWorkspaceId } } as never);
    setBusy(false);
  };

  const onRemove = () => {
    if (!existingId) return;
    setBusy(true);
    replaceState(removeSample(state, existingId));
    const prev = readPrefs().onboardingV2;
    if (prev) writePrefs({ onboardingV2: { ...prev, sampleWorkspaceId: undefined } } as never);
    setBusy(false);
  };

  return (
    <div data-sample-workspace className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h3 className="text-sm font-semibold">Sample workspace</h3>
      <p className="mt-1 text-[13px] text-zinc-500">A small, clearly-marked tour: capture → project → action → focus → review, with a document, citation, belief, and a maintenance candidate. It&apos;s ordinary data you can remove anytime — never mistaken for your own.</p>
      {count > 0
        ? <div className="mt-3 flex items-center gap-3"><span className="text-[13px] text-emerald-600 dark:text-emerald-400" role="status" data-sample-present>Sample present ({count} records)</span><button type="button" onClick={onRemove} disabled={busy} data-sample-remove className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Remove sample</button></div>
        : <button type="button" onClick={onCreate} disabled={busy} data-sample-create className="mt-3 rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create sample workspace</button>}
    </div>
  );
}
