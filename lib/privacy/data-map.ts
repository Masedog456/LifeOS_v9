/**
 * Data map (LIFEOS-040, Feature 27).
 *
 * A plain-language inventory of WHAT LifeOS stores, WHERE it lives (local device
 * vs remote Supabase), and whether it is exportable/deletable. The Privacy
 * Center renders this. It never claims end-to-end encryption (LifeOS does not
 * implement it) and never lists secrets (LifeOS stores none client-side beyond
 * the anon key and session token managed by Supabase).
 */

export type Location = "local" | "local+remote";

export interface DataCategory {
  category: string;
  description: string;
  location: Location;
  exportable: boolean;
  deletable: boolean;
}

export const DATA_MAP: readonly DataCategory[] = [
  { category: "Captures & inbox", description: "Quick notes you capture and their processing outcomes.", location: "local+remote", exportable: true, deletable: true },
  { category: "Beliefs, concepts & research", description: "Your knowledge records, revisions, and evidence links.", location: "local+remote", exportable: true, deletable: true },
  { category: "Documents & reading", description: "Imported documents, highlights, annotations, citations, progress.", location: "local+remote", exportable: true, deletable: true },
  { category: "Goals, projects, milestones, actions", description: "Your execution records and their histories.", location: "local+remote", exportable: true, deletable: true },
  { category: "Planning & focus", description: "Horizon assignments and focus-session records.", location: "local+remote", exportable: true, deletable: true },
  { category: "Sessions & workspaces", description: "Work sessions and workspace configuration.", location: "local+remote", exportable: true, deletable: true },
  { category: "Daily reviews", description: "Your review entries and reflections.", location: "local+remote", exportable: true, deletable: true },
  { category: "Insights saved views", description: "Named insight configurations — display choices only, no computed results.", location: "local+remote", exportable: true, deletable: true },
  { category: "Preferences", description: "UI settings, recents, pins, remembered ranges. No secrets.", location: "local+remote", exportable: true, deletable: true },
  { category: "Sync tombstones & conflicts", description: "Deletion markers and unresolved conflicts used to sync safely.", location: "local+remote", exportable: true, deletable: true },
  { category: "Sanitized diagnostics", description: "Redacted error codes and operation metadata. Never record contents.", location: "local+remote", exportable: true, deletable: true },
  { category: "Authentication", description: "Your email identity and session token are managed by Supabase; the token lives in your browser, never in an export.", location: "local+remote", exportable: false, deletable: true },
];

/** Where the app currently stores data given whether a remote is configured. */
export function effectiveLocations(remoteConfigured: boolean): { local: number; remote: number } {
  let local = 0, remote = 0;
  for (const d of DATA_MAP) { local++; if (remoteConfigured && d.location === "local+remote") remote++; }
  return { local, remote };
}

/** Everything a full export covers (exportable categories). */
export function exportableCategories(): DataCategory[] {
  return DATA_MAP.filter((d) => d.exportable);
}
