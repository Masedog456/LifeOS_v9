/**
 * Create a Stripe Billing Portal session (LIFEOS-BILLING §17, §24).
 *
 * POST {} -> { url }
 *
 * ## "Alice must never create a Portal session for Bob's customer" (§24)
 *
 * The request body is ignored entirely — it carries no customer id, because if
 * it did, that sentence would be false. The customer comes from exactly one
 * place: the `billing_subscriptions` row keyed by the user id that
 * `requireUser` resolved from the Supabase access token. There is no argument
 * anywhere on this path that a caller can influence, so cross-user access is
 * not prevented by a check that could be written wrong — it is unreachable.
 *
 * ## Why there is no custom cancellation UI
 *
 * §17 asks for the Portal to handle payment methods and cancellation, and it
 * does. Building our own would mean writing subscription mutations of our own,
 * which is the one thing the canonical projection exists to avoid: Stripe stays
 * the system of record and tells us what happened through the webhook.
 * Cancel-at-period-end vs. immediate is a Stripe Portal configuration, set in
 * the dashboard — see BILLING.md.
 */

import { NextResponse } from "next/server";
import { requireUser, rateLimit } from "@/lib/security/api-auth";
import { appOrigin, getStripe } from "@/lib/billing/stripe";
import { readSubscriptionByUser } from "@/lib/billing/store";

export const runtime = "nodejs";

const UNAVAILABLE = "Billing management isn't available right now. Please try again shortly.";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? UNAVAILABLE : "Sign in to manage your subscription." },
      { status: auth.status },
    );
  }

  const limit = rateLimit(`billing:portal:${auth.userId}`);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  const existing = await readSubscriptionByUser(auth.userId);
  if (!existing.ok) {
    console.error("billing/portal: store unavailable", existing.reason, existing.detail ?? "");
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const customerId = existing.value?.stripeCustomerId;
  if (!customerId) {
    // Nothing to manage yet. 409 rather than 404: the account exists, the
    // billing relationship does not.
    return NextResponse.json(
      { error: "You don't have a subscription to manage yet." },
      { status: 409 },
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(request)}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("billing/portal: session creation failed", errorCode(error));
    return NextResponse.json({ error: UNAVAILABLE }, { status: 502 });
  }
}

/** A short, non-identifying label. Never the error's message or body. */
function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { type?: unknown; code?: unknown };
    if (typeof e.type === "string") return e.type;
    if (typeof e.code === "string") return e.code;
  }
  return "unknown";
}
