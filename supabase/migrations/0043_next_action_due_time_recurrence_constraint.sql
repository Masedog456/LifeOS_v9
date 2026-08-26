-- LIFEOS-074 — next_actions: a recurrence rule also names the day.
--
-- ## What was wrong
--
-- Migration 0040 added `due_time` under the rule "a time with no day names no
-- moment", enforced as:
--
--     due_time is null or due_date is not null
--
-- LIFEOS-063 R-2 then amended the PRODUCT rule, deliberately: a recurrence rule
-- names days too, so "take the medication every day at 8" carries a `due_time`
-- and no `due_date` — its schedule is its rule. `setActionDueTime` has accepted
-- that shape ever since. The database was never told.
--
-- The mismatch stayed invisible because a second defect hid it: the Supabase
-- adapter never mapped `due_time` or `recurrence` at all, so no row could
-- violate the check. The LIFEOS-074 audit fixed the mapper, which is what makes
-- this migration necessary — without it, the first recurring action with a time
-- would be rejected on push and wedge the whole flush.
--
-- ## What this does NOT legitimize
--
-- A time with neither a date nor a rule is still meaningless, and is still
-- refused. The check gains exactly one disjunct; nothing else is weakened.
--
-- ## Rollback is NOT free
--
-- Reverting to the strict 0040 check will fail while any row has
--
--     due_time is not null and due_date is null and recurrence is not null
--
-- which is precisely the shape this migration exists to allow. A rollback must
-- first decide what those rows mean — clearing `due_time` loses the user's
-- stated time; synthesising a `due_date` invents a day they never named. Stated
-- here because a migration that claims to be trivially reversible when it is
-- not is worse than one that is honest about the cost.

do $$
begin
  -- Drop by name, then recreate. `alter table ... drop constraint if exists` is
  -- idempotent and safe on a database that never had 0040's version, which is
  -- what lets the whole chain re-run (the rehearsal applies it three times).
  alter table public.next_actions
    drop constraint if exists next_actions_due_time_needs_date;

  if not exists (
    select 1 from pg_constraint where conname = 'next_actions_due_time_needs_date'
  ) then
    alter table public.next_actions add constraint next_actions_due_time_needs_date
      check (
        due_time is null
        or due_date is not null
        or recurrence is not null
      );
  end if;
end $$;
