"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { pendingProposals, useStore } from "@/lib/mvpStore";
import { openCommandPalette } from "@/lib/command/events";
import SyncStatus from "@/components/SyncStatus";
import AuthControl from "@/components/AuthControl";
import WorkspaceSelector from "@/components/workspace/WorkspaceSelector";

/**
 * Information architecture (LIFEOS-043). LifeOS used to expose ~35 destinations
 * in one flat wrapped row, so every subsystem competed equally. This nav
 * organizes around user INTENTIONS instead: six primary destinations, with the
 * deeper tools tucked one click away under grouped menus (progressive
 * disclosure). No route was added or removed — only regrouped and renamed for a
 * newcomer.
 *
 *   Today   — the home; what deserves attention right now.
 *   Capture — get a thought in, then process it.
 *   Work    — goals, projects, actions, planning, focus.
 *   Learn   — reading, knowledge, beliefs, research.
 *   Reflect — review, insights, and your own history.
 *   More    — advanced thinking tools, and system/privacy settings.
 *
 * Menus are a disclosure pattern: a button toggles a panel of ordinary links.
 * They are keyboard-navigable (Tab through, Esc closes), close on outside click
 * and on navigation, and announce their expanded state to screen readers. The
 * brand mark always returns to Today, and the command palette (⌘K / Ctrl K)
 * still reaches every destination directly.
 */

type NavLink = { href: string; label: string; badge?: "inbox" };
type NavSection = { heading?: string; links: NavLink[] };
type NavItem =
  | { kind: "link"; href: string; label: string }
  | { kind: "menu"; key: string; label: string; sections: NavSection[] };

const NAV: NavItem[] = [
  { kind: "link", href: "/today", label: "Today" },
  {
    kind: "menu", key: "capture", label: "Capture",
    sections: [{ links: [
      { href: "/", label: "Capture a thought" },
      { href: "/process", label: "Process inbox" },
      { href: "/inbox", label: "Belief inbox", badge: "inbox" },
    ] }],
  },
  {
    kind: "menu", key: "work", label: "Work",
    sections: [{ links: [
      { href: "/goals", label: "Goals" },
      { href: "/projects", label: "Projects" },
      { href: "/actions", label: "Actions" },
      { href: "/plan", label: "Planning" },
      { href: "/focus", label: "Focus" },
    ] }],
  },
  {
    kind: "menu", key: "learn", label: "Learn",
    sections: [{ links: [
      { href: "/reading", label: "Reading" },
      { href: "/library", label: "Library" },
      { href: "/world", label: "Knowledge" },
      { href: "/constitution", label: "Beliefs" },
      { href: "/research", label: "Research" },
    ] }],
  },
  {
    kind: "menu", key: "reflect", label: "Reflect",
    sections: [{ links: [
      { href: "/daily", label: "Daily Review" },
      { href: "/insights", label: "Insights" },
      { href: "/timeline", label: "Timeline" },
      { href: "/memory", label: "Memory" },
      { href: "/themes", label: "Themes" },
    ] }],
  },
  {
    kind: "menu", key: "more", label: "More",
    sections: [
      { heading: "Thinking tools", links: [
        { href: "/compare", label: "Compare" },
        { href: "/inquiry", label: "Inquiry" },
        { href: "/threads", label: "Threads" },
        { href: "/reason", label: "Reason" },
        { href: "/dialogue", label: "Dialogue" },
      ] },
      { heading: "Create & decide", links: [
        { href: "/author", label: "Author" },
        { href: "/decisions", label: "Decisions" },
        { href: "/formation", label: "Formation" },
        { href: "/review", label: "Review" },
        { href: "/orchestrator", label: "LifeOS Inbox" },
      ] },
      { heading: "System & privacy", links: [
        { href: "/maintenance", label: "Maintenance" },
        { href: "/health", label: "System Health" },
        { href: "/security", label: "Diagnostics" },
        { href: "/backup", label: "Backup & Export" },
        { href: "/recovery", label: "Recovery" },
        { href: "/privacy", label: "Privacy" },
        { href: "/help", label: "Help" },
        { href: "/release", label: "Release" },
      ] },
    ],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const state = useStore();
  const pending = pendingProposals(state).length;
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const menuActive = (item: Extract<NavItem, { kind: "menu" }>) =>
    item.sections.some((s) => s.links.some((l) => isActive(l.href)));

  // Close on outside click or Escape. Listeners only — no setState during render.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <nav aria-label="Primary" className="w-full border-b border-black/[.06] dark:border-white/[.08]">
      <div ref={barRef} className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {/* Left: brand + primary destinations. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          <Link href="/today" className="mr-2 text-sm font-semibold tracking-tight" aria-label="LifeOS — go to Today">LifeOS</Link>
          {NAV.map((item) =>
            item.kind === "link" ? (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${isActive(item.href) ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-600 hover:bg-black/[.04] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[.06] dark:hover:text-zinc-100"}`}
              >
                {item.label}
              </Link>
            ) : (
              <div key={item.key} className="relative">
                <button
                  type="button"
                  onClick={() => setOpen((o) => (o === item.key ? null : item.key))}
                  aria-haspopup="true"
                  aria-expanded={open === item.key}
                  aria-controls={`${menuId}-${item.key}`}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm transition-colors ${menuActive(item) || open === item.key ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-600 hover:bg-black/[.04] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[.06] dark:hover:text-zinc-100"}`}
                >
                  {item.label}
                  {item.key === "capture" && pending > 0 && (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-zinc-900 px-1 text-[10px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{pending}</span>
                  )}
                  <span aria-hidden className="text-[9px] text-zinc-400">▾</span>
                </button>
                {open === item.key && (
                  <div
                    id={`${menuId}-${item.key}`}
                    className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-2xl border border-black/[.08] bg-white p-1.5 shadow-lg dark:border-white/[.12] dark:bg-zinc-900"
                  >
                    {item.sections.map((section, si) => (
                      <div key={si} className={si > 0 ? "mt-1 border-t border-black/[.06] pt-1 dark:border-white/[.08]" : ""}>
                        {section.heading && <p className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{section.heading}</p>}
                        {section.links.map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(null)}
                            aria-current={isActive(link.href) ? "page" : undefined}
                            className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${isActive(link.href) ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-600 hover:bg-black/[.05] hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/[.07] dark:hover:text-zinc-100"}`}
                          >
                            {link.label}
                            {link.badge === "inbox" && pending > 0 && (
                              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{pending}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        {/* Right: search, workspace, sync, account. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search or run a command"
            aria-keyshortcuts="Control+K Meta+K"
            title="Search or run a command (⌘K / Ctrl K)"
            className="flex items-center gap-2 rounded-full border border-black/[.10] px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:border-white/[.12] dark:hover:text-zinc-100"
          >
            <span aria-hidden>⌕</span>
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden rounded border border-black/[.12] px-1 text-[10px] lg:inline dark:border-white/[.15]">⌘K</kbd>
          </button>
          <span className="hidden sm:block"><WorkspaceSelector /></span>
          <span className="hidden sm:block"><SyncStatus /></span>
          <AuthControl />
        </div>
      </div>
    </nav>
  );
}
