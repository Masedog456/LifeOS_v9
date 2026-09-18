"use client";

/**
 * /billing/success — where Stripe returns after Checkout (LIFEOS-BILLING §12).
 *
 * ## This page grants nothing
 *
 * §12 is mandatory: reaching this URL is UX, not entitlement. Anybody can type
 * it. So the page reads no query parameter, sets no flag, and writes nothing.
 * It re-reads the canonical projection — the one the signature-verified webhook
 * wrote — and reports what it finds.
 *
 * ## Why it polls briefly
 *
 * The browser's redirect and Stripe's webhook are two independent races, and
 * the redirect usually wins by a second or two. Showing "you are not
 * subscribed" in that window would be both alarming and wrong, so the page
 * re-reads a few times before saying anything definite, and when the wait runs
 * out it says the honest thing — that the confirmation is still coming —
 * instead of guessing in either direction.
 */

import { useEffect, useState } from "react";
import { hasPaidAccess } from "@/lib/billing/entitlement";
import { refreshSubscription, useSubscription } from "@/lib/billing/subscriptionStore";

/** Roughly fifteen seconds, which is far longer than the webhook normally takes. */
const ATTEMPTS = 10;
const INTERVAL_MS = 1_500;

export default function BillingSuccessPage() {
  const { subscription } = useSubscription();
  const [attemptsLeft, setAttemptsLeft] = useState(ATTEMPTS);
  const entitled = hasPaidAccess(subscription);

  useEffect(() => {
    if (entitled || attemptsLeft <= 0) return;
    const timer = setTimeout(() => {
      void refreshSubscription().then(() => setAttemptsLeft((n) => n - 1));
    }, attemptsLeft === ATTEMPTS ? 0 : INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [entitled, attemptsLeft]);

  const waiting = !entitled && attemptsLeft > 0;

  return (
    <main
      data-billing-success
      data-entitled={entitled ? "true" : "false"}
      className="mx-auto w-full max-w-2xl flex-1 px-6 py-10"
    >
      {entitled ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">You&rsquo;re subscribed</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Thank you. Everything in Conqify is open to you on any device you sign in to.
          </p>
          <p className="mt-5">
            <a
              href="/today"
              className="inline-block min-h-[40px] rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Go to Today
            </a>
          </p>
        </>
      ) : waiting ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Confirming your subscription</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Stripe has your payment. We&rsquo;re waiting for it to confirm — this usually takes a few seconds.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Still confirming</h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Your payment went through, but the confirmation hasn&rsquo;t reached us yet. Nothing is lost — reload
            this page in a minute, or open{" "}
            <a href="/billing" className="underline underline-offset-2">Subscription</a> to check.
          </p>
        </>
      )}

      <p className="mt-6 text-xs text-zinc-500">
        <a href="/billing" className="underline underline-offset-2">Manage your subscription</a>
      </p>
    </main>
  );
}
