/**
 * Product-experience route inventory (LIFEOS-041, Feature 1).
 *
 * A machine-readable audit of every major surface: purpose, primary/secondary
 * actions, empty/loading/error states, mobile + keyboard + inspector behavior,
 * onboarding dependency, and known terminology/accessibility/visual notes. This
 * is the documented audit the sprint's changes are measured against; a self-test
 * asserts it covers the spec's required surfaces and that each entry is complete.
 */

export interface RouteAudit {
  route: string;
  surface: string;
  purpose: string;
  primaryAction: string;
  secondaryActions: string[];
  emptyState: string;      // canonical empty kind used
  loadingState: string;    // shell | skeleton | none
  errorState: string;      // boundary | inline | none
  mobile: string;
  keyboard: string;
  inspector: "panel" | "drawer" | "n/a";
  onboardingDependency: boolean;
  notes: string[];         // terminology / a11y / visual issues found (empty = clean)
}

export const ROUTE_INVENTORY: readonly RouteAudit[] = [
  { route: "/today", surface: "Today", purpose: "Primary daily entry point.", primaryAction: "Continue current work", secondaryActions: ["Capture", "Open review", "See plan"], emptyState: "account", loadingState: "shell", errorState: "boundary", mobile: "single column, calm", keyboard: "g t; capture shortcut", inspector: "panel", onboardingDependency: true, notes: [] },
  { route: "/", surface: "Capture", purpose: "Save a thought instantly.", primaryAction: "Save capture", secondaryActions: ["Process inbox"], emptyState: "route", loadingState: "none", errorState: "inline", mobile: "one-hand primary action", keyboard: "mod+shift+k", inspector: "n/a", onboardingDependency: true, notes: [] },
  { route: "/process", surface: "Capture processing", purpose: "Decide what a capture is.", primaryAction: "Process next", secondaryActions: ["Split", "Merge", "Link", "Defer", "Archive", "Discard"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "stacked", keyboard: "e process next", inspector: "drawer", onboardingDependency: true, notes: [] },
  { route: "/workspaces", surface: "Workspaces", purpose: "Choose a working context.", primaryAction: "Open workspace", secondaryActions: ["New workspace"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: [] },
  { route: "/goals", surface: "Goals", purpose: "Longer-term outcomes.", primaryAction: "Open goal", secondaryActions: ["New goal"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: [] },
  { route: "/projects", surface: "Projects", purpose: "Bodies of related work.", primaryAction: "Open project", secondaryActions: ["New project"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: true, notes: [] },
  { route: "/actions", surface: "Actions", purpose: "Concrete next steps.", primaryAction: "Complete action", secondaryActions: ["New action", "Defer", "Wait", "Filter"], emptyState: "filtered", loadingState: "skeleton", errorState: "boundary", mobile: "rows→cards", keyboard: "c new; j/k move", inspector: "drawer", onboardingDependency: true, notes: [] },
  { route: "/plan", surface: "Planning", purpose: "Assign horizons to work.", primaryAction: "Move to a horizon", secondaryActions: ["Filter", "Focus on item"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "single-column board", keyboard: "1-5 move", inspector: "drawer", onboardingDependency: false, notes: [] },
  { route: "/focus", surface: "Focus", purpose: "Quiet work on one target.", primaryAction: "Start / end focus", secondaryActions: ["Log interruption", "Open document"], emptyState: "route", loadingState: "none", errorState: "boundary", mobile: "reduced chrome", keyboard: "f start; esc end", inspector: "n/a", onboardingDependency: true, notes: [] },
  { route: "/daily", surface: "Daily Review", purpose: "Short honest look back.", primaryAction: "Complete review", secondaryActions: ["Open period summary"], emptyState: "date-range", loadingState: "skeleton", errorState: "boundary", mobile: "stacked", keyboard: "tab through", inspector: "n/a", onboardingDependency: true, notes: [] },
  { route: "/reading", surface: "Reading", purpose: "Read and cite documents.", primaryAction: "Open document", secondaryActions: ["Import", "Filter"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: [] },
  { route: "/document", surface: "Document", purpose: "Read one text closely.", primaryAction: "Highlight / annotate", secondaryActions: ["Cite", "Convert"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "single pane + tabs", keyboard: "j/k passages", inspector: "drawer", onboardingDependency: false, notes: ["reading width capped for line length"] },
  { route: "/world", surface: "Knowledge", purpose: "Concepts and relationships.", primaryAction: "Open record", secondaryActions: ["Filter"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: ["relationship density bounded"] },
  { route: "/constitution", surface: "Constitution", purpose: "What you have adopted as how you intend to live.", primaryAction: "Add to Constitution", secondaryActions: ["Revise", "Retire"], emptyState: "instructional", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "n/a", onboardingDependency: false, notes: [] },
  { route: "/beliefs", surface: "Beliefs", purpose: "Claims with evidence.", primaryAction: "Open belief", secondaryActions: ["Review"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: [] },
  { route: "/research", surface: "Research", purpose: "Open investigations.", primaryAction: "Open research", secondaryActions: ["New"], emptyState: "account", loadingState: "skeleton", errorState: "boundary", mobile: "list", keyboard: "arrow nav", inspector: "panel", onboardingDependency: false, notes: [] },
  { route: "/maintenance", surface: "Maintenance", purpose: "Careful stewardship of records.", primaryAction: "Review candidate", secondaryActions: ["Merge", "Archive", "Repair citation"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "stacked", keyboard: "arrow nav", inspector: "drawer", onboardingDependency: false, notes: ["candidates read as suggestions, not errors"] },
  { route: "/insights", surface: "Insights", purpose: "Descriptive views of activity.", primaryAction: "Choose a range", secondaryActions: ["Open a view", "Export", "Definitions"], emptyState: "date-range", loadingState: "skeleton", errorState: "boundary", mobile: "tables scroll", keyboard: "tab through", inspector: "n/a", onboardingDependency: false, notes: ["no red/green performance coding"] },
  { route: "/search", surface: "Search", purpose: "Find any record.", primaryAction: "Open result", secondaryActions: ["Filter by type"], emptyState: "search", loadingState: "none", errorState: "inline", mobile: "full-screen", keyboard: "/ focus", inspector: "n/a", onboardingDependency: false, notes: [] },
  { route: "inspector", surface: "Inspector", purpose: "Context for one record.", primaryAction: "Open full record", secondaryActions: ["Change range", "Open change log"], emptyState: "route", loadingState: "skeleton", errorState: "inline", mobile: "drawer", keyboard: "i open; esc close", inspector: "n/a", onboardingDependency: false, notes: ["opening never crushes workspace width"] },
  { route: "/backup", surface: "Backup", purpose: "Export & restore your data.", primaryAction: "Export", secondaryActions: ["Verify", "Import"], emptyState: "route", loadingState: "none", errorState: "boundary", mobile: "stacked", keyboard: "tab through", inspector: "n/a", onboardingDependency: false, notes: [] },
  { route: "/recovery", surface: "Recovery", purpose: "Recover discarded/archived items.", primaryAction: "Restore item", secondaryActions: ["Open conflict center"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "stacked", keyboard: "tab through", inspector: "n/a", onboardingDependency: false, notes: [] },
  { route: "/privacy", surface: "Privacy", purpose: "What's stored and your controls.", primaryAction: "Export / delete", secondaryActions: ["Open diagnostics"], emptyState: "route", loadingState: "none", errorState: "boundary", mobile: "stacked", keyboard: "tab through", inspector: "n/a", onboardingDependency: true, notes: [] },
  { route: "/security", surface: "Diagnostics", purpose: "Sanitized system status.", primaryAction: "Copy report", secondaryActions: ["Download", "Retry sync"], emptyState: "route", loadingState: "skeleton", errorState: "boundary", mobile: "stacked", keyboard: "tab through", inspector: "n/a", onboardingDependency: false, notes: [] },
];

/** Surfaces the spec (Feature 1) requires the inventory to cover. */
export const REQUIRED_SURFACES = [
  "Today", "Capture", "Workspaces", "Goals", "Projects", "Actions", "Planning", "Focus",
  "Daily Review", "Reading", "Document", "Knowledge", "Beliefs", "Research", "Maintenance",
  "Insights", "Search", "Inspector", "Backup", "Recovery", "Privacy", "Diagnostics",
];

export function validateRouteInventory(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const surfaces = new Set(ROUTE_INVENTORY.map((r) => r.surface));
  for (const req of REQUIRED_SURFACES) if (!surfaces.has(req)) problems.push(`inventory missing surface: ${req}`);
  for (const r of ROUTE_INVENTORY) {
    if (!r.purpose) problems.push(`${r.route} missing purpose`);
    if (!r.primaryAction) problems.push(`${r.route} missing primary action`);
    if (!r.emptyState) problems.push(`${r.route} missing empty state`);
    if (!r.mobile) problems.push(`${r.route} missing mobile behavior`);
    if (!r.keyboard) problems.push(`${r.route} missing keyboard behavior`);
  }
  return { ok: problems.length === 0, problems };
}
