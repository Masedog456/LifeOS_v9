# LIFEOS-074 — Engineering Integrity Audit

**Verdict: COMPLETE — ENGINEERING INTEGRITY AUDIT PASSED.**

The previously-recorded blocker was deployed migration parity. It has been
closed by direct verification of the connected Supabase project, performed
outside this environment. What follows separates that externally-verified
deployed evidence from the deterministic evidence produced here, because
collapsing the two is exactly the move that produced D-24.

---

## 0. Migration parity — closed

### 0.1 Deployed state (externally verified)

The connected LifeOS/Conqify Supabase project was inspected directly and
reported these migration rows:

```
0042 | integration_accounts
0043 | next_action_due_time_recurrence_constraint
0044 | workspace_session_current_action
```

The repository's migration files are:

```
0042_integration_accounts.sql
0043_next_action_due_time_recurrence_constraint.sql
0044_workspace_session_current_action.sql
```

**Exact numeric version and name parity: PASS.** Repository head 0044, Supabase
head 0044.

The deployed 0043 constraint was verified to read semantically
`due_time IS NULL OR due_date IS NOT NULL OR recurrence IS NOT NULL`, with the
pre-existing `HH:MM` 24-hour format constraint still present. The deployed
`public.workspace_sessions` table was verified to carry `goal_id`,
`project_id` and `current_action_id`, all `uuid` and nullable. **0043 and 0044
are live.**

### 0.2 Provenance of that evidence

This environment still holds no Supabase credentials and no Supabase CLI
(`env | grep -i supabase` → 0 results; only `.env.example` is present). The
deployed facts in §0.1 were **verified externally and supplied to this audit**.
They are recorded as externally-verified deployed evidence, not as something
this audit executed.

Accordingly, **no live two-client remote round trip was run from here**, and
none is claimed. §4's cross-device deletion retest against the deployed database
was not performed.

### 0.3 What this audit proved itself

Against a real PostgreSQL 16 running the full chain 0001→0044 three times
(`npm run release:migrations`, 103/103):

| 0043 semantics | Result |
|---|---|
| `due_time` with a `due_date` | accepted |
| `due_time` with a `recurrence` and no date | **accepted** (the repair) |
| `due_time` with neither | still refused |
| a malformed time, even with a recurrence | still refused |
| exactly one `due_time` constraint after the chain | confirmed |

| 0044 semantics | Result |
|---|---|
| `workspace_sessions` carries all three execution pointers | confirmed |
| …as soft references, with no foreign key | confirmed |
| a completion for a non-existent action | refused |

The deployed constraint text and column set reported in §0.1 match these
semantics.

For cross-device deletion, the deterministic evidence stands on its own: 43
assertions driving the real adapter, the real adoption path and a real push,
with the tombstone write made to fail on command — including a control run
proving that a successfully-written tombstone changed nothing before the repair.
That is deterministic evidence, not a live deployed claim, and it is not
presented as one.

---

## 1. Defects

| ID | Sev | Finding | Status |
|---|---|---|---|
| D-1 | P1 | Recurrence and due-time never reached the database | FIXED (0043) |
| D-2 | P2 | An undone recurrence occurrence still reported as kept | FIXED |
| D-3 | P2 | Workspace-session execution pointers never persisted | FIXED (0044) |
| D-4/5 | P3 | Mapper and doc gaps | FIXED |
| D-6/7 | P3 | Documented debt | DOCUMENTED |
| D-8 | P2 | Conflict/merge layer built, tested, unwired | **ACCEPTED / DEFERRED** |
| D-9 | P3 | SYNC_INTEGRITY.md described an unwired layer as live | FIXED |
| D-10 | P2 | Deleting an action could wedge sync permanently | FIXED |
| D-11 | P3 | Two delete paths left different debris | FIXED |
| D-12 | P2 | A timed recurring action was classified flexible | FIXED |
| D-13 | P2 | A reopened completion still counted as completed | FIXED |
| D-14 | P2 | "Deferred X (until Invalid Date)" shown to the user | FIXED |
| D-15 | P2 | Starting a deferred/waiting action invisible to every consumer | FIXED |
| D-16 | P3 | Two facts in one second collapsed to one | FIXED |
| D-17 | P3 | Fields describing an abandoned status survived it | FIXED |
| D-18 | P3 | An "Unblocked" event fabricated for a non-existent edge | FIXED |
| D-19 | P3 | The accessibility auditor cannot fail | DOCUMENTED |
| D-20 | P3 | Dangling file reference in a doc comment | FIXED |
| D-21 | P2 | A failed save was invisible on a phone | FIXED |
| D-22 | P2 (broad) | One failing domain starved every later domain | FIXED |
| D-23 | P3 | Success judged solely by `error`, never a row count | **DEFERRED** |
| D-24 | **P1** | Deletions did not propagate to a second client | FIXED |
| D-25 | P3 | `/plan/week` unreachable from navigation | **REPORTED ONLY** |
| D-26 | P2 | A corrupted backup was still importable | FIXED |

