# Reading Upload & Document Ingestion (LIFEOS-047)

> How a file, a link, or pasted text becomes a document you can read, highlight,
> annotate, ask about, summarize, study, and connect to your knowledge — without
> a parallel document system, without cloning anyone's UI, and without ever
> fabricating a citation, a page number, a summary, or document content.

This document covers the **native reading upload** path. It sits ON TOP of the
existing reading library (`lib/library/`, the Reader at `/document/[id]`) and the
existing single-object ingestion shape (`INGESTION.md`). It does not replace
either. The source stays primary; the user's judgment stays primary; AI assists.

---

## 1. The canonical flow

```
Reading  →  + Add reading  →  Upload a file / Add a link / Paste text
         →  Process (extract text + preserve provenance)
         →  Open in the existing Reader
         →  Read · Highlight · Annotate
         →  Ask · Summarize · Study   (grounded in THIS document)
         →  Save to LifeOS            (note / question / research / belief)
         →  Connect to knowledge      (citation home preserved)
```

One obvious primary action on `/reading` — **`＋ Add reading`** — opens a single
panel with three tabs: **Upload a file**, **Add a link**, **Paste text**
(`components/reading/AddReadingPanel.tsx`). Desktop supports drag-and-drop; mobile
uses the native file picker. Everything lands as a normal `ReadingDocument` in the
existing library and opens in the existing Reader.

## 2. What can be added today (and what's architected for later)

| Method | Formats today | Architected for later |
| --- | --- | --- |
| Upload | PDF (text), TXT, Markdown | DOCX text extraction, EPUB, PPTX, audio/video transcripts |
| Link | URL kept as provenance; text pasted alongside | Server-side fetch/readability extraction |
| Paste | plain text, Markdown | — |

Format detection (`detectFormat`) and validation (`validateUpload`) live in
`lib/reading/ingest.ts`. Unsupported types are refused with a friendly reason
("…try 'Paste text' instead"), never a silent failure. DOCX is detected and
accepted by the picker but, until real extraction ships, the user is told
plainly that Word files aren't readable *yet* and offered the Paste path — we
never fake a successful import.

## 3. Ingestion pipeline & provenance

Extraction preserves structure and origin:

- **PDF** — `lib/ingestion/pdfExtract.ts` (`extractPdf`) returns extracted text,
  a `PageSpan[]` page map (character offsets per page), and a page count. Normal
  text PDFs extract cleanly. Scanned/image PDFs are **detected** (too few
  characters per page) and reported honestly ("This looks like a scanned
  document…") rather than imported as empty. Encrypted and corrupt PDFs are
  caught and explained. OCR is a future increment, not a silent gap.
- **TXT / Markdown** — read on-device via `File.text()`; Markdown headings become
  sections, paragraphs become passages (the existing deterministic parser).

Page provenance is preserved end-to-end. `assignPages(parsed, fullText, pageMap)`
maps each passage's character offset back to its real PDF page — and if a passage
can't be located it falls back to the last known page rather than **inventing**
one. `assembleDocumentFromParsed` (`lib/library/documents.ts`) builds the
`ReadingDocument` directly from the parsed sections/passages so `page` survives
(the string-based `assembleDocument` re-parses and would lose it).

Provenance is stored additively on the document's `sourceMetadata` (jsonb —
no migration needed): `addMethod`, `uploadFormat`, `filename`, `mimeType`,
`sizeBytes`, `contentHash`, `url`, `pageCount`, `uploadedAt`, `processingState`,
`originalStored`.

## 4. Honest processing states

`ProcessingState = "uploading" | "processing" | "ready" | "needs_attention" | "failed"`,
with an explicit transition guard (`canTransition`) and `isRetryable`. The panel
shows each state in plain language and a spinner only while genuinely working.

- A stored original is **never removed on failure**; the user can **Retry**.
- Empty or scanned text (below `MIN_READABLE_CHARS`) resolves to
  **needs_attention** with an honest explanation — never a fake "Ready".

## 5. Duplicate detection

Content is hashed with a whitespace-stable hash (`contentHash`, built on
`lib/hash.ts`). Before adding, `findDuplicate` checks the library by hash. On a
match the user sees **"Already in your library"** with **Open existing** or
**Upload another copy** — nothing is silently discarded or auto-merged. The
storage migration also enforces a per-user unique index on `checksum` server-side.

