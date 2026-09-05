/**
 * Capture → existing context (LIFEOS-089 §4).
 *
 * ## What the audit found
 *
 * Capture already matches existing records in two places, and both are narrow
 * in the same way. `matchRecords` (060) requires a record's WHOLE title to
 * appear as whole words, and `matchEditTargets` (065/066) requires every content
 * word of the query to be covered by the title. So:
 *
 *   "Send the Fall applications checklist to Priya."  → STRONG · Fall applications
 *   "Email Marcus about the clinic lease tomorrow."   → nothing at all
 *
 * The store held "Clinic launch" and an open "Read the clinic lease". The
 * capture was treated as if the rest of the user's life were blank — which is
 * the north star's failure mode exactly.
 *
 * ## The one new matching idea, and its limit
 *
 * A **shared distinctive title word**. A capture word grounds a match against a
 * live Project or Goal when it is a prefix of a word in that record's title AND
 * no OTHER record of that kind is reached by the same word.
 *
 * Prefix rather than equality is LIFEOS-085's rule, adopted for the reason 085
 * adopted it: it is what lets "grad school" find "Graduate school", and it is
 * one-directional, so "school" never matches "sch".
 *
 * Distinctiveness is what keeps it honest. A word that reaches two Projects
 * grounds nothing — it is a coin flip, and the audit's whole point is that a
 * wrong attachment is silent. This is not fuzzy matching with a threshold: a
 * word either points at exactly one record of its kind or it contributes
 * nothing, and the explanation names the word (§20).
 *
 * It is deliberately NOT semantic. "Call Maria" cannot reach "Call Marcus":
 * `matchEditTargets` requires every content word, and "maria" is not a prefix of
 * "marcus" (§7).
 *
 * ## Two guards the audit measured as necessary
 *
 * `detectStance` (080) reads the COMMITMENT OPERATOR — "I no longer want", "I
 * used to". It correctly calls both of these `asserted`:
 *
 *   "This isn't about graduate school anymore."                    (§38)
 *   "When I was applying to graduate school, I hated letters."     (§39)
 *
 * because neither negates wanting; one negates *aboutness* and the other is a
 * *tense*. Both currently link STRONG to the live Goal. Widening `stance.ts`
 * would destroy the distinction that module exists to hold, so the two
 * reference-scoped guards live here instead, and they suppress the CONTEXT
 * only — the capture itself is untouched (§19).
 *
 * ## Authority (§5)
 *
 * Recognition is not authority to mutate. Every suggestion here is
 * `confirm`-tier or below, and nothing in this file writes anything. Links are
 * applied by the caller through existing domain setters (§29).
 *
 * ## One hop (§23)
 *
 *   candidate → Project → its Goal.
 *
 * And it stops. A Project's Goal is `Project.goalId`, already stored, so Goal
 * context arrives INHERITED rather than as a second link (§13).
 *
 * ## Pure
 *
 * A function of `(candidate, state, index, today)`. No writes, no clock of its
 * own, no network, no AI, no persistence.
 */

import type { Goal, NextAction, StoreState } from "@/types/mvp";
import type { Candidate } from "@/lib/capture/interpret";
import type { AuthorityLevel } from "@/lib/capture/authority";
import { normalizeQuery, queryTokens } from "@/lib/command/ranking";
import { matchRecords, isMatchableTitle } from "@/lib/capture/match";
import { matchEditTargets } from "@/lib/capture/temporal-edit";
import { longerForms, personHint } from "@/lib/people/context";
import { nameCandidates } from "@/lib/execution/context";
import { isLive } from "@/lib/actions/due";

// ------------------------------------------------------------------ caps ---

/** §26. Context is compact — it is not an organizer form. */
export const MAX_SUGGESTIONS = 4;
/** §24. Enough alternatives to choose from; never a browser. */
export const MAX_ALTERNATIVES = 4;
/** §14. People are context, not a roster. */
export const MAX_PEOPLE = 3;

// --------------------------------------------------------------- results ---

