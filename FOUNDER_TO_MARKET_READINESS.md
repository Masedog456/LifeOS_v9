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
| Base SHA | `e1a9bec217b1a39ca2e5f53af2850ea478ba7c2d` (`e1a9bec`, 2026-09-10) `VERIFIED` |
| Recommended operating mode | **Prove Stage 1 before building Stage 2.** Deploy and verify what exists; do not add product surface. |
| Date last audited | 2026-09-11 (Stage-1 bring-up attempted — see §15) |
| Open launch blockers | **10** (B10 reclassified, 2 new findings registered) |
| Critical blockers | **2** (B1 production never deployed, B2 two-user isolation unverified live) |
| Next founder decision | **D1 — Initial commercial wedge / product identity** (§5) |
| Next engineering action | **BLOCKED — FOUNDER ACTION REQUIRED.** Deployment cannot be performed from an agent session (no Vercel/Supabase credentials; `api.vercel.com` and `api.supabase.com` denied by egress policy). Founder must run the deploy. |
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
| B10 | 074 regression gate unusable | Medium | Stage 1 | **TOOLING FIXED** — gate now runs to completion and reports 123/145. Red for product reasons: see F1/F2. |

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
*Evidence:* Root-caused 2026-09-11 `VERIFIED`. Two distinct defects, both fixed on
`beta/stage-1-production-bringup`:
1. **`playwright-core` was undeclared in `package.json`** while **38 scripts require it** — the
   entire browser acceptance layer (074, 075 cross-device, 099 accessibility, browser-matrix,
   visual-regression, every `smoke-075`…`smoke-107`) could not run on a clean checkout.
2. **Two unguarded null dereferences** (lines 236, 403) aborted the run before the summary
   printed — which is why the gate was *unusable* rather than merely red. Every other nullable
   handle in the file was already guarded; these were the outliers.

