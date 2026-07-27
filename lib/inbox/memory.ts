/**
 * Queue navigation memory (LIFEOS-035, Feature 18).
 *
 * Persists ONLY appropriate UI preferences — selected view, sort, filters,
 * active capture, scroll, and desktop split-pane width — in `prefs.inbox`, so
 * the inbox restores safely after reload. No record content is stored here.
 */

import { readPrefs, writePrefs, type Prefs } from "@/lib/prefs";
import type { QueueView } from "@/lib/inbox/capture-status";
import type { QueueSort, QueueFilter } from "@/lib/inbox/queue";

export interface InboxMemory {
  view: QueueView;
  sort: QueueSort;
  filter: QueueFilter;
  activeCaptureId?: string;
  scroll: number;
  paneWidth: number;
}

const DEFAULTS: InboxMemory = { view: "inbox", sort: "newest", filter: {}, scroll: 0, paneWidth: 380 };

export function readInboxMemory(): InboxMemory {
  const m = readPrefs().inbox;
  if (!m) return { ...DEFAULTS };
  return {
    view: (m.view as QueueView) ?? DEFAULTS.view,
    sort: (m.sort as QueueSort) ?? DEFAULTS.sort,
    filter: m.filter ?? {},
    activeCaptureId: m.activeCaptureId,
    scroll: typeof m.scroll === "number" ? m.scroll : 0,
    paneWidth: typeof m.paneWidth === "number" ? m.paneWidth : DEFAULTS.paneWidth,
  };
}

export function writeInboxMemory(patch: Partial<InboxMemory>): void {
  const current = readInboxMemory();
  const next = { ...current, ...patch };
  writePrefs({ inbox: { view: next.view, sort: next.sort, filter: next.filter, activeCaptureId: next.activeCaptureId, scroll: next.scroll, paneWidth: next.paneWidth } as Prefs["inbox"] });
}
