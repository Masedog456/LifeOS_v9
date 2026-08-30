# LIFEOS-076B — Deployment Parity Handoff

**STATUS: HOLD.** PR #81 is structurally approved and is **not** to be merged
until migration 0045 has been applied to production Supabase and externally
verified.

| | |
|---|---|
| PR | #81 — *LIFEOS-076B — Database-Enforced CAS Integrity Repair* |
| Branch | `claude/lifeos-076-cas-integrity-repair` |
| Head | `aaefdf491e8fccf8dcef3645aaac08c24d79d3dd` |
| Base | `96cf62a725825965dadff6154e89ce908905716d` |
| **Repository migration head** | **0045** |
| **Production Supabase head** | **0044** |

Migration 0045 has **not** been applied from this environment, and no claim in
this document or in PR #81 describes a live deployed run. Every Postgres claim
rests on `scripts/migration-rehearsal.mjs` against a throwaway PostgreSQL 16
cluster. Deployment status may only be updated on **external confirmation**, and
must then be labelled `EXTERNALLY VERIFIED DEPLOYED EVIDENCE` without implying
it was executed from here.

---

## 1. Approved deployment order

1. Apply migration 0045 to production Supabase
2. Verify live schema and invariant
3. Merge PR #81 immediately afterward
4. Reverify application and migration parity
5. Close LIFEOS-076B

**Why migration first.** Applying 0045 before the new client ships means the
deployed client may have guarded writes refused for a short window. That is the
accepted cost, because it **fails closed**:

> a temporary, visible write refusal is preferable to a stale client silently
> overwriting durable data.

That priority is not to be reversed. The reverse order — new client first —
would leave a client proposing `sync_version` at a database that has no such
column, which is the failure mode with no upside.

---

## 2. The old-client window — measured, not assumed

The window is the period after 0045 is applied and before #81 merges. The
deployed client during that window is the one at merge commit `96cf62a`: it
writes guarded rows with a bare upsert and contains no reference to
`sync_version` at all (verified: 0 occurrences in its adapter).

The database side is already proved by the rehearsal (an old-client `UPDATE`
and a realistic `ON CONFLICT DO UPDATE` are both refused). What needed proving
was the **client** side — whether a refused write preserves local durable intent
or loses the user's work. §5 of the handoff makes that a BLOCK condition, so it
was measured rather than asserted.

**Method.** A git worktree at `96cf62a`, compiled, and its real `persistence` +
`SupabasePersistenceAdapter` driven against a backend that enforces the 0045
invariant. Scenario: a production row migrated to `sync_version = 1`; the user
completes an action on the old client; the push is refused.

**Result — 8/8:**

| | Observed |
|---|---|
| The guarded write is refused | server stays `status=open`, `sync_version=1` |
| The server's durable value is not corrupted | no `completed_at` written |
| **The user's completion survives on the device** | `status=completed`, `completedAt` present |
| …including its history entry | `completed` entry retained |
| The failure is visible, not silent | health state `retrying` |
| The domain stays dirty | `dirtyDomains: ["nextActions"]`, `failedDomains: ["nextActions"]` |
| Sync is not falsely reported complete | state never `synced` |
| Per-domain isolation holds (074 D-22) | unguarded domains unaffected |

**Conclusion: fail-closed confirmed. No data loss. No BLOCK.**

This is a *write refusal*, not data loss, and it must not be described as data
loss. The user's work stays on their device, stays marked unsynced, and is
pushed successfully once #81 ships.

### What the user actually sees during the window

Better than it would have been a sprint ago: the deployed client already carries
the LIFEOS-076 sync indicator that shipped in PR #80. During the window a person
sees an alarming state with a reachable "Try again" control, the consequence
wording ("some of your changes are only on this device" — never a table name),
and the sign-out warning that stops them walking away from unsynced work.

What it does **not** have is the conflict store and `ConflictNotice` — those
ship in #81. During the window a refused write is reported as a sync failure,
not as a conflict with a choice. That is correct for the window: nothing is
lost, and the work lands on merge.

### Caveat worth stating

One assertion in the first run of this measurement appeared to show the
completion missing from the device. It was a defect in the harness — it drove
the remote push without the local write that always precedes it — not in the
client. Corrected and re-measured before the result above was recorded.

---

## 3. What external verification must check

### Live 0045 invariants (A–P)

| | Check |
|---|---|
| A | `notes.sync_version` — `bigint`, `NOT NULL`, default `1` |
| B | `next_actions.sync_version` — `bigint`, `NOT NULL`, default `1` |
| C | `enforce_sync_version()` exists |
| D | the guard is attached to **both** `notes` and `next_actions` |
| E | valid: `1 → 2` |
| F | invalid: `1 → 1` |
| G | invalid: `1 → 3` |
| H | stale: server at 2, incoming 2 from an expectation of 1 → rejected |
| I | old-client-style `UPDATE` omitting `sync_version` → rejected |
| J | realistic `ON CONFLICT DO UPDATE` omitting `sync_version` → rejected |
| K | `push_guarded_rows` exists |
| L | `SECURITY INVOKER` |
| M | ownership / RLS remains authoritative |
| N | existing rows receive version 1 |
| O | new inserts receive version 1 |
| P | a stale existing id can never become an INSERT fallback |

