-- LIFEOS-054 — Protocols (conditional intentions).
--
-- WHEN / IF [trigger] → [response].
--
-- Recorded as beta-evidence candidate A since LIFEOS-050A and confirmed by the
-- Life Organization Gap Audit: material of the form "when my child is in a
-- fight-or-flight reaction, give him physical space" is not a belief, not a task,
-- and is poorly served by Practice — every member of `PracticeCadence`
-- (once | daily | weekly | occasional) answers HOW OFTEN, and a protocol has no
-- frequency at all. Filing one as `occasional` would record something the user
-- never said, so `practice_candidates` is left untouched and this is its own
-- table.
--
-- Additive and idempotent: migrations 0001–0036 are unchanged; every statement
-- is rerunnable. No existing practice is migrated — historical intent is not
-- inferred (LIFEOS-054 §21).
--
-- Design notes:
--  * NO schedule, NO cadence, NO next-occurrence, NO trigger engine. Nothing in
--    the database watches for a trigger or fires on one; a protocol is
--    remembered, not automated.
--  * NO streak, compliance rate, or success score. A protocol is an intention,
--    not a behaviour to be graded.
--  * `from_ai_text` records that the text originated as machine prose the user
--    kept. Confirming a machine-suggested STRUCTURE never sets this to false:
--    classification is not authorship (LIFEOS-050A/050B).
--  * `source_capture_id` uses `on delete set null` so a protocol outlives the
--    capture it came from, matching every other capture-derived record.
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'protocols').

create table if not exists public.protocols (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_text      text not null default '',   -- the condition, without its leading connective
  response_text     text not null default '',   -- the intended response
  reason            text,                        -- optional; never generated
  status            text not null default 'active',  -- active | paused | retired
  source_capture_id uuid references public.captures(id) on delete set null,
  from_ai_text      boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists protocols_user_idx    on public.protocols (user_id);
create index if not exists protocols_updated_idx on public.protocols (user_id, updated_at desc);
create index if not exists protocols_status_idx  on public.protocols (user_id, status);

alter table public.protocols enable row level security;

do $$
begin
  drop policy if exists protocols_select on public.protocols;
  drop policy if exists protocols_insert on public.protocols;
  drop policy if exists protocols_update on public.protocols;
  drop policy if exists protocols_delete on public.protocols;
  create policy protocols_select on public.protocols for select using (auth.uid() = user_id);
  create policy protocols_insert on public.protocols for insert with check (auth.uid() = user_id);
  create policy protocols_update on public.protocols for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy protocols_delete on public.protocols for delete using (auth.uid() = user_id);
end $$;
