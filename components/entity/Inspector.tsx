"use client";

/**
 * Unified Inspector (LIFEOS-029, Features 6, 9, 12).
 *
 * ONE inspector for every entity — a right-side panel on desktop, a bottom sheet
 * on mobile. Opening any entity (via `openInspector`) updates it in place; there
 * is no per-page implementation. Tabs: Overview / Relationships / Backlinks /
 * Timeline / Graph, with arrow-key tab navigation, Escape to close, focus
 * restoration, scroll + tab + expanded-section memory across sessions, and full
 * ARIA roles. Mounted once in the root layout.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, describeEntity, entityKindLabel } from "@/lib/entities/entity";
import {
  INSPECTOR_TABS, closeInspector, lastScroll, rememberScroll, setInspectorTab, useInspector,
  type InspectorTab,
} from "@/lib/entities/inspector";
import ContextPanel from "@/components/entity/ContextPanel";
import RelationshipExplorer from "@/components/entity/RelationshipExplorer";
import BacklinksPanel from "@/components/entity/BacklinksPanel";
import EntityTimeline from "@/components/entity/EntityTimeline";
import GraphPreview from "@/components/entity/GraphPreview";

const TAB_LABEL: Record<InspectorTab, string> = {
  overview: "Overview", relationships: "Relationships", backlinks: "Backlinks", timeline: "Timeline", graph: "Graph",
};

export default function Inspector() {
  const { open, target, tab } = useInspector();
  const state = useStore();
  const restoreFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const entity = useMemo(() => (target ? describeEntity(makeEntityContext(state), target.kind, target.id) : null), [state, target]);

  // Focus management + scroll restore on open; focus restoration on close.
  useEffect(() => {
    if (open && !wasOpen.current) {
      restoreFocus.current = (document.activeElement as HTMLElement) ?? null;
      requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLElement>("[data-inspector-initial]")?.focus();
        if (bodyRef.current) bodyRef.current.scrollTop = lastScroll();
      });
    } else if (!open && wasOpen.current) {
      const el = restoreFocus.current;
      requestAnimationFrame(() => { try { el?.focus?.(); } catch { /* ignore */ } });
    }
    wasOpen.current = open;
  }, [open]);

  // Escape closes; global while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeInspector(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onTabKey = useCallback((e: React.KeyboardEvent) => {
    const i = INSPECTOR_TABS.indexOf(tab);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setInspectorTab(INSPECTOR_TABS[(i + 1) % INSPECTOR_TABS.length]); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setInspectorTab(INSPECTOR_TABS[(i - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length]); }
  }, [tab]);

  if (!open || !target || !entity) return null;

  const body = (
    <div ref={bodyRef} onScroll={(e) => rememberScroll((e.target as HTMLElement).scrollTop)} className="flex-1 overflow-y-auto" role="tabpanel" id={`inspector-panel-${tab}`} aria-labelledby={`inspector-tab-${tab}`}>
      {!entity.ref.exists ? (
        <p className="p-4 text-sm text-zinc-400">This record no longer exists. It may have been deleted.</p>
      ) : tab === "overview" ? <ContextPanel kind={target.kind} id={target.id} onClose={closeInspector} />
        : tab === "relationships" ? <RelationshipExplorer kind={target.kind} id={target.id} />
        : tab === "backlinks" ? <BacklinksPanel kind={target.kind} id={target.id} />
        : tab === "timeline" ? <EntityTimeline kind={target.kind} id={target.id} />
        : <GraphPreview kind={target.kind} id={target.id} />}
    </div>
  );

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Inspector: ${entity.ref.title}`}
      className="flex h-full flex-col overflow-hidden border-black/[.08] bg-white shadow-2xl dark:border-white/[.12] dark:bg-zinc-900"
    >
      <header className="flex items-start justify-between gap-2 border-b border-black/[.06] px-4 py-3 dark:border-white/[.08]">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{entityKindLabel(target.kind)}</span>
          <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{entity.ref.title}</h2>
        </div>
        <button type="button" data-inspector-initial onClick={closeInspector} aria-label="Close inspector" className="shrink-0 rounded px-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
      </header>

      <div role="tablist" aria-label="Inspector sections" onKeyDown={onTabKey} className="flex gap-0.5 overflow-x-auto border-b border-black/[.06] px-2 dark:border-white/[.08]">
        {INSPECTOR_TABS.map((t) => (
          <button
            key={t}
            id={`inspector-tab-${t}`}
            role="tab"
            aria-selected={t === tab}
            aria-controls={`inspector-panel-${t}`}
            tabIndex={t === tab ? 0 : -1}
            onClick={() => setInspectorTab(t)}
            className={`whitespace-nowrap rounded-t px-2.5 py-2 text-[11px] ${t === tab ? "border-b-2 border-zinc-800 font-medium text-zinc-900 dark:border-zinc-200 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {body}
    </div>
  );

  return (
    <>
      {/* Desktop: right-side drawer. */}
      <div className="fixed inset-y-0 right-0 z-40 hidden w-[360px] sm:block">{panel}</div>
      {/* Mobile: bottom sheet with a dismiss backdrop. */}
      <div className="fixed inset-0 z-40 sm:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) closeInspector(); }}>
        <div className="absolute inset-0 bg-black/40" />
        <div className="absolute inset-x-0 bottom-0 h-[80vh] rounded-t-2xl">{panel}</div>
      </div>
    </>
  );
}
