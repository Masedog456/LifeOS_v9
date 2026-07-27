-- LIFEOS-031 — Goals, projects & execution engine.
--
-- Makes Goals and Projects first-class, user-owned, RLS-protected records so
-- LifeOS understands "what am I trying to accomplish?", not just "what do I
-- own?". Goals are the highest-level object; Projects belong to Goals; Sessions
-- (0022) optionally link to a Goal/Project. Additive and idempotent: migrations
-- 0001–0022 are untouched; every statement is rerunnable (create ... if not
-- exists, drop policy if exists + create).
--
-- Design notes:
--  * A Goal never copies the work it organizes — `linked_workspaces` and
--    `linked_knowledge` are jsonb arrays of typed references ({kind,id}) only;
--    its projects are looked up by `projects.goal_id`.
--  * Milestones are 1:many with a project, always read/written with it, bounded,
--    and have no independent query needs, so they are embedded as jsonb on the
--    project row — matching how 0022 embeds session activity and how decisions
--    embed options/criteria. Completion is MANUAL ONLY; nothing is inferred.
--  * Progress is DERIVED at view time (completed milestones / projects) with an
--    optional `manual_progress` override — no progress column is authoritative.
--  * `goal_id` FKs to goals ON DELETE SET NULL: deleting a goal orphans (never
--    deletes) its projects. `workspace_id` is a soft reference (no FK) so goal/
--    project lifecycles stay independent of the 0022 workspace tables.
--  * No AI, no auto-planning, no auto-prioritization, no analytics columns.

-- ================================== goals ==================================
create table if not exists public.goals (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null default 'Untitled goal',
  description        text not null default '',
  status             text not null default 'active',
  priority           text not null default 'medium',
  target_date        text,                                 -- yyyy-mm-dd (no calendar integration)
  notes              text not null default '',
  tags               jsonb not null default '[]'::jsonb,
  manual_progress    int,                                  -- null = derive; else 0–100 override
  linked_workspaces  jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  linked_knowledge   jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists goals_user_idx     on public.goals (user_id);
create index if not exists goals_updated_idx   on public.goals (user_id, updated_at desc);
create index if not exists goals_status_idx    on public.goals (user_id, status);

alter table public.goals enable row level security;

do $$
begin
  drop policy if exists goals_select on public.goals;
  drop policy if exists goals_insert on public.goals;
  drop policy if exists goals_update on public.goals;
  drop policy if exists goals_delete on public.goals;
  create policy goals_select on public.goals for select using (auth.uid() = user_id);
  create policy goals_insert on public.goals for insert with check (auth.uid() = user_id);
  create policy goals_update on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy goals_delete on public.goals for delete using (auth.uid() = user_id);
end $$;

-- ================================ projects =================================
create table if not exists public.projects (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null default 'Untitled project',
  description        text not null default '',
  status             text not null default 'active',
  priority           text not null default 'medium',
  goal_id            uuid references public.goals(id) on delete set null,  -- orphan, never delete
  workspace_id       uuid,                                 -- soft reference (no FK)
  start_date         text,
  target_date        text,
  notes              text not null default '',
  milestones         jsonb not null default '[]'::jsonb,   -- Milestone[] (manual completion)
  manual_progress    int,                                  -- null = derive; else 0–100 override
  related_documents  jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  related_entities   jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists projects_user_idx      on public.projects (user_id);
create index if not exists projects_updated_idx    on public.projects (user_id, updated_at desc);
create index if not exists projects_goal_idx       on public.projects (goal_id);
create index if not exists projects_status_idx     on public.projects (user_id, status);

alter table public.projects enable row level security;

do $$
begin
  drop policy if exists projects_select on public.projects;
  drop policy if exists projects_insert on public.projects;
  drop policy if exists projects_update on public.projects;
  drop policy if exists projects_delete on public.projects;
  create policy projects_select on public.projects for select using (auth.uid() = user_id);
  create policy projects_insert on public.projects for insert with check (auth.uid() = user_id);
  create policy projects_update on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy projects_delete on public.projects for delete using (auth.uid() = user_id);
end $$;
