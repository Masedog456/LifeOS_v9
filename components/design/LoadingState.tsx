"use client";
/**
 * Canonical loading skeleton (LIFEOS-041, Feature 23). Preserves layout
 * dimensions, no full-screen spinner for local ops, respects reduced motion
 * (the shimmer is CSS-only and disabled by prefers-reduced-motion in globals).
 */
export default function LoadingState({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-loading-state className="flex flex-col gap-2">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded-md bg-black/[.06] dark:bg-white/[.08]" style={{ width: `${100 - i * 8}%` }} aria-hidden />
      ))}
    </div>
  );
}
