"use client";

/**
 * The pricing surface (LIFEOS-BILLING §20).
 *
 * ONE product, TWO intervals, nothing else. No tiers, no trial, no coupon
 * field, no comparison table, no "most popular" badge — §20 lists what must not
 * be here and the list is long on purpose. Conqify's pricing is a decision
 * somebody makes in ten seconds.
 *
 * The same component is both the `/pricing` route and what the gate renders in
 * place for an unentitled person, so there is one description of what Conqify
 * costs and it cannot drift.
 *
 * The button sends a plan word. It never sends a price id — see
 * `lib/billing/plans.ts`.
 */

import { useState } from "react";
import { planPresentation, type BillingPlan } from "@/lib/billing/plans";
import { requestCheckout } from "@/lib/billing/subscriptionStore";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";

export default function PricingPanel({
  heading = "Conqify",
  intro = "One subscription. Everything in Conqify, on every device you sign in to.",
  showManage = false,
  note = null,
}: {
  heading?: string;
  intro?: string;
  /** Show the Portal link — for people who believe they have already paid. */
  showManage?: boolean;
  note?: string | null;
}) {
  const [busy, setBusy] = useState<BillingPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plans = planPresentation();

  async function choose(plan: BillingPlan) {
    if (busy) return;
    setBusy(plan);
    setError(null);
    const result = await requestCheckout(plan);
    if (!result.ok) {
      setError(result.message);
      setBusy(null);
      return;
    }
    // Stripe-hosted Checkout. Conqify never renders a card form (§9).
    // `assign` rather than `location.href =` because the React Compiler reads
    // that assignment as mutating module-scope state from a component body.
    window.location.assign(result.url);
  }

  return (
    <section data-pricing-panel className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">{intro}</p>
        {note && (
          <p data-pricing-note className="mt-3 rounded-xl border border-black/[.08] bg-black/[.02] px-3 py-2 text-sm text-zinc-600 dark:border-white/[.1] dark:bg-white/[.03] dark:text-zinc-300">
            {note}
          </p>
        )}
      </header>

      <ul className="flex flex-col gap-3 sm:flex-row">
        {plans.map((p) => (
          <li
            key={p.plan}
            className="flex flex-1 flex-col rounded-2xl border border-black/[.1] p-5 dark:border-white/[.14]"
          >
            <span className="text-sm font-medium text-zinc-500">{p.label}</span>
            <span className="mt-2 text-3xl font-semibold tracking-tight">{p.price}</span>
            <span className="text-sm text-zinc-500">{p.cadence}</span>
            {p.note && <span className="mt-2 text-xs leading-relaxed text-zinc-500">{p.note}</span>}
            <button
              type="button"
              data-choose-plan={p.plan}
              disabled={busy !== null}
              onClick={() => void choose(p.plan)}
              className="mt-5 min-h-[44px] rounded-full bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === p.plan ? "Opening checkout…" : `Choose ${p.label.toLowerCase()}`}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p data-billing-error className="mt-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        Payment is handled by Stripe. Conqify never sees or stores your card details.
        Your own records are always yours — you can export everything from{" "}
        <a href="/backup" className="underline underline-offset-2">Backup</a>, subscribed or not.
      </p>

      {showManage && (
        <p className="mt-4 text-xs text-zinc-500">
          Already subscribed? <ManageSubscriptionButton label="Check with Stripe" subtle />
        </p>
      )}
    </section>
  );
}
