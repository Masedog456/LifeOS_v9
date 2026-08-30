# LIFEOS-076 — Conflict Integrity Design (migration 0045 proposal)

**Design only. No migration written, no schema applied. Head remains 0044.**

---

## 1. The exact P1 set, after the note-body retest

Two, not one.

### F-1 — a stale defer erases a completion

```
A completes "File the return"          09:00
B, holding a copy from 08:30, defers   B's push arrives SECOND

server: status = deferred
        completed_at = null
        the "completed" history entry = GONE
```

### F-2 — a note body is unrecoverably lost — **RECLASSIFIED P1**

The gate asked for the complete lifecycle. Run end-to-end through the real
adapter and the real adoption path, both devices editing, both pushing, both
adopting:

| Question | Answer |
|---|---|
| Is A's authored body recoverable anywhere? | **No** — not on the server, not on A, not on B |
| Is B's authored body recoverable? | Yes — B won by arrival order |
| Does either client retain the losing version after convergence? | **No** |
| Is any conflict or warning surfaced? | **No** — 0 Recovery Center candidates, no conflict record |

The sharpest detail: **Device A's own machine silently overwrites the text A
wrote.** Adoption is remote-wins-by-id, so the authoring device replaces its own
durable local prose with the other device's version, unprompted. A `Note` has no
`history`, no `revisions`, and no version field — there is nowhere for the loser
to live.

That is silent loss of a locally *and* remotely durable user-authored fact.
**P1.** It is not generic LWW debt.

Caveat stated rather than glossed: a backup exported *before* the conflict would
contain A's text. That is the user having made a copy, not the system retaining
anything.

## 2. Legitimate Action restore semantics — audited

`reopenAction` (`lib/mvpStore.ts:5185`) and `restoreAction` (`:5285`) already
exist. Both set `status`, clear `completedAt` / `cancelledAt`, and **append** a
history event (`action: "reopened"`, with `fromStatus` / `toStatus`).

`appendHistory` (`lib/actions/history.ts:84`) is strictly append-only —
`[...a.history, event]`, with only a 1-second dedupe guard. `history` is a jsonb
column that round-trips in both directions. So an action's history is a
monotonically growing record that travels with the row.

**This matters for option A**, and it is the reason option B needs no special
case for restore — see §6.

## 3. Option A — narrow server-side semantic guard

Reject a transition from a terminal server state (`completed` / `cancelled`) to
a non-terminal incoming state, unless the incoming row carries evidence of a
deliberate reopen.

**Can the server distinguish a stale defer from an intentional restore?**
For this class, **yes**, and reliably:

- a **stale** client's history contains **no** `completed` entry at all — its
  copy predates the completion;
- a **legitimate reopen** carries the `completed` entry **plus** a later
  `reopened` entry, because history is append-only.

So `incoming.history ⊉ server.history` is a sound stale signal, evaluable inside
a transaction, with no new column.

**Why it is not enough:**

1. It closes F-1 only. **It does nothing for F-2** — a `Note` has no history, no
   status and no terminal state, so there is no semantic signal to read. With
   F-2 now P1, option A alone cannot close the sprint.
2. It is a semantic rule per record class. Every future class needs its own,
   and each is a place to get the semantics subtly wrong.
3. There is a residual ambiguity it cannot resolve: a client that synced *after*
   the completion, then went stale, holds the `completed` entry and could still
   push a defer. Rarer, but the guard would wave it through.

**Verdict: correct as far as it goes, insufficient as the whole repair.**

## 4. Option B — row version / compare-and-set

```sql
-- concept only
next_actions.sync_version bigint not null default 1
notes.sync_version        bigint not null default 1
```

Client submits its expected version; the server updates atomically only when the
version still matches, and increments. Zero affected rows means the write was
stale and the current server fact is left alone.

**Evaluated against every case the gate names:**

