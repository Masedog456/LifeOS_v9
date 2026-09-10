# Founder-to-Market Readiness

**The authoritative founder-level readiness tracker. It sits above individual LIFEOS engineering sprints.**

> The one question this document answers, at any moment:
> **What stands between the current build and real users safely receiving enough value to return and eventually pay?**

Engineering progress is tracked in the numbered `LIFEOS-*` documents. Launch-critical work is tracked *here*, so it cannot be lost inside engineering scrollback. A large codebase is not a release stage.

---

## 1. Executive header

| | |
|---|---|
| Internal project name | **LifeOS** |
| Shipped brand | **Conqify** — "turn life's chaos into order" (`app/layout.tsx:24`) |
| **Release stage** | **Late Stage 0** — founder-usable locally; not proven as an external-user product |
| Base SHA audited | `484da1c` |
| Date last audited | **2026-09-10** |
| Operating mode | **Verification & decision, not feature development** |
| Open launch blockers | **10** |
| Critical blockers | **3** (never deployed · isolation unverified · identity unresolved) |
| **Next founder decision** | Resolve the initial commercial wedge (§5, D-1) |
| **Next engineering action** | Merge PR #115, then stop feature work |
| **Next operational action** | Deploy to production; run auth + two-user isolation acceptance (§10) |

**Standing note.** The codebase is unusually mature (6,553 deterministic assertions, 67 suites, RLS on 64 tables, 83 design documents). Commercial readiness is near zero. The distance between those two facts *is* the project's current problem.

---

## 2. Release stage gates

Stages advance only when **every** exit criterion is objectively satisfied. Do not upgrade on impression.

### Stage 0 — Founder usable · **CURRENT, ~90%**
| Criterion | Status |
|---|---|
| Core flows work (capture → commitment → Today → resolution → review) | ✅ VERIFIED |
| Deterministic gates acceptable | ✅ 6553/6553, 67 suites |
| Lifecycle integrity established | ✅ LIFEOS-104/105/106 |
| Founder can use it **reliably** | ⚠️ locally only — sync/cross-device unproven |

### Stage 1 — Internal / trusted alpha · **BLOCKED**
| Criterion | Status |
|---|---|
| Real deployment exists | ❌ **never deployed** |
| Live auth works | ❌ NOT RUN |
| Two-user isolation passes | ❌ NOT RUN |
| Deletion + export verified against production | ❌ NOT RUN |
| Production observability exists | ❌ none |
| Support route exists | ❌ no channel |
| Privacy/security acceptance checks pass | ❌ NOT RUN (§10) |

### Stage 2 — Closed beta · **BLOCKED**
Coherent positioning · reduced navigation · first-run tested on a stranger · activation analytics · error tracking · Terms + Privacy suitable for beta · 5–20 external users onboard **without founder intervention** · support workflow.

### Stage 3 — Paid beta · **NOT STARTED**
Evidence of repeated use · validated activation signal · billing · subscription lifecycle · pricing experiment · cancellation + refund paths.

### Stage 4 — Public launch · **NOT STARTED**
Stable production ops · validated positioning · acceptable retention · public landing experience · security/privacy posture for broad exposure · support capacity · reliable onboarding.

### Stage 5 — Growth · **NOT STARTED**
Activation optimisation · retention · referrals · acquisition · monetisation · segment expansion.

---

## 3. Master readiness scorecard

Owner types: **F** founder decision · **E** engineering · **O** operations · **L** legal/specialist · **R** research.
All rows last verified **2026-09-10** at `484da1c` unless stated.