/**
 * §21. Bounded, explainable classes. There is no percentage anywhere.
 *
 *   `exact`      the record's whole title appears in the capture (060's rule)
 *   `strong`     an existing open Action's every content word is covered
 *   `possible`   a shared distinctive title word
 *   `ambiguous`  several records match equally — the user chooses, nothing is
 *                preselected
 */
export type ContextStrength = "exact" | "strong" | "possible" | "ambiguous";

export type ContextType = "action" | "project" | "goal" | "person";

/** One record (or name) a capture may belong to. Never persisted (§4). */
export interface CaptureContextSuggestion {
  /** The candidate this is about, so the UI can key on it. */
  candidateId: string;
  contextType: ContextType;
  /** Internal only. §41 — never rendered. */
  contextId: string;
  label: string;
  /** §20. Why, in the user's own words and the record's. Never "AI thinks…". */
  reason: string;
  strength: ContextStrength;
  authority: AuthorityLevel;
  /** §24. Populated only when `ambiguous`. Nothing is preselected. */
  ambiguousAlternatives: { contextId: string; label: string }[];
  /**
   * §13. The Goal this Project already supports, stated as inherited fact.
   *
   * Present only on a `project` suggestion, and it is NOT a second link to
   * write — `Project.goalId` already carries it, and 087/088 already read it.
   */
  inheritedGoal?: { contextId: string; label: string; reason: string };
}

// ----------------------------------------------------------------- index ---

interface IndexedRecord {
  kind: "project" | "goal";
  id: string;
  title: string;
  /** Lowercased title words, split once. */
  words: string[];
  /** For a project: the Goal it supports. One hop, and the hop stops there. */
  goalId?: string;
}

/**
 * Everything the matcher needs, computed ONCE per interpretation (§42).
 *
 * Capture is a hot path and a capture can hold several candidates. Re-deriving
 * this per candidate would re-scan and re-normalize the whole store for every
 * clause the user typed.
 */
export interface CaptureContextIndex {
  records: IndexedRecord[];
  goalsById: Map<string, Goal>;
  liveActions: NextAction[];
  /** Lowercased title words of every live Project and Goal. See `capturePeople`. */
  recordWords: Set<string>;
  /** Live actions with their title words split once, for the duplicate tier. */
  actionWords: { action: NextAction; words: string[] }[];
}

/**
 * §40. Statuses that mean a record is finished, paused or put away.
 *
 * The same exclusion `matchRecords` already applies. Current work prefers
 * current contexts, and a capture that genuinely refers to a closed Project
 * still reaches it through the exact tier, because that tier is 060's and 060
 * makes the same choice.
 */
const CLOSED_STATUS = new Set(["archived", "completed", "abandoned", "replaced"]);

export function buildCaptureContextIndex(state: StoreState): CaptureContextIndex {
  const records: IndexedRecord[] = [];

  const add = (kind: "project" | "goal", id: string, title: string, goalId?: string) => {
    const t = (title ?? "").trim();
    // 060's guard, reused rather than re-derived: a project called "Work" would
    // match half of everything a person captures.
    if (!isMatchableTitle(t)) return;
    // Filtered with the same rule the capture's own words go through: a title's
    // stopwords and verbs are not what identifies it, and indexing them let
    // "the" and "open" ground matches.
    const words = contextTokens(t);
    if (words.length === 0) return;
    records.push({ kind, id, title: t, words, goalId });
  };

  for (const p of state.projects ?? []) {
    if (CLOSED_STATUS.has(p.status)) continue;
    add("project", p.id, p.title, p.goalId);
  }
  for (const g of state.goals ?? []) {
    if (CLOSED_STATUS.has(g.status)) continue;
    add("goal", g.id, g.title);
  }

  // §8. A completed Action is not a context for new work. `matchEditTargets`
  // will happily return one — the audit measured it returning the completed
  // "Order transcripts" — so the filter belongs here rather than being assumed.
  const liveActions = (state.nextActions ?? []).filter(isLive);

  return {
    records,
    goalsById: new Map((state.goals ?? []).map((g) => [g.id, g])),
    liveActions,
    // EVERY project and goal title, live or closed. `records` holds only the
    // live ones because closed records are not offered as context (§40), but
    // "Portuguese" is not a person's name just because the goal that contains
    // it was abandoned — the person guard needs the wider set.
    recordWords: new Set([
      ...(state.projects ?? []).flatMap((p) => normalizeQuery(p.title ?? "").split(" ")),
      ...(state.goals ?? []).flatMap((g) => normalizeQuery(g.title ?? "").split(" ")),
    ].filter(Boolean)),
    actionWords: liveActions.map((a) => ({
      action: a,
      words: normalizeQuery(a.title ?? "").split(" ").filter(Boolean),
    })),
  };
}

