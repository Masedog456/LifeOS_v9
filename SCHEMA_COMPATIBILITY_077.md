# LIFEOS-077 — Schema Compatibility & Safe Deployment

**North star:** the app should know whether the database it is talking to can
safely accept its writes.

**Status: IMPLEMENTATION READY — AWAITING DEPLOYED 0046 PARITY.** Migration
0046 was approved and is written; the client reads it, and the write path
consults the answer. Base SHA `b7fa54bda614c011aeca492d37b97a5097909881`.

```
repository migration head = 0046
production Supabase head  = 0045      ← not changed from here
```

0046 has **not** been applied from this environment. As with 0045, production
application and verification happen externally and will be recorded as
`EXTERNALLY VERIFIED DEPLOYED EVIDENCE`.

> ### Deployment ordering is not optional here
>
> **0046 must be applied to production BEFORE the 077 client ships.**
>
> This is not a preference. Against a 0045-only database the contract function
> is absent, the verdict is `unavailable`, and — correctly, per §25 — the
> guarded domains are gated. Shipping the client first would pause Notes and
> Actions until 0046 landed: fail-closed, no data loss, work queued, but a
> self-inflicted repeat of the very incident this sprint exists to prevent.
>
> This is the expand-contract model applied to itself, and it is the first real
> test of whether the lesson took.

---

## 1. F-3 root cause — three defects, not one

F-3 was reported as "the compatibility gate compares the expected version to
itself". The audit found that is the *least* severe of three, and all three were
measured, not inferred.

### F-3a — the input is fabricated

`evaluateCompatibility` has exactly **one** production caller,
`components/security/DiagnosticsCenter.tsx:47`, and it passes

```ts
remoteMigrationVersion: health?.mode === "supabase" ? EXPECTED_MIGRATION_VERSION : null
```

Measured: that call site returns `ok` / `canSync: true`, and **can only ever
return `ok`**, because it compares a constant with itself.

### F-3b — the output is unused, and the product reports the opposite

This is the serious one. `syncIsSafe()` has **zero** production callers. No
write path imports or consults `schema-compatibility` at all.

Measured, driving the real persistence layer with the gate returning
`read-only` / `canSync: false` / `syncIsSafe() === false`:

```
server-ahead verdict: read-only  canSync: false  syncIsSafe: false
  wrote to server despite syncIsSafe()===false: true
  health after: synced
```

The write landed **and the app reported `Synced`**. The module computes the
correct answer and the product contradicts it.

### F-3c — there is no channel to read

No code anywhere queries `schema_migrations`, a migration version, or any
deployed contract. Even a correctly wired caller would have nothing to read.

**F-3c is why this sprint needs a migration.** F-3a and F-3b are wiring bugs
fixable in the client; F-3c is a missing capability, and §3 rules out inferring
it from repository files, client constants, build metadata, or bundle version.

### Why this is the LIFEOS-074 D-24 pattern, for the third time

074 D-24, 075, and now F-3: a mechanism built, correct in isolation, and
consulted by nothing. §20 makes it a rule for this sprint — a compatibility
module with no real backend read is an automatic failure.

---

## 2. Audit — the complete production compatibility path

| Point | Finding |
|---|---|
| `EXPECTED_MIGRATION_VERSION` | `= 45`. Consumed by release model, backup export, diagnostics — never compared against a server |
| Compatibility helpers | `evaluateCompatibility`, `syncIsSafe` in `lib/security/schema-compatibility.ts` |
| Callers | one, `DiagnosticsCenter` (route `/security`), feeding the constant to itself |
| `syncIsSafe` callers | **none in production** |
| Initialization | `lib/persistence.ts:551` `markBootstrap`, `:578` `client.auth.onAuthStateChange` — the natural once-per-session hook, currently reads no contract |
| Adoption | `adoptionSettled` gates pushes until the adopt decision lands; no compatibility input |
| First remote read | `loadState()` — reads rows, learns nothing about schema |
| First remote write | `saveStateByDomain` → per-domain push; **no compatibility check** |
| Offline startup | `navigator.onLine` at `:329`; health `offline`; no contract concept |
| Reconnect | retry timers only — there is no `online` event listener |
| Refresh | module state is rebuilt; nothing durable about compatibility |
| Failure UI | `SyncStatus` — 8 health states, none of which means "incompatible backend" |
| Retry | `retrySync()` replays dirty domains; would replay into an incompatible backend forever |
| Diagnostics | `/security` shows a compatibility verdict computed from the self-comparison |

