# Closed Beta — Deployment Setup

Target release: `main` = **`d2d7fe6`**.
Stack: **Next.js 16.2.12 / React 19.2.4 → Vercel**, **Supabase** backend. No Docker,
no VPS, no alternative auth — the audit found nothing that requires them.

**No repository change is needed to deploy.** There is no `vercel.json`, and none
is required: Vercel auto-detects Next.js and `npm run build` already runs
`prebuild → copy-pdf-worker`. This document is the whole deliverable.

---

## 1. Environment variable inventory

Derived from `process.env` references in `app/`, `lib/`, `components/`. **No
variable here is invented.**

### REQUIRED FOR CORE APP
*(none)* — the app boots and is fully usable with **zero** variables set. Without
Supabase it runs local-only; without an AI key it returns deterministic mock
output and says so.

### REQUIRED FOR AUTH / SYNC
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL. Client-side by design. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key. Client-side by design; RLS is what protects data. |

`isSupabaseConfigured()` requires **both**. One alone leaves sync off.

### REQUIRED FOR READING
*(none beyond the two above.)* The `reading-originals` bucket is created **by
migration `0032`**, not by configuration. Optional embedding provider:
`EMBEDDING_PROVIDER_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`
(+ `EMBEDDING_API_KEY`, server-only). Without them the local lexical index is used.

### OPTIONAL
| Variable | Effect if unset |
|---|---|
| `NEXT_PUBLIC_FEEDBACK_URL` | Feedback link hidden |
| `NEXT_PUBLIC_ANTHROPIC_MODEL` | Model label falls back |
| `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_BUILD_ID` | Version display falls back |
| `ANTHROPIC_MODEL` | Server model choice falls back |

### DEVELOPMENT ONLY — **must stay unset in production**
| Variable | Why |
|---|---|
| `LIFEOS_ENABLE_DEV_ROUTES` | `app/dev/layout.tsx` calls `notFound()` unless this is `1`. **Leave unset.** |

### SERVER SECRET — NEVER CLIENT-EXPOSED
| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Used only in `app/api/ai/route.ts` (server route). **Never** `NEXT_PUBLIC_ANTHROPIC_API_KEY`. |
| `EMBEDDING_API_KEY` | Used only in `app/api/embed/route.ts`. |

> ### Finding: `SUPABASE_SERVICE_ROLE_KEY` is **not needed in Vercel**
> It appears in `BETA_RUNBOOK.md`, `BETA_VALIDATION.md` and `PERSISTENCE_QA.md`
> for **offline validation scripts only**. It is referenced **nowhere** in
> `app/`, `lib/`, or `components/`. Setting it in the deployment would add a
> god-mode credential the running application never uses. **Do not set it.**

Server routes: `app/api/ai`, `app/api/embed`, `app/api/extract`.

---

## 2. Founder actions — Supabase

1. **Create project** (closed-beta only; do not reuse a project holding real data).
2. **Enable `pgvector`** — Database → Extensions → `vector`. Migration `0034` needs it.
3. **Apply migrations `0001 → 0037` in order** via the SQL editor or Supabase CLI.
   Expect **58 public tables**. This chain has been rehearsed locally: **38/38**,
   including idempotency ×3 and a two-user RLS isolation probe.
4. **Verify after applying:** tables `notes` (0035) and `protocols` (0037) exist;
   `next_actions.due_date` exists and is nullable; RLS is on for every public
   table; bucket **`reading-originals` exists and is `public = false`** (created
   by 0032 — do not create it by hand, and never make it public).
5. **Auth → Providers:** email/magic-link on, **Anonymous OFF**.
6. **Auth → URL Configuration:** Site URL = your Vercel production URL;
   Redirect URLs = `https://<domain>/**` and `http://localhost:3000/**`.
7. **Disable open signup.** The app already passes `shouldCreateUser: false`
   (`lib/authStore.ts:100`), so an unknown address cannot self-register — but set
   the project-level control too, so the guarantee does not rest on one client flag.
8. **Pre-create exactly five tester accounts** (Auth → Users → invite).

> **If the project already contains real data, stop before step 3** and take a
> backup first. Migrations 0001–0037 contain **zero destructive statements**
> (verified), but a restore point is still the right precaution.

---

## 3. Founder actions — Vercel

1. Import the GitHub repo; framework auto-detects as Next.js.
2. Set env vars in **Project → Settings → Environment Variables**, never in git:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY` *(server-only; omit to run Reading in honest mock mode)*
   - optionally `NEXT_PUBLIC_FEEDBACK_URL`
   - **do not set** `LIFEOS_ENABLE_DEV_ROUTES` or `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy `main` at **`d2d7fe6`**.
4. **Confirm the deployed SHA matches** — a green build is not proof of what
   shipped.
5. Add the resulting domain back into Supabase Site URL / Redirect URLs.

---

## 4. Then run the live gates

Go straight to `docs/CLOSED_BETA_EXECUTION.md` — G2 through G8 — with **no product
work in between**. G1 (migrations) and most of G5 (large PDF) are already closed.

---

## 5. Pre-deploy security gate — passed at `d2d7fe6`

`audit:secrets` PASS (no committed secrets, no client-bundle key leaks) · no
`.env` tracked · `audit:security` 5/5 · `release:audit` 17/17 · regression
1586/1586 · cross-sprint 64/64 · tsc/lint/build clean.
