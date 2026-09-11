# Founder-to-Market Readiness

**Authoritative founder-level readiness tracker. Sits above individual LIFEOS engineering tickets.**

This artifact answers one question at any moment:

> What stands between the current LifeOS build and real users safely receiving enough value to return and eventually pay?

It exists so launch-critical work does not get lost inside engineering scrollback. Engineering
tickets (LIFEOS-nnn) are subordinate to the gates here.

### How to read the evidence labels

| Label | Meaning |
| --- | --- |
| `VERIFIED` | Checked against this repository at the stated SHA, on the stated date. |
| `INFERENCE` | Reasoned from repository evidence, not directly observed. |
| `HYPOTHESIS` | Founder judgement or unvalidated belief. Not yet evidence. |
| `FROM BRIEF` | Supplied by the founder's readiness audit of 2026-09-11. Source evidence for these items lives outside this repository and has not been independently re-derived here. |

Per `AI_AGENT_RULES.md` rule 2, nothing in this file is asserted as verified unless it was actually
checked. Unverified items are marked, not quietly upgraded.

---

## 1. Executive header

| Field | Value |
| --- | --- |
| Internal project name | **LifeOS** |
| Shipped brand | **Conqify** |
| Release stage | **Late Stage 0 — Founder usable locally, not yet proven as an external-user product** |
| Repository | `Masedog456/LifeOS_v9` |
| Base SHA | `8ffb8f688bad396af7157b618ca3add5a84bd780` (`8ffb8f6`, 2026-09-10) `VERIFIED` |
| Recommended operating mode | **Prove Stage 1 before building Stage 2.** Deploy and verify what exists; do not add product surface. |
| Date last audited | 2026-09-11 |
| Open launch blockers | **10** |
| Critical blockers | **2** (B1 production never deployed, B2 two-user isolation unverified live) |
| Next founder decision | **D1 — Initial commercial wedge / product identity** (§5) |
| Next engineering action | Deploy current `main` to a real production environment (B1) |
| Next operational action | Run credentialed Stage-1 acceptance, starting auth then two-user isolation (§10) |

**Stage is not upgraded until §2 exit criteria are objectively satisfied.** A large codebase is not
evidence of readiness. At `8ffb8f6` the repo has 416 commits and 115 merged PRs; none of that
constitutes a shipped product.

---

## 2. Release stage gates

Legend: `[ ]` not met · `[~]` partially met · `[x]` met

### Stage 0 — Founder usable  ← **CURRENT (late)**
- [x] Founder can use locally reliably `FROM BRIEF`
- [x] Core flows work (capture → commitment → Today → resolution) `FROM BRIEF`
- [x] Deterministic gates acceptable `FROM BRIEF`
- [~] Major lifecycle integrity established — `COMMITMENT_LIFECYCLE_105.md`, `DAY_SHAPE_106.md` present `VERIFIED`; one known gate unusable (B10)

### Stage 1 — Internal / trusted alpha
- [ ] Real deployment exists
- [ ] Live auth works against production
- [ ] Two-user isolation passes in live environment
- [ ] Deletion / export verified against production
- [ ] Production observability exists
- [ ] Support route exists
- [ ] Major privacy/security acceptance checks pass (§10)

### Stage 2 — Closed beta
- [ ] Coherent positioning (blocked on D1)
- [ ] Reduced / understandable navigation
- [ ] First-run experience tested with a non-founder
- [ ] Basic product analytics
- [ ] Error tracking
- [ ] Terms / Privacy appropriate for beta
- [ ] First 5–20 external users onboard without founder intervention
- [ ] Support workflow exists

### Stage 3 — Paid beta
- [ ] Evidence of repeated use / retention
- [ ] Validated activation signal (§8)
- [ ] Billing
- [ ] Subscription lifecycle
- [ ] Pricing experiment
- [ ] Cancellation / support paths