// ---------------------------------------------------------------- guards ---

/**
 * §38. Does this sentence disavow the thing it names?
 *
 * Narrow on purpose, and separate from `detectStance` for the reason the audit
 * gives: stance reads the commitment operator ("I no longer want to…"), and
 * "This isn't about graduate school anymore" negates ABOUTNESS instead. Both
 * readings are needed and neither subsumes the other.
 */
const DISAVOWAL_RE =
  /\b(?:is\s*n[o']?t|are\s*n[o']?t|was\s*n[o']?t|were\s*n[o']?t|no\s+longer|nothing\s+to\s+do\s+with|not)\s+(?:really\s+)?(?:about|part\s+of|related\s+to|for)\b|\banymore\b|\bno\s+longer\b/i;

export function mentionIsDisavowed(text: string): boolean {
  return DISAVOWAL_RE.test(text ?? "");
}

/**
 * §39. Is the mention framed as something in the past?
 *
 * "When I was applying to graduate school, I hated recommendation letters" is a
 * memory, not a statement about current work. The brief asks for restraint over
 * a hedge, so a historical frame suppresses the context rather than softening
 * it — the capture is still kept exactly as written.
 */
const HISTORICAL_RE =
  /\b(?:when\s+i\s+(?:was|used\s+to)|back\s+when|used\s+to|years?\s+ago|months?\s+ago|at\s+the\s+time|in\s+those\s+days)\b/i;

export function mentionIsHistorical(text: string): boolean {
  return HISTORICAL_RE.test(text ?? "");
}

/**
 * Words too common to ground a match on their own.
 *
 * `queryTokens` already drops stopwords. These are the words that survive it and
 * still say nothing about WHICH record is meant.
 */
const WEAK_TOKENS = new Set([
  "work", "home", "life", "new", "old", "next", "day", "days", "week", "weeks",
  "month", "months", "year", "years", "time", "today", "tomorrow", "plan",
  "project", "projects", "goal", "goals", "task", "tasks", "note", "notes",
  "thing", "list", "stuff", "get", "make", "one", "two", "first", "last",
  // Verbs. A verb is what you DO, not what a Project or Goal is ABOUT, and
  // titles routinely open with one — "Open the clinic" was reached by "open"
  // in "Book a school open day", which is noise wearing a match's clothes.
  "open", "close", "start", "finish", "read", "write", "send", "call", "email",
  "book", "draft", "order", "ask", "check", "review", "update", "fix", "buy",
  "pay", "learn", "practise", "practice", "sort", "keep", "run", "do", "go",
]);

/** The capture's own words, normalized once. */
export function contextTokens(text: string): string[] {
  return queryTokens(normalizeQuery(text ?? ""))
    .filter((t) => t.length >= 3 && !WEAK_TOKENS.has(t));
}

// ---------------------------------------------------------------- matching --

/**
 * Records reached by a word that reaches no OTHER record of the same kind.
 *
 * The prefix direction is LIFEOS-085's: a capture word must be an opening of a
 * title word, never the other way round.
 */
