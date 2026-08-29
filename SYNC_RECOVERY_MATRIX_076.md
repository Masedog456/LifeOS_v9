# LIFEOS-076 — Sync Trust & Recovery

**North star: the user should always know whether their life is safe, where it
is safe, and what to do when sync goes wrong.**

Seven findings repaired. One new **P1** found by the conflict measurement, and
**not** repaired — its fix is exactly the D-8 architectural decision the brief
freezes.

---

## 0. Verdict

**LIFEOS-076 BLOCKED — F-1 (P1): a stale defer arriving after a completion
silently reopens the completed action and destroys its completion history, and
no app-only guard can prevent it.**

Everything else in the sprint is done and green. F-1 is reported for decision
rather than fixed, because fixing it requires stale-write protection at the
database — the schema gate §42 and the D-8 gate §18 both say STOP.

## 1. The state contract (§3, §12)

| State | Label | Means |
|---|---|---|
| `local` / `disabled` | Saved locally | durable on this device; no cloud durability claimed |
| `syncing` | Syncing… | the local write already finished; the cloud copy is in flight |
| `synced` | **Synced** | every dirty domain confirmed by the server |
| `incomplete` | Sync incomplete | some changes reached the cloud, some did not |
| `failed` | Sync failed | cloud durability not confirmed; recovery available |
| `offline` | Offline — saved locally | explicit, not an error |
| any + `localError` | **Local save failed** | outranks everything; the newest change is not on disk |

None collapsed. No "Saved", "All good" or "Up to date" anywhere.

## 2. Defects

| ID | Sev | Finding | Status |
|---|---|---|---|
| E-1 | P2 | The only recovery control was a 30×16 px tap target | **FIXED** |
| E-2 | P2 | "Local save failed" offered no action at all | **FIXED** |
| E-3 | P2 | Failure detail lived in a `title` tooltip and named a domain | **FIXED** |
| E-4 | P2 | No `role`, no `aria-live`, no `aria-label`, not focusable | **FIXED** |
| E-5 | P3 | `/recovery` could not show a sync failure | **FIXED** |
| E-6 | P3 | Sign-out with unsynced work was silent | **FIXED** |
| C-6 | P3 | Mobile calm states gave no durability answer | **FIXED** |
| O-3 | — | A fifth hand-maintained domain list in `resetStore()` | **FIXED** |
| **F-1** | **P1** | **Stale defer reopens a completed action and destroys its history** | **REPORTED — STOP** |
| E-7 | P3 | `/dev/sync-tests` mutates the real store (pre-existing since 074) | **REPORTED** |

### The affordance (E-1, E-3, E-4, C-6)

One button everywhere, opening a small popover.

- **Alarming states keep their label at every width.** LIFEOS-074 D-21
  established that; nothing here weakens it.
- **Calm states collapse to a dot on a phone** — a measured **44×44** target
  instead of `display: none`. The words return at `sm` and up.
- The popover carries what the tooltip used to hide: the state, what it means
  **in consequences**, the last confirmed sync when truthfully known, and the
  action that applies.

Measured on the rendered page at 390px and 1280px: every one of the eight states
is reachable, `aria-label` carries state *and* meaning, a polite live region
announces changes, Enter opens and Escape closes, and a focus ring is applied.
Colour is never the sole carrier — each state has distinct words.

The first version of the popover rendered at **left: −186** on a 390px screen —
half the durability answer hanging off the side of the phone C-6 exists for. It
is now pinned to the viewport below `sm`.

### Local save failure (E-2)

`retryLocalSave()` re-attempts the write of the state still held in memory. It
returns the real result: a failed retry leaves the alarming state up and says
so. It makes no remote claim, and it never tells the person to reload — reload
is precisely what would lose the change.

### Language (E-3, §24)

`title="goals failed"` is gone. "Some changes are only on this device." A scan
of every user-facing string in the component finds no domain, table, provider or
storage vocabulary.

### `/recovery` (E-5)

It read `getSyncStatus().conflicts` — part of the dormant D-8 subsystem whose
only writer in the entire codebase is a `/dev` button — so a person whose sync
was failing could follow "Recovery" and be told nothing needed recovery. It now
reads the same live health the indicator reads, and offers the same action.
**D-8 was not woken**; the conflict section is untouched and still shows nothing,
which is honest.

### Sign-out (E-6)

