"use client";

/**
 * Optional demo workspace (LIFEOS-042, Feature 25).
 *
 * Materializes the deterministic release fixture into the local store as a
 * clearly-labelled demo for launch demonstrations — capture → project → action
 * → planning → focus → review, plus document → citation → belief, a maintenance
 * candidate, and insight history. Explicitly user-created, never auto-created,
 * never claimed to be the user's own data, and removable in ONE action. No fake
 * testimonials, no fabricated real usage history.
 */

import { useMemo, useState } from "react";
import { useStore, replaceState } from "@/lib/mvpStore";
import { buildReleaseFixture, addFixture, removeFixture, fixtureRecordCount } from "@/lib/release/fixtures";

const DEMO_ID = "demo";

export default function DemoWorkspace() {
  const state = useStore();
  const count = useMemo(() => fixtureRecordCount(state, DEMO_ID), [state]);
  const [busy, setBusy] = useState(false);

  const onCreate = () => {
    setBusy(true);
    replaceState(addFixture(state, buildReleaseFixture({ fixtureId: DEMO_ID })));
    setBusy(false);
  };
  const onRemove = () => {
    setBusy(true);
    replaceState(removeFixture(state, DEMO_ID));
    setBusy(false);
  };

  return (
    <div data-demo-workspace className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h3 className="text-sm font-semibold">Demo workspace</h3>
      <p className="mt-1 text-[13px] text-zinc-500">A polished, clearly-marked demonstration dataset: capture → project → action → planning → focus → review, with a document, citation, belief, a maintenance candidate, and insight history. It&apos;s ordinary sample data you can remove anytime — never your own, never real usage history.</p>
      {count > 0
        ? <div className="mt-3 flex items-center gap-3"><span className="text-[13px] text-emerald-600 dark:text-emerald-400" role="status" data-demo-present>Demo present ({count} records)</span><button type="button" onClick={onRemove} disabled={busy} data-demo-remove className="rounded-full border border-black/[.12] px-4 py-1.5 text-[13px] dark:border-white/[.15]">Remove demo</button></div>
        : <button type="button" onClick={onCreate} disabled={busy} data-demo-create className="mt-3 rounded-full bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Create demo workspace</button>}
    </div>
  );
}
