-- LIFEOS-039 — Deterministic system insights.
--
-- Insights are DESCRIPTIVE views DERIVED at read time from the compact histories
-- already recorded across LifeOS (sessions, focus, actions, planning, captures,
-- reading, citations, beliefs, maintenance events, daily reviews). This sprint
-- therefore adds NO analytics warehouse and copies NO existing events into a
-- second table — the only persistent addition is a small table of user SAVED
-- VIEWS (display intent), so a user can name and re-open a configured view.
-- Additive and idempotent: migrations 0001–0029 are untouched; every statement
-- is rerunnable.
--
-- Design notes:
--  * `saved_insight_views` stores ONLY: the selected insight, the range (preset +
--    explicit custom keys), grouping, and opaque display filters. It NEVER stores
--    calculated results — results are always re-derived deterministically — so a
--    saved view can never present stale numbers as current. Insight PREFERENCES
--    (last range, dormancy threshold, definitions-drawer state) live in user_prefs
--    (LIFEOS-025), not here.
--  * No new event storage. The activity index is built in memory from existing
--    histories; nothing about activity is duplicated into the database.
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'savedInsightViews'). No foreign keys to source
--    records — a saved view references records only through opaque filter values,
--    so deleting a project/goal never cascades away a saved view (orphan-safe).
--  * No AI, no scores, no derived-metric columns.

-- ========================= saved_insight_views =========================
create table if not exists public.saved_insight_views (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null default 'Untitled view',
  insight      text not null default 'home',          -- which insight surface
  range_kind   text not null default 'last_7_days',   -- today|last_7_days|…|custom
  custom_start text,                                   -- yyyy-mm-dd (custom only)
  custom_end   text,                                   -- yyyy-mm-dd (custom only)
  grouping     text,                                   -- attention/change-log grouping
  filters      jsonb not null default '{}'::jsonb,     -- opaque display filters (no results)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists saved_insight_views_user_idx     on public.saved_insight_views (user_id);
create index if not exists saved_insight_views_updated_idx    on public.saved_insight_views (user_id, updated_at desc);
create index if not exists saved_insight_views_insight_idx    on public.saved_insight_views (user_id, insight);

-- ================================== RLS ==================================
alter table public.saved_insight_views enable row level security;

do $$
begin
  drop policy if exists saved_insight_views_select on public.saved_insight_views;
  drop policy if exists saved_insight_views_insert on public.saved_insight_views;
  drop policy if exists saved_insight_views_update on public.saved_insight_views;
  drop policy if exists saved_insight_views_delete on public.saved_insight_views;
  create policy saved_insight_views_select on public.saved_insight_views for select using (auth.uid() = user_id);
  create policy saved_insight_views_insert on public.saved_insight_views for insert with check (auth.uid() = user_id);
  create policy saved_insight_views_update on public.saved_insight_views for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy saved_insight_views_delete on public.saved_insight_views for delete using (auth.uid() = user_id);
end $$;