**Where the app learns deployed schema state today: nowhere.**

---

## 3. Contract model — options compared

§3 requires deployed backend truth; §4 asks whether raw migration numbers should
be exposed at all.

| Option | Authoritative? | Migration? | Verdict |
|---|---|---|---|
| **1. `app_schema_contract()` RPC returning a contract, baked at migration time** | **Yes** — the value ships *with* the migration, so it cannot claim a contract that was not applied | **Yes** | **Proposed** |
| 2. Expose `supabase_migrations.schema_migrations` via PostgREST | Yes | Grants + exposure | **Rejected** — leaks the internal ledger (§4) and couples the client to migration numbering |
| 3. Capability probing (`select sync_version … limit 0`, empty-payload RPC) | Partly | No | **Rejected as primary** — N probes for N capabilities, cannot express "database is newer", and "call it and see" is what §12 forbids. Retained only as the transitional fallback in §4 |
| 4. PostgREST OpenAPI root (`GET /rest/v1/`) | Probably | No | **Rejected** — large, permission-dependent, couples us to PostgREST internals. **Untested**: no production credentials here |

### The signal, as built

```
public.app_schema_contract() → jsonb
  { "contract": <int>, "min_client_contract": <int> }
```

- **`contract`** — the capability contract the deployed database *provides*. Not
  a migration number. It increments only when a migration changes
  client-visible capability, so index tweaks and RLS rewording never move it.
- **`min_client_contract`** — the oldest client contract the database will still
  accept writes from. Lets the database *declare* old clients unsafe rather than
  letting them discover it.

Contract ladder as it stands:

| Contract | Means |
|---|---|
| 0 | Database does not self-describe (pre-0046). Transitional only |
| 1 | Pre-0045: no stale-write guard |
| 2 | 0045 applied: `sync_version` + `push_guarded_rows` on `notes` and `next_actions` |

The user never sees any of this. `0045`, `schema_migrations`, RPC names and
Postgres jargon stay inside developer diagnostics (§17).

### The bootstrapping limit, stated plainly

The first contract migration cannot make *older* databases self-describing. A
database without `app_schema_contract()` is **contract 0 — unknown**, and 0044
and 0045 are indistinguishable through this channel alone. Production is at 0045
and would be at 0046 immediately, so this is a one-time transitional state; the
client resolves it with a single read-only capability probe (Option 3, used only
here) or, failing that, gates the guarded domains. It is a real limit and is not
papered over.

---

## 4. Compatibility semantics — not equality

The current model is effectively `client === server`, which makes *both*
deployment orders impossible: applying the migration first breaks the running
build, and shipping the build first breaks until the migration lands. That is
precisely the trap 076B hit.

Proposed rules:

| Condition | Meaning | Action |
|---|---|---|
| `client.contract ≤ server.contract` and `client.contract ≥ server.min_client_contract` | Compatible, including an **additive** migration the client does not yet know about | Full sync |
| `client.contract > server.contract` | Client needs capability the database lacks — **the 0045 incident** | Gate **only** the affected domains (§5); everything else syncs |
| `client.contract < server.min_client_contract` | Database has declared this client unsafe | Gate affected domains; tell the user to update |
| Unknown / ambiguous / unreadable response | Cannot be established | **Fail closed** on guarded domains (§7) |

A newer database is no longer an error by default. That single change is what
makes ordinary additive migrations deployable in either order.

---

## 5. Write gating — smallest blast radius

An explicit, small capability map — not a per-domain table of 46 entries:

```
guarded domains (notes, nextActions) require contract ≥ 2
every other domain                   requires contract ≥ 0
```

