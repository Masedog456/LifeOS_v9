-- LIFEOS-034 — Daily review & planning loop.
--
-- Persists DailyReview records: one canonical review per user per LOCAL calendar
-- date. The local date is stored as a plain `date` (yyyy-mm-dd) SEPARATE from the
-- wall-clock timestamps, so a timezone change or clock skew can never fork a
-- second review for a day that already has one — enforced by a UNIQUE
-- (user_id, date) constraint. Additive and idempotent: migrations 0001–0024 are
-- untouched; every statement is rerunnable.
--
-- Design notes:
--  * Core metadata (date/status/started/completed/timestamps) are normalized
--    columns; the structured, bounded review content (wins/lessons/friction/
--    open loops/tomorrow focus) is embedded as jsonb, matching how 0022/0023
--    embed session activity and milestones. These lists are always read/written
--    with their review and have no independent query needs.
--  * A review only ever SUMMARIZES other records — it never owns them — so link
--    fields are jsonb arrays of ids / typed references ({kind,id}), never FKs
--    that would couple lifecycles.
--  * `tz_offset_minutes` records the UTC offset in effect at creation, for DST /
--    timezone-travel diagnostics only; day membership is decided by the local
--    `date`, never by this value.
--  * Weekly rollups are a PROJECTION and are deliberately NOT persisted.
--  * RLS-protected; compatible with the 0024 sync-integrity tombstone ledger
--    (deletes are tombstoned under domain 'dailyReviews').
--  * No AI, no scoring, no streak/analytics columns.

-- ============================== daily_reviews ==============================
create table if not exists public.daily_reviews (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date               text not null,                        -- local calendar date, yyyy-mm-dd (canonical key)
  status             text not null default 'not_started',
  started_at         timestamptz,
  completed_at       timestamptz,
  summary            text not null default '',
  notes              text not null default '',
  wins               jsonb not null default '[]'::jsonb,   -- ReviewWin[]
  lessons            jsonb not null default '[]'::jsonb,   -- ReviewLesson[]
  friction           jsonb not null default '[]'::jsonb,   -- ReviewFriction[]
  open_loops         jsonb not null default '[]'::jsonb,   -- ReviewOpenLoop[]
  tomorrow_focus     jsonb not null default '[]'::jsonb,   -- ReviewFocusItem[]
  linked_goals       jsonb not null default '[]'::jsonb,   -- string[]
  linked_projects    jsonb not null default '[]'::jsonb,   -- string[]
  linked_workspaces  jsonb not null default '[]'::jsonb,   -- string[]
  linked_entities    jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  tz_offset_minutes  int,                                  -- minutes east of UTC at creation (diagnostics only)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- One canonical review per user per local date (duplicate prevention).
  constraint daily_reviews_user_date_uniq unique (user_id, date)
);
create index if not exists daily_reviews_user_idx    on public.daily_reviews (user_id);
create index if not exists daily_reviews_date_idx     on public.daily_reviews (user_id, date desc);
create index if not exists daily_reviews_status_idx   on public.daily_reviews (user_id, status);
create index if not exists daily_reviews_updated_idx  on public.daily_reviews (user_id, updated_at desc);

alter table public.daily_reviews enable row level security;

do $$
begin
  drop policy if exists daily_reviews_select on public.daily_reviews;
  drop policy if exists daily_reviews_insert on public.daily_reviews;
  drop policy if exists daily_reviews_update on public.daily_reviews;
  drop policy if exists daily_reviews_delete on public.daily_reviews;
  create policy daily_reviews_select on public.daily_reviews for select using (auth.uid() = user_id);
  create policy daily_reviews_insert on public.daily_reviews for insert with check (auth.uid() = user_id);
  create policy daily_reviews_update on public.daily_reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy daily_reviews_delete on public.daily_reviews for delete using (auth.uid() = user_id);
end $$;
