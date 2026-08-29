# LIFEOS-075 — Cross-Device Sync & File Integrity

**North star: if I save it on one device, I can trust it on another.**

Two P1s are fixed. One of them meant a second device could show a person
nothing at all while the indicator read "Saved".

---

## 0. What is proven, and how — read this before the tables

Three kinds of evidence appear below, and they are never mixed.

| Kind | What it means | Where |
|---|---|---|
| **Deterministic** | The real adapter, the real adoption path, the real row mappers and the real file-integrity module, driven in Node against an in-memory backend that enforces per-user path ownership. | 134 assertions |
| **Browser** | Two separate Playwright BrowserContexts — separate storage partitions, separate JS realms, separate store singletons. Isolation is proved before anything is built on it. | 135 assertions |
| **Real PostgreSQL** | The full migration chain 0001→0044 applied three times to a throwaway PostgreSQL 16. | 109 checks |

**What is NOT proven: a live deployed two-client run.** This environment holds
no Supabase credentials and no CLI (`env | grep -i supabase` → 0 results; only
`.env.example`). So the app runs local-only here, and the *transport* between
Device A and Device B in the browser harness is simulated: the exact bytes A
wrote to its own storage are carried into B's storage, which is what a remote
round trip would deliver. Everything on both sides of that hop is real.

That is deterministic evidence about two-device behaviour. It is not a live
claim and is nowhere described as one. **§9 of the brief remains unrun.**

---

## 1. The contract (§2)

> A user uploads or creates something on Device A. What must happen before
> Conqify may imply "this is available on your other devices"?

Five states, deliberately distinct. Collapsing them into one `saved` boolean is
what produced most of this sprint's findings.

| State | Means | Conqify may say |
|---|---|---|
| **Local durability** | written to this device's storage; `writeLocal` returned without throwing | "Saved locally" |
| **Remote durability** | every dirty domain confirmed by the server in one push, zero failures | "Synced" |
| **Cross-device availability** | remote durability **plus** the record surviving a cold adoption on a second device | implied by "Synced" |
| **Blob availability** | a signed URL for the stored original resolves *now* | "Original safely stored" |
| **Derived-content readiness** | extracted text is a passage row and syncs. The semantic index is **not** built in production | nothing — see §7 |

**Conqify may imply cross-device availability only when remote durability is
confirmed for every dirty domain.** A partial push reads "Sync incomplete", never
"Synced". A blob claim additionally requires the object to resolve — a metadata
row is not evidence that bytes exist.

## 2. Sync vocabulary (§3, §14)

| State | Label | Meaning |
|---|---|---|
| `local` / `disabled` | Saved locally | on this device; no remote durability claimed |
| `syncing` | Syncing… | the local write already finished; the remote copy is in flight |
| `synced` | **Synced** | remote persistence confirmed for every dirty domain |
| `incomplete` | Sync incomplete | some domains landed, some did not |
| `failed` | Sync failed | remote durability not confirmed |
| `offline` | Offline — saved locally | explicit, not an error |
| any + `localError` | **Local save failed** | outranks everything; the in-memory change did not reach disk |

Changed here: `synced` was **"Saved"** and `syncing` was **"Saving…"**. The set
read backwards — the weaker state ("Saved locally") carried the longer, more
reassuring phrase, and the strongest state was the vaguest word in the set.

## 3. Defects

| ID | Sev | Finding | Status |
|---|---|---|---|
| C-1 | **P1** | A cold second device could adopt nothing | **FIXED** |
| C-2 | **P1** | A deleted reading came back, pointing at deleted bytes | **FIXED** |
| C-3 | P2 | A stored original could not be opened on any device | **FIXED** |
| C-4 | P2 | The file checksum described the words, not the file | **FIXED** |
| C-5 | P3 | Transient upload state travelled to other devices | **FIXED** |
| C-6 | P3 | On a phone, a healthy state gives no durability answer | **REPORTED** |

**No open P0 or P1.**

