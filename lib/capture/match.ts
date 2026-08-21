/**
 * Local record association (LIFEOS-060 §10).
 *
 * ## Whole-title matching, and nothing looser
 *
 * "Finish the LotPilot dashboard" should offer to attach to the LotPilot
 * project. The temptation is fuzzy matching — token overlap, edit distance,
 * embeddings — and the sprint forbids it for a good reason: a wrong attachment
 * is silent. The user does not see the action land in the wrong project until
 * much later, and by then they have stopped trusting the ones that were right.
 *
 * So the rule is deliberately boring: **a project matches when its full title
 * appears in the text as whole words.** Nothing else counts. LotPilot matches
 * LotPilot. "dashboard" does not match "LotPilot dashboard", because a person
 * with two dashboards would get a coin flip.
 *
 * ## Generic titles are excluded
 *
 * A project called "Work" or "Home" would match half of everything a person
 * captures. Titles that are a single common word are skipped entirely — a
 * missed association costs one click; a constant wrong one costs the feature.
 *
 * ## Strength decides who chooses
 *
 *   - `strong`    — exactly one record matched → offered, attached on confirm
 *   - `ambiguous` — several matched → the user picks, nothing is preselected
 *   - `none`      — left unlinked, which is a perfectly good outcome
 *
 * ## Local, always
 *
 * This runs against `StoreState` in the browser. It never calls the model and
 * never sends record titles anywhere — §12 asks for project matching to stay
 * local where it can, and here it can.
 *
 * ## Pure
 */

import type { StoreState } from "@/types/mvp";

export type MatchStrength = "strong" | "ambiguous" | "none";

/** A record that could be attached to a candidate. */
export interface MatchOption {
  kind: "project" | "workspace" | "goal";
  id: string;
  title: string;
}

export interface MatchResult {
  strength: MatchStrength;
  /** The single match when `strong`; every match when `ambiguous`; empty otherwise. */
  options: MatchOption[];
}

export const NO_MATCH: MatchResult = { strength: "none", options: [] };

/**
 * Words too common to be a safe project name on their own.
 *
 * Only applied to SINGLE-word titles: a project called "Work Trip" is specific
 * enough, while one called "Work" is not.
 */
const GENERIC_TITLES = new Set([
  "work", "home", "life", "personal", "general", "misc", "other", "stuff", "inbox",
  "notes", "today", "admin", "tasks", "project", "projects", "main", "default", "new",
]);

const MIN_TITLE_CHARS = 3;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is this title specific enough to match on without producing noise? */
export function isMatchableTitle(title: string): boolean {
  const t = (title ?? "").trim();
  if (t.length < MIN_TITLE_CHARS) return false;
  const words = t.split(/\s+/);
  if (words.length === 1 && GENERIC_TITLES.has(t.toLowerCase())) return false;
  return true;
}

/**
 * Does `title` appear in `text` as whole words?
 *
 * Word boundaries are applied only where the title's own edge is a word
 * character — a title like "C++" has no trailing boundary to anchor to, and
 * requiring one would make it unmatchable.
 */
function containsTitle(text: string, title: string): boolean {
  const t = escapeRe(title.trim());
  const left = /^\w/.test(title.trim()) ? "\\b" : "";
  const right = /\w$/.test(title.trim()) ? "\\b" : "";
  return new RegExp(`${left}${t}${right}`, "i").test(text);
}

/**
 * Find records whose titles appear in the text.
 *
 * Projects are searched first and win outright: if a capture names both a
 * project and its parent goal, the project is the more specific answer and
 * offering both would be a question with an obvious right answer.
 */
export function matchRecords(text: string, state: StoreState): MatchResult {
  const src = (text ?? "").trim();
  if (!src) return NO_MATCH;

  const collect = (kind: MatchOption["kind"], rows: Array<{ id: string; title?: string; name?: string; status?: string }>): MatchOption[] =>
    rows
      .filter((r) => r.status !== "archived" && r.status !== "completed" && r.status !== "abandoned")
      .map((r) => ({ kind, id: r.id, title: (r.title ?? r.name ?? "").trim() }))
      .filter((o) => isMatchableTitle(o.title) && containsTitle(src, o.title));

  const projects = collect("project", (state.projects ?? []) as Array<{ id: string; title?: string; status?: string }>);
  if (projects.length > 0) {
    return projects.length === 1
      ? { strength: "strong", options: projects }
      : { strength: "ambiguous", options: projects };
  }

  const goals = collect("goal", (state.goals ?? []) as Array<{ id: string; title?: string; status?: string }>);
  const workspaces = collect("workspace", (state.workspaces ?? []) as Array<{ id: string; name?: string; title?: string; status?: string }>);
  const rest = [...goals, ...workspaces];
  if (rest.length === 1) return { strength: "strong", options: rest };
  if (rest.length > 1) return { strength: "ambiguous", options: rest };
  return NO_MATCH;
}

/** Turn a chosen option into the action fields that attach it. */
export function associationFields(option: MatchOption | undefined): { projectId?: string; goalId?: string; workspaceId?: string } {
  if (!option) return {};
  if (option.kind === "project") return { projectId: option.id };
  if (option.kind === "goal") return { goalId: option.id };
  return { workspaceId: option.id };
}
