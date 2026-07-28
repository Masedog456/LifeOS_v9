-- LIFEOS-036 — Next actions & commitments.
--
-- Persists next actions (the leaf of Goal → Project → Milestone → Next Action →
-- Session), their explicit dependency edges, and reusable action templates.
-- Additive and idempotent: migrations 0001–0026 are untouched; every statement
-- is rerunnable.
--
-- Design notes:
--  * Three tables. `next_actions` carries normalized lifecycle/context columns;
--    bounded, always-read-with-the-action structures (links, tags, compact
--    history) are jsonb, matching how 0022/0023/0025 embed activity/milestones/
--    review content. `action_dependencies` is a first-class edge table so a
--    dependency addition merges as a union across devices and cycle checks run
--    at the application layer. `action_templates` are reusable shapes — NOT
--    recurring actions; there is no scheduler and no recurrence generation.
--  * SOFT references only. project_id / milestone_id / goal_id / workspace_id /
--    source_capture_id / source_review_id are plain uuids WITHOUT foreign keys,
--    so deleting a project/milestone/goal NEVER cascades away an action and an
--    orphaned reference degrades gracefully (the projections are orphan-safe).
--  * Completion is manual and never cascades; no trigger changes another record.
--  * Discardless model: cancel/complete are reversible statuses, not deletes.
--  * RLS-protected per user; compatible with the 0024 sync-integrity tombstone
--    ledger (deletes tombstoned under domains 'nextActions' /
--    'actionDependencies' / 'actionTemplates').
--  * No AI, no auto-generation, no prioritization/score/streak/analytics columns.

-- ============================== next_actions ==============================
create table if not exists public.next_actions (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null default '',
  description        text not null default '',
  status             text not null default 'open',          -- open|in_progress|waiting|deferred|completed|cancelled
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  deferred_until     text,                                  -- local day key yyyy-mm-dd (eligible-for-Next date)
  waiting_on         text,
  waiting_since      timestamptz,
  follow_up_date     text,                                  -- local day key yyyy-mm-dd (surfaced, never auto-acted)
  notes              text not null default '',
  -- Context (all user-selected; SOFT references, no FKs → no destructive cascade).
  workspace_id       uuid,
  goal_id            uuid,
  project_id         uuid,
  milestone_id       uuid,
  source_capture_id  uuid,
  source_review_id   uuid,
  linked_entity_refs jsonb not null default '[]'::jsonb,    -- RecordRefLite[]
  tags               jsonb not null default '[]'::jsonb,    -- string[]
  estimated_size     text not null default 'unspecified',   -- tiny|small|medium|large|unspecified
  energy             text not null default 'unspecified',   -- low|medium|high|unspecified
  context            text,                                  -- user-selected context label
  "order"            double precision not null default 0,   -- manual ordering weight
  pinned             boolean not null default false,
  history            jsonb not null default '[]'::jsonb,    -- compact ActionHistoryEvent[]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists next_actions_user_idx      on public.next_actions (user_id);
create index if not exists next_actions_status_idx     on public.next_actions (user_id, status);
create index if not exists next_actions_project_idx    on public.next_actions (user_id, project_id);
create index if not exists next_actions_milestone_idx  on public.next_actions (user_id, milestone_id);
create index if not exists next_actions_deferred_idx   on public.next_actions (user_id, deferred_until);
create index if not exists next_actions_followup_idx   on public.next_actions (user_id, follow_up_date);
create index if not exists next_actions_updated_idx    on public.next_actions (user_id, updated_at desc);

-- ========================== action_dependencies ==========================
-- Explicit edge: `blocked_id` is blocked by `blocker_id`. Cycles (direct or
-- indirect) are rejected at the application layer. Endpoints are SOFT (no FK) so
-- a deleted action leaves a prunable dangling edge rather than cascading.
create table if not exists public.action_dependencies (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocker_id  uuid not null,
  blocked_id  uuid not null,
  created_at  timestamptz not null default now(),
  constraint action_dependencies_no_self check (blocker_id <> blocked_id),
  constraint action_dependencies_edge_uniq unique (user_id, blocker_id, blocked_id)
);
create index if not exists action_dependencies_user_idx     on public.action_dependencies (user_id);
create index if not exists action_dependencies_blocker_idx   on public.action_dependencies (user_id, blocker_id);
create index if not exists action_dependencies_blocked_idx   on public.action_dependencies (user_id, blocked_id);

-- ============================ action_templates ============================
-- Reusable action shapes. The user explicitly instantiates each instance;
-- `suggested_recurrence` is a plain human description, never a schedule.
create table if not exists public.action_templates (
  id                   uuid primary key,
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                text not null default '',
  description          text not null default '',
  context              text,
  energy               text not null default 'unspecified',
  estimated_size       text not null default 'unspecified',
  tags                 jsonb not null default '[]'::jsonb,  -- string[]
  default_workspace_id uuid,
  default_project_id   uuid,
  suggested_recurrence text,                                -- human description only (no scheduler)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists action_templates_user_idx     on public.action_templates (user_id);
create index if not exists action_templates_updated_idx   on public.action_templates (user_id, updated_at desc);

-- ================================== RLS ==================================
alter table public.next_actions        enable row level security;
alter table public.action_dependencies enable row level security;
alter table public.action_templates    enable row level security;

do $$
begin
  drop policy if exists next_actions_select on public.next_actions;
  drop policy if exists next_actions_insert on public.next_actions;
  drop policy if exists next_actions_update on public.next_actions;
  drop policy if exists next_actions_delete on public.next_actions;
  create policy next_actions_select on public.next_actions for select using (auth.uid() = user_id);
  create policy next_actions_insert on public.next_actions for insert with check (auth.uid() = user_id);
  create policy next_actions_update on public.next_actions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy next_actions_delete on public.next_actions for delete using (auth.uid() = user_id);

  drop policy if exists action_dependencies_select on public.action_dependencies;
  drop policy if exists action_dependencies_insert on public.action_dependencies;
  drop policy if exists action_dependencies_update on public.action_dependencies;
  drop policy if exists action_dependencies_delete on public.action_dependencies;
  create policy action_dependencies_select on public.action_dependencies for select using (auth.uid() = user_id);
  create policy action_dependencies_insert on public.action_dependencies for insert with check (auth.uid() = user_id);
  create policy action_dependencies_update on public.action_dependencies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy action_dependencies_delete on public.action_dependencies for delete using (auth.uid() = user_id);

  drop policy if exists action_templates_select on public.action_templates;
  drop policy if exists action_templates_insert on public.action_templates;
  drop policy if exists action_templates_update on public.action_templates;
  drop policy if exists action_templates_delete on public.action_templates;
  create policy action_templates_select on public.action_templates for select using (auth.uid() = user_id);
  create policy action_templates_insert on public.action_templates for insert with check (auth.uid() = user_id);
  create policy action_templates_update on public.action_templates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy action_templates_delete on public.action_templates for delete using (auth.uid() = user_id);
end $$;
