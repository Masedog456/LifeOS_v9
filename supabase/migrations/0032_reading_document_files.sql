-- LIFEOS-047 — Native reading upload: storage for the ORIGINAL uploaded file.
--
-- Parsed text, page provenance, highlights, and notes already live in the
-- reading_documents row (source_metadata is jsonb, so this sprint's additive
-- provenance fields — addMethod, uploadFormat, filename, mimeType, sizeBytes,
-- contentHash, url, pageCount, uploadedAt, processingState, originalStored —
-- need NO migration). What is missing is a private home for the ORIGINAL binary
-- (the PDF/DOCX itself) so "View original" can serve the untouched file. That is
-- what this migration provisions:
--
--   * a PRIVATE storage bucket `reading-originals` (never public);
--   * per-user object isolation via a first-path-segment = auth.uid() convention
--     (objects live at `<uid>/<documentId>/<safeFilename>`), enforced by RLS on
--     storage.objects so User A can never read, write, or list User B's files;
--   * a `reading_document_files` metadata table (checksum, size, content type,
--     processing state) that is itself RLS-scoped and cascades only from the
--     owning auth.users row.
--
-- Additive and idempotent (0001–0031 untouched; every statement rerunnable).
-- NEVER weaken these policies and NEVER make the bucket public: the original a
-- user uploads is private to that user. Large binaries are NEVER placed in
-- localStorage; they belong here.
--
-- Client wiring that actually streams bytes into this bucket is a documented,
-- separate increment (see docs/READING_INGESTION.md → "Storing the original").
-- Until that ships, source_metadata.originalStored stays false and the app keeps
-- the parsed text only — it never claims an original is stored when it is not.

-- ===================== private bucket =====================
-- id = name = 'reading-originals'; public = false. A 25 MB per-object limit
-- mirrors MAX_UPLOAD_BYTES in lib/reading/ingest.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reading-originals',
  'reading-originals',
  false,
  26214400, -- 25 * 1024 * 1024
  array['application/pdf', 'text/plain', 'text/markdown',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ===================== object-level RLS =====================
-- Objects are namespaced by the owner's uid as the first path segment, so a user
-- may only touch objects under their own `<uid>/…` prefix. storage.objects
-- already has RLS enabled by Supabase; we add scoped policies for this bucket.
do $$
begin
  drop policy if exists reading_originals_select on storage.objects;
  drop policy if exists reading_originals_insert on storage.objects;
  drop policy if exists reading_originals_update on storage.objects;
  drop policy if exists reading_originals_delete on storage.objects;

  create policy reading_originals_select on storage.objects
    for select using (
      bucket_id = 'reading-originals'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  create policy reading_originals_insert on storage.objects
    for insert with check (
      bucket_id = 'reading-originals'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  create policy reading_originals_update on storage.objects
    for update using (
      bucket_id = 'reading-originals'
      and auth.uid()::text = (storage.foldername(name))[1]
    ) with check (
      bucket_id = 'reading-originals'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
  create policy reading_originals_delete on storage.objects
    for delete using (
      bucket_id = 'reading-originals'
      and auth.uid()::text = (storage.foldername(name))[1]
    );
end $$;

-- ===================== file metadata table =====================
-- One row per stored original. checksum enables per-user duplicate detection
-- server-side (the client also dedups by content hash before upload). We store
-- size, content type, and processing state — never the file's text/contents.
create table if not exists public.reading_document_files (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id   uuid not null,                    -- the reading_documents row it belongs to
  storage_path  text not null,                    -- '<uid>/<documentId>/<safeFilename>'
  filename      text not null,                    -- sanitized display name
  content_type  text,
  size_bytes    bigint,
  checksum      text,                             -- content hash (dedup)
  processing_state text not null default 'ready', -- mirrors ingest.ts state machine
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists reading_document_files_user_idx on public.reading_document_files (user_id, created_at desc);
create index if not exists reading_document_files_doc_idx on public.reading_document_files (user_id, document_id);
-- Per-user duplicate detection by checksum (nulls allowed; only real hashes unique).
create unique index if not exists reading_document_files_checksum_idx
  on public.reading_document_files (user_id, checksum) where checksum is not null;

alter table public.reading_document_files enable row level security;

do $$
begin
  drop policy if exists reading_document_files_select on public.reading_document_files;
  drop policy if exists reading_document_files_insert on public.reading_document_files;
  drop policy if exists reading_document_files_update on public.reading_document_files;
  drop policy if exists reading_document_files_delete on public.reading_document_files;
  create policy reading_document_files_select on public.reading_document_files for select using (auth.uid() = user_id);
  create policy reading_document_files_insert on public.reading_document_files for insert with check (auth.uid() = user_id);
  create policy reading_document_files_update on public.reading_document_files for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy reading_document_files_delete on public.reading_document_files for delete using (auth.uid() = user_id);
end $$;
