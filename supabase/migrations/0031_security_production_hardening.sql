-- LIFEOS-040 — Security, privacy & production hardening.
--
-- This sprint is overwhelmingly about audits, boundaries, and safe flows that
-- need NO new storage. We add only FOUR small, additive retention tables, each
-- carrying operational metadata — never record CONTENTS, never tokens, never
-- raw error stacks. Every table is RLS-protected per user, indexed, and cascades
-- ONLY from the owning auth.users row (deliberate account cleanup). Additive and
-- idempotent: migrations 0001–0030 are untouched; every statement is rerunnable.
--
-- Retention (documented in SECURITY_AND_PRIVACY.md / retention.ts):
--   * sanitized_error_events      — sanitized diagnostics; rolling 30 days.
--   * export_history              — export metadata (counts/checksum); ~1 year.
--   * import_history              — import metadata (mode/counts); ~1 year.
--   * account_deletion_requests   — minimal audit of a deletion request.
--
-- NONE of these tables stores capture/note/belief/document text, completion
-- evidence, export contents, tokens, passwords, or raw payloads.

-- ===================== sanitized_error_events =====================
create table if not exists public.sanitized_error_events (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at                timestamptz not null default now(),
  event             text not null default 'error',      -- event name, not content
  error_code        text,                               -- sanitized short code (no stack)
  operation         text,                               -- e.g. 'sync.save'
  record_type       text,                               -- a TYPE, never contents
  result            text,                               -- 'ok' | 'error' | 'skipped'
  app_version       text,
  schema_version    integer,
  migration_version integer
);
create index if not exists sanitized_error_events_user_idx on public.sanitized_error_events (user_id, at desc);

-- ========================== export_history ==========================
create table if not exists public.export_history (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at            timestamptz not null default now(),
  archive_version integer not null default 1,
  record_count  integer not null default 0,
  total_bytes   bigint,                                 -- size only, never contents
  checksum      text,                                   -- manifest overall checksum
  app_version   text
);
create index if not exists export_history_user_idx on public.export_history (user_id, at desc);

-- ========================== import_history ==========================
create table if not exists public.import_history (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at             timestamptz not null default now(),
  mode           text not null default 'merge',         -- 'merge' | 'replace'
  records_added  integer not null default 0,
  records_updated integer not null default 0,
  records_removed integer not null default 0,
  source_checksum text,
  result         text                                   -- 'applied' | 'dry-run' | 'blocked'
);
create index if not exists import_history_user_idx on public.import_history (user_id, at desc);

-- ===================== account_deletion_requests =====================
create table if not exists public.account_deletion_requests (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  status        text not null default 'requested',      -- 'requested' | 'running' | 'completed' | 'failed'
  completed_at  timestamptz,
  exported_first boolean not null default false
);
create index if not exists account_deletion_requests_user_idx on public.account_deletion_requests (user_id, requested_at desc);

-- ================================= RLS =================================
alter table public.sanitized_error_events    enable row level security;
alter table public.export_history            enable row level security;
alter table public.import_history            enable row level security;
alter table public.account_deletion_requests enable row level security;

do $$
begin
  -- sanitized_error_events: user may read/insert/delete their own; never update (append-only).
  drop policy if exists sanitized_error_events_select on public.sanitized_error_events;
  drop policy if exists sanitized_error_events_insert on public.sanitized_error_events;
  drop policy if exists sanitized_error_events_delete on public.sanitized_error_events;
  create policy sanitized_error_events_select on public.sanitized_error_events for select using (auth.uid() = user_id);
  create policy sanitized_error_events_insert on public.sanitized_error_events for insert with check (auth.uid() = user_id);
  create policy sanitized_error_events_delete on public.sanitized_error_events for delete using (auth.uid() = user_id);

  -- export_history
  drop policy if exists export_history_select on public.export_history;
  drop policy if exists export_history_insert on public.export_history;
  drop policy if exists export_history_delete on public.export_history;
  create policy export_history_select on public.export_history for select using (auth.uid() = user_id);
  create policy export_history_insert on public.export_history for insert with check (auth.uid() = user_id);
  create policy export_history_delete on public.export_history for delete using (auth.uid() = user_id);

  -- import_history
  drop policy if exists import_history_select on public.import_history;
  drop policy if exists import_history_insert on public.import_history;
  drop policy if exists import_history_delete on public.import_history;
  create policy import_history_select on public.import_history for select using (auth.uid() = user_id);
  create policy import_history_insert on public.import_history for insert with check (auth.uid() = user_id);
  create policy import_history_delete on public.import_history for delete using (auth.uid() = user_id);

  -- account_deletion_requests: user may read/insert/update their own (status transitions).
  drop policy if exists account_deletion_requests_select on public.account_deletion_requests;
  drop policy if exists account_deletion_requests_insert on public.account_deletion_requests;
  drop policy if exists account_deletion_requests_update on public.account_deletion_requests;
  create policy account_deletion_requests_select on public.account_deletion_requests for select using (auth.uid() = user_id);
  create policy account_deletion_requests_insert on public.account_deletion_requests for insert with check (auth.uid() = user_id);
  create policy account_deletion_requests_update on public.account_deletion_requests for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;