## 6. The Reader (reused, not rebuilt)

Uploads open in the existing three-pane Reader: navigation, passage reading with
character-span highlights, notes, linked knowledge, progress, and the existing
passage→capture/belief/concept/question/research/synthesis conversions — each of
which already writes a `Citation` back to the exact passage. LIFEOS-047 adds no
parallel reader.

## 7. Ask · Summarize · Study (restrained, grounded)

`components/reading/StudyPanel.tsx` (logic in `lib/reading/study.ts`) is hidden
until the reader opens it with **✦ Ask & study**. It sits *under* reading:

- **Ask** — `askDocument` retrieves the most relevant passages of THIS document
  (`retrieve`, deterministic lexical ranking), sends only those to the AI seam
  within a character budget (`buildContext`, `CONTEXT_CHAR_BUDGET = 8000` — the
  whole book is never sent), and returns the answer with **grounded citations**.
  If nothing relevant is retrieved, it says the document doesn't cover that and
  offers **no** citations — it never answers from general knowledge dressed up as
  document-grounded.
- **Summarize** — the whole document or the current section, drawn strictly from
  the source, with the passages it used listed as citations.
- **Study** — deterministic, **on-device** key ideas, self-test questions, and
  flashcards, each linked to a real passage. Nothing here becomes a belief or
  edits Knowledge on its own.

**Citations are never parsed out of the model.** They are built from the real
locations of the retrieved chunks (`groundedCitations` → `documentId`,
`sectionId`, `passageId`, `page`), so a page reference like "*Being and Time*, p.
167" is always a real page and is clickable straight to the passage.

### Document chat architecture

`chunkDocument` produces one stable chunk per passage carrying its real location.
Retrieval is deterministic and strictly scoped to the user's own document.
Context is assembled from retrieved chunks only. This is the seam where live
embeddings + a vector store slot in later without changing the grounding contract
— the citation mapping stays deterministic either way.

## 8. Save to LifeOS

From a grounded answer, summary, or key idea, **Save to LifeOS** reuses the
existing creators via `convertPassage(docId, passageId, target, { text, title })`
and `addAnnotation` — so anything saved keeps a **citation home** on the exact
passage it came from. Options: **Save as note**, **Save as question**, **Save to
Research**, **Propose as belief**. Nothing is auto-added; the user chooses.

## 9. Privacy — uploading vs. AI analysis

These are conceptually separate and documented as such in the UI:

- **Uploading / parsing / studying (Study tab)** happen **on your device**.
- **Ask and Summarize** send only the *relevant passages* of the one open
  document to your configured AI provider — never the whole library, never other
  documents. When no provider is configured, answers are produced by an on-device
  deterministic draft, and the panel says which of the two produced the result.

See `SECURITY_AND_PRIVACY.md` for the data-flow statement and the per-user
isolation guarantees.

## 10. Storing the original file (LIFEOS-047A — implemented)

Parsed text, page provenance, highlights, and notes persist in the
`reading_documents` row. When you upload a file and are signed in with remote
sync configured, the **original binary is now privately preserved** too:

- a **private** storage bucket `reading-originals` (never public, 25 MB;
  migration `0032`);
- per-user object isolation — objects live at `<uid>/<documentId>/<file>` and
  `storage.objects` RLS restricts every operation to `auth.uid()`'s own prefix,
  so User A can never read, list, write, or delete User B's files;