| Case | Behaviour |
|---|---|
| Reload | Versions are re-acquired from the server before any guarded push — see §5 |
| Offline edits | Push fails on the network first; on reconnect versions are refreshed, then CAS decides |
| Adoption | Already reads full rows; carries `sync_version` in with them |
| Retry | Retries the reconciled intent, never the same stale version forever (§9) |
| Rapid mutations | Same-device sequential pushes each carry the version the previous push returned |
| Tombstones | A deleted row has no version; a stale edit finds nothing to update and is rejected — **stronger** than today, see §11 |
| Intentional restore | **Needs no special case** — a deliberate reopen is performed by a client holding the current version, so it is simply not stale |
| Recurring actions | `recurrence` is a column on the same row; no separate treatment |
| History | Preserved, because the losing write never lands |
| File sync | Untouched — blobs and `reading_document_files` are outside this |
| Backwards compatibility | See §14 |

That "needs no special case" line is the decisive advantage over option A:
**version identity already encodes intent.** The server never has to interpret
what the user meant.

It also fixes F-2 in the way that matters. B's stale write is rejected, so A's
prose survives on the server and on A; B still holds its own text locally and is
told. **Nothing becomes unrecoverable** — silent destruction becomes a held local
intent plus a warning, which is what §11 asks for.

**Costs, stated honestly:** an RPC (bulk PostgREST upserts cannot express a
conditional update), a reconciliation path, a conflict-indication UI, and
version bookkeeping on the client.

**Verdict: chosen.**

## 5. Option C — `updated_at` guard

**Rejected, on evidence.**

- `updated_at` is written by the **client**: `actionToRow` sends
  `updated_at: a.updatedAt`, and `noteToRow` the same. The column default
  `now()` never applies, because the value is always supplied.
- No trigger anywhere in the chain overwrites it server-side.
- Two devices therefore compare *their own clocks*, which can differ or be
  wrong, and equal timestamps are possible.
- Worst of all, the stale client controls the field being used to judge it.

Using it as a concurrency authority would be a guard the attacker holds the key
to. Not viable.

## 6. Chosen approach

**Option B, scoped to the two proven P1 classes: `next_actions` and `notes`.**

Per §12, no other domain is versioned. Each future addition must be justified by
its own mutation semantics, not by consistency.

Option A's insight is kept but not implemented as a separate mechanism: under
CAS, a legitimate reopen is simply a non-stale write.

## 7. Proposed schema + RPC

```sql
-- 0045_sync_version_guard.sql  (PROPOSED — NOT WRITTEN)

alter table public.next_actions add column if not exists sync_version bigint not null default 1;
alter table public.notes        add column if not exists sync_version bigint not null default 1;

-- Conditional batch write. Returns the ids it REJECTED plus their current rows,
-- so the client can reconcile without a second round trip.
create or replace function public.push_guarded_rows(target text, payload jsonb)
returns jsonb
language plpgsql
security invoker            -- RLS still governs; this is not a privilege escalation
as $$ ... $$;
```

Per row in `payload`:

- `expected_version` **null** → insert if absent; if the row exists, **reject**
  (the client believed it was new and was wrong).
- `expected_version = N` → `update … where id = ? and user_id = auth.uid() and
  sync_version = N`, setting `sync_version = N + 1`. Zero rows affected →
  reject.

`security invoker` matters: RLS remains the ownership boundary, exactly as it is
for every other write. The RPC adds a concurrency condition, not an authority.

## 8. Adapter changes

`syncNextActions` and `syncNotes` stop calling `.upsert(rows)` and call
`push_guarded_rows` instead. Everything else — the 44 other domains, deletes,
tombstones, the per-domain isolation from 074 D-22 — is untouched.

The version travels **in-memory**, refreshed on every adoption and updated from
each RPC result. It is deliberately **not** persisted and **not** put on the
record type:

- `migrateOrAdopt` already reads every row before any push is allowed
  (`adoptionSettled` gates the flush), so after a reload versions are current
  before they are needed;
- putting `syncVersion` on `NextAction` / `Note` would ride inside the state
  blob and survive reload for free, but ~200 store mutators would each have to
  preserve it, and this codebase's repeated lesson is that hand-maintained
  invariants drift;
- a separate persisted map would cost ~500 KB at 12,000 records against an
  already-large localStorage budget.

The one gap that leaves is a **reconnect after an offline reload**, where
adoption may not have run. Policy: if any guarded row is dirty and its version is
unknown, issue one narrow refresh (`select id, sync_version from …`) before
pushing. One small query, no persistence, no drift.

