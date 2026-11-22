# Testing and CI

What runs automatically on every pull request, what each check proves, and
what still has to be tested by hand. Introduced in PR 2 (Automated Testing and
CI). Keep this file in step with `.github/workflows/ci.yml`.

## Commands

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Compiles `lib/` with `tsconfig.selftest.json`, runs every self-test suite (71 suites, 6,838 assertions), then 6 deterministic harnesses | Node only |
| `npm test -- --clock=2027-12-31T23:50:00-06:00` | The same, with the wall clock moved (it keeps ticking) | Node only |
| `npm test -- --filter=decision/` | Only suites whose path contains the text | Node only |
| `npm run typecheck` | `tsc --noEmit` over the whole project | Node only |
| `npm run lint` | ESLint (CI adds `--max-warnings=5`) | Node only |
| `npm run audit:security` | Runbook parity, schema compatibility, billing, extract, RLS, secret scan, routes, auth, production-dependency advisories | Node + npm registry |
| `npm run release:audit` / `release:export` | Static migration/release-model checks; export round trip | Node only |
| `npm run release:migrations` | Migration rehearsal on a throwaway PostgreSQL 16 cluster | PostgreSQL 16 + pgvector (below) |
| `npm run test:browser` | Browser regression smokes against a running local build | A running app + Chrome |
| `npm run release:routes` | Every production route answers; no `/dev/*` route is reachable | A running app |

Running the browser smokes locally:

```
npm run build && npx next start -p 3111 &
BASE=http://localhost:3111 CHROME=/usr/bin/google-chrome npm run test:browser
```

## What `npm test` fails on

The run fails, and never reports a pass, when any of these happens:

- an assertion fails;
- a suite throws, times out (180 s), or fails to load;
- a suite returns no `results` array, or zero assertions;
- a suite reports a `total` that differs from the results it returned;
- a `*selftest.ts` file has no `run…SelfTest(s)` export and is not declared in
  `INCLUDED_BY` (in `scripts/run-tests.mjs`) as run by another suite — this is
  how a suite silently stops running;
- a `*selftest.ts` source was not compiled (a `tsconfig` include dropped it);
- a harness exits non-zero;
- the isolation guard is not active (it probes itself before every run).

Verified by mutation: a broken assertion, a throwing suite, an empty suite, an
orphaned selftest file and a suite attempting network access were each injected
and each produced the expected result.

## Isolation: no production access

Enforced in code by `scripts/test-guard.cjs`, which `npm test` loads before
any test module and preloads into every harness it spawns:

- credential-shaped environment variables (Supabase, Postgres, Stripe,
  Anthropic, OpenAI, Vercel tokens, `DATABASE_URL`, `*_SECRET`, `*_API_KEY`,
  `*_TOKEN`, …) are deleted from the process;
- real DNS lookups, `fetch`, and every TCP connection whose resolved address is
  not loopback are refused with `ETESTNETWORK`.

And in CI by the workflow:

- no job references a secret, and `pull_request` (not `pull_request_target`)
  gives fork PRs none;
- `GITHUB_TOKEN` is read-only and not persisted by checkout;
- no job sets a Supabase, Postgres, Stripe or AI variable — the app is built and
  served in local-only mode, and the AI client falls back to its offline answers;
- the migration rehearsal uses a throwaway local cluster on a unix socket;
- `test:browser` refuses any `BASE` that is not localhost;
- the only outbound traffic is package installation (npm registry, Ubuntu
  archive) and Google Fonts during `next build`. None of it is a paid service.

## What CI validates