| Track | Status | Evidence | Blocker | Owner | Depends on | Exit criterion |
|---|---|---|---|---|---|---|
| Product core | 🟢 GREEN | 6553 assertions; 104/105/106 (VERIFIED) | — | E | — | Maintained green |
| Product identity | 🔴 RED | 3 conflicting stories (§5 D-1) (VERIFIED) | Founder decision | **F** | — | One sentence, one name, written down |
| Information architecture | 🔴 RED | **41 nav destinations** (`components/Nav.tsx`) (VERIFIED) | Depends on identity | E | Identity | Beta surface ≤ 8 destinations |
| Onboarding | 🟡 YELLOW | 10 steps, `lib/onboarding/steps.ts` (VERIFIED) | Never tested on a stranger | E/R | Identity, IA | 3 strangers complete unaided |
| Accounts / auth | 🟡 YELLOW | Supabase magic link; no passwords; `lib/authStore.ts` | Never exercised live | E/O | Deployment | Auth acceptance PASS (§10) |
| Authorization / isolation | 🔴 RED | RLS on 64 tables, static audit PASS (`npm run audit:rls`) | **Never tested with 2 real accounts** | E/O | Deployment | Two-user matrix PASS |
| Privacy | 🟢 GREEN-ish | local-first; export + delete built; `/privacy`, `/privacy/delete` | No E2E encryption (documented) | E | — | Maintained; disclosed honestly |
| Security | 🟡 YELLOW | secrets scan PASS; dev routes gated; CSP middleware | No independent review; 1 crit + 2 high transitive (documented) | E/L | Deployment | External review before broad launch |
| Production deployment | 🔴 RED | no `vercel.json`, no live URL (VERIFIED) | Not done | **O** | — | App reachable on a domain over HTTPS |
| Reliability | 🔴 RED | runbooks exist; nothing running | No production | O | Deployment | Uptime observed 7 days |
| Observability | 🔴 RED | no Sentry/equivalent (VERIFIED) | Not built | E/O | Deployment | Errors reach a place a human reads |
| Analytics | 🔴 RED | none; V1 excluded it **by design** (`V1_KNOWN_LIMITATIONS.md`) | Deliberate reversal needed | F/E | Identity | Activation events measurable (§8) |
| AI reliability | 🟡 YELLOW | `/api/ai`, grounded citations | No fallback/cost/latency instrumentation found (INFERENCE) | E | Observability | Failure + cost visible |
| Mobile | 🟡 YELLOW | mobile assertions pass across suites | 200% zoom overflow (§13) | E | — | Beta flows usable on a real phone |
| Accessibility | 🟡 YELLOW | 22/22 automated; AA contrast verified | **Screen-reader pass never done** | E | — | VoiceOver/NVDA pass on safety flows |
| Export / deletion | 🟢 GREEN | `export-verify` 14/14; `app/backup` (VERIFIED) | Unverified against production | E/O | Deployment | Deletion run live on disposable account |
| Support | 🟡 YELLOW | `/help` page exists | No inbox, no route, no SLA | O | — | A reachable address + response expectation |
| Legal / trust | 🔴 RED | **no Terms of Service anywhere** (VERIFIED) | Not written | **L** | Identity | ToS + subscription terms reviewed |
| Landing experience | 🔴 RED | `/` is the capture app; no logged-out state (VERIFIED) | Not built | F/E | Identity | A stranger can evaluate before signing up |
| Customer research | 🔴 MISSING | no evidence of any external user | Not started | **R** | Stage 1 | 5 interviews completed |
| Activation | 🔴 RED | hypothesis only (§8) | Unmeasurable | E/R | Analytics | Definition validated against week-2 return |
| Retention | ⚪ UNKNOWN | no users | — | R | Stage 2 | Week-1 retention observed |
| Monetisation | ⚪ UNKNOWN | free/paid boundary exists architecturally (INFERENCE) | Premature | F | Stage 3 | Willingness-to-pay evidence |
| Billing | 🔴 MISSING | zero Stripe/subscription code (VERIFIED) | Not built — **correctly deferred** | E | Stage 3 | Checkout + cancel + failure paths |
| Growth | ⚪ UNKNOWN | not started | — | F | Stage 4 | One repeatable channel |
| Operations | 🟡 YELLOW | strong runbooks (`PRODUCTION_OPERATIONS.md`) | Nothing running | O | Deployment | Domain, email, monitoring, rollback live |

