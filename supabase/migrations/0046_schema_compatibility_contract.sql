-- LIFEOS-077 — the deployed database describes itself.
--
-- ## What this exists to stop
--
-- F-3, in three parts, all measured against the shipped product:
--
--   F-3a  the compatibility gate's only production caller passed it
--         `remoteMigrationVersion = EXPECTED_MIGRATION_VERSION` — the client's
--         own constant — so it compared a number with itself and could only
--         ever answer "compatible".
--   F-3b  the gate's answer was consumed by nothing. With `syncIsSafe()` false,
--         the write still landed AND the app reported "Synced".
--   F-3c  no code path anywhere read a deployed schema version. Even correct
--         wiring would have had nothing to read.
--
-- F-3c is the part that needs SQL: there was no channel. This is the channel.
--
-- The 0045 incident is the concrete case. The 0045 client reached production
-- while the database was still at 0044; the app could not tell, tried the
-- guarded writes anyway, and discovered the mismatch as a missing-function
-- error. It failed closed — but only because every write path was already
-- defensive, not because anything checked.
--
-- ## Why a CAPABILITY contract and not a migration number
--
-- A migration number moves for reasons a client does not care about: an index,
-- a policy rewording, a comment. If clients gated on it, every such migration
-- would look like an incompatibility.
--
-- So the database advertises what it can DO. `contract` is a coarse generation
-- marker; `capabilities` is the precise part, and it is what write gating
-- actually consults. A client asks "is `guarded_notes` at least 2?", not "is
-- the database at migration 46?".
--
-- It also keeps the internal ledger private: `schema_migrations` is never
-- exposed, and no caller learns which migrations exist.
--
-- ## Why the values are baked in here
--
-- The function returns literals written into THIS migration. It cannot claim a
-- capability that was not applied, because the claim and the capability arrive
-- in the same transaction. That is what makes it deployed truth rather than a
-- second copy of a client constant — the mistake F-3a was.

-- ------------------------------------------------------- the contract ------
-- SECURITY INVOKER: it reads no user data and needs no authority. Nothing here
-- touches a row, so RLS has nothing to govern and there is no reason to elevate.
--
-- search_path is pinned (S-45A). The body references only pg_catalog builtins,
-- so `pg_catalog, public` is the narrowest value that still resolves.
create or replace function public.app_schema_contract()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    -- Coarse generation. Bumped only when client-visible capability moves.
    'contract', 2,

    -- The oldest client generation this database still accepts writes from AT
    -- ALL. Deliberately 1, not 2: a pre-0045 client remains perfectly able to
    -- write the 44 unguarded domains, and declaring it globally unusable would
    -- manufacture an outage the data does not justify. The guarded domains are
    -- held back by CAPABILITY below, which is the narrower instrument.
    'min_client_contract', 1,

    -- The precise part. A domain names the capability it needs and the level it
    -- needs; anything absent from this object is unknown to the database and a
    -- client must treat it as unavailable rather than assume.
    'capabilities', jsonb_build_object(
      -- 2 = the 0045 stale-write guard is present and enforcing on this table:
      -- `sync_version`, the BEFORE UPDATE trigger, and `push_guarded_rows`.
      'guarded_notes', 2,
      'guarded_next_actions', 2
    )
  );
$$;

comment on function public.app_schema_contract() is
  'LIFEOS-077: what this deployed database can do, for client write gating. '
  'Capability-oriented on purpose — never the migration ledger.';

-- ------------------------------------------------- S-45A: search_path ------
-- The 0045 functions were created without a pinned search_path and Supabase's
-- advisor flagged all three. The escalation this normally guards needs
-- SECURITY DEFINER and none of these is one, which is why it was classified P3
-- rather than higher — but a WARN left standing is a WARN nobody reads next time.
--
-- `pg_catalog, public` is safe for all three: every table reference inside
-- push_guarded_rows is already written as `public.%I`, and
-- guarded_assignments reaches information_schema by its own schema name, so
-- neither depends on a permissive path to resolve.
alter function public.enforce_sync_version()                set search_path = pg_catalog, public;
alter function public.push_guarded_rows(text, jsonb)        set search_path = pg_catalog, public;
alter function public.guarded_assignments(text)             set search_path = pg_catalog, public;

-- --------------------------------------------- S-45B: least privilege ------
-- 0045 said `revoke all ... from public` and `grant execute ... to
-- authenticated`, and live inspection after deployment found anon holding
-- EXECUTE anyway.
--
-- The reason is a Postgres detail worth writing down, because it will catch the
-- next person too: Supabase configures ALTER DEFAULT PRIVILEGES so that new
-- functions in `public` are granted EXECUTE to anon, authenticated and
-- service_role AT CREATION. Those are grants held by each ROLE. `REVOKE ALL ...
-- FROM public` revokes the PUBLIC pseudo-role's grant and does not touch them.
--
-- So the revoke has to name anon explicitly. It is written for all four
-- functions, including the new one, so this migration cannot reintroduce the
-- problem it is fixing.
revoke execute on function public.push_guarded_rows(text, jsonb) from anon;
revoke execute on function public.guarded_assignments(text)      from anon;
revoke execute on function public.app_schema_contract()          from anon;
revoke execute on function public.app_schema_contract()          from public;

-- Intended grants, decided rather than inherited:
--
--   authenticated  EXECUTE — the signed-in app. This is the real caller.
--   anon           NONE    — an unauthenticated caller has no auth.uid(), so it
--                            could never satisfy RLS on a guarded write; the
--                            contract is equally not its business.
--   service_role   RETAINED — the trusted server-side key. It already bypasses
--                            RLS by design, so withholding EXECUTE would buy no
--                            safety while breaking any future server-side
--                            maintenance path. Deliberate, not inherited.
--   postgres       owner/admin, untouched.
grant execute on function public.app_schema_contract() to authenticated;