function distinctiveHits(
  tokens: string[],
  records: IndexedRecord[],
  kind: "project" | "goal",
): {
  hits: Map<string, { record: IndexedRecord; word: string }>;
  contested: IndexedRecord[];
} {
  const pool = records.filter((r) => r.kind === kind);
  const hits = new Map<string, { record: IndexedRecord; word: string }>();
  let contested: IndexedRecord[] = [];

  for (const token of tokens) {
    const reached = pool.filter((r) => r.words.some((w) => w.startsWith(token)));
    if (reached.length === 1) {
      const r = reached[0];
      if (!hits.has(r.id)) hits.set(r.id, { record: r, word: token });
      continue;
    }
    // A word reaching several records of one kind is a coin flip, and a wrong
    // attachment is silent — so it never grounds a link. But DROPPING it is
    // also silent, and hiding an ambiguity is the defect §24 exists to prevent:
    // the user is shown the choice instead, with nothing preselected.
    if (reached.length > 1 && reached.length <= MAX_ALTERNATIVES && contested.length === 0) {
      contested = reached;
    }
  }
  // A record that ended up grounded by another word is not contested.
  contested = contested.filter((r) => !hits.has(r.id));
  return { hits, contested: hits.size > 0 ? [] : contested };
}

/** How many shared distinctive words an existing Action must have (§7, §18). */
export const MIN_ACTION_WORDS = 2;

