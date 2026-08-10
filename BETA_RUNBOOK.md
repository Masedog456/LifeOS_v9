# LifeOS — Founder Beta Runbook (LIFEOS-048)

Operational guide for running the closed beta. For deploy/rollback mechanics and
incident handling this **reuses** the existing docs — it does not replace them:

- Deployment steps: `V1_DEPLOYMENT_RUNBOOK.md`
- Rollback rehearsal + evidence: `V1_ROLLBACK_REPORT.md`
- Incident handling: `INCIDENT_RESPONSE.md`
- Ops / dependency triage: `PRODUCTION_OPERATIONS.md`
- Security & privacy model: `SECURITY_AND_PRIVACY.md`
- Data durability model: `PERSISTENCE_QA.md`, `BACKUP_AND_RECOVERY.md`

---

## 1. Before you invite anyone (pre-flight)

Run these from the deployed commit. All must pass.

```bash
# Local, against the release commit:
npm run build
npx tsc --noEmit
npm run lint
npm run audit:security        # rls + secrets + routes + deps
npm run release:audit
# Live Storage/RLS with two disposable users (needs a real project + keys):
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run validate:reading-originals-live

# Against the DEPLOYED URL, after deploy:
BETA_URL=https://<your-app> NEXT_PUBLIC_SUPABASE_URL=... npm run beta:smoke
```

Then complete the **founder manual pack** in `BETA_VALIDATION.md` (real email
sign-in, second physical device, Safari/iPhone/Android) — these cannot be
automated and must read **MANUAL: PASS** before inviting.

## 2. How to invite someone

1. Confirm production is the intended release commit (`git rev-parse --short HEAD`
   vs the deployed build).
2. Send the invite with a link to the app and to `CLOSED_BETA.md`.
3. Keep the beta list small and written down (see §7 for size guidance).
4. Ask each invitee to do the "good first session" in `CLOSED_BETA.md` and to
   report using **Send feedback**.

## 3. How to inspect health

- **In-app:** `/health` and `/diagnostics` show sync/persistence status. The
  per-page **"Saved locally / Synced / Not yet synced"** indicator reflects real
  sync state (not a fake toast).
- **Post-deploy smoke:** `npm run beta:smoke` (reachability, security headers, no
  5xx on core routes, `/dev` gated off, Supabase reachable).
- **Supabase dashboard:** Auth (users signing in), Storage (`reading-originals`
  bucket size), Table editor (row counts), Logs (errors).
- **Provider usage:** watch the Anthropic (and embedding, if configured) usage
  dashboards — the AI endpoints are unauthenticated (see §6).

## 4. If sync fails

Symptoms: users see "Not yet synced" / a sync error, or changes don't appear on a
second device.

1. Reassure: **local data is safe** — LifeOS writes locally first and never drops a
   local record because a remote write failed (verified by
   `scripts/repro-capture-persistence.cjs`, 13/13).
2. Check Supabase status (dashboard → is the project up? paused? over quota?).
3. Check `beta:smoke` "Supabase auth endpoint reachable".
4. Check the browser's network tab for 4xx/5xx from the Supabase origin (RLS
   denial vs outage).
5. If it's a Supabase outage: users can keep working locally; sync resumes when the
   project is back. Communicate that plainly.
6. If it's a code regression: roll back (see `V1_ROLLBACK_REPORT.md`).

## 5. If authentication fails

1. Confirm `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set on
   the deployment (a common cause: the app runs "local-only" with no Sign-in shown
   because these are missing).
2. In Supabase → Auth: confirm the email provider is configured and **Site URL +
   Redirect URLs** include the production origin (magic links redirect there).
3. Check the user isn't hitting an expired/older magic link — have them request a
   fresh one.
4. If broadly broken, treat as a **stop condition** (§8) and pause invites.

## 6. Known operational risks to watch

- **Unauthenticated AI endpoints.** `/api/ai` and `/api/embed` are stateless
  transforms but are not auth-gated, so they can consume your provider quota if
  discovered. Mitigation for a small beta: keep the beta list small, watch provider
  usage, and set a spend cap in the provider dashboard. (No user data is exposed by
  these routes — the concern is cost, not privacy.)
- **Dependency advisories.** `npm run audit:deps` gates high/critical. The
  `next → postcss/sharp` highs are documented, accepted transitive exceptions (not
  in the runtime attack surface); a future `next` minor (16.3.0) clears them when we
  choose to take that bump.

## 7. If a data-loss report arrives

Treat as **priority zero.**

1. Get specifics: what disappeared, when, which device/browser, and whether they
   were signed in.
2. Do **not** tell them it's fine until verified. Ask them **not to sign out** or
   clear site data.
3. If signed in: check Supabase (the row/object may still be remote even if the UI
   doesn't show it). Storage objects are private — resolve via the dashboard or a
   signed URL, never a public URL.
4. If confirmed local-only loss: capture the exact reproduction. This is a
   **beta-pause** condition (§8) until root-caused.
5. Log it in the incident record (`INCIDENT_RESPONSE.md`).

## 8. Beta STOP conditions (pause invites immediately)

Pause the beta and stop inviting new users the moment ANY of these is **confirmed**.
These are release blockers, not backlog:

1. **Confirmed user data loss** (a created capture/reading/note that was genuinely
   lost, not merely hidden).
2. **Cross-user data exposure** — any user sees another user's captures, readings,
   files, annotations, knowledge, reflections, search results, or settings.
3. **A private Reading original file is retrievable by another user.**
4. **Deletion affecting the wrong user** (User A's delete removes User B's data).
5. **Broad inability to authenticate** (magic-link flow down for users generally).
6. **Corrupted remote state** (rows/objects that no longer load or hydrate).
7. **Widespread production crash / white screen** on core routes.

On any of the above: stop invites → put up an honest "we've paused the beta while we
fix an issue" note → root-cause → fix → re-run the pre-flight (§1) + the relevant
live/manual validation → only then resume.

## 9. Deploy / rollback (pointer)

Follow `V1_DEPLOYMENT_RUNBOOK.md` to deploy and `V1_ROLLBACK_REPORT.md` to roll
back. In short: note the current good commit before deploying; if a release is bad,
redeploy the previous known-good commit and confirm with `npm run beta:smoke`.
**Application rollback does not roll back user data** — it restores the app, not the
database; never perform a destructive data rollback in response to an app bug.