*Now:* suite completes — **123/145 assertions pass**, 22 named failures reported, nothing
downgraded to a skip.
*Done when:* the two product root causes (F1, F2) are triaged and the gate is green, or the gate
is formally retired with a replacement named.

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
| P1 | Production deployment reachable | **BLOCKED — FOUNDER ACTION** | No credentials; `api.vercel.com` egress-denied (2026-09-11) |
| P2 | Authentication acceptance | **BLOCKED — FOUNDER ACTION** | Needs live Supabase + magic-link email |
| P3 | **Two-user isolation matrix** | **BLOCKED (live)** · DB layer **PASS** | Migration rehearsal 200/200 on real Postgres 16 + pgvector: B cannot SELECT/UPDATE/DELETE A's rows; 35 isolation assertions; every policy scopes to `auth.uid()` (2026-09-11) |
| P4 | Cross-device sync | NOT RUN | `CROSS_DEVICE_INTEGRITY_075.md` exists |
| P5 | Account deletion | **BLOCKED (live)** · partial | Rehearsal: deleting a user removes integration metadata, pending OAuth states and every credential — no orphaned secret survives (2026-09-11) |
| P6 | Export / data preservation | **PASS (local)** | `release:export` 14/14 — incl. no tokens/secrets in archive, no auth material, clean restore materializes records (2026-09-11) |
| P7 | Production security headers | **PASS (local build)** | CSP (no `unsafe-eval`, `frame-ancestors 'none'`), HSTS, nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY` (2026-09-11). Re-run against production URL. |
| P8 | Browser matrix | **PARTIAL** | chromium 141 5/5 flows PASS; **6 real-browser rows (WebKit/Firefox) still MANUAL** (2026-09-11) |
| P9 | Performance | NOT RUN | blocked by P1 |
| P10 | Rollback rehearsal | NOT RUN | `BACKUP_AND_RECOVERY.md` exists `VERIFIED` |
| P11 | Production smoke test | **PASS (local build) 14/15** | Only failure is `uses HTTPS` on localhost, which is correct. All header + route + dev-gating checks pass (2026-09-11) |
| P12 | Deployed route audit | **PASS (local build)** | `release:routes` 25/25; `audit:routes`: 23 `/dev` routes present in build, all gated by production `notFound()`; `/dev/cohesion-tests` → 404 verified (2026-09-11) |
| P13 | Screen-reader acceptance | **PASS (automated) 22/22** | Incl. focus management, named regions, live-region announcement, single main landmark, **no overflow at 200% zoom**. Manual SR pass still outstanding (2026-09-11) |

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

---

## 15. Stage-1 bring-up attempt — 2026-09-11

Base `e1a9bec`. Objective: deploy and verify the live system. **Deployment was not possible from
this session**; everything verifiable without live infrastructure was executed instead.

### Why deployment is blocked

Two independent hard stops, both `VERIFIED`:

1. **No credentials.** No Vercel or Supabase token in the environment; only `.env.example` exists.
2. **Egress policy.** `api.vercel.com` and `api.supabase.com` are denied at the organization proxy
   (CONNECT rejected). Not retried or routed around.

**BLOCKED — FOUNDER ACTION REQUIRED:** create/confirm the Vercel project, set the public env vars,
create the Supabase project, apply migrations, and trigger the production deploy. Everything in §10
that says "BLOCKED (live)" unblocks the moment a production URL exists.

### Intended production topology `VERIFIED` from `V1_DEPLOYMENT_RUNBOOK.md` + `.env.example`

| Layer | Design |
| --- | --- |
| Frontend | Next.js 16.2.12 on Vercel. `npm run build`, Node 20+. Middleware emits security headers — no Vercel header config needed. |
| Backend | Supabase (optional). **Blank Supabase vars ⇒ local-only mode** (localStorage, no sync, no account). |
| Authentication | **Email magic link only.** Anonymous sign-in forbidden and audited. Site URL + redirect URLs configured in the Supabase dashboard. |
| Local-first | Full app works signed-out against localStorage. Sync and account are additive. |
| AI | Anthropic, **server-only**, `app/api/ai`. Blank key ⇒ deterministic mock output. |
| Embeddings | Optional, server-only, `app/api/embed`. Unset ⇒ built-in local lexical embedder. |
| Secrets | Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_FEEDBACK_URL`. Server-only: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `EMBEDDING_*`. **Service-role key is never used by the app.** |
| Dev shortcut | `LIFEOS_ENABLE_DEV_ROUTES` **must be absent in production**. |
| Domain | Temporary Vercel URL first; commercial domain later. |

### Environment variable readiness (names only — no values read or printed)

| Variable | Class | Status |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public client | **NEEDS FOUNDER** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public client | **NEEDS FOUNDER** |
| `ANTHROPIC_API_KEY` | server secret | **NEEDS FOUNDER** (optional — mock without it) |
| `ANTHROPIC_MODEL` | server, optional | absent (defaults) |
| `EMBEDDING_PROVIDER_URL` / `_API_KEY` / `_MODEL` / `_DIMENSIONS` | server, optional | absent (local embedder) |
| `NEXT_PUBLIC_APP_VERSION` / `NEXT_PUBLIC_BUILD_ID` | public, optional | absent |
| `NEXT_PUBLIC_FEEDBACK_URL` | public, optional | absent — Help shows calm fallback |
| `LIFEOS_ENABLE_DEV_ROUTES` | dev-only | **must stay absent in production** |
| *service-role key* | — | **must never be set.** Enforced by `audit:secrets`. |

### What was executed, and what it proves

| Gate | Result |
| --- | --- |
| `npm run audit:security` | **PASS** — RLS (every user-owned table), secrets (no leaks), routes (`/dev` gated), auth (no signUp/OAuth/anonymous), deps (no un-allowlisted advisories) |
| `npm run release:audit` | **PASS 17/17** — dense numbering, rerunnable, version alignment, **migration count 47** |
| `npm run release:migrations` | **PASS 200/200** on real Postgres 16 + pgvector |
| `npm run release:export` | **PASS 14/14** |
| `npm run lint` / `tsc --noEmit` / `npm run build` | **PASS** (2 lint warnings, 0 errors) |
| `npm run release:routes` | **PASS 25/25** (local build) |
| `npm run beta:smoke` | **14/15** (local build; sole failure is `uses HTTPS` on localhost) |
| `smoke-099-accessibility` | **PASS 22/22** |
| `smoke-100-global-capture` | **PASS 28/28** |
| `release:browsers` | **chromium PASS 5/5**; WebKit/Firefox unavailable here |
| `smoke-074-reachability` | **123/145** — now reports instead of crashing (B10) |