### Stage 4 — Public launch
- [ ] Stable production operations
- [ ] Validated positioning
- [ ] Acceptable retention
- [ ] Public landing experience
- [ ] Security / privacy posture appropriate for broader exposure
- [ ] Support capacity
- [ ] Reliable onboarding

### Stage 5 — Growth
Not started. Track when reached: activation optimization · retention · referrals · acquisition ·
monetization · segment expansion.

---

## 3. Master readiness scorecard

`Owner`: **F** founder · **E** engineering · **O** operations

| Track | Status | Evidence | Blocker | Owner | Depends on | Exit criterion | Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Product core | 🟢 | Capture/commitment/Today/review docs + code present `VERIFIED` | — | E | — | Founder-reliable core loop | 2026-09-11 |
| Product identity / positioning | 🔴 | Four conflicting framings (§5) `FROM BRIEF` | D1 unresolved | **F** | — | One written wedge sentence | 2026-09-11 |
| Information architecture | 🔴 | `components/Nav.tsx` has **44 `href:` entries**; **109** `page.tsx` route files `VERIFIED` | Too much surface for a first user | E | D1 | Beta nav ≤ ~7 destinations | 2026-09-11 |
| Onboarding | 🔴 | `ONBOARDING.md` exists; never run with a non-founder `INFERENCE` | Untested first-run | E | D1 | 1 external user self-onboards | 2026-09-11 |
| Accounts / authentication | 🟡 | `@supabase/supabase-js` in deps `VERIFIED`; never exercised in prod | B1 | E | B1 | Live auth acceptance passes | 2026-09-11 |
| Authorization / isolation | 🔴 | RLS design documented; **no live two-user proof** `FROM BRIEF` | **B2 (critical)** | E/O | B1 | Two-user matrix passes in prod | 2026-09-11 |
| Privacy | 🟡 | `app/privacy/page.tsx`, `app/privacy/delete/page.tsx`, `SECURITY_AND_PRIVACY.md` `VERIFIED` | Unproven against prod | E | B1 | Deletion verified live | 2026-09-11 |
| Security | 🟡 | `THREAT_MODEL.md` present `VERIFIED`; no independent review | No external review | E/F | B1 | Stop-the-line checks pass (§11) | 2026-09-11 |
| Production deployment | 🔴 | No `vercel.json` / `netlify.toml` / `Dockerfile` / `fly.toml` / `render.yaml` at repo root `VERIFIED` | **B1 (critical)** | O | — | URL a stranger can load | 2026-09-11 |
| Reliability | ⚪ | Unknowable without production | B1 | O | B1 | Error budget observed 7 days | 2026-09-11 |
| Observability | 🔴 | No error-tracking dependency `VERIFIED` | B7 | E | B1 | Errors reach a dashboard | 2026-09-11 |
| Analytics | 🔴 | No analytics dependency `VERIFIED` | B6 | E | D1 | Activation events measurable (§8) | 2026-09-11 |
| AI reliability | 🟢 | `INTERPRETATION_TRANSPARENCY_102.md`, `DETERMINISTIC_INSIGHTS.md` `VERIFIED` | — | E | — | Honest-uncertainty behaviour holds | 2026-09-11 |
| Mobile | 🟡 | `RESPONSIVE_BEHAVIOR.md`, mobile smoke screenshot present `VERIFIED` | Zoom overflow (TD2) | E | — | Beta-critical flows usable on phone | 2026-09-11 |
| Accessibility | 🟡 | `ACCESSIBILITY.md`, `ACCESSIBILITY_READABILITY_099.md` `VERIFIED` | Screen-reader acceptance not run | E | B1 | §10 screen-reader row PASS | 2026-09-11 |
| Export / deletion | 🟡 | `release-evidence/export-verify.json` present `VERIFIED` | Local only, not prod | E | B1 | Export+delete pass in prod | 2026-09-11 |
| Support | 🔴 | No support route found `VERIFIED` | B-next | O | D1 | Reachable support address | 2026-09-11 |
| Legal / trust | 🔴 | No Terms route; privacy surfaces exist `VERIFIED` | B8 | F | D1 | Beta-appropriate Terms live | 2026-09-11 |
| Landing experience | 🔴 | No landing/marketing directory `VERIFIED` | B5 | F/E | D1 | Logged-out page explains product | 2026-09-11 |
| Customer research | 🔴 | 0 interviews recorded `FROM BRIEF` | No external contact | **F** | D1 | ≥5 interviews logged (§6) | 2026-09-11 |
| Activation | ⚪ | Model defined, unmeasured (§8) `HYPOTHESIS` | B6 | E/F | B6 | Activation rate observed | 2026-09-11 |
| Retention | ⚪ | No external users | — | F | Stage 2 | Week-2 return observed | 2026-09-11 |
| Monetization | 🔴 | No pricing decided `FROM BRIEF` | — | **F** | Stage 3 | Price + WTP evidence | 2026-09-11 |
| Billing | 🔴 | No billing dependency `VERIFIED` | B9 | E | Stage 3 | Charge + cancel works | 2026-09-11 |
| Growth | ⚪ | Not started | — | F | Stage 4 | — | 2026-09-11 |
| Operations | 🔴 | `INCIDENT_RESPONSE.md`, `BACKUP_AND_RECOVERY.md` exist `VERIFIED`; never rehearsed in prod | B1 | O | B1 | Rollback rehearsed | 2026-09-11 |

