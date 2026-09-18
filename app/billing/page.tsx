"use client";

/**
 * /billing — subscription state and one button (LIFEOS-BILLING §21).
 *
 * §21 asks for a restrained section, not a billing dashboard. So: plan, status
 * in plain words, when the period ends, whether it is set to stop, and "Manage
 * subscription". Invoices, payment methods and receipts all live in the Stripe
 * Customer Portal, which is one click away and which Stripe keeps correct.
 *
 * Everything here comes from the canonical projection through the canonical
 * predicate. There is no status comparison in this file.
 */

import { useEffect } from "react";
import { useAuth } from "@/lib/authStore";
import { describeSubscription, hasPaidAccess } from "@/lib/billing/entitlement";
import { refreshSubscription, useSubscription } from "@/lib/billing/subscriptionStore";
import ManageSubscriptionButton from "@/components/billing/ManageSubscriptionButton";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function BillingPage() {
  const auth = useAuth();
  const { resolved, subscription, error } = useSubscription();

  useEffect(() => {
    void refreshSubscription();
  }, [auth.email]);

  const entitled = hasPaidAccess(subscription);
  const periodEnd = formatDate(subscription?.currentPeriodEnd ?? null);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Payments and receipts are handled by Stripe. Conqify stores only what it needs to know whether your
          account is active.
        </p>
      </header>

      {!auth.configured && (
        <p className="text-sm text-zinc-500">
          This copy of Conqify runs locally on this device, so there is nothing to bill.
        </p>
      )}

      {auth.configured && !auth.email && (
        <p className="text-sm text-zinc-500">
          Sign in with your email to see your subscription.{" "}
          <a href="/pricing" className="underline underline-offset-2">See the plans</a>.
        </p>
      )}

      {auth.configured && auth.email && !resolved && <p className="text-sm text-zinc-400">One moment…</p>}

      {auth.configured && auth.email && resolved && (
        <section
          data-billing-status
          data-entitled={entitled ? "true" : "false"}
          className="rounded-2xl border border-black/[.1] p-5 dark:border-white/[.14]"
        >
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-zinc-500">Plan</dt>
              <dd data-billing-plan className="font-medium">
                {subscription?.plan === "monthly" ? "Monthly" : subscription?.plan === "annual" ? "Annual" : "—"}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-zinc-500">Status</dt>
              <dd data-billing-state className="max-w-sm text-right">
                {describeSubscription(subscription)}
              </dd>
            </div>
            {periodEnd && (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-zinc-500">
                  {subscription?.cancelAtPeriodEnd ? "Access until" : "Renews"}
                </dt>
                <dd data-billing-period-end>{periodEnd}</dd>
              </div>
            )}
          </dl>

          {error && (
            <p data-billing-error className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {subscription?.stripeCustomerId ? (
              <ManageSubscriptionButton />
            ) : (
              <a
                href="/pricing"
                className="min-h-[40px] rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                See the plans
              </a>
            )}
          </div>
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-zinc-500">
        Cancelling stops future payments. It never deletes anything you have written — your records stay, and you
        can export all of them from <a href="/backup" className="underline underline-offset-2">Backup</a> at any
        time.
      </p>
    </main>
  );
}