### Tenant isolation — the priority check

Live production isolation (P3) remains **BLOCKED**. But isolation is now **proven at the database
layer** against a real Postgres engine, which is where RLS actually enforces it:

- `isolation: B cannot SELECT A's rows` · `cannot UPDATE` · `cannot DELETE` · `A still sees its own row`
- Per-domain: `user B sees none of user A's horizons` (078), `…events` and `…completion history` (061)
- `every policy scopes to auth.uid()` · `user_id columns default to auth.uid()`
- Deleting a user removes integration metadata, pending OAuth states and **every credential — no orphaned secret survives**
- **35 isolation/refusal assertions** inside 200 passing checks

This does **not** close B2 — B2 requires two real accounts against live auth — but it substantially
de-risks it. The remaining unknown is the live auth/session layer, not the data layer.

### New findings registered this sprint

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | **Occurrence-completion control never renders.** `[data-complete-occurrence]` absent on Today for the seeded recurring action — causes 13 of the 22 gate failures (C1–C6, C8, C11, D3, F10–F13, H5). Either a regression from LIFEOS-104…107 or a stale selector. | **High** — lifecycle integrity is the core product claim (V1) | OPEN — needs product triage |
| F2 | **Defer → Someday absent.** `Someday` option/button not found — 6 failures (A20–A23, D17, H13, H14). | Medium | OPEN — needs product triage |
| F3 | **`V1_DEPLOYMENT_RUNBOOK.md` was stale** — named a migration range ending at `0031` while the repo was at 47; would have under-migrated production by 16. | **High** — canonical deploy doc | **RESOLVED 2026-09-11** — runbook now derives the chain instead of naming it; 5 stale references repaired across 2 docs + 1 code docstring; `npm run audit:runbook` makes recurrence a build failure (5/5, selftest 7/7). |
| F4 | **`playwright-core` undeclared** while 38 scripts require it. | High | **FIXED** this sprint |
| F5 | **Gate aborted instead of reporting** (2 unguarded null dereferences). | High | **FIXED** this sprint |
| F6 | **The runtime schema-parity backstop is dead code.** `evaluateCompatibility()` has a "server behind this build → read-only, sync paused" branch, but `remoteMigrationVersion` is populated **only in self-tests** — nothing in production supplies it. The database deliberately exposes capabilities, not a migration version (`app_schema_contract()`: *"never the migration ledger"*), so the branch can never fire against a real deployment. | **Medium** — an under-migrated production degrades silently rather than failing closed | OPEN — registered 2026-09-11, not fixed (out of scope for a runbook repair) |

F1 and F2 are product behaviour and were deliberately **not** fixed here — out of scope for a
deployment sprint.

### Observability — corrected picture

The board recorded "no error tracking". More precisely `VERIFIED`:

- `sanitized_error_events` **exists** (migration 0031, sanitized, rolling 30 days, RLS-protected)
- `SecurityErrorBoundary` wraps individual surfaces
- **But** the table is referenced only by `lib/privacy/retention.ts` and
  `lib/security/authorization-audit.ts` — there is no wired client-error → table pipeline, no
  global handler, and no aggregation surface

**Gap:** after deploying, a production error is visible only in Vercel's runtime logs. The founder
cannot see client-side crashes at all.

**Smallest next step (recommended, not implemented):** wire the existing `SecurityErrorBoundary`
and a global handler to write to the `sanitized_error_events` table that already exists, and show a
count on `/security` Diagnostics. That reuses shipped infrastructure and adds **no vendor and no
third-party data egress** — which matters for a privacy-positioned product.

