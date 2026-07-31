/**
 * Canonical product vocabulary (LIFEOS-041, Feature 8).
 *
 * ONE dictionary for the words LifeOS uses in the UI and docs, so the same
 * concept is never labeled two ways (noun vs verb, singular drift) and
 * implementation terms never leak to users. Each term has a canonical name,
 * short label, plural, verb, a plain help definition, and DEPRECATED alternatives
 * that a self-test / lint can flag. Glossary + Help read from this.
 */

export interface Term {
  key: string;
  name: string;        // canonical noun
  short: string;       // compact label (nav/chips)
  plural: string;
  verb?: string;       // canonical verb form, if any
  definition: string;  // plain help definition
  deprecated?: string[]; // forbidden alternatives
}

export const TERMS: readonly Term[] = [
  { key: "capture", name: "Capture", short: "Capture", plural: "Captures", verb: "capture", definition: "A quick, unprocessed note you save to deal with later.", deprecated: ["quick note", "braindump", "todo"] },
  { key: "action", name: "Next action", short: "Action", plural: "Next actions", verb: "complete", definition: "A specific, concrete thing you can do next — the smallest unit of doing.", deprecated: ["task", "todo", "ticket"] },
  { key: "milestone", name: "Milestone", short: "Milestone", plural: "Milestones", definition: "A meaningful checkpoint within a project.", deprecated: ["phase", "epic"] },
  { key: "project", name: "Project", short: "Project", plural: "Projects", definition: "A body of related work with an outcome, made of milestones and actions.", deprecated: ["board", "initiative"] },
  { key: "goal", name: "Goal", short: "Goal", plural: "Goals", definition: "A longer-term outcome that projects serve.", deprecated: ["objective", "okr"] },
  { key: "workspace", name: "Workspace", short: "Workspace", plural: "Workspaces", definition: "A context you work within; groups sessions and records.", deprecated: ["team", "org", "space"] },
  { key: "session", name: "Session", short: "Session", plural: "Sessions", definition: "A recorded stretch of focused work.", deprecated: ["timer", "pomodoro"] },
  { key: "focusSession", name: "Focus session", short: "Focus", plural: "Focus sessions", verb: "focus", definition: "A deliberately quiet session on one target, with interruptions logged by hand.", deprecated: ["deep work session"] },
  { key: "horizon", name: "Planning horizon", short: "Horizon", plural: "Planning horizons", definition: "When you intend to work on something — a choice, never a deadline.", deprecated: ["bucket", "sprint", "column"] },
  { key: "dailyReview", name: "Daily review", short: "Review", plural: "Daily reviews", verb: "review", definition: "A short daily reflection on what happened and what's next.", deprecated: ["standup", "check-in"] },
  { key: "belief", name: "Belief", short: "Belief", plural: "Beliefs", definition: "A claim you hold, with evidence and revisions over time.", deprecated: ["fact", "note"] },
  { key: "citation", name: "Citation", short: "Citation", plural: "Citations", definition: "A link from a record back to its exact source in a document.", deprecated: ["reference link", "footnote"] },
  { key: "research", name: "Research", short: "Research", plural: "Research projects", definition: "An open investigation with questions, hypotheses, and evidence.", deprecated: ["study"] },
  { key: "entity", name: "Record", short: "Record", plural: "Records", definition: "Any first-class item in LifeOS (a project, belief, document…).", deprecated: ["object", "node", "row"] },
  { key: "document", name: "Document", short: "Document", plural: "Documents", verb: "read", definition: "An imported text you read, highlight, and cite.", deprecated: ["file", "article record"] },
  { key: "relationship", name: "Relationship", short: "Link", plural: "Relationships", definition: "A connection between two records.", deprecated: ["edge", "association"] },
  { key: "maintenanceCandidate", name: "Maintenance candidate", short: "Candidate", plural: "Maintenance candidates", definition: "Something that may need your attention — a duplicate, orphan, or stale record. Not an error.", deprecated: ["issue", "problem", "warning"] },
  { key: "insight", name: "Insight", short: "Insight", plural: "Insights", definition: "A descriptive view of recorded activity — counts and durations, never a score.", deprecated: ["analytics", "metric dashboard", "report card"] },
  { key: "archive", name: "Archive", short: "Archive", plural: "Archives", verb: "archive", definition: "Set aside without deleting; reversible.", deprecated: ["trash", "remove"] },
  { key: "discard", name: "Discard", short: "Discard", plural: "Discards", verb: "discard", definition: "Move out of the inbox; recoverable from the Recovery Center.", deprecated: ["delete", "dismiss"] },
  { key: "delete", name: "Delete", short: "Delete", plural: "Deletions", verb: "delete", definition: "Permanently remove. Some deletions are irreversible and say so.", deprecated: ["destroy", "purge"] },
  { key: "restore", name: "Restore", short: "Restore", plural: "Restores", verb: "restore", definition: "Bring back a discarded, archived, or backed-up item.", deprecated: ["undo delete", "recover"] },
  { key: "conflict", name: "Conflict", short: "Conflict", plural: "Conflicts", definition: "A record changed differently on two devices; you choose which to keep.", deprecated: ["merge error", "collision"] },
  { key: "sync", name: "Synchronization", short: "Sync", plural: "Syncs", verb: "sync", definition: "Keeping your local data and your account in agreement across devices.", deprecated: ["cloud save", "backup sync"] },
];

const BY_KEY = new Map(TERMS.map((t) => [t.key, t]));
export function term(key: string): Term | undefined { return BY_KEY.get(key); }

/** All deprecated alternatives → the canonical name that should replace them. */
export function deprecatedMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TERMS) for (const d of t.deprecated ?? []) out[d.toLowerCase()] = t.name;
  return out;
}

/** Scan a string for deprecated terms (word-boundary, case-insensitive). */
export function findDeprecated(text: string): { term: string; canonical: string }[] {
  const map = deprecatedMap();
  const hits: { term: string; canonical: string }[] = [];
  for (const [dep, canon] of Object.entries(map)) {
    if (new RegExp(`\\b${dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) hits.push({ term: dep, canonical: canon });
  }
  return hits;
}

export function validateTerminology(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const t of TERMS) {
    if (names.has(t.name)) problems.push(`duplicate canonical name ${t.name}`);
    names.add(t.name);
    if (!t.definition) problems.push(`${t.key} missing definition`);
    if (!t.plural) problems.push(`${t.key} missing plural`);
    // A deprecated alternative must not equal any canonical name.
    for (const d of t.deprecated ?? []) if (names.has(d)) problems.push(`${t.key} deprecates a canonical name: ${d}`);
  }
  return { ok: problems.length === 0, problems };
}