### C-1 — a cold second device could adopt nothing

`hasData()` decided whether a remote snapshot was worth adopting by inspecting
four domains — `sources`, `beliefs`, `captures`, `proposals` — the whole store as
it stood when the check was written. Persistence has synced 46 domains for many
sprints.

So a person whose Conqify life is actions, projects, goals, notes, events and
readings, and who never once opened Quick Capture, had a remote snapshot that
read as **empty**. A cold second device took the `migrate-local` branch,
installed its own empty state, and showed them nothing — under a "Saved"
indicator. Reachability is real: `addCapture` is called from exactly two places,
Quick Capture and the `/welcome` tour; adding actions directly never creates one.

The repair is **fewer lists, not a longer one**. `STORE_DOMAINS` is already the
canonical enumeration — `upgradeState` treats it as the restore allow-list, and
LIFEOS-052 fixed this exact defect class there when nine execution domains fell
behind and a restore silently dropped every next action. `snapshotHasData()`
derives from it; `normalize()` and the sync self-test's empty-state builder now
derive from it too, deleting two more hand-maintained copies. A parity guard
fails the build if `SYNC_DOMAIN_ORDER` ever leaves it, and was verified to go red
on real drift.

### C-2 — a deleted reading came back, pointing at deleted bytes

`reading_documents` was the **only** row-level delete in the adapter with no
tombstone. Deleting a book removed the row and the stored original; a second
device still holding it read it as local-only, pushed it back, and the deleting
device re-adopted it — carrying `originalStored: true` and a storage path whose
bytes were already gone. That is D-24's shape landing directly in the
metadata-without-blob state, permanently.

One tombstone, on the **parent**. Sections, passages, highlights and annotations
are nested inside the ReadingDocument object locally, so suppressing the document
takes the whole tree; server-side all four child tables plus `document_citations`
are `references public.reading_documents(id) on delete cascade`. That assumption
is **proved, not asserted** — the rehearsal builds a reading with all five child
kinds, deletes only the parent, and counts zero survivors. Citations follow their
document for the same reason completions follow their action.

`reading_document_files` does **not** cascade (`document_id` carries no foreign
key, by the 0027 soft-reference doctrine), so the app deletes it explicitly. That
is proved too, in the same rehearsal.

### C-3 — a stored original could not be opened on any device

`resolveOriginalUrl` had existed since LIFEOS-047A with **no production caller**:
the reader said "✓ Original safely stored" and offered no way to open it, on any
device. `reading_document_files` was therefore INSERT+DELETE only in production.

The reader now resolves a fresh short-lived signed URL on open and never persists
it — a 60-second credential-bearing link written into synced document metadata
would be dead on arrival everywhere. It also **verifies the object resolves
before claiming safety**: metadata without a blob now reads "The original file is
no longer in storage", and a transient storage error reads "We couldn't check the
original just now" — two different sentences, because they are two different
facts.

### C-4 — the file checksum described the words, not the file

`reading_document_files.checksum` held `contentHash` — FNV-1a, 32 bits, over the
**extracted text**. Two different PDFs that extract to the same words collided; a
blob that came back truncated or altered was undetectable, because nothing
recorded described its bytes.

It now holds **SHA-256 of the raw bytes**. `contentHash` keeps its own job. They
are never compared to each other:

```
TEXT CONTENT HASH  → contentHash   → duplicate detection
RAW FILE CHECKSUM  → sha256Hex     → integrity verification
```

Legacy rows are classified by shape (64 lowercase hex vs anything else) and
reported **unverifiable** — not "verified", which would be a lie, and not
"corrupt", which would be a different lie. They are never rewritten into
fabricated byte checksums. Where Web Crypto is unavailable we store no checksum
rather than a weaker digest that would look like a guarantee.

**No migration.** `checksum` is `text`; the rehearsal confirms a full 64-character
digest is accepted.

### C-5 — transient upload state travelled

