-- LIFEOS-052 — Standalone Notes.
--
-- The Life Organization Gap Audit found that LifeOS had no lightweight place for
-- information that is merely USEFUL. Every exit from Capture was a promotion —
-- belief, concept, decision, research, dialogue, reflection, principle,
-- framework, practice — or a note *field* on a project or workspace. A recipe, a
-- chord shape, or "por vs para" had nowhere to live, so the product's own stated
-- principle (not every useful thought needs to become formal knowledge) was
-- unimplementable.
--
-- Additive and idempotent: migrations 0001–0034 are untouched; every statement
-- is rerunnable.
--
-- Design notes:
--  * A Note carries NO status, NO lifecycle, and NO epistemic standing. Those are
--    exactly what make the formal records expensive to file into, and adding them
--    here would rebuild the problem this table exists to solve.
--  * `workspace_id` is the optional TOPIC. A Topic *is* a Workspace — no separate
--    topic table and no workspace discriminator were introduced (see
--    lib/notes/topics.ts for the full reasoning). `on delete set null` so
--    deleting a workspace never deletes the user's notes; the note simply loses
--    its topic.
--  * `source_capture_id` preserves capture lineage with `on delete set null` —
--    a note outlives the capture it came from, matching how every other
--    capture-derived record behaves.
--  * `from_ai_text` records that the body is machine prose the user chose to
--    KEEP. Saving is not authorship: `classifyOrigin` reads this so an AI answer
--    stored as a note is never read back as the user's own thinking
--    (LIFEOS-050A/050B). Nullable/default false — legacy rows are user-authored
--    by construction, which is the honest classification for them.
--  * RLS-protected per user; tombstone-compatible with the LIFEOS-033 layer
--    (deletes tombstoned under 'notes').
--  * No AI columns, no scores, no derived-metric columns, no full-text index —
--    discovery goes through the existing command index, not a second island.

-- ==================================== notes ====================================
create table if not exists public.notes (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title             text,                                   -- optional: untitled notes are legitimate
  body              text not null default '',
  workspace_id      uuid references public.workspaces(id) on delete set null,   -- the Topic
  source_capture_id uuid references public.captures(id) on delete set null,
  linked_refs       jsonb not null default '[]'::jsonb,      -- typed references, never copies
  tags              text[] not null default '{}',
  from_ai_text      boolean not null default false,          -- provenance: saving is not authorship
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notes_user_idx      on public.notes (user_id);
create index if not exists notes_updated_idx   on public.notes (user_id, updated_at desc);
create index if not exists notes_workspace_idx on public.notes (user_id, workspace_id);
create index if not exists notes_capture_idx   on public.notes (user_id, source_capture_id);

-- ===================================== RLS =====================================
alter table public.notes enable row level security;

do $$
begin
  drop policy if exists notes_select on public.notes;
  drop policy if exists notes_insert on public.notes;
  drop policy if exists notes_update on public.notes;
  drop policy if exists notes_delete on public.notes;
  create policy notes_select on public.notes for select using (auth.uid() = user_id);
  create policy notes_insert on public.notes for insert with check (auth.uid() = user_id);
  create policy notes_update on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy notes_delete on public.notes for delete using (auth.uid() = user_id);
end $$;
