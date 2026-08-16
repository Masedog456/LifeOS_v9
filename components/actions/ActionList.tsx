"use client";

/**
 * Action list (LIFEOS-036, Feature 3). Renders the derived action list with
 * multi-select and keyboard navigation (↑/↓ or j/k move, Enter opens, x selects,
 * p pins). Presentational — the page owns view/sort/filter state. Blocked actions
 * are flagged (they are excluded from Next but visible in other views).
 */

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NextAction, ActionDependency } from "@/types/mvp";
import { SIZE_LABEL, userFacingStatus, statusTone } from "@/lib/actions/status";
import { buildBlockedByMap, isBlocked } from "@/lib/actions/dependencies";
import { dueLabel } from "@/lib/actions/due";

const snip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function ActionList({ items, deps, selected, activeIndex, onToggle, onActiveIndex, onPin }: {
  items: NextAction[];
  deps: ActionDependency[];
  selected: Set<string>;
  activeIndex: number;
  onToggle: (id: string) => void;
  onActiveIndex: (i: number) => void;
  onPin?: (id: string) => void;
}) {
  const router = useRouter();
  const byId = new Map(items.map((a) => [a.id, a] as const));
  const blockedBy = buildBlockedByMap(deps);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); onActiveIndex(Math.min(activeIndex + 1, items.length - 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); onActiveIndex(Math.max(activeIndex - 1, 0)); }
      else if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); router.push(`/actions/${items[activeIndex].id}`); }
      else if (e.key === "x" && items[activeIndex]) { e.preventDefault(); onToggle(items[activeIndex].id); }
      else if (e.key === "p" && items[activeIndex] && onPin) { e.preventDefault(); onPin(items[activeIndex].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, items, onActiveIndex, onToggle, onPin, router]);

  if (items.length === 0) return (
    <div className="rounded-2xl border border-dashed border-black/[.10] p-6 text-center dark:border-white/[.12]">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Nothing here yet.</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">A next action is one concrete thing you can actually do — like &ldquo;email Sam the draft.&rdquo; Add one with <span className="font-medium text-zinc-700 dark:text-zinc-200">+ New action</span> above. Nothing is created or prioritized for you.</p>
    </div>
  );

  return (
    <ul aria-label="Action list" className="flex flex-col gap-1.5">
      {items.map((a, i) => {
        const blocked = isBlocked(a, blockedBy, byId);
        return (
          <li key={a.id} data-action-id={a.id} data-status={a.status} className={`rounded-xl border p-3 ${i === activeIndex ? "border-sky-500/50 bg-sky-500/[.04]" : "border-black/[.06] dark:border-white/[.08]"}`}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggle(a.id)} aria-label={`Select ${snip(a.title, 30)}`} className="mt-1 shrink-0" />
              <Link href={`/actions/${a.id}`} onMouseEnter={() => onActiveIndex(i)} className="min-w-0 flex-1">
                <p className="text-sm text-zinc-800 dark:text-zinc-100">{a.pinned && <span aria-label="pinned" className="mr-1 text-amber-500">★</span>}{snip(a.title || "(untitled action)")}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                  {(() => { const tone = statusTone(a, blocked); const cls = tone === "ready" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : tone === "active" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : tone === "waiting" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-black/[.06] dark:bg-white/[.08]"; return <span className={`rounded-full px-1.5 ${cls}`}>{userFacingStatus(a, blocked)}</span>; })()}
                  {a.estimatedSize !== "unspecified" && <span>· {SIZE_LABEL[a.estimatedSize]}</span>}
                  {a.context && <span>· {a.context}</span>}
                  {a.status === "deferred" && a.deferredUntil && <span>· until {a.deferredUntil}</span>}
                  {/* Due is shown as a plain fact beside the action (LIFEOS-053). */}
                  {dueLabel(a) && <span>· {dueLabel(a)}</span>}
                  {a.status === "waiting" && a.waitingOn && <span>· waiting on {a.waitingOn}</span>}
                  {a.tags.map((t) => <span key={t} className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{t}</span>)}
                </div>
              </Link>
              {onPin && <button type="button" onClick={() => onPin(a.id)} aria-label={a.pinned ? "Unpin" : "Pin to top"} className={`shrink-0 text-sm ${a.pinned ? "text-amber-500" : "text-zinc-300 hover:text-amber-500 dark:text-zinc-600"}`}>★</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