---

## 4. Launch blocker register

**Active — ranked.**

| # | Blocker | Sev | Blocks | Why it matters | Evidence | Definition of done | Status |
|---|---|---|---|---|---|---|---|
| B-1 | **Never deployed to production** | Critical | Stage 1 | Twelve acceptance checks are blocked on it; nothing about the multi-user product is verifiable | no `vercel.json`; `V1_KNOWN_LIMITATIONS.md` "Incomplete-until-GA (credentialed) checks" | App reachable on a domain, HTTPS, headers verified | OPEN |
| B-2 | **Two-user isolation unverified live** | Critical | Stage 1 | Worst available outcome: user A reads user B's private reflections. Unrecoverable in trust terms | RLS audit is **static**; matrix NOT RUN | Two real accounts; cross-read attempts fail; documented | OPEN (dep B-1) |
| B-3 | **Product identity unresolved** | Critical | Stage 2 | Blocks landing, segment, onboarding, pricing, IA. Costs zero engineering | 3 conflicting sources (§5 D-1) | One wedge sentence + one name, committed | OPEN |
| B-4 | **41 navigation destinations** | High | Stage 2 | No stranger can learn this surface | `components/Nav.tsx` (VERIFIED) | Beta nav ≤ 8; rest hidden not deleted | OPEN (dep B-3) |
| B-5 | **No landing / logged-out experience** | High | Stage 2 | Nobody can discover or evaluate the product | `app/page.tsx` is the capture composer | A stranger can understand it before signup | OPEN (dep B-3) |
| B-6 | **No analytics** | High | Stage 2 | A beta without measurement yields opinions, not evidence | no telemetry libs (VERIFIED) | Activation events (§8) measurable, no private content | OPEN |
| B-7 | **No error tracking** | High | Stage 1 | Production failures would be silent | no Sentry/equivalent (VERIFIED) | Unhandled errors reach a human | OPEN (dep B-1) |
| B-8 | **No Terms of Service** | Med-High | Stage 2/3 | Required before charging; trust layer incomplete | no match anywhere in repo (VERIFIED) | ToS + subscription terms, **lawyer-reviewed** | OPEN |
| B-9 | **No billing** | Medium | Stage 3 | Cannot take money — *correctly deferred, do not build yet* | zero Stripe code (VERIFIED) | Checkout, cancel, failure, refund wording | OPEN (deliberate) |
| B-10 | **074 regression gate unusable** | Medium | Stage 1 | A safety net nobody can read | crashes at C1–C3 on clean `main`, reproduced 4 separate days | Suite runs to completion | OPEN |

**Resolved ledger** — *(empty; move rows here with date + evidence when closed)*

| # | Blocker | Closed | Evidence |
|---|---|---|---|
| — | — | — | — |

---

## 5. Founder decision register

Decisions that are **not** coding tasks. These must not be made silently by engineering.

### D-1 — Initial commercial wedge · **OPEN · BLOCKING B-3, B-4, B-5, B-6**

**The contradiction (all VERIFIED):**

| Source | Claims the product is |
|---|---|
| `app/layout.tsx` (shipped) | Conqify — "turn life's chaos into order" |
| `CLOSED_BETA.md` | "capture what you're thinking **and reading** … turn it into knowledge" |
| `VISION.md` | "lifelong intellectual, personal, and **spiritual formation**" · *"built for a single user"* |
| LIFEOS-104→107 | an **executive daily operating system** |

Also: 107 files say "Conqify", 70 say "LifeOS"; `/help` calls it LifeOS to the user.

