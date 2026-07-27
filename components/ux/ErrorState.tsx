"use client";

/**
 * Shared error state (LIFEOS-032, Feature 6).
 *
 * A consistent surface for a failed load / malformed data / unavailable feature,
 * with an optional retry. Never a blank screen. Keeps local data safe — this only
 * reports; it never mutates.
 */

export default function ErrorState({
  title = "Something went wrong", body, onRetry, retryLabel = "Try again",
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-50/60 px-6 py-8 text-center dark:bg-rose-950/30">
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-600 dark:text-zinc-400">{body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-full border border-rose-500/40 px-4 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-500/10 dark:text-rose-300">{retryLabel}</button>
      )}
    </div>
  );
}
