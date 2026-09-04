/**
 * Person context — executive memory for people (LIFEOS-086 §20).
 *
 * ## This is NOT a CRM, and it is not an identity system
 *
 * The audit found no Person type, no people array, no contacts route and no
 * `person` ref kind. People exist as plain strings: `NextAction.waitingOn`
 * (documented "what/who", so it holds `"Maria"` and `"the letting agency"`
 * alike) and names the user wrote into their own prose.
 *
 * So this file does not claim identity. It answers one question — *what has
 * Conqify recorded that names this person?* — and every sentence it produces is
 * about a RECORD, never about a relationship. There is no score, no health, no
 * sentiment, no closeness, no inferred role, and no field any of those could
 * grow into (§4, §31, §32).
 *
 * ## Two names are never merged (§7, §8, §25)
 *
 * "Marcus" and "Marcus Webb" may be one person or two. Nothing here decides.
 * `longerForms` reports that a longer name exists so the ambiguity is visible
 * and a caller can ask; it never resolves it. Two different people who share a
 * first name cannot be told apart, and the product says so rather than implying
 * one person.
 *
 * ## Obligation is written, never inferred (§12)
 *
 * "What do I owe Marcus?" reads open work whose TITLE the user wrote his name
 * into. A name appearing in a note is a mention, not a promise — the two are
 * kept in different fields and worded differently, because §12 forbids
 * inferring obligation from mere mention.
 *
 * ## Ownership precedence, so one record is one row (§36)
 *
 *   WAITING           owns any record whose status is `waiting`
 *   OPEN COMMITMENTS  owns ordinary open actionable work
 *   ATTENTION         owns nothing; it attaches its reason to the row above
 *
 * ## Pure
 *
 * A function of `(state, name, options)`. No store writes, no clock of its own
 * beyond the `today` a caller passes, no network, no AI, no persistence.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { NextAction, StoreState } from "@/types/mvp";
import type { TodayIndexes } from "@/lib/today/indexes";
import type { CommitmentSignal } from "@/lib/commitment/signals";
import type { OriginType } from "@/lib/provenance";
import { todayKey } from "@/lib/reviews/dates";
import { buildCommitmentSignals } from "@/lib/commitment/signals";
import { isLive } from "@/lib/actions/due";
import { isMachineProduced } from "@/lib/provenance";
import { classifyOrigin } from "@/lib/provenance/classify";
import { noteDisplayTitle } from "@/lib/notes/notes";

// ------------------------------------------------------------------ caps ---

/** §29. Enough to recognise what is open; never a transcript. */
export const MAX_MENTIONS = 3;
/** A person view is a summary, not an inbox. */
export const MAX_PER_SECTION = 10;

// -------------------------------------------------------- name matching ---

/**
 * Does this text name this person?
 *
 * Word-boundary, case-insensitive, whole-phrase. Deliberately NOT a substring
 * test: `"Ali"` must not match `"Alice"`, and `"Ann"` must not match
 * `"planned"`. §8 asks for conservative matching, and the failure mode of a
 * loose one is attributing a stranger's commitments to someone.
 */
