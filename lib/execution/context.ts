/**
 * Project context — the working state of one project (LIFEOS-087 §4).
 *
 * ## What this is NOT
 *
 * Not a project-management system, and not a second copy of anything. The audit
 * found every fact this page needs already computed somewhere — commitment
 * signals, the attention shortlist, executive changes, repeated deferral, the
 * blocked map, and a next-action recommender that already explains its own
 * ancestry — and none of it reaching the Project page, which returned progress
 * 0, milestones 0, reading 0 and no sessions on a project holding eleven
 * actions, an overdue item, a blocker, two waits and a triple deferral.
 *
 * So this composes. It adds no ranking algorithm: `nextAction` is
 * `recommendNextAction` run over the project's own actions, with the FULL index
 * so a blocker outside the project still blocks.
 *
 * ## No score (§28)
 *
 * No health, no momentum, no risk, no alignment, no percentage. Every field is
 * a record, a count, or a recorded transition.
 *
 * ## Project lifecycle history does not exist (§27)
 *
 * Goals carry `history`; Projects carry only `updatedAt`. "When did this become
 * active?" is unanswerable, and `updatedAt` is never pressed into service as a
 * lifecycle event. `HISTORY_LIMITATION` says so where it matters.
 *
 * ## Ownership precedence, so one action is one row (§26)
 *
 *   NEXT      owns the recommendation
 *   WAITING   owns any action whose status is `waiting`
 *   BLOCKED   owns any action with an unfinished blocker
 *   OPEN      owns ordinary active work
 *   ATTENTION owns nothing — it attaches its reason to the row above
 *   DEFERRAL  owns nothing — it attaches a count to the row above
 *
 * ## Pure
 *
 * A function of `(state, projectId, ix, today)`. No store writes, no clock of
 * its own, no network, no AI, no persistence.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { ExecutiveChange } from "@/lib/memory/changes";
import type { Recommendation } from "@/lib/today/recommend";
import { todayKey } from "@/lib/reviews/dates";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { buildAttentionShortlist } from "@/lib/guidance/attention";
import { buildExecutiveChanges, repeatedlyPostponed, postponedLine } from "@/lib/memory/changes";
import { recommendNextAction } from "@/lib/today/recommend";
import { namesPerson, longerForms, personHint } from "@/lib/people/context";
import { isLive } from "@/lib/actions/due";

// ------------------------------------------------------------------ caps ---

/** §24. Enough to see what moved; never a changelog. */
export const MAX_RECENT = 5;
/** §7. A small open list, not a backlog wall. */
export const MAX_OPEN = 8;
/** §12. People are context, not a roster. */
export const MAX_PEOPLE = 6;
/** §35. The default window for "recently". Memory answers deeper history. */
export const RECENT_RANGE = "last_7_days" as const;

// --------------------------------------------------------------- results ---

/** One action, owned by exactly one section (§26). */
export interface ProjectRow {
  id: string;
  action: NextAction;
  /** An attention fact about this SAME action, attached rather than repeated. */
  attention?: string;
  /** "You deferred this 3 times." — attached, never a section of its own (§15). */
  deferral?: string;
  dueDate?: string;
  /** For a blocked row: the unfinished action it is waiting on. */
  blockedBy?: NextAction;
  /** For a waiting row: verbatim from the record. */
  waitingOn?: string;
  since?: string;
  followUpDate?: string;
  /** True only when the follow-up date has actually arrived (§11). */
  followUpDue?: boolean;
}

/** Someone the project's own records name (§12). */
export interface ProjectPerson {
  name: string;
  /** Where the name came from. The grounding, stated. */
  grounding: "waiting" | "action";
  waiting: number;
  actions: number;
  /** Longer names in the store beginning with this one — ambiguity, unresolved (§34). */
  longerForms: string[];
  route: string;
}

export interface ProjectContext {
  project: Project;
  /** §6. From `Project.goalId` only. Never inferred from names. */
  goal?: Goal;

  // ---- next and open ----------------------------------------------------
  /** §8. `recommendNextAction` over this project's actions. Not a new ranker. */
  next?: Recommendation;
  /** Why there is no recommendation, in the recommender's own words. */
  nextNote?: string;
  openRows: ProjectRow[];

  // ---- stuck ------------------------------------------------------------
  blocked: ProjectRow[];
  waiting: ProjectRow[];

  // ---- recently ---------------------------------------------------------
  /** §13, §35. Project-scoped, bounded window, factual transitions only. */
  recent: ExecutiveChange[];
  /** The window `recent` looked at, said out loud. */
  range: ResolvedRange;

