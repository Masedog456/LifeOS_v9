-- LIFEOS-061 — Time foundation.
--
-- Conqify learns WHEN. Three things, and deliberately no more:
--   1. `events`                 — something that HAPPENS at a time
--   2. `next_actions.due_time`  — when something must be FINISHED BY
--   3. `recurrence_completions` — durable evidence that one occurrence was done
--
-- Additive and idempotent: migrations 0001–0039 are unchanged and every
-- statement is rerunnable. No existing row is rewritten; actions without a
-- due_time or recurrence load exactly as before.
--
-- ============================================================================
-- Design notes
-- ============================================================================
--
-- EVENT IS NOT A TASK. There is no status column, no completed_at, no checkbox.
-- An Action has completion semantics — you finish it, and finishing is the
-- outcome. An Event has none: it happens, and then it has happened. Giving
-- events a status would invite a checkbox nobody can honestly tick.
--
-- LOCAL TIME, NOT INSTANTS. `start_time`, `end_time` and `due_time` are text
-- 'HH:mm' — wall-clock readings, never timestamps. They are NOT timestamptz and
-- must not become timestamptz: an appointment at 2:30 is at 2:30 wherever the
-- person is, and storing an instant would move it when they travelled. `date`
-- and `occurrence_date` are `date` (no time, no zone) for the same reason.
--
-- Text is checked by regex rather than trusted, so a bad client cannot write
-- '25:99' and have Today render nonsense.
--
-- OCCURRENCES ARE DERIVED, NOT STORED. There is no `occurrences` table and there
-- will not be one. The next occurrence is a pure function of
-- (rule, anchor, completions), so two devices compute the SAME value and no
-- materialization race exists to reconcile. A weekly action creates 0 future
-- rows, not 52.
--
-- What IS stored is what actually happened. `recurrence_completions` is the only
-- durable artefact of a recurring action's history, and
-- `unique (action_id, occurrence_date)` is what makes a double completion — from
-- a double click, a replay, or a sync echo — impossible rather than merely
-- unlikely.
--
-- RECURRENCE IS JSONB, SO TYPESCRIPT VALIDATES IT. A CHECK constraint cannot
-- express "weekly rules need a weekdays array of 0–6". `lib/time/recurrence.ts`
-- validates on read, ignores anything malformed for computation, and NEVER
-- repairs it — a silently repaired rule would replace what the user stored with
-- what we guessed. The column is nullable and unconstrained beyond being an
-- object, which is honest about where the real check lives.
--
-- DELETION. `recurrence_completions.action_id` cascades. That is a deliberate
-- privacy position: history derived solely from a record the user deleted must
-- go with it, or deletion leaves behind personal history they cannot remove.
-- Autobiographical memory never outranks a deletion. STOPPING recurrence is the
-- other door and preserves everything — see `stopActionRecurrence`.
--
-- `events.source_capture_id` uses `on delete set null`, matching every other
-- capture-derived record: an event outlives the capture it came from.
--
-- RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer.

-- ---------------------------------------------------------------- events ----

create table if not exists public.events (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null default '',
  date               date not null,               -- local day; for a recurring event, the ANCHOR
  start_time         text,                        -- 'HH:mm' wall clock, or null
  end_time           text,                        -- 'HH:mm' wall clock, or null
  all_day            boolean not null default false,
  notes              text not null default '',
  recurrence         jsonb,                       -- RecurrenceRule; validated in TypeScript
  linked_entity_refs jsonb not null default '[]'::jsonb,
  source_capture_id  uuid references public.captures(id) on delete set null,
  from_ai_text       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A wall clock reads 00:00 to 23:59. '24:00' is rejected rather than
  -- normalised: it and '00:00' name different days.
  constraint events_start_time_format check (start_time is null or start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint events_end_time_format   check (end_time   is null or end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- An end with no start describes nothing.
  constraint events_end_needs_start   check (end_time is null or start_time is not null),
  -- Same-day only. An event running 23:00 -> 01:00 crosses midnight, which this
  -- sprint does not model; it is refused rather than silently reordered into a
  -- 22-hour appointment nobody asked for.
  constraint events_end_after_start   check (end_time is null or end_time >= start_time),
  -- All-day and a start time are contradictory claims.
  constraint events_allday_untimed    check (not (all_day and start_time is not null)),
  constraint events_recurrence_object check (recurrence is null or jsonb_typeof(recurrence) = 'object')
);

create index if not exists events_user_idx    on public.events (user_id);
create index if not exists events_date_idx    on public.events (user_id, date);
create index if not exists events_updated_idx on public.events (user_id, updated_at desc);

alter table public.events enable row level security;

do $$
begin
  drop policy if exists events_select on public.events;
  drop policy if exists events_insert on public.events;
  drop policy if exists events_update on public.events;
  drop policy if exists events_delete on public.events;
  create policy events_select on public.events for select using (auth.uid() = user_id);
  create policy events_insert on public.events for insert with check (auth.uid() = user_id);
  create policy events_update on public.events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy events_delete on public.events for delete using (auth.uid() = user_id);
end $$;

-- ------------------------------------------------ next_actions: due time ----
--
-- Two additive nullable columns. Every existing action is untouched and remains
-- valid: no due_time and no recurrence is the overwhelmingly common shape.

alter table public.next_actions add column if not exists due_time   text;
alter table public.next_actions add column if not exists recurrence jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'next_actions_due_time_format') then
    alter table public.next_actions add constraint next_actions_due_time_format
      check (due_time is null or due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  -- A time with no day names no moment.
  if not exists (select 1 from pg_constraint where conname = 'next_actions_due_time_needs_date') then
    alter table public.next_actions add constraint next_actions_due_time_needs_date
      check (due_time is null or due_date is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'next_actions_recurrence_object') then
    alter table public.next_actions add constraint next_actions_recurrence_object
      check (recurrence is null or jsonb_typeof(recurrence) = 'object');
  end if;
end $$;

-- ------------------------------------------- recurrence completion history ---

create table if not exists public.recurrence_completions (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Cascades on purpose. See the deletion note above.
  action_id       uuid not null references public.next_actions(id) on delete cascade,
  occurrence_date date not null,
  completed_at    timestamptz not null default now(),
  -- The canonical occurrence identity, and the anti-duplicate guarantee.
  constraint recurrence_completions_identity unique (action_id, occurrence_date)
);

create index if not exists recurrence_completions_user_idx   on public.recurrence_completions (user_id);
create index if not exists recurrence_completions_action_idx on public.recurrence_completions (action_id, occurrence_date desc);

alter table public.recurrence_completions enable row level security;

do $$
begin
  drop policy if exists recurrence_completions_select on public.recurrence_completions;
  drop policy if exists recurrence_completions_insert on public.recurrence_completions;
  drop policy if exists recurrence_completions_update on public.recurrence_completions;
  drop policy if exists recurrence_completions_delete on public.recurrence_completions;
  create policy recurrence_completions_select on public.recurrence_completions for select using (auth.uid() = user_id);
  create policy recurrence_completions_insert on public.recurrence_completions for insert with check (auth.uid() = user_id);
  create policy recurrence_completions_update on public.recurrence_completions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy recurrence_completions_delete on public.recurrence_completions for delete using (auth.uid() = user_id);
end $$;