| Field | Value |
|---|---|
| Decision required | What is the initial commercial wedge — and what is the product called? |
| Alternatives | **(a)** Executive commitment OS *(recommended — matches recent engineering and the strongest differentiators)* · **(b)** Reading/knowledge tool · **(c)** Formation/philosophy product · **(d)** Keep all three *(not viable for beta)* |
| Evidence | Recent engineering, `Nav.tsx` weighting, and the two strongest value hypotheses (§7) all point to (a) |
| Reversible? | **Reversible** — hiding is not deleting (§12) |
| Trigger / deadline | Before any landing page, IA reduction, or beta invite |
| Founder choice | *(pending)* |
| Downstream if (a) | Hide reading + formation surfaces for beta; rewrite `CLOSED_BETA.md`; reconcile `VISION.md`'s single-user framing; settle the name |

### D-2 — Reintroduce analytics against V1's stated principle · **OPEN**
V1 deliberately shipped no analytics (`V1_KNOWN_LIMITATIONS.md`, "product decisions, not gaps"). Measuring activation reverses that. Recommended: privacy-respecting **event metadata only**, never captured content. Reversible. Needs founder sign-off because it contradicts a written principle.

### D-3 — Fate of the reading/knowledge subsystem · **OPEN, deferrable**
Mature, working, possibly out of wedge. Recommend HIDE for beta, decide after user evidence. Reversible.

### D-4 — Single-user vision vs commercial product · **OPEN**
`VISION.md` states "built for a single user." That is incompatible with the commercial goal and should be explicitly amended or explicitly retained as a personal project. Irreversible in framing terms once external users exist.

---

## 6. Initial beachhead hypothesis · **HYPOTHESIS — unvalidated**

> Ambitious professionals (≈28–45) juggling concurrent work **and** personal commitments, who no longer trust conventional task managers and therefore keep too much in their heads.

**Core pain:** *"I can't trust my system, so I still have to remember everything myself."*

| Field | Current value |
|---|---|
| Evidence supporting | Product's strongest built capabilities map to this pain (INFERENCE, not user evidence) |
| Evidence against | None gathered — **and none against is not evidence for** |
| Interviews completed | **0** |
| Users | **0** |
| Retention evidence | none |
| Willingness-to-pay evidence | none |

**Status: HYPOTHESIS.** Do not describe this as our user until ≥5 interviews and ≥5 real users exist.

---

## 7. Value proposition hypotheses

All three are **HYPOTHESES** until an external user demonstrates which one they actually care about.

| # | Claim | What backs it today | Confidence |
|---|---|---|---|
| V-1 | **Nothing falls through the cracks** — waiting, blocked, deferred and scheduled obligations stay recoverable | LIFEOS-105 lifecycle invariants; §48 checker | Strongest technically |
| V-2 | **Honest intelligence** — distinguishes what it knows from what it doesn't rather than fabricating precision | LIFEOS-106: refuses to invent minutes; "between blocks" not "free" | Most differentiated vs Motion/Sunsama |
| V-3 | **Executive continuity** — capture → commitment → Today → resolution → review → future guidance | The full loop exists end to end | Broadest, least proven |

Competitive note (INFERENCE): Todoist is a list without lifecycle; Motion/Sunsama invent schedules; Notion requires you to build it; ChatGPT has no durable commitment memory. V-1 + V-2 together are the defensible pair.

---

## 8. Activation model · **MEASUREMENT HYPOTHESIS**

> Within the first 7 days: **≥3 real captures · ≥1 becomes a dated commitment · Today opened on ≥2 distinct days · ≥1 commitment resolved.**

| Event | Measurable today? | Notes |
|---|---|---|
| capture_created | ❌ | no instrumentation |
| commitment_created (dated) | ❌ | no instrumentation |
| today_opened (distinct days) | ❌ | no instrumentation |
| commitment_resolved | ❌ | no instrumentation |

| Field | Value |
|---|---|
| Sample size | 0 |
| Correlation with week-2 return | unmeasured |
| Revisions | none yet |

**Constraint:** never record captured content to measure activation. Event metadata and counts only. The "second distinct day + one resolution" is the hypothesised moment the loop closes — that is the part most worth validating.

---

## 9. Beta user journey

