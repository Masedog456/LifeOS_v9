-- LIFEOS-038 — Knowledge maintenance & integrity.
--
-- Persists the durable record of CONSCIOUS maintenance decisions: an append-only
-- `maintenance_events` log (reviewed / archived / merged / citation +/- /
-- relationship repaired / duplicate ignored / resolved) and `duplicate_candidates`
-- (the user's decision on a deterministically-detected duplicate group). Additive
-- and idempotent: migrations 0001–0028 are untouched; every statement is rerunnable.
--
-- Design notes:
--  * Everything else — the dashboard, review queue, orphan/staleness/citation/
--    relationship reports, archive candidates, merge previews — is DERIVED at read
--    time and stored nowhere. Only the user's decisions are persisted.
--  * `maintenance_events` is append-only history and NEVER loses rows on sync
--    (union by id). It uses a GENERIC typed reference (ref_kind + ref_id) plus an
--    optional related reference (merge primary / repaired endpoint / citation
--    target), matching the entity architecture — no per-type table.
--  * `duplicate_candidates` stores one DECISION per detected group, keyed by a
--    STABLE deterministic id (hash of reason + sorted member keys), so the same
--    duplicate found on two devices resolves to ONE row (never re-surfaced).
--  * SOFT references only: ref_kind/ref_id, related_kind/related_id, and duplicate
--    member refs are plain values WITHOUT foreign keys, so deleting any record
--    never cascades away its maintenance history, and an orphaned reference
--    degrades gracefully (projections are orphan-safe).
--  * Review filters / dashboard layout / dismissed ids / ignored-duplicate mirror
--    are PREFERENCES and live in user_prefs (LIFEOS-025), not here.
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'maintenanceEvents' / 'duplicateCandidates').
--  * No AI, no embeddings, no automatic decisions, no scores/grades columns.

-- ========================== maintenance_events ==========================
create table if not exists public.maintenance_events (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null,                         -- reviewed|archived|merged|citation_added|…
  ref_kind      text not null,                         -- the record this decision concerns
  ref_id        text not null,
  related_kind  text,                                  -- optional secondary record
  related_id    text,
  detail        text,                                  -- compact reason/candidate key (no bodies)
  at            timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists maintenance_events_user_idx     on public.maintenance_events (user_id);
create index if not exists maintenance_events_ref_idx       on public.maintenance_events (user_id, ref_kind, ref_id);
create index if not exists maintenance_events_kind_idx      on public.maintenance_events (user_id, kind);
create index if not exists maintenance_events_at_idx        on public.maintenance_events (user_id, at desc);

-- ========================= duplicate_candidates =========================
create table if not exists public.duplicate_candidates (
  id          text primary key,                        -- STABLE hash(reason + sorted member keys)
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason      text not null,                           -- same_title|same_url|same_isbn|alias|…
  kind        text not null,                           -- the kind of records grouped
  members     jsonb not null default '[]'::jsonb,      -- RecordRefLite[] (references, never copies)
  dup_key     text not null default '',                -- the shared normalized value (display)
  status      text not null default 'open',            -- open|ignored|merged
  history     jsonb not null default '[]'::jsonb,      -- MaintenanceEvent[] (append-only)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists duplicate_candidates_user_idx     on public.duplicate_candidates (user_id);
create index if not exists duplicate_candidates_status_idx    on public.duplicate_candidates (user_id, status);
create index if not exists duplicate_candidates_reason_idx    on public.duplicate_candidates (user_id, reason);

-- ================================== RLS ==================================
alter table public.maintenance_events   enable row level security;
alter table public.duplicate_candidates enable row level security;

do $$
begin
  drop policy if exists maintenance_events_select on public.maintenance_events;
  drop policy if exists maintenance_events_insert on public.maintenance_events;
  drop policy if exists maintenance_events_update on public.maintenance_events;
  drop policy if exists maintenance_events_delete on public.maintenance_events;
  create policy maintenance_events_select on public.maintenance_events for select using (auth.uid() = user_id);
  create policy maintenance_events_insert on public.maintenance_events for insert with check (auth.uid() = user_id);
  create policy maintenance_events_update on public.maintenance_events for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy maintenance_events_delete on public.maintenance_events for delete using (auth.uid() = user_id);

  drop policy if exists duplicate_candidates_select on public.duplicate_candidates;
  drop policy if exists duplicate_candidates_insert on public.duplicate_candidates;
  drop policy if exists duplicate_candidates_update on public.duplicate_candidates;
  drop policy if exists duplicate_candidates_delete on public.duplicate_candidates;
  create policy duplicate_candidates_select on public.duplicate_candidates for select using (auth.uid() = user_id);
  create policy duplicate_candidates_insert on public.duplicate_candidates for insert with check (auth.uid() = user_id);
  create policy duplicate_candidates_update on public.duplicate_candidates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy duplicate_candidates_delete on public.duplicate_candidates for delete using (auth.uid() = user_id);
end $$;
