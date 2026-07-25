"use client";

/**
 * CommandResult (LIFEOS-027) — one selectable palette row.
 *
 * Renders a command or a search hit uniformly: a leading text glyph (never
 * color-only), the title, an optional subtitle/context, an optional pin toggle
 * for record rows, and an optional trailing keyboard hint. Selection state is
 * conveyed with a background AND `aria-selected` (not color alone).
 */

import type { CommandItem } from "@/lib/command/types";

export interface CommandRow extends CommandItem {
  /** Present for record rows: whether it is currently pinned. */
  pinned?: boolean;
}

export default function CommandResult({
  row, selected, id, onActivate, onHover, onTogglePin,
}: {
  row: CommandRow;
  selected: boolean;
  id: string;
  onActivate: () => void;
  onHover: () => void;
  onTogglePin?: () => void;
}) {
  const canPin = Boolean(row.recordKind && row.recordId && onTogglePin);
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onClick={onActivate}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${selected ? "bg-black/[.07] dark:bg-white/[.10]" : ""}`}
    >
      <span aria-hidden className="w-4 shrink-0 text-center text-[13px] text-zinc-400">{row.icon ?? "•"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-zinc-900 dark:text-zinc-100">{row.title}</span>
        {row.subtitle && <span className="block truncate text-[11px] text-zinc-400">{row.subtitle}</span>}
      </span>
      {canPin && (
        <button
          type="button"
          aria-label={row.pinned ? `Unpin ${row.title}` : `Pin ${row.title}`}
          aria-pressed={row.pinned}
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(); }}
          className={`shrink-0 rounded px-1 text-[13px] ${row.pinned ? "text-amber-500" : "text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-300"}`}
        >
          {row.pinned ? "★" : "☆"}
        </button>
      )}
      {row.shortcut && <kbd className="shrink-0 rounded border border-black/[.12] px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-white/[.15]">{row.shortcut}</kbd>}
    </li>
  );
}
