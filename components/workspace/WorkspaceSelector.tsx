"use client";

/**
 * Workspace selector (LIFEOS-030, Feature 12).
 *
 * A compact nav control showing the current workspace with a dropdown to switch
 * between pinned / recent / all workspaces, jump to the workspaces index, or
 * create one. Switching sets the current-workspace pointer (prefs-backed,
 * cross-device) and navigates to that workspace's dashboard. Fully keyboard
 * accessible; deterministic; no AI.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/mvpStore";
import { activeWorkspaces, findWorkspace, workspaceHref } from "@/lib/workspaces/workspace";
import { activeSession } from "@/lib/workspaces/sessions";
import { setCurrentWorkspace, useWorkspacePointer } from "@/lib/workspaces/current";
import { toast } from "@/lib/ux/feedback";

export default function WorkspaceSelector() {
  const state = useStore();
  const pointer = useWorkspacePointer();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const all = useMemo(() => activeWorkspaces(state), [state]);
  const session = activeSession(state);
  // The current workspace follows the active session when there is one.
  const currentId = session?.workspaceId ?? pointer.current;
  const current = findWorkspace(state, currentId);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const go = (id: string) => {
    setCurrentWorkspace(id);
    setOpen(false);
    const ws = findWorkspace(state, id);
    toast({ kind: "info", message: "Workspace switched", detail: ws?.name, dedupeKey: "workspace-switch" });
    router.push(workspaceHref(id));
  };

  const pinned = pointer.pinned.map((id) => findWorkspace(state, id)).filter(Boolean).filter((w) => !w!.archived);
  const recent = pointer.recent.map((id) => findWorkspace(state, id)).filter(Boolean).filter((w) => !w!.archived && !pointer.pinned.includes(w!.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
        title="Workspace"
        className="flex items-center gap-1.5 rounded-full border border-black/10 px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900 dark:border-white/12 dark:text-zinc-300 dark:hover:text-zinc-100"
      >
        <span aria-hidden>◲</span>
        <span className="max-w-[8rem] truncate">{current?.name ?? "Workspaces"}</span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/12 dark:bg-zinc-900">
          {pinned.length > 0 && (
            <Section label="Pinned">
              {pinned.map((w) => <Item key={w!.id} active={w!.id === currentId} onClick={() => go(w!.id)}>★ {w!.name}</Item>)}
            </Section>
          )}
          {recent.length > 0 && (
            <Section label="Recent">
              {recent.slice(0, 5).map((w) => <Item key={w!.id} active={w!.id === currentId} onClick={() => go(w!.id)}>{w!.name}</Item>)}
            </Section>
          )}
          {all.length > 0 && pinned.length === 0 && recent.length === 0 && (
            <Section label="Workspaces">
              {all.slice(0, 6).map((w) => <Item key={w.id} active={w.id === currentId} onClick={() => go(w.id)}>{w.name}</Item>)}
            </Section>
          )}
          <div className="border-t border-black/[.06] dark:border-white/[.08]">
            <Item onClick={() => { setOpen(false); router.push("/workspaces"); }}>⊞ All workspaces</Item>
            <Item onClick={() => { setOpen(false); router.push("/workspaces?new=1"); }}>＋ New workspace</Item>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      {children}
    </div>
  );
}

function Item({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06] ${active ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}