- a `reading_document_files` metadata table (checksum, size, content type,
  state — **never** the file's text), RLS-scoped and cascading only from the
  owning `auth.users` row. Its checksum index is **non-unique per user**
  (migration `0033`) so "Upload another copy" is never blocked.

**Lifecycle** (`lib/reading/originals.ts` orchestration + `backupManager.ts` glue):

1. Text extraction and `ReadingDocument` creation stay the **fast path** — the
   reader opens immediately.
2. In the background the original is uploaded to a **deterministic** path, then
   its metadata row is written. `sourceMetadata.originalStored` becomes `true`
   **only after both succeed** — never optimistically.
3. If the upload fails, the reading is kept and the reader shows *"Your reading
   was added, but the original file wasn't backed up"* with an in-session
   **Retry** (the picked file can't survive a reload, so retry-after-failure is
   session-scoped — an honest limitation).
4. If the metadata write fails after a good upload, the just-written object is
   removed so no orphan is left; the deterministic path means a retry simply
   overwrites in place.

**Cross-device.** `originalStored` and the storage path ride on the document's
`sourceMetadata` (jsonb), which syncs like any document field. Another signed-in
device for the same user resolves the original by looking it up in
`reading_document_files` and minting a **short-lived signed URL** — private
access only, never a public URL, never another user's path. **Large binaries are
never placed in `localStorage`;** RLS is never weakened and the bucket is never
made public.

## 11. Delete & export

Deletion uses the existing impact-preview confirmation (`buildImpact` +
`ConfirmDialog`) — highlights, notes, and derived records are shown before
removal; beliefs/concepts made from the document are kept (only their citation
home goes). When an original is stored, removal cleans up **only that document's
own folder** (`<uid>/<documentId>/`, covering any orphaned partial upload) and
its metadata rows — path- and RLS-scoped, so it can never touch another
document's or another user's file. If that cleanup can't complete, the reading is
**not** deleted and an honest error is shown, rather than orphaning the file or
pretending cleanup happened. Export includes the document and its provenance
through the existing backup.

## 12. Search

Uploaded documents are ordinary `ReadingDocument`s, so they appear in the existing
library search and command palette with no separate index.

## 13. Testing

Self-tests live in `lib/reading/selftest.ts` (`runReadingIngestSelfTests`) and are
surfaced at `/dev/reading-ingest-tests` (`#reading-ingest-selftest-summary`) for
the regression harness. **58 assertions** cover: format detection, upload
validation, whitespace-stable duplicate hashing, PDF page provenance (including
the never-invented fallback), the processing-state machine, honest ingestion of
scanned/empty text, chunking with real locations, deterministic retrieval,
grounded citations, the context budget, summarize scoping, generated study
material, and — over an in-memory backend that mimics per-user RLS — original-file
upload + metadata, `originalStored` truthfulness, storage-fails / metadata-fails
ordering with orphan cleanup, retry after failure, private signed-URL retrieval,
cross-user isolation (User B can't see/retrieve/delete User A's original),
same-user "Upload another copy", correct-target deletion, and orphan cleanup.
Live-backend security (real per-user isolation) is additionally covered by
`audit:rls`, the authorization audit registry, and the migration rehearsal's live
two-user probe.

## 14. Key modules

| Concern | Module |
| --- | --- |
| Format/validation/provenance/dedup/state machine | `lib/reading/ingest.ts` |
| Grounding, retrieval, citations, Ask/Summarize/Study | `lib/reading/study.ts` |
| Self-tests | `lib/reading/selftest.ts` |
| PDF extraction | `lib/ingestion/pdfExtract.ts` |
| Document assembly (provenance-preserving) | `lib/library/documents.ts` (`assembleDocumentFromParsed`) |
| Store action | `lib/mvpStore.ts` (`createReadingFromParsed`) |
| Add-reading UI | `components/reading/AddReadingPanel.tsx` |
| Study UI | `components/reading/StudyPanel.tsx` |
| Original-file persistence (orchestration + seam) | `lib/reading/originals.ts` |
| Backup manager (in-session File + retry) | `lib/reading/backupManager.ts` |
| Original-file status + safe removal UI | `components/reading/OriginalStatus.tsx` |
| Storage + RLS | `supabase/migrations/0032_reading_document_files.sql`, `0033_reading_files_checksum_index.sql` |

## 15. What Reading upload deliberately does NOT do

- No parallel document system — everything is a `ReadingDocument`.
- No cloned third-party UI.
- No gimmicky AI — Ask/Summarize/Study are restrained and subordinate to reading.
- No fabricated citations, page numbers, summaries, or content.
- No public URLs for originals — private access via short-lived signed URLs only.

Intentional deferrals (documented, not faked), unchanged by LIFEOS-047A:

- **Embeddings** — deterministic lexical retrieval today; the seam is ready.
- **OCR** — scanned PDFs are detected and reported honestly, not extracted.
- **DOCX extraction** — detected and honestly deferred to Paste.
- **EPUB / PPTX / audio / video** — declared as future formats; not yet ingested.

> LIFEOS-047A completed the one item 047 had listed as deferred here — *live
> binary upload* — so uploaded originals are now genuinely, privately preserved.
