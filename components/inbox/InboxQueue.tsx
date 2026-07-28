"use client";

/**
 * Inbox queue list (LIFEOS-035, Feature 2). Renders the derived capture list with
 * multi-select and keyboard navigation (↑/↓ move, Enter opens, x toggles select).
 * Presentational — the page owns view/sort/filter state.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { effectiveText, captureStatus, captureAgeDays, captureLinks, captureTags, isRewritten } from "@/lib/inbox/capture-status";
import type { Capture } from "@/types/mvp";

const snip = (s: string, n = 100) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default function InboxQueue({ items, selected, activeIndex, onToggle, onActiveIndex }: {
  items: Capture[];
  selected: Set<string>;
  activeIndex: number;
  onToggle: (id: string) => void;
  onActiveIndex: (i: number) => void;
}) {
  const router = useRouter();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); onActiveIndex(Math.min(activeIndex + 1, items.length - 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); onActiveIndex(Math.max(activeIndex - 1, 0)); }
      else if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); router.push(`/process/${items[activeIndex].id}`); }
      else if (e.key === "x" && items[activeIndex]) { e.preventDefault(); onToggle(items[activeIndex].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, items, onActiveIndex, onToggle, router]);

  if (items.length === 0) return <p className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm text-zinc-500 dark:border-white/[.12]">Nothing here. A clear inbox is a fine place to be.</p>;

  return (
    <ul ref={listRef} aria-label="Capture queue" className="flex flex-col gap-1.5">
      {items.map((c, i) => {
        const links = captureLinks(c);
        return (
          <li key={c.id} data-capture-id={c.id} className={`rounded-xl border p-3 ${i === activeIndex ? "border-sky-500/50 bg-sky-500/[.04]" : "border-black/[.06] dark:border-white/[.08]"}`}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} aria-label={`Select ${snip(effectiveText(c), 30)}`} className="mt-1 shrink-0" />
              <Link href={`/process/${c.id}`} onMouseEnter={() => onActiveIndex(i)} className="min-w-0 flex-1">
                <p className="text-sm text-zinc-800 dark:text-zinc-100">{snip(effectiveText(c))}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                  <span>{captureAgeDays(c)}d</span>
                  {isRewritten(c) && <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-300">rewritten</span>}
                  {captureStatus(c) === "deferred" && c.deferredUntil && <span>· until {c.deferredUntil}</span>}
                  {links.length > 0 && <span>· {links.length} link{links.length === 1 ? "" : "s"}</span>}
                  {captureTags(c).map((t) => <span key={t} className="rounded-full bg-black/[.06] px-1.5 dark:bg-white/[.08]">{t}</span>)}
                </div>
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
