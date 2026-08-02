/**
 * Production smoke-test guide (LIFEOS-042, Feature 31).
 *
 * The exact 22-step flow to run against the deployed RC with a disposable
 * account. Read-only checklist; it does not perform the steps (those require a
 * live deployment) — it documents them so a person can reproduce the smoke test.
 */

export const SMOKE_STEPS: readonly string[] = [
  "Load the homepage / app shell",
  "Sign in with a disposable test account",
  "Open Today",
  "Create a capture",
  "Process the capture",
  "Create a project",
  "Create a next action",
  "Plan the action to a horizon",
  "Start and end a Focus session",
  "Complete a daily review",
  "Import a short document",
  "Create a citation from a passage",
  "Open the maintenance dashboard",
  "Open insights and pick a range",
  "Run a global search",
  "Open the inspector on a record",
  "Export the account archive",
  "Open the Privacy Center",
  "Open Diagnostics and confirm version + sanitized report",
  "Sign out (confirm no stale protected UI)",
  "Reopen on a mobile viewport",
  "Confirm no horizontal overflow on core routes",
];

export default function SmokeTestGuide() {
  return (
    <section data-smoke-guide className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="text-sm font-semibold">Production smoke test</h2>
      <p className="mt-1 text-[13px] text-zinc-500">Run this 22-step flow against the deployed release candidate with a disposable account. This is a manual, credentialed check — it is not automated here.</p>
      <ol className="mt-3 list-decimal pl-5 text-[13px] text-zinc-600 dark:text-zinc-300">
        {SMOKE_STEPS.map((s, i) => <li key={i} className="py-0.5">{s}</li>)}
      </ol>
    </section>
  );
}
