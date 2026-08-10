# LifeOS — Closed Beta Validation & Critical Path (LIFEOS-048)

This is the evidence map for beta readiness. Each critical-path step is marked with
how it was validated:

- **AUTO PASS** — verified automatically by the agent (headless Chromium against a
  local production build, and/or a deterministic test suite).
- **MANUAL REQUIRED** — genuinely needs a human, real email inbox, a real Supabase
  project, or a second physical device / real Safari-iPhone-Android. **Not** marked
  PASS. Founder instructions are in the pack at the bottom.

The agent environment has **no live Supabase, no email inbox, and no real
Safari/iPhone/Android**, so everything requiring those is MANUAL by necessity, not
by choice.

---

## 1. Closed-beta critical path

| # | Step | Status | How it was checked |
|---|------|--------|--------------------|
| A | Visit production app | AUTO PASS | Root loads capture-first ("What's on your mind?"); no fatal JS errors |
| B | Sign up / sign in | MANUAL REQUIRED | Magic-link email; see pack M1. Sign-in UI (`AuthControl`) present in nav when Supabase configured |
| C | Complete/dismiss onboarding | AUTO PASS | App lands directly on the capture screen with helpful subtext; no blocking gate |
| D | Reach Today | AUTO PASS | `/today` renders |
| E | Capture a thought | AUTO PASS | Capture writes a record to the store |
| F | Reload → capture remains | AUTO PASS | Capture text present in persisted store after reload |
| G | Turn into an actionable item | AUTO PASS (partial) | Capture → convert paths exist; full "next action" flow reachable via Work/Planning |
| H | See/use Work or Planning | AUTO PASS | Routes reachable, no server error |
| I | Enter Focus mode | AUTO PASS (route) | `/focus` reachable; timed-session behavior is MANUAL M6 |
| J | Add a Reading document | AUTO PASS | Paste + real PDF upload both create a `ReadingDocument` |
| K | Open it in Reader | AUTO PASS | Navigates to `/document/[id]` and renders passages |
| L | Ask / Summarize / Study | AUTO PASS | Ask returns a grounded answer (deterministic offline draft when no AI key) |
| M | Grounded source citation/provenance | AUTO PASS | Answer carries a clickable "From your document" citation; ungrounded questions honestly decline |
| N | Save something into LifeOS | AUTO PASS | "Save as note" writes back with confirmation |
| O | Search prior information | AUTO PASS | ⌘K/Ctrl-K palette opens; finds the earlier capture |
| P | Complete a reflection/review | AUTO PASS (route) | `/review` renders with content; full guided flow is MANUAL M6 |
| Q | Sign out | MANUAL REQUIRED | Needs a signed-in session; pack M2 |
| R | Sign back in | MANUAL REQUIRED | Pack M2 |
| S | Data remains after re-auth | MANUAL REQUIRED | Pack M2 (local persists automatically; remote hydration needs a real account) |
| T | Use a second browser/device | MANUAL REQUIRED | Pack M3 |
| U | Same account state appears | MANUAL REQUIRED | Pack M3 (cross-device sync) |
| V | Delete user-created content | AUTO PASS (logic) + MANUAL M4 | Reading "Remove" + content deletes exist; cross-device delete propagation is M4 |
| W | Deletion persists | AUTO PASS (local) + MANUAL M4 | Local deletion persists across reload; remote/second-device is M4 |

## 2. Security & isolation

| Check | Status | Evidence |
|-------|--------|----------|
| Two-user RLS isolation (captures/readings/files/etc.) | AUTO PASS (deterministic) + MANUAL M5 (live) | Reading self-tests 58/58 over an RLS-shaped fake backend; `audit:rls` 55 tables; live 27/27 recorded on PR #39; re-run live with pack M5 |
| Private original files not cross-user readable | AUTO PASS (deterministic) + MANUAL M5 | `validate:reading-originals-live` (disposable users) |
| No route exposes private data pre-auth | AUTO PASS | Local-first client render; API routes are stateless transforms; no SSR of user data; Supabase RLS is the boundary |
| Server secrets never in client bundle | AUTO PASS | `audit:secrets` PASS; service/API keys only read in route handlers + dev scripts |
| Sign-in hydration race (past Capture data-loss) | AUTO PASS | `scripts/repro-capture-persistence.cjs` 13/13 |
| Production security headers | AUTO PASS (local build) + MANUAL M7 (deployed) | 8 headers incl. CSP w/o `unsafe-eval`, HSTS, nosniff, frame DENY — verified on the running production server; confirm on the deployed origin with `beta:smoke` |

## 3. Persistence & failure behavior

| Check | Status | Evidence |
|-------|--------|----------|
| Capture survives reload | AUTO PASS | Walkthrough |
| Capture saved locally even when remote write fails | AUTO PASS | repro-capture-persistence 13/13 |
| Reading + original association durable / cross-device | AUTO PASS (deterministic) + MANUAL M3/M5 | originals self-tests + live validator |
| Interrupted original upload → usable reading remains + Retry | AUTO PASS (deterministic) | Reading self-tests (storage-fail / metadata-fail-orphan-cleanup / retry) |
| No duplicate/lost capture on reconnect | MANUAL M8 (true offline toggle) | Reconcile logic tested deterministically; real offline toggle is manual |
| Deletion removes correct original, not another's | AUTO PASS (deterministic) + MANUAL M5 | originals self-tests + live validator |

