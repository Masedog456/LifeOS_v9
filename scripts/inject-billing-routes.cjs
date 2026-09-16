#!/usr/bin/env node
/**
 * LIFEOS-BILLING §25 — the billing route harness.
 *
 * Drives the REAL route handlers — `app/api/billing/{checkout,portal,webhook}`
 * — against a stubbed Stripe API and a stubbed Supabase, and asserts the
 * security properties §24 names. Nothing here re-implements a route: a test
 * that restates the logic proves only that it was restated consistently, and
 * the claim under test is about the code that ships.
 *
 * ## What is genuinely real here
 *
 *   - the three route handlers, compiled from source
 *   - `lib/security/api-auth.ts`, the shared caller-authentication guard
 *   - the whole `lib/billing` layer: plans, projection, entitlement, sync
 *   - **Stripe's own signature verification.** `stripe.webhooks
 *     .constructEventAsync` is NOT stubbed. Signatures are computed here with
 *     Node's HMAC-SHA256 exactly as Stripe computes them, and the SDK verifies
 *     them. A test that stubbed the verifier would assert nothing about the one
 *     control that stands between a stranger and a free subscription.
 *
 * ## What is a model, and what that costs
 *
 * The Supabase client is a model of migration 0048: one row per user, a unique
 * `stripe_customer_id`, and the two functions with their monotonic guard. It is
 * honest about the semantics it models, but it is a model — so section H's
 * forgery assertions are worth exactly as much as the model.
 *
 * The REAL proof that a signed-in person cannot write their own billing row is
 * in `scripts/migration-rehearsal.mjs`, which runs the actual SQL against a
 * real PostgreSQL cluster as a non-superuser and watches the INSERT, UPDATE and
 * DELETE all fail. Section H is the application-layer companion to it, not a
 * substitute for it.
 *
 * Requires the compiled tree at scripts/out (`npm run audit:billing` builds it).
 */

const path = require("path");
const Module = require("module");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "out");
const REPO = path.join(__dirname, "..");

// ----------------------------------------------------------------- stubs ----

const MONTHLY_PRICE = "price_test_monthly";
const ANNUAL_PRICE = "price_test_annual";
const WEBHOOK_SECRET = "whsec_test_harness_secret";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-stub-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-stub-key";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.STRIPE_PRICE_MONTHLY = MONTHLY_PRICE;
process.env.STRIPE_PRICE_ANNUAL = ANNUAL_PRICE;
process.env.APP_URL = "https://app.conqify.test";

/** A minimal NextResponse: status, headers, and a parsed body. */
class StubResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
  }
  async json() { return this.body; }
}
const nextServerStub = {
  NextResponse: { json: (body, init) => new StubResponse(body, init) },
};

/** The modelled database. One object per user, keyed by user id. */
const db = {
  rows: new Map(),
  reset() { this.rows.clear(); },
  byCustomer(customerId) {
    for (const row of this.rows.values()) if (row.stripe_customer_id === customerId) return row;
    return null;
  },
};

/** Sessions the stub auth provider will accept: token -> user id. */
const sessions = new Map();

/**
 * A Supabase client model.
 *
 * The anon key gets `auth.getUser` and RLS-shaped reads. The service key gets
 * the two RPCs. Anything else throws, so a route that reached for a capability
 * it should not have would fail loudly rather than silently succeed.
 */
