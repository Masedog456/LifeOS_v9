-- LIFEOS-049 — Semantic index for Reading retrieval chunks.
--
-- LIFEOS-047 shipped deterministic lexical retrieval over one-chunk-per-passage.
-- That cannot find a passage that discusses a concept without repeating the
-- query's words, which is exactly what book-length study requires. This table
-- stores ONE embedding per stable retrieval chunk (see lib/reading/chunking.ts)
-- so hybrid lexical+semantic retrieval can search a whole book.
--
-- Design notes:
--   * Vectors live HERE, never in the local StoreState/localStorage blob — a
--     book's worth of vectors would otherwise worsen the known whole-state
--     persistence wall (see PERSISTENCE_QA.md).
--   * `chunk_id` is the deterministic `<documentId>:c<n>` id, so indexing is
--     resumable and idempotent: re-running skips chunks already present with a
--     matching content hash.
--   * `content_hash` lets us re-embed only chunks whose text actually changed.
--   * Ownership cascades ONLY from auth.users (same pattern as 0032). We do NOT
--     add a foreign key to reading_documents: a document may be created locally
--     and indexed before its row has synced, and an FK would make that a hard
--     failure instead of a retry. Per-document cleanup is explicit in the app
--     (deleting a reading deletes its index rows) and is covered by self-tests.
--   * Storing a vector is NOT storing the document: the source text stays in the
--     existing reading tables. This table holds numbers plus a chunk id.
--
-- Additive and idempotent; migrations 0001–0033 are untouched.

create table if not exists public.reading_chunk_embeddings (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id   uuid not null,
  chunk_id      text not null,                 -- '<documentId>:c<n>' (stable)
  chunk_order   integer not null default 0,
  content_hash  text not null,                 -- re-embed only on real change
  provider      text not null,
  model         text not null,
  dimensions    integer not null,
  vector        jsonb not null,                -- compact float array
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reading_chunk_embeddings_doc_idx
  on public.reading_chunk_embeddings (user_id, document_id, chunk_order);
-- One embedding per chunk per user: makes indexing idempotent + resumable.
create unique index if not exists reading_chunk_embeddings_chunk_idx
  on public.reading_chunk_embeddings (user_id, document_id, chunk_id);

alter table public.reading_chunk_embeddings enable row level security;

do $$
begin
  drop policy if exists reading_chunk_embeddings_select on public.reading_chunk_embeddings;
  drop policy if exists reading_chunk_embeddings_insert on public.reading_chunk_embeddings;
  drop policy if exists reading_chunk_embeddings_update on public.reading_chunk_embeddings;
  drop policy if exists reading_chunk_embeddings_delete on public.reading_chunk_embeddings;
  create policy reading_chunk_embeddings_select on public.reading_chunk_embeddings for select using (auth.uid() = user_id);
  create policy reading_chunk_embeddings_insert on public.reading_chunk_embeddings for insert with check (auth.uid() = user_id);
  create policy reading_chunk_embeddings_update on public.reading_chunk_embeddings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  create policy reading_chunk_embeddings_delete on public.reading_chunk_embeddings for delete using (auth.uid() = user_id);
end $$;
