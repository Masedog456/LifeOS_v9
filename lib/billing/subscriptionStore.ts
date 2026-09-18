/**
 * The browser's view of its own subscription (LIFEOS-BILLING §18, §21).
 *
 * ONE fetch, shared. The gate wraps every route and the billing page renders
 * inside it, so a per-component fetch would query the same row twice on every
 * navigation. This is the same `useSyncExternalStore` shape as
 * `lib/authStore.ts`, for the same reason.
 *
 * ## It reads with the anon key, under RLS
 *
 * Deliberately not through an API route. `billing_subscriptions` carries a
 * SELECT policy of `auth.uid() = user_id`, so the database itself makes asking
 * for another person's row impossible — there is no server-side ownership check
 * here that could be written wrong, because there is no server-side check at
 * all. And the privileged key stays where it belongs: nowhere near the browser.
 *
 * ## What the browser can and cannot do with this
 *
 * It can read. It cannot write: the table grants no INSERT, UPDATE or DELETE to
 * `authenticated`, and no policy exists for them either (migration 0048). A
 * person who edits this state in their own memory changes what their own screen
 * renders and nothing else — no server accepts it, and it is gone on reload.
 *
 * ## `resolved` is not the same as "has a subscription"
 *
 * The gate must not flash a paywall at a subscriber while the query is in
 * flight, so it waits for `resolved` before deciding. `resolved` becomes true
 * when the answer is known — including when the answer is "no row".
 */

import { useSyncExternalStore } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { authedJsonHeaders } from "@/lib/security/api-token";
import type { BillingPlan } from "@/lib/billing/plans";
import type { SubscriptionProjection } from "@/lib/billing/entitlement";

export interface SubscriptionState {
  /** True once a definite answer is known — a row, or definitely no row. */
  resolved: boolean;
  subscription: SubscriptionProjection | null;
  /** Set when the read itself failed. Never a raw provider message. */
  error: string | null;
}

const INITIAL: SubscriptionState = { resolved: false, subscription: null, error: null };
/** Server render: never claims to know, so no paywall is ever server-rendered. */
const SERVER_SNAPSHOT: SubscriptionState = INITIAL;

let state: SubscriptionState = INITIAL;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function set(patch: Partial<SubscriptionState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeSubscription(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSubscriptionState(): SubscriptionState {
  return state;
}

export function useSubscription(): SubscriptionState {
  return useSyncExternalStore(subscribeSubscription, getSubscriptionState, () => SERVER_SNAPSHOT);
}

/** Test seam, and what sign-out uses: forget everything we knew. */
export function resetSubscriptionState(): void {
  inFlight = null;
  state = INITIAL;
  listeners.forEach((l) => l());
}

/**
 * Read the signed-in person's subscription row.
 *
 * Concurrent callers share one request — the gate and the billing page mount
 * together, and two identical queries would be wasted work.
 *
 * A signed-out or unconfigured session resolves to "no subscription" rather
 * than staying pending forever: the gate's own policy decides what that means,
 * and leaving it unresolved would hang the UI on a loading state.
 */
export function refreshSubscription(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!isSupabaseConfigured()) {
      set({ resolved: true, subscription: null, error: null });
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      set({ resolved: true, subscription: null, error: null });
      return;
    }
    try {
      const { data: userData } = await client.auth.getUser();
      if (!userData?.user?.id) {
        set({ resolved: true, subscription: null, error: null });
        return;
      }
      const { data, error } = await client
        .from("billing_subscriptions")
        .select("status, current_period_end, cancel_at_period_end, plan, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (error) {
        // Resolved, with no subscription and an error noted. Failing closed is
        // the deliberate choice: an unreadable projection must not be treated
        // as entitlement. The pricing surface keeps a "Manage subscription"
        // control precisely so this state is recoverable without support.
        set({ resolved: true, subscription: null, error: "We couldn't check your subscription." });
        return;
      }

      set({ resolved: true, error: null, subscription: data ? rowToProjection(data) : null });
    } catch {
      set({ resolved: true, subscription: null, error: "We couldn't check your subscription." });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

interface Row {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

function rowToProjection(row: Row): SubscriptionProjection {
  return {
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    plan: row.plan === "monthly" || row.plan === "annual" ? (row.plan as BillingPlan) : null,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

// ------------------------------------------------------------- actions ----

export type BillingActionFailure = { ok: false; message: string };
export type BillingActionSuccess = { ok: true; url: string };
export type BillingActionResult = BillingActionSuccess | BillingActionFailure;

/**
 * Ask the server for a Checkout Session and return where to send the browser.
 *
 * The plan word is the ONLY thing sent. Note what is absent: no price, no
 * customer, no user. The server resolves all three (§9, §10).
 */
export async function requestCheckout(plan: BillingPlan): Promise<BillingActionResult> {
  return postForUrl("/api/billing/checkout", { plan }, "We couldn't start checkout. Please try again.");
}

/** Ask the server for a Customer Portal session. Sends no customer id (§24). */
export async function requestPortal(): Promise<BillingActionResult> {
  return postForUrl("/api/billing/portal", {}, "We couldn't open billing management. Please try again.");
}

async function postForUrl(path: string, body: unknown, fallback: string): Promise<BillingActionResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: await authedJsonHeaders(),
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!response.ok || !payload?.url) {
      // The server's own calm wording when it gave one; never a status code or
      // a provider message.
      return { ok: false, message: payload?.error ?? fallback };
    }
    return { ok: true, url: payload.url };
  } catch {
    return { ok: false, message: fallback };
  }
}

/**
 * Whether this deployment requires a subscription.
 *
 * Read through a function rather than inline so that every reader goes through
 * one definition of "on", and so the self-test can state the default in one
 * place. Off unless explicitly set to `true` — see `lib/billing/gate.ts` for
 * why the switch exists at all.
 */
export function paidAccessRequired(): boolean {
  return process.env.NEXT_PUBLIC_REQUIRE_PAID_ACCESS === "true";
}