So an incompatible backend gates **two** domains, not forty-six. This is the
§8 requirement and it matches what 076B measured: during the live window the
unguarded domains kept syncing correctly on their own.

Local durability is untouched (§9): the sequence stays *local mutation → local
durable save → remote attempt later*. Compatibility checking must never become
an availability dependency for local use.

---

## 6. Deployment matrix

| Type | Example | Safe order |
|---|---|---|
| **A** additive, backward-compatible | new nullable column | Either order. Contract may bump; `min_client_contract` unchanged |
| **B** client-required | client wants a new capability | **Migration first**, then app. Old clients unaffected |
| **C** database-required | **0045** — the database starts refusing old clients | See below |
| **D** breaking | incompatible rewrite | Migration → app → raise `min_client_contract`; declared window |

### Type C without a window — the lesson from 0045

0045 was type C deployed as a single step, so the moment it landed, old clients'
guarded writes were refused. That window is avoidable by **splitting the
migration**:

```
C1  add sync_version + push_guarded_rows, NO trigger   (permissive)
        ↓  contract bumps to 2; old clients unaffected
    deploy the new app
        ↓  every live client now advances sync_version
C2  add the enforcing trigger, raise min_client_contract
```

Between C1 and C2 both client generations work. Nothing is refused, nothing is
corrupted, and no user sees a sync failure. **This is the architectural answer
to §6** and the thing worth carrying into every future guard-style migration.

---

## 7. User-facing behaviour

Consequence language only:

> **Conqify is updating.** Your changes are safe on this device and will sync
> when the update finishes.

Two rules on that sentence:

1. "safe on this device" is only shown when the local write actually
   **succeeded** — `writeLocal` already returns a boolean and `localError`
   already exists (LIFEOS-076 E-2). If the local save failed, the existing
   local-error state takes precedence and offers its own retry.
2. Raw `RPC missing`, `column does not exist`, `function not found` never reach
   ordinary UI. They belong in `/security` diagnostics.

No false "Synced" — which is exactly what F-3b produces today.

---

## 8. Old-tab case (§11) and recovery (§10)

**Old tab.** Tab A is open across a deployment; the database contract advances
and `min_client_contract` rises. Tab A's next mutation must: keep the work
locally durable, not corrupt newer protected state (the 0045 trigger already
guarantees this, and is not weakened), recognise the compatibility state rather
than discovering it through a failed write, show truthful bounded status, and
advise reload **only** when genuinely required. Detection cannot rely on refresh
timing: the contract is re-read on reconnect and after a gated failure, not only
at startup.

**Recovery.** When compatibility becomes valid, queued work resumes on the
existing retry path — no logout, no refresh, no export/import, no re-entry. To
be proved, not asserted.

---

## 9. Performance (§21)

The contract is read at **session acquisition** (`onAuthStateChange`), cached in
memory with a bounded TTL, and re-read on reconnect and after a gated failure.
**Never once per write.** To be measured, not assumed.

---

## 10. Security follow-ups carried from 0045

### S-45B — P2 — routine EXECUTE broader than intended

Live EXECUTE on `push_guarded_rows` and `guarded_assignments` includes `anon`,
despite the migration intending `authenticated` only.

The mechanism, which must be designed around rather than re-tripped: Supabase's
`ALTER DEFAULT PRIVILEGES` grants EXECUTE on new `public` functions to `anon` /
`authenticated` / `service_role` at CREATE time, as **role-specific** grants —
and `REVOKE ALL … FROM public` does not remove them.

Planned: explicit `revoke execute … from anon`, an intentional decision recorded
for `authenticated` / `anon` / `service_role` / `postgres`, and the same
treatment applied to the new contract function so this sprint does not create
the very problem it is fixing.

**The rehearsal must stop making a claim it cannot support.** Its
`§28 anon cannot execute it` assertion is green because it *fabricates* a bare
`anon` role on a throwaway cluster with no default privileges to miss. Either
the rehearsal models Supabase's default privileges, or that assertion is
narrowed explicitly to say what it actually tests (§19).

### S-45A — P3 — mutable function `search_path`