function createClientStub(url, key) {
  const privileged = key === process.env.SUPABASE_SERVICE_ROLE_KEY;

  const from = (table) => {
    if (table !== "billing_subscriptions") throw new Error(`unexpected table ${table}`);
    const filters = {};
    const builder = {
      select() { return builder; },
      eq(column, value) { filters[column] = value; return builder; },
      async maybeSingle() {
        if (!privileged) {
          // Under RLS an anon read is scoped to auth.uid(); the routes never
          // read this way, so reaching here is itself a defect.
          throw new Error("anon read reached the privileged store");
        }
        let row = null;
        if (filters.user_id) row = db.rows.get(filters.user_id) ?? null;
        else if (filters.stripe_customer_id) row = db.byCustomer(filters.stripe_customer_id);
        return { data: row ? { ...row } : null, error: null };
      },
    };
    return builder;
  };

  const rpc = async (name, args) => {
    rpcCalls.push({ name, privileged });
    if (!privileged) return { data: null, error: { code: "42501", message: "permission denied" } };

    if (name === "attach_stripe_customer") {
      const existing = db.rows.get(args.p_user_id);
      if (existing) return { data: existing.stripe_customer_id, error: null };
      const clash = db.byCustomer(args.p_customer_id);
      if (clash) return { data: null, error: { code: "23505", message: "unique violation" } };
      db.rows.set(args.p_user_id, {
        user_id: args.p_user_id,
        stripe_customer_id: args.p_customer_id,
        stripe_subscription_id: null,
        stripe_price_id: null,
        plan: null,
        status: "incomplete",
        current_period_end: null,
        cancel_at_period_end: false,
        last_event_at: "-infinity",
      });
      return { data: args.p_customer_id, error: null };
    }

    if (name === "apply_stripe_subscription") {
      const existing = db.rows.get(args.p_user_id);
      const incoming = {
        user_id: args.p_user_id,
        stripe_customer_id: args.p_customer_id,
        stripe_subscription_id: args.p_subscription_id,
        stripe_price_id: args.p_price_id,
        plan: args.p_plan,
        status: args.p_status,
        current_period_end: args.p_current_period_end,
        cancel_at_period_end: Boolean(args.p_cancel_at_period_end),
        last_event_at: args.p_event_at,
      };
      const clash = db.byCustomer(args.p_customer_id);
      if (clash && clash.user_id !== args.p_user_id) {
        return { data: null, error: { code: "23505", message: "unique violation" } };
      }
      if (!existing) {
        db.rows.set(args.p_user_id, incoming);
      } else {
        // The monotonic guard, exactly as the SQL expresses it.
        const stored = existing.last_event_at === "-infinity" ? -Infinity : Date.parse(existing.last_event_at);
        const arriving = Date.parse(args.p_event_at);
        if (stored <= arriving) db.rows.set(args.p_user_id, incoming);
      }
      return { data: { ...db.rows.get(args.p_user_id) }, error: null };
    }

    throw new Error(`unexpected rpc ${name}`);
  };

  return {
    auth: {
      async getUser(token) {
        const userId = sessions.get(token);
        if (!userId) return { data: { user: null }, error: { message: "invalid" } };
        return { data: { user: { id: userId } }, error: null };
      },
    },
    from,
    rpc,
  };
}

// Stripe calls the routes made, so assertions can inspect what was SENT.
const stripeCalls = { customers: [], sessions: [], portals: [], retrievals: [] };
/** Every RPC the routes issued, so "who may write" is observable. */
const rpcCalls = [];
/** Subscription objects the stubbed `subscriptions.retrieve` will return. */
const stripeSubscriptions = new Map();
let customerSeq = 0;

// ------------------------------------------------------------ resolution ----

const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  try {
    return realResolve.call(this, request, ...rest);
  } catch (e) {
    if (request.startsWith(".") || path.isAbsolute(request)) throw e;
    return require.resolve(request, { paths: [path.join(REPO, "node_modules")] });
  }
};

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  // `server-only` exists to make a client import a build error. In Node it just
  // throws, so it is neutralised here — the guarantee is enforced by
  // `npm run build` and by scripts/audit-billing.mjs, not by this harness.
  if (request === "server-only") return {};
  if (request === "next/server") return nextServerStub;
  if (request === "@supabase/supabase-js") return { createClient: createClientStub };
  return realLoad.call(this, request, ...rest);
};

// ------------------------------------------------------------- the code ----

const checkoutRoute = require("@/app/api/billing/checkout/route");
const portalRoute = require("@/app/api/billing/portal/route");
const webhookRoute = require("@/app/api/billing/webhook/route");
const { getStripe } = require("@/lib/billing/stripe");
const { hasPaidAccess } = require("@/lib/billing/entitlement");
const { resetRateLimits } = require("@/lib/security/api-auth");

/**
 * The REAL Stripe client, with its network-bearing resources replaced.
 *
 * `webhooks` is untouched, so signature verification below is Stripe's own.
 */
