-- LIFEOS-067 — external calendar identity.
--
-- FOUR NULLABLE COLUMNS ON `events`. No new table, no provider-specific life
-- table, no token storage.
--
-- ## Why this exists
--
-- Reconciling a calendar refresh needs to answer one question: *"is this the
-- same external event I imported yesterday?"* Title and date cannot answer it —
-- both change, and a rescheduled appointment is the whole reason the feature is
-- worth building. Provider ids can.
--
-- ## Why not a second table
--
-- Because a provider is TRANSPORT, not a life concept. There is no
-- GoogleCalendarEvent in this product: an imported appointment is the same
-- `LifeEvent` a capture produces, so Today, Week in Review, Capture and Temporal
-- Editing all handle it without knowing calendars exist. A `google_calendar_events`
-- table would be a second schedule, and the user would have two calendars again —
-- exactly the problem this sprint exists to remove.
--
-- ## Identity is ALL-OR-NOTHING, and the CHECK is load-bearing
--
-- Postgres treats NULLs as DISTINCT in a unique index. So a row with
-- `(provider='google', calendar_id=NULL, event_id='abc')` would not collide with
-- an identical row on the next refresh: the index would see two different keys
-- and permit both, silently importing the event twice. The constraint below is
-- what makes the index mean what it says.
--
-- `external_updated_at` is deliberately outside the completeness rule. Not every
-- provider supplies a trustworthy modification timestamp, and a missing one must
-- degrade to "reconcile by identity" — which still works — rather than making
-- the row malformed.
--
-- ## What this does NOT claim
--
-- `external_updated_at` records when the PROVIDER says the upstream copy
-- changed. It does not record whether the local copy changed since the last
-- successful sync — that would need a separate reconciliation baseline
-- (`external_synced_at`), which this migration does not add because the
-- integration is read-only. Full local-vs-upstream edit conflict detection is
-- deferred, and nothing here pretends otherwise.
--
-- ## Safety
--
-- Purely additive. Every existing row keeps all four columns NULL, which
-- satisfies the CHECK and is excluded from the partial index. No existing event
-- is read, rewritten, or revalidated. RLS is unchanged: the four policies on
-- `events` are all `auth.uid() = user_id`, and the new columns inherit them.

alter table public.events add column if not exists external_provider    text;
alter table public.events add column if not exists external_calendar_id text;
alter table public.events add column if not exists external_event_id    text;
alter table public.events add column if not exists external_updated_at  timestamptz;

-- Identity completeness. All three present, or all four absent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_external_identity_complete'
  ) then
    alter table public.events add constraint events_external_identity_complete check (
      (
        external_provider    is null
        and external_calendar_id is null
        and external_event_id    is null
        and external_updated_at  is null
      )
      or
      (
        external_provider    is not null
        and external_calendar_id is not null
        and external_event_id    is not null
      )
    );
  end if;
end $$;

-- The reconciliation identity. PARTIAL, so the overwhelming majority of events —
-- the ones a person typed themselves — are untouched by it and can never collide.
--
-- Title and date are deliberately NOT part of this key. Two events with the same
-- title at the same time are two events unless the provider says they are one,
-- and a locally-created event is never merged into an imported one by similarity.
create unique index if not exists events_external_identity_idx
  on public.events (user_id, external_provider, external_calendar_id, external_event_id)
  where external_provider is not null;

-- Refresh reads every linked event for one provider+calendar in one query.
create index if not exists events_external_lookup_idx
  on public.events (user_id, external_provider, external_calendar_id)
  where external_provider is not null;
