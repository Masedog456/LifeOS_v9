"use client";

/**
 * Friction step (LIFEOS-034, Feature 6). Records friction encountered during the
 * day (description, severity, area, optional linked entity, resolved flag). Feeds
 * the UX-audit workflow, not analytics.
 */

import { useState } from "react";
import { useStore, addReviewFriction, updateReviewFriction, removeReviewFriction } from "@/lib/mvpStore";
import type { DailyReview, FrictionArea, FrictionSeverity } from "@/types/mvp";

const AREAS: FrictionArea[] = ["navigation", "clarity", "workflow", "sync", "mobile", "performance", "content", "planning", "other"];
const SEVERITIES: FrictionSeverity[] = ["low", "medium", "high"];
const SEV_TONE: Record<FrictionSeverity, string> = { low: "text-zinc-500", medium: "text-amber-600 dark:text-amber-400", high: "text-rose-600 dark:text-rose-400" };

export default function FrictionStep({ review }: { review: DailyReview }) {
  useStore();
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState<FrictionSeverity>("medium");
  const [area, setArea] = useState<FrictionArea>("workflow");
  const add = () => { if (!desc.trim()) return; addReviewFriction(review.id, { description: desc, severity, area }); setDesc(""); };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500">Where did LifeOS (or your day) get in the way? Friction here feeds the product’s UX audit — it never scores you.</p>

      {review.friction.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {review.friction.map((f) => (
            <li key={f.id} className="rounded-lg border border-black/[.06] px-3 py-2 text-xs dark:border-white/[.08]">
              <div className="flex items-start justify-between gap-2">
                <p className={`min-w-0 ${f.resolved ? "text-zinc-400 line-through" : "text-zinc-800 dark:text-zinc-100"}`}>{f.description}</p>
                <button type="button" onClick={() => removeReviewFriction(review.id, f.id)} aria-label="Remove friction" className="shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="rounded-full bg-black/[.06] px-1.5 py-0.5 text-zinc-500 dark:bg-white/[.08]">{f.area}</span>
                <span className={SEV_TONE[f.severity]}>{f.severity}</span>
                <label className="flex items-center gap-1 text-zinc-500"><input type="checkbox" checked={f.resolved} onChange={(e) => updateReviewFriction(review.id, f.id, { resolved: e.target.checked })} /> resolved</label>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-black/[.12] p-3 dark:border-white/[.15]">
        <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="What caused friction?" aria-label="Friction description" className="w-full bg-transparent text-sm outline-none" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">Area
            <select value={area} onChange={(e) => setArea(e.target.value as FrictionArea)} aria-label="Friction area" className="rounded-md border border-black/10 bg-transparent px-1.5 py-1 text-xs dark:border-white/12">
              {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-zinc-500">Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value as FrictionSeverity)} aria-label="Friction severity" className="rounded-md border border-black/10 bg-transparent px-1.5 py-1 text-xs dark:border-white/12">
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button type="button" onClick={add} disabled={!desc.trim()} className="ml-auto rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Add friction</button>
        </div>
      </div>
    </div>
  );
}
