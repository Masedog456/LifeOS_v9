# LifeOS V1 — Performance Report

> Provisional draft pending Product Owner sign-off. Release candidate `v1.0.0-rc1`.
> Measurements are real; none are fabricated. Where a measurement could not be
> taken in this environment, it is marked as a pre-GA manual item — not estimated.

## Fixture & environment

- **Fixture:** empty account (cold navigation) plus the deterministic release
  fixture (`lib/release/fixtures.ts`, 27 records across every domain) for
  populated surfaces.
- **Environment:** production build (`next start`) served locally on `:3111`.
- **Browser / hardware:** headless Chromium 141 (Playwright) on the CI Linux
  container. This is a server-class environment, not a target end-user device.
- **Method:** 1 warm-up navigation, then 5 samples per route measuring
  navigation → `domContentLoaded` + layout; median and p95 reported.
  Reproduce via `release-evidence/performance.json`.

## Measured navigation (production build, headless Chromium)

| Surface | Median (ms) | p95 (ms) |
|---|---|---|
| app-shell/today | 58 | 68 |
| capture | 71 | 80 |
| actions | 60 | 96 |
| planning | 53 | 77 |
| focus | 60 | 66 |
| reading | 65 | 74 |
| maintenance | 59 | 63 |
| insights | 64 | 75 |
| diagnostics | 64 | 66 |
| onboarding | 56 | 69 |
| release | 74 | 100 |
| help | 68 | 73 |

All measured surfaces render in **well under 150 ms** median with p95 under
~100 ms on this build. Deterministic self-tests also record per-suite timing
(e.g. insights 97 assertions, maintenance 85 assertions) all completing in a
few milliseconds, confirming the projection layers are cheap.

## Release budgets (evidence-based)

Set from the measurements above, with headroom for real devices:

| Surface class | Budget (median) | Budget (p95) |
|---|---|---|
| App shell / Today | ≤ 400 ms | ≤ 800 ms |
| Primary surfaces (capture, actions, planning, focus, reading) | ≤ 500 ms | ≤ 1000 ms |
| Data-dense surfaces (insights, maintenance) | ≤ 700 ms | ≤ 1200 ms |
| Utility surfaces (diagnostics, help, release, onboarding) | ≤ 500 ms | ≤ 900 ms |

These budgets are comfortably met in the measured environment. They are
intentionally generous to absorb real-device and real-network variance.

## Coverage the spec asks for, still pending on real hardware

- Cold vs. warm app-shell on target **device classes** (mid-range mobile,
  typical laptop) with real network.
- p95 for capture open/save, command-center open, global search, action queue,
  planning board, Focus Mode, reader open/navigation, inspector, export, and
  import preview **under a realistic large fixture** and on real browsers.

These are marked **manual/pre-GA** — not estimated here — because this
environment cannot represent a real device or the largest realistic accounts.

## Accepted performance limitations

- Very large accounts (tens of thousands of records) exceed the measured fixture
  size; large-account profiling is a tracked follow-up (`perf-large-fixtures` in
  `V1_KNOWN_LIMITATIONS.md`). Non-blocking.
