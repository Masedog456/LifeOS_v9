# LIFEOS-074 — Engineering Integrity Audit

**Verdict: BLOCKED — deployment migration parity is unresolved (repository head
0044, Supabase 0042) and cannot be resolved from this environment.**

Everything else in the audit is complete. The blocker is stated first because a
report that buries its own blocker is the thing this audit exists to prevent.

---

## 0. The blocker, precisely

| | |
|---|---|
| Repository migration head | **0044** |
| Deployed Supabase | **0042** |
| Missing remotely | 0043, 0044 |
| Rehearsal against real PostgreSQL 16 | **103/103, clean through 0044** |
| Release audit | **17/17** |

This environment holds **no Supabase credentials and no Supabase CLI**, so the
remote migration history cannot be advanced from here. Both pending migrations
were separately approved and both are bounded integrity repairs:

- **0043** widens one CHECK so a recurrence rule can name the day for a
  `due_time`. Its rollback is **not free**: reverting fails while any row has a
  `due_time` with a rule and no date, which is exactly the shape it exists to
  allow.
- **0044** adds three nullable soft-reference columns to `workspace_sessions`.
  Rollback **is** free.

**0043 is not optional.** The mapper repair (D-1) means a recurring action with
a time now reaches the database; against a 0042 schema that row violates the old
CHECK and, before D-22, would have wedged every later domain. Deploying the
application without 0043 is worse than not deploying it.

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
5. **Migration parity** — the blocker above.

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

Performance at 10,000 actions: Today 741ms, activity index 45ms, range review
92ms. 10× the data costs ~8× the time — linear, not quadratic.

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

## 6. To close this audit

1. Apply 0043 and 0044 to the Supabase project through the established workflow.
2. Verify exact version and name parity (0044, `0044_workspace_session_current_action`).
3. Re-run `npm run release:migrations` and `npm run release:audit` against the
   deployed schema.

Until then the verdict stands at BLOCKED.
