"use client";

/**
 * "Manage subscription" — opens the Stripe Customer Portal (LIFEOS-BILLING §17).
 *
 * One control, reused by the billing page and by the pricing surface the gate
 * renders. It appears on the pricing surface deliberately: a person whose
 * projection went stale during a webhook outage would otherwise be looking at a
 * paywall with no way to prove they had already paid. This is that way.
 *
 * It sends no customer id. See `app/api/billing/portal/route.ts` for why that
 * absence is the security property.
 */

import { useState } from "react";
import { requestPortal } from "@/lib/billing/subscriptionStore";

export default function ManageSubscriptionButton({
  label = "Manage subscription",
  subtle = false,
}: {
  label?: string;
  subtle?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await requestPortal();
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    // A full navigation, not a router push: the destination is Stripe's.
    // `assign` rather than `location.href =` because the React Compiler reads
    // that assignment as mutating module-scope state from a component body.
    window.location.assign(result.url);
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        data-manage-subscription
        disabled={busy}
        onClick={() => void open()}
        className={
          subtle
            ? "min-h-[36px] text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
            : "min-h-[40px] rounded-full border border-black/[.15] px-4 text-sm font-medium hover:bg-black/[.04] disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/[.06]"
        }
      >
        {busy ? "Opening…" : label}
      </button>
      {error && (
        <span data-billing-error className="text-xs text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </span>
  );
}
