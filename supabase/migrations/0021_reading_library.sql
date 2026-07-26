-- LIFEOS-028 (persistence amendment) — Reading Companion durable storage.
--
-- Makes the reading library a first-class, user-owned, RLS-protected set of
-- normalized tables instead of a browser-local JSON blob. Six independently
-- durable entities plus an atomic import RPC. Additive and idempotent:
-- migrations 0001–0020 are untouched; every statement is rerunnable
-- (create ... if not exists, drop policy if exists + create). Reading progress
-- is 1:1 with its document and is embedded as jsonb on reading_documents;
-- passage annotations (notes) are their own rows; section/document notes live on
-- their row. Highlights store character spans; citations store STABLE ids
-- (never display strings) so they survive renames and edits.
--
-- Deletion semantics: deleting a document cascades to its OWNED descendants
-- (sections, passages, highlights, annotations, citations). A citation's link to
-- an external knowledge record is by id only (no FK) and is NEVER cascade-
-- deleted — deleting a document must not delete the belief/concept it produced.

-- ============================ reading_documents ============================
create table if not exists public.reading_documents (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title            text not null default 'Untitled document',
  subtitle         text,
  authors          jsonb not null default '[]'::jsonb,
  publication      text,
  publication_date text,
  language         text,
  description      text,
  kind             text not null default 'book',
  status           text not null default 'not_started',
  rating           int,
  cover_color      text,
  tags             jsonb not null default '[]'::jsonb,
  notes            text not null default '',
  source_metadata  jsonb not null default '{}'::jsonb,
  progress         jsonb not null default '{}'::jsonb,  -- 1:1 lifecycle → embedded
  import_complete  boolean not null default true,       -- false = partial import, recoverable
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists reading_documents_user_idx    on public.reading_documents (user_id);
create index if not exists reading_documents_updated_idx on public.reading_documents (user_id, updated_at desc);
create index if not exists reading_documents_status_idx  on public.reading_documents (user_id, status);

-- ============================ document_sections ============================
create table if not exists public.document_sections (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.reading_documents(id) on delete cascade,
  title       text not null default '',
  "order"     int  not null default 0,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists document_sections_user_idx on public.document_sections (user_id);
create index if not exists document_sections_doc_idx  on public.document_sections (document_id, "order");

-- ============================ document_passages ============================
create table if not exists public.document_passages (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.reading_documents(id) on delete cascade,
  section_id  uuid not null references public.document_sections(id) on delete cascade,
  heading     text,
  text        text not null default '',
  page        int,
  location    text,
  "order"     int  not null default 0,
  linked      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists document_passages_user_idx    on public.document_passages (user_id);
create index if not exists document_passages_doc_idx      on public.document_passages (document_id);
create index if not exists document_passages_section_idx  on public.document_passages (section_id, "order");

-- ============================ document_highlights ============================
create table if not exists public.document_highlights (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id  uuid not null references public.reading_documents(id) on delete cascade,
  passage_id   uuid not null references public.document_passages(id) on delete cascade,
  color        text not null default 'yellow',
  text         text not null default '',
  start_offset int  not null default 0,
  end_offset   int  not null default 0,
  note         text,
  linked       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists document_highlights_user_idx    on public.document_highlights (user_id);
create index if not exists document_highlights_doc_idx     on public.document_highlights (document_id);
create index if not exists document_highlights_passage_idx on public.document_highlights (passage_id);

-- ============================ document_annotations ============================
create table if not exists public.document_annotations (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.reading_documents(id) on delete cascade,
  passage_id  uuid not null references public.document_passages(id) on delete cascade,
  text        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists document_annotations_user_idx    on public.document_annotations (user_id);
create index if not exists document_annotations_doc_idx     on public.document_annotations (document_id);
create index if not exists document_annotations_passage_idx on public.document_annotations (passage_id);

-- ============================ document_citations ============================
-- A citation links a knowledge record (record_kind + record_id — an EXTERNAL id
-- with NO foreign key, so deleting a document never deletes the belief/concept)
-- back to a source location. It cascades from its document; its passage/highlight
-- links null out if those are deleted (the citation still points at the document).
create table if not exists public.document_citations (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id   uuid not null references public.reading_documents(id) on delete cascade,
  passage_id    uuid references public.document_passages(id) on delete set null,
  highlight_id  uuid references public.document_highlights(id) on delete set null,
  section_id    uuid,               -- denormalized locator (stable id, not a FK target for cascade)
  record_kind   text not null,      -- external knowledge record kind (e.g. 'belief')
  record_id     text not null,      -- external knowledge record id (NO FK — never cascade)
  page          int,
  location      text,
  created_at    timestamptz not null default now()
);
create index if not exists document_citations_user_idx     on public.document_citations (user_id);
create index if not exists document_citations_doc_idx      on public.document_citations (document_id);
create index if not exists document_citations_passage_idx  on public.document_citations (passage_id);
create index if not exists document_citations_target_idx   on public.document_citations (record_kind, record_id);

-- ================================ RLS ================================
alter table public.reading_documents   enable row level security;
alter table public.document_sections   enable row level security;
alter table public.document_passages   enable row level security;
alter table public.document_highlights enable row level security;
alter table public.document_annotations enable row level security;
alter table public.document_citations  enable row level security;

do $$
begin
  -- reading_documents: pure own-row.
  drop policy if exists reading_documents_select on public.reading_documents;
  drop policy if exists reading_documents_insert on public.reading_documents;
  drop policy if exists reading_documents_update on public.reading_documents;
  drop policy if exists reading_documents_delete on public.reading_documents;
  create policy reading_documents_select on public.reading_documents for select using (auth.uid() = user_id);
  create policy reading_documents_insert on public.reading_documents for insert with check (auth.uid() = user_id);
  create policy reading_documents_update on public.reading_documents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy reading_documents_delete on public.reading_documents for delete using (auth.uid() = user_id);

  -- document_sections: own-row AND parent must belong to the same user (no
  -- attaching a child to another user's document).
  drop policy if exists document_sections_select on public.document_sections;
  drop policy if exists document_sections_insert on public.document_sections;
  drop policy if exists document_sections_update on public.document_sections;
  drop policy if exists document_sections_delete on public.document_sections;
  create policy document_sections_select on public.document_sections for select using (auth.uid() = user_id);
  create policy document_sections_insert on public.document_sections for insert with check (
    auth.uid() = user_id and exists (select 1 from public.reading_documents d where d.id = document_id and d.user_id = auth.uid()));
  create policy document_sections_update on public.document_sections for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (select 1 from public.reading_documents d where d.id = document_id and d.user_id = auth.uid()));
  create policy document_sections_delete on public.document_sections for delete using (auth.uid() = user_id);

  -- document_passages: own-row AND parent document + section belong to the user.
  drop policy if exists document_passages_select on public.document_passages;
  drop policy if exists document_passages_insert on public.document_passages;
  drop policy if exists document_passages_update on public.document_passages;
  drop policy if exists document_passages_delete on public.document_passages;
  create policy document_passages_select on public.document_passages for select using (auth.uid() = user_id);
  create policy document_passages_insert on public.document_passages for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.reading_documents d where d.id = document_id and d.user_id = auth.uid())
    and exists (select 1 from public.document_sections s where s.id = section_id and s.user_id = auth.uid()));
  create policy document_passages_update on public.document_passages for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (select 1 from public.reading_documents d where d.id = document_id and d.user_id = auth.uid()));
  create policy document_passages_delete on public.document_passages for delete using (auth.uid() = user_id);

  -- document_highlights: own-row AND parent passage belongs to the user.
  drop policy if exists document_highlights_select on public.document_highlights;
  drop policy if exists document_highlights_insert on public.document_highlights;
  drop policy if exists document_highlights_update on public.document_highlights;
  drop policy if exists document_highlights_delete on public.document_highlights;
  create policy document_highlights_select on public.document_highlights for select using (auth.uid() = user_id);
  create policy document_highlights_insert on public.document_highlights for insert with check (
    auth.uid() = user_id and exists (select 1 from public.document_passages p where p.id = passage_id and p.user_id = auth.uid()));
  create policy document_highlights_update on public.document_highlights for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy document_highlights_delete on public.document_highlights for delete using (auth.uid() = user_id);

  -- document_annotations: own-row AND parent passage belongs to the user.
  drop policy if exists document_annotations_select on public.document_annotations;
  drop policy if exists document_annotations_insert on public.document_annotations;
  drop policy if exists document_annotations_update on public.document_annotations;
  drop policy if exists document_annotations_delete on public.document_annotations;
  create policy document_annotations_select on public.document_annotations for select using (auth.uid() = user_id);
  create policy document_annotations_insert on public.document_annotations for insert with check (
    auth.uid() = user_id and exists (select 1 from public.document_passages p where p.id = passage_id and p.user_id = auth.uid()));
  create policy document_annotations_update on public.document_annotations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy document_annotations_delete on public.document_annotations for delete using (auth.uid() = user_id);

  -- document_citations: own-row AND parent document belongs to the user.
  drop policy if exists document_citations_select on public.document_citations;
  drop policy if exists document_citations_insert on public.document_citations;
  drop policy if exists document_citations_update on public.document_citations;
  drop policy if exists document_citations_delete on public.document_citations;
  create policy document_citations_select on public.document_citations for select using (auth.uid() = user_id);
  create policy document_citations_insert on public.document_citations for insert with check (
    auth.uid() = user_id and exists (select 1 from public.reading_documents d where d.id = document_id and d.user_id = auth.uid()));
  create policy document_citations_update on public.document_citations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy document_citations_delete on public.document_citations for delete using (auth.uid() = user_id);
end $$;

-- ======================== atomic import RPC ========================
-- Imports a whole document (metadata + sections + passages + highlights +
-- annotations) in ONE transaction, so a partial failure can never leave a
-- misleadingly complete document. SECURITY INVOKER → RLS applies; rows are
-- stamped with auth.uid(). Idempotent per document (upserts by id, flips
-- import_complete to true at the end). The payload is a single jsonb object:
--   { "document": {...}, "sections": [...], "passages": [...],
--     "highlights": [...], "annotations": [...] }
create or replace function public.import_reading_document(payload jsonb)
returns void
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  d   jsonb := payload->'document';
  did uuid := (d->>'id')::uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  insert into public.reading_documents as t
    (id, user_id, title, subtitle, authors, publication, publication_date, language, description,
     kind, status, rating, cover_color, tags, notes, source_metadata, progress, import_complete, created_at, updated_at)
  values (
    did, uid,
    coalesce(d->>'title','Untitled document'), d->>'subtitle',
    coalesce(d->'authors','[]'::jsonb), d->>'publication', d->>'publication_date', d->>'language', d->>'description',
    coalesce(d->>'kind','book'), coalesce(d->>'status','not_started'),
    nullif(d->>'rating','')::int, d->>'cover_color',
    coalesce(d->'tags','[]'::jsonb), coalesce(d->>'notes',''),
    coalesce(d->'source_metadata','{}'::jsonb), coalesce(d->'progress','{}'::jsonb),
    false, coalesce((d->>'created_at')::timestamptz, now()), coalesce((d->>'updated_at')::timestamptz, now()))
  on conflict (id) do update set
    title = excluded.title, subtitle = excluded.subtitle, authors = excluded.authors,
    publication = excluded.publication, publication_date = excluded.publication_date, language = excluded.language,
    description = excluded.description, kind = excluded.kind, status = excluded.status, rating = excluded.rating,
    cover_color = excluded.cover_color, tags = excluded.tags, notes = excluded.notes,
    source_metadata = excluded.source_metadata, progress = excluded.progress, import_complete = false,
    updated_at = excluded.updated_at
  where t.user_id = uid;

  insert into public.document_sections (id, user_id, document_id, title, "order", note, created_at, updated_at)
  select (r->>'id')::uuid, uid, did, coalesce(r->>'title',''), coalesce((r->>'order')::int,0), r->>'note', now(), now()
  from jsonb_array_elements(coalesce(payload->'sections','[]'::jsonb)) r
  on conflict (id) do update set title = excluded.title, "order" = excluded."order", note = excluded.note, updated_at = now();

  insert into public.document_passages (id, user_id, document_id, section_id, heading, text, page, location, "order", linked, created_at, updated_at)
  select (r->>'id')::uuid, uid, did, (r->>'section_id')::uuid, r->>'heading', coalesce(r->>'text',''),
         nullif(r->>'page','')::int, r->>'location', coalesce((r->>'order')::int,0), coalesce(r->'linked','[]'::jsonb), now(), now()
  from jsonb_array_elements(coalesce(payload->'passages','[]'::jsonb)) r
  on conflict (id) do update set heading = excluded.heading, text = excluded.text, page = excluded.page,
    location = excluded.location, "order" = excluded."order", linked = excluded.linked, updated_at = now();

  insert into public.document_highlights (id, user_id, document_id, passage_id, color, text, start_offset, end_offset, note, linked, created_at, updated_at)
  select (r->>'id')::uuid, uid, did, (r->>'passage_id')::uuid, coalesce(r->>'color','yellow'), coalesce(r->>'text',''),
         coalesce((r->>'start_offset')::int,0), coalesce((r->>'end_offset')::int,0), r->>'note', coalesce(r->'linked','[]'::jsonb), now(), now()
  from jsonb_array_elements(coalesce(payload->'highlights','[]'::jsonb)) r
  on conflict (id) do update set color = excluded.color, text = excluded.text, start_offset = excluded.start_offset,
    end_offset = excluded.end_offset, note = excluded.note, linked = excluded.linked, updated_at = now();

  insert into public.document_annotations (id, user_id, document_id, passage_id, text, created_at, updated_at)
  select (r->>'id')::uuid, uid, did, (r->>'passage_id')::uuid, coalesce(r->>'text',''), now(), now()
  from jsonb_array_elements(coalesce(payload->'annotations','[]'::jsonb)) r
  on conflict (id) do update set text = excluded.text, updated_at = now();

  update public.reading_documents set import_complete = true where id = did and user_id = uid;
end $$;
