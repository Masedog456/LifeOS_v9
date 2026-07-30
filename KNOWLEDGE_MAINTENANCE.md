# Knowledge Maintenance & Integrity (LIFEOS-038)

Knowledge decays. Projects end, ideas duplicate, beliefs change, documents go
out of date, relationships disappear. This layer gives LifeOS **deterministic
maintenance tools that preserve integrity without deciding for the user.** It
answers:

> What needs maintenance? What became stale? What is duplicated? What has no
> relationships? What references no longer exist? What evidence supports this?
> What should I consciously archive?

**The system identifies candidates; the user decides.** Every projection is a
pure function of `StoreState`. There is no AI, no embeddings, no automatic
classification, no automatic rewriting, no assistants, no semantic search, no
automatic merges or repairs, and no productivity scores. Knowledge is preserved
through **conscious review**.

---

## 1. Where the code lives

```
lib/maintenance/
  integrity.ts     buildMaintenanceIndex (the ONE shared indexed pass) +
                   existence, citation/reference indexes, archive/review state,
                   orphan projections (orphanConcepts/Documents/Beliefs)
  duplicates.ts    deterministic duplicate CANDIDATES (title/normalized/url/
                   isbn/doi/identifier/alias) + stable duplicateId()
  relationships.ts relationship integrity (missing parent/child, broken
                   backlinks, dangling planning/focus/citation, orphan sessions,
                   invalid milestones) — REPORT ONLY
  citations.ts     citation integrity (duplicate / missing target / deleted
                   location / invalid owner) + repair affordances
  evidence.ts      evidence review (uncited beliefs, outdated citations,
                   research without sources, unreferenced docs, notes without
                   context) + research integrity (Feature 10)
  archive.ts       archive candidates + archived-items + archive-state
  review.ts        the unified review queue (aggregator) + inactiveProjects
  dashboard.ts     Knowledge Health — 10 deterministic counts, no score
  staleness.ts     last reviewed/edited/referenced/cited/opened + neutral `ago`
  merge.ts         deterministic merge PREVIEW (preserve history/citations/
                   backlinks/ids; never delete; never destroy evidence)
  history.ts       compact append-only MaintenanceEvent helpers
  merge-rules.ts   sync conflict rules (events union; decisions/archive conflict)
  preferences.ts   prefs.maintenance (filters, dismissed, ignored-dup mirror)
  search.ts        maintenance filter ref-key sets (Feature 14)
  record.ts        per-record health for the inspector (Feature 11)
  selftest.ts      85 deterministic assertions

components/maintenance/
  KnowledgeHealth.tsx      the dashboard (Feature 1)
  DuplicateReview.tsx      duplicate candidates → merge / ignore (Feature 2)
  RelationshipIntegrity.tsx report + "mark repaired" (Feature 3)
  EvidenceReview.tsx       evidence + research integrity (Features 4 & 10)
  MaintenanceQueue.tsx     the review queue + reason filter (Features 5 & 14)
  CitationIntegrity.tsx    citation issues + remove-citation repair (Feature 9)
  ArchiveReview.tsx        candidates + archived list + restore (Feature 7)
  MergeWorkspace.tsx       pick primary, preview, confirm merge (Feature 8)
  HealthInspector.tsx      inspector maintenance surface (Feature 11)
  PlanningMaintenanceHint.tsx  the planning-board hint (Feature 15)

app/maintenance/page.tsx            the dashboard
app/maintenance/review/page.tsx     the review queue (Suspense — useSearchParams)
app/maintenance/duplicates/…        duplicates
app/maintenance/evidence/…          evidence + research
app/maintenance/relationships/…     relationship integrity
app/maintenance/citations/…         citation integrity
app/maintenance/archive/…           archive review
app/maintenance/merge/…             merge workspace
app/dev/maintenance-tests/…         runs runMaintenanceSelfTests() (dev route)
```

---

## 2. Data model

Only the user's **decisions** are persisted; everything else is derived on read.

### MaintenanceEvent (append-only, synced — `maintenance_events`)
The durable, compact record of every conscious decision. Never edited or
deleted; always unions on sync.

```ts
{ id, at, kind, ref: {kind,id}, relatedRef?, detail? }
```

`kind` ∈ reviewed · review_requested · archived · unarchived · merged ·
citation_added · citation_removed · relationship_repaired · duplicate_ignored ·
maintenance_resolved · dismissed (Feature 16).

**Archive state** and **last-reviewed** are folded from this log (latest wins) —
no columns are added to any existing table.

### DuplicateCandidate (decision, synced — `duplicate_candidates`)
Duplicate groups are DERIVED; only a user decision (`ignored` / `merged`) is
persisted, keyed by a **stable deterministic id** (`hash(reason + sorted member
keys)`), so the same group found on two devices resolves to ONE row.

```ts
{ id, reason, kind, members: RecordRefLite[], key, status, createdAt, updatedAt, history }
```