const stripe = getStripe();
stripe.customers = {
  async create(params) {
    customerSeq += 1;
    const customer = { id: `cus_stub_${customerSeq}`, metadata: params?.metadata ?? {} };
    stripeCalls.customers.push(params);
    return customer;
  },
};
stripe.checkout = {
  sessions: {
    async create(params) {
      stripeCalls.sessions.push(params);
      return { id: `cs_stub_${stripeCalls.sessions.length}`, url: "https://checkout.stripe.test/session" };
    },
  },
};
stripe.billingPortal = {
  sessions: {
    async create(params) {
      stripeCalls.portals.push(params);
      return { id: `bps_stub_${stripeCalls.portals.length}`, url: "https://portal.stripe.test/session" };
    },
  },
};
stripe.subscriptions = {
  async retrieve(id) {
    stripeCalls.retrievals.push(id);
    const found = stripeSubscriptions.get(id);
    if (!found) {
      const err = new Error("No such subscription");
      err.type = "StripeInvalidRequestError";
      throw err;
    }
    return found;
  },
};

// ------------------------------------------------------------- fixtures ----

const ALICE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ALICE_TOKEN = "token-alice";
const BOB_TOKEN = "token-bob";

function request(url, { method = "POST", body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return {
    url,
    method,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    },
    async json() {
      if (payload === undefined) throw new Error("no body");
      return JSON.parse(payload);
    },
    async text() {
      return payload ?? "";
    },
  };
}

function authed(url, token, body) {
  return request(url, { body: body ?? {}, headers: { authorization: `Bearer ${token}` } });
}

/**
 * The period end used throughout, thirty days out.
 *
 * Computed rather than fixed on purpose: `hasPaidAccess` applies a staleness
 * guard against the real clock, so a hard-coded date would make this harness
 * start failing on whatever day it drifted past — a test whose result depends
 * on when it is run proves nothing about the code.
 */
const PERIOD_END = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

/** A Stripe subscription object, on the pinned API version's shape. */
function subscription(overrides = {}) {
  const base = {
    id: "sub_alice",
    object: "subscription",
    status: "active",
    cancel_at_period_end: false,
    customer: "cus_stub_1",
    metadata: { lifeos_user_id: ALICE },
    items: { data: [{ current_period_end: PERIOD_END, price: { id: MONTHLY_PRICE } }] },
  };
  return { ...base, ...overrides };
}

