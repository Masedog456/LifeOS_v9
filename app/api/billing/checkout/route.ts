/**
 * Create a Stripe Checkout Session (LIFEOS-BILLING §9, §10, §11, §12).
 *
 * POST { plan: "monthly" | "annual" } -> { url }
 *
 * ## What the client is allowed to say
 *
 * One word. The request body carries a semantic plan and nothing else — no
 * price id, no customer id, no user id, no amount. §9 and §33 both forbid
 * trusting any of those, and the reason is concrete: a caller who can name the
 * price can name a $0 one, and a caller who can name the user can subscribe on
 * somebody else's behalf or attach somebody else's customer to their own
 * session. Everything except the plan is resolved server-side:
 *
 *   plan     -> `resolvePriceId`, from the environment
 *   user     -> `requireUser`, from the Supabase access token
 *   customer -> the canonical projection for that user, or a new one
 *
 * ## Customer reuse (§11)
 *
 * A new Stripe Customer per Subscribe click would scatter one person's billing
 * history across many customers and break the Portal. So: look for a stored
 * customer, reuse it, and only create one when there is none — then bind it
 * through `attach_stripe_customer`, which is idempotent and returns the id that
 * won if two clicks raced. The returned id is what the session is created for,
 * never the one we just made.
 */

import { NextResponse } from "next/server";
import { requireUser, rateLimit } from "@/lib/security/api-auth";
import { resolvePriceId } from "@/lib/billing/plans";
import { SUBSCRIPTION_USER_METADATA_KEY } from "@/lib/billing/projection";
import { appOrigin, getStripe } from "@/lib/billing/stripe";
import { attachStripeCustomer, readSubscriptionByUser } from "@/lib/billing/store";

export const runtime = "nodejs";

/** Calm, non-technical wording. No Stripe exception ever reaches a reader (§23). */
const UNAVAILABLE = "Subscriptions aren't available right now. Please try again shortly.";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? UNAVAILABLE : "Sign in to subscribe." },
      { status: auth.status },
    );
  }

  const limit = rateLimit(`billing:checkout:${auth.userId}`);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a plan to continue." }, { status: 400 });
  }

  const plan = (body as { plan?: unknown } | null)?.plan;
  const price = resolvePriceId(plan, process.env);
  if (!price.ok) {
    // Two different faults, two different statuses: an unknown plan is the
    // caller's, a missing price id is ours.
    return price.reason === "invalid_plan"
      ? NextResponse.json({ error: "Choose a plan to continue." }, { status: 400 })
      : NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });

  const existing = await readSubscriptionByUser(auth.userId);
  if (!existing.ok) {
    console.error("billing/checkout: store unavailable", existing.reason, existing.detail ?? "");
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  let customerId = existing.value?.stripeCustomerId ?? null;
  if (!customerId) {
    try {
      // No email and no name. Stripe Checkout collects the email it needs for
      // the receipt, and an address we copy is an address we then have to
      // protect and delete. The metadata is a uuid — the least identifying
      // thing that still maps a webhook back to an account (§10).
      const created = await stripe.customers.create({
        metadata: { [SUBSCRIPTION_USER_METADATA_KEY]: auth.userId },
      });
      const bound = await attachStripeCustomer(auth.userId, created.id);
      if (!bound.ok) {
        console.error("billing/checkout: could not bind customer", bound.reason, bound.detail ?? "");
        return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
      }
      // May differ from `created.id` if a concurrent request won the race.
      customerId = bound.value;
    } catch (error) {
      console.error("billing/checkout: customer creation failed", errorCode(error));
      return NextResponse.json({ error: UNAVAILABLE }, { status: 502 });
    }
  }

  const origin = appOrigin(request);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.priceId, quantity: 1 }],
      // Where Stripe returns the browser. Neither URL grants anything: §12 makes
      // webhook-confirmed state authoritative, and /billing/success reads the
      // canonical projection rather than the query string.
      success_url: `${origin}/billing/success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      client_reference_id: auth.userId,
      metadata: { [SUBSCRIPTION_USER_METADATA_KEY]: auth.userId },
      // Stripe does not copy session metadata onto the subscription it creates,
      // so it is set in both places; `lib/billing/sync.ts` reads either.
      subscription_data: { metadata: { [SUBSCRIPTION_USER_METADATA_KEY]: auth.userId } },
    });

    if (!session.url) {
      console.error("billing/checkout: session created without a url");
      return NextResponse.json({ error: UNAVAILABLE }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("billing/checkout: session creation failed", errorCode(error));
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
