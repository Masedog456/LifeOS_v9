/**
 * The Stripe webhook endpoint (LIFEOS-BILLING §12, §13, §14, §15).
 *
 * POST /api/billing/webhook
 *
 * ## This route is the only thing that can grant paid access
 *
 * §12 is mandatory and worth restating where it is enforced: reaching
 * `/billing/success?success=true` grants nothing. That URL is a browser
 * redirect, and anybody can type it. Paid access exists only because a
 * signature-verified event from Stripe wrote the canonical projection, which is
 * what this route does and what nothing else does.
 *
 * ## The raw body is never parsed first
 *
 * Stripe signs the exact bytes it sent. `await request.text()` yields those
 * bytes untouched; the signature is checked against them, and only then does
 * the SDK parse. Calling `request.json()` first — even just to peek at the
 * event type — would parse before verifying and hand a re-serialised body to
 * the verifier, which either fails every signature or, worse, passes one that
 * no longer matches what was signed. Next's App Router does not consume or
 * re-encode the body, so no `bodyParser: false` equivalent is needed here;
 * `runtime = "nodejs"` is set because the Stripe SDK expects Node crypto.
 *
 * `constructEventAsync` is used rather than `constructEvent` so verification
 * works through the platform's async crypto provider.
 *
 * ## Status codes are a control signal to Stripe
 *
 * Stripe retries a non-2xx with backoff for days, then disables an endpoint
 * that keeps failing. So the codes here are chosen for what we want Stripe to
 * do, not for how the request "feels":
 *
 *   400 — the signature did not verify. Not ours, never retry.
 *   200 — understood; nothing to change (unhandled type, no subscription, or a
 *         customer we have never seen). A retry would reach the same answer.
 *   500 — we could not do the work (Stripe unreachable, database down). Please
 *         retry; this is exactly the case retries exist for.
 *
 * ## What is logged
 *
 * The event id, the event type, and a one-word outcome. Never the body, never
 * a customer's details, never a secret, never a Stripe error message (§13, §23).
 */

import { NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/sync";

export const runtime = "nodejs";
/** Never cached, never statically analysed into a build-time result. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!stripe || !secret) {
    // Unconfigured. 503 rather than 200: an endpoint that silently swallows
    // events while misconfigured is how a production deployment ends up with a
    // frozen projection and no sign of it.
    console.error("billing/webhook: not configured");
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // The exact bytes Stripe signed. Nothing reads or parses the body before this
  // point, and nothing parses it after except the verifier itself.
  const rawBody = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    // No detail is logged and none is returned: a signature failure is either a
    // rotated secret or somebody probing, and neither is helped by a hint.
    console.error("billing/webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const outcome = await handleStripeEvent(event);

  if (!outcome.ok) {
    console.error("billing/webhook: could not apply", event.id, event.type, outcome.reason, outcome.detail ?? "");
    return NextResponse.json({ error: "Could not process event." }, { status: 500 });
  }

  if (!outcome.applied) {
    // Worth a line only when it is a mapping we expected to find. An unhandled
    // event type is ordinary noise and would drown the log.
    if (outcome.reason === "unknown_user") {
      console.warn("billing/webhook: no LifeOS user for this customer", event.id, event.type);
    }
    return NextResponse.json({ received: true, applied: false, reason: outcome.reason });
  }

  // The status, not the user's identity: enough to reconstruct what happened,
  // nothing that identifies a person.
  console.log("billing/webhook: applied", event.id, event.type, outcome.status);
  return NextResponse.json({ received: true, applied: true });
}