Pin an explicit `search_path` on `enforce_sync_version`, `push_guarded_rows`,
`guarded_assignments`, and on any new compatibility function.

---

## 11. Migration 0046 — as approved and written

As approved. `supabase/migrations/0046_schema_compatibility_contract.sql`:

1. `public.app_schema_contract()` returning `{contract, min_client_contract}`,
   `SECURITY INVOKER`, pinned `search_path`, granted to `authenticated` only
   with `anon` explicitly revoked.
2. S-45B — explicit least-privilege grants on the two 0045 functions.
3. S-45A — pinned `search_path` on the three 0045 functions.

Nothing else. No data migration, no table changes, no touching the 0045 guard.

---

## 12. Test redness (§18) — required, and performed in §15

Each must be proved to fail against current `main`: new client / old DB detected
**before** the incompatible write; old client / new DB handled truthfully;
malformed compatibility response; missing compatibility response; offline
startup; reconnect after upgrade; old tab; compatible domains continue; local
durability preserved; S-45B anon execution fixed; S-45A advisor issue fixed.

The F-3b probe above is the template: assert the *product's* behaviour, not the
module's return value.

---

## 13. D-23 discipline applies to the probe itself (§16)

The compatibility read must not repeat D-23. `error === null` with an unreadable
or malformed body is **not** trustworthy compatibility evidence — it is an
ambiguous outcome and fails closed, exactly as the LIFEOS-076B R9 repair
established for guarded pushes. D-23 remains **PARTLY CLOSED**; this sprint does
not attempt its general repair.

---

## 14. Remaining risks *(design-pass list; superseded by §16 below)*

- **Bootstrapping.** Pre-0046 databases cannot self-describe; 0044 and 0045 are
  indistinguishable through this channel. Bounded and transitional, but real.
- **The contract is a declaration.** A hand-edited database could report a
  contract it does not honour. Accepted: the value ships with the migration, and
  the 0045 trigger — not the contract — remains the actual enforcement.
- **`min_client_contract` is advisory to the client.** The database guard stays
  the real boundary and is not weakened.
- **Untested option.** The PostgREST OpenAPI route was rejected on design
  grounds and never tested; no production credentials exist here.
- **No live verification from here.** As with 076B, any production claim must
  come from external verification and be labelled as such.

---

## 15. AS BUILT — closure evidence

### F-3a — CLOSED

`DiagnosticsCenter` no longer supplies the remote side. It now passes
`getCompatibility().server.contract` — a number read from the database — while
`CLIENT_CONTRACT` supplies what the build expects. Two numbers, two sources.
Asserted structurally (I8) so the fabricated line cannot come back.

### F-3b — CLOSED, and this is the one that mattered

The verdict is consumed by `flush()` itself: gated domains are removed from the
dirty set **before** `saveStateByDomain`, so the push is never attempted; they
keep their old baseline, stay dirty, and health reports `incomplete`.

Red-proved by removing the gate entirely — the pre-077 behaviour returns
exactly:

```
FAIL  C2  guarded pushes attempted: ["upsert:goals","rpc:next_actions","rpc:notes"]
FAIL  E2  guarded remote writes happened
FAIL  E4  sync is not pretended to succeed — synced
FAIL  I6  health cannot say synced while a domain is gated
```

`E4 — synced` is F-3b reproduced: verdict incompatible, write lands, app says
Synced. A first attempt at this red proof only removed the filtering and left
the health branch, so several assertions passed for unrelated reasons; the
proof above removes the whole gate.

### F-3c — CLOSED

`app_schema_contract()` in migration 0046, read by
`SupabasePersistenceAdapter.loadSchemaContract()`. The chain is asserted edge by
edge (I1–I7): deployed truth → parser → session cache → per-domain decision →
dispatcher → domains held dirty → health not Synced → reprobe → recovery flush.

### Final contract shape

```json
{ "contract": 2, "min_client_contract": 1,
  "capabilities": { "guarded_notes": 2, "guarded_next_actions": 2 } }
```

Coarse contract, precise capabilities. `min_client_contract` is deliberately 1:
a pre-0045 client can still write the 44 unguarded domains, and declaring it
globally unusable would manufacture an outage the data does not justify.