| Step | Status | Failure point | Instrumented | System | Exit criterion |
|---|---|---|---|---|---|
| Discover | 🔴 | nothing to discover | ❌ | landing | A stranger can find it |
| Understand | 🔴 | 3 conflicting promises | ❌ | positioning | One promise, understood in 30s |
| Sign up | 🟡 | never run live | ❌ | Supabase auth | Auth acceptance PASS |
| Onboard | 🟡 | 10 good steps → 41 destinations | ❌ | `lib/onboarding` | 3 strangers finish unaided |
| Capture | 🟢 | — | ❌ | `app/page.tsx` | maintained |
| Create commitment | 🟢 | — | ❌ | capture → commit | maintained |
| Use Today | 🟢 **strongest** | — | ❌ | `buildTodayCommand` | maintained |
| Complete something | 🟢 | — | ❌ | resolution layer | maintained |
| Review | 🟢 | — | ❌ | evening close | maintained |
| Return next day | ⚪ | unmeasurable | ❌ | — | week-1 retention observed |
| Get support | 🟡 | no channel | ❌ | `/help` | reachable address + SLA |
| Export / delete | 🟢 | unverified in prod | ❌ | `app/backup`, `/privacy/delete` | run live once |
| Upgrade / pay / cancel | 🔴 | not built | ❌ | — | Stage 3 |

---

## 10. Stage-1 production acceptance matrix

Derived from `V1_KNOWN_LIMITATIONS.md` → *"Incomplete-until-GA (credentialed) checks"*. **This checklist already exists in the repo and has never been executed.** Running it is the single highest-leverage action available.

| # | Check | Status | Evidence / date |
|---|---|---|---|
| A-1 | Production deployment exists | **NOT RUN** | — |
| A-2 | Authentication acceptance (sign-up/in/out/refresh/expiry) | **NOT RUN** | — |
| A-3 | **Two-user isolation matrix** (2 real accounts) | **NOT RUN** | ⚠️ highest risk |
| A-4 | Cross-device sync acceptance (15 scenarios) | **NOT RUN** | — |
| A-5 | Account deletion (disposable live account) | **NOT RUN** | — |
| A-6 | Export / data-preservation acceptance | **NOT RUN** | — |
| A-7 | Production headers (CSP/HSTS/Referrer/XCTO + HTTPS redirect) | **NOT RUN** | — |
| A-8 | Browser matrix (Chrome/Edge/Firefox/Safari/iOS/Android) | **NOT RUN** | — |
| A-9 | Performance acceptance (p95, real devices) | **NOT RUN** | — |
| A-10 | Rollback rehearsal | **NOT RUN** | — |
| A-11 | Production smoke test (22 steps) | **NOT RUN** | — |
| A-12 | Deployed route audit | **NOT RUN** | — |
| A-13 | Screen-reader acceptance (VoiceOver/NVDA) | **NOT RUN** | — |

**Recommended order:** A-1 → A-2 → **A-3** → A-7 → A-5 → A-6 → A-11 → remainder.

---

## 11. Stop-the-line conditions

Any confirmed occurrence **halts beta expansion immediately** until resolved and re-verified.

| # | Condition | Severity |
|---|---|---|
| S-1 | User A can access user B's data by any path | **Critical — stop everything** |
| S-2 | Deletion leaves user-visible private data behind | Critical |
| S-3 | Authentication bypass | Critical |
| S-4 | Secrets exposed client-side | Critical |
| S-5 | `/dev` or admin route reachable in production | Critical |
| S-6 | Destructive action affects the wrong tenant | Critical |
| S-7 | Sensitive user content reaches analytics or logs | Critical |

A confirmed tenant-isolation failure is not a bug to schedule. It stops expansion.

---

## 12. Product simplification register

**Hiding is allowed. Deleting mature functionality is not, without a decision.**