All sixteen have a direct counterpart in `scripts/migration-rehearsal.mjs`,
which passes 143/143 against real PostgreSQL 16. That is *rehearsal* evidence;
it does not substitute for the live check.

### Live security check

- RLS still enabled on both tables
- Trigger and RPC privileges as granted (`authenticated` can execute,
  `anon` cannot)
- No new `SECURITY DEFINER` escalation — 0045 introduces none
- No cross-user update path
- Supabase security advisor run after the migration; **record the exact result**

**If the migration introduces a new security warning attributable to 0045, do
not merge #81 until it is understood.**

---

## 4. After 0045 is confirmed live

Merge #81 promptly — the window closes on merge — then verify the new client
can:

- read existing v1 Notes and v1 Actions
- create new records (inserting at version 1)
- update 1 → 2
- handle a stale rejection
- preserve local rejected intent
- show the conflict notice
- resolve a conflict via a new current-version write

### F-1 final acceptance

A and B read Action v1. A completes → remote v2. B's stale defer → refused.

Must hold: `status = completed`, `completed_at` preserved, completion history
preserved, B's attempted defer recoverable and explainable, **no silent
reopening**.

### F-2 final acceptance

A and B read Note v1. A edits → accepted v2. B's stale edit → refused.

Must hold: the server preserves the accepted text, B's rejected authored text
remains recoverable, the conflict UI appears, **no authored body disappears**,
and "Use my version" becomes a deliberate v3 write. No AI merge, no silent
merge.

### Gates to re-run after parity

CAS-client · F-1 · F-2 · commit-then-timeout · legitimate reopen · note conflict
resolution · tombstone interaction · 076 browser · 075 cross-device · 074
integrity · migration rehearsal · wiring · release audit · security · tsc ·
eslint · build · full regression.

**No assertion weakening.**

---

## 5. Carried forward

### F-3 — OPEN. Highest-priority infrastructure follow-up.

The client/server schema compatibility gate cannot compare the client against
the actual deployed migration head. Its only production caller supplies
`remoteMigrationVersion = EXPECTED_MIGRATION_VERSION` — the check compares the
constant to itself, so it can never fire.

Not repaired in 076B: wiring it to a real server read is new behaviour outside
this bounded repair and would change deploy semantics.

It is now materially more important than it was, and 0045 is the reason: schema
compatibility no longer merely affects *which columns exist*, it affects
**whether a write is accepted at all**. It is also why the head bump from 0044
to 0045 is safe today — with a strict-equality gate that *could* fire, neither
deploy ordering would be safe, because applying the migration first would break
the running build and shipping the build first would break until the migration
landed.

Likely next bounded sprint: **LIFEOS-077 — Schema Compatibility & Safe
Deployment**, north-star candidate *"the app should know whether the database it
is talking to can safely accept its writes."* **Not started.**

### D-23 — PARTLY closed. Do not relabel as globally fixed.

| Scope | Status |
|---|---|
| Guarded Notes / Actions | An unreadable or ambiguous guarded response is **no longer** accepted as success |
| The 44 unguarded domains | Malformed / readless-success ambiguity **remains possible** |

A readable response that *claims* acceptance while storing nothing is still
believed, on every domain. Verifying that means reading every row back after
every push — a much larger design decision than this repair. All three halves
are asserted in `scripts/inject-074-remote-failure.cjs` (12.4, 12.5, 12.5b).

### E-7 — repaired. Do not weaken the seam.

`/dev/sync-tests` and `/dev/action-tests` cannot mutate the viewer's real store
or push fixture state remotely. Proved by measurement rather than by comparing
before/after values: no local write is attempted, nothing reaches a live remote,
and the sync clock and any unresolved conflict survive untouched.

### R9 — keep pinned.

When the server commits and the response body is unavailable, the client must
not call the domain fully synced on the strength of `error === null`. An
unreadable body is an ambiguous outcome. Red-proved.

---

## 6. Evidence labelling rules

Until external confirmation arrives, every report continues to state:

```
repository head = 0045
deployed head   = 0044
```

Deployment must **not** be inferred from the migration rehearsal, the existence
of the SQL file, a green Vercel build, or branch state. On confirmation, update
with repository head, Supabase head, exact version/name parity, live schema,
live trigger and RPC presence, and the exact security-advisor result — labelled
`EXTERNALLY VERIFIED DEPLOYED EVIDENCE`, and not phrased as though it were
executed from this environment.
