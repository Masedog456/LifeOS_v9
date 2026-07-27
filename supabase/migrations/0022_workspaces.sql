-- LIFEOS-030 — Workspaces, sessions & thinking modes.
--
-- Makes Workspaces and their thinking Sessions first-class, user-owned,
-- RLS-protected records so "what am I working on right now?" survives across
-- devices — not just "what do I own?". Additive and idempotent: migrations
-- 0001–0021 are untouched; every statement is rerunnable (create ... if not
-- exists, drop policy if exists + create).
--
-- Design notes:
--  * A workspace GROUPS existing entities; it never copies them. `members` and
--    `pinned` are jsonb arrays of typed references ({kind,id}) only — deleting a
--    workspace never deletes the beliefs/documents/decisions it grouped.
--  * `goals` and `resume` (per-workspace "resume where I left off" memory) are
--    1:1 with the workspace and embedded as jsonb, matching how the rest of the
--    schema embeds owned sub-structures (decisions.options, documents.progress).
--  * A session's `activity` timeline is embedded as jsonb on the session row: it
--    is always read and written with its session, is bounded in the app layer,
--    and has no independent query needs — a separate table would add join cost
--    and row-diffing complexity for no benefit. Only ONE session is active at a
--    time (ended_at is null); the app enforces this.
--  * No AI, no embeddings, no analytics columns — everything the product shows
--    is derived deterministically from these rows at view time.

-- ================================ workspaces ================================
create table if not exists public.workspaces (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Untitled workspace',
  description text not null default '',
  color       text,
  goals       jsonb not null default '[]'::jsonb,   -- WorkspaceGoal[]
  members     jsonb not null default '[]'::jsonb,   -- RecordRefLite[] (references, never copies)
  pinned      jsonb not null default '[]'::jsonb,   -- RecordRefLite[]
  resume      jsonb not null default '{}'::jsonb,   -- WorkspaceResume (nav memory)
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists workspaces_user_idx    on public.workspaces (user_id);
create index if not exists workspaces_updated_idx  on public.workspaces (user_id, updated_at desc);
create index if not exists workspaces_archived_idx on public.workspaces (user_id, archived);

alter table public.workspaces enable row level security;

do $$
begin
  drop policy if exists workspaces_select on public.workspaces;
  drop policy if exists workspaces_insert on public.workspaces;
  drop policy if exists workspaces_update on public.workspaces;
  drop policy if exists workspaces_delete on public.workspaces;
  create policy workspaces_select on public.workspaces
    for select using (auth.uid() = user_id);
  create policy workspaces_insert on public.workspaces
    for insert with check (auth.uid() = user_id);
  create policy workspaces_update on public.workspaces
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy workspaces_delete on public.workspaces
    for delete using (auth.uid() = user_id);
end $$;

-- ============================= workspace_sessions =============================
create table if not exists public.workspace_sessions (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type         text not null default 'thinking',
  goal         text not null default '',
  notes        text not null default '',            -- rich markdown scratchpad
  activity     jsonb not null default '[]'::jsonb,  -- SessionActivityEvent[] (timeline only)
  started_at   timestamptz not null default now(),
  ended_at     timestamptz                          -- null = the (single) active session
);
create index if not exists workspace_sessions_user_idx      on public.workspace_sessions (user_id);
create index if not exists workspace_sessions_workspace_idx on public.workspace_sessions (workspace_id, started_at desc);
-- Fast lookup of the (single) active session. Single-active is enforced in the
-- app layer, not by a unique constraint: the client syncs the whole sessions
-- array in one bulk upsert, and a partial UNIQUE index could transiently reject
-- the batch depending on row order — a plain index has no such hazard.
create index if not exists workspace_sessions_active_idx
  on public.workspace_sessions (user_id) where (ended_at is null);

alter table public.workspace_sessions enable row level security;

do $$
begin
  drop policy if exists workspace_sessions_select on public.workspace_sessions;
  drop policy if exists workspace_sessions_insert on public.workspace_sessions;
  drop policy if exists workspace_sessions_update on public.workspace_sessions;
  drop policy if exists workspace_sessions_delete on public.workspace_sessions;
  create policy workspace_sessions_select on public.workspace_sessions
    for select using (auth.uid() = user_id);
  create policy workspace_sessions_insert on public.workspace_sessions
    for insert with check (auth.uid() = user_id);
  create policy workspace_sessions_update on public.workspace_sessions
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy workspace_sessions_delete on public.workspace_sessions
    for delete using (auth.uid() = user_id);
end $$;
