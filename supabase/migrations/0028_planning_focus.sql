-- LIFEOS-037 — Planning views & focus modes.
--
-- Persists the user's PLANNING CHOICES (which horizon a record sits in + its
-- manual order) and FOCUS sessions (one primary target, optional linked working
-- session, manually-logged interruptions). Additive and idempotent: migrations
-- 0001–0027 are untouched; every statement is rerunnable.
--
-- Design notes:
--  * Two tables. `planning_assignments` uses a GENERIC typed record reference
--    (ref_kind + ref_id) — matching the entity architecture — so any plannable
--    record (action / milestone / project / document / open loop) can carry a
--    horizon without a per-type table. A UNIQUE (user_id, ref_kind, ref_id)
--    guarantees ONE assignment per record (a move updates it; sync never
--    duplicates it). `focus_sessions` embeds interruptions + history as jsonb
--    (bounded, always read with the session), matching 0022/0025/0027.
--  * SOFT references only: ref_kind/ref_id, session_id, and a focus target are
--    plain values WITHOUT foreign keys, so deleting a project/action/document
--    never cascades away a planning assignment or focus session, and an orphaned
--    reference degrades gracefully (projections are orphan-safe).
--  * A move changes only the horizon + order — never status, deadline, priority,
--    or hierarchy (enforced by the app; nothing here mutates another table).
--  * Capacity soft limits + board/focus UI preferences live in user_prefs
--    (LIFEOS-027), not here — they are preferences, not records.
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'planningAssignments' / 'focusSessions').
--  * No AI, no scheduling, no scores/streaks/analytics columns.

-- ========================== planning_assignments ==========================
create table if not exists public.planning_assignments (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  ref_kind    text not null,                         -- generic typed record reference
  ref_id      text not null,
  horizon     text not null default 'unscheduled',   -- today|this_week|later|someday|unscheduled
  "order"     double precision not null default 0,   -- manual ordering within the horizon
  history     jsonb not null default '[]'::jsonb,    -- compact PlanningHistoryEvent[]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One planning assignment per record per user (a move updates in place).
  constraint planning_assignments_ref_uniq unique (user_id, ref_kind, ref_id)
);
create index if not exists planning_assignments_user_idx      on public.planning_assignments (user_id);
create index if not exists planning_assignments_horizon_idx    on public.planning_assignments (user_id, horizon);
create index if not exists planning_assignments_ref_idx        on public.planning_assignments (user_id, ref_kind, ref_id);
create index if not exists planning_assignments_updated_idx    on public.planning_assignments (user_id, updated_at desc);

-- ============================= focus_sessions =============================
create table if not exists public.focus_sessions (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_kind   text not null,                        -- action|milestone|project|document|workspace|entity|custom
  ref_kind      text not null,                        -- the target's record reference (custom → generated)
  ref_id        text not null,
  title         text not null default '',
  session_id    uuid,                                 -- optional attached working session (soft ref)
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,                          -- null while active (one active at a time)
  panels        jsonb not null default '{}'::jsonb,   -- panel visibility
  interruptions jsonb not null default '[]'::jsonb,   -- FocusInterruption[]
  history       jsonb not null default '[]'::jsonb,   -- compact PlanningHistoryEvent[]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists focus_sessions_user_idx      on public.focus_sessions (user_id);
create index if not exists focus_sessions_started_idx    on public.focus_sessions (user_id, started_at desc);
create index if not exists focus_sessions_ref_idx        on public.focus_sessions (user_id, ref_kind, ref_id);
create index if not exists focus_sessions_active_idx      on public.focus_sessions (user_id, ended_at);

-- ================================== RLS ==================================
alter table public.planning_assignments enable row level security;
alter table public.focus_sessions       enable row level security;

do $$
begin
  drop policy if exists planning_assignments_select on public.planning_assignments;
  drop policy if exists planning_assignments_insert on public.planning_assignments;
  drop policy if exists planning_assignments_update on public.planning_assignments;
  drop policy if exists planning_assignments_delete on public.planning_assignments;
  create policy planning_assignments_select on public.planning_assignments for select using (auth.uid() = user_id);
  create policy planning_assignments_insert on public.planning_assignments for insert with check (auth.uid() = user_id);
  create policy planning_assignments_update on public.planning_assignments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy planning_assignments_delete on public.planning_assignments for delete using (auth.uid() = user_id);

  drop policy if exists focus_sessions_select on public.focus_sessions;
  drop policy if exists focus_sessions_insert on public.focus_sessions;
  drop policy if exists focus_sessions_update on public.focus_sessions;
  drop policy if exists focus_sessions_delete on public.focus_sessions;
  create policy focus_sessions_select on public.focus_sessions for select using (auth.uid() = user_id);
  create policy focus_sessions_insert on public.focus_sessions for insert with check (auth.uid() = user_id);
  create policy focus_sessions_update on public.focus_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy focus_sessions_delete on public.focus_sessions for delete using (auth.uid() = user_id);
end $$;
