"use client";

/**
 * Privacy Center (LIFEOS-040, Feature 27).
 *
 * Plain-language disclosure: what LifeOS stores, where, local vs remote, export
 * & deletion controls, diagnostics policy, external-link behavior, sync status,
 * retention limits, browser permissions. No claim of end-to-end encryption.
 */

import Link from "next/link";
import { useAuth } from "@/lib/authStore";
import { DATA_MAP } from "@/lib/privacy/data-map";
import { RETENTION_RULES } from "@/lib/privacy/retention";
import { usedPermissions, unusedPermissions } from "@/lib/privacy/permissions";

export default function PrivacyCenter() {
  const auth = useAuth();
  const remote = auth.configured && !!auth.email;

  return (
    <div className="flex flex-col gap-6" data-privacy-center>
      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Where your data lives</h2>
        <p className="mt-1 text-sm text-zinc-500">LifeOS is local-first. Your data is stored on this device{remote ? " and synced to your private Supabase account" : " only (you are not signed in, so nothing syncs)"}. LifeOS does not use end-to-end encryption, and we don&apos;t claim to.</p>
        <ul className="mt-3 divide-y divide-black/[.05] text-[13px] dark:divide-white/[.06]" data-data-map>
          {DATA_MAP.map((d) => (
            <li key={d.category} className="flex items-start justify-between gap-4 py-2">
              <span><span className="font-medium text-zinc-800 dark:text-zinc-100">{d.category}</span><br /><span className="text-zinc-500">{d.description}</span></span>
              <span className="shrink-0 text-[11px] text-zinc-400">{d.location === "local+remote" && remote ? "local + remote" : "local"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Your controls</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
          <Link href="/backup" className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Export my data</Link>
          <Link href="/recovery" className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Recover items</Link>
          <Link href="/security" className="rounded-full border border-black/[.12] px-4 py-1.5 dark:border-white/[.15]">Diagnostics</Link>
          <Link href="/privacy/delete" className="rounded-full border border-rose-500/40 px-4 py-1.5 text-rose-600 dark:text-rose-400">Delete my account</Link>
        </div>
      </section>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Diagnostics &amp; external links</h2>
        <p className="mt-1 text-sm text-zinc-500">Diagnostics carry only sanitized error codes and operation metadata — never your content, tokens, or private URLs. External links are opened only for http(s)/mailto addresses, in a new tab with no referrer.</p>
      </section>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Retention</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
          {RETENTION_RULES.map((r) => (
            <li key={r.subject}><span className="font-medium text-zinc-800 dark:text-zinc-100">{r.subject}:</span> <span className="text-zinc-500">{r.retention}</span></li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
        <h2 className="text-sm font-semibold">Browser permissions</h2>
        <p className="mt-1 text-[13px] text-zinc-500">Used: {usedPermissions().map((p) => p.name).join(", ")}.</p>
        <p className="mt-1 text-[13px] text-zinc-500">Not used (disabled by policy): {unusedPermissions().map((p) => p.name).join(", ")}.</p>
      </section>
    </div>
  );
}
