"use client";

/**
 * Focus scope panels (LIFEOS-037, Feature 7). Toggle which optional panels are
 * visible; the choice is remembered per focus-target kind (in prefs). The panel
 * set is bounded — Focus Mode never loads the entire knowledge graph.
 */

import { setFocusPanels } from "@/lib/mvpStore";
import type { FocusSession } from "@/types/mvp";
import { FOCUS_PANELS, PANEL_LABEL, type FocusPanel } from "@/lib/planning/focus";

export default function FocusPanels({ focus }: { focus: FocusSession }) {
  const toggle = (p: FocusPanel) => setFocusPanels(focus.id, { ...focus.panels, [p]: !focus.panels[p] });
  return (
    <div className="flex flex-wrap gap-1" data-focus-panels>
      {FOCUS_PANELS.map((p) => (
        <button key={p} type="button" onClick={() => toggle(p)} data-panel-toggle={p} aria-pressed={!!focus.panels[p]}
          className={`rounded-full px-2 py-0.5 text-[10px] ${focus.panels[p] ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] text-zinc-500 dark:border-white/[.15]"}`}>
          {PANEL_LABEL[p]}
        </button>
      ))}
    </div>
  );
}
