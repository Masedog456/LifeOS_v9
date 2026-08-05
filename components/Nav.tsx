"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pendingProposals, useStore } from "@/lib/mvpStore";
import { openCommandPalette } from "@/lib/command/events";
import SyncStatus from "@/components/SyncStatus";
import AuthControl from "@/components/AuthControl";
import WorkspaceSelector from "@/components/workspace/WorkspaceSelector";

/**
 * Information architecture (LIFEOS-027 cleanup of LIFEOS-025): one destination
 * per capability, regrouped so the daily workflow (Capture) reads apart from the
 * deep knowledge modules (Think), and Memory/Timeline/Themes are easy to find.
 * No destination was removed or renamed — only regrouped. Every group is
 * keyboard-navigable (plain links); the brand mark returns to Daily Home; and a
 * search button opens the universal command palette (⌘K / Ctrl K).
 *
 * Groups: Today · Capture · Think · Research · Memory · Decide · System.
 */
const GROUPS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: "Execute",
    links: [
      { href: "/goals", label: "Goals" },
      { href: "/projects", label: "Projects" },
      { href: "/actions", label: "Actions" },
    ],
  },
  {
    label: "Capture",
    links: [
      { href: "/", label: "Capture" },
      { href: "/process", label: "Process" },
      { href: "/inbox", label: "Inbox" },
    ],
  },
  {
    label: "Reflect",
    links: [
      { href: "/daily", label: "Daily Review" },
    ],
  },
  {
    label: "Plan",
    links: [
      { href: "/plan", label: "Plan" },
      { href: "/focus", label: "Focus" },
    ],
  },
  {
    label: "Read",
    links: [
      { href: "/reading", label: "Reading" },
      { href: "/library", label: "Library" },
    ],
  },
  {
    label: "Think",
    links: [
      { href: "/world", label: "Knowledge" },
      { href: "/constitution", label: "Beliefs" },
      { href: "/compare", label: "Compare" },
      { href: "/inquiry", label: "Inquiry" },
      { href: "/threads", label: "Threads" },
      { href: "/reason", label: "Reason" },
      { href: "/dialogue", label: "Dialogue" },
    ],
  },
  {
    label: "Research",
    links: [
      { href: "/research", label: "Research" },
      { href: "/author", label: "Author" },
    ],
  },
  {
    label: "Memory",
    links: [
      { href: "/memory", label: "Memory" },
      { href: "/timeline", label: "Timeline" },
      { href: "/themes", label: "Themes" },
    ],
  },
  {
    label: "Decide",
    links: [
      { href: "/decisions", label: "Decide" },
      { href: "/formation", label: "Reflect" },
      { href: "/review", label: "Review" },
      { href: "/orchestrator", label: "Orchestrator" },
    ],
  },
  {
    label: "Maintain",
    links: [{ href: "/maintenance", label: "Maintenance" }],
  },
  {
    label: "Insights",
    links: [{ href: "/insights", label: "Insights" }],
  },
  {
    label: "System",
    links: [
      { href: "/health", label: "Health" },
      { href: "/security", label: "Diagnostics" },
      { href: "/backup", label: "Backup" },
      { href: "/privacy", label: "Privacy" },
      { href: "/help", label: "Help" },
      { href: "/release", label: "Release" },
    ],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const state = useStore();
  const pending = pendingProposals(state).length;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav aria-label="Primary" className="w-full border-b border-black/[.06] dark:border-white/[.08]">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {/* The brand mark is the persistent link back to Daily Home. */}
          <Link href="/today" className="text-sm font-semibold tracking-tight" aria-label="LifeOS — Daily Home">
            LifeOS
          </Link>
          <Link
            href="/today"
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              isActive("/today") ? "bg-black/[.06] font-medium dark:bg-white/[.10]" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            Today
          </Link>
          {/* Universal command palette trigger (⌘K / Ctrl K). */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Open command palette"
            aria-keyshortcuts="Control+K Meta+K"
            title="Search or run a command (⌘K / Ctrl K)"
            className="hidden items-center gap-2 rounded-full border border-black/[.10] px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 sm:flex dark:border-white/[.12] dark:hover:text-zinc-100"
          >
            <span aria-hidden>⌕</span>
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden rounded border border-black/[.12] px-1 text-[10px] lg:inline dark:border-white/[.15]">⌘K</kbd>
          </button>
          {/* Workspace selector (LIFEOS-030): current workspace + switch. */}
          <WorkspaceSelector />
        </div>
        <div className="hidden sm:block">
          <SyncStatus />
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 text-sm sm:w-auto sm:justify-end">
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-wrap items-center gap-0.5">
              <span aria-hidden className="mr-0.5 hidden text-[9px] font-semibold uppercase tracking-wider text-zinc-300 dark:text-zinc-600 lg:inline">
                {group.label}
              </span>
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-full px-2.5 py-1.5 transition-colors ${
                    isActive(link.href)
                      ? "bg-black/[.06] font-medium dark:bg-white/[.10]"
                      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  {link.label}
                  {link.href === "/inbox" && pending > 0 && (
                    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                      {pending}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
          <div className="ml-1 flex items-center gap-2">
            <span className="sm:hidden"><SyncStatus /></span>
            <AuthControl />
          </div>
        </div>
      </div>
    </nav>
  );
}
