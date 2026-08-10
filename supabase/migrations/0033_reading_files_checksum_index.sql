-- LIFEOS-047A — Correct the reading_document_files checksum index.
--
-- Migration 0032 created the checksum index as UNIQUE per user:
--   unique (user_id, checksum) where checksum is not null
-- That is wrong for this product. Duplicate detection is a per-user UX
-- affordance handled in the app (findDuplicate over the user's OWN library),
-- and LIFEOS-047 explicitly supports "Upload another copy" — a second reading
-- with identical bytes. A per-user UNIQUE checksum makes the second copy's file
-- metadata row un-insertable, breaking that legitimate flow. The checksum is a
-- lookup key, not a constraint.
--
-- Fix (smallest safe change): drop the UNIQUE index and recreate it as a plain
-- (non-unique) index for fast per-user checksum lookups. This also removes any
-- theoretical cross-user consideration outright — there is no uniqueness domain
-- to reason about. RLS is unchanged: every row is still scoped to auth.uid(),
-- so one user can never see another user's rows or checksums.
--
-- Additive and idempotent. No table, column, policy, or bucket is changed; only
-- the one index is replaced. Historical migrations 0001–0032 are untouched.

drop index if exists public.reading_document_files_checksum_idx;

-- Non-unique per-user checksum lookup (used to find a user's own prior copies).
create index if not exists reading_document_files_checksum_idx
  on public.reading_document_files (user_id, checksum) where checksum is not null;