/** `“a”, “b” and “c”` — an English list, not a chain of "and"s. */
function quoteList(words: string[]): string {
  const q = words.map((w) => `“${w}”`);
  if (q.length <= 1) return q[0] ?? "";
  return `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

/**
 * Open Actions reached by at least two words that reach no other open Action.
 *
 * Two rather than one because one shared word is a coincidence — "draft" alone
 * would pull in every draft in the store. Distinctiveness is what stops "Call
 * Maria" reaching "Call Marcus": "maria" is not a prefix of "marcus", so they
 * share only "call", which reaches both and therefore grounds nothing (§7).
 */
function distinctiveActions(
  tokens: string[],
  index: CaptureContextIndex,
): { action: NextAction; words: string[] }[] {
  const hits = new Map<string, { action: NextAction; words: string[] }>();

  for (const token of tokens) {
    const reached = index.actionWords.filter((a) => a.words.some((w) => w.startsWith(token)));
    if (reached.length !== 1) continue;
    const { action } = reached[0];
    const cur = hits.get(action.id) ?? { action, words: [] };
    cur.words.push(token);
    hits.set(action.id, cur);
  }
  return [...hits.values()].filter((h) => h.words.length >= MIN_ACTION_WORDS);
}

// ------------------------------------------------------------- suggestions --

const ambiguousOf = (rows: IndexedRecord[]) =>
  rows.slice(0, MAX_ALTERNATIVES).map((r) => ({ contextId: r.id, label: r.title }));

/**
 * The existing context one candidate may belong to.
 *
 * Order of tiers is the whole safety story (§22): an EXACT whole-title match is
 * taken first and a looser one never displaces it, so a fuzzy recent Project
 * cannot outrank an exact old one.
 */
export function suggestContext(
  candidate: Candidate,
  state: StoreState,
  index: CaptureContextIndex,
): CaptureContextSuggestion[] {
  const text = candidate.evidence.text || candidate.fields.title || candidate.fields.body || "";
  const out: CaptureContextSuggestion[] = [];

  // §38, §39. The capture is kept either way; only the CONTEXT is withheld.
  if (mentionIsDisavowed(text) || mentionIsHistorical(text)) return out;

  const push = (s: CaptureContextSuggestion) => { if (out.length < MAX_SUGGESTIONS) out.push(s); };

  const goalTitle = (id?: string) => (id ? index.goalsById.get(id) : undefined);
  const inheritedFor = (r: IndexedRecord): CaptureContextSuggestion["inheritedGoal"] => {
    const g = goalTitle(r.goalId);
    // §40. An abandoned parent is not offered as live context, even inherited.
    if (!g || CLOSED_STATUS.has(g.status)) return undefined;
    return {
      contextId: g.id,
      label: g.title,
      reason: "This Project already supports that Goal.",
    };
  };

  // ---- Tier 1 (§22). 060's whole-title match, unchanged ------------------
  const exact = matchRecords(text, state);
  const exactIds = new Set(exact.options.map((o) => o.id));
  if (exact.strength === "strong") {
    const o = exact.options[0];
    const rec = index.records.find((r) => r.id === o.id);
    if (o.kind === "project" || o.kind === "goal") {
      push({
        candidateId: candidate.id,
        contextType: o.kind,
        contextId: o.id,
        label: o.title,
        reason: `“${o.title}” appears in what you wrote.`,
        strength: "exact",
        authority: "confirm",
        ambiguousAlternatives: [],
        inheritedGoal: o.kind === "project" && rec ? inheritedFor(rec) : undefined,
      });
    }
  } else if (exact.strength === "ambiguous") {
    const first = exact.options[0];
    push({
      candidateId: candidate.id,
      contextType: first.kind === "goal" ? "goal" : "project",
      contextId: "",
      label: exact.options.map((o) => o.title).join(" · "),
      reason: "More than one record by that name — choose which one.",
      strength: "ambiguous",
      authority: "confirm",
      ambiguousAlternatives: exact.options.slice(0, MAX_ALTERNATIVES)
        .map((o) => ({ contextId: o.id, label: o.title })),
    });
  }

  const tokens = contextTokens(text);

  // ---- Tier 2 (§18). An existing open Action that covers this clause -----
  //
  // Reuses 065/066's matcher rather than a parallel mechanism, and filters to
  // live records because that matcher will return a completed one (§8).
  const live = new Set(index.liveActions.map((a) => a.id));
  const actionHits = matchEditTargets(text, state, "action").filter((t) => live.has(t.id));
  if (actionHits.length === 1) {
    push({
      candidateId: candidate.id,
      contextType: "action",
      contextId: actionHits[0].id,
      label: actionHits[0].title,
      reason: "Strong title match to an open Action.",
      strength: "strong",
      authority: "confirm",
      ambiguousAlternatives: [],
    });
  } else if (actionHits.length > 1) {
    push({
      candidateId: candidate.id,
      contextType: "action",
      contextId: "",
      label: actionHits.map((t) => t.title).join(" · "),
      reason: "Several open Actions could be this one — choose which.",
      strength: "ambiguous",
      authority: "confirm",
      ambiguousAlternatives: actionHits.slice(0, MAX_ALTERNATIVES)
        .map((t) => ({ contextId: t.id, label: t.title })),
    });
  } else {
    // `matchEditTargets` requires EVERY content word of the query to be covered,
    // which is right for an edit query ("move the dentist") and wrong for a
    // whole sentence: "I'm waiting on Maria for the transcript" carries words no
    // action title will ever hold, so an existing open wait on Maria for the
    // transcript was invisible. The same distinctive-word rule used for Projects
    // answers it, with a second word required — one shared word is a
    // coincidence, two is a reference (§18).
    const dupes = distinctiveActions(tokens, index);
    if (dupes.length === 1) {
      push({
        candidateId: candidate.id,
        contextType: "action",
        contextId: dupes[0].action.id,
        label: dupes[0].action.title,
        reason: `${quoteList(dupes[0].words)} match an open Action.`,
        strength: "possible",
        authority: "confirm",
        ambiguousAlternatives: [],
      });
    } else if (dupes.length > 1) {
      push({
        candidateId: candidate.id,
        contextType: "action",
        contextId: "",
        label: dupes.map((d) => d.action.title).join(" · "),
        reason: "Several open Actions could be this one — choose which.",
        strength: "ambiguous",
        authority: "confirm",
        ambiguousAlternatives: dupes.slice(0, MAX_ALTERNATIVES)
          .map((d) => ({ contextId: d.action.id, label: d.action.title })),
      });
    }
  }

  // ---- Tier 3 (§9, §10). A shared distinctive title word ----------------
  const projectMatch = distinctiveHits(tokens, index.records, "project");
  const goalMatch = distinctiveHits(tokens, index.records, "goal");
  const projectHits = projectMatch.hits;
  const goalHits = goalMatch.hits;

  // The exact tier already spoke for these records.
  for (const id of exactIds) { projectHits.delete(id); goalHits.delete(id); }

  const projects = [...projectHits.values()];
  if (projects.length === 1) {
    const { record, word } = projects[0];
    push({
      candidateId: candidate.id,
      contextType: "project",
      contextId: record.id,
      label: record.title,
      reason: `“${word}” matches this Project.`,
      strength: "possible",
      authority: "confirm",
      ambiguousAlternatives: [],
      inheritedGoal: inheritedFor(record),
    });
  } else if (projects.length > 1 || projectMatch.contested.length > 1) {
    // §24. Several grounded Projects is a question, not a pick — whether they
    // were reached by different words or by the same one.
    const rows = projects.length > 1 ? projects.map((p) => p.record) : projectMatch.contested;
    push({
      candidateId: candidate.id,
      contextType: "project",
      contextId: "",
      label: rows.map((r) => r.title).join(" · "),
      reason: "More than one Project matches — choose which.",
      strength: "ambiguous",
      authority: "confirm",
      ambiguousAlternatives: ambiguousOf(rows),
    });
  }

  // §13. A Goal already carried by a matched Project arrives INHERITED, so
  // listing it again would put the same fact on screen twice.
  const inheritedIds = new Set(
    [...projectHits.values()].map((p) => p.record.goalId).filter(Boolean) as string[],
  );
  for (const o of exact.options) {
    const rec = index.records.find((r) => r.id === o.id);
    if (rec?.goalId) inheritedIds.add(rec.goalId);
  }
  const goals = [...goalHits.values()].filter((g) => !inheritedIds.has(g.record.id));

  if (goals.length === 1) {
    const { record, word } = goals[0];
    push({
      candidateId: candidate.id,
      contextType: "goal",
      contextId: record.id,
      label: record.title,
      reason: `“${word}” matches this Goal.`,
      strength: "possible",
      authority: "confirm",
      ambiguousAlternatives: [],
    });
  } else if (goals.length > 1 || goalMatch.contested.filter((g) => !inheritedIds.has(g.id)).length > 1) {
    const rows = goals.length > 1
      ? goals.map((g) => g.record)
      : goalMatch.contested.filter((g) => !inheritedIds.has(g.id));
    push({
      candidateId: candidate.id,
      contextType: "goal",
      contextId: "",
      label: rows.map((r) => r.title).join(" · "),
      reason: "More than one Goal matches — choose which.",
      strength: "ambiguous",
      authority: "confirm",
      ambiguousAlternatives: ambiguousOf(rows),
    });
  }

  // ---- Tier 4 (§14, §36). People, as text references -------------------
  for (const p of capturePeople(state, candidate, index)) {
    push(p);
  }

  return out;
}

/**
 * Names the capture contains (§14).
 *
 * LIFEOS-086's rules unchanged: a name is a TEXT REFERENCE, never an identity.
 * "Marcus" and "Marcus Webb" stay two references the reader can tell apart, and
 * the longer form travels with the shorter as unresolved ambiguity. No Person
 * domain is created and nothing is merged (§36).
 */
export function capturePeople(
  state: StoreState,
  candidate: Candidate,
  index: CaptureContextIndex,
): CaptureContextSuggestion[] {
  const seen = new Set<string>();
  const out: CaptureContextSuggestion[] = [];

  const note = (name: string, reason: string) => {
    const n = name.trim();
    if (!n || seen.has(n) || out.length >= MAX_PEOPLE) return;
    // A word of a Project or Goal title is not a person. "Practise Portuguese"
    // offered "Portuguese" and "Send the Fall applications checklist" offered
    // "Fall", both because `personHint` found the name somewhere in the store —
    // and where it found them was a record title, not a person (§14).
    if (index.recordWords.has(n.toLowerCase())) return;
    // The store must actually hold something under this name.
    if (!personHint(state, n)) return;
    seen.add(n);
    const longer = longerForms(state, n).filter((f) => f !== n);
    out.push({
      candidateId: candidate.id,
      contextType: "person",
      // A name is not a record. There is no id to carry, and inventing one
      // would be the first step toward a Person domain (§36).
      contextId: "",
      label: n,
      reason,
      strength: "possible",
      // §5. A person reference is context only. It is never a link to write.
      authority: "auto_safe",
      ambiguousAlternatives: longer.slice(0, MAX_ALTERNATIVES)
        .map((f) => ({ contextId: "", label: f })),
    });
  };

  // The structured field first — it is the one place the user named a person on
  // purpose.
  if (candidate.fields.waitingOn) note(candidate.fields.waitingOn, "You said you are waiting on them.");
  for (const cand of nameCandidates(candidate.evidence.text ?? "")) {
    note(cand, "Name appears in the capture.");
  }
  return out;
}

// -------------------------------------------------------------- the links ---

/**
 * The fields a confirmed suggestion contributes to a new record (§28, §29).
 *
 * Only a Project or a Goal becomes a field. A person reference is context and
 * never a link; an existing-Action match is a handoff, not an attachment; and a
 * Project's inherited Goal is deliberately NOT written — `Project.goalId`
 * already carries it, and adding `action.goalId` alongside would be a second
 * link saying the same thing, which 088 then has to deduplicate (§13).
 */
export function contextFields(
  accepted: CaptureContextSuggestion[],
  kind: string,
): { projectId?: string; goalId?: string } {
  // A note, a reflection and a protocol have no `projectId` or `goalId` to
  // write. Returning fields for them would have the UI offer a link the commit
  // path then silently drops — see `contextKnowledgeGoal` for the relationship
  // those kinds DO have.
  if (!FIELD_LINKABLE_KINDS.includes(kind)) return {};
  const project = accepted.find((s) => s.contextType === "project" && !!s.contextId);
  const goal = accepted.find((s) => s.contextType === "goal" && !!s.contextId);
  return {
    ...(project ? { projectId: project.contextId } : {}),
    // §12. Goal-only linkage is a first-class outcome: a Goal can carry direct
    // Actions, so a Goal match must never force a Project to be invented.
    ...(goal && !project ? { goalId: goal.contextId } : {}),
  };
}

/** Kinds whose confirmed context becomes a field on the record itself. */
export const FIELD_LINKABLE_KINDS: readonly string[] = ["action", "waiting", "event"];

/**
 * The Goal a note-shaped record attaches to, through `goal.linkedKnowledge`.
 *
 * §16 and §17 want a Reflection and a Protocol to carry Goal context without
 * becoming tasks, and `Goal.linkedKnowledge` is the relationship that already
 * means exactly that — `linkGoalKnowledge` is its setter and the goal page
 * already renders it (§29, §33).
 *
 * An explicit Goal match wins; failing that, a matched Project's inherited Goal
 * is used, because that is the Goal the work already supports (§13). Returns
 * nothing for kinds that carry their context as a field instead.
 */
export function contextKnowledgeGoal(
  accepted: CaptureContextSuggestion[],
  kind: string,
): string | undefined {
  if (FIELD_LINKABLE_KINDS.includes(kind)) return undefined;
  const goal = accepted.find((s) => s.contextType === "goal" && !!s.contextId);
  if (goal) return goal.contextId;
  return accepted.find((s) => s.contextType === "project" && s.inheritedGoal)?.inheritedGoal?.contextId;
}

// ----------------------------------------------------------------- words ---

export const CONTEXT_HEADING = "Possible context";

/** §27. The existing-record handoff, which never acts on its own. */
export const EXISTING_RECORD_LEAD = "Looks like this may refer to:";

/** §24. Said where nothing is preselected. */
export const CHOOSE_ONE = "Nothing is selected — pick the one you meant.";

/** §5, §20, §21. Words a context surface may never use. */
export const CONTEXT_FORBIDDEN_WORDS: readonly string[] = [
  "ai thinks", "ai believes", "confidence", "% match", "probably belongs",
  "auto-filed", "automatically linked", "we moved", "reorganized", "merged",
  "relevance score", "similarity",
];

/** Every string this layer can render, for the sweep. */
export function contextStrings(rows: CaptureContextSuggestion[]): string[] {
  return [
    CONTEXT_HEADING, EXISTING_RECORD_LEAD, CHOOSE_ONE,
    ...rows.map((r) => r.reason),
    ...rows.map((r) => r.label),
    ...rows.flatMap((r) => (r.inheritedGoal ? [r.inheritedGoal.reason, r.inheritedGoal.label] : [])),
  ].filter(Boolean);
}