Counts at 2026-09-11: 🟢 2 · 🟡 6 · 🔴 13 · ⚪ 5

---

## 4. Launch blocker register

Severity: **Critical** stops everything · **High** blocks the named stage · **Medium** degrades it

| # | Blocker | Sev | Blocks | Status |
| --- | --- | --- | --- | --- |
| B1 | Production has never been deployed | **Critical** | Stage 1 | OPEN |
| B2 | Two-user isolation unverified in live environment | **Critical** | Stage 1 | OPEN |
| B3 | Product identity unresolved | High | Stage 2 | OPEN — founder |
| B4 | 44 navigation destinations | High | Stage 2 | OPEN |
| B5 | No landing / logged-out experience | High | Stage 2 | OPEN |
| B6 | No privacy-respecting analytics | High | Stage 2/3 | OPEN |
| B7 | No error tracking | High | Stage 1/2 | OPEN |
| B8 | No Terms of Service / commercial trust layer | High | Stage 2 | OPEN |
| B9 | No billing | Medium | Stage 3 | OPEN |
| B10 | 074 regression gate unusable | Medium | Stage 1 | OPEN |

### Detail

**B1 — Production has never been deployed** · Critical · blocks Stage 1
*Why:* Every other Stage-1 claim is unprovable without it. Auth, isolation, deletion and rollback
are all theoretical until they run against a real environment.
*Evidence:* No deploy config at repo root `VERIFIED`. No production URL recorded `FROM BRIEF`.
*Depends on:* nothing — this is the head of the chain.
*Done when:* A stranger can load a URL, sign up, and reach Today.

**B2 — Two-user isolation unverified live** · Critical · blocks Stage 1
*Why:* The one failure that would require stopping a beta outright (§11). Local RLS confidence is
not production proof.
*Evidence:* Isolation designed and documented; no live matrix run `FROM BRIEF`.
*Depends on:* B1.
*Done when:* §10 two-user matrix PASSes with dated evidence from production.

**B3 — Product identity unresolved** · High · blocks Stage 2 · **Founder decision D1**
*Why:* Navigation, onboarding, landing copy, analytics events and pricing all inherit from it.
Building any of them first means rebuilding them.
*Evidence:* Four live framings (§5) `FROM BRIEF`.
*Done when:* One wedge sentence written into §5 with a date.

**B4 — 44 navigation destinations** · High · blocks Stage 2
*Why:* A first-time user cannot find value in a 44-door building.
*Evidence:* `components/Nav.tsx` — 44 `href:` entries; 109 `page.tsx` files `VERIFIED`.
*(Founder brief said 41; verified count today is 44. Both indicate the same problem.)*
*Depends on:* B3 — you cannot choose what to hide before choosing the wedge.
*Done when:* Beta nav ≤ ~7 destinations, rest hidden not deleted (§12).