| Job | Proves | Does not prove |
| --- | --- | --- |
| **Typecheck & lint** | The whole project type-checks; no lint errors; lint warnings do not grow past 5 | Runtime behaviour |
| **Self-tests** ×5 | All 71 suites and 6 harnesses pass in UTC and America/Chicago today, and at three future moments in Chicago or UTC (New Year's Eve 23:50, DST spring-forward, leap day) | Correctness in time zones far from UTC (see gaps) |
| **Audits** | No high/critical advisory in any dependency; the 9 security audits; static release and migration model; export round trip | Behaviour of a deployed environment |
| **Migration rehearsal** | Every migration applies cleanly and idempotently on PostgreSQL 16 with the real pgvector, upgrades from every checkpoint, function bodies validate, RLS and a live two-user isolation probe hold, billing rows cannot be forged | That production's exact current schema upgrades cleanly (the rehearsal models Supabase's `auth` and `storage`; it does not restore production) |
| **Browser smokes** ×3 | 30 feature-level Playwright scripts (LIFEOS-078 → 107, several at both desktop and mobile sizes) pass in Chrome against a production build; every production route answers and no `/dev` route is reachable | Signed-in, synced or paid behaviour; Firefox/Safari; real AI output |
| **CI passed** | All of the above succeeded | — |

### Reasoning and decision regression suites (new in PR 2)

`lib/reasoning/selftest.ts` (42 assertions) and `lib/decision/selftest.ts`
(53 assertions) cover modules that had no tests. They pin the trust boundary
between the AI and what a person reads:

- AI findings that cite no valid record id are dropped and flagged — including
  when a hostile AI response (fabricated ids, embedded instructions, a
  `finalChoice`) is played through the real client path;
- certainty, probability and prescriptive language is flagged;
- malformed AI output degrades to a well-formed empty result;
- the deterministic passes (polarity tensions, revision reversals, weighted
  tradeoffs with ties and unrated cells) compute what they claim;
- running an analysis mutates nothing — not the store, not the decision, never
  the user's choice or rationale — and reruns keep append-only history;
- the large-decision verification pass can only remove statements, not add them;
- sensitive decisions get the right caution (self-harm first, with 988).

Each suite was checked by injecting the bug it guards against (citation filter
removed, store mutated, safety order swapped); every injection was caught.

## Migration rehearsal requirements

`scripts/migration-rehearsal.mjs` requires, and checks before doing anything:

- PostgreSQL 16 server binaries in `$PG_BIN` (default
  `/usr/lib/postgresql/16/bin`) — package `postgresql-16`;
- the real pgvector extension for that server — package `postgresql-16-pgvector`;
- a `postgres` OS user, and root or passwordless `sudo -n`.

Exit codes are distinct, and no caller may treat 2 as a pass:

| Exit | Meaning |
| --- | --- |
| 0 | `MIGRATION REHEARSAL PASS` — every check ran and passed |
| 1 | `MIGRATION REHEARSAL FAIL` — a check failed or the rehearsal errored |
| 2 | `MIGRATION REHEARSAL NOT RUN` — a requirement is missing; nothing was rehearsed |

A pgvector stand-in (for example a `vector` domain over text) is refused: the
chain now validates function bodies (`check_function_bodies = on`), and three
checks assert `vector` is a base type with a working `<=>` operator. Before
PR 2, body validation was always off to tolerate such a stand-in, so a passing
rehearsal did not prove the vector functions were valid. Verified on
2026-11-22: real pgvector 0.6.0 → 221/221 PASS; no PostgreSQL → NOT RUN; no
pgvector → NOT RUN; stand-in → FAIL.

## The four failures fixed in PR 2

| Assertion | Cause | Fix |
| --- | --- | --- |
| `1.4 migration version 47` | LIFEOS-BILLING added 0048; the pin was not updated because nothing ran the suite | Pinned to 48 (literal on purpose: it is the tripwire for the next migration) |
| `2.1 dense 1..47 valid` | Same | 1..48 |
| `2.7 only the 0048 release fix is allowed` | The release-fix slot correctly moved to 0049 in `lib/release/migrations.ts`; the test did not | 0049 allowed, 0050 refused, 0048 no longer a free slot |
| `105.25 …and the deferral survives it` | `deferAction("next_week")` resolves against the real clock (next Monday), but the test compared it to its fixed date + 7. It passed only on 2026-09-07 | Compares against the date `deferAction` actually set; asserts it is a real date |

## Coverage gaps and what still needs manual testing

### Time zones far from UTC