`originalBackup: "uploading" | "failed"` describes one browser tab holding one
in-memory `File`. It lived in the same synced `source_metadata` blob as durable
provenance, so a second device could render "Uploading original…" indefinitely
for an upload happening — or long dead — elsewhere, beside a Retry that could not
work. Stripped on the way to the server, and gated on session ownership in the
UI, which fixes the same-device-after-reload case too.

### C-6 — on a phone, a healthy state gives no durability answer *(reported)*

LIFEOS-074 D-21 made the indicator `hidden sm:flex` for calm states and always
visible for alarming ones: a phone shows failures and hides reassurance. That is
deliberate and it works — "Sync incomplete", "Sync failed" and "Local save
failed" are all visible at 390px, and measured so here.

But §27 asks that a person be able to answer *"is this only on this device, or is
it safe in the cloud?"* from the app shell, and on a phone in a healthy state they
currently cannot: the element is `display: none`, 0×0. Both halves are asserted
as they actually behave.

**Not repaired, because repairing it reverses an accepted 074 decision about
mobile layout.** That is the user's call, not this sprint's.

## 4. Observations — not defects

**O-1 — prose-only attribution cannot separate external AI from Conqify AI.**
`attributionPrefix("external_ai", …)` writes "_AI-generated — …:_" into the body,
and `detectAttribution` reads that back as `conqify_ai`; the
`imported_user_authored` marker is not recognised at all and falls through to
`user_authored`. This is a property of the provenance layer at authoring time and
**predates 075**. Crucially, the classification is *identical before and after a
device hop*, which is what §18 asks for, so it is reported rather than filed.

**O-2 — the semantic index is not built in production.** `indexDocument` has no
production caller, `reading_chunk_embeddings` is never populated, and retrieval
never loads a vector. Per §13 this was **deliberately not wired**. It is now a
named entry in the wiring register, which fails if it is quietly wired without
retiring the entry.

## 5. The matrix (§36)

### Records × lifecycle

| | create | edit | delete | reload | cold start | offline | failure | conflict |
|---|---|---|---|---|---|---|---|---|
| Action (dated) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Action (recurring + time) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Action (waiting) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Action (deferred) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Event | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Note | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Project / Goal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Planning assignment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Dependency edge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Recurrence completion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Reading document | ✓ | ✓ | **✓ (C-2)** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Citation | ✓ | ✓ | **✓ (C-2)** | ✓ | ✓ | ✓ | ✓ | — |

### Files × dimension

| | metadata | blob | checksum | extraction | relationship | ownership | delete | retry |
|---|---|---|---|---|---|---|---|---|
| Upload on A | ✓ | ✓ | **✓ SHA-256** | ✓ | ✓ | ✓ | ✓ | ✓ |
| Visible on B | ✓ | **✓ (C-3)** | ✓ | ✓ | ✓ | ✓ | ✓ | n/a |
| Blob missing | ✓ | **reports missing** | n/a | ✓ | ✓ | ✓ | ✓ | n/a |
| Metadata missing | **no orphan** | cleaned up | n/a | ✓ | ✓ | ✓ | ✓ | ✓ |
| Interrupted upload | not stored | no orphan | n/a | ✓ | ✓ | ✓ | ✓ | ✓ |
| Legacy checksum row | ✓ | ✓ | **unverifiable** | ✓ | ✓ | ✓ | ✓ | n/a |

### Deletion propagation

| Step | Behaviour |
|---|---|
| A deletes reading X | row deleted, blob + file metadata removed, `documents` tombstone written |
| tombstone write fails | domain fails → **"Sync incomplete"**, retryable; the delete is not rolled back |
| B adopts, holding stale X | suppressed **before** reconcile; citations pruned with it |
| B pushes | X is not local-only, so it is never written back |
| A reloads | X stays deleted |
| B edits X **after** the delete | kept — genuine resurrection intent, unchanged rule |

**The race window is unchanged and is not closed.** Between a successful remote
delete and a successful tombstone write there is no marker, so a stale client
adopting inside that window still resurrects the record. Sync reads "Sync
incomplete" throughout and the retry closes it. **Deletion propagation is not
transactionally atomic and must not be described as such.**