## 4. Accessibility (critical flows)

| Check | Status | Evidence |
|-------|--------|----------|
| `<main>` landmark on core screens | AUTO PASS | root/today/reading |
| All buttons have accessible names | AUTO PASS | root/today/reading: 0 unnamed buttons |
| No horizontal overflow at 320px | AUTO PASS | root/today/reading: 0px overflow |
| Keyboard: palette (⌘K), reader J/K/H/N, Esc | AUTO PASS (present) | Walkthrough + reader shortcuts |
| Visible focus, logical tab order, dialog focus trap | MANUAL M9 | Needs human keyboard/AT judgment; existing `ACCESSIBILITY.md` documents intent + exceptions |
| Screen-reader usability | MANUAL M9 | ARIA presence ≠ usability; real SR pass required |
| Contrast, reduced-motion, zoom/reflow | AUTO (partial) + MANUAL M9 | 320px reflow AUTO; contrast/RM spot-check manual |

## 5. Browser / device matrix

Automated here: **Chromium** (headless) — the critical flows above pass. Everything
else is **MANUAL M10** (the agent has no real Edge/Firefox/Safari/iPhone/Android):

| Surface | Status |
|---------|--------|
| Desktop Chrome/Chromium | AUTO PASS |
| Desktop Edge | MANUAL M10 (Chromium-family; low risk) |
| Desktop Firefox | MANUAL M10 |
| Desktop Safari | MANUAL M10 |
| iPhone Safari | MANUAL M10 |
| Android Chrome | MANUAL M10 |

## 6. Performance (local production build, headless Chromium)

Indicative only — measure on the deployed origin + real devices for the record
(pack M11). No pathological regressions observed locally: core routes return
quickly, capture is instant (local write), the search palette opens immediately,
Reading opens and a real PDF extracts in-browser without freezing the UI, and the
Study panel opens instantly (deterministic on-device path; Ask latency depends on
the AI provider when configured).

---

## FOUNDER MANUAL VALIDATION PACK

Do these locally before/at invite time. Mark each **MANUAL: PASS** or **FAIL** with
the date. Keep it short.

**M1 — Fresh sign-up (real email).** On the deployed app, click **Sign in**, enter a
real address, open the magic link from your inbox, confirm you land signed in and
the nav shows your email. Also try an **expired/old link** → confirm a clear error
and that requesting a new link works.

**M2 — Sign out / sign back in (same device).** Create a capture + a reading while
signed in. Sign out. Sign back in. Confirm your capture, reading, highlights, and
notes are all still there.

**M3 — Second device / browser (cross-device sync).** Sign in as the same user on a
second device (or a different browser profile). Confirm the captures, readings,
original files, and annotations from device 1 appear. Create something on device 2;
confirm it appears on device 1 after a refresh.

**M4 — Deletion propagation.** Delete a reading (with a stored original) and a
capture on device 1. Reload device 1 → gone. Refresh device 2 → also gone. Confirm
unrelated notes/beliefs behave per product rules.

**M5 — Live two-user Storage/RLS.** Run:
```bash
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run validate:reading-originals-live
```
Expect `TOTAL: N/N PASS` and exit 0 (two disposable users; every RLS attack denied).
The service key is used only to provision/clean up users — attack tests use normal
User A / User B sessions.

**M6 — Focus + Review flows (human judgment).** Start a Focus session and confirm the
timer/behavior is sensible. Complete a weekly Review and confirm the guided steps
make sense to a non-developer.

**M7 — Deployed security headers.** After deploy:
```bash
BETA_URL=https://<your-app> NEXT_PUBLIC_SUPABASE_URL=... npm run beta:smoke
```
Expect `BETA SMOKE PASS` (HTTPS, CSP without unsafe-eval, HSTS, nosniff, frame deny,
`/dev` gated 404, Supabase reachable).

**M8 — Offline capture.** In DevTools, set the network to **Offline**. Create a
capture → it saves and shows a not-synced/pending state (never "fully synced"). Go
back **Online** → pending sync resolves. Reload → exactly one capture, none lost,
none duplicated.

**M9 — Accessibility (human + AT).** Keyboard-only: tab through capture, nav menus,
the reader, and a confirmation dialog — focus is always visible and trapped in
dialogs; Esc closes. Run one real screen-reader pass (VoiceOver or NVDA) over
capture → reading → ask. Spot-check contrast and `prefers-reduced-motion`.

**M10 — Browser/device matrix.** Repeat the "good first session" (`CLOSED_BETA.md`)
on: desktop Edge, Firefox, Safari; iPhone Safari; Android Chrome. Watch auth, Today,
Capture, Work, Reading upload, Reader, Study, Search, nav menus, and dialogs.

**M11 — Performance on real targets.** On the deployed origin, note initial load,
Today, Capture responsiveness, opening a Reading, PDF extraction, opening Study, and
search — on at least one laptop and one phone. Flag anything that feels slow to a
normal user.
