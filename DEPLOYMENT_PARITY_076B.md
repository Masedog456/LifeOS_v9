# LIFEOS-076B — Deployment Parity Handoff

## STATUS: PARITY VERIFIED — repository 0045 · production 0045 · PASS

| | |
|---|---|
| PR #81 — *Database-Enforced CAS Integrity Repair* | **MERGED** `2026-08-30T23:25:07Z` at `aaefdf4` |
| **Repository migration head** | **0045** |
| **Production Supabase head** | **0045** |
| **Exact version/name parity** | **PASS** |
| Migration file applied | `supabase/migrations/0045_sync_version_guard.sql` |
| Production ledger ends at | `0045 | sync_version_guard` |

**The temporary `0045 client / 0044 database` window is CLOSED.** Previously
queued Note and Action writes are now *eligible* to flush normally on retry or
reconnect. No claim is made that any particular user's queued writes have
landed — that was not observed.

---

# EXTERNALLY VERIFIED DEPLOYED EVIDENCE

Everything in this section was performed **outside this environment**, against
the connected production Supabase project, and is recorded here as supplied. It
was **not** executed from here: this environment holds no production Supabase
credentials or CLI, and nothing below is a run I performed.

### Columns

`public.notes.sync_version` and `public.next_actions.sync_version` — `bigint`,
`NOT NULL`, default `1`. Positive-version constraints present on both tables.

### Triggers and function

`notes_sync_version_guard` and `next_actions_sync_version_guard`, both
`BEFORE UPDATE`, both calling `public.enforce_sync_version()`, which exists.
`security_definer = false` — it is not `SECURITY DEFINER`.

### RPC

`public.push_guarded_rows(text, jsonb)` and `public.guarded_assignments(text)`
both exist; neither is `SECURITY DEFINER`. `push_guarded_rows` was exercised
live inside a transaction against an existing Note: `accepted` contained the
Note id, `stale` was empty. The transaction was rolled back; no persistent
user-data mutation was intentionally left behind.

### RLS

Enabled on `notes` and `next_actions`. Ownership policies remain
`auth.uid() = user_id` for SELECT / INSERT / UPDATE / DELETE. No evidence was
found that 0045 weakened ownership isolation.

### Live behaviour

- Valid guarded update `1 → 2` — **succeeds**
- Old-client-style update omitting `sync_version` — **rejected**, raising the
  expected `LIFEOS_STALE_WRITE`

Checked on both guarded table classes, without intentionally leaving the
verification mutation behind.

### Security advisor

Run after 0045. No evidence of a new P0/P1 cross-user-access issue. Two
hardening observations belong to 0045 and are recorded as S-45A and S-45B below.

---

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

## 2. The old-client window — measured, not assumed *(historical — never occurred)*

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

## 2b. The window that did occur — measured, now CLOSED

Because the merge landed first, the live mismatch is the *inverse* of the one
planned for: a **new** client against a **0044** database. The new client calls
`push_guarded_rows`, which does not exist at 0044, and its version pre-read
selects a `sync_version` column that does not exist either.

Measured with `scripts/inject-076b-live-window.cjs`, driving the real merged
adapter and persistence layer against a backend that behaves like 0044 — **9/9**:

| | Observed |
|---|---|
| `next_actions` / `notes` sync | **fails** — `Could not find the function public.push_guarded_rows` |
| The server row | untouched |
| **The user's completion on the device** | **survives**, with `completedAt` and its history entry |
| Failure visible | yes — health state `retrying`, settling to `Sync failed` |
| Sync falsely reported complete | never |
| Domain stays dirty | `dirtyDomains: ["nextActions"]` — the work is queued, not dropped |
| **Unguarded domains** | **keep syncing normally** — goals synced in the same flush |
| Phantom conflicts invented | **none** — the R9 fix treats a missing function as a failure, not a conflict |

**Fail-closed in this direction too. No data loss.**

While it lasted, a person saw Notes and Actions reporting a sync failure with a
reachable "Try again", their work safe on the device and marked unsynced, the
sign-out warning firing if they tried to leave with unsynced work, and every
other domain syncing normally.

### CLOSED

