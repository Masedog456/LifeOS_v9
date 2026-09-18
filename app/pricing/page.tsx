"use client";

/**
 * /pricing — what Conqify costs (LIFEOS-BILLING §12, §20).
 *
 * Also the cancel destination for Stripe Checkout. A cancelled checkout is not
 * a failure and must not read like one: the person changed their mind, which is
 * allowed, so the note says so plainly and the plans are still right there.
 *
 * Allowlisted in `lib/billing/gate.ts`, so it renders for everyone — signed
 * out, signed in, subscribed or not.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PricingPanel from "@/components/billing/PricingPanel";

function Pricing() {
  const cancelled = useSearchParams()?.get("checkout") === "cancelled";
  return (
    <PricingPanel
      showManage
      note={cancelled ? "No problem — nothing was charged. The plans are still here whenever you're ready." : null}
    />
  );
}

export default function PricingPage() {
  return (
    <main className="flex-1">
      {/* `useSearchParams` needs a Suspense boundary to prerender. */}
      <Suspense fallback={<PricingPanel showManage />}>
        <Pricing />
      </Suspense>
    </main>
  );
}