### Preferences (`prefs.maintenance`, Feature 17)
Review filters, sort, dashboard layout, dismissed review-item ids, and a fast
mirror of ignored duplicate ids. `dismissed` and `ignoredDuplicateIds` union
across devices.

---

## 3. Determinism & the "never decides" rule

- **Knowledge Health** (Feature 1) reports **10 counts** — orphan entities /
  documents / beliefs, uncited claims, duplicate candidates, archived items,
  unresolved maintenance items, inactive projects, stale research, broken
  references. Each links to the records behind it. **Never a hidden score, never
  a grade, never "healthy/unhealthy".**
- **Duplicate detection** (Feature 2) is exact-signal only — same title, same
  normalized title, same URL, same ISBN/DOI/identifier (parsed from provenance),
  or a manually-chosen shared alias. **Never fuzzy, never AI, never
  auto-merged.**
- **Relationship integrity** (Feature 3) and **research integrity** (Feature 10)
  are **report-only**. **Staleness** (Feature 6) states age as a fact —
  "Last reviewed 9 months ago." — **never** "Needs update".
- **Archive** (Feature 7) and **merge** (Feature 8) always require an explicit
  click; archiving is reversible and deletes nothing; a merge preserves
  history/citations/backlinks, keeps the primary's id, archives losers
  (reversible), and **never destroys evidence**.

---

## 4. The shared index (performance)

`buildMaintenanceIndex(state)` does ONE pass: existence `Set`s per kind,
citations grouped by record and document, an incoming-reference `Set` (for
orphan detection), archive/last-reviewed folded from events, and the decided-
duplicate id set. Every projection reuses it, so orphan/citation/relationship
scans are O(records) with O(1) lookups — never O(records²).

---

## 5. Integrations

- **Inspector** (Feature 11) — `<HealthInspector>` shows health indicators,
  staleness, review + maintenance history, citation/relationship integrity,
  archive status, duplicate candidates, and manual actions (review / flag /
  archive / restore).
- **Command center** (Feature 12) — Open Knowledge Health · Review Queue ·
  Review Duplicates · Review Evidence · Repair Relationships · Review Citations ·
  Archive Candidates · Merge Records.
- **Daily review** (Feature 13) — reports the maintenance decisions made that
  day (reviewed / archive decisions / merges / citation repairs / resolved). It
  **never injects maintenance work into Today.**
- **Search** (Feature 14) — `maintenanceFilterSets` provides ref-key sets for
  needs-review / orphan / duplicate / archived / uncited / inactive /
  maintenance-resolved; the review queue filters by reason.
- **Planning** (Feature 15) — the board shows a compact hint (review count,
  inactive projects, archive candidates) that only LINKS to maintenance; it
  **never moves a card.**

---

## 6. Sync

Layered on the LIFEOS-033 engine; deletes tombstoned under `maintenanceEvents` /
`duplicateCandidates`. Overriding rule: **never silently lose maintenance
history.**

| Situation | Resolution |
|---|---|
| Maintenance events on two devices | **union by id** (history never lost) |
| Dismissed / ignored id lists | **union** (order-independent) |
| Repair / archive events | union (append-only) |
| Same duplicate decided differently (ignored vs merged) | **conflict** — keep local, flag |
| Archive vs restore of the same record | latest-`at` wins; **flagged** when they disagree; both events kept |
| Merge vs delete / repair vs remove | events union; the decision survives |

---

## 7. Testing & performance

- **Unit** — `runMaintenanceSelfTests()`: **85 assertions** across index,
  orphans, duplicates, citation & relationship integrity, evidence & research
  review, archive, review queue, inactive projects, staleness, history dedup,
  merge preview, sync conflict rules, per-record health, projection purity, and
  performance. Dev route `/dev/maintenance-tests`.
- **E2E** — `maintenance.mjs`: **27 checks** (dashboard metrics, review
  duplicates, merge, ignore-persists, repair citation, archive + restore, review
  queue + reason filter + dismiss-persists, merge workspace, evidence,
  relationships, command center, inspector, daily review, planning hint,
  offline persistence, mobile).
- **Performance** (self-test §17, fixture: 20k beliefs / 4k documents / 10k
  citations / 3k concepts / 2k events) — index build **< 250 ms**, dashboard
  **< 400 ms**, duplicate detection **< 300 ms**, review queue **< 500 ms**. All
  comfortably under target on the shared index.
- **Migration** — full chain `0001–0029` applies idempotently 3× on Postgres 16;
  defaults, indexes, RLS (4 policies/table), and cross-user isolation verified;
  soft references keep every projection orphan-safe.

---

## 8. What this feature deliberately does NOT do

No AI, LLMs, agents, embeddings, or semantic search. No automatic
classification, rewriting, merging, or repair. No automatic decisions of any
kind. No credibility or productivity scores, no grades, no "needs update"
verdicts. No assistants. Age is a fact, not a judgment; the user always decides.