**B5 — No landing / logged-out experience** · High · blocks Stage 2
*Why:* Nobody can decide to sign up for something they cannot see or understand first.
*Evidence:* No landing/marketing directory `VERIFIED`. *Depends on:* B3.
*Done when:* Logged-out page states the wedge and offers sign-up.

**B6 — No privacy-respecting analytics** · High · blocks Stage 2/3
*Why:* Without it, activation (§8) and retention are unmeasurable and every product claim is a guess.
*Evidence:* No analytics dependency `VERIFIED`. *Depends on:* B3 (events encode the wedge).
*Done when:* §8 events emit and are queryable — **event names and counts only, never captured content**.

**B7 — No error tracking** · High · blocks Stage 1/2
*Why:* With external users and no error tracking, failures are discovered only when someone complains.
*Evidence:* No error-tracking dependency `VERIFIED`. *Depends on:* B1.
*Done when:* A deliberately thrown production error appears in a dashboard.

**B8 — No Terms of Service / trust layer** · High · blocks Stage 2
*Why:* Asking strangers for personal commitments without terms is a trust and liability gap.
*Evidence:* No Terms route; privacy surfaces exist `VERIFIED`. *Depends on:* B3.
*Done when:* Beta-appropriate Terms reachable pre-signup.

**B9 — No billing** · Medium · blocks Stage 3
*Why:* Gates paid beta only. Deliberately not a Stage-2 blocker.
*Evidence:* No billing dependency `VERIFIED`. *Depends on:* retention evidence first.
*Done when:* A real card is charged and a cancellation completes.

**B10 — 074 regression gate unusable** · Medium · blocks Stage 1
*Why:* Losing the integrity suite means lifecycle regressions ship silently — and lifecycle
integrity is the product's core claim (§7).
*Evidence:* `scripts/smoke-074-reachability.cjs` present `VERIFIED`; crash reported `FROM BRIEF`.
*Done when:* Suite runs green in CI, or is formally retired with a replacement named.

### Resolved ledger

| # | Blocker | Closed | Evidence |
| --- | --- | --- | --- |
| B0 | Merge PR #115 (LIFEOS-107) | 2026-09-10 | Merge commit `8ffb8f6` is current `main` HEAD `VERIFIED` |

> Closed blockers move here with a date and evidence. They do not stay in the active list.

---

## 5. Founder decision register

Decisions that are not coding tasks. **Engineering must not silently resolve these.**

### D1 — Initial commercial wedge / product identity · **OPEN** · blocks B3, B4, B5, B6, B8

**The contradiction** `FROM BRIEF`:

| Surface | Implied product |
| --- | --- |
| Shipped application | **Conqify** — "turn life's chaos into order" |
| Closed beta guide | Reading / knowledge-centred |
| Stated vision | Lifelong intellectual, personal and spiritual formation |
| Recent engineering (LIFEOS-100…107) | Executive daily operating system |

**Decision required:** What is the initial commercial wedge — the one sentence a stranger reads and
recognises as their problem?

| Field | Value |
| --- | --- |
| Alternatives | (a) Executive daily operating system (b) Reading/knowledge system (c) Formation/reflection practice (d) Explicitly staged: wedge now, vision later |
| Evidence for | Recent engineering investment is heaviest in (a) `VERIFIED` — 8 of the last 10 ticket docs are capture/commitment/day-shape |
| Evidence against | Zero external users have confirmed any of them `FROM BRIEF` |
| Reversible? | **Reversible** as positioning. **Expensive** once navigation, onboarding, landing and analytics are built on it. |
| Deadline / trigger | Before any B4/B5/B6 work begins |
| Founder choice | *— not yet made —* |
| Downstream on choice | Beta nav set (§12) · landing copy (B5) · activation events (§8) · Terms scope (B8) · first-5 user profile (§6) |