/** Sign a payload the way Stripe does, so the SDK's verifier is exercised. */
function stripeSignature(payload, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signed = `${timestamp}.${payload}`;
  const v1 = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function webhookRequest(event, { secret = WEBHOOK_SECRET, timestamp, tamper = false, signature } = {}) {
  const payload = JSON.stringify(event);
  const header = signature ?? stripeSignature(payload, secret, timestamp);
  return request("https://app.conqify.test/api/billing/webhook", {
    body: tamper ? payload.replace('"active"', '"trialing"') : payload,
    headers: { "stripe-signature": header },
  });
}

function event(type, object, created = Math.floor(Date.now() / 1000)) {
  return { id: `evt_${type}_${created}`, type, created, data: { object } };
}

// ---------------------------------------------------------------- report ----

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : ` — ${detail ?? ""}`}`);
};

function reset() {
  db.reset();
  sessions.clear();
  stripeSubscriptions.clear();
  stripeCalls.customers.length = 0;
  stripeCalls.sessions.length = 0;
  stripeCalls.portals.length = 0;
  stripeCalls.retrievals.length = 0;
  customerSeq = 0;
  resetRateLimits();
  sessions.set(ALICE_TOKEN, ALICE);
  sessions.set(BOB_TOKEN, BOB);
}

async function main() {
  // ---- A. Checkout authentication (§10, §25) ----
  reset();
  {
    const anonymous = await checkoutRoute.POST(request("https://app.conqify.test/api/billing/checkout", { body: { plan: "monthly" } }));
    ok("A1 an unauthenticated checkout is rejected", anonymous.status === 401, `status ${anonymous.status}`);
    ok("A2 …and no Stripe customer was created", stripeCalls.customers.length === 0);
    ok("A3 …and no Checkout Session was created", stripeCalls.sessions.length === 0);

    const forged = await checkoutRoute.POST(request("https://app.conqify.test/api/billing/checkout", {
      body: { plan: "monthly" }, headers: { authorization: "Bearer not-a-real-token" },
    }));
    ok("A4 an invalid token is rejected", forged.status === 401, `status ${forged.status}`);

    const good = await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    ok("A5 an authenticated checkout succeeds", good.status === 200, `status ${good.status}`);
    ok("A6 …and returns a Stripe-hosted URL", typeof good.body.url === "string" && good.body.url.startsWith("https://"));
    ok("A7 the session is bound to the SERVER-resolved user",
      stripeCalls.sessions[0].client_reference_id === ALICE);
    ok("A8 …carried in metadata for the webhook to map back",
      stripeCalls.sessions[0].metadata.lifeos_user_id === ALICE &&
      stripeCalls.sessions[0].subscription_data.metadata.lifeos_user_id === ALICE);
    ok("A9 Stripe metadata carries an opaque id and nothing else",
      Object.keys(stripeCalls.sessions[0].metadata).length === 1);
    ok("A10 the customer Stripe was given carries no email or name",
      !("email" in stripeCalls.customers[0]) && !("name" in stripeCalls.customers[0]));
    ok("A11 the mode is subscription", stripeCalls.sessions[0].mode === "subscription");
  }

  // A client-supplied user id must change nothing.
  reset();
  {
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, {
      plan: "monthly", user_id: BOB, userId: BOB, customer: "cus_bob", client_reference_id: BOB,
    }));
    ok("A12 a client-supplied user id is ignored", stripeCalls.sessions[0].client_reference_id === ALICE);
    ok("A13 a client-supplied customer id is ignored", stripeCalls.sessions[0].customer !== "cus_bob");
    ok("A14 the stored row belongs to the authenticated user", db.rows.has(ALICE) && !db.rows.has(BOB));
  }

  // ---- B. Price injection (§9, §24) ----
  reset();
  {
    const injected = await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, {
      plan: "price_1FreeForever",
    }));
    ok("B1 an arbitrary price id where a plan belongs is rejected", injected.status === 400, `status ${injected.status}`);
    ok("B2 …and never reached Stripe", stripeCalls.sessions.length === 0);

    const bogus = await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "lifetime" }));
    ok("B3 an unknown plan is rejected", bogus.status === 400, `status ${bogus.status}`);

    const priced = await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, {
      plan: "monthly", price: "price_1FreeForever", line_items: [{ price: "price_1FreeForever", quantity: 1 }],
    }));
    ok("B4 a smuggled price field is ignored", priced.status === 200 && stripeCalls.sessions[0].line_items[0].price === MONTHLY_PRICE);
    ok("B5 exactly one line item is sent", stripeCalls.sessions[0].line_items.length === 1);
  }

  reset();
  {
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "annual" }));
    ok("B6 annual uses the annual price", stripeCalls.sessions[0].line_items[0].price === ANNUAL_PRICE);
  }

  reset();
  {
    const saved = process.env.STRIPE_PRICE_ANNUAL;
    delete process.env.STRIPE_PRICE_ANNUAL;
    const unconfigured = await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "annual" }));
    ok("B7 a missing price id is our fault (503), not a bad request", unconfigured.status === 503, `status ${unconfigured.status}`);
    process.env.STRIPE_PRICE_ANNUAL = saved;
  }

  // ---- C. Customer reuse (§11) ----
  reset();
  {
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "annual" }));
    ok("C1 a second Subscribe click creates no second Stripe customer", stripeCalls.customers.length === 1, `created ${stripeCalls.customers.length}`);
    ok("C2 both sessions use the same customer",
      stripeCalls.sessions[0].customer === stripeCalls.sessions[1].customer);
    ok("C3 …which is the one stored", stripeCalls.sessions[1].customer === db.rows.get(ALICE).stripe_customer_id);
  }

  reset();
  {
    // Concurrent clicks. Both may create a Stripe customer; only one binding
    // can win, and BOTH sessions must use the winner.
    const [a, b] = await Promise.all([
      checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" })),
      checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" })),
    ]);
    const stored = db.rows.get(ALICE).stripe_customer_id;
    ok("C4 concurrent checkouts both succeed", a.status === 200 && b.status === 200);
    ok("C5 exactly one customer binding exists", db.rows.size === 1);
    ok("C6 every session uses the bound customer",
      stripeCalls.sessions.every((s) => s.customer === stored));
  }

  // ---- D. Customer Portal isolation (§17, §24) ----
  reset();
  {
    const anonymous = await portalRoute.POST(request("https://app.conqify.test/api/billing/portal", { body: {} }));
    ok("D1 an unauthenticated portal request is rejected", anonymous.status === 401, `status ${anonymous.status}`);

    const none = await portalRoute.POST(authed("https://app.conqify.test/api/billing/portal", ALICE_TOKEN));
    ok("D2 a user with no customer gets a calm refusal, not a crash", none.status === 409, `status ${none.status}`);
    ok("D3 …and no portal session was created", stripeCalls.portals.length === 0);

    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", BOB_TOKEN, { plan: "monthly" }));
    const aliceCustomer = db.rows.get(ALICE).stripe_customer_id;
    const bobCustomer = db.rows.get(BOB).stripe_customer_id;
    ok("D4 Alice and Bob have different Stripe customers", aliceCustomer !== bobCustomer);

    const alicePortal = await portalRoute.POST(authed("https://app.conqify.test/api/billing/portal", ALICE_TOKEN));
    ok("D5 Alice's portal session is for Alice's customer",
      alicePortal.status === 200 && stripeCalls.portals.at(-1).customer === aliceCustomer);

    const attack = await portalRoute.POST(authed("https://app.conqify.test/api/billing/portal", ALICE_TOKEN, {
      customer: bobCustomer, stripe_customer_id: bobCustomer, user_id: BOB,
    }));
    ok("D6 Alice naming Bob's customer still gets her own",
      attack.status === 200 && stripeCalls.portals.at(-1).customer === aliceCustomer);
    ok("D7 Bob's customer never appeared in a portal call Alice made",
      stripeCalls.portals.every((p) => p.customer !== bobCustomer));

    const bobPortal = await portalRoute.POST(authed("https://app.conqify.test/api/billing/portal", BOB_TOKEN));
    ok("D8 Bob gets Bob's customer", bobPortal.status === 200 && stripeCalls.portals.at(-1).customer === bobCustomer);
    ok("D9 the return URL is our own origin",
      stripeCalls.portals.at(-1).return_url.startsWith("https://app.conqify.test/"));
  }

  // ---- E. Webhook signature verification (§13, §24) — Stripe's own verifier ----
  reset();
  {
    stripeSubscriptions.set("sub_alice", subscription());
    db.rows.set(ALICE, {
      user_id: ALICE, stripe_customer_id: "cus_stub_1", stripe_subscription_id: null,
      stripe_price_id: null, plan: null, status: "incomplete", current_period_end: null,
      cancel_at_period_end: false, last_event_at: "-infinity",
    });
    const evt = event("customer.subscription.updated", subscription());

    const unsigned = await webhookRoute.POST(request("https://app.conqify.test/api/billing/webhook", { body: evt }));
    ok("E1 a webhook with no signature is rejected", unsigned.status === 400, `status ${unsigned.status}`);
    ok("E2 …and changed nothing", db.rows.get(ALICE).status === "incomplete");

    const wrongSecret = await webhookRoute.POST(webhookRequest(evt, { secret: "whsec_not_ours" }));
    ok("E3 a signature made with the wrong secret is rejected", wrongSecret.status === 400, `status ${wrongSecret.status}`);
    ok("E4 …and changed nothing", db.rows.get(ALICE).status === "incomplete");

    const tampered = await webhookRoute.POST(webhookRequest(evt, { tamper: true }));
    ok("E5 a body altered after signing is rejected", tampered.status === 400, `status ${tampered.status}`);
    ok("E6 …and changed nothing", db.rows.get(ALICE).status === "incomplete");

    const stale = await webhookRoute.POST(webhookRequest(evt, { timestamp: Math.floor(Date.now() / 1000) - 60 * 60 }));
    ok("E7 a replay outside Stripe's tolerance is rejected", stale.status === 400, `status ${stale.status}`);

    const garbage = await webhookRoute.POST(webhookRequest(evt, { signature: "t=1,v1=deadbeef" }));
    ok("E8 a malformed signature header is rejected", garbage.status === 400, `status ${garbage.status}`);

    const valid = await webhookRoute.POST(webhookRequest(evt));
    ok("E9 a correctly signed event is accepted", valid.status === 200, `status ${valid.status}`);
    ok("E10 …and is applied", db.rows.get(ALICE).status === "active");
  }

  // ---- F. Subscription state transitions (§14, §25) ----
  reset();
  {
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    const customer = db.rows.get(ALICE).stripe_customer_id;
    stripeSubscriptions.set("sub_alice", subscription({ customer }));

    let t = Math.floor(Date.now() / 1000);
    const send = async (type, object) => webhookRoute.POST(webhookRequest(event(type, object, (t += 10))));

    ok("F0 before any event the user is not entitled", hasPaidAccess(project(db.rows.get(ALICE))) === false);

    await send("checkout.session.completed", { id: "cs_1", subscription: "sub_alice", metadata: { lifeos_user_id: ALICE } });
    ok("F1 checkout completion makes the subscription active", db.rows.get(ALICE).status === "active");
    ok("F2 …and the user is entitled", hasPaidAccess(project(db.rows.get(ALICE))) === true);
    ok("F3 …with the plan resolved from the price", db.rows.get(ALICE).plan === "monthly");
    ok("F4 …and the period taken from the item", db.rows.get(ALICE).current_period_end === PERIOD_END_ISO);

    stripeSubscriptions.set("sub_alice", subscription({ customer, cancel_at_period_end: true }));
    await send("customer.subscription.updated", subscription({ customer, cancel_at_period_end: true }));
    ok("F5 cancel-at-period-end is recorded", db.rows.get(ALICE).cancel_at_period_end === true);
    ok("F6 …and access continues until the period ends", hasPaidAccess(project(db.rows.get(ALICE))) === true);

    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "past_due" }));
    await send("invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_alice" } } });
    ok("F7 a failed payment is recorded as past_due", db.rows.get(ALICE).status === "past_due");
    ok("F8 …and access continues through Stripe's retries (documented policy)",
      hasPaidAccess(project(db.rows.get(ALICE))) === true);

    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "active" }));
    await send("invoice.paid", { id: "in_2", parent: { subscription_details: { subscription: "sub_alice" } } });
    ok("F9 a recovered payment restores active", db.rows.get(ALICE).status === "active");

    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "unpaid" }));
    await send("customer.subscription.updated", subscription({ customer, status: "unpaid" }));
    ok("F10 an unpaid subscription revokes access", hasPaidAccess(project(db.rows.get(ALICE))) === false);

    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "canceled" }));
    await send("customer.subscription.deleted", subscription({ customer, status: "canceled" }));
    ok("F11 a deleted subscription is canceled", db.rows.get(ALICE).status === "canceled");
    ok("F12 …and the user is no longer entitled", hasPaidAccess(project(db.rows.get(ALICE))) === false);
    ok("F13 the row still exists — nothing about the user was deleted", db.rows.has(ALICE));

    // §16: the projection comes from a re-read, not from the event body.
    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "active" }));
    await send("customer.subscription.updated", subscription({ customer, status: "canceled" }));
    ok("F14 the event body is NOT trusted; Stripe is re-read",
      db.rows.get(ALICE).status === "active", `stored ${db.rows.get(ALICE).status}`);
    ok("F15 every handled event caused exactly one retrieval",
      stripeCalls.retrievals.length === 7, `retrievals ${stripeCalls.retrievals.length}`);
  }

  // ---- G. Idempotency and ordering (§15, §16) ----
  reset();
  {
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    const customer = db.rows.get(ALICE).stripe_customer_id;
    stripeSubscriptions.set("sub_alice", subscription({ customer }));

    const duplicate = event("customer.subscription.updated", subscription({ customer }), 1_800_000_000);
    const first = await webhookRoute.POST(webhookRequest(duplicate));
    const snapshot = JSON.stringify(db.rows.get(ALICE));
    const second = await webhookRoute.POST(webhookRequest(duplicate));
    ok("G1 a redelivered event is accepted", first.status === 200 && second.status === 200);
    ok("G2 …and leaves exactly one row", db.rows.size === 1);
    ok("G3 …with identical values", JSON.stringify(db.rows.get(ALICE)) === snapshot);

    // An OLDER event carrying a cancellation must not overwrite newer state.
    stripeSubscriptions.set("sub_alice", subscription({ customer, status: "canceled" }));
    const oldEvent = event("customer.subscription.updated", subscription({ customer }), 1_700_000_000);
    await webhookRoute.POST(webhookRequest(oldEvent));
    ok("G4 a stale event does not overwrite newer state", db.rows.get(ALICE).status === "active");

    // A newer one does.
    const newEvent = event("customer.subscription.updated", subscription({ customer }), 1_900_000_000);
    await webhookRoute.POST(webhookRequest(newEvent));
    ok("G5 a newer event does apply", db.rows.get(ALICE).status === "canceled");
  }

  reset();
  {
    // An event about a customer we have never seen and with no metadata.
    stripeSubscriptions.set("sub_ghost", subscription({ id: "sub_ghost", customer: "cus_unknown", metadata: {} }));
    const response = await webhookRoute.POST(webhookRequest(event("customer.subscription.updated",
      subscription({ id: "sub_ghost", customer: "cus_unknown", metadata: {} }))));
    ok("G6 an unmappable event is acknowledged, not retried forever", response.status === 200, `status ${response.status}`);
    ok("G7 …and writes nothing", db.rows.size === 0);
    ok("G8 …and says so", response.body.applied === false && response.body.reason === "unknown_user");

    const ignored = await webhookRoute.POST(webhookRequest(event("radar.early_fraud_warning.created", { id: "issfr_1" })));
    ok("G9 an unhandled event type is acknowledged", ignored.status === 200 && ignored.body.reason === "ignored_event");
    ok("G10 …and did not call Stripe", stripeCalls.retrievals.length === 1);
  }

  reset();
  {
    // Metadata is the documented fallback for a subscription created outside
    // our checkout flow — but only after the signature has been verified.
    stripeSubscriptions.set("sub_manual", subscription({ id: "sub_manual", customer: "cus_manual" }));
    const response = await webhookRoute.POST(webhookRequest(event("customer.subscription.created",
      subscription({ id: "sub_manual", customer: "cus_manual" }))));
    ok("G11 a subscription created in the Stripe dashboard maps via metadata",
      response.status === 200 && db.rows.get(ALICE)?.status === "active");
  }

  // ---- H. Who may write the projection (§7, §24) ----
  //
  // The database-level proof — that a signed-in person's own connection cannot
  // INSERT, UPDATE or DELETE this row — runs against a real PostgreSQL cluster
  // in scripts/migration-rehearsal.mjs (section 8). These assertions are the
  // application-layer companion: they observe which routes issue a write at
  // all, which is a property of the shipped handlers rather than of the model.
  reset();
  {
    rpcCalls.length = 0;
    await checkoutRoute.POST(authed("https://app.conqify.test/api/billing/checkout", ALICE_TOKEN, { plan: "monthly" }));
    ok("H1 checkout binds a customer and nothing more",
      rpcCalls.every((c) => c.name === "attach_stripe_customer"),
      rpcCalls.map((c) => c.name).join(","));
    ok("H2 checkout never writes subscription state",
      rpcCalls.every((c) => c.name !== "apply_stripe_subscription"));
    ok("H3 checkout's write is not entitlement",
      hasPaidAccess(project(db.rows.get(ALICE))) === false, `status ${db.rows.get(ALICE).status}`);

    rpcCalls.length = 0;
    await portalRoute.POST(authed("https://app.conqify.test/api/billing/portal", ALICE_TOKEN));
    ok("H4 the portal route writes nothing at all", rpcCalls.length === 0, rpcCalls.map((c) => c.name).join(","));

    rpcCalls.length = 0;
    const customer = db.rows.get(ALICE).stripe_customer_id;
    stripeSubscriptions.set("sub_alice", subscription({ customer }));
    await webhookRoute.POST(webhookRequest(event("customer.subscription.updated", subscription({ customer }))));
    ok("H5 only the signature-verified webhook grants entitlement",
      rpcCalls.some((c) => c.name === "apply_stripe_subscription") &&
      hasPaidAccess(project(db.rows.get(ALICE))) === true);
    ok("H6 every write went through a privileged connection",
      rpcCalls.every((c) => c.privileged === true));

    // The anon path, for completeness. This asserts the MODEL's refusal — the
    // binding proof is the live cluster in the migration rehearsal.
    const anon = createClientStub(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const forged = await anon.rpc("apply_stripe_subscription", {
      p_user_id: BOB, p_customer_id: "cus_forged", p_status: "active",
    });
    ok("H7 an anon caller is refused the write function (modelled)", forged.error !== null);
    ok("H8 …and no row appeared for them", db.rows.has(BOB) === false);
  }

  // ---- report ----
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} billing route assertions ===`);
  if (passed !== results.length) process.exit(1);
}

/** Row → the shape the canonical predicate consumes. */
function project(row) {
  if (!row) return null;
  return {
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    plan: row.plan,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
