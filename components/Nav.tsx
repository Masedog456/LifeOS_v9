"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { pendingProposals, useStore } from "@/lib/mvpStore";
import SyncStatus from "@/components/SyncStatus";
import AuthControl from "@/components/AuthControl";

/**
 * Generation 1 information architecture (LIFEOS-025): one destination per
 * capability, grouped by the kind of work — capture, knowledge, reasoning,
 * reflection, action, system. Labels are stable (no renames of existing
 * destinations), every group is keyboard-navigable (plain links), and the
 * brand mark is a persistent way back to Daily Home from every page.
 */
const GROUPS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: "Capture",
    links: [
      { href: "/", label: "Capture" },
      { href: "/inbox", label: "Inbox" },
    ],
  },
  {
    label: "Knowledge",
    links: [
      { href: "/library", label: "Library" },
      { href: "/world", label: "World" },
      { href: "/constitution", label: "Constitution" },
    ],
  },
  {
    label: "Reasoning",
    links: [
      { href: "/compare", label: "Compare" },
      { href: "/inquiry", label: "Inquiry" },
      { href: "/threads", label: "Threads" },
      { href: "/reason", label: "Reason" },
      { href: "/research", label: "Research" },
      { href: "/dialogue", label: "Dialogue" },
      { href: "/author", label: "Author" },
    ],
  },
  {
    label: "Reflection",
    links: [
      { href: "/formation", label: "Reflect" },
      { href: "/review", label: "Review" },
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
    label: "Action",
    links: [
      { href: "/decisions", label: "Decide" },
      { href: "/orchestrator", label: "Orchestrator" },
    ],
  },
  {
    label: "System",
    links: [{ href: "/health", label: "Health" }],
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
