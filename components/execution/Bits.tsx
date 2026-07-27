"use client";

/**
 * Small shared UI atoms for the execution dashboards (LIFEOS-031): a deterministic
 * progress bar, a pill/badge, and a panel wrapper. Presentational only.
 */

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"} data-progress={pct}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
        <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full bg-black/[.05] px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06] dark:text-zinc-300">{children}</span>;
}

export function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/12">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-400">{children}</p>;
}
