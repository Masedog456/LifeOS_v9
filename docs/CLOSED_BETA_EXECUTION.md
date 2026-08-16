# Closed Beta — Execution Pack

Prepared at `main` = **`d2d7fe6`** (LIFEOS-051A + 052 + 053 + 054 all landed).

This document contains the gates a machine cannot run, the tester brief, the
observation ledger, and the signals to watch. It exists so the beta is run from
evidence rather than memory.

---

## 1. Automated status — already green, no action needed

| Gate | Result |
|---|---|
| Full regression | **1586 / 1586** across 24 suites |
| Cross-sprint integration harness | **64 / 64** |
| TypeScript · lint · production build | clean (2 pre-existing warnings) |
| `audit:security` | PASS — RLS · secrets · routes · auth · dependencies |
| `release:audit` | PASS 17 / 17 |
| Migration chain | 37 files, dense 1–37, **zero destructive statements**, 58 tables |

---

## 2. MANUAL EXTERNAL GATES — must be completed before testers

Status: **G1 has run and passed. G5 partially ran and passed.** The rest require
credentials, a browser, or a live deployment and remain **unverified — not
"probably fine".**

### G1 — Migration rehearsal — ✅ **RAN, PASSED 38/38**

`node scripts/migration-rehearsal.mjs` now executes end to end against a
throwaway Postgres 16 cluster. Verified: clean apply `0001 → 0037`, **58** public
tables, idempotent ×3, upgrade from all ten historical checkpoints reaching the
same 58 tables as a clean install, RLS enabled with policies on every public
table, `user_id` defaulting to `auth.uid()`, and a live two-user isolation probe
(B can neither read, update, nor delete A's rows).

Two things had to be fixed for it to run at all, both in the harness, neither in a
migration:
- `pgvector` was missing from the build image (`postgresql-16-pgvector`).
- The harness carried a `storage` gap and two stale `56`-table expectations from
  before `notes` (0035) and `protocols` (0037) existed.

**Still recommended before beta:** run once against a *restored copy of the real
production schema*. The harness models Supabase's `storage` schema rather than
reproducing it, so it proves our chain is sound but not that production's exact
starting state upgrades cleanly.

### G2 — Deployment
Confirm the closed-beta environment is actually serving `d2d7fe6`. Pushing `main`
is not deployment. Check the deployed commit in your hosting dashboard.

### G3 — Closed-beta auth
1. Attempt sign-in with an email that is **not** an approved tester.
   **Expected:** no user created, no usable link, and a response that does not
   reveal whether the account exists.
2. Sign in as an approved tester. **Expected:** works, session persists, app loads.

**Blocker if an unapproved address gains access.**

### G4 — Two-session sync
Two browser profiles signed into the same account (this exercises the same remote
sync path as two devices).

- **A:** create a Note with a Topic, a Next action with a due date, and a Protocol.
- **B:** confirm all three appear with `dueDate`, topic link, trigger/response, and
  any AI-origin marker intact.
- **B:** edit the note, change the due date, edit the protocol response.
- **A:** confirm all three changes.
- **B:** delete one record. **A:** confirm the deletion propagates.

**Blocker on divergence, loss, or resurrection of a deleted record.**

### G5 — Large PDF — ⚠️ **PARTIALLY RAN: 23/23 on the parts that could run**

A **real 520-page PDF binary** (911 KB, generated with pdfkit — a genuine PDF
file, not the in-memory synthetic fixture) was pushed through the *actual*
extraction path: `pdfjs-dist` → the `extractPdf` loop → `assignPages` →
`buildRetrievalChunks` → `buildDocumentParts` → `selectParts`.

**Import — all truthful.** 520/520 pages attempted and readable, **not
truncated**, and Import Details reported *"All 520 pages contained readable
text."* Extraction produced **956,188 characters** — the pre-051A 600k cap would
have silently cut this book at roughly **page 326**, so the fix is confirmed
against a real file rather than a fixture.

**Late-book retrieval — page-accurate.** Five unique markers planted at pages
1 / 130 / 260 / 390 / 520 were each retrieved, and **every citation resolved to
within ±2 pages of the true page, including the marker on the final page.**

**Whole-book synthesis — honest.** 260 parts, 240 selected = **92% coverage**,
with the opening, middle and **final-page** markers all reachable. Coverage is
never overclaimed.

**Still outstanding for this gate**, because they need the running app in a
browser:
- upload through the real Reading UI
- **delete cleanup** — document, passages, private original, semantic-index rows
- localStorage measurement

Use a genuine published book for that pass. **Blocker only if Reading claims
coverage it does not have, or cleanup fails.** Record storage usage as an
observation — **do not start 051B.**

### G6 — Export / restore through the product UI
With a Note, Topic relation, dated action, waiting follow-up, Protocol, Project and
Reading item present: export, then restore.

Check especially the nine domains that were silently dropped before LIFEOS-052:
`nextActions`, `dailyReviews`, `actionDependencies`, `actionTemplates`,
`planningAssignments`, `focusSessions`, `maintenanceEvents`, `duplicateCandidates`,
`savedInsightViews`.

**Any silent loss is a NO-GO.**

### G7 — Account deletion
On a **disposable** approved account holding a Note, Action, Protocol and Reading
document: delete the account and confirm records, private original file, and index
rows are all gone.

### G8 — Five tester accounts
Pre-approve exactly five addresses. **Do not enable open signup.**
Do not seed fake usage data.

---

## 3. Tester brief

> Use Conqify for a few days with real things from your life — the stuff you'd
> normally text yourself, write on your hand, or forget.
>
> Capture things the way you naturally think them. Don't tidy them up for us.
>
> Have a look at Notes, Today, and Reading if you read anything long.
>
> **If something confuses you, please don't work around it to be helpful.** Getting
> stuck is the useful part. Tell us what you expected to happen instead.
>
> This is a closed beta on real infrastructure. Use real information, but skip
> anything you'd be uncomfortable having in an early product.

**Do not explain Note, Belief, Protocol, Topic, or any other concept up front.**
If they ask what something means, note the question — that *is* the finding — then
answer plainly.

---

## 4. Observation ledger

Copy one block per observation. **Never merge FACT and INTERPRETATION.**

```
TESTER:
DATE:
CONTEXT:            (what were they doing?)

FACT:               (what literally happened — no explanation)

INTERPRETATION:     (what it might mean — clearly separate)

USER WORDS:         (short exact quote, if useful)

WORKAROUND:         (what they did instead)

FREQUENCY:          first occurrence / repeated

POTENTIAL DECISION: (leave blank until evidence accumulates)
```

---

## 5. Signals to watch — no instrumentation, observation only

**Capture** — what they capture · which destination is suggested · was it right ·
when Note was the fallback · when Split was needed · what had nowhere to go.

**Notes** — is Note the natural "keep this" · do Topics make sense · do they want
folders/nesting.

**Actions / time** — do they add due dates · ask for recurrence · ask for reminders ·
does Upcoming help · does "Needs attention" feel useful.

**Protocol** — do real conditional protocols arise naturally · understood without
coaching · **do they expect protocols to fire automatically** (they do not).

**Today** — does it answer "what deserves attention now?" · does it feel crowded ·
does Return help · anything duplicated.

**Reading / knowledge** — do they upload real long sources · save AI output · trust
citations · can they tell their own thought from AI output.

**Retrieval** — what they search for · do they expect cross-domain search.

**Connectors** — which is asked for *unprompted*: Calendar · Gmail · Drive ·
Readwise · Zotero · AI import.

**Visualization** — calendar view · charts · "where is my time going?" · timelines ·
relationship graphs.

---

## 6. Decision rules — recorded now, applied only after evidence

Written before the data so they cannot be bent to fit it.

| Direction | Moves up when |
|---|---|
| **Recurrence** | recurring responsibilities cannot be represented AND 2+ testers hit it |
| **Calendar** | repeatedly named as missing life context, especially unprompted |
| **Protocol tuning** | only from actual misclassifications, never from taste |
| **Classifier AI fallback** | **not** merely because rules are imperfect — classify the observed failures first |
| **Visualization** | testers repeatedly want time/project/learning data seen spatially |
| **Universal retrieval** | repeated cross-domain questions the two-index split cannot answer |
| **051B persistence** | **immediately** if real library usage approaches the localStorage limit or causes a failure |
| **Generic AI import** | 3+ users paste or ask to import ChatGPT / Claude / Gemini output |
| **Any connector** | repeated *independent* demand + real manual-work reduction + safe scopes |

---

## 7. Blockers

Data loss · restore loss · sync corruption · cross-user exposure · private-file
exposure · auth bypass · unapproved self-registration · migration failure ·
provenance laundering · AI output becoming user-authored · automatic action or
commitment creation without confirmation · multi-intent capture dropping a
fragment · widespread crash · Reading claiming false coverage · incomplete account
deletion.

**Missing future functionality is not a blocker.** No recurrence, no Calendar, no
charts, no connectors, and an imperfect-but-safely-falling-back classifier are all
expected states, not defects.
