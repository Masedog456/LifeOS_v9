/**
 * Canonical known-limitations model (LIFEOS-042, Feature 27).
 *
 * One structured source of truth for every Version 1 limitation, each with its
 * impact, a workaround, whether it blocks the release, and a follow-up owner.
 * `V1_KNOWN_LIMITATIONS.md` is generated from this list, and the release
 * self-test asserts the list covers every category the spec requires — so a
 * limitation can't be quietly dropped from the docs.
 */

export interface Limitation {
  id: string;
  area: string;
  summary: string;
  impact: string;
  workaround: string;
  blocking: boolean;
  owner: string;
}

export const LIMITATIONS: readonly Limitation[] = [
  { id: "browser-support", area: "browsers", summary: "Support claimed only for current stable Chrome, Edge, Firefox, Safari, iOS Safari, Android Chrome.", impact: "Older or niche browsers are untested and unsupported.", workaround: "Use a current mainstream browser.", blocking: false, owner: "release/browser-matrix" },
  { id: "mobile-density", area: "mobile", summary: "Some data-dense tables (insights, maintenance) scroll horizontally inside their own container on small screens.", impact: "Wide tables require sideways scroll on phones.", workaround: "Rotate to landscape or use a wider viewport for heavy analysis.", blocking: false, owner: "ux" },
  { id: "local-first-scope", area: "local-first", summary: "All data is local-first; a browser with cleared storage and no sync configured loses local-only data.", impact: "Data lives in the browser unless synced/exported.", workaround: "Sign in to sync, or export regularly from Backup.", blocking: false, owner: "persistence" },
  { id: "sync-lww", area: "sync", summary: "Conflict resolution is last-write-wins per field with explicit conflict surfacing, not operational transform.", impact: "Simultaneous edits to the same field resolve to one value; the other is preserved as a surfaced conflict, not merged.", workaround: "Resolve surfaced conflicts in the Recovery/Conflict center.", blocking: false, owner: "sync" },
  { id: "provider-retention", area: "privacy", summary: "Account deletion removes application rows immediately but provider backups may retain data briefly.", impact: "Erasure is not instantaneous at the infrastructure layer.", workaround: "Disclosed in the deletion flow; retention window documented.", blocking: false, owner: "privacy" },
  { id: "dep-advisories", area: "dependencies", summary: "Accepted dev-only/transitive advisories are tracked with mitigations.", impact: "No known runtime-exploitable advisory ships; accepted ones are dev-time only.", workaround: "See the accepted-exceptions table in V1_KNOWN_LIMITATIONS.", blocking: false, owner: "security" },
  { id: "csp-inline", area: "security", summary: "CSP allows 'unsafe-inline' styles/scripts as a documented framework exception; 'unsafe-eval' is NOT allowed.", impact: "Inline styles/scripts are permitted; eval-based injection is blocked.", workaround: "Tracked as a framework limitation; revisit on nonce support.", blocking: false, owner: "security" },
  { id: "no-e2e-encryption", area: "security", summary: "No end-to-end encryption; synced data is protected by RLS + transport security, not client-side E2E crypto.", impact: "The sync provider can technically access stored rows.", workaround: "Use local-only mode for maximal privacy.", blocking: false, owner: "security" },
  { id: "no-ai", area: "scope", summary: "No AI, LLM, agent, embedding, or recommendation features are active in V1.", impact: "All intelligence is deterministic and local.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "no-collaboration", area: "scope", summary: "Single-user only; no collaboration or sharing.", impact: "One account per dataset.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "no-calendar", area: "scope", summary: "No calendar integration.", impact: "Planning horizons are intentions, not calendar events.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "no-notifications", area: "scope", summary: "No notifications or reminders.", impact: "No push/email nudges.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "no-presence", area: "scope", summary: "No realtime presence.", impact: "No live co-editing indicators.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "no-auto-planning", area: "scope", summary: "No automatic planning; the user assigns horizons manually.", impact: "Planning is manual by design.", workaround: "By design.", blocking: false, owner: "product" },
  { id: "cross-device-manual", area: "sync", summary: "Cross-device sync acceptance requires live Supabase credentials and two real devices; automated coverage is deterministic-model + local adapter tests.", impact: "Some cross-device scenarios are verified by model/logic tests, not a live two-device run.", workaround: "Execute the credentialed cross-device matrix before GA; tracked in the acceptance report.", blocking: false, owner: "release/manual" },
  { id: "a11y-exceptions", area: "accessibility", summary: "Documented accessibility exceptions (e.g. a few sub-44px inline affordances with larger hit areas) are listed with rationale.", impact: "A small number of controls rely on an enlarged hit area rather than a 44px visual box.", workaround: "Listed in ACCESSIBILITY.md with target-size exceptions.", blocking: false, owner: "accessibility" },
  { id: "perf-large-fixtures", area: "performance", summary: "Very large accounts (tens of thousands of records) are beyond the measured fixture size.", impact: "Performance budgets are set for realistic, not extreme, datasets.", workaround: "Documented budgets + follow-up item for large-account profiling.", blocking: false, owner: "performance" },
  { id: "import-formats", area: "import", summary: "Document import is plain-text/Markdown first; rich formats (PDF binary layout, DOCX) are not first-class in V1.", impact: "Some source formats must be converted to text before import.", workaround: "Paste text/Markdown; the reader parses headings/paragraphs deterministically.", blocking: false, owner: "reading" },
] as const;

/** Categories the spec (Feature 27) requires the limitations doc to cover. */
export const REQUIRED_LIMITATION_AREAS = [
  "browsers", "mobile", "local-first", "sync", "privacy", "dependencies",
  "security", "scope", "accessibility", "performance", "import",
];

export interface LimitationsReport {
  ok: boolean;
  problems: string[];
  blockingCount: number;
}

export function validateLimitations(): LimitationsReport {
  const problems: string[] = [];
  const areas = new Set(LIMITATIONS.map((l) => l.area));
  for (const req of REQUIRED_LIMITATION_AREAS) {
    if (!areas.has(req)) problems.push(`limitations missing required area: ${req}`);
  }
  for (const l of LIMITATIONS) {
    if (!l.impact) problems.push(`${l.id} missing impact`);
    if (!l.workaround) problems.push(`${l.id} missing workaround`);
    if (!l.owner) problems.push(`${l.id} missing owner`);
  }
  // Ensure the explicit "no X" scope statements are all present.
  for (const kw of ["no-ai", "no-collaboration", "no-calendar", "no-notifications", "no-presence", "no-auto-planning", "no-e2e-encryption", "csp-inline"]) {
    if (!LIMITATIONS.some((l) => l.id === kw)) problems.push(`missing required limitation: ${kw}`);
  }
  return { ok: problems.length === 0, problems, blockingCount: LIMITATIONS.filter((l) => l.blocking).length };
}