### D2 — Reading / knowledge subsystem in beta · **OPEN** · lower urgency
Keep visible, hide, or position as the wedge? Depends on D1. See §12.

### D3 — Pricing and willingness-to-pay · **OPEN** · Stage 3
Do not resolve before retention evidence exists.

---

## 6. Initial beachhead hypothesis

> **HYPOTHESIS — not validated.** Status remains `HYPOTHESIS` until users confirm it.

**Who:** Ambitious professionals juggling concurrent work and personal commitments who no longer
trust conventional task managers and therefore keep too much in their heads.

**Core pain:** *"I can't trust my system, so I still have to remember everything myself."*

| Signal | Value | Updated |
| --- | --- | --- |
| Evidence supporting | Founder self-use; lifecycle-integrity investment implies the pain is real to at least one person | 2026-09-11 |
| Evidence against | None collected — absence of evidence, not evidence of absence | 2026-09-11 |
| Interviews conducted | **0** | 2026-09-11 |
| External users | **0** | 2026-09-11 |
| Retention evidence | None | 2026-09-11 |
| Willingness-to-pay evidence | None | 2026-09-11 |

**Cheapest next test:** 5 interviews with people matching the description, asking what they do today
and what breaks — *before* building anything for them.

---

## 7. Value proposition hypotheses

> All three are `HYPOTHESIS`. External users decide which one matters; we do not.

| # | Claim | Substantiation in repo | Status |
| --- | --- | --- | --- |
| V1 | **Nothing falls through the cracks** — lifecycle state modelled rigorously enough that waiting, blocked, deferred and scheduled obligations stay recoverable | `COMMITMENT_LIFECYCLE_105.md`, `ENGINEERING_INTEGRITY_AUDIT_074.md` `VERIFIED` | Strongest technical backing; unvalidated commercially |
| V2 | **Honest intelligence** — distinguishes what it knows from what it does not, rather than fabricating precision | `INTERPRETATION_TRANSPARENCY_102.md`, `DETERMINISTIC_INSIGHTS.md`, `AI_AGENT_RULES.md` `VERIFIED` | Most differentiated; hardest to convey pre-use |
| V3 | **Executive continuity** — capture → commitment → Today → resolution → review → future guidance | `DAILY_COMMAND_CENTER_083.md`, `DAY_SHAPE_106.md`, `EVENING_CLOSE_091.md` `VERIFIED` | Most complete loop; closest to a demo |

**Note:** V1 and V2 are *earned* claims — the engineering genuinely backs them. That is unusual and
worth protecting. It is still not proof that anyone will pay for them.

---

## 8. Activation model

> **Measurement hypothesis.** Revise once real data exists; do not treat as truth.

Within the first seven days:

| # | Event | Measurable today? | Instrumentation |
| --- | --- | --- | --- |
| A1 | ≥3 real captures | ❌ | none — B6 |
| A2 | ≥1 capture becomes a dated commitment | ❌ | none — B6 |
| A3 | Today opened on ≥2 distinct days | ❌ | none — B6 |
| A4 | ≥1 commitment resolved | ❌ | none — B6 |

| Field | Value |
| --- | --- |
| Sample size | 0 |
| Correlation with week-2 return | Unknown |
| Revisions to definition | None yet |

**Privacy constraint — binding.** Instrument **event occurrence and counts only**. Never transmit
captured content, commitment text, note bodies or titles to an analytics provider. A4 is a counter,
not a payload. Violating this is a §11 stop-the-line condition.

---

## 9. Beta user journey

