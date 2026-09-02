-- LIFEOS-078 — Goals gain direction, a lifecycle record, and a successor.
--
-- ## What this exists to make possible
--
-- Goals could say WHAT the user is trying to accomplish and never WHEN in a
-- life it sits. "Learn to swim properly" and "be someone my kids trust" were
-- the same kind of object, ordered only by `priority` and an optional
-- `target_date`. The product could show what is due; it could not show where a
-- life is going.
--
-- Three columns, and no new nouns:
--
--   horizon            semantic distance — now / near / medium / long / life.
--                      NOT a date calculator. A goal with a target date next
--                      month may still be a `life` goal, and a `life` goal has
--                      no deadline at all. The user says which; nothing infers.
--   successor_goal_id  what this goal BECAME when it was replaced, so a life's
--                      direction reads as a chain rather than a graveyard of
--                      abandoned rows.
--   history            append-only lifecycle record: what changed, when, and
--                      the user's own note. It is how the product can answer
--                      "how long has this been sitting at `someday`?" without
--                      guessing from timestamps.
--
-- ## No new tables, deliberately
--
-- Horizon is one field of a Goal, not five kinds of Goal. Separate
-- `short_term_goals` / `long_term_goals` / `life_goals` tables would multiply
-- the schema, split every query, and make "this near-term goal is really the
-- medium-term one I keep deferring" a migration instead of an edit.
--
-- The lifecycle record follows the shipped convention rather than inventing a
-- format: `history jsonb not null default '[]'::jsonb`, exactly as 0027
-- (`next_actions.history`), 0028, 0029, 0026 and the 0006/0008/0009 family. An
-- embedded append-only array is right here for the same reason it was there —
-- it is 1:many with its row, always read and written with it, bounded, and has
-- no independent query needs.
--
-- ## Additive, and old clients keep working
--
-- All three columns are nullable or defaulted. A pre-078 client that upserts a
-- Goal without mentioning any of them writes a valid row: `horizon` and
-- `successor_goal_id` are NULL, and `history` takes its default. Nothing in
-- this migration makes the old row shape invalid, which is what lets the
-- database be deployed BEFORE the client that uses it.
--
-- No table is created, so the public table count is unchanged at 64.
--
-- ## Existing goals are NOT back-filled
--
-- Guessing a horizon from a target date or from title wording would put words
-- in the user's mouth about their own life, and would do it silently across
-- every row they have. A NULL horizon means "not said yet" and reads exactly as
-- the product behaved before this migration. Same reasoning as 0039, which
-- refused to infer which successor an old revision produced.

-- ------------------------------------------------------ 1. the columns -----
alter table public.goals
  add column if not exists horizon           text;

alter table public.goals
  add column if not exists successor_goal_id uuid;

alter table public.goals
  add column if not exists history           jsonb not null default '[]'::jsonb;  -- append-only GoalHistoryEvent[]

comment on column public.goals.horizon is
  'LIFEOS-078: semantic distance (now/near/medium/long/life). User-stated, never inferred. NULL = not said.';
comment on column public.goals.successor_goal_id is
  'LIFEOS-078: the goal this one BECAME when replaced. NULL for every goal that was not superseded.';
comment on column public.goals.history is
  'LIFEOS-078: append-only lifecycle record (compact metadata + the user''s own note). Never a copy of the goal body.';

-- --------------------------------------------------- 2. horizon values -----
-- A closed set, enforced by the database rather than by client discipline
-- alone. NULL is explicitly allowed: "not said yet" is a real state and is what
-- every existing row holds.
--
-- Dropped by name first so the whole chain stays re-runnable — the rehearsal
-- applies every migration three times (0043's pattern).
do $$
begin
  alter table public.goals drop constraint if exists goals_horizon_valid;

  if not exists (
    select 1 from pg_constraint where conname = 'goals_horizon_valid'
  ) then
    alter table public.goals add constraint goals_horizon_valid
      check (
        horizon is null
        or horizon in ('now', 'near', 'medium', 'long', 'life')
      );
  end if;
end $$;

-- ------------------------------------------------------ 3. the successor ---
-- ON DELETE SET NULL, matching how 0023 already treats goal references
-- (`projects.goal_id` orphans rather than deletes) and how 0031 reasoned about
-- deleting a goal: deleting the goal you MOVED ON TO must never delete the
-- history of where you came from. The predecessor survives with a NULL
-- successor — it simply stops claiming a replacement that no longer exists.
--
-- There is no `predecessor_goal_id`. One direction is the fact; the reverse is
-- a lookup, and storing both invites the two halves to disagree.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_successor_goal_id_fkey'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_successor_goal_id_fkey
      foreign key (successor_goal_id)
      references public.goals(id)
      on delete set null;
  end if;
end $$;

-- An unindexed referencing column makes every goal DELETE scan the whole table
-- to find rows to null out. Indexed for the same reason 0039 indexed its
-- successor column — and scoped by user_id, matching the other goals indexes.
create index if not exists goals_successor_idx
  on public.goals (user_id, successor_goal_id);

-- ------------------------------------------------- 4. the contract (§22) ---
-- The client writes the extended Goal row shape unconditionally — `goalToRow`
-- emits every column on every push. Against a database WITHOUT these columns,
-- PostgREST rejects the row and the entire `goals` domain stops syncing.
--
-- That is the 0045 incident again on a different table, so `goals` gets what
-- `notes` and `next_actions` got in 0046: a capability it can ask about. The
-- claim and the columns arrive in the SAME migration, which is what makes it
-- deployed truth rather than a second copy of a client constant (F-3a).
--
-- Unchanged from 0046 and re-stated here on purpose, because `create or
-- replace` rewrites the whole body: SECURITY INVOKER (it reads no user data and
-- needs no authority), and a pinned search_path (S-45A).
create or replace function public.app_schema_contract()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    -- Coarse generation, bumped because client-visible capability moved.
    'contract', 3,

    -- Still 1, and deliberately. 0047 is purely additive: a pre-078 client
    -- writing the old Goal row shape remains completely valid here, so
    -- declaring it unfit would manufacture an outage the data does not
    -- justify. The narrow instrument below is what actually holds anything.
    'min_client_contract', 1,

    'capabilities', jsonb_build_object(
      -- 2 = the 0045 stale-write guard is present and enforcing on this table:
      -- `sync_version`, the BEFORE UPDATE trigger, and `push_guarded_rows`.
      'guarded_notes', 2,
      'guarded_next_actions', 2,

      -- 1 = `goals` carries horizon, successor_goal_id and history, so a
      -- client may write the extended Goal row shape.
      'goal_horizons', 1
    )
  );
$$;

comment on function public.app_schema_contract() is
  'LIFEOS-077: what this deployed database can do, for client write gating. '
  'Capability-oriented on purpose — never the migration ledger.';

-- `create or replace` preserves the existing ACL, so 0046's grants survive this
-- migration untouched. They are re-stated anyway: the S-45B lesson was that a
-- function in `public` picks up EXECUTE for anon from Supabase's default
-- privileges at CREATION, and a migration that assumed inheritance was the
-- reason anon held a grant nobody granted. Explicit is cheap; a silent
-- re-grant to anon is not.
revoke execute on function public.app_schema_contract() from anon;
revoke execute on function public.app_schema_contract() from public;
grant  execute on function public.app_schema_contract() to authenticated;
