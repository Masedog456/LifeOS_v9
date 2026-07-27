-- LIFEOS-035 — Inbox Zero & capture processing.
--
-- Additive processing metadata on the CANONICAL captures table (migration 0001).
-- The verbatim `text` column stays immutable (the 0001 `captures_immutable_text`
-- trigger is untouched) — clarifications live in `working_text`, so the original
-- is always recoverable. Every existing capture defaults to `inbox`. Additive and
-- idempotent: migrations 0001–0025 are untouched; every statement is rerunnable.
--
-- Design notes:
--  * Prefer additive columns on the existing table (captures are already synced
--    there) over a new normalized table — the smallest durable structure that
--    fits the persistence architecture. Bounded, always-read-with-the-capture
--    structures (links, tags, lineage, compact history) are jsonb, matching how
--    0022/0023/0025 embed activity/milestones/review content.
--  * `working_text` is a separate column; `text` is never overwritten.
--  * Processing history stores compact metadata only — never the full capture
--    text (privacy + size).
--  * Discard is a soft, reversible status (`discarded` + `discarded_at`); nothing
--    is destroyed immediately. Deletes (if any) remain tombstone-compatible.
--  * No AI, no auto-classification columns, no analytics.

alter table public.captures add column if not exists processing_status   text not null default 'inbox';
alter table public.captures add column if not exists processed_at         timestamptz;
alter table public.captures add column if not exists processed_by_action  text;
alter table public.captures add column if not exists processed_in_session uuid;      -- soft reference
alter table public.captures add column if not exists deferred_until       text;      -- local day key yyyy-mm-dd
alter table public.captures add column if not exists archived_at          timestamptz;
alter table public.captures add column if not exists discarded_at         timestamptz;
alter table public.captures add column if not exists source_context       jsonb not null default '{}'::jsonb;
alter table public.captures add column if not exists linked_workspace_ids jsonb not null default '[]'::jsonb;
alter table public.captures add column if not exists linked_goal_ids      jsonb not null default '[]'::jsonb;
alter table public.captures add column if not exists linked_project_ids   jsonb not null default '[]'::jsonb;
alter table public.captures add column if not exists linked_entity_refs   jsonb not null default '[]'::jsonb;  -- RecordRefLite[]
alter table public.captures add column if not exists processing_notes     text not null default '';
alter table public.captures add column if not exists tags                 jsonb not null default '[]'::jsonb;  -- string[]
alter table public.captures add column if not exists working_text         text;      -- clarified version; `text` stays immutable
alter table public.captures add column if not exists split_from_id        uuid;      -- lineage (soft reference)
alter table public.captures add column if not exists merged_from_ids      jsonb not null default '[]'::jsonb;  -- string[]
alter table public.captures add column if not exists processing_history   jsonb not null default '[]'::jsonb;  -- compact CaptureProcessingEvent[]

-- Backfill any pre-existing NULL statuses to 'inbox' (defensive; the default
-- already covers new-but-unset rows).
update public.captures set processing_status = 'inbox' where processing_status is null;

-- Indexes for inbox / status / deferred-return queries.
create index if not exists captures_status_idx     on public.captures (user_id, processing_status);
create index if not exists captures_deferred_idx    on public.captures (user_id, deferred_until);
create index if not exists captures_split_from_idx  on public.captures (split_from_id);

-- RLS already governs public.captures (migration 0001). No policy change needed;
-- the new columns inherit the table's per-user policies.
