"use client";

/**
 * Shared insights hook (LIFEOS-039). Builds the activity index + entity context
 * once per store snapshot and manages the selected range (persisted in prefs).
 * Every insights surface consumes this so they all resolve the SAME range.
 */

import { useMemo, useCallback } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, type EntityContext } from "@/lib/entities/entity";
import { buildActivityIndex, type ActivityEvent } from "@/lib/insights/activity";
import { resolveRange, type RangeKind, type ResolvedRange } from "@/lib/insights/range";
import { useRememberedRange, rememberRange } from "@/lib/insights/memory";
import type { StoreState } from "@/types/mvp";

export interface InsightsCtx {
  state: StoreState;
  ctx: EntityContext;
  index: ActivityEvent[];
  range: ResolvedRange;
  kind: RangeKind;
  customStart?: string;
  customEnd?: string;
  setRange: (kind: RangeKind, customStart?: string, customEnd?: string) => void;
}

export function useInsights(): InsightsCtx {
  const state = useStore();
  const ctx = useMemo(() => makeEntityContext(state), [state]);
  const index = useMemo(() => buildActivityIndex(state), [state]);
  // A hydration-safe external store: SSR + first client render use the stable
  // last_7_days default, then useSyncExternalStore adopts the remembered range
  // after hydration (no setState-in-effect). rememberRange notifies subscribers.
  const sel = useRememberedRange();
  const range = useMemo(() => resolveRange(sel.kind, { customStart: sel.customStart, customEnd: sel.customEnd }), [sel]);

  const setRange = useCallback((kind: RangeKind, customStart?: string, customEnd?: string) => {
    try { rememberRange(kind, customStart, customEnd); } catch { /* prefs optional */ }
  }, []);

  return { state, ctx, index, range, kind: sel.kind, customStart: sel.customStart, customEnd: sel.customEnd, setRange };
}