export function namesPerson(text: string | undefined, name: string): boolean {
  if (!text || !name.trim()) return false;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/** Every piece of text on a record that the USER wrote a name into. */
function actionText(a: NextAction): string {
  return a.title ?? "";
}

/**
 * Longer names in the store that begin with this one (§7, §8).
 *
 * The ambiguity signal, and nothing more. Asked for "Marcus" in a store that
 * also says "Marcus Webb", this reports `["Marcus Webb"]` so a caller can ask
 * which is meant. It does NOT decide, does not merge, and does not claim the
 * two are different people either — only that Conqify cannot tell.
 *
 * Found by scanning for the name followed by a capitalised word, which is the
 * least machinery that can surface the question. It is not a name detector and
 * makes no claim about what a person is called.
 */
export function longerForms(state: StoreState, name: string): string[] {
  const n = name.trim();
  if (!n) return [];
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escaped}\\s+\\p{Lu}\\p{L}+)`, "gu");
  const found = new Set<string>();
  for (const text of allText(state)) {
    for (const m of text.matchAll(re)) found.add(m[1].replace(/\s+/g, " ").trim());
  }
  return [...found].sort();
}

/** Every user-written string a name could appear in. */
function* allText(state: StoreState): Generator<string> {
  for (const a of state.nextActions ?? []) { yield a.title ?? ""; if (a.waitingOn) yield a.waitingOn; }
  for (const p of state.projects ?? []) { yield p.title ?? ""; yield p.description ?? ""; }
  for (const g of state.goals ?? []) { yield g.title ?? ""; yield g.description ?? ""; }
  for (const n of state.notes ?? []) if (!n.archived) yield n.body ?? "";
  for (const r of state.reflections ?? []) yield r.response ?? "";
}

/**
 * A cheap "is this a person Conqify knows about?" check (§18, §38).
 *
 * Deliberately NOT `buildPersonContext`: that builds commitment signals, and
 * universal search runs on every keystroke. This scans the same records once
 * and counts, with no signal pass and no index build.
 */
export interface PersonHint {
  name: string;
  commitments: number;
  waiting: number;
  mentions: number;
  links: number;
  total: number;
  /** Non-empty means the name is ambiguous and a surface must say so. */
  longerForms: string[];
}

/**
 * Whether a query names someone the store has commitments or waits about.
 *
 * Returns `null` when the text is not plausibly a person: a name must be
 * capitalised as written and at most two words. That guard is what keeps
 * "the letting agency" — a real `waitingOn` value — from being offered as a
 * person, and it is the same conservatism §8 asks of name matching.
 */
export function personHint(state: StoreState, query: string): PersonHint | null {
  const name = query.trim();
  if (!name || !/^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)?$/u.test(name)) return null;

  let commitments = 0, waiting = 0, mentions = 0, links = 0;
  for (const a of state.nextActions ?? []) {
    if (a.status === "waiting") { if (namesPerson(a.waitingOn, name)) waiting++; continue; }
    if (isLive(a) && namesPerson(a.title, name)) commitments++;
  }
  for (const n of state.notes ?? []) {
    if (n.archived || !namesPerson(n.body, name)) continue;
    if (!isMachineProduced(classifyOrigin({ kind: "note", text: n.body, fromAiText: n.fromAiText }))) mentions++;
  }
  for (const r of state.reflections ?? []) if (namesPerson(r.response, name)) mentions++;
  for (const p of state.projects ?? []) if (namesPerson(p.title, name) || namesPerson(p.description, name)) links++;
  for (const g of state.goals ?? []) if (namesPerson(g.title, name) || namesPerson(g.description, name)) links++;

  const total = commitments + waiting + mentions + links;
  if (total === 0) return null;
  return { name, commitments, waiting, mentions, links, total, longerForms: longerForms(state, name) };
}

/** The one-line summary of what is recorded with someone. Counts, never a score. */
export function personSummaryLine(h: PersonHint): string {
  const parts = [
    h.commitments ? `${h.commitments} open` : "",
    h.waiting ? `${h.waiting} waiting` : "",
    h.links ? `${h.links} project${h.links === 1 ? "" : "s"} or goal${h.links === 1 ? "" : "s"}` : "",
    h.mentions ? `${h.mentions} mention${h.mentions === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

// --------------------------------------------------------------- results ---

/** One open thing the user owes this person (§12). */
export interface PersonCommitment {
  id: string;
  action: NextAction;
  /** The factual reason this row is here. Never "you promised". */
  reason: string;
  /** An attention fact about the SAME record, attached rather than repeated. */
  attention?: string;
  dueDate?: string;
}

/** One thing the user is waiting on from this person (§10, §13). */
export interface PersonWaiting {
  id: string;
  action: NextAction;
  /** Exactly what the record says, verbatim. */
  waitingOn: string;
  since?: string;
  followUpDate?: string;
  /** True only when the follow-up date has actually arrived (§11, §34). */
  followUpDue: boolean;
  attention?: string;
}

/** A Project or Goal whose OWN text names the person (§14, §15). */
export interface PersonLink {
  id: string;
  kind: "project" | "goal";
  title: string;
  status?: string;
  /** Which field named them. The grounding, stated. */
  reason: string;
  route: string;
}

/** Something the user wrote that names the person (§16, §17). */
export interface PersonMention {
  id: string;
  kind: "note" | "reflection";
  text: string;
  /** The date the record carries — never `updatedAt` standing in (§34). */
  date: string;
  origin: OriginType;
  route: string;
}

export interface PersonContext {
  /** The name exactly as asked. Never normalised into an identity. */
  name: string;
  /**
   * Longer names in the store beginning with this one.
   *
   * Non-empty means Conqify cannot tell whether one person or several is meant,
   * and a surface must say so rather than pick (§7, §8, §35).
   */
  longerForms: string[];
  openCommitments: PersonCommitment[];
  waiting: PersonWaiting[];
  links: PersonLink[];
  mentions: PersonMention[];
  /** True when nothing at all is recorded under this name. */
  empty: boolean;
  /** True when the name appears only in prose — no commitment, no wait (§12). */
  mentionOnly: boolean;
}

// ------------------------------------------------------------- the model ---

export function buildPersonContext(
  state: StoreState,
  name: string,
  ix: TodayIndexes,
  today: DayKey = todayKey(),
): PersonContext {
  const signals = buildCommitmentSignals(state, ix, { today });
  const signalFor = new Map<string, CommitmentSignal>();
  for (const s of signals) {
    if (s.recordRef.kind === "action" && !signalFor.has(s.recordRef.id)) signalFor.set(s.recordRef.id, s);
  }

  // ---- WAITING owns anything whose status is `waiting` (§10, §36) ---------
  //
  // Read from `waitingOn` ONLY. That field is the one structured place a person
  // is recorded, and using it alone is what keeps "waiting on Maria" from
  // meaning "an action that mentions Maria somewhere".
  const waiting: PersonWaiting[] = [];
  for (const a of state.nextActions ?? []) {
    if (a.status !== "waiting" || !namesPerson(a.waitingOn, name)) continue;
    const sig = signalFor.get(a.id);
    waiting.push({
      id: `waiting:${a.id}`,
      action: a,
      waitingOn: a.waitingOn!.trim(),
      since: a.waitingSince?.slice(0, 10),
      followUpDate: a.followUpDate,
      // §11, §34. A date in the future is not a date that has arrived. The
      // existing signal layer decides this; nothing here re-derives urgency.
      followUpDue: !!a.followUpDate && a.followUpDate <= today,
      attention: sig?.explanation,
    });
  }
  waiting.sort((x, y) =>
    (x.followUpDue === y.followUpDue ? 0 : x.followUpDue ? -1 : 1)
    || (x.since ?? "").localeCompare(y.since ?? "")
    || x.action.id.localeCompare(y.action.id));

  // ---- OPEN COMMITMENTS: what the user WROTE, not what can be inferred ----
  //
  // §12. The title is where a person writes a promise — "Email Marcus the
  // draft". A name buried in a note is a mention, and treating it as an
  // obligation is exactly what §12 forbids.
  const owned = new Set(waiting.map((w) => w.action.id));
  const openCommitments: PersonCommitment[] = [];
  for (const a of state.nextActions ?? []) {
    if (owned.has(a.id) || !isLive(a) || !namesPerson(actionText(a), name)) continue;
    const sig = signalFor.get(a.id);
    openCommitments.push({
      id: `commitment:${a.id}`,
      action: a,
      // Factual, and it names the grounding: the user wrote the name here.
      reason: "You named them in this action",
      attention: sig?.explanation,
      dueDate: a.dueDate,
    });
  }
  openCommitments.sort((x, y) =>
    (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999") || x.action.id.localeCompare(y.action.id));

  // ---- PROJECTS AND GOALS: only where their OWN text names the person -----
  //
  // §14, §15. A project reached through an action that mentions someone is a
  // second hop, and the prose it travels through is not the project's own. So
  // the grounding is narrow on purpose: the record itself says the name.
  const links: PersonLink[] = [];
  for (const p of state.projects ?? []) {
    const where = namesPerson(p.title, name) ? "title" : namesPerson(p.description, name) ? "description" : null;
    if (!where) continue;
    links.push({
      id: `project:${p.id}`, kind: "project", title: p.title, status: p.status,
      reason: `Named in the project ${where}`, route: `/project/${p.id}`,
    });
  }
  for (const g of state.goals ?? []) {
    const where = namesPerson(g.title, name) ? "title" : namesPerson(g.description, name) ? "description" : null;
    if (!where) continue;
    links.push({
      id: `goal:${g.id}`, kind: "goal", title: g.title, status: g.status,
      reason: `Named in the goal ${where}`, route: `/goal/${g.id}`,
    });
  }
  links.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));

  // ---- MENTIONS: the user's own words, dated (§16, §17, §34) -------------
  const mentions: PersonMention[] = [];
  for (const n of state.notes ?? []) {
    if (n.archived || !namesPerson(n.body, name)) continue;
    const origin = classifyOrigin({ kind: "note", text: n.body, fromAiText: n.fromAiText });
    // §16, §33. A model's sentence about a person is never the user's own, and
    // this section's whole claim is authorship.
    if (isMachineProduced(origin)) continue;
    mentions.push({
      id: `note:${n.id}`, kind: "note", text: noteDisplayTitle(n),
      // `createdAt`, never `updatedAt` — §34 forbids fabricating an interaction
      // date, and a later edit is not a later mention.
      date: (n.createdAt ?? "").slice(0, 10), origin, route: `/notes?note=${n.id}`,
    });
  }
  for (const r of state.reflections ?? []) {
    if (!namesPerson(r.response, name)) continue;
    const origin = classifyOrigin({ kind: "reflection", text: r.response });
    if (isMachineProduced(origin)) continue;
    mentions.push({
      id: `reflection:${r.id}`, kind: "reflection", text: r.response,
      date: (r.createdAt ?? "").slice(0, 10), origin, route: "/formation/timeline",
    });
  }
  mentions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

  const trimmed = {
    openCommitments: openCommitments.slice(0, MAX_PER_SECTION),
    waiting: waiting.slice(0, MAX_PER_SECTION),
    links: links.slice(0, MAX_PER_SECTION),
    mentions: mentions.slice(0, MAX_MENTIONS),
  };

  return {
    name: name.trim(),
    longerForms: longerForms(state, name),
    ...trimmed,
    empty: openCommitments.length === 0 && waiting.length === 0
      && links.length === 0 && mentions.length === 0,
    // §12 said out loud: a name in prose with nothing open is not a debt.
    mentionOnly: openCommitments.length === 0 && waiting.length === 0 && mentions.length > 0,
  };
}

// ----------------------------------------------------------------- words ---

export const PERSON_HEADINGS = {
  open: "Open with them",
  waiting: "Waiting on",
  links: "Projects and goals",
  mentions: "Recently mentioned",
} as const;

/**
 * §37. Bounded to the record, and it never manufactures a follow-up.
 */
export const NOTHING_OPEN = (name: string) =>
  `No open commitments or waiting items are recorded with ${name}.`;

/**
 * §17. The precise claim, and the reason it is worded this way.
 *
 * Conqify knows the user WROTE something. It does not know they spoke, met, or
 * heard back — no communication is recorded anywhere in the schema — so the
 * sentence says "mentioned" and stops.
 */
export const MENTION_NOTE = "Your latest recorded mentions. Conqify records what you wrote, not whether you spoke.";

/** §7, §8. Said whenever a longer name exists. */
export const AMBIGUOUS_NAME = (name: string, forms: string[]) =>
  `Conqify also has ${forms.map((f) => `“${f}”`).join(" and ")}. It cannot tell whether that is the same ${name}.`;

/** §17's own identity limitation, stated wherever a person view appears. */
export const IDENTITY_LIMITATION =
  "Conqify matches the name as you wrote it. It has no contact records, so two people who share a name cannot be told apart.";

/** §4, §31, §32. Words a person view may never use. */
export const PEOPLE_FORBIDDEN_WORDS: readonly string[] = [
  "relationship score", "relationship health", "closeness", "trust score",
  "sentiment", "rapport", "engagement score", "contact score", "lead",
  "pipeline", "you seem", "you are frustrated", "seems responsive",
  "friend", "coworker", "colleague", "manager", "family",
];

/** Every string this layer can render, for the sweep. */
export function personStrings(c: PersonContext): string[] {
  return [
    ...Object.values(PERSON_HEADINGS),
    NOTHING_OPEN(c.name), MENTION_NOTE, IDENTITY_LIMITATION,
    ...c.openCommitments.map((x) => x.attention ?? ""),
    ...c.waiting.map((x) => x.attention ?? ""),
    ...c.links.map((x) => x.reason),
  ].filter(Boolean);
}
