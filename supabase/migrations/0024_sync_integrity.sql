-- LIFEOS-033 — Sync conflicts, recovery & data integrity.
--
-- The only DURABLE server-side metadata this sprint requires is a TOMBSTONE
-- ledger: when a record is deleted on one device, a stale device that still
-- holds an old copy must not silently resurrect it on the next sync. A tombstone
-- records only WHICH record was deleted and WHEN — never its content
-- (privacy-safe). Conflict detection and three-way merge run client-side over
-- the last-synced base snapshot; per-record revision is derived from the
-- existing `updated_at` columns, so no revision columns are added.
--
-- Additive and idempotent: migrations 0001–0023 are untouched; every statement
-- is rerunnable. RLS-protected and indexed. Compatible with all existing rows
-- (this only adds a new table).

-- ============================== sync_tombstones ==============================
create table if not exists public.sync_tombstones (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  domain     text not null,               -- e.g. 'workspaces', 'projects', 'documents'
  record_id  text not null,               -- the deleted record's id (no content)
  deleted_at timestamptz not null default now(),
  primary key (user_id, domain, record_id)
);
create index if not exists sync_tombstones_user_idx    on public.sync_tombstones (user_id);
create index if not exists sync_tombstones_deleted_idx on public.sync_tombstones (user_id, deleted_at desc);
create index if not exists sync_tombstones_domain_idx  on public.sync_tombstones (user_id, domain);

alter table public.sync_tombstones enable row level security;

do $$
begin
  drop policy if exists sync_tombstones_select on public.sync_tombstones;
  drop policy if exists sync_tombstones_insert on public.sync_tombstones;
  drop policy if exists sync_tombstones_update on public.sync_tombstones;
  drop policy if exists sync_tombstones_delete on public.sync_tombstones;
  create policy sync_tombstones_select on public.sync_tombstones
    for select using (auth.uid() = user_id);
  create policy sync_tombstones_insert on public.sync_tombstones
    for insert with check (auth.uid() = user_id);
  -- Re-deleting the same record just refreshes deleted_at (idempotent upsert).
  create policy sync_tombstones_update on public.sync_tombstones
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  -- A genuine resurrection (record re-created intentionally) clears its tombstone.
  create policy sync_tombstones_delete on public.sync_tombstones
    for delete using (auth.uid() = user_id);
end $$;
