# Billing — Stripe subscriptions

How Conqify charges for itself, what the database stores, and what has to be
configured before a single pound moves. Written for whoever has to operate this
at 2am, not for whoever wrote it.

---

## 1. The one-paragraph version

Conqify sells one product on two intervals: **$9/month** or **$79/year**. A
signed-in person chooses a plan, our server creates a **Stripe-hosted Checkout
Session** for a price it resolves itself, and Stripe takes the payment. Stripe
then sends a **signed webhook**, and that webhook — nothing else — writes the
row that says the person has paid. One predicate, `hasPaidAccess`, reads that
row, and one boundary component decides what to render. Cancelling and changing
a card happen in the **Stripe Customer Portal**, not in a UI of ours.

## 2. The invariant that matters most

> **Reaching `/billing/success` grants nothing.**

The redirect after Checkout is a browser navigation. Anyone can type it. Paid
access exists only because a signature-verified event from Stripe wrote
`public.billing_subscriptions`, and that table is read-only to the person it is
about. The success page re-reads the projection and reports what it finds; it
sets no flag and writes nothing.

## 3. Environment variables

| Variable | Where | Secret? | What happens if it is blank |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | server | **yes** | Checkout, Portal and the webhook all report themselves unavailable. |
| `STRIPE_WEBHOOK_SECRET` | server | **yes** | The webhook returns 503 rather than silently accepting events. |
| `STRIPE_PRICE_MONTHLY` | server | no | Choosing Monthly returns a calm 503. |
| `STRIPE_PRICE_ANNUAL` | server | no | Choosing Annual returns a calm 503. |
| `APP_URL` | server | no | Return URLs are built from each request's own origin. |
| `NEXT_PUBLIC_REQUIRE_PAID_ACCESS` | public | no | **The gate stays off.** Nothing is paywalled. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **yes** | The webhook cannot write; it returns 500 and Stripe retries. |

The two Stripe secrets are read behind `import "server-only"`, which makes a
client import a **build error** rather than a leak. `npm run audit:billing`
fails if that marker is ever removed, if anything reachable from a page imports
those modules, or if a secret name appears under a `NEXT_PUBLIC_` prefix.

### Sandbox price IDs

Price ids are not secrets, so they are recorded here rather than left to
folklore. They belong in the environment, not in code — promotion to live mode
must be four variable changes and nothing else.

```
STRIPE_PRICE_MONTHLY = price_1UG7BoBljVLPljHvHIxff53b     # $9 USD / month
STRIPE_PRICE_ANNUAL  = price_1UG7COBljVLPljHvXPLOWLvC     # $79 USD / year
```

Both are recurring licensed prices on the existing **Conqify** product in the
Stripe **sandbox/test** account. Do not recreate them. Do not point this build
at LotPilotAI's Stripe account.

## 4. Routes

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/billing/checkout` | POST | Bearer token | `{ plan: "monthly" \| "annual" }` → `{ url }`. Creates a Checkout Session. |
| `/api/billing/portal` | POST | Bearer token | `{}` → `{ url }`. Creates a Customer Portal session. |
| `/api/billing/webhook` | POST | Stripe signature | The only writer of subscription truth. |
| `/pricing` | page | none | The plans. Also the Checkout cancel destination. |
| `/billing` | page | none | Subscription state + **Manage subscription**. |
| `/billing/success` | page | none | Where Stripe returns. Grants nothing. |

**The webhook URL to register in Stripe is `https<colon>//<your-domain>/api/billing/webhook`.**
It is not `/api/stripe/webhook`; the repository namespaces routes by domain.

Events subscribed: `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.

## 5. The database

`supabase/migrations/0048_billing_subscriptions.sql` adds one table.

```
public.billing_subscriptions
  user_id                 uuid  primary key → auth.users(id) on delete cascade
  stripe_customer_id      text  not null, UNIQUE
  stripe_subscription_id  text  UNIQUE (partial, where not null)
  stripe_price_id         text
  plan                    text  'monthly' | 'annual' | null
  status                  text  not null — verbatim from Stripe
  current_period_end      timestamptz
  cancel_at_period_end    boolean not null
  last_event_at           timestamptz not null — the out-of-order guard
  created_at, updated_at  timestamptz not null
