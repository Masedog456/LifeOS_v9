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