| # | Step | Status | Failure point | Instrumented | System | Exit criterion |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Discover | 🔴 | Nothing to discover | ❌ | Landing (B5) | Public page exists |
| 2 | Understand | 🔴 | No positioning (D1) | ❌ | Landing | Stranger restates the value |
| 3 | Sign up | 🟡 | Unproven in prod | ❌ | Auth (B1) | Live signup succeeds |
| 4 | Onboard | 🔴 | 44 doors (B4) | ❌ | Onboarding | Self-serve, no founder help |
| 5 | Capture | 🟢 | — | ❌ | Capture | First capture < 60s from signup |
| 6 | Create commitment | 🟢 | — | ❌ | Commitment | A2 observed |
| 7 | Use Today | 🟢 | — | ❌ | Today | A3 observed |
| 8 | Complete something | 🟢 | — | ❌ | Lifecycle | A4 observed |
| 9 | Review | 🟢 | — | ❌ | Review | Review opened once |
| 10 | Return next day | ⚪ | Unmeasurable | ❌ | — | Day-2 return observed |
| 11 | Get support | 🔴 | No route | ❌ | Support | Reachable address |
| 12 | Export / delete | 🟡 | Not prod-verified | ❌ | Privacy | §10 rows PASS |
| 13 | Upgrade / pay / cancel | 🔴 | No billing (B9) | ❌ | Billing | Stage 3 |

**Pattern worth naming:** steps 5–9 — the actual product — are the healthiest part of the journey.
Everything failing is *around* it: getting in, understanding it, getting help, leaving. That is a
distribution and packaging gap, not a product-core gap.

---

## 10. Stage-1 production acceptance matrix

Status: `NOT RUN` · `PASS` · `FAIL` · `BLOCKED`. Run against **production**, with credentials.

| # | Check | Status | Evidence / date |
| --- | --- | --- | --- |
| P1 | Production deployment reachable | NOT RUN | blocked by B1 |
| P2 | Authentication acceptance | NOT RUN | blocked by P1 |
| P3 | **Two-user isolation matrix** | NOT RUN | blocked by P1 — **critical (B2)** |
| P4 | Cross-device sync | NOT RUN | `CROSS_DEVICE_INTEGRITY_075.md` exists |
| P5 | Account deletion | NOT RUN | `app/privacy/delete` exists `VERIFIED` |
| P6 | Export / data preservation | NOT RUN | `release-evidence/export-verify.json` (local) `VERIFIED` |
| P7 | Production security headers | NOT RUN | blocked by P1 |
| P8 | Browser matrix | NOT RUN | `release-evidence/browser-matrix.json` (local) `VERIFIED` |
| P9 | Performance | NOT RUN | blocked by P1 |
| P10 | Rollback rehearsal | NOT RUN | `BACKUP_AND_RECOVERY.md` exists `VERIFIED` |
| P11 | Production smoke test | NOT RUN | `scripts/beta-smoke.mjs` exists `VERIFIED` |
| P12 | Deployed route audit | NOT RUN | expect ≥109 routes exposed unless hidden (B4) |
| P13 | Screen-reader acceptance | NOT RUN | `ACCESSIBILITY.md` exists `VERIFIED` |

**Run order:** P1 → P2 → **P3** → P5/P6 → P7 → P11 → P12 → remainder.
P3 gates everything downstream. Do not invite users before it passes.

---

## 11. Privacy / security stop-the-line conditions

If any of these is **confirmed**, stop beta expansion immediately, fix, then re-run §10.

| # | Condition | Severity |
| --- | --- | --- |
| S1 | User A can access User B's data | **Critical — halt** |
| S2 | Deletion leaves user-visible private data behind unexpectedly | **Critical — halt** |
| S3 | Authentication bypass | **Critical — halt** |
| S4 | Secrets exposed client-side | **Critical — halt** |
| S5 | Dev/admin route exposed in production | **Critical — halt** |
| S6 | Destructive action affects the wrong tenant | **Critical — halt** |
| S7 | Sensitive user content unintentionally sent to analytics or logs | **Critical — halt** |

**Standing rule:** any confirmed tenant-isolation failure (S1, S6) is Critical. No new users are
invited until it is resolved and re-verified with dated evidence.

**On S7 specifically:** this is the most likely condition to be violated *by accident*, when
analytics is added (B6). The §8 constraint exists to prevent it.

---

## 12. Product simplification register

Complexity intentionally hidden or deferred for beta. **Hiding is allowed; deleting mature
functionality merely because it is off-wedge is not.**