Warns when work has not reached the cloud, offers "Try syncing now" and "Sign
out anyway", never blocks, and never claims the changes are cloud-safe. Nothing
was ever discarded — `handleSession(null)` keeps local data — but the silence
let someone believe otherwise.

### Last successful sync (§5, §6, §11)

Persisted per device at `lifeos.lastSync.v1`. **No migration.** Written only when
zero domains failed; never on incomplete, failed, or a local-only save. Never
pushed — it describes this device's relationship with the server, not the user's
life. A malformed or future value is omitted rather than displayed. It survives a
reload; with no value the popover simply shows "Synced".

The old code minted a timestamp inside `setHealth` on *any* transition into
"synced" — including the adoption path, where nothing had been pushed.

## 3. The measured conflict cost (§15–§21)

Every row below was produced by driving the real adapter with two device states.

| Case | Winner | Controlled by | What is lost | Warned? | Class |
|---|---|---|---|---|---|
| Note title | last arrival | **arrival order** | the other title | **no** | benign LWW |
| **Note body (prose)** | last arrival | arrival order | **an entire authored body** | **no** | **POTENTIAL DATA LOSS** |
| **Complete vs stale defer** | **the stale defer** | arrival order | **the completion AND its history** | **no** | **SEMANTIC — F-1** |
| Reschedule vs clear date | last arrival | arrival order | the new date | **no** | semantic |
| Delete vs stale edit | delete once the marker lands; the edit before it | tombstone + `updatedAt` | the edit, or the deletion inside the window | **no** | semantic (race window) |
| Project relation | last arrival | arrival order | the other relation | **no** | benign LWW |

Arrival order decides, **not** `updatedAt`: an edit with an older timestamp wins
if its push lands second. There is no version column, no compare-and-set, and
`merge.ts` / `conflicts.ts` are not consulted on the write path.

### F-1 — the one that is not acceptable

```
A completes "File the return"   at 09:00
B, holding a copy from 08:30, defers it; B's push arrives SECOND

result: status = deferred
        completed_at = null
        the "completed" history entry = gone
```

A finished thing becomes unfinished, its completion timestamp is cleared, and
the record that it ever happened is destroyed — silently, on an ordinary
two-device setup. That is loss of a durable user fact and reversal of a terminal
state, which §46 classes as **P1**.

**Why no app-only fix exists.** The damage is done by the *push*, not by
adoption. Stopping a stale write requires the server to reject it — a
conditional update, i.e. compare-and-set or a version column. Guarding on the
client cannot help: the stale client believes its own state is current, and
nothing in the row tells the server which write is older. §42 and §18 both
require a stop before that work.

### Prose conflict (§21), stated plainly

Two devices editing a note body independently: **one whole body survives and the
other is gone.** Nothing merges the prose, no AI is involved, and the person is
not told. With no version model there is nowhere to keep the loser.

## 4. The matrix (§38)

### State × action

| | retry | reload | offline | reconnect | sign-out | account switch |
|---|---|---|---|---|---|---|
| local | n/a | state kept, data kept | explicit | n/a | warns if pending | A's data invisible to B |
| syncing | n/a | baseline lost → re-evaluated | queues | flushes | warns if pending | ✓ |
| synced | n/a | last-sync survives | explicit | ✓ | quiet | ✓ |
| incomplete | **retries only the dirty work** | repairs on next push | queues | flushes | **warns** | ✓ |
| failed | ✓ retry | repairs on next push | queues | flushes | **warns** | ✓ |
| offline | n/a | data kept | — | Syncing… → Synced | warns if pending | ✓ |
| localError | **retry local save** | **would lose the change** | unaffected | unaffected | warns | ✓ |

### Data × failure

| | remote fail | tombstone fail | blob fail | reload mid-sync |
|---|---|---|---|---|
| Action | domain dirty, retried | marker retried, then suppression works | n/a | re-pushed |
| Note | domain dirty, retried | marker retried | n/a | re-pushed |
| Document | domain dirty, retried | marker retried (075 C-2) | metadata reports "missing" | re-pushed |
| File blob | n/a | n/a | no orphan; no dead Retry | unaffected |

### Reload recovery (§9, §18) — measured

```
before reload: incomplete, failedDomains ["goals"], dirty ["goals"]
after  reload: failedDomains gone — but hasBaseline false, so nothing looks clean
first push:    ["upsert:goals","upsert:notes"]  →  Synced
```

The volatile `failedDomains` does not survive, and **neither does the baseline**,
so there is no false "Synced". The repair push is bounded by real data — empty
domains emit nothing — not 46 round trips.

