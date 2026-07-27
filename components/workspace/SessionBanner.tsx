"use client";

/**
 * Global session banner (LIFEOS-030, Feature 3).
 *
 * When a thinking session is active, a slim sticky banner shows the current
 * workspace, the session type, a live elapsed clock, a quick-notes field, and
 * End / Switch controls. It renders nothing when no session is active, so it
 * never adds chrome to the daily flow. Deterministic and offline — the elapsed
 * clock is a local timer over the stored `startedAt`; no polling, no AI.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { endSession, appendSessionNote, useStore } from "@/lib/mvpStore";
import { activeSession, formatClock, sessionDuration, SESSION_TYPE_ICON, SESSION_TYPE_LABEL } from "@/lib/workspaces/sessions";
import { findWorkspace, workspaceHref } from "@/lib/workspaces/workspace";
import { findGoal, goalHref } from "@/lib/execution/goals";
import { openCommandPalette } from "@/lib/command/events";
import { toast } from "@/lib/ux/feedback";

export default function SessionBanner() {
  const state = useStore();
  const session = activeSession(state);
  const sessionId = session?.id;
  const workspaceId = session?.workspaceId;
  const [, tick] = useState(0);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);

  // Live elapsed clock — one timer, only while a session is active.
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [sessionId]);

  // findWorkspace is a cheap array lookup — no memo needed.
  const ws = workspaceId ? findWorkspace(state, workspaceId) : undefined;
  const goalRec = session?.goalId ? findGoal(state, session.goalId) : undefined;
  if (!session) return null;

  const elapsed = formatClock(sessionDuration(session));

  const saveNote = () => {
    const text = note.trim();
    if (!text) return;
    appendSessionNote(session.id, text);
    setNote("");
    noteRef.current?.focus();
  };

  return (
    <div
      role="region"
      aria-label="Active session"
      className="sticky top-0 z-30 w-full border-b border-amber-500/30 bg-amber-50/90 backdrop-blur dark:border-amber-400/20 dark:bg-amber-950/40"
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 text-sm sm:px-6">
        <span aria-hidden className="text-base">{SESSION_TYPE_ICON[session.type]}</span>
        <div className="flex min-w-0 flex-col leading-tight">
          <Link href={ws ? workspaceHref(ws.id) : "/workspaces"} className="truncate font-medium hover:underline">
            {ws?.name ?? "Workspace"}
          </Link>
          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {SESSION_TYPE_LABEL[session.type]}
            {goalRec && <> · <Link href={goalHref(goalRec.id)} className="hover:underline">◎ {goalRec.title}</Link></>}
            {!goalRec && session.goal ? ` · ${session.goal}` : ""}
          </span>
        </div>
        <span
          aria-label="Elapsed time"
          className="ml-auto font-mono tabular-nums text-xs text-amber-800 dark:text-amber-300"
        >
          ⏱ {elapsed}
        </span>
        <form
          className="flex w-full items-center gap-2 sm:w-auto"
          onSubmit={(e) => { e.preventDefault(); saveNote(); }}
        >
          <input
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Quick note…"
            aria-label="Quick session note"
            className="w-full rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs outline-none focus:border-amber-500 sm:w-40 dark:border-white/10 dark:bg-black/20"
          />
          <button type="submit" className="rounded-full border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/10" aria-label="Add note">
            ＋
          </button>
        </form>
        <button
          type="button"
          onClick={openCommandPalette}
          className="rounded-full border border-black/10 px-2.5 py-1 text-xs hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/10"
          title="Switch workspace or start another session (⌘K)"
        >
          Switch
        </button>
        <button
          type="button"
          onClick={() => { endSession(session.id); toast({ kind: "success", message: "Session ended", detail: ws?.name }); }}
          className="rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
        >
          End session
        </button>
      </div>
    </div>
  );
}