Migration 0045 is now live (externally verified above), so the missing function
is present and the degradation is over. Previously queued Note and Action writes
are **eligible** to flush normally on the next retry or reconnect, with no
manual recovery step. **No claim is made that any particular user's queued
writes have landed** — that was not observed from here, and could not be.

The one thing this window is permanent evidence for: it is the hazard F-3
describes, happening. A client that cannot ask the database what version it is
at cannot warn anyone and cannot decline to try. It failed safely only because
every write path already fails closed — not because anything checked.

---

## 2c. Findings belonging to 0045 — S-45A and S-45B

Both are new with 0045. Neither meets the P1 bar: there is no evidence of a
cross-user write, privilege escalation, authentication bypass, or silent durable
data loss. Both are carried into the next infrastructure sprint. **No migration
0046 is opened here.**

### S-45B — routine EXECUTE broader than intended — **P2**

Live privilege inspection reports EXECUTE on `push_guarded_rows` and
`guarded_assignments` for `anon`, `authenticated`, `postgres` and
`service_role`. The migration intended `authenticated` only.

**The live privileges do not match the intended grants.** That distinction is
kept deliberately, and the two halves must not be collapsed:

- *Authorization boundary appears intact.* Both functions are `SECURITY
  INVOKER`, so they run as the caller. An `anon` caller has no `auth.uid()`, so
  the RLS predicate `auth.uid() = user_id` matches nothing: the row is neither
  readable nor writable, and `push_guarded_rows`'s own pre-read returns null.
  No evidence that anon can mutate or read another user's records.
- *Routine exposure is broader than intended.* That is a least-privilege
  deviation regardless, and it is not what the migration text says.

**Why it happened — and why the rehearsal did not catch it.** The migration does
`revoke all ... from public` then `grant execute ... to authenticated`. Supabase
configures `ALTER DEFAULT PRIVILEGES` granting EXECUTE on new `public` functions
to `anon` / `authenticated` / `service_role`, applied at CREATE time as
*role-specific* grants — and `REVOKE ... FROM public` does not remove a grant
held by the `anon` role itself.

The rehearsal asserts `§28 anon cannot execute it` and that assertion is
**green**. It is green for a reason that does not hold in production: the
rehearsal *creates* a bare `anon` role (`create role anon nologin`) on a
throwaway cluster with no default privileges configured, so there is no default
grant for the REVOKE to miss. The assertion is therefore true of the rehearsal
and **not evidence about production**. External verification is what caught it.

Follow-up for the next infrastructure sprint: an explicit
`revoke execute ... from anon` (and a decision on `service_role`), plus either
modelling Supabase's default privileges in the rehearsal or withdrawing that
assertion's claim about production. It is left unchanged here because 076B is
frozen.

### S-45A — function search_path mutable — **P3**

`function_search_path_mutable` is reported for `public.enforce_sync_version`,
`public.push_guarded_rows` and `public.guarded_assignments`. WARN-level.

Classified P3 rather than higher for two reasons:

1. The escalation this warning normally guards — an attacker shadowing an
   object so a function executes it with the *owner's* privileges — requires
   `SECURITY DEFINER`. Externally verified: none of the three is
   `SECURITY DEFINER`. Under `SECURITY INVOKER` a caller shadowing a name is
   doing so at their own privilege level.
2. Reaching it needs the ability to `SET search_path` on the session. A
   PostgREST client cannot; it would require direct SQL access, which means
   credentials. *Stated as reasoning, not as a verified production fact —
   it was not tested against production.*

The unqualified references in 0045 are `information_schema.columns` and the
`pg_catalog` builtins (`jsonb_array_elements`, `jsonb_populate_record`,
`to_jsonb`, `format`, `string_agg`); the guarded tables themselves are already
schema-qualified as `public.%I`.

Follow-up: pin an explicit `set search_path` on the three functions.

### Not attributable to 0045

These advisor items pre-date this migration and must not be counted against it:
`private.integration_credentials` RLS enabled without policies (intentional
private-schema architecture), `public.beta_signups` RLS enabled without
policies, mutable `search_path` on several older functions, the `vector`
extension in `public`, and leaked-password protection disabled.

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

