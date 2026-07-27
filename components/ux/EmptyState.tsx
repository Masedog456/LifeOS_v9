"use client";

/**
 * Shared empty state (LIFEOS-032, Feature 5).
 *
 * A consistent, honest empty state: what belongs here, why it's useful, and the
 * single most relevant next action. No filler illustrations, no vague
 * motivational copy. Used across pages and inspector panels.
 */

import Link from "next/link";

export interface EmptyAction { label: string; href?: string; onClick?: () => void }

export default function EmptyState({
  title, body, action, compact = false, icon,
}: {
  title: string;
  body: string;
  action?: EmptyAction;
  compact?: boolean;
  icon?: string;
}) {
  return (
    <div className={`rounded-xl border border-dashed border-black/15 text-center dark:border-white/15 ${compact ? "px-4 py-6" : "px-6 py-12"}`}>
      {icon && <div aria-hidden className="mb-2 text-2xl text-zinc-300 dark:text-zinc-600">{icon}</div>}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">{body}</p>
      {action && (
        action.href ? (
          <Link href={action.href} className="mt-3 inline-block rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">{action.label}</Link>
        ) : (
          <button type="button" onClick={action.onClick} className="mt-3 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900">{action.label}</button>
        )
      )}
    </div>
  );
}