### Conflicts (§16) — measured, not changed

D-8 stays accepted debt; the live strategy is last-write-wins per row.

| Scenario | What happens | What is lost |
|---|---|---|
| A edits title, B edits later | B's value stands | A's title |
| B's edit arrives **first** despite a later `updatedAt` | **A's value stands** — arrival order decides, not `updatedAt` | B's title |
| A edits body, B edits body | one row, one winner | the loser's body **and its history entry**, which is a column on the same row |
| A completes, B defers a stale copy | last arrival stands | the other transition |
| A deletes, B edits an older copy | delete wins | B's edit |
| A deletes, B edits **after** | B's edit wins | the deletion |

No version column, no compare-and-set, no warning to the user. `merge.ts` /
`conflicts.ts` are not consulted on this path.

## 6. Performance (§38)

| Cold adoption | Time |
|---|---|
| 100 records | <1 ms |
| 1,000 records | <1 ms |
| 5,000 records | <1 ms |

| File | SHA-256 | store | verify |
|---|---|---|---|
| 16 KB | 0 ms | 0 ms | 0 ms |
| 1 MB | 3 ms | 0 ms | 2 ms |
| 8 MB | 16 ms | 0 ms | 17 ms |

Hashing is linear and adds ~2 ms/MB to an upload that is already network-bound.
The 25 MB per-object bucket limit is unchanged; nothing here justifies raising it.

## 7. Product claims (§31)

| Claim | Verdict | Evidence |
|---|---|---|
| Data I save on one device appears on another | **PASS** | 46-domain adoption; 13 field-for-field assertions; C-1 fixed |
| Files I upload on one device are usable on another | **PARTIAL** | metadata, checksum and signed-URL resolution all proved deterministically; **never exercised against deployed storage** |
| "Synced" means remote durability is confirmed | **PASS** | reached only on a zero-failure push; wording fixed |
| A remote failure never masquerades as full sync | **PASS** | partial → "Sync incomplete"; 8 rendered-indicator assertions |
| Deleting on one device does not normally resurrect on another | **PASS** | C-2 fixed; race window stated, not hidden |
| Conqify preserves provenance across devices | **PASS** | classification identical either side of the hop; see O-1 |
| Conqify does not expose one user's files to another | **PARTIAL** | path- and policy-enforced, proved structurally; **no live cross-user denial test** |
| Clearing local data does not erase remotely-synced life data | **PASS** | clear → empty → recover, desktop and mobile |

## 8. Evidence

| Gate | Result |
|---|---|
| Cross-device deterministic | **134/134** |
| Cross-device browser | **135/135** (67 desktop, 67 mobile) |
| Full regression | **4129/4129** across 42 suites |
| Migration rehearsal | **109/109** |
| Wiring register | **17/17** including the file-path chain |
| Release audit · security | 17/17 · PASS |

Migration head **0044**, unchanged. No schema change was required.

## 9. On this sprint's own tests

Six of this harness's first-run failures were **my own errors**, each verified
before being dismissed, and four would have been filed as cross-device data loss:

- `recurrence` uses `frequency`, not `kind` — the mapper was correctly rejecting my invalid rule
- `LifeEvent` uses `date`/`startTime`, not `startsAt`/`endsAt`
- `PlanningAssignment` uses `ref`/`horizon`, not `actionId`/`dayKey` — the mapper threw, and I read the empty result as a lost field
- provenance is **derived** by `classifyOrigin`, not a stored column
- a chip read while the browser sat on a different page
- a full page load while offline, which is a browser fact and not a durability finding

The deterministic harness now checks the push report **before** reading anything
back, so a mapper that throws can never again look like a lost field. That guard
exists because it was needed.

Every C-finding was additionally proved **red against the base commit's own
source**, read with `git show` rather than paraphrased, and the two new wiring
checks were verified to fail when their repairs are removed.