## 9. Reconciliation on rejection

Never auto-force a local overwrite, and never resend the same stale version.

```
CAS reject
  → the RPC has already returned the current server row
  → adopt the server row as authoritative for that record
  → KEEP the local intent, unapplied, so it can be explained and reapplied
  → mark that record conflicted; stop retrying it
  → the rest of the push is unaffected (074 D-22 isolation still holds)
```

Retry then operates on the reconciled intent, not the rejected one. A record's
conflict clears when the user reapplies or discards it.

## 10. UI behaviour

Bounded, per §6 — no conflict dashboard.

- On the record: **"Changed on another device."** with the option to see what
  was not applied and reapply it deliberately.
- The sync indicator does **not** go to `Sync failed`: the sync itself worked.
  A rejection is not a transport failure and must not become "Sync failed
  forever".
- The status popover gains one line when conflicts exist, in consequence
  language, with no domain or table vocabulary.
- Prose is never merged, and no AI is involved. Both versions are shown; the
  person chooses.

## 11. Tombstone interaction

Tested, not assumed. A deleted row has no version, so a stale edit's
`expected_version = N` matches nothing and is rejected — where today an upsert
recreates it. **CAS strengthens D-24 / C-2 rather than weakening it**, because it
closes the resurrection path that exists *before* the marker lands.

One rule must be explicit: `expected_version = N` must **never** fall back to an
insert. That fallback would reintroduce exactly the resurrection this prevents.

The known race window is unchanged and still not atomic: a delete whose tombstone
write fails leaves no marker, and a client that never saw the row can still
create it. That stays documented.

## 12. Offline behaviour

```
B goes offline at version N
A mutates the server to N+1
B mutates its stale copy locally  (durable on B, correct)
B reconnects
  → version refresh
  → B's push carries expected = N
  → server holds N+1 → REJECTED
  → A's fact survives; B keeps its intent and is told
```

This is the §8 case and it is the whole point of the design.

## 13. Rollback

The migration is additive: two columns with defaults, plus one function. Rolling
back means `drop function public.push_guarded_rows` and reverting the adapter to
`.upsert`; the columns can stay harmlessly (an unused `bigint` with a default
breaks nothing) or be dropped separately. No data is transformed, so no data is
at risk in either direction.

Forward-only limits already documented in `V1_ROLLBACK_REPORT.md` still apply.

## 14. Compatibility with existing rows

`default 1` fills every existing row on migrate. An older client that still
`.upsert`s ignores `sync_version`, so its writes succeed unconditionally —
meaning **mixed-version clients are unprotected until they update**. That is a
real limitation and must not be described as anything else; it argues for
shipping the client and the migration together.

## 15. Tests that will prove it

Red-first, as always. The F-1 and F-2 assertions already in
`scripts/inject-076-sync-recovery.cjs` are written the *other* way today — they
currently prove the loss — so they become the exact regressions, inverted.

**F-1 (§7 of the gate):**
- A completes → B stale defers → B rejected → server stays `completed`,
  `completed_at` intact, completion history intact
- A reloads → still completed; B reconciles → completed; no resurrection
- A completes → B stale reschedules → completion survives
- A completes → B stale changes project relation → policy asserted explicitly
- **a user deliberately reopens a completed action → it still works** (the fix
  must not make completed actions immutable)

**F-2:** A edits body → B stale edits → B rejected → A's body survives on the
server and on A; B keeps its own text and is told; nothing is merged.

**Offline (§8):** the sequence in §12, end to end.

**Retry (§9):** a rejected write is not resent with the same expected version;
the reconciled intent is what retries.

**Tombstones (§10):** stale edit after delete is rejected both before and after
the marker lands; D-24 / C-2 assertions unchanged and still green.

**Isolation:** 074 D-22 per-domain isolation still holds with the RPC in place.

**Rehearsal:** the chain applies clean and idempotent ×3; `sync_version` defaults
to 1 on existing rows; the RPC rejects a stale version and accepts a current one,
proved against real PostgreSQL.

## 16. Migration filename

```
supabase/migrations/0045_sync_version_guard.sql
```

Head would move 0044 → 0045.

---

## Also queued, pending this approval