## 5. Retry contract (§7)

Measured: after a partial push with actions failing and notes+goals succeeding,
Retry issues **`["upsert:next_actions"]` and nothing else**. Confirmed domains are
not replayed. A failed deletion marker is retried by the same control, and once
it lands a stale client is suppressed.

**Manual retry resets `retryAttempt`** (unchanged, and documented): repeated
manual retries therefore never reach the terminal `failed` state — the person
stays in "Retrying… (1/5)". No evidence shows this creates a false recovery
claim, so §6 says leave it. It is recorded here so the behaviour is known.

Backoff: 400 ms debounce, 2 s base, 60 s cap, 5 automatic attempts. Offline stops
the loop rather than burning retries; reconnecting flushes immediately instead of
waiting out a stale interval.

## 6. Product claims (§37)

| Claim | Verdict |
|---|---|
| I can tell whether my information is only on this device or synced | **PASS** — every state inspectable at both viewports |
| I know when sync needs my attention | **PASS** — alarming states visible at 390px, quiet when healthy |
| I can recover from a normal remote sync failure | **PASS** — retry scoped to dirty work |
| Offline changes sync after I reconnect | **PASS** (deterministic; no deployed run) |
| A failed file upload does not pretend to be safe in the cloud | **PASS** (075, retained) |
| Reloading during sync does not silently lose confirmed local work | **PASS** |
| Signing out does not silently discard unsynced work | **PASS** |
| Another account cannot inherit my pending local data | **PASS** — `start-clean`, 0 records, no push |
| Conqify does not claim to resolve conflicts it cannot detect | **PASS** — no warning is shown, because no reliable evidence exists |
| A completion survives a stale edit from another device | **FAIL — F-1** |

## 7. Performance (§41)

| Records | push | dirty detect | unsynced check | cold adopt |
|---|---|---|---|---|
| 100 | <1 ms | <1 ms | <1 ms | <1 ms |
| 1,000 | 1 ms | <1 ms | <1 ms | <1 ms |
| 5,000 | 4 ms | <1 ms | <1 ms | 1 ms |
| 10,000 | 8 ms | <1 ms | <1 ms | 1 ms |

The indicator subscribes to O(1) health, never to the store, so none of the new
UI causes a full-store scan on render. `hasUnsyncedChanges` short-circuits on the
failed/pending flags before doing any per-domain work.

## 8. Evidence

| Gate | Result |
|---|---|
| Sync-recovery deterministic | **87/87** |
| Sync-trust browser | **243/243** (117 desktop, 126 mobile) |
| 075 cross-device deterministic · browser | 134/134 · 135/135 |
| Full regression | **4142/4142** across 42 suites |
| Migration rehearsal | 109/109 |
| Wiring register · release audit · security | 17/17 · 17/17 · PASS |

**Migration head 0044, unchanged. No schema change was made.**

## 9. Residual risks

1. **F-1** — the blocker above.
2. **Prose conflict** — an entire note body can be lost with no warning.
3. **Tombstone race window** — unchanged; deletion propagation is **not**
   transactionally atomic.
4. **D-8** — still frozen. Its status store remains dev-writable only.
5. **E-7** — `/dev/sync-tests` mutates the real store on render (sections 58–61,
   pre-existing since 074). Production-gated, so no user is exposed; a developer
   opening it with real data will lose it.
6. **No live deployed run** — no Supabase credentials exist in this environment.
   Every backend here is an in-memory fake driven through the real adapter.
   `syncing`, `retrying` and `offline` are reachable only through the health test
   seam.

## 10. On this sprint's own tests

Six first-run failures were mine, each verified before being dismissed:

- a `revision` regex that matched `belief_revisions`, a real table with nothing
  to do with conflict guards;
- an unanchored `indexOf` that sliced an empty string and asserted on nothing;
- a "leaked vocabulary" scan that read the file's own documentation — which
  discusses domain names precisely because they must not be shown;
- **a self-test that wiped the real store.** My reset-parity assertion drove the
  actual `resetStore()` from a suite that `/dev/sync-tests` renders, so visiting
  that page destroyed the viewer's account and took the last-sync key with it. A
  browser probe caught a seeded record vanishing between navigations. The
  behavioural half now runs only in the Node harness; the pure property stays in
  the suite. That hunt is also what surfaced E-7.

Every repair was proved **red against the base commit's own source**, read with
`git show` rather than paraphrased.
