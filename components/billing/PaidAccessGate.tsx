"use client";

/**
 * The paid-access boundary (LIFEOS-BILLING §18).
 *
 * ONE boundary, at the top of the route tree, wrapping everything once. No page
 * in LifeOS checks entitlement; they do not know this exists. §18 asks for
 * exactly that, and the alternative — a conditional in each paid surface — goes
 * wrong the first time somebody adds a route and forgets.
 *
 * ## It renders; it does not redirect
 *
 * An unentitled person sees the pricing surface at whatever URL they are on.
 * Nothing navigates, so the redirect loop §18 warns about cannot occur: there
 * is no redirect to loop. It also means the address bar still holds where they
 * were going, so subscribing puts them back there on reload.
 *
 * ## The policy is not here
 *
 * `lib/billing/gate.ts` decides; this component renders the decision. That
 * split is what lets the policy be exhaustively tested — over every allowlisted
 * path, every auth state and both entitlement outcomes — without a browser.
 *
 * ## Nothing is deleted, ever (§22)
 *
 * The gate changes what is drawn. It does not touch local state, does not clear
 * storage, and does not stop sync. The nav renders outside it, so signing out,
 * exporting data and the privacy controls stay reachable from every route.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/authStore";
import { categorize } from "@/lib/security/auth-boundaries";
import { evaluateGate } from "@/lib/billing/gate";
import { hasPaidAccess } from "@/lib/billing/entitlement";
import {
  paidAccessRequired,
  refreshSubscription,
  useSubscription,
} from "@/lib/billing/subscriptionStore";
import PricingPanel from "@/components/billing/PricingPanel";

export default function PaidAccessGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const subscription = useSubscription();
  const pathname = usePathname() ?? "/";
  const required = paidAccessRequired();

  // Read the projection once the person is known to be signed in. Keyed on the
  // email so that signing in as somebody else re-reads rather than showing the
  // previous account's entitlement.
  useEffect(() => {
    if (!required) return;
    void refreshSubscription();
  }, [required, auth.email]);

  const decision = evaluateGate({
    paidAccessRequired: required,
    supabaseConfigured: auth.configured,
    authCategory: categorize({ loading: auth.loading, email: auth.email }),
    entitlementResolved: subscription.resolved,
    entitled: hasPaidAccess(subscription.subscription),
    pathname,
  });

  if (decision.decision === "allow") return <>{children}</>;

  if (decision.decision === "loading") {
    return (
      <main data-paid-gate="loading" className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <p className="text-sm text-zinc-400">One moment…</p>
      </main>
    );
  }

  if (decision.decision === "sign-in") {
    return (
      <main data-paid-gate="sign-in" className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          Conqify keeps your records to your account. Use <span className="font-medium">Get started</span> at
          the top of the page to sign in with your email, then come back here.
        </p>
        <p className="mt-4 text-sm text-zinc-500">
          Not subscribed yet? <a href="/pricing" className="underline underline-offset-2">See what Conqify costs</a>.
        </p>
      </main>
    );
  }

  return (
    <main data-paid-gate="pricing" className="flex-1">
      <PricingPanel
        heading="Conqify needs a subscription"
        intro="Your records are safe and unchanged. Choose a plan to pick up where you left off."
        showManage
        note={
          subscription.error
            ? "We couldn't check your subscription just now. If you've already subscribed, use the link below to confirm with Stripe."
            : null
        }
      />
    </main>
  );
}
