/**
 * Export/import archive versioning (LIFEOS-040, Feature 12/14).
 *
 * The complete-account archive has its OWN version, distinct from the local
 * StoreState version and the DB migration version, so the export format can
 * evolve independently. Import validates this and refuses archives it cannot
 * faithfully represent.
 */

export const EXPORT_ARCHIVE_VERSION = 1;

/** The lowest archive version this build can import. */
export const MIN_SUPPORTED_ARCHIVE_VERSION = 1;

/** All StoreState domains in a STABLE order — the export's entity collections. */
export const EXPORT_DOMAINS = [
  "captures", "proposals", "beliefs", "sources", "feedback", "comparisons", "inquiries",
  "megathreads", "reflections", "practices", "reviews", "reasonings", "embeddings", "decisions",
  "formationSessions", "concepts", "conceptRelationships", "principles", "frameworks",
  "knowledgeProjects", "researchProjects", "dialogueSessions", "tensions", "syntheses",
  "recommendations", "documents", "citations", "workspaces", "sessions", "goals", "projects",
  "dailyReviews", "nextActions", "actionDependencies", "actionTemplates", "planningAssignments",
  "focusSessions", "maintenanceEvents", "duplicateCandidates", "savedInsightViews",
] as const;

export type ExportDomain = (typeof EXPORT_DOMAINS)[number];

export function isArchiveVersionSupported(v: number): boolean {
  return v >= MIN_SUPPORTED_ARCHIVE_VERSION && v <= EXPORT_ARCHIVE_VERSION;
}