### Not executed — all BLOCKED — FOUNDER ACTION REQUIRED

Live auth acceptance (11 steps) · live two-user isolation · cross-device sync (15-scenario matrix) ·
live account deletion · live export · production headers · deployed route audit · performance ·
WebKit/Firefox matrix · manual screen-reader pass · rollback rehearsal.

Each needs a production URL and two disposable accounts. None were fabricated.

### TD2 — likely resolved

`smoke-099` asserts *"§20 no overflow at 200% zoom, no unnamed control, no heading jump"* and
**passes**; `smoke-100-global-capture` passes 28/28. Evidence suggests the Quick Capture 200% zoom
overflow is fixed. Recommend the founder confirm once on the live Quick Capture surface before
closing TD2.

### Stage verdict

**Stage 1 criteria are NOT met. LifeOS remains Late Stage 0.** Zero of the seven Stage-1 exit
criteria are satisfied, because all seven require a running production system. No blocker was
closed by evidence this sprint; B10's *tooling* half is fixed and its product half is now visible
and triageable rather than hidden behind a crash.


## 16. Change log

| Date | Change | Evidence | Blockers | Stage impact | Decision |
| --- | --- | --- | --- | --- | --- |
| 2026-09-11 | Artifact created. Initialized stages, scorecard (26 tracks), blocker register (10), decision register, beachhead + value hypotheses, activation model, journey, Stage-1 acceptance matrix, stop-the-line conditions, simplification register, tech debt, NOW/NEXT/LATER. | Verified against `8ffb8f6`: nav 44 `href:` entries · 109 route files · no analytics/error-tracking/billing dependencies · no Terms route · no root deploy config · privacy + delete routes present · 13 direct dependencies | Opened B1–B10. **Closed B0** (PR #115 already merged — corrected a stale NOW item). | Stage held at **Late Stage 0**. No exit criteria met for Stage 1. | None — D1 remains open |
| 2026-09-11 | **Stage-1 bring-up attempted** (§15). Deployment BLOCKED — no Vercel/Supabase credentials and both APIs egress-denied by org policy. Executed everything verifiable without live infrastructure. Fixed B10 tooling: declared `playwright-core` (undeclared while 38 scripts require it) and guarded 2 crash-instead-of-report dereferences in the 074 gate. | `audit:security` PASS · `release:audit` 17/17 · **migration rehearsal 200/200 incl. 35 tenant-isolation assertions on real Postgres** · `release:export` 14/14 · build PASS · `release:routes` 25/25 · `beta:smoke` 14/15 · a11y 22/22 · capture 28/28 · chromium 5/5 · 074 gate 123/145 (now reports) | None closed. B10 reclassified. Opened **F1** occurrence-completion control missing, **F2** Defer→Someday missing, **F3** deployment runbook stale by 16 migrations. Fixed F4, F5. | **Stage held at Late Stage 0** — 0 of 7 Stage-1 criteria met; every one requires a live system. | None — D1 still open |
| 2026-09-11 | **Production runbook repair** (Stage-1 follow-up). Replaced hard-coded migration ranges with derived procedure; added an explicit database-first deploy order, a capability-based schema-parity step, and a frontend-vs-database rollback distinction. Added `npm run audit:runbook` and wired it into `audit:security`. | Parity audit **5/5** + selftest **7/7**; detected all 5 stale references with file:line before the fix and passes after. `audit:security` PASS · `release:audit` 17/17 · rehearsal 200/200 · lint/tsc/build PASS. | **Closed F3.** Opened **F6** (runtime parity backstop is dead code). B1, B2, auth, cross-device and deletion acceptance remain OPEN — all require a live environment. | **Stage held at Late Stage 0.** | None — D1 still open |

**Update protocol:** append a row on every change. Never edit history. Move closed blockers to the
§4 resolved ledger with date and evidence. Re-date §3 rows when re-verified.
