-- LIFEOS-056 — The Living Constitution.
--
-- The normative layer: what the user has CONSCIOUSLY ADOPTED as part of how they
-- intend to live. Not a belief (what is true), not a practice (what is done),
-- not a goal (what is wanted), not a protocol (a conditional intention), and
-- never source authority or AI output.
--
-- Additive and idempotent: migrations 0001–0037 are untouched; every statement
-- is rerunnable. No existing record is migrated into a constitution element —
-- historical intent is NOT inferred (the same rule 0037 followed when it
-- migrated no existing practice).
--
-- Design notes:
--
--  * ONE table for four kinds. purpose | value | principle | standard differ in
--    prompt and presentation, not in structure — four tables would mean four
--    identical schemas, four sets of RLS policies, four export domains and four
--    places to forget a tombstone, for zero representational gain. `principle`
--    is shown to users as "Guiding Principle" so it is never confused with the
--    knowledge-side `principles` table (0013), which organizes concepts and
--    beliefs rather than governing conduct.
--
--  * `adopted_at` IS THE PRODUCT. A row with `adopted_at` null is a draft: it is
--    not part of the Constitution, is excluded from every projection, and is
--    never described to the user as something they hold. This is the schema-level
--    enforcement of "AI proposes; the user adopts" — saving is not adopting.
--
--  * RETIRE ≠ DELETE, and the difference lives in the foreign keys.
--      - Retire sets `status='retired'` + `retired_at`. The row and its whole
--        revision history remain, deliberately.
--      - Delete removes the row, and `constitution_revisions.element_id` uses
--        ON DELETE CASCADE so the history goes with it. Revisions store
--        `previous_statement`, so any other choice would leave a sensitive
--        statement behind and make it undeletable merely because history exists.
--        There is no code path where the element is gone and its wording is not.
--
--  * `supersedes_id` uses ON DELETE SET NULL, matching the convention 0035 set
--    for `workspace_id` and `source_capture_id`: deleting a superseded element
--    must not delete its successor, and must not leave a dangling id. The chain
--    honestly ends.
--
--  * `exclude_from_ai` ships WITH the primitive rather than being retrofitted.
--    Adding it later would mean a migration plus a backfill decision about rows
--    that are already sensitive. Excluded elements still participate fully in
--    local deterministic behaviour — list, search, graph, history, export.
--
--  * `from_ai_text` records that the statement originated as machine prose the
--    user kept. Adopting machine text never clears it; rewriting the statement
--    in the user's own words does (LIFEOS-050A/050B).
--
--  * NO score, NO alignment percentage, NO streak, NO compliance rate, NO
--    computed columns. A Constitution is an authored document, not a metric.
--
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'constitutionElements' / 'constitutionRevisions').
--    A tombstone carries only {domain, recordId, deletedAt} — never content.

-- ========================= constitution_elements =========================
create table if not exists public.constitution_elements (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind              text not null default 'value',        -- purpose | value | principle | standard
  statement         text not null default '',             -- the user's own words
  note              text,                                  -- optional "why this matters"; never generated
  status            text not null default 'draft',        -- draft | active | retired
  adopted_at        timestamptz,                           -- null ⇒ NOT constitutional
  retired_at        timestamptz,
  supersedes_id     uuid references public.constitution_elements(id) on delete set null,
  workspace_id      uuid references public.workspaces(id) on delete set null,   -- the Life Area
  linked_refs       jsonb not null default '[]'::jsonb,    -- typed references, never copies
  source_capture_id uuid references public.captures(id) on delete set null,
  from_ai_text      boolean not null default false,        -- adoption is not authorship
  exclude_from_ai   boolean not null default false,        -- withhold from every AI request
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists constitution_elements_user_idx      on public.constitution_elements (user_id);
create index if not exists constitution_elements_updated_idx   on public.constitution_elements (user_id, updated_at desc);
create index if not exists constitution_elements_status_idx    on public.constitution_elements (user_id, status);
create index if not exists constitution_elements_kind_idx      on public.constitution_elements (user_id, kind);
create index if not exists constitution_elements_workspace_idx on public.constitution_elements (user_id, workspace_id);
create index if not exists constitution_elements_supersedes_idx on public.constitution_elements (user_id, supersedes_id);

-- ========================= constitution_revisions =========================
-- Append-only history. Immutable in spirit; never deleted on its own — but it IS
-- destroyed with its element (see the cascade below), which is what keeps
-- sensitive wording deletable.
create table if not exists public.constitution_revisions (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  element_id         uuid not null references public.constitution_elements(id) on delete cascade,
  change_kind        text not null default 'edited',   -- created|adopted|edited|revised|relinked|retired|readopted
  previous_statement text,                              -- the wording before this change
  new_statement      text,                              -- the wording after it
  reason             text,                              -- the user's own reason; never generated
  evidence_refs      jsonb not null default '[]'::jsonb,-- what informed the change (references)
  at                 timestamptz not null default now()
);

create index if not exists constitution_revisions_user_idx    on public.constitution_revisions (user_id);
create index if not exists constitution_revisions_element_idx on public.constitution_revisions (user_id, element_id, at);

-- ================================== RLS ==================================
alter table public.constitution_elements  enable row level security;
alter table public.constitution_revisions enable row level security;

do $$
begin
  drop policy if exists constitution_elements_select on public.constitution_elements;
  drop policy if exists constitution_elements_insert on public.constitution_elements;
  drop policy if exists constitution_elements_update on public.constitution_elements;
  drop policy if exists constitution_elements_delete on public.constitution_elements;
  create policy constitution_elements_select on public.constitution_elements for select using (auth.uid() = user_id);
  create policy constitution_elements_insert on public.constitution_elements for insert with check (auth.uid() = user_id);
  create policy constitution_elements_update on public.constitution_elements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy constitution_elements_delete on public.constitution_elements for delete using (auth.uid() = user_id);

  drop policy if exists constitution_revisions_select on public.constitution_revisions;
  drop policy if exists constitution_revisions_insert on public.constitution_revisions;
  drop policy if exists constitution_revisions_update on public.constitution_revisions;
  drop policy if exists constitution_revisions_delete on public.constitution_revisions;
  create policy constitution_revisions_select on public.constitution_revisions for select using (auth.uid() = user_id);
  create policy constitution_revisions_insert on public.constitution_revisions for insert with check (auth.uid() = user_id);
  create policy constitution_revisions_update on public.constitution_revisions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy constitution_revisions_delete on public.constitution_revisions for delete using (auth.uid() = user_id);
end $$;
