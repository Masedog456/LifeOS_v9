-- LIFEOS-053 — Minimal time model: an action due date.
--
-- Goals, Projects and Milestones already carried `target_date`. The LEAF of the
-- hierarchy — the thing a person actually does — was the only level with no way
-- to answer "by when?", so "call the dentist by Friday" was unrepresentable and
-- the job went to whatever reminders app the user already had.
--
-- Additive, nullable, idempotent: migrations 0001–0035 are untouched, no data is
-- rewritten, and every existing action stays valid with a NULL due date. There
-- are no fabricated defaults — an action without a deadline genuinely has none.
--
-- Design notes:
--  * `date`, not `timestamptz`. Every use case is a DAY ("by Friday", "before
--    the 15th", "expires next month"). A timestamp would need a stored timezone
--    to mean anything and would drift across travel and DST, turning a deadline
--    into a bug. Real appointments belong to a future Event layer fed by a
--    calendar connector — a due date must never be used as a fake event.
--  * Distinct from the columns beside it, none of which is a substitute:
--      deferred_until  — "not before" (a START date)
--      follow_up_date  — "check back on" (waiting only)
--      due_date        — "must be done by"
--  * No trigger, no scheduled job, no notification. Nothing in the database
--    reacts to this date arriving; surfacing is a read-time projection.
--  * RLS unchanged — the existing per-user policies on `next_actions` already
--    cover every column.

alter table public.next_actions add column if not exists due_date date;

-- Partial index: only rows that actually carry a deadline. Today and Upcoming
-- both query "live actions with a due date", which is a small slice of the table.
create index if not exists next_actions_due_idx
  on public.next_actions (user_id, due_date)
  where due_date is not null;