**No open P0 or P1.**

## 2. Residual risks — carried, not closed

1. **Tombstone race window.** A delete whose tombstone write fails leaves no
   marker until the retry lands; a stale client adopting inside that window
   still resurrects the record. Sync reads "Sync incomplete" throughout and the
   retry closes it. **Deletion propagation is not transactionally atomic and
   must not be described as such.** Pinned in both states.
2. **D-8 — the conflict/merge layer is unwired**, and its blast radius is six
   per-domain `merge-rules.ts` modules beyond `merge.ts` and `conflicts.ts`.
   The live cross-device strategy is last-write-wins per row.
3. **D-23 — malformed success.** `throwing()` judges success by `error` alone
   and never reads a row count. The code property is proven; reachability is
   not, and could not be settled without a production PostgREST.
4. **D-25 — `/plan/week`** renders a real feature reachable only by URL.

Migration parity is **no longer** a residual risk; see §0.

One further limit, stated as a limit rather than a risk: the deployed
cross-device deletion path has not been exercised live from this environment
(§0.2). The deterministic gate covers the code path; it does not substitute for
a production two-client run.

## 3. What the evidence was

| Dimension | Evidence |
|---|---|
| History truth | 24 mutations driven through the real store; 6 defects |
| UI reachability | 145 browser assertions (114 desktop, 31 mobile) |
| Failure injection | 97 cases across three layers |
| Domain isolation | 31 assertions, §8 A–G |
| Tombstone gate | 43 assertions, full A–G lifecycle |
| Wiring register | 4 checks, validated against the pre-repair state |
| Import/export, concurrency, destructive, perf, memory | 50 assertions |
| Recurrence, false-confidence, adversarial | 47 assertions |
| Regression | **4112/4112 across 42 suites** |
| Rehearsal / release audit / security | 103/103 · 17/17 · PASS |

Performance at 10,000 actions, final run: Today 637ms, activity index 32ms,
range review 76ms (an earlier run on the same harness read 741 / 45 / 92 — the
spread is machine noise, not a shape change). 10× the data costs ~8× the time —
linear, not quadratic.

## 4. The finding behind the findings

Six separate defects were the same shape: **a mechanism was built, was correct,
and nothing consulted it.**

- `sync_tombstones` — written for three sprints, never read (D-24)
- the backup manifest — computed, then ignored by the importability gate (D-26)
- the accessibility auditor — a ≥44px rule never pointed at a rendered page (D-19)
- `merge.ts` / `conflicts.ts` / six `merge-rules.ts` — complete, untouched (D-8)
- `due_time` / `recurrence` — on the type and in the schema, absent from the mapper (D-1)
- the session execution pointers — written locally, no columns to hold them (D-3)

In each case tests passed, because every test exercised the model and none
exercised the wiring. **Presence is not evidence of life**, and
`scripts/audit-wiring.mjs` now measures the property directly.

The adversarial second pass found **no new defects**. That is reported as it
happened rather than padded.

## 5. Test-quality note

4075 assertions passed while all six history-truth defects were present, and not
one broke when they were fixed. They shared a single assumption: that a recorded
keystroke reaching the timeline means the timeline is true. The audit added
assertions that fail for the right reason and verified each against the
unmodified base — 20 for §1, 6 for D-26, and the D-22/D-24 pins.

Roughly a third of this audit's own first-run failures were harness errors, each
verified before being dismissed: a title living in an `<input>`, a bare text node
invisible to a leaf walk, page coordinates compared against viewport
coordinates, a shell regex with an embedded newline, a hand-rolled archive shape,
and a guessed function signature. Two would have been filed as product defects.

## 6. Closing state

1. 0043 and 0044 applied to the Supabase project. **Done.**
2. Exact version and name parity verified — head 0044,
   `0044_workspace_session_current_action`. **Done** (§0.1, externally verified).
3. Deterministic gates re-run at the final head: all green (§3).

**No open P0. No open P1.** The accepted P2/P3 debt in §2 is carried forward
deliberately, each with a named owner condition, and is not a blocker.

Verdict: **LIFEOS-074 COMPLETE — ENGINEERING INTEGRITY AUDIT PASSED.**