```

**Write authority is inverted compared with every other table in LifeOS.** RLS
carries a `SELECT` policy and nothing else, and the table privileges are revoked
from `anon` and `authenticated` besides. A person can read their own row and can
change nothing about it. Writes go through `apply_stripe_subscription` and
`attach_stripe_customer`, executable only by `service_role`.

`scripts/migration-rehearsal.mjs` proves this against a real PostgreSQL cluster,
as a non-superuser, with table privileges deliberately granted in the attacker's
favour so that RLS alone is what refuses.

No card numbers, no payment methods, no invoices, no email, no billing address.
Stripe is the system of record for payments.

## 6. Entitlement policy

One predicate: `hasPaidAccess` in `lib/billing/entitlement.ts`. Nothing else in
the codebase compares a subscription status to a string, and
`npm run audit:billing` fails if anything starts to.

| Stripe status | Access | Why |
| --- | --- | --- |
| `active` | ✅ | Paid and current. |
| `trialing` | ✅ | Not offered at launch; written the right way round so enabling a trial later is a dashboard change. |
| `past_due` | ✅ | A renewal failed and Stripe is retrying. Almost always an expired card. Access continues through the retry window; when Stripe gives up it moves to `unpaid` or `canceled`, which both revoke. |
| `unpaid` | ❌ | Stripe exhausted its retries. |
| `canceled` | ❌ | Ended. Stripe sets this at the effective end date, so cancel-at-period-end keeps access until then by staying `active`. |
| `incomplete` | ❌ | The first payment never completed. |
| `incomplete_expired` | ❌ | …and Stripe closed the attempt. |
| `paused` | ❌ | Not being billed. |
| anything else | ❌ | Fails closed until a human decides. |

**Staleness guard.** An entitling status whose `current_period_end` is more than
**3 days** in the past stops granting access. This exists because our copy is
only as fresh as the last webhook: if delivery breaks, the row freezes and would
otherwise grant free access forever, silently. It fails *closed*, which is a
deliberate trade — a webhook outage locks out a paying customer after three
days, which is visible and fixable, rather than giving away the product in a way
nobody notices. The pricing screen therefore always keeps a **Manage
subscription** link, which reads live Stripe state rather than our projection.

## 7. The access gate

`components/billing/PaidAccessGate.tsx` wraps the route tree once. No page
checks entitlement.

It **renders** rather than redirects: an unentitled person sees the pricing
surface at whatever URL they were on. Redirect loops are not merely avoided but
unrepresentable, because there is no redirect.

Always reachable without a subscription: `/pricing`, `/billing`,
`/billing/success`, `/privacy`, `/privacy/delete`, `/backup`, `/help`,
`/welcome`, `/security`, `/health`, `/diagnostics`, `/release`, `/dev`. Sign-in
and sign-out live in the nav, which renders outside the gate.

**The gate is a product boundary, not the data-security boundary.** What it
guards is the person's own data, which Postgres RLS protects regardless.
Defeating it in a browser would show someone their own records; it would not
show them anybody else's, and it would not make Stripe think they had paid.

**It is off by default.** `NEXT_PUBLIC_REQUIRE_PAID_ACCESS` must be exactly
`"true"` to engage. This is how §19 is satisfied without a founder-email
backdoor: the switch is explicit, visible in the deployment, and applies to
everyone equally, so there is no identity it can be wrong about. It also means
merging this work does not paywall the existing beta on the day it deploys.

In local-only mode (no Supabase configuration) the gate stands down entirely.
Nothing is ever deleted, archived or hidden because of billing state — see §22
of the sprint brief and the collision note in the PR.

## 8. Local webhook testing

The Stripe CLI forwards live sandbox events to a local server:

```
stripe listen --forward-to localhost:3000/api/billing/webhook
```

It prints a temporary signing secret. Put it in `.env.local`, which is
git-ignored. **Never commit a CLI-generated secret**, and never paste one into
`.env.example` — `npm run audit:billing` fails if the right-hand side of
`STRIPE_SECRET_KEY=` or `STRIPE_WEBHOOK_SECRET=` is ever non-empty there.

Mocked unit tests are not a substitute: the deployed preview endpoint must be
exercised through a real Stripe sandbox webhook before launch.

## 9. What is proved, and by what

| Claim | Proof |
| --- | --- |
| Plan → price mapping, unknown plan rejected | `lib/billing/selftest.ts` §1 |
| Entitlement across every Stripe status | `lib/billing/selftest.ts` §2 |
| Projection reads the period from the item, in seconds | `lib/billing/selftest.ts` §3 |
| Event routing, including the moved invoice→subscription link | `lib/billing/selftest.ts` §4 |
| Gate policy, allowlist, loop-freedom | `lib/billing/selftest.ts` §5 |
| Unauthenticated checkout rejected | `scripts/inject-billing-routes.cjs` §A |
| Client-supplied price / user id ignored | `…` §A, §B |
| One Stripe customer per person | `…` §C |
| Alice cannot open Bob's Portal | `…` §D |
| Webhook signatures — Stripe's own verifier | `…` §E |
| Subscription lifecycle transitions | `…` §F |
| Idempotency and out-of-order delivery | `…` §G |
| Only the webhook grants entitlement | `…` §H |
| A user cannot forge their own subscription row | `scripts/migration-rehearsal.mjs` §7a, live Postgres |
| No secret reaches a client bundle | `scripts/audit-billing.mjs` + `npm run build` |

Run it all with `npm run audit:billing` (no database or credentials needed) and
`npm run release:migrations` (needs a local PostgreSQL 16).

## 10. Going live

Sandbox first. Promotion is a configuration change, never a code change:

1. Replace `STRIPE_SECRET_KEY` with the live key.
2. Create a live webhook endpoint and replace `STRIPE_WEBHOOK_SECRET`.
3. Replace `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL` with live price ids.
4. Set `NEXT_PUBLIC_REQUIRE_PAID_ACCESS=true` when the paywall should engage.

No sandbox id appears in domain logic, so nothing else moves.
