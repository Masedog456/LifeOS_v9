-- LIFEOS-BILLING — the canonical subscription projection.
--
-- ONE table. Conqify sells one product on two intervals, and this is the only
-- place in the database that says whether a person has paid. Subscription truth
-- is not smeared across profile columns, feature flags, or a "plan" string on a
-- user row; there is one projection and one predicate over it
-- (`lib/billing/entitlement.ts`).
--
-- ## The security property this migration exists to create
--
-- **A user must not be able to make themselves a subscriber.**
--
-- Every other table in LifeOS is the user's own content: they may insert,
-- update and delete their rows freely, because the rows are theirs. This table
-- is different in kind. It is not something the user authored — it is a claim
-- ABOUT the user, made by Stripe, and a person who can write it can grant
-- themselves the product for free. So the usual four-policy pattern would be
-- exactly wrong here.
--
-- The write authority is therefore reversed, in two independent layers:
--
--   1. RLS carries a SELECT policy and NOTHING else. Postgres denies any
--      command that has no policy, so INSERT, UPDATE and DELETE are refused for
--      every authenticated caller with no rule needed to say so.
--   2. The table privileges themselves are revoked from `anon` and
--      `authenticated`, so the refusal does not depend on the policy set being
--      right. Supabase grants these roles full DML on new public tables by
--      default; this takes it back.
--
-- Writes reach this table through exactly one door: `apply_stripe_subscription`
-- and `attach_stripe_customer` below, executable only by `service_role`, called
-- only from the signature-verified Stripe webhook and the authenticated
-- checkout route. `scripts/migration-rehearsal.mjs` proves the refusal live,
-- as a non-superuser, against a real cluster.
--
-- ## What is deliberately NOT stored
--
-- No card numbers, no payment methods, no invoices, no raw Stripe payloads, no
-- billing address, no email. Stripe is the system of record for payments; this
-- is the minimum projection needed to answer "may this person use Conqify?" and
-- to render an honest account screen. Anything else would be a copy of
-- somebody's financial data that we would then have to protect and delete.

create table if not exists public.billing_subscriptions (
  -- One row per user. The primary key IS the ownership column: a person cannot
  -- have two subscription states, so there is no id to disagree about.
  --
  -- The `auth.uid()` default is inert here — every write comes from the service
  -- role, which has no `auth.uid()`, and passes the id explicitly. It is
  -- present because the ownership convention is checked chain-wide by the
  -- migration rehearsal, and an exception would have to be argued for on every
  -- future read of that check rather than being simply true.
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,

  -- The Stripe Customer this person is. UNIQUE, so one Stripe customer can
  -- never be bound to two LifeOS users — the constraint that stops Alice from
  -- inheriting Bob's billing relationship even if a code path went wrong.
  stripe_customer_id      text not null,

  -- Null between "we created a customer for checkout" and "a subscription
  -- exists". Also unique: one subscription belongs to one user.
  stripe_subscription_id  text,

  -- What they are on. Kept for the account screen and for support; entitlement
  -- never consults it.
  stripe_price_id         text,
  plan                    text,

  -- Stored verbatim as Stripe reports it. The meaning of a status is decided in
  -- one place (`lib/billing/entitlement.ts`); normalising or pre-judging it
  -- here would put that decision in two.
  status                  text not null default 'incomplete',

  -- Derived from the subscription ITEM, not the subscription: Stripe moved the
  -- billing period onto items. See lib/billing/projection.ts.
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,

  -- The `created` timestamp of the most recent Stripe event applied to this
  -- row. Stripe does not guarantee delivery order, so this is the monotonic
  -- guard that stops an older event from overwriting newer state (§16).
  -- `-infinity` means "nothing applied yet", so the first event always wins.
  last_event_at           timestamptz not null default '-infinity',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- A plan is one of the two we sell, or unknown. Never free text.
  constraint billing_subscriptions_plan_valid
    check (plan is null or plan in ('monthly', 'annual')),
  -- A customer id we cannot use is worse than none: it would be reused at
  -- checkout and fail against Stripe on every attempt.
  constraint billing_subscriptions_customer_present
    check (length(btrim(stripe_customer_id)) > 0)
);

-- One Stripe customer ↔ one LifeOS user, enforced by the database rather than
-- by the correctness of application code.
create unique index if not exists billing_subscriptions_customer_idx
  on public.billing_subscriptions (stripe_customer_id);

-- One Stripe subscription ↔ one LifeOS user. Partial, because the column is
-- null for a customer who has not subscribed yet and any number of those may
-- coexist.
create unique index if not exists billing_subscriptions_subscription_idx
  on public.billing_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.billing_subscriptions enable row level security;

-- SELECT and nothing else. A missing policy is a denial in Postgres, so the
-- absence of insert/update/delete policies below is the control, not an
-- oversight — this comment exists so that nobody "fixes" it later.
do $$
begin
  drop policy if exists billing_subscriptions_select on public.billing_subscriptions;
  create policy billing_subscriptions_select
    on public.billing_subscriptions
    for select
    using (auth.uid() = user_id);
end $$;

-- Belt and braces: take back the DML privileges Supabase grants by default, so
-- the refusal survives a future policy edit. Guarded because these roles are
-- Supabase's and this chain must also apply to a stock PostgreSQL cluster (the
-- migration rehearsal runs against one).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.billing_subscriptions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.billing_subscriptions from authenticated';
    -- Reading your own billing state is the one thing a signed-in person may
    -- do, and the policy above already limits it to their own row.
    execute 'grant select on public.billing_subscriptions to authenticated';
  end if;
  -- Stated rather than inherited. Supabase's default privileges would grant
  -- this anyway, but the webhook's ability to write must not depend on a
  -- project setting that is invisible from here.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on public.billing_subscriptions to service_role';
  end if;
