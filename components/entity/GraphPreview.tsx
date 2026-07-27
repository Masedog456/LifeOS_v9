"use client";

/**
 * GraphPreview (LIFEOS-029, Feature 5) — the inspector "Graph" tab.
 * A miniature relationship graph of the entity's IMMEDIATE neighbors (one hop),
 * radially laid out and deterministic. Not the full graph page. Clicking a node
 * opens it in the inspector; nodes are keyboard-focusable with labels.
 */

import { useMemo } from "react";
import { useStore } from "@/lib/mvpStore";
import { makeEntityContext, entityKindLabel } from "@/lib/entities/entity";
import { entityNeighbors } from "@/lib/entities/preview";
import { openInspector } from "@/lib/entities/inspector";

const KIND_FILL: Record<string, string> = {
  belief: "#34d399", concept: "#60a5fa", theme: "#a78bfa", decision: "#fb7185", dialogue: "#818cf8",
  research_project: "#fbbf24", synthesis: "#c084fc", tension: "#f87171", document: "#2dd4bf",
  capture: "#94a3b8", author: "#f472b6",
};
const fill = (k: string) => KIND_FILL[k] ?? "#a1a1aa";

export default function GraphPreview({ kind, id }: { kind: string; id: string }) {
  const state = useStore();
  const nb = useMemo(() => entityNeighbors(makeEntityContext(state), kind, id, 10), [state, kind, id]);

  if (nb.neighbors.length === 0) return <p className="p-4 text-sm text-zinc-400">No immediate neighbors to graph.</p>;

  const W = 320, H = 300, cx = W / 2, cy = H / 2, R = 110;
  const nodes = nb.neighbors.map((n, i) => {
    const a = (i / nb.neighbors.length) * Math.PI * 2 - Math.PI / 2;
    return { ...n, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  return (
    <div className="p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label={`Relationship graph for ${nb.center.title}`}>
        {nodes.map((n) => <line key={`e-${n.ref.id}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className="stroke-black/[.12] dark:stroke-white/[.15]" strokeWidth={1} />)}
        {nodes.map((n) => (
          <g key={`n-${n.ref.kind}-${n.ref.id}`} transform={`translate(${n.x},${n.y})`} className="cursor-pointer" role="button" tabIndex={0}
            aria-label={`${entityKindLabel(n.ref.kind)}: ${n.ref.title} (${n.relation})`}
            onClick={() => openInspector(n.ref.kind, n.ref.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInspector(n.ref.kind, n.ref.id); } }}>
            <circle r={7} fill={fill(n.ref.kind)} />
            <text x={10} y={4} className="fill-zinc-600 text-[9px] dark:fill-zinc-300">{n.ref.title.slice(0, 16)}</text>
          </g>
        ))}
        <g transform={`translate(${cx},${cy})`}>
          <circle r={11} fill={fill(nb.center.kind)} stroke="currentColor" className="text-zinc-800 dark:text-zinc-100" strokeWidth={2} />
          <text x={0} y={26} textAnchor="middle" className="fill-zinc-800 text-[10px] font-medium dark:fill-zinc-100">{nb.center.title.slice(0, 18)}</text>
        </g>
      </svg>
      <p className="mt-1 text-center text-[10px] text-zinc-400">Immediate neighbors · click to inspect</p>
    </div>
  );
}
