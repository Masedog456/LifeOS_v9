"use client";

/**
 * Planning board (LIFEOS-037, Feature 2). Five columns (Today · This Week · Later
 * · Someday · Unscheduled) of compact cards, with drag-and-drop, keyboard
 * movement (select cards, press 1–5 to move to a column), multi-select movement,
 * filtering, collapsed groups, and a mobile list fallback. Queue memory (filter /
 * collapsed / mobile) persists. A move changes ONLY the horizon + order.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore, setPlanningHorizon, removeFromPlanning, batchPlanningHorizon } from "@/lib/mvpStore";
import PlanningMaintenanceHint from "@/components/maintenance/PlanningMaintenanceHint";
import PlanningInsightsContext from "@/components/insights/PlanningInsightsContext";
import { makeEntityContext } from "@/lib/entities/entity";
import { deriveBoard, boardCounts, type BoardFilter } from "@/lib/planning/board";
import { resolveCardMeta } from "@/lib/planning/card-meta";
import { BOARD_COLUMNS, HORIZON_LABEL } from "@/lib/planning/horizon";
import type { PlanningHorizon, RecordRefLite } from "@/types/mvp";
import { readPlanningMemory, writePlanningMemory } from "@/lib/planning/memory";
import PlanningColumn from "@/components/planning/PlanningColumn";
import { toast } from "@/lib/ux/feedback";

const KEY_TO_HORIZON: Record<string, PlanningHorizon> = { "1": "today", "2": "this_week", "3": "later", "4": "someday", "5": "unscheduled" };
const parseKey = (k: string): RecordRefLite => { const i = k.indexOf(":"); return { kind: k.slice(0, i), id: k.slice(i + 1) }; };

export default function PlanningBoard() {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const mem = readPlanningMemory();

  const [filter, setFilter] = useState<BoardFilter>(mem.filter);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(mem.collapsed);
  const [mobile, setMobile] = useState(mem.mobileView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | undefined>();

  useEffect(() => { writePlanningMemory({ filter, collapsed, mobileView: mobile }); }, [filter, collapsed, mobile]);

  const columns = useMemo(() => deriveBoard(state.planningAssignments ?? [], (ref) => resolveCardMeta(state, ctx, ref), filter), [state, ctx, filter]);
  const counts = useMemo(() => boardCounts(state.planningAssignments ?? []), [state]);

  // Keyboard movement: with cards selected, 1–5 move them to a column.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const h = KEY_TO_HORIZON[e.key];
      if (h && selected.size > 0) { e.preventDefault(); batchPlanningHorizon([...selected].map(parseKey), h); setSelected(new Set()); toast({ kind: "success", message: `Moved ${selected.size} to ${HORIZON_LABEL[h]}` }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const toggleSelect = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const move = (k: string, h: PlanningHorizon) => setPlanningHorizon(parseKey(k), h);
  const remove = (k: string) => { removeFromPlanning(parseKey(k)); toast({ kind: "info", message: "Removed from planning" }); };
  const onDrop = (h: PlanningHorizon) => { if (dragKey) { setPlanningHorizon(parseKey(dragKey), h); setDragKey(undefined); } };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planning board</h1>
          <p className="mt-0.5 text-sm text-zinc-500">What have you chosen to focus on, and when? A horizon is a choice — never a deadline. Moving a card changes only its horizon and order.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Link href="/plan/today" className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">Today Plan</Link>
          <button type="button" onClick={() => setMobile((v) => !v)} className="rounded-full border border-black/[.12] px-3 py-1.5 text-xs dark:border-white/[.15]">{mobile ? "Board" : "List"}</button>
        </div>
      </header>

      <PlanningMaintenanceHint />
      <PlanningInsightsContext />

      {/* Filter row. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={filter.text ?? ""} onChange={(e) => setFilter({ ...filter, text: e.target.value })} placeholder="Filter…" aria-label="Filter board" className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/12" />
        <select value={filter.kind ?? ""} onChange={(e) => setFilter({ ...filter, kind: e.target.value || undefined })} aria-label="Filter type" className="rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12">
          <option value="">All types</option>
          {["action", "milestone", "project", "document", "capture", "open_loop"].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={filter.context ?? ""} onChange={(e) => setFilter({ ...filter, context: e.target.value || undefined })} placeholder="Context" aria-label="Filter context" className="w-24 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/12" />
        {selected.size > 0 && <span className="ml-auto text-[11px] text-zinc-500">{selected.size} selected · press 1–5 to move</span>}
      </div>

      {mobile ? (
        <div className="flex flex-col gap-4">
          {columns.map((c) => (
            <div key={c.horizon}>
              <h2 className="mb-1 text-xs font-semibold text-zinc-500">{HORIZON_LABEL[c.horizon]} <span className="text-zinc-400">· {counts[c.horizon]}</span></h2>
              <PlanningColumn column={c} selected={selected} collapsed={!!collapsed[c.horizon]} onToggleCollapse={() => setCollapsed({ ...collapsed, [c.horizon]: !collapsed[c.horizon] })} onToggleSelect={toggleSelect} onMove={move} onRemove={remove} onDrop={onDrop} onDragStartCard={setDragKey} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {BOARD_COLUMNS.map((h) => {
            const c = columns.find((x) => x.horizon === h)!;
            return <PlanningColumn key={h} column={c} selected={selected} collapsed={!!collapsed[h]} onToggleCollapse={() => setCollapsed({ ...collapsed, [h]: !collapsed[h] })} onToggleSelect={toggleSelect} onMove={move} onRemove={remove} onDrop={onDrop} onDragStartCard={setDragKey} />;
          })}
        </div>
      )}
    </main>
  );
}