end $$;

comment on table public.billing_subscriptions is
  'Canonical subscription projection. Readable by its owner; writable ONLY by the service role through apply_stripe_subscription / attach_stripe_customer.';
comment on column public.billing_subscriptions.status is
  'Verbatim Stripe subscription status. Entitlement meaning lives in lib/billing/entitlement.ts, never here.';
comment on column public.billing_subscriptions.last_event_at is
  'Stripe event.created of the newest event applied. Guards against out-of-order webhook delivery.';

-- ------------------------------------------------------------ write door ----
--
-- Both functions are SECURITY INVOKER. They do not need to elevate: the service
-- role already bypasses RLS, and making them DEFINER would create a privileged
-- path that exists whether or not the EXECUTE grant is right. The grant is the
-- control, and it is narrow.

/**
 * Bind a Stripe Customer to a user, idempotently, and return the id that won.
 *
 * Called before a Checkout Session is created. The return value matters: if two
 * checkout requests race, both may have created a Stripe Customer, but only one
 * row can exist — so the caller uses the id this returns rather than the one it
 * just made. The loser's Customer is left unused in Stripe, which is harmless
 * (it carries no subscription and no payment method) and is the right way round
 * compared with binding a user to a customer that another request is also using.
 *
 * Never overwrites an existing binding. A user's Stripe customer changes only
 * by a deliberate, out-of-band decision, never as a side effect of clicking
 * Subscribe twice.
 */
create or replace function public.attach_stripe_customer(
  p_user_id     uuid,
  p_customer_id text
) returns text
language plpgsql
as $$
declare
  v_existing text;
begin
  if p_user_id is null or p_customer_id is null or length(btrim(p_customer_id)) = 0 then
    raise exception 'attach_stripe_customer requires a user and a customer id';
  end if;

  insert into public.billing_subscriptions (user_id, stripe_customer_id, status)
  values (p_user_id, btrim(p_customer_id), 'incomplete')
  on conflict (user_id) do nothing;

  select stripe_customer_id into v_existing
  from public.billing_subscriptions
  where user_id = p_user_id;

  return v_existing;
end;
$$;

/**
 * Apply a projected Stripe subscription to the canonical row.
 *
 * ## Why this is a function and not an upsert from the application
 *
 * The out-of-order guard has to be part of the same statement as the write. A
 * read-then-write in the webhook handler would let two concurrent deliveries
 * both read the old `last_event_at`, both decide they are newer, and apply in
 * whichever order Postgres happened to schedule them — which is precisely the
 * race the guard exists to prevent. `on conflict … do update … where` is a
 * single atomic statement, and PostgREST cannot express it, so it lives here.
 *
 * A stale event is a no-op, not an error: Stripe redelivers, and reporting a
 * failure would make it redeliver harder.
 *
 * Idempotency (§15) falls out of the same statement. The same event applied
 * twice writes the same values a second time; there is no row to duplicate,
 * because the user is the primary key.
 */
create or replace function public.apply_stripe_subscription(
  p_user_id              uuid,
  p_customer_id          text,
  p_subscription_id      text,
  p_price_id             text,
  p_plan                 text,
  p_status               text,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_event_at             timestamptz
) returns public.billing_subscriptions
language plpgsql
as $$
declare
  v_row public.billing_subscriptions;
begin
  if p_user_id is null or p_customer_id is null or p_status is null then
    raise exception 'apply_stripe_subscription requires a user, a customer id and a status';
  end if;

  insert into public.billing_subscriptions as b (
    user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, plan,
    status, current_period_end, cancel_at_period_end, last_event_at, updated_at
  ) values (
    p_user_id, btrim(p_customer_id), p_subscription_id, p_price_id, p_plan,
    p_status, p_current_period_end, coalesce(p_cancel_at_period_end, false),
    coalesce(p_event_at, now()), now()
  )
  on conflict (user_id) do update set
    stripe_customer_id     = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id        = excluded.stripe_price_id,
    plan                   = excluded.plan,
    status                 = excluded.status,
    current_period_end     = excluded.current_period_end,
    cancel_at_period_end   = excluded.cancel_at_period_end,
    last_event_at          = excluded.last_event_at,
    updated_at             = now()
  -- The guard. An event no newer than the one already applied changes nothing.
  where b.last_event_at <= excluded.last_event_at;

  select * into v_row from public.billing_subscriptions where user_id = p_user_id;
  return v_row;
end;
$$;

-- Only the service role may call either function.
--
-- Revoking from PUBLIC is NOT sufficient, and the migration rehearsal caught
-- that: Supabase ships a default privilege
--
--   alter default privileges in schema public grant execute on functions
--     to anon, authenticated, service_role;
--
-- so every new function in `public` is granted to those three roles EXPLICITLY
-- at creation. A `revoke … from public` removes the implicit grant and leaves
-- all three explicit ones in place, which would have left the billing write
-- door open to any signed-in caller.
--
-- (It would not have been directly exploitable — both functions are SECURITY
-- INVOKER, so RLS still applies to the statements inside them and an
-- `authenticated` caller's insert would be refused. But the whole point of
-- putting the write behind a grant is that the grant is the control, and a
-- control that quietly does nothing is worse than no control, because it is
-- believed.)
--
-- Guarded, because these are Supabase's roles and this chain must also apply to
-- a stock PostgreSQL cluster.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.attach_stripe_customer(uuid, text)',
    'public.apply_stripe_subscription(uuid, text, text, text, text, text, timestamptz, boolean, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
