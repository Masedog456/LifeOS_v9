"use client";

/**
 * Focus Mode (LIFEOS-037, Features 5–8). A focused working screen centered on
 * one target: title + context, linked hierarchy, current session, notes, linked
 * captures/documents, nearby actions, progress, interruptions, panels, and an
 * exit control. Nonessential navigation is hidden while active (a dedicated,
 * minimal layout). No automatic browser fullscreen. Only bounded, target-related
 * data is loaded — never the whole knowledge graph.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore, startFocus, endFocus } from "@/lib/mvpStore";
import { makeEntityContext, entityRef, entityKindLabel } from "@/lib/entities/entity";
import { activeFocus, focusElapsedMs, FOCUS_PANELS } from "@/lib/planning/focus";
import { formatClock } from "@/lib/workspaces/sessions";
import { actionsForProject } from "@/lib/actions/relationships";
import type { FocusTargetKind, RecordRefLite } from "@/types/mvp";
import FocusPanels from "@/components/planning/FocusPanels";
import InterruptionLog from "@/components/planning/InterruptionLog";
import EntityPicker from "@/components/reviews/EntityPicker";
import { toast } from "@/lib/ux/feedback";

export default function FocusMode() {
  const state = useStore();
  const router = useRouter();
  const search = useSearchParams();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const focus = activeFocus(state);

  // A one-second tick forces the elapsed clock to re-render; the actual time is
  // read inside `focusElapsedMs` (an imported helper), matching SessionBanner.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // Deep links: ?end=1 ends focus; ?kind=&id= starts focus on a target (once at mount).
  const startKind = search.get("kind") as FocusTargetKind | null;
  const startId = search.get("id");
  const shouldEnd = search.get("end") === "1";
  useEffect(() => {
    if (shouldEnd) { endFocus(); return; }
    if (startKind && startId && !activeFocus(state)) {
      const ref: RecordRefLite = { kind: startKind === "custom" ? "custom" : startKind, id: startId };
      const title = entityRef(makeEntityContext(state), ref.kind, ref.id).title;
      startFocus({ targetKind: startKind, ref, title }, { startSession: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!focus) return <StartFocus />;

  const target = entityRef(ctx, focus.ref.kind, focus.ref.id);
  const session = focus.sessionId ? state.sessions.find((s) => s.id === focus.sessionId) : undefined;
  const nearby = focus.targetKind === "project" ? actionsForProject(state, focus.ref.id).filter((a) => a.status === "open" || a.status === "in_progress").slice(0, 6)
    : focus.ref.kind === "action" ? [] : [];
  const linkedCaptures = (state.captures ?? []).filter((c) => (c.linkedProjectIds ?? []).includes(focus.ref.id) || c.sourceContext?.workspaceId === focus.ref.id).slice(0, 5);
  const on = (p: (typeof FOCUS_PANELS)[number]) => focus.panels[p];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10" data-focus-active>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Focus · {focus.targetKind}</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{focus.title || target.title}</h1>
          {focus.ref.kind !== "custom" && target.exists && <Link href={target.href} className="text-xs text-sky-600 hover:underline dark:text-sky-400">Open {entityKindLabel(focus.ref.kind)} →</Link>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {on("timer") && <span className="font-mono tabular-nums text-sm text-amber-700 dark:text-amber-300" data-focus-timer>⏱ {formatClock(focusElapsedMs(focus))}</span>}
          <button type="button" onClick={() => { endFocus(focus.id); toast({ kind: "success", message: "Focus ended" }); router.push("/plan/today"); }} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]" data-focus-exit>Exit focus</button>
        </div>
      </header>

      <div className="mb-4"><FocusPanels focus={focus} /></div>

      <div className="flex flex-col gap-3">
        {on("project_context") && (focus.targetKind === "project" || focus.targetKind === "milestone" || focus.targetKind === "action") && (
          <Panel title="Context">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{target.title}</p>
          </Panel>
        )}
        {on("notes") && <Panel title="Notes"><textarea rows={4} placeholder="Working notes for this focus…" aria-label="Focus notes" className="w-full resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/12" /></Panel>}
        {on("session_activity") && <Panel title="Session">{session ? <p className="text-xs text-zinc-500">Attached session · {session.activity.length} events</p> : <p className="text-xs text-zinc-400">No session attached.</p>}</Panel>}
        {on("current_action") && nearby.length > 0 && <Panel title="Nearby actions"><ul className="flex flex-col gap-0.5">{nearby.map((a) => <li key={a.id} className="truncate text-sm"><Link href={`/actions/${a.id}`} className="hover:underline">{a.title}</Link></li>)}</ul></Panel>}
        {on("captures") && linkedCaptures.length > 0 && <Panel title="Linked captures"><ul className="flex flex-col gap-0.5">{linkedCaptures.map((c) => <li key={c.id} className="truncate text-sm text-zinc-600 dark:text-zinc-300">{(c.workingText ?? c.text).slice(0, 60)}</li>)}</ul></Panel>}
        {on("document") && focus.ref.kind === "document" && target.exists && <Panel title="Document"><Link href={target.href} className="text-sm text-sky-600 hover:underline dark:text-sky-400">Open in the reader →</Link></Panel>}
        <Panel title="Interruptions"><InterruptionLog focus={focus} /></Panel>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]"><h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>{children}</section>;
}

/** The "no active focus" screen — pick a target or set a custom intention. */
function StartFocus() {
  const state = useStore();
  const router = useRouter();
  const [intention, setIntention] = useState("");

  const startOn = (kind: FocusTargetKind, ref: RecordRefLite, title: string) => {
    startFocus({ targetKind: kind, ref, title }, { startSession: false });
    router.refresh();
  };
  const startCustom = () => {
    if (!intention.trim()) return;
    startFocus({ targetKind: "custom", ref: { kind: "custom", id: `custom_${Date.now()}` }, title: intention.trim() }, { startSession: false });
    router.refresh();
  };
  const inProgress = (state.nextActions ?? []).filter((a) => a.status === "in_progress" || a.status === "open").slice(0, 6);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Start focus</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Choose one thing to work on. Focus protects the space to carry it out — nothing else is decided for you.</p>
      </header>
      <section className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500">A custom intention</p>
        <div className="flex gap-2">
          <input value={intention} onChange={(e) => setIntention(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") startCustom(); }} placeholder="e.g. Think through the Q3 plan" aria-label="Custom intention" className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/12" />
          <button type="button" onClick={startCustom} disabled={!intention.trim()} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Focus</button>
        </div>
      </section>
      <section className="mb-4 rounded-2xl border border-black/[.08] p-4 dark:border-white/[.10]">
        <p className="mb-1.5 text-xs font-semibold text-zinc-500">Or a record</p>
        <EntityPicker onPick={(r, title) => startOn(r.kind === "project" ? "project" : r.kind === "document" ? "document" : r.kind === "milestone" ? "milestone" : r.kind === "workspace" ? "workspace" : r.kind === "action" ? "action" : "entity", r, title)} placeholder="Focus on an action / project / document / workspace / entity…" />
      </section>
      {inProgress.length > 0 && (
        <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
          <p className="mb-1.5 text-xs font-semibold text-zinc-500">Quick: an open action</p>
          <ul className="flex flex-col gap-1">{inProgress.map((a) => <li key={a.id}><button type="button" onClick={() => startOn("action", { kind: "action", id: a.id }, a.title)} className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06]">{a.title}</button></li>)}</ul>
        </section>
      )}
      <div className="mt-4"><Link href="/plan" className="text-xs text-zinc-500 hover:underline">← Planning board</Link></div>
    </main>
  );
}
