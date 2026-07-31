"use client";

/**
 * Keyboard shortcut reference (LIFEOS-041, Feature 30). Renders the documented
 * shortcut model so every shortcut is discoverable, with its equivalent visible
 * affordance. Read-only; grouped by global vs surface.
 */

import { SHORTCUTS } from "@/lib/accessibility/keyboard";

function Chord({ keys }: { keys: string }) {
  return (
    <span className="inline-flex gap-1">
      {keys.split(" ").map((k, i) => (
        <kbd key={i} className="rounded border border-black/[.12] bg-black/[.03] px-1.5 py-0.5 text-[11px] font-medium dark:border-white/[.15] dark:bg-white/[.05]">{k.replace("mod", "⌘/Ctrl")}</kbd>
      ))}
    </span>
  );
}

export default function ShortcutReference() {
  const global = SHORTCUTS.filter((s) => s.global);
  const surface = SHORTCUTS.filter((s) => !s.global);
  return (
    <div data-shortcut-reference className="flex flex-col gap-5">
      {[["Anywhere", global], ["Within a surface", surface]].map(([label, list]) => (
        <section key={label as string}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label as string}</h3>
          <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
            {(list as typeof SHORTCUTS).map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 py-2 text-[13px]">
                <span className="min-w-0"><span className="text-zinc-800 dark:text-zinc-100">{s.description}</span><br /><span className="text-[11px] text-zinc-400">Also: {s.visibleAffordance}</span></span>
                <Chord keys={s.keys} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
