/**
 * Contextual education + Help mapping (LIFEOS-041, Features 11 + 12).
 *
 * Small, dismissible, reopenable explanations shown at moments of uncertainty,
 * plus the Help Center section map (sourced from the existing docs). Dismissed
 * lesson ids live in `prefs.education.dismissed` and UNION across devices. No
 * tooltip is the ONLY carrier of essential information; every lesson is
 * reopenable from Help.
 */

import { readPrefs, writePrefs } from "@/lib/prefs";

export interface Lesson {
  id: string;
  /** Where it appears (route or surface key). */
  context: string;
  title: string;
  body: string;
}

export const LESSONS: readonly Lesson[] = [
  { id: "planning-horizon", context: "/plan", title: "What a planning horizon means", body: "A horizon is when you intend to work on something — a choice, not a deadline. Move items freely." },
  { id: "action-vs-milestone", context: "/actions", title: "Action vs milestone", body: "A next action is one concrete thing you can do now. A milestone is a checkpoint made of several actions." },
  { id: "focus-mode", context: "/focus", title: "What Focus changes", body: "Focus quiets the interface around one target. Interruptions are logged by hand — nothing is auto-detected." },
  { id: "archive-meaning", context: "*", title: "What archive means", body: "Archive sets something aside without deleting it. You can un-archive anytime." },
  { id: "insights-descriptive", context: "/insights", title: "Why insights are descriptive", body: "Insights report counts and durations. They never score, rank, or judge your activity." },
  { id: "maintenance-candidate", context: "/maintenance", title: "Why this appeared", body: "A maintenance candidate is a suggestion — a possible duplicate, orphan, or stale record. It's not an error." },
  { id: "coverage-notice", context: "/insights", title: "What a coverage notice means", body: "It tells you what a view can and can't see yet — e.g. when your history began, or that open sessions are excluded." },
  { id: "schema-mismatch", context: "/security", title: "Why writing is paused", body: "Your app and server schemas differ. Reading and export stay available; writing pauses so nothing is corrupted." },
];

const BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
export function lesson(id: string): Lesson | undefined { return BY_ID.get(id); }

/** Lessons relevant to a route (exact match or wildcard `*`). */
export function lessonsForContext(context: string): Lesson[] {
  return LESSONS.filter((l) => l.context === context || l.context === "*");
}

export function dismissedLessons(): string[] {
  return ((readPrefs() as { education?: { dismissed?: string[] } }).education?.dismissed) ?? [];
}
export function dismissLesson(id: string): void {
  const cur = dismissedLessons();
  if (cur.includes(id)) return;
  writePrefs({ education: { dismissed: [...cur, id] } } as never);
}
export function reopenLesson(id: string): void {
  writePrefs({ education: { dismissed: dismissedLessons().filter((x) => x !== id) } } as never);
}
export function isDismissed(id: string): boolean {
  return dismissedLessons().includes(id);
}

// ---- Help Center map (Feature 12) — sourced from existing docs. ----
export interface HelpSection { id: string; title: string; doc: string; routes: string[] }
export const HELP_SECTIONS: readonly HelpSection[] = [
  { id: "getting-started", title: "Getting Started", doc: "ONBOARDING.md", routes: ["/today", "/welcome"] },
  { id: "capture", title: "Capture & Processing", doc: "CAPTURE_PROCESSING.md", routes: ["/", "/process", "/inbox"] },
  { id: "actions", title: "Projects & Actions", doc: "NEXT_ACTIONS.md", routes: ["/actions", "/projects", "/goals"] },
  { id: "planning", title: "Planning & Focus", doc: "PLANNING_AND_FOCUS.md", routes: ["/plan", "/focus"] },
  { id: "review", title: "Review today", doc: "DAILY_REVIEW.md", routes: ["/today/review", "/review"] },
  { id: "reading", title: "Reading & Knowledge", doc: "README.md", routes: ["/reading", "/library"] },
  { id: "maintenance", title: "Maintenance", doc: "KNOWLEDGE_MAINTENANCE.md", routes: ["/maintenance"] },
  { id: "insights", title: "Insights", doc: "DETERMINISTIC_INSIGHTS.md", routes: ["/insights"] },
  { id: "backup", title: "Backup & Restore", doc: "BACKUP_AND_RECOVERY.md", routes: ["/backup", "/recovery"] },
  { id: "privacy", title: "Privacy & Security", doc: "SECURITY_AND_PRIVACY.md", routes: ["/privacy", "/security"] },
  { id: "shortcuts", title: "Keyboard Shortcuts", doc: "ACCESSIBILITY.md", routes: [] },
  { id: "glossary", title: "Glossary", doc: "PRODUCT_LANGUAGE.md", routes: [] },
  { id: "troubleshooting", title: "Troubleshooting", doc: "PRODUCTION_OPERATIONS.md", routes: ["/security"] },
];

/** The most relevant help section for a route (route-aware help). */
export function helpForRoute(route: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.routes.includes(route)) ??
    HELP_SECTIONS.find((s) => s.routes.some((r) => route.startsWith(r) && r !== "/"));
}
