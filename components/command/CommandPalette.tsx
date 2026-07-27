"use client";

/**
 * CommandPalette (LIFEOS-027, Features 1–4, 6–7).
 *
 * A global, keyboard-first command palette. With an empty query it lists
 * pinned, recent, continue-work, and static navigate/create/action commands;
 * as you type it filters those commands AND searches every record via the
 * deterministic index, grouped by type. Fully keyboard navigable (arrows, Enter,
 * Escape), combobox/listbox semantics with `aria-activedescendant`, a focus
 * trap, and no network round trip to open. Selection is shown by background and
 * `aria-selected`, never color alone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/mvpStore";
import { buildCommands } from "@/lib/command/registry";
import { buildIndex, searchGrouped } from "@/lib/command/search";
import { getPinned, getRecent, recordVisit, togglePin } from "@/lib/command/recent";
import { hrefForRecord } from "@/lib/command/commands";
import { normalizeQuery } from "@/lib/command/ranking";
import { openInspector } from "@/lib/entities/inspector";
import { trackSearch, trackCommand } from "@/lib/workspaces/tracking";
import type { CommandItem } from "@/lib/command/types";
import CommandResult, { type CommandRow } from "@/components/command/CommandResult";

type RenderRow = { type: "header"; label: string; key: string } | { type: "item"; row: CommandRow; index: number; key: string };

const EMPTY_GROUP_ORDER = ["Pinned", "Recent", "Continue", "Navigate", "Create", "Actions"];
const MATCH_FIELD_LABEL: Record<string, string> = { "title-exact": "exact", "title-prefix": "starts with", title: "title", alias: "alias", body: "notes" };

export default function CommandPalette({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const state = useStore();
  const router = useRouter();
  // Mounted only while open, so plain initial state = a fresh palette each time.
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const recent = useMemo(() => getRecent(state), [state]);
  const pinned = useMemo(() => getPinned(state), [state]);
  const commands = useMemo(() => buildCommands({ state, recent, pinned }), [state, recent, pinned]);
  const index = useMemo(() => buildIndex(state), [state]);

  // Pinned-ness is React state so toggling a star re-renders immediately without
  // reading localStorage during render. Seeded once on mount from the store.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(() => new Set(pinned.map((p) => `${p.kind}:${p.id}`)));

  // Build the ordered, flattened render list (headers + selectable items).
  const { render, items } = useMemo(() => {
    const q = normalizeQuery(query);
    const rows: CommandRow[][] = [];
    const headers: string[] = [];
    const pushGroup = (label: string, list: CommandRow[]) => { if (list.length) { headers.push(label); rows.push(list); } };
    const pinnedOf = (kind?: string, id?: string) => (kind && id ? pinnedKeys.has(`${kind}:${id}`) : undefined);
    const withPin = (c: CommandItem): CommandRow => ({ ...c, pinned: pinnedOf(c.recordKind, c.recordId) });

    if (!q) {
      const byGroup = new Map<string, CommandRow[]>();
      for (const c of commands) {
        const g = byGroup.get(c.group) ?? [];
        g.push(withPin(c));
        byGroup.set(c.group, g);
      }
      for (const label of EMPTY_GROUP_ORDER) pushGroup(label, byGroup.get(label) ?? []);
      for (const [label, list] of byGroup) if (!EMPTY_GROUP_ORDER.includes(label)) pushGroup(label, list);
    } else {
      // Matching commands first.
      const matched = commands.filter((c) => {
        const hay = `${c.title} ${c.subtitle ?? ""} ${(c.keywords ?? []).join(" ")}`.toLowerCase();
        return normalizeQuery(hay).includes(q);
      }).map(withPin);
      pushGroup("Commands", matched);
      // Then record search results, grouped by kind.
      for (const g of searchGrouped(index, query)) {
        const list: CommandRow[] = g.results.map((r) => {
          const date = r.entry.updatedAt ? new Date(r.entry.updatedAt).toLocaleDateString() : "";
          const parts = [MATCH_FIELD_LABEL[r.matchField] ?? r.matchField, r.entry.status, date].filter(Boolean);
          return {
            id: `search:${r.entry.kind}:${r.entry.id}`,
            title: r.entry.title,
            subtitle: `${g.label} · ${parts.join(" · ")}`,
            group: g.label,
            kind: "record",
            href: r.entry.href,
            recordKind: r.entry.kind,
            recordId: r.entry.id,
            icon: "→",
            pinned: pinnedOf(r.entry.kind, r.entry.id),
          };
        });
        pushGroup(g.label, list);
      }
    }

    const flat: RenderRow[] = [];
    const itemList: CommandRow[] = [];
    let idx = 0;
    for (let gi = 0; gi < rows.length; gi++) {
      flat.push({ type: "header", label: headers[gi], key: `h:${headers[gi]}:${gi}` });
      for (const row of rows[gi]) {
        flat.push({ type: "item", row, index: idx, key: `i:${row.id}` });
        itemList.push(row);
        idx++;
      }
    }
    return { render: flat, items: itemList };
  }, [query, commands, index, pinnedKeys]);

  // Selection is clamped at use (no effect): keeps it valid as results change.
  const sel = items.length === 0 ? 0 : Math.min(selected, items.length - 1);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`#cmd-opt-${sel}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const activate = useCallback((row: CommandRow) => {
    // Feed the active thinking session's timeline (LIFEOS-030), if any.
    if (query.trim()) trackSearch(query);
    trackCommand(row.title);
    if (row.action) { onClose(); onAction(row.action); return; }
    if (row.href) {
      if (row.recordKind && row.recordId) {
        const href = hrefForRecord(state, row.recordKind, row.recordId) ?? row.href;
        // Record the visit synchronously so it appears under Recent next time.
        recordVisit(row.recordKind, row.recordId, row.title);
        onClose();
        router.push(href);
        return;
      }
      onClose();
      router.push(row.href);
    }
  }, [onAction, onClose, router, state, query]);

  const onTogglePin = useCallback((row: CommandRow) => {
    if (!row.recordKind || !row.recordId) return;
    const nowPinned = togglePin(row.recordKind, row.recordId, row.title);
    const key = `${row.recordKind}:${row.recordId}`;
    setPinnedKeys((prev) => { const next = new Set(prev); if (nowPinned) next.add(key); else next.delete(key); return next; });
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => (items.length ? (Math.min(s, items.length - 1) + 1) % items.length : 0)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => (items.length ? (Math.min(s, items.length - 1) - 1 + items.length) % items.length : 0)); return; }
    if (e.key === "Home") { e.preventDefault(); setSelected(0); return; }
    if (e.key === "End") { e.preventDefault(); setSelected(Math.max(0, items.length - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); const row = items[Math.min(selected, items.length - 1)]; if (row) activate(row); return; }
    // Focus trap: keep Tab inside the dialog (only the input + rows are focusable via us).
    if (e.key === "Tab") { e.preventDefault(); }
  }, [items, selected, activate, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] sm:pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-black/[.08] bg-white shadow-2xl motion-safe:animate-none dark:border-white/[.12] dark:bg-zinc-900"
      >
        <div className="flex items-center gap-2 border-b border-black/[.06] px-3 dark:border-white/[.08]">
          <span aria-hidden className="text-zinc-400">⌕</span>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-listbox"
            aria-activedescendant={items.length ? `cmd-opt-${sel}` : undefined}
            aria-label="Search commands and records"
            placeholder="Search or run a command…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-zinc-400"
          />
          <kbd className="hidden shrink-0 rounded border border-black/[.12] px-1.5 py-0.5 text-[10px] text-zinc-400 sm:inline dark:border-white/[.15]">Esc</kbd>
        </div>

        <ul ref={listRef} id="cmd-listbox" role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-zinc-400">No matches. Press Esc to close.</li>
          ) : (
            render.map((r) =>
              r.type === "header" ? (
                <li key={r.key} role="presentation" className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 first:pt-1">{r.label}</li>
              ) : (
                <CommandResult
                  key={r.key}
                  id={`cmd-opt-${r.index}`}
                  row={r.row}
                  selected={r.index === sel}
                  onActivate={() => activate(r.row)}
                  onHover={() => setSelected(r.index)}
                  onTogglePin={r.row.recordKind && r.row.recordId ? () => onTogglePin(r.row) : undefined}
                  onInspect={r.row.recordKind && r.row.recordId ? () => { const k = r.row.recordKind!, i = r.row.recordId!; onClose(); openInspector(k, i); } : undefined}
                />
              ),
            )
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/[.06] px-3 py-2 text-[10px] text-zinc-400 dark:border-white/[.08]">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          <span className="ml-auto">☆ pin</span>
        </div>
      </div>
    </div>
  );
}
