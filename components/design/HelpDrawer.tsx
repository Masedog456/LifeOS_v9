"use client";

/**
 * Help Center (LIFEOS-041, Feature 12). An in-product help surface listing every
 * section (sourced from the real docs), route-aware so the current route's help
 * is highlighted, plus the shortcut reference and glossary. No chat assistant.
 */

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { HELP_SECTIONS, helpForRoute } from "@/lib/onboarding/education";
import { TERMS } from "@/lib/design/terminology";
import ShortcutReference from "@/components/design/ShortcutReference";
import SampleWorkspacePreview from "@/components/onboarding/SampleWorkspacePreview";

export default function HelpDrawer() {
  const pathname = usePathname() || "/";
  const suggested = useMemo(() => helpForRoute(pathname), [pathname]);
  const [open, setOpen] = useState<string>(suggested?.id ?? "getting-started");

  return (
    <div data-help-center className="flex flex-col gap-5">
      {suggested && (
        <p className="rounded-xl border border-black/[.06] bg-black/[.02] px-3.5 py-2.5 text-[13px] text-zinc-600 dark:border-white/[.08] dark:bg-white/[.03] dark:text-zinc-300" data-help-suggested>
          On this page: <button type="button" className="font-medium underline" onClick={() => setOpen(suggested.id)}>{suggested.title}</button>
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5" role="tablist" aria-label="Help sections">
        {HELP_SECTIONS.map((s) => (
          <li key={s.id}>
            <button type="button" role="tab" aria-selected={open === s.id} data-help-section={s.id} onClick={() => setOpen(s.id)}
              className={`rounded-full px-3 py-1 text-[12px] ${open === s.id ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-black/[.12] dark:border-white/[.15]"}`}>{s.title}</button>
          </li>
        ))}
      </ul>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]" data-help-panel={open}>
        {open === "shortcuts" ? <ShortcutReference />
          : open === "glossary" ? (
            <dl className="flex flex-col gap-2.5">
              {TERMS.map((t) => (
                <div key={t.key} className="text-[13px]"><dt className="font-medium text-zinc-800 dark:text-zinc-100">{t.name}</dt><dd className="text-zinc-500">{t.definition}</dd></div>
              ))}
            </dl>
          ) : (
            <div className="flex flex-col gap-4 text-[13px] text-zinc-600 dark:text-zinc-300">
              <div>
                <p className="font-medium text-zinc-800 dark:text-zinc-100">{HELP_SECTIONS.find((s) => s.id === open)?.title}</p>
                <p className="mt-1 text-zinc-500">Full guidance lives in <code className="rounded bg-black/[.04] px-1 dark:bg-white/[.06]">{HELP_SECTIONS.find((s) => s.id === open)?.doc}</code>. Use the links in the app or the docs folder for the complete reference.</p>
              </div>
              {open === "getting-started" && <SampleWorkspacePreview />}
            </div>
          )}
      </section>
    </div>
  );
}
