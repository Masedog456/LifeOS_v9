-- LIFEOS-068 — integration account linking.
--
-- Three objects, deliberately in two different schemas:
--
--   public.integration_accounts      metadata. RLS-isolated, safe to read.
--   public.integration_oauth_states  short-lived pending authorizations.
--   private.integration_credentials  SECRETS. No PostgREST path exists at all.
--
-- ## Authentication is untouched
--
-- Nothing here writes to `auth.*`. Linking a Google account does not create a
-- Conqify user, does not issue a session, and does not add an identity that
-- could later be used to sign in. Conqify authentication remains email OTP, and
-- an integration is something an ALREADY-authenticated user grants.
--
-- ## Why `private` and not RLS
--
-- Supabase exposes the `public` schema through PostgREST. A table in a schema
-- that is not exposed has no REST path — the browser cannot select it, cannot
-- guess a row id into it, and cannot reach it through a join. That is a
-- stronger guarantee than a restrictive policy on a reachable table, because it
-- does not depend on the policy being right.
--
-- Consequently the application's own routes cannot read it either: every server
-- route in this codebase carries only the USER's JWT. Reaching this table needs
-- a privileged connection that this deployment deliberately does not have, so
-- the credential vault reports itself unavailable and no integration can become
-- `connected`. That is the intended state, not an oversight: the table exists so
-- the schema is reviewed and rehearsed now, and the privileged path is enabled
-- later in its own reviewed change.
--
-- ## No plaintext token column exists
--
-- Not "is not used" — does not exist. `integration_credentials` holds a
-- ciphertext blob, an IV, an auth tag and a key version. There is nowhere in
-- this schema a raw token could be written even by mistake.

-- ------------------------------------------------------- public metadata ----

create table if not exists public.integration_accounts (
  id                  uuid primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider            text not null,
  -- Unknown until the provider tells us, so nullable while `pending` (§9).
  -- NEVER an email: addresses change, and the same account would become two.
  provider_account_id text,
  -- Human label for the settings row. Metadata only — never a Person record.
  display_label       text,
  -- What was GRANTED, which may be less than what was requested.
  scopes              text[] not null default '{}',
  status              text not null default 'pending',
  connected_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint integration_accounts_status_valid
    check (status in ('pending', 'connected', 'revoked', 'error')),
  -- A connection that cannot say WHICH account it is cannot be reconciled,
  -- cannot be deduplicated on reconnect, and cannot be revoked precisely.
  constraint integration_accounts_connected_identified
    check (status <> 'connected' or provider_account_id is not null),
  constraint integration_accounts_connected_dated
    check (status <> 'connected' or connected_at is not null)
);

-- One canonical link per provider account (§18). Partial, so any number of
-- `pending` rows (which have no provider_account_id yet) can coexist without
-- colliding — and Postgres treating NULLs as distinct is harmless here BECAUSE
-- the index is partial rather than relying on that behaviour.
create unique index if not exists integration_accounts_identity_idx
  on public.integration_accounts (user_id, provider, provider_account_id)
  where provider_account_id is not null;

create index if not exists integration_accounts_user_idx
  on public.integration_accounts (user_id, provider);

alter table public.integration_accounts enable row level security;

do $$
begin
  drop policy if exists integration_accounts_select on public.integration_accounts;
  drop policy if exists integration_accounts_insert on public.integration_accounts;
  drop policy if exists integration_accounts_update on public.integration_accounts;
  drop policy if exists integration_accounts_delete on public.integration_accounts;
  create policy integration_accounts_select on public.integration_accounts for select using (auth.uid() = user_id);
  create policy integration_accounts_insert on public.integration_accounts for insert with check (auth.uid() = user_id);
  create policy integration_accounts_update on public.integration_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy integration_accounts_delete on public.integration_accounts for delete using (auth.uid() = user_id);
end $$;

-- ---------------------------------------------------------- oauth states ----
--
-- The raw state value is NEVER stored. It travels through a browser URL — into
-- history, into referrers, into any proxy log on the way — so what is kept is
-- sha256(state). A leaked row cannot complete a link.

create table if not exists public.integration_oauth_states (
  state_hash          text primary key,
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider            text not null,
  -- Sealed PKCE verifier: ciphertext + IV + tag + key version. Same envelope
  -- the credential vault uses, so a leaked state row yields nothing usable.
  verifier_ciphertext text not null,
  verifier_iv         text not null,
  verifier_tag        text not null,
  verifier_key_version integer not null,
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  created_at          timestamptz not null default now(),

  -- A state hash is a hex sha256. Anything else is not one of ours.
  constraint integration_oauth_states_hash_format check (state_hash ~ '^[0-9a-f]{64}$'),
  -- A state that never expires is a permanent standing invitation.
  constraint integration_oauth_states_expires_future check (expires_at > created_at)
);

-- §25. Expired pending states are swept by this index, not by a full scan.
create index if not exists integration_oauth_states_expiry_idx
  on public.integration_oauth_states (expires_at)
  where consumed_at is null;

create index if not exists integration_oauth_states_user_idx
  on public.integration_oauth_states (user_id);

alter table public.integration_oauth_states enable row level security;

do $$
begin
  drop policy if exists integration_oauth_states_select on public.integration_oauth_states;
  drop policy if exists integration_oauth_states_insert on public.integration_oauth_states;
  drop policy if exists integration_oauth_states_update on public.integration_oauth_states;
  drop policy if exists integration_oauth_states_delete on public.integration_oauth_states;
  create policy integration_oauth_states_select on public.integration_oauth_states for select using (auth.uid() = user_id);
  create policy integration_oauth_states_insert on public.integration_oauth_states for insert with check (auth.uid() = user_id);
  create policy integration_oauth_states_update on public.integration_oauth_states for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy integration_oauth_states_delete on public.integration_oauth_states for delete using (auth.uid() = user_id);
end $$;

-- ------------------------------------------------ private credential store ---

create schema if not exists private;

-- Belt and braces: revoke the API roles' access to the schema explicitly, so
-- this does not depend solely on PostgREST's exposed-schema configuration.
--
-- Guarded, because `anon` and `authenticated` are Supabase's roles and this
-- chain must also apply to a stock PostgreSQL cluster (the migration rehearsal
-- runs against one). A REVOKE that errors on a missing role would abort the
-- whole migration on any database that is not Supabase.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
  end if;
end $$;

create table if not exists private.integration_credentials (
  integration_account_id  uuid primary key
    references public.integration_accounts(id) on delete cascade,
  -- AES-256-GCM envelope. There is no plaintext column, by design.
  access_ciphertext       text not null,
  access_iv               text not null,
  access_tag              text not null,
  refresh_ciphertext      text,
  refresh_iv              text,
  refresh_tag             text,
  key_version             integer not null,
  access_expires_at       timestamptz,
  granted_scopes          text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- A refresh token is all-or-nothing: three columns present, or three absent.
  -- Half an envelope cannot be decrypted and would fail the auth tag anyway;
  -- refusing it here means the failure happens at write time, where it is
  -- debuggable, instead of at refresh time, where it looks like a revocation.
  constraint integration_credentials_refresh_complete check (
    (refresh_ciphertext is null and refresh_iv is null and refresh_tag is null)
    or
    (refresh_ciphertext is not null and refresh_iv is not null and refresh_tag is not null)
  )
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on private.integration_credentials from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on private.integration_credentials from authenticated';
  end if;
end $$;

-- RLS is enabled as well. The schema grant already makes this table
-- unreachable; enabling RLS means that even if the schema were ever exposed by
-- a configuration change, no policy exists to permit a row through.
alter table private.integration_credentials enable row level security;
