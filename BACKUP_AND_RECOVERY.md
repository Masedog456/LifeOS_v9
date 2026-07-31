# Backup & Recovery (LIFEOS-040)

LifeOS holds years of personal knowledge. This layer guarantees the user can
**export everything, verify it, restore it safely, and recover from mistakes** —
all locally, with no secrets and no silent data loss.

## Export format

`lib/backup/export.ts` builds a deterministic JSON **account archive**:

```
{
  metadata:  { archiveVersion, appVersion, stateSchemaVersion, migrationVersion,
               generatedAt, timezone, pendingMutations, recordCounts },
  collections: { <every StoreState domain> : [...] },   // 40 domains, stable order
  prefs:      { onboarding, recent, pinned, workspace, execution, insights },
  tombstones?: [...],  conflicts?: [...],                // optional, for fidelity
  manifest:   { entries: [{collection,count,checksum}], totalRecords, overallChecksum }
}
```

- **Deterministic** — the same state + fixed clock yields identical bytes.
- **No secrets or tokens** — a self-test (`assertNoSecrets`) fails the archive if
  any `access_token`/`service_role`/`password`/JWT-shaped value appears.
- **Discloses pending local mutations** at export time.
- **Manifest checksums** use a dependency-free FNV-1a over *canonical* JSON
  (keys sorted), so verification is order-independent. This is
  integrity/consistency, not tamper-proofing (documented; no crypto library).
- **CSV bundle** for tabular collections; **streaming NDJSON** variant
  (`streamArchiveLines`) avoids holding several copies of a large archive in
  memory.

Exports are user-triggered from `/backup` (also reachable from the Privacy
Center and the account-deletion flow).

## Verification (without importing)

`lib/backup/verify.ts` checks an archive stands on its own: it parses, the
archive version is supported, the manifest matches the included collections,
record counts reconcile with `metadata.recordCounts`, and referenced ids are
represented or flagged external/deleted (e.g. a citation pointing at a document
not in the archive is a *note*, not an error). It returns a human-readable
report. `/backup` → **Verify export** shows it.

## Import & restore

`lib/backup/import-preview.ts` + `restore.ts` make restore safe:

1. **Verify** the archive (version validated; malformed archives rejected).
2. **Preview** every change per domain — new ids vs duplicate ids, added /
   updated / removed counts — for **merge** (upsert by id) or **replace**.
3. **Dry run** computes the exact result without touching the store.
4. **Destructive restores require explicit confirmation** (overwriting or
   removing existing records). Non-destructive imports apply directly.
5. Apply is **transactional in memory** (build the whole next state, then swap
   via `replaceState`) and keeps a **rollback** snapshot.

Import never trusts archive HTML/URLs and never imports auth secrets (there are
none in the archive by construction).

## Local backup

The export IS the local backup: user-triggered, canonical format, clear
timestamp, visible success/failure, no background download, and **no claim of
cloud backup** unless remote sync confirms it. No notifications are introduced.

## Recovery Center

`/recovery` (`lib/backup/recovery.ts`) is a read-only projection of everything
recoverable, each with a **preview of impact**: recently discarded captures,
archived projects/documents/research, unresolved sync conflicts (link to the
conflict center), corrupt local preferences (safe to reset), incomplete
migrations, and failed imports / interrupted exports. **No automatic repair of
ambiguous state** — the user chooses.

## Performance

Self-test §7 (20,000 actions + 10,000 captures → 30k records): building the full
archive and verifying it each complete in well under the 1,500 ms budget on CI;
counts reconcile exactly.

## Validation

Backup self-tests **38/38**; security E2E covers export→verify, import
preview→dry-run, restore confirmation, recovery listing, and keyboard-only
export. See `SECURITY_AND_PRIVACY.md` for the full gate.