| Surface | Classification | Rationale |
|---|---|---|
| 41 nav destinations | **MERGE / HIDE** | Reduce beta surface to ≤8; depends on D-1 |
| Reading / knowledge subsystem (`/reading`, `/library`, `/world`, `/research`) | **HIDE FOR BETA** (pending D-3) | Mature, possibly out of wedge |
| Formation / spiritual surfaces (`/constitution`, `/personal-code`, `/formation`, `/beliefs`) | **UNDECIDED** (pending D-1) | Risks the guru/doctrine failure mode if user-facing by default |
| `/plan/today` vs `/today` | **MERGE** | PR #115 addresses part; IA reduction addresses the rest |
| `tomorrowFocus` | **REMOVE LATER** | Dead infrastructure — `addReviewFocus` has no caller (VERIFIED) |
| `/orchestrator`, `/maintenance`, `/health`, `/timeline`, `/themes` | **HIDE FOR BETA** | Not needed for first value |
| Today · Capture · Actions · Projects · Goals · Review · Help · Settings | **KEEP FOR BETA** | The wedge, if D-1 = (a) |

---

## 13. Known technical debt / non-blockers

Kept separate so bounded issues do not hijack launch priority.

| # | Item | Blocks | Notes |
|---|---|---|---|
| T-1 | 074 Reachability suite crashes at C1–C3 | Stage 1 | Reproduced on clean `main` 4 separate days; cheap to fix |
| T-2 | Quick Capture button overflows at 200% zoom / 390px | Stage 2 | ~98px horizontal overflow; real a11y issue, small fix |
| T-3 | DST elapsed-time limitation | Later | Wall-clock model is correct against displayed times; a real fix needs a timezone model `LifeEvent` lacks |
| T-4 | No end-to-end encryption | Public launch | Documented; will be asked about given data sensitivity |
| T-5 | Transitive dep advisories (1 crit, 2 high) | Later | Documented exceptions in `PRODUCTION_OPERATIONS.md`; revisit on Next bump |
| T-6 | Residual navigation duplication beyond #115 | Stage 2 | Folded into B-4 |
| T-7 | Naming inconsistency in user copy (`/help` says "LifeOS") | Stage 2 | Resolves with D-1 |
| T-8 | Unmerged branch `claude/lifeos-106-final-review` (`c579965`) | — | 10 test assertions, no product change; merge or discard |

---

## 14. NOW / NEXT / LATER

### NOW — max 5
1. **Merge PR #115** after final review *(done, correct, removes a real leak)*
2. **Deploy the current application** to production
3. **Run A-2 then A-3** — auth acceptance, then two-user isolation *(stop-the-line if it fails)*
4. **Founder resolves D-1** — the initial wedge and the name
5. *(reserved — keep this slot empty until one above closes)*

### NEXT
Simplify beta navigation around the chosen wedge · error tracking · privacy-respecting activation analytics · support route + email · Terms/trust layer (lawyer-reviewed) · logged-out landing experience · invite first 5 users.

### LATER
Billing · pricing experiments · growth channels · reading-subsystem decision · E2E encryption investigation · independent security review before broad scale.

**Standing rule:** no new `LIFEOS-*` feature sprint opens while B-1, B-2 or B-3 remain OPEN.

---

## 15. Change log

| Date | Change | Evidence | Blockers | Stage impact | Decision |
|---|---|---|---|---|---|
| 2026-09-10 | Artifact created from Founder-to-Market Readiness Audit at `484da1c` | Repo audit: `audit:security` PASS, RLS 64 tables, 6553/6553 suites, `V1_KNOWN_LIMITATIONS.md`, `Nav.tsx` 41 destinations, no ToS, no billing, no analytics, no deployment | B-1…B-10 opened | Stage set to **Late Stage 0** | D-1…D-4 opened |

---

## How to use this document

- Update it **whenever a blocker changes state**, not on a schedule.
- Move closed blockers to the resolved ledger with a date and evidence — do not leave them in the top ten.
- Re-run the audit and refresh §1 and §3 at each stage transition.
- If engineering reports conflict with this document, **the repository is the authority** — re-verify and correct here.
- Keep NOW at ≤5 items. If a sixth appears, something is not actually NOW.