**E-7** (P3) — `/dev/sync-tests` mutates the viewer's real store on render
(sections 58–61, pre-existing since 074). The bounded repair is to run those
store-driving sections against an injected//isolated store rather than the live
singleton, so rendering a self-test cannot touch anyone's life data. Held until
the P1 architecture is approved, per §14 of the gate.

## What is NOT proposed

- No wiring of `merge.ts`, `conflicts.ts`, or the six `merge-rules.ts` modules.
  D-8 stays frozen.
- No versioning of the other 44 domains.
- No prose merging, automatic or AI-assisted.
- No conflict dashboard.
- No change to file/blob sync.

---
---

# Part II — AS BUILT

Everything above was the proposal. This part records what was actually
implemented after approval, and how each claim is evidenced. Where a claim could
not be evidenced in this environment, that is stated rather than glossed.

## 17. The three pieces

| Piece | File | Proved by |
|---|---|---|
| The invariant, in Postgres | `supabase/migrations/0045_sync_version_guard.sql` | `scripts/migration-rehearsal.mjs`, against a real PostgreSQL 16 cluster |
| The client that consults it | `lib/adapters/supabaseAdapter.ts` | `scripts/inject-076-cas-client.cjs` |
| The recovery of refused intent | `lib/sync/conflicts-store.ts`, `lib/sync/conflict-view.ts`, `components/sync/ConflictNotice.tsx` | `scripts/inject-076-cas-client.cjs` + `scripts/smoke-076-sync-trust.cjs` |

## 18. Why the invariant is in the database and not in the client

§3 of the approval was explicit, and it is the whole design:

> the concurrency invariant must be enforced by Postgres, not only by the new
> client choosing to call an RPC.

`enforce_sync_version()` is a `BEFORE UPDATE` trigger on both tables. Every
writer is held to it — the current client, a future one, an outdated one still
doing a plain upsert, or `psql`. PostgREST's upsert assigns only the columns
present in the payload, so a client that has never heard of `sync_version`
leaves it untouched; `NEW` then equals `OLD`, which is not `OLD + 1`, and the
write is **refused**. An outdated client gets a write failure instead of the
power to destroy newer durable state. That trade is deliberate, and both shapes
of it — a bare `UPDATE` and a realistic `ON CONFLICT DO UPDATE` — are proved
against real PostgreSQL in the rehearsal.

`push_guarded_rows` is **not** where the invariant lives. It exists for one
narrower reason: a bulk upsert is a single statement, so one stale row's
exception would roll back every unrelated current row with it, undoing the
per-domain isolation LIFEOS-074 D-22 established. The function applies rows one
at a time and reports each outcome. It is `SECURITY INVOKER`, so RLS remains the
ownership boundary exactly as it is for every other write; it adds a concurrency
condition and never authority.

## 19. Why the refused write is kept, and kept on disk

§7 forbade the obvious client response — fetch remote, replace local, forget the
rejected edit — because that fixes server corruption while recreating F-2
locally: the user's own text would still vanish from their own machine.

So a rejection preserves the local record. §8 asked for the persistence decision
to be justified explicitly:

- The rejected value is user-authored prose, or a consequential state change.
- If it lived only in memory, a **reload** — the most ordinary thing a person
  does — would destroy it, and P1 protection would rest on volatile state.
- It is stored under its own device-local key (`lifeos.conflicts.v1`), never
  pushed, and never becomes a `StoreState` domain: it is a record of a sync
  event on this device, not a fact about the user's life.
- It is purged by `clearState`, so it cannot outlive the account on the machine.

One conflict per record: a second rejection for the same row replaces the first,
because the newer local attempt is the one the person still means, and stacking
every attempt would become the growing ledger §8 rules out.

## 20. What the person sees, and what they can do

`ConflictNotice` renders inline on the record itself — on the note, on the
action — because that is where someone is standing when they discover their edit
did not stick. A global banner could say something went wrong somewhere; it
could not say *which note*. The sync popover additionally carries a count and
links, so the conflict is discoverable without already knowing to look.

Three choices, and nothing else:

- **Keep the saved version** — take what the server holds.
- **Use my version instead** — reapply the refused record.
- **Copy my version** — take the text away, and *deliberately leave the conflict
  open*: losing the only remaining copy to a failed clipboard write would be the
  exact loss this sprint exists to stop.

Both decisions go through the **ordinary** mutators (`updateNote`,
`updateAction`, `completeAction`, `reopenAction`). There is no privileged write
path, no flag that switches the guard off. "Use my version instead" is a new,
intentional write made against the version the server actually holds — the
adapter learned that version from the rejection itself — so it is accepted the
same way any deliberate edit is. §9 required exactly that.

Nothing merges. No automatic merge, no field-level guessing, no AI. D-8 stays
dormant, and that dormancy is now asserted by the property that can actually
regress: nothing in the product ever *feeds* the merge engine.

## 21. §24 — `sync_version` is NOT in archives, structurally

The decision is no, and it is enforced by construction rather than by
remembering: the version lives in a `Map` inside the adapter and never reaches
`NextAction` or `Note`. A backup is built from `StoreState`, so there is no path
by which a version could enter one, and no path by which restoring an old
archive could carry a stale version into a live account.

The alternative — putting `syncVersion` on the record type — would survive a
reload for free, but would oblige ~200 store mutators to preserve it, and this
codebase's repeated lesson is that hand-maintained invariants drift. Adoption
already reads every row before any push is allowed, so the versions are current
before they are needed.

## 22. §26 / E-7 — a self-test page that deleted the viewer's account

The audit finding was that `/dev/sync-tests` mutated the real store. The repair
found it was **two** pages, not one: `/dev/action-tests` had the same defect,
introduced by LIFEOS-074 §1.

Both seed fixtures with `restoreState`, which goes through `setState`, which
calls `persist()` — `writeLocal` **plus** `scheduleRemotePush`. Opening either
page overwrote the viewer's local data with fixtures and pushed that to the
server. A browser probe caught a seeded record vanishing between one navigation
and the next.

The repair is a seam, not a rule people have to remember:
`withIsolatedStore(fn)` in `lib/mvpStore.ts`. Inside it the singleton still
mutates — the suites must drive the real code paths, which is why they were
written that way and why they catch what helper-level tests miss — but nothing
leaves the module: no local write, no remote push, no subscriber render.
`finally` restores the previous snapshot even if the suite throws.

`subscribe` was exported alongside the existing `getSnapshot` for one reason:
without it, "no subscriber ever observed fixture data" is an invariant nothing
outside the file can check, and an unobservable invariant is the kind that
quietly stops holding.

## 23. Evidence, and its limits

| Claim | Evidence | Kind |
|---|---|---|
| Trigger, constraints, RPC, grants, `SECURITY INVOKER`, old-client refusal | `scripts/migration-rehearsal.mjs` | Real PostgreSQL 16, throwaway cluster |
| Client consults the version; F-1 and F-2 replays; retry and commit-then-timeout; tombstones; archives; E-7 | `scripts/inject-076-cas-client.cjs` | Deterministic, in-memory model of the 0045 contract |
| Rendered UI: tap targets, aria, popover, conflict notice | `scripts/smoke-076-sync-trust.cjs` | Real Chromium against a production build |
| Everything else in 076 | `scripts/inject-076-sync-recovery.cjs` | Deterministic |

**What is not claimed.** There are no Supabase credentials or CLI in this
environment. Nothing here is a live deployed run, no live two-client round trip
was performed, and migration 0045 has not been applied to any deployed database.
The in-memory backend in the CAS harness models the 0045 *contract* so the
client half can be driven deterministically; it asserts nothing about Postgres,
and every Postgres claim above rests on the rehearsal instead.

## 24. Red proofs

Per §24 of the sprint gate, the new assertions were run against a deliberately
broken state to confirm they can fail, and fail for the intended reason:

- Reverting the two guarded pushes to plain upserts brings F-1 back exactly as
  originally reported — `status is deferred`, `completed_at null`, `history []` —
  and fails the §29 wiring checks.
- Making the conflict store memory-only fails both persistence assertions.
- Putting a table name into a user-facing string fails the vocabulary scan.
- The pre-076 tree is checked at a **pinned commit**, not `merge-base`, so the
  red proofs keep meaning something after this branch merges.