  // ---- context ----------------------------------------------------------
  people: ProjectPerson[];
  /** §16. Rules already attached by the existing relevance system. Context only. */
  rules: string[];

  counts: { open: number; waiting: number; blocked: number; completed: number };
  empty: boolean;
}

// ------------------------------------------------------------- the model ---

export function buildProjectContext(
  state: StoreState,
  projectId: string,
  ix: TodayIndexes,
  today: DayKey = todayKey(),
): ProjectContext | undefined {
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  if (!project) return undefined;

  // §6. The recorded link, and nothing else. A goal is never inferred from a
  // title that happens to look similar.
  const goal = project.goalId ? (state.goals ?? []).find((g) => g.id === project.goalId) : undefined;

  const mine = (state.nextActions ?? []).filter((a) => a.projectId === projectId);
  const mineIds = new Set(mine.map((a) => a.id));

  // ---- facts about these actions, from the builders that already know ----
  const signals = new Map<string, { kind: string; explanation: string }>();
  for (const sig of buildCommitmentSignals(state, ix, { today })) {
    if (sig.recordRef.kind === "action" && mineIds.has(sig.recordRef.id) && !signals.has(sig.recordRef.id)) {
      signals.set(sig.recordRef.id, { kind: sig.kind, explanation: sig.explanation });
    }
  }

  /**
   * An attention line that restates what the row already shows is noise.
   *
   * The visual review found "Transcript from Maria" saying the follow-up was
   * today TWICE — once as the row's own meta, once as the signal beneath it.
   * A row renders its due date and its follow-up state itself, so the signals
   * that are ABOUT those two facts add nothing when they are already visible.
   */
  const attentionFor = (a: NextAction, shows: { due?: boolean; followUp?: boolean }): string | undefined => {
    const sig = signals.get(a.id);
    if (!sig) return undefined;
    if (shows.due && (sig.kind === "overdue" || sig.kind === "due_soon")) return undefined;
    if (shows.followUp && sig.kind === "follow_up_due") return undefined;
    return sig.explanation;
  };

  const range = resolveRange(RECENT_RANGE, { today });
  const deferrals = new Map<string, string>();
  for (const p of repeatedlyPostponed(state, range)) {
    if (mineIds.has(p.action.id)) deferrals.set(p.action.id, postponedLine(p));
  }

  /** Build a row once, so a section cannot invent its own version of a fact. */
  const row = (
    a: NextAction,
    extra: Partial<ProjectRow> = {},
    shows: { due?: boolean; followUp?: boolean } = {},
  ): ProjectRow => ({
    id: `row:${a.id}`,
    action: a,
    // §26. Attention and deferral attach; they never own a row.
    attention: attentionFor(a, shows),
    deferral: deferrals.get(a.id),
    dueDate: a.dueDate,
    ...extra,
  });

  // ---- §8. ONE recommendation, from the existing recommender -------------
  //
  // The state is narrowed to this project's actions; the INDEX is the full one,
  // so an action blocked by a blocker outside this project is still correctly
  // excluded. Passing a narrowed index would have quietly unblocked it.
  const rec = recommendNextAction({ ...state, nextActions: mine }, ix, today);
  const nextId = rec.recommendation?.action.id;

  // ---- ownership, in one pass (§26) --------------------------------------
  const owned = new Set<string>();
  if (nextId) owned.add(nextId);

  const waiting: ProjectRow[] = [];
  const blocked: ProjectRow[] = [];
  const openRows: ProjectRow[] = [];

  for (const a of mine) {
    if (!isLive(a) || owned.has(a.id)) continue;

    if (a.status === "waiting") {
      owned.add(a.id);
      waiting.push(row(a, {
        waitingOn: a.waitingOn?.trim(),
        since: a.waitingSince?.slice(0, 10),
        followUpDate: a.followUpDate,
        // §11. A date in the future is not a date that has arrived.
        followUpDue: !!a.followUpDate && a.followUpDate <= today,
      // The row renders the follow-up state itself.
      }, { followUp: !!a.followUpDate }));
      continue;
    }

    // §10. Real blocker evidence only. `blockedActionIds` already excludes an
    // action whose blocker is COMPLETED — the audit verified that — and nothing
    // here infers blocked from inactivity.
    if (ix.blockedActionIds.has(a.id)) {
      owned.add(a.id);
      // The UNFINISHED blocker. A completed one is why `blockedActionIds`
      // excluded the row in the first place, and naming it here would put a
      // finished action on screen as the thing holding this one up.
      const blockerId = [...(ix.blockedByMap.get(a.id) ?? [])]
        .find((bid) => { const b = ix.actionsById.get(bid); return !!b && isLive(b); });
      blocked.push(row(a, { blockedBy: blockerId ? ix.actionsById.get(blockerId) : undefined }));
      continue;
    }

    owned.add(a.id);
    // The row renders its due date itself.
    openRows.push(row(a, {}, { due: !!a.dueDate }));
  }

  const byDate = (x: ProjectRow, y: ProjectRow) =>
    (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999") || x.action.id.localeCompare(y.action.id);
  openRows.sort(byDate);
  blocked.sort(byDate);
  waiting.sort((x, y) =>
    (x.followUpDue === y.followUpDue ? 0 : x.followUpDue ? -1 : 1)
    || (x.since ?? "").localeCompare(y.since ?? "")
    || x.action.id.localeCompare(y.action.id));

  // ---- §13, §24. What actually moved, bounded to the window -------------
  //
  // Read from the project's ACTIONS, not from the project record: a Project has
  // no history, so scoping changes to the project entity returns nothing — the
  // audit measured exactly that, on a week in which an action completed and
  // another was deferred three times.
  //
  // Deduplicated per (kind, record): `buildExecutiveChanges` emits one entry per
  // EVENT, so an action deferred three times produced three identical "Deferred
  // Email professor" rows — the rows-per-event defect LIFEOS-084 removed from
  // the weekly review, arriving here by a different door. The most recent
  // occurrence stands for the rest, and the repeated-deferral COUNT is already
  // attached to that action's own row.
  //
  // And an action that OWNS A ROW above is excluded: its row is the live truth
  // and already carries the fact. "Email professor" appeared under Also open
  // saying "You deferred this 3 times" and then again under Recently as
  // "Deferred · Sep 3" — the same action twice on one screen, telling the
  // reader nothing the first row had not. Recently is for what MOVED; a
  // completed action owns no row, so it still appears.
  const rowOwned = new Set([...owned]);
  const seenChange = new Set<string>();
  const recent = buildExecutiveChanges(state, range)
    .filter((c) => c.entity.kind === "action" && mineIds.has(c.entity.id) && !rowOwned.has(c.entity.id))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
    .filter((c) => {
      const key = `${c.kind}:${c.entity.id}`;
      if (seenChange.has(key)) return false;
      seenChange.add(key);
      return true;
    })
    .slice(0, MAX_RECENT);

  // ---- §12, §34. People the project's own records name -------------------
  const people = projectPeople(state, project, mine);

  // ---- §16. Rules, through the EXISTING relevance system only ------------
  //
  // Not a lookup of the person's name against the Personal Code: the attention
  // layer already decides when a rule is grounded in an item's own words, and
  // §16 says a rule is context, never priority. Taking its answer means a rule
  // cannot reach this page by any route that does not already justify it.
  const rules = [...new Set(
    buildAttentionShortlist(state, ix, today, { limit: 5 })
      .filter((a) => a.entity.kind === "action" && mineIds.has(a.entity.id))
      .flatMap((a) => a.ruleContext),
  )];

  const counts = {
    open: openRows.length + (nextId ? 1 : 0),
    waiting: waiting.length,
    blocked: blocked.length,
    completed: mine.filter((a) => a.status === "completed").length,
  };

  return {
    project, goal,
    next: rec.recommendation ?? undefined,
    nextNote: rec.recommendation ? undefined : rec.note,
    openRows: openRows.slice(0, MAX_OPEN),
    blocked, waiting, recent, range, people, rules, counts,
    empty: mine.length === 0,
  };
}

// ---------------------------------------------------------------- people ---

/**
 * Names the project's own records contain (§12, §34).
 *
 * Grounded in `waitingOn` — the one structured field — and in action titles the
 * user wrote themselves. Nothing is inferred from unrelated prose, and nothing
 * is merged: LIFEOS-086's `longerForms` travels with each name so "Marcus" and
 * "Marcus Webb" stay two entries the person can tell apart, never one group.
 *
 * A title candidate must be a capitalised word that is NOT the first word (a
 * sentence always starts capitalised), at least three letters, and not
 * all-uppercase — so "Email", "UH" and "PDF" do not become people.
 */
export function projectPeople(state: StoreState, project: Project, mine: NextAction[]): ProjectPerson[] {
  const found = new Map<string, { grounding: "waiting" | "action"; waiting: number; actions: number }>();

  const note = (name: string, grounding: "waiting" | "action") => {
    const cur = found.get(name) ?? { grounding, waiting: 0, actions: 0 };
    // A wait is the stronger grounding and wins the label.
    if (grounding === "waiting") cur.grounding = "waiting";
    if (grounding === "waiting") cur.waiting++; else cur.actions++;
    found.set(name, cur);
  };

  for (const a of mine) {
    // `waitingOn` holds "what/who" — the guard in `personHint` is what keeps
    // "the letting agency" out.
    if (a.status === "waiting" && a.waitingOn && personHint(state, a.waitingOn.trim())) {
      note(a.waitingOn.trim(), "waiting");
    }
    for (const cand of nameCandidates(a.title ?? "")) note(cand, "action");

  }
  // §12's "explicit Project text".
  for (const cand of nameCandidates(project.description ?? "", { skipFirst: false })) note(cand, "action");

  return [...found.entries()]
    .map(([name, v]) => ({
      name, ...v,
      longerForms: longerForms(state, name).filter((f) => f !== name),
      route: `/people/${encodeURIComponent(name)}`,
    }))
    // A candidate only counts when the store actually has something under it.
    .filter((p) => !!personHint(state, p.name))
    .sort((a, b) => (b.waiting - a.waiting) || a.name.localeCompare(b.name))
    .slice(0, MAX_PEOPLE);
}

/**
 * Capitalised words that could be a person's name. Conservative by design.
 *
 * A candidate that directly FOLLOWS another candidate is part of that name, not
 * a name of its own: "Ask Marcus Webb for the survey" yields `Marcus`, never
 * `Webb`. Emitting both listed a surname fragment as a separate person, which
 * is neither how the user refers to anyone nor something Conqify can stand
 * behind. The longer form still reaches the reader — LIFEOS-086's `longerForms`
 * carries "Marcus Webb" as the ambiguity on Marcus's own entry (§34).
 */
function nameCandidates(text: string, opts: { skipFirst?: boolean } = {}): string[] {
  const skipFirst = opts.skipFirst ?? true;
  const words = text.trim().split(/\s+/);
  const out: string[] = [];
  let prevWasCandidate = false;
  words.forEach((raw, i) => {
    const w = raw.replace(/[^\p{L}'’-]/gu, "");
    const shaped = w.length >= 3 && w !== w.toUpperCase() && /^\p{Lu}/u.test(w);
    if (!shaped) { prevWasCandidate = false; return; }
    // A sentence-initial capital is an ARTIFACT of writing, not evidence of a
    // name — so it must not mark the next word as "part of the name before it".
    // Setting the flag here suppressed the real name in every title of the form
    // "Email Marcus the draft lease".
    if (skipFirst && i === 0) { prevWasCandidate = false; return; }
    if (prevWasCandidate) { prevWasCandidate = true; return; }      // part of the name before it
    out.push(w);
    prevWasCandidate = true;
  });
  return out;
}

/** Does this project's text name this person? Used by callers that already have a name. */
export function projectNamesPerson(project: Project, mine: NextAction[], name: string): boolean {
  return namesPerson(project.description, name)
    || namesPerson(project.title, name)
    || mine.some((a) => namesPerson(a.title, name) || namesPerson(a.waitingOn, name));
}

// ----------------------------------------------------------------- words ---

export const PROJECT_HEADINGS = {
  overview: "Overview",
  next: "Next and open",
  stuck: "Stuck and waiting",
  recent: "Recently",
  context: "Context",
} as const;

/** §27. Stated wherever a lifecycle claim would otherwise be tempting. */
export const HISTORY_LIMITATION =
  "Conqify keeps no history of project changes, so it cannot say when this project's status changed.";

/** §31. Factual, and it offers nothing automatic. */
export const NO_GOAL_LINKED = "No Goal linked.";

/** §30. Calm, and it never calls a project stalled. */
export const NO_OPEN_ACTIONS = "No open actions are recorded for this project.";

/** §29. Scoped exactly to recorded linked completions. */
export const NOTHING_COMPLETED = (label: string) =>
  `No linked actions completed in ${label}.`;

/** §28, §29. Words a project view may never use. */
export const PROJECT_FORBIDDEN_WORDS: readonly string[] = [
  "project health", "momentum", "risk score", "alignment", "on track", "off track",
  "stalled", "at risk", "velocity", "burn", "behind schedule", "slipping badly",
  "no progress", "failing", "healthy", "unhealthy",
];

/** Every string this layer can render, for the sweep. */
export function projectStrings(c: ProjectContext): string[] {
  return [
    ...Object.values(PROJECT_HEADINGS),
    HISTORY_LIMITATION, NO_GOAL_LINKED, NO_OPEN_ACTIONS, NOTHING_COMPLETED(c.range.label),
    c.nextNote ?? "",
    ...c.openRows.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.blocked.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.waiting.flatMap((r) => [r.attention ?? "", r.deferral ?? ""]),
    ...c.rules,
  ].filter(Boolean);
}