With the fixes above, every suite passes in UTC, Chicago, New York, Los
Angeles, London, Berlin and São Paulo. Run in zones further from UTC, some
suites still fail because their fixtures write local times as `…Z` timestamps:

| Zone | Failing suites |
| --- | --- |
| Pacific/Honolulu (UTC−10) | memory/changes, memory/week, memory/weekly, planning, today/evening, workspaces |
| Asia/Kolkata (UTC+5:30) | reviews/meaning |
| Asia/Tokyo (UTC+9) | memory/changes, reviews/meaning, today/daily |
| Australia/Sydney (UTC+11) | memory/changes, reviews/meaning, today/daily, today/evening |
| Pacific/Auckland (UTC+13) | memory/changes, reviews/meaning, today/daily, today/evening, workspaces |

Three fixture helpers (today/daily, memory/changes, actions) were traced to this
pattern and fixed with `lib/testing/local-time.ts`; that removed the Los Angeles
crash in today/daily and part of the Asia/Pacific failures.
`reviews/meaning` is different: it passes `offsetMinutes: 0` to the range code
while the reflection-day helper uses the machine's zone, so its failures need
their own triage. The rest are **not yet triaged**: most likely the same
fixture pattern, but a product bug for users in those zones has not been ruled
out. CI pins UTC and America/Chicago until a follow-up PR resolves them.

### Scripts deliberately not run in CI

| Script | Why |
| --- | --- |
| `smoke-074-reachability` | Stale: looks for a mobile *Someday* button the current UI no longer has |
| `smoke-074-sync-truth` | Prints `FAILED` lines but exits 0, so it cannot gate anything |
| `smoke-075-cross-device`, `smoke-076-sync-trust` | Cross-device sync needs a real backend; time out in local-only mode |
| `inject-074-adversarial`, `inject-074-tombstone-gate`, `inject-075-*`, `inject-076-*`, `inject-076b-*` | Investigation harnesses: compare against historical commits and hard-code another machine's paths |
| `inject-074-browser-failure`, `repro-capture-persistence` | One-off reproductions; time out against the current build |
| `audit-083` | Takes screenshots; asserts nothing |
| `visual-regression`, `browser-matrix` | Produce evidence for human review rather than pass/fail |
| `beta-smoke`, `validate-reading-originals-live` | Run against a live deployment or a real Supabase project, by design |

### Manual testing still required before or after a release

- Real sign-in, sync, conflict recovery and RLS against the production Supabase
  project (`validate-reading-originals-live`, `beta-smoke`).
- Stripe checkout, the customer portal and webhook delivery.
- AI features with the live provider: CI only proves that whatever the AI
  returns is validated, not that its answers are good.
- URL import from Vercel's network (real DNS and TLS).
- Upgrading a restored copy of the production schema.
- Safari, Firefox and real mobile devices; screen readers beyond the automated
  accessibility smoke; performance.
- Vercel configuration and the post-deploy checks in the PR 1 runbook.

### Open product question found while writing tests

`validateDecisionAnalysis` flags prescriptive statements with the text
"Prescriptive language softened — LifeOS never chooses", but keeps the
statement verbatim; nothing is softened. `D2.6` pins today's behaviour so that
changing either the text or the behaviour is a deliberate decision.

## Adding tests

- Name the file `*selftest.ts` under `lib/` and export `run<Name>SelfTests()`
  returning `{ pass, total, passed, failed, ms, results }`; it is discovered
  automatically. Assertion helpers that another suite runs go in `INCLUDED_BY`.
- Write fixture times with `localIso(day, hour)` from `lib/testing/local-time.ts`
  when they mean a local wall time; keep `…Z` only for tests about UTC.
- Don't compare a value computed from the real clock with a fixed fixture date;
  compare with what the code under test produced, or inject the date.
- A new browser smoke joins CI by adding it to `SMOKES` in
  `scripts/run-browser-smokes.mjs`; it must exit non-zero on failure.
- A new migration must update the literal pins in `lib/release/selftest.ts`
  (`1.4`, `2.1`, `2.7`, `2.8`); CI fails until it does.
