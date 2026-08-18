-- LIFEOS-056D — Constitution deletion privacy repair.
--
-- ## The defect this closes
--
-- A conceptual revision spans TWO elements. When predecessor A is revised into
-- successor B, the transition row is owned by A (`element_id = A`) but its
-- `new_statement` holds B's wording. Deleting B cascaded only rows whose
-- `element_id = B`, so B's supposedly-deleted statement survived inside A's
-- history — visible in the UI, persisted locally, carried into export, and
-- synced here. That broke the product's stated guarantee that deletion removes
-- data.
--
-- ## The fix: make the relationship explicit
--
-- Record WHICH successor a revision produced, and cascade on it. Text matching,
-- timestamp heuristics, or bulk-deleting predecessor history were all rejected:
-- a deletion guarantee must not depend on guessing which row happens to contain
-- the deleted words, and a user who deletes B has not asked to lose A's
-- unrelated history.
--
-- The transition therefore has TWO deletion paths, both intended:
--
--   DELETE PREDECESSOR  → `element_id`   cascade removes A's own history
--   DELETE SUCCESSOR    → `successor_id` cascade removes the transition that
--                          carries B's wording
--
-- ## Notes
--
--  * Additive and idempotent; 0001–0038 are untouched. No table is created, so
--    the public table count is unchanged at 60 — this adds one nullable column
--    and one index.
--  * NULL for every non-supersession event, and for every row written before
--    this migration. Historical rows are NOT back-filled: inferring which
--    successor an old transition produced would mean exactly the text/timestamp
--    guessing this design rejects. A NULL row simply behaves as it did before.
--  * RLS is unchanged — the existing four policies on constitution_revisions
--    already scope every operation to auth.uid(), and a new column inherits them.

alter table public.constitution_revisions
  add column if not exists successor_id uuid;

-- The cascade is the whole point of the migration. Added separately from the
-- column so the statement is rerunnable on a database that already has one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'constitution_revisions_successor_id_fkey'
      and conrelid = 'public.constitution_revisions'::regclass
  ) then
    alter table public.constitution_revisions
      add constraint constitution_revisions_successor_id_fkey
      foreign key (successor_id)
      references public.constitution_elements(id)
      on delete cascade;
  end if;
end $$;

create index if not exists constitution_revisions_successor_idx
  on public.constitution_revisions (user_id, successor_id);
