"use client";

/**
 * Action history (LIFEOS-036, Feature 20). Renders the compact, append-only
 * event log — newest first. No full descriptions/notes are duplicated here.
 */

import type { NextAction } from "@/types/mvp";
import { actionHistory, ACTION_LABEL, type ActionEventKind } from "@/lib/actions/history";

export default function ActionHistory({ action }: { action: NextAction }) {
  const events = actionHistory(action);
  if (events.length === 0) return <p className="text-xs text-zinc-500">No history yet.</p>;
  return (
    <ol className="flex flex-col gap-1.5 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2">
          <span className="w-32 shrink-0 text-[10px] text-zinc-400">{new Date(e.at).toLocaleString()}</span>
          <span className="text-zinc-700 dark:text-zinc-200">{ACTION_LABEL[e.action as ActionEventKind] ?? e.action}</span>
          {e.detail && <span className="text-[10px] text-zinc-400">· {e.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