## 4. Closure — F-1 and F-2

Database-enforced stale-write protection is now deployed. Both P1 classes are
**CLOSED**. The deterministic lifecycle evidence is retained as the proof of the
client behaviour; the live guard behind it is the externally verified evidence
above.

### F-1 — P1 CLOSED

A and B read Action v1. A completes → v2. B's stale defer → **refused**.

- `status` remains `completed`
- `completed_at` remains
- the completion history entry remains
- B's rejected local intent is preserved and recoverable
- no silent reopening

*(`scripts/inject-076-cas-client.cjs` sections O1–O11.)*

### F-2 — P1 CLOSED

A and B read Note v1. A edits → accepted v2. B's stale edit → **refused**.

- the accepted server prose remains
- B's rejected authored prose remains recoverable, and survives a reload
- `ConflictNotice` resolves deliberately — "Use my version" becomes a new
  current-version write
- no AI merge, no silent overwrite

*(`scripts/inject-076-cas-client.cjs` sections P1–P10.)*

---

## 4b. Final gate run — all green, no assertion weakened

| Gate | Result |
|---|---|
| Migration rehearsal through 0045 (real PostgreSQL 16) | **143/143** |
| CAS-client (F-1, F-2, commit-then-timeout, reopen, conflict recovery, tombstones, offline stale write, rapid mutation, archives, wiring, E-7) | **84/84** |
| 076B live-window | **9/9** |
| 076 sync-recovery (account switch, sign-out, local-save retry) | **95/95** |
| 075 cross-device | **135/135** |
| 074 adversarial / isolation / dimensions / local / remote / tombstone | 47 · 31 · 50 · 30 · 47 · 43 |
| 076 browser (desktop + mobile) | **271/271** |
| 074 sync-truth / reachability / browser-failure | 31/31 · 145/145 · 25/25 |
| Release audit | **17/17** |
| Security audit (RLS, secrets, routes, auth, deps) | all pass |
| Route smoke (dev gated) · export verify | 24/24 · 14/14 |
| tsc · eslint · build | clean · 0 errors (2 pre-existing warnings) · exit 0 |
| Full deterministic regression | **4142/4142** across 42 suites |

`tag-ready: false · open blockers: 1` is the pre-existing "v1.0.0-rc1 tag
prepared, not created until gates pass" checklist item, unchanged.

---

## 5. Carried forward

### F-3 — OPEN. The next infrastructure sprint.

The client/server schema compatibility gate cannot compare the client against
the actual deployed migration head. Its only production caller supplies
`remoteMigrationVersion = EXPECTED_MIGRATION_VERSION` — the check compares the
constant to itself, so it can never fire.

Not repaired in 076B: wiring it to a real server read is new behaviour outside
this bounded repair and would change deploy semantics.

It is now materially more important than it was, and 0045 is the reason: schema
compatibility no longer merely affects *which columns exist*, it affects
**whether a write is accepted at all**.

The evidence is now concrete rather than theoretical: the 0045 client reached
production before the 0045 database migration, and the app could not identify
the mismatch before attempting guarded writes. It failed safely — but only
because every write path already fails closed, not because anything checked.

**F-3 — the client/server schema compatibility gate is unwired to deployed
truth.** Its production caller supplies `remoteMigrationVersion =
EXPECTED_MIGRATION_VERSION` instead of reading the deployed schema state, so the
check compares a constant with itself. Not fixed here. It is also why the head bump from 0044
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

External confirmation has arrived and is recorded above under
`EXTERNALLY VERIFIED DEPLOYED EVIDENCE`. Reports may now state:

```
repository head = 0045
deployed head   = 0045
migration parity = PASS
```

Two rules survive the confirmation and still apply.

1. **Attribution.** The live checks were performed outside this environment.
   Nothing may be phrased as though they were executed from here; this
   environment holds no production Supabase credentials or CLI.
2. **Inference remains forbidden.** Deployment state is never to be inferred
   from the migration rehearsal, the existence of a SQL file, a green build, or
   branch state — a lesson S-45B makes concrete: the rehearsal's own
   `anon cannot execute` assertion is green and is *not* evidence about
   production.