| Area | Classification | Note |
| --- | --- | --- |
| 44 navigation destinations | **UNDECIDED** → target HIDE FOR BETA | Blocked on D1. Target ≤ ~7 visible. |
| Reading / knowledge subsystem | **UNDECIDED** (D2) | Could be the wedge, or hidden. Do not remove. |
| Spiritual / formation surfaces | **UNDECIDED** | If user-facing, likely HIDE FOR BETA — hardest to position to a cold audience. Vision-critical; keep in codebase. |
| Duplicated / legacy planning destinations | **MERGE** | Consolidation is safe regardless of D1. |
| Advanced functionality not needed for first value | **HIDE FOR BETA** | Reachable by URL is acceptable; nav-visible is not. |

Classifications: `KEEP FOR BETA` · `HIDE FOR BETA` · `MERGE` · `REMOVE LATER` · `UNDECIDED`

---

## 13. Known technical debt / non-blockers

Kept separate so bounded engineering issues do not hijack launch priority.

| # | Item | Blocks | Note |
| --- | --- | --- | --- |
| TD1 | 074 Reachability suite crash | **Stage 1** | Tracked as B10 — the one debt item that is a blocker |
| TD2 | Quick Capture 200% zoom horizontal overflow | Later | Accessibility polish; `GLOBAL_QUICK_CAPTURE_100.md` `VERIFIED` |
| TD3 | DST elapsed-time limitation | Later | Bounded, documented |
| TD4 | No end-to-end encryption | Public launch | Positioning-dependent; revisit if privacy becomes the wedge |
| TD5 | Documented transitive dependency advisories | Public launch | Only 13 direct dependencies `VERIFIED` — small surface |
| TD6 | Possible remaining navigation duplication | Stage 2 | Folds into B4 / §12 MERGE |

---

## 14. NOW / NEXT / LATER

### NOW — max 5
1. **Deploy the current application** to a real production environment. *(B1 — head of the chain)*
2. **Run production credentialed acceptance**, auth first, then **two-user isolation**. *(§10 P1→P3, B2)*
3. **Founder resolves D1** — the initial product identity / wedge. *(B3; unblocks four others)*
4. **Fix or formally retire the 074 gate.** *(B10)*

> The brief's original NOW item 1 was "Merge PR #115 after final review." **Already merged** —
> `8ffb8f6` is `main` HEAD `VERIFIED`. Moved to the resolved ledger (B0) and the slot freed.

### NEXT
- Simplify beta navigation around the chosen wedge (B4, §12)
- Error tracking (B7)
- Privacy-respecting activation analytics (B6, §8 constraint binding)
- Support route / email (§9 step 11)
- Terms / trust layer (B8)
- Logged-out / landing experience (B5)
- Invite first five users

### LATER
- Billing (B9) · pricing experiments (D3) · broader growth
- Reading subsystem decision (D2)
- E2E encryption investigation (TD4)
- Independent security review before broad public scale

---

## 15. Change log

| Date | Change | Evidence | Blockers | Stage impact | Decision |
| --- | --- | --- | --- | --- | --- |
| 2026-09-11 | Artifact created. Initialized stages, scorecard (26 tracks), blocker register (10), decision register, beachhead + value hypotheses, activation model, journey, Stage-1 acceptance matrix, stop-the-line conditions, simplification register, tech debt, NOW/NEXT/LATER. | Verified against `8ffb8f6`: nav 44 `href:` entries · 109 route files · no analytics/error-tracking/billing dependencies · no Terms route · no root deploy config · privacy + delete routes present · 13 direct dependencies | Opened B1–B10. **Closed B0** (PR #115 already merged — corrected a stale NOW item). | Stage held at **Late Stage 0**. No exit criteria met for Stage 1. | None — D1 remains open |

**Update protocol:** append a row on every change. Never edit history. Move closed blockers to the
§4 resolved ledger with date and evidence. Re-date §3 rows when re-verified.