### Security changes

- **S-45B** — `revoke execute … from anon` on `push_guarded_rows`,
  `guarded_assignments` and the new `app_schema_contract`. `service_role`
  retained deliberately (it already bypasses RLS; withholding EXECUTE buys no
  safety), `authenticated` granted, `anon` none.
- **S-45A** — `search_path` pinned to `pg_catalog, public` on all four
  functions. Verified by a rehearsal query that no function in the family is
  left with a mutable path, so 0046 does not create the warning it fixes.

### The rehearsal repair — §22

The prior `anon cannot execute it` assertion was green because the harness
*fabricates* a bare `anon` role with no default privileges for a REVOKE to
miss. The rehearsal now runs `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE … TO
anon, authenticated, service_role` before any migration, and proves the hazard
is present before proving it is fixed:

```
✓ 077: §22 the rehearsal now reproduces Supabase default grants —
       a new function DOES reach anon
```

Without that first assertion the S-45B checks would prove nothing, which is
exactly the trap the old version fell into.

### Performance — §30

Measured: **50 mutations added zero contract probes.** The probe runs at session
acquisition, on reconnect, on explicit retry, and after a schema-shaped failure
— O(1) per lifecycle event, never per write. `__compatProbeCount()` exists so
this is a measurement rather than a claim.

### Evidence

| Gate | Result |
|---|---|
| Migration rehearsal through 0046 (real PostgreSQL 16) | **157/157** |
| 077 schema-compatibility (deterministic) | **51/51** |
| 076 browser incl. §27 old-tab, both viewports | **281/281** |
| 076B CAS-client · live-window | 84/84 · 9/9 |
| 076 sync-recovery · 075 cross-device | 95/95 · 135/135 |
| 074 adversarial/isolation/dimensions/local/remote/tombstone | 47·31·50·30·47·43 |
| 074 sync-truth / reachability / browser-failure | 31/31 · 145/145 · 25/25 |
| Release audit · security audit | 17/17 · all pass |
| Route smoke (dev gated) · export verify | 24/24 · 14/14 |
| tsc · eslint · build | clean · 0 errors (2 pre-existing warnings) · exit 0 |
| Full deterministic regression | **4142/4142** across 42 suites |

### A regression this sprint caused, found and fixed

Wiring the gate broke twelve assertions in the 076 harness. Two distinct causes,
both real:

1. `__setRemoteForTest` swapped the adapter without clearing the verdict, so one
   section's gating leaked into the next. Fixed in the product, not the test —
   attaching a different remote genuinely makes the old answer meaningless.
2. The 076 and 075 fakes model a database with no `app_schema_contract`, so the
   client correctly read "cannot establish the contract" and gated. The fakes
   now answer the contract, because they claim to be current databases.

The second one is worth keeping in view: it is the same shape as the ordering
warning at the top of this document, discovered in a harness first.

---

## 16. Remaining risks, restated

- **Ordering.** 0046 must reach production before the 077 client. See the top of
  this document; it is the one thing that can turn this repair into an incident.
- **Bootstrapping.** A database without `app_schema_contract()` is unreadable,
  not "old" — 0044 and 0045 are indistinguishable through this channel. Handled
  by failing closed on the guarded domains, which is why ordering matters.
- **The contract is a declaration.** A hand-edited database could advertise a
  capability it does not honour. Accepted: the value ships with the migration,
  and the 0045 trigger — not the contract — remains the enforcement. §28's
  layered defence is unchanged: compatibility is early warning, never a
  replacement for the server invariant.
- **`min_client_contract` is advisory to the client.** The database guard stays
  the real boundary.
- **D-23 remains PARTLY CLOSED.** Compatibility probing does not repeat it — an
  unreadable body fails closed — but the general repair is out of scope.
- **No live verification from here.** Every production claim must come from
  external verification and be labelled as such.

**LIFEOS-077 IMPLEMENTATION READY — AWAITING DEPLOYED 0046 PARITY.**

Nothing in §39 begun.
