/**
 * Answering a memory question from recorded evidence (LIFEOS-069 §6–§16).
 *
 * ## Retrieval, then wording. Never the other way round.
 *
 * Every sentence this file produces is assembled from facts that were retrieved
 * first: a `completedAt`, an `Event.date`, a `history[].due_set`, a
 * `waitingSince`, the text of something the user wrote. Nothing is generated
 * from a question, and nothing is generated to fill a gap. When the evidence
 * runs out the answer says so and stops — §14's "no synthetic filler" is the
 * rule that decides most of the code below.
 *
 * ## The three confusions, again
 *
 * `lib/memory/week.ts` refuses to merge created with completed, scheduled with
 * attended, and touched with progressed. This file inherits all three by
 * construction, because it reads that module's timeline rather than the store:
 *
 *   - a COMPLETION answer filters `COMPLETION_KINDS` and can therefore never
 *     count an `action_created`
 *   - an EVENTS answer says "on your calendar" and carries the attendance
 *     limitation on every single response
 *   - a PROJECT answer counts linked dated facts and has no vocabulary for
 *     movement
 *
 * ## Authorship decides the verb (§6)
 *
 * "You said" is a claim about who wrote something. It is made only for records
 * whose provenance says the user wrote them, and only for the record types where
 * saying something is what the record IS. An AI-generated note kept in the store
 * is real evidence — of what a model produced — and it is reported that way.
 *
 * ## Nothing is persisted (§15, §19)
 *
 * A `MemoryAnswer` is a value computed from `(state, question)`. Deleting a
 * record removes it from every future answer with no invalidation step, because
 * there is nothing to invalidate.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { addDays, formatDayKey, todayKey } from "@/lib/reviews/dates";
import type { NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { buildActivityIndex, type ActivityEvent } from "@/lib/insights/activity";
import { classifyOrigin } from "@/lib/provenance/classify";
import { isMachineProduced, type OriginType } from "@/lib/provenance";
import { buildIndex, searchFlat } from "@/lib/command/search";
import { resolveRecord } from "@/lib/command/records";
import type { SearchEntry } from "@/lib/command/types";
import {
  buildAutobiographicalTimeline, buildWeekReview, COMPLETION_KINDS,
  type AutobiographicalEvent,
} from "@/lib/memory/week";
import {
  planMemoryQuery, MEMORY_QUERY_EXAMPLES, MEMORY_UNRESOLVED_LABEL,
  type MemoryQueryPlan,
} from "@/lib/memory/query";

// ---------------------------------------------------------------- contract --

/**
 * §14's three outcomes, plus one.
 *
 * `NEEDS_CHOICE` is not a fourth grade of evidence — it is the answer to a
 * different question. §13 requires that two plausible entities produce choices
 * rather than a guess, and neither of the other statuses can carry that
 * honestly: "partially answered" implies something was answered, and "no
 * recorded evidence" is false when the problem is that there is too much. Both
 * would have to be rendered as a guess by the UI, which is the exact failure
 * §13 exists to prevent.
 */
export type MemoryAnswerStatus =
  | "ANSWERED"
  | "PARTIALLY_ANSWERED"
  | "NO_RECORDED_EVIDENCE"
  | "NEEDS_CHOICE";

/** How Conqify is allowed to speak about one record, given who wrote it (§6). */
export type MemoryAttribution =
  | "You wrote"
  | "You captured"
  | "You said"
  | "You recorded"
  | "You added"
  | "You completed"
  | "On your calendar"
  | "Conqify recorded"
  | "A note contains"
  | "An AI-generated note contains"
  | "An imported item says"
  | "From your document";

export interface MemoryAnswerItem {
  /** The record's own words. Never generated prose. */
  text: string;
  attribution: MemoryAttribution;
  day?: DayKey;
  /** The day, formatted. Present whenever `day` is. */
  when?: string;
  /** Extra recorded detail — an occurrence date, a person, a time. */
  detail?: string;
  ref?: RecordRefLite;
  /** Where this opens. Absent only when the record has no surface at all. */
  href?: string;
  /** The field this line traces to. Asserted in tests (§6 of LIFEOS-064). */
  evidence: string;
  origin: OriginType;
}

/** One of several records the question could have meant (§13). */
export interface MemoryChoice {
  ref: RecordRefLite;
  title: string;
  /** What kind of record it is, in the user's words. */
  kindLabel: string;
  href?: string;
}

export interface MemoryAnswer {
  status: MemoryAnswerStatus;
  heading: string;
  /** Arithmetic over the items below. Never an appraisal. */
  summary?: string;
  items: MemoryAnswerItem[];
  /** What this answer cannot tell you (§14). */
  limitation?: string;
  sourceRefs: RecordRefLite[];
  choices?: MemoryChoice[];
  /** The plan that produced this. Transient, for the UI and for tests. */
  plan?: MemoryQueryPlan;
}

/**
 * Record kinds a memory question may never retrieve (§19).
 *
 * The Constitution and Beliefs are what the user holds to be true about
 * themselves, not a record of what happened — and LIFEOS-056 drew a hard line
 * around sending them anywhere. A question about last week has no business
 * reaching either, so they are removed from the candidate set before any
 * matching happens rather than filtered out of the output afterwards.
 */
export const MEMORY_EXCLUDED_KINDS: readonly string[] = [
  "belief", "constitution_element",
];

/**
 * How far back a question with no stated period looks.
 *
 * "When did I finish X?" scans history arrays and is unbounded. But a question
 * like "what did I finish?" projects a timeline, and projecting one over an
 * unbounded span means expanding every recurrence rule since the store's first
 * record. The window is bounded, and the answer SAYS it is bounded — a silent
 * cap is the same lie as a silent guess.
 */
export const IMPLICIT_LOOKBACK_DAYS = 365;

export const NO_EVIDENCE_LINE = "I found no recorded evidence for that in Conqify.";

// ------------------------------------------------------------- attribution --

const AUTHORED: readonly OriginType[] = ["user_authored", "imported_user_authored"];

/** Record kinds where "saying something" is what the record IS (§5). */
const SPOKEN_KINDS: readonly string[] = ["reflection", "note", "capture", "decision"];

/**
 * The verb Conqify may use about one record.
 *
 * Two inputs, both recorded: what kind of record it is, and where its text came
 * from. Nothing here consults the question — a note does not become something
 * the user said because they asked "what did I say".
 */
export function attributionFor(kind: string, origin: OriginType): MemoryAttribution {
  if (origin === "original_source") return "From your document";
  if (isMachineProduced(origin)) {
    // §23, negative assertion 4. An AI-generated note is evidence of what a
    // model produced. Reporting it as the user's words would put sentences in
    // their mouth and then cite them back to them as their own memory.
    return origin === "derived" ? "Conqify recorded" : "An AI-generated note contains";
  }
  if (origin === "imported_user_authored") return "An imported item says";
  if (!AUTHORED.includes(origin)) {
    // `unknown` is the honest answer for an Action or an Event: neither has a
    // field that records who wrote its title, and `classifyOrigin` refuses to
    // guess. So the attribution refuses too — it reports that Conqify holds the
    // record without claiming the user authored it. Calling an Action "a note"
    // (the old fallback) was wrong about the record type as well as the author.
    return kind === "event" ? "On your calendar" : "Conqify recorded";
  }
  switch (kind) {
    case "capture": return "You captured";
    case "reflection": return "You wrote";
    case "note": return "You wrote";
    case "decision": return "You recorded";
    case "action": return "You added";
    case "event": return "On your calendar";
    default: return "You recorded";
  }
}

/**
 * May this record be quoted as something the user SAID?
 *
 * Both conditions, never one: the user wrote it, and it is the kind of record a
 * person says things in. An Event title is neither — §5 is explicit that a
 * calendar entry called "teaching prep" is not the user saying anything about
 * teaching, and answering "you said" from one would be inventing a quotation.
 */
export function canQuoteAsSaid(kind: string, origin: OriginType): boolean {
  // `user_authored` only — NOT `imported_user_authored`. §6 puts imported
  // material in the same bucket as derived and AI prose ("an imported item
  // says") for a reason: the user wrote it somewhere else, in some other
  // context, and an importer decided what to bring across. Quoting that back as
  // "you said" attributes to a Conqify record a fidelity nothing here can
  // vouch for.
  return origin === "user_authored" && SPOKEN_KINDS.includes(kind);
}

// ---------------------------------------------------------------- helpers ---

const fmt = (day: DayKey): string => formatDayKey(day, { weekday: "short", month: "short", day: "numeric" });

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Join clauses into one sentence without an Oxford-comma argument. */
function sentence(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The default window, and the fact that it IS a window. */
function implicitRange(today: DayKey): ResolvedRange {
  return resolveRange("custom", {
    today, customStart: addDays(today, -IMPLICIT_LOOKBACK_DAYS), customEnd: today,
  });
}

const KIND_LABEL: Record<string, string> = {
  action: "Action", event: "Calendar event", note: "Note", capture: "Capture",
  reflection: "Reflection", decision: "Decision", project: "Project",
  goal: "Goal", document: "Document", source: "Library item",
};

/**
 * One line of a record's text, fit to sit next to an attribution label.
 *
 * Machine prose kept in a note carries its attribution INSIDE the text
 * (LIFEOS-050A), which is what makes the authorship survive export and editing.
 * On an answer line that marker is both redundant — the attribution is already
 * printed beside it — and disfiguring, because it contains a blank line. The
 * marker is removed for display only; the stored record is untouched, and the
 * origin it declares is what produced the label in the first place.
 */
function displayText(text: string): string {
  return (text ?? "")
    .replace(/^_(?:AI-generated|Generated from your document)(?:\s*\([^)]{1,60}\))?\s*—\s*[^\n]*_\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A timeline fact becomes an answer item, keeping its evidence field. */
function itemOf(state: StoreState, e: AutobiographicalEvent, attribution?: MemoryAttribution): MemoryAnswerItem {
  const record = resolveRecord(state, e.recordRef.kind, e.recordRef.id);
  return {
    text: displayText(e.title),
    attribution: attribution ?? attributionFor(e.recordRef.kind, e.origin),
    day: e.day,
    when: fmt(e.day),
    detail: e.detail,
    ref: e.recordRef,
    href: record?.href,
    evidence: e.evidence,
    origin: e.origin,
  };
}

const refsOf = (items: MemoryAnswerItem[]): RecordRefLite[] =>
  items.map((i) => i.ref).filter((r): r is RecordRefLite => !!r);

// ------------------------------------------------------- entity resolution --

/**
 * Which records could the question have meant?
 *
 * Tiered, and the tiers do not mix. An exact title match and a substring match
 * are different kinds of evidence that the user meant this record, and pooling
 * them lets a weak match dilute a strong one — which is how a question about
 * "Dashboard" ends up ambiguous with "Dashboard rewrite QA notes".
 *
 * Recency is deliberately absent. §13: "Do not use recency as a secret
 * tie-breaker." When the top tier holds more than one record, the user is asked.
 */
export function resolveEntities(index: SearchEntry[], query: string, kinds?: readonly string[]): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pool = index.filter((e) =>
    !MEMORY_EXCLUDED_KINDS.includes(e.kind) && (!kinds || kinds.includes(e.kind)));

  const exact = pool.filter((e) => e.titleLower === q || e.aliasesLower.includes(q));
  if (exact.length) return exact;
  const word = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const titled = pool.filter((e) => word.test(e.titleLower));
  if (titled.length) return titled;
  return pool.filter((e) => e.titleLower.includes(q));
}

function choicesOf(entries: SearchEntry[]): MemoryChoice[] {
  return entries.slice(0, 6).map((e) => ({
    ref: { kind: e.kind, id: e.id },
    title: e.title,
    kindLabel: KIND_LABEL[e.kind] ?? e.kind,
    href: e.href,
  }));
}

function needsChoice(question: string, entries: SearchEntry[], plan: MemoryQueryPlan): MemoryAnswer {
  return {
    status: "NEEDS_CHOICE",
    heading: "More than one record matches",
    summary: `Conqify has ${entries.length} records that could be “${plan.entityQuery}”. Which one did you mean?`,
    items: [],
    choices: choicesOf(entries),
    sourceRefs: entries.slice(0, 6).map((e) => ({ kind: e.kind, id: e.id })),
    plan,
  };
}

function noEvidence(plan: MemoryQueryPlan, detail?: string): MemoryAnswer {
  return {
    status: "NO_RECORDED_EVIDENCE",
    heading: "Nothing recorded",
    summary: NO_EVIDENCE_LINE,
    items: [],
    limitation: detail,
    sourceRefs: [],
    plan,
  };
}

/** The window this answer looked at, said out loud. */
function rangeSuffix(plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean): string {
  if (plan.range) return ` · ${range.label}`;
  return implicit ? " · the last 12 months" : "";
}

const IMPLICIT_NOTE =
  `You didn't name a period, so this looks at the last ${IMPLICIT_LOOKBACK_DAYS} days.`;

// ------------------------------------------------------------ answer entry --

export interface AnswerOptions {
  today?: DayKey;
  /** A prebuilt activity index, when the caller already has one (§25). */
  index?: ActivityEvent[];
  /** A prebuilt search index, likewise. */
  searchIndex?: SearchEntry[];
  /**
   * The record the user picked from a `NEEDS_CHOICE` answer.
   *
   * This is the resolution path for §13: the choice comes from the person, not
   * from a tie-breaker. It is honoured only when it is one of the candidates the
   * question actually matched, so a ref cannot be used to point an answer at a
   * record the question had nothing to do with.
   */
  focusRef?: RecordRefLite;
}

/** Narrow a candidate set to the record the user picked, if they picked one. */
function focused(candidates: SearchEntry[], focusRef?: RecordRefLite): SearchEntry[] {
  if (!focusRef) return candidates;
  const hit = candidates.filter((c) => c.kind === focusRef.kind && c.id === focusRef.id);
  return hit.length ? hit : candidates;
}

/**
 * Answer a question about recorded life, or say why it cannot be answered.
 *
 * Pure. Reads the store, writes nothing.
 */
export function answerMemoryQuery(state: StoreState, question: string, opts: AnswerOptions = {}): MemoryAnswer {
  const today = opts.today ?? todayKey();
  const projects = (state.projects ?? []).map((p) => ({ id: p.id, title: p.title }));
  const plan = planMemoryQuery(question, { today, projects });

  if (!plan) {
    return {
      status: "NO_RECORDED_EVIDENCE",
      heading: "Conqify can't answer that one",
      summary:
        "Conqify answers questions about what it recorded — what you finished, what was on your calendar, what you're waiting on, what changed, what happened with a project, what you wrote about something, and when you did a particular thing.",
      items: [],
      limitation: `Try one of these: ${MEMORY_QUERY_EXAMPLES.slice(0, 3).map((e) => `“${e}”`).join(", ")}.`,
      sourceRefs: [],
    };
  }

  // A period that has not happened yet has nothing in it, and no amount of
  // retrieval will change that. Said before any work is done.
  const future = plan.unresolved.find((u) => u.reason === "future_range");
  if (future) {
    return {
      status: "NO_RECORDED_EVIDENCE",
      heading: "That hasn't happened yet",
      summary: `“${future.phrase}” is ahead of today. Memory only holds what was recorded.`,
      items: [], sourceRefs: [], plan,
    };
  }

  const searchIndex = opts.searchIndex ?? buildIndex(state);
  const implicit = !plan.range;
  const range = plan.range ?? implicitRange(today);

  switch (plan.kind) {
    case "COMPLETION": return answerCompletion(state, plan, range, implicit, opts);
    case "EVENTS": return answerEvents(state, plan, range, implicit, opts);
    case "WAITING": return answerWaiting(state, plan, today);
    case "CHANGES": return answerChanges(state, plan, range, implicit, opts);
    case "PROJECT": return answerProject(state, plan, range, implicit, searchIndex, opts);
    case "REFLECTION": return answerReflection(state, plan, searchIndex);
    case "OPEN_WORK": return answerOpenWork(state, plan, today, opts);
    case "TIME": return answerTime(state, plan, searchIndex, opts);
    default: return noEvidence(plan);
  }
}

// -------------------------------------------------------------- COMPLETION --

/**
 * What finished (§7).
 *
 * Filters `COMPLETION_KINDS` and nothing else. An `action_created` cannot reach
 * this list, which is the structural version of "never count a created action as
 * an accomplishment" — there is no code path that would have to remember not to.
 */
function answerCompletion(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean, opts: AnswerOptions,
): MemoryAnswer {
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);
  const done = timeline.filter((e) => (COMPLETION_KINDS as string[]).includes(e.kind));
  if (done.length === 0) {
    return {
      ...noEvidence(plan, implicit ? IMPLICIT_NOTE : undefined),
      heading: `Nothing recorded as completed${rangeSuffix(plan, range, implicit)}`,
      summary: "Conqify has no completions recorded in that period. That means nothing was marked done here — not that nothing happened.",
    };
  }

  const oneTime = done.filter((e) => e.kind === "completed_action");
  const recurring = done.filter((e) => e.kind === "recurring_completion");
  const items = done.map((e) => itemOf(state, e, "You completed"));

  const parts: string[] = [];
  if (oneTime.length) parts.push(`completed ${plural(oneTime.length, "action")}`);
  if (recurring.length) parts.push(`kept ${plural(recurring.length, "recurring commitment")}`);

  return {
    status: "ANSWERED",
    heading: `Completed${rangeSuffix(plan, range, implicit)}`,
    summary: `You ${sentence(parts)}.`,
    items,
    limitation: implicit ? IMPLICIT_NOTE : undefined,
    sourceRefs: refsOf(items),
    plan,
  };
}

// ------------------------------------------------------------------ EVENTS --

/** Asks what happened AT something, rather than what was scheduled. */
const ASKS_ABOUT_CONTENT =
  /\bwhat (?:did (?:i|we) do|happened|went on|was said)\b[\s\S]*\b(?:at|in|during|inside)\b|\bhow (?:did|was) .+ (?:go|going)\b/;

export const ATTENDANCE_LIMITATION =
  "Events show what was on the calendar. Conqify has no record of whether you attended, or of what happened at one.";

/**
 * What was on the calendar (§8).
 *
 * The wording is fixed and the limitation is unconditional: an Event row records
 * an intention to be somewhere, and there is no field anywhere in the schema
 * that records having been there. "You attended" is not a phrase this file can
 * produce, because no branch constructs it.
 */
function answerEvents(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean, opts: AnswerOptions,
): MemoryAnswer {
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);
  let scheduled = timeline.filter((e) => e.kind === "event_scheduled");

  if (plan.entityQuery) {
    const q = plan.entityQuery.toLowerCase();
    scheduled = scheduled.filter((e) => e.title.toLowerCase().includes(q));
  }

  // "What did I do at my dentist appointment?" — the schedule is retrievable,
  // the content of the appointment is not. Both halves are reported.
  const wantsContent = ASKS_ABOUT_CONTENT.test(plan.question.toLowerCase());

  if (scheduled.length === 0) {
    return {
      ...noEvidence(plan, ATTENDANCE_LIMITATION),
      heading: `Nothing on the calendar${rangeSuffix(plan, range, implicit)}`,
      summary: plan.entityQuery
        ? `Conqify has no calendar entry matching “${plan.entityQuery}” in that period.`
        : NO_EVIDENCE_LINE,
    };
  }

  const items = scheduled.map((e) => itemOf(state, e, "On your calendar"));
  return {
    status: wantsContent ? "PARTIALLY_ANSWERED" : "ANSWERED",
    heading: `On your calendar${plan.entityQuery ? ` · “${plan.entityQuery}”` : ""}${rangeSuffix(plan, range, implicit)}`,
    summary: wantsContent
      ? `Conqify can show that ${plural(scheduled.length, "event was", "events were")} scheduled. What happened at ${scheduled.length === 1 ? "it" : "them"} was never recorded.`
      : `${plural(scheduled.length, "event was", "events were")} scheduled.`,
    items,
    limitation: [ATTENDANCE_LIMITATION, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" "),
    sourceRefs: refsOf(items),
    plan,
  };
}

// ----------------------------------------------------------------- WAITING --

export const HISTORICAL_WAITING_LIMITATION =
  "Conqify records when a wait started and whether it is still open. It keeps no log of waits ending, so a wait that was open then and has since been resolved cannot be shown.";

/**
 * What is being waited on (§9).
 *
 * Two different questions with two different answers. "What am I waiting on?" is
 * about now and is fully answerable. "What was I waiting on last Tuesday?" is
 * about a past state that the schema only partially preserves: a wait that began
 * before that day and is STILL open was demonstrably open then, and a wait that
 * closed in between left no trace at all. The first half is reported, the second
 * half is named, and the answer is marked partial — rather than presenting
 * today's list as though it were Tuesday's, which is §23's last negative
 * assertion.
 */
function answerWaiting(
  state: StoreState, plan: MemoryQueryPlan, today: DayKey,
): MemoryAnswer {
  const asOf = plan.range && plan.range.endKey < today ? plan.range.endKey : undefined;
  const waiting = (state.nextActions ?? []).filter((a) => a.status === "waiting");

  const relevant = asOf
    // Only what the record itself dates to on or before that day. A wait whose
    // `waitingSince` is after it did not exist then, and including it would be
    // the current row rewriting history.
    ? waiting.filter((a) => !!a.waitingSince && a.waitingSince.slice(0, 10) <= asOf)
    : waiting;

  const items: MemoryAnswerItem[] = relevant.map((a) => waitingItem(state, a));

  if (items.length === 0) {
    return {
      ...noEvidence(plan, asOf ? HISTORICAL_WAITING_LIMITATION : undefined),
      heading: asOf ? `Waiting · ${fmt(asOf)}` : "Not waiting on anything",
      summary: asOf
        ? `Conqify has no wait recorded as having started on or before ${fmt(asOf)} that is still open.`
        : "No action is currently marked as waiting on someone.",
      status: asOf ? "PARTIALLY_ANSWERED" : "NO_RECORDED_EVIDENCE",
    };
  }

  const named = relevant.filter((a) => a.waitingOn?.trim());
  const people = [...new Set(named.map((a) => a.waitingOn!.trim()))];

  const summary = plan.wantsSubject && people.length
    ? `You're waiting to hear from ${sentence(people)}.`
    : `${plural(items.length, "item is", "items are")} waiting on someone else.`;

  return {
    status: asOf ? "PARTIALLY_ANSWERED" : "ANSWERED",
    heading: asOf ? `Waiting as of ${fmt(asOf)}` : "Waiting on someone",
    summary: asOf
      ? `${summary} ${`${items.length === 1 ? "It" : "They"} began before ${fmt(asOf)} and ${items.length === 1 ? "is" : "are"} still open, so ${items.length === 1 ? "it was" : "they were"} open then too.`}`
      : summary,
    items,
    limitation: asOf ? HISTORICAL_WAITING_LIMITATION : undefined,
    sourceRefs: refsOf(items),
    plan,
  };
}

function waitingItem(state: StoreState, a: NextAction): MemoryAnswerItem {
  const since = a.waitingSince ? a.waitingSince.slice(0, 10) : undefined;
  const detail = [
    a.waitingOn?.trim() ? `Waiting on ${a.waitingOn.trim()}` : "Waiting",
    since ? `since ${fmt(since)}` : undefined,
    a.followUpDate ? `follow-up ${fmt(a.followUpDate)}` : undefined,
  ].filter(Boolean).join(" · ");
  return {
    text: a.title,
    attribution: "You added",
    day: since,
    when: since ? fmt(since) : undefined,
    detail,
    ref: { kind: "action", id: a.id },
    href: `/actions/${a.id}`,
    evidence: "action.waitingSince",
    origin: classifyOrigin({ kind: "action", text: a.title }),
  };
}

// ----------------------------------------------------------------- CHANGES --

export const EVENT_HISTORY_LIMITATION =
  "Conqify keeps no change history for calendar events, so an event that was moved, renamed or cancelled shows only where it stands now.";

const CHANGE_GROUPS: Array<{ kinds: string[]; clause: (n: number) => string; attribution: MemoryAttribution }> = [
  { kinds: ["completed_action", "recurring_completion"], clause: (n) => `completed ${plural(n, "item")}`, attribution: "You completed" },
  { kinds: ["action_created"], clause: (n) => `added ${plural(n, "item")}`, attribution: "You added" },
  { kinds: ["waiting_started"], clause: (n) => `started waiting on ${plural(n, "item")}`, attribution: "You added" },
  { kinds: ["action_deferred"], clause: (n) => `deferred ${plural(n, "item")}`, attribution: "You recorded" },
  { kinds: ["action_rescheduled"], clause: (n) => `changed the date on ${plural(n, "item")}`, attribution: "You recorded" },
  { kinds: ["action_cancelled"], clause: (n) => `cancelled ${plural(n, "item")}`, attribution: "You recorded" },
  { kinds: ["event_scheduled"], clause: (n) => `had ${plural(n, "event")} on the calendar`, attribution: "On your calendar" },
  { kinds: ["note_created", "reflection_captured", "capture_created", "decision_recorded"], clause: (n) => `wrote ${plural(n, "note or reflection", "notes and reflections")}`, attribution: "You wrote" },
];

/**
 * What changed, and what happened (§10).
 *
 * Every group is a recorded transition — a status change, a `due_set`, a
 * creation. There is no "other" bucket, because a change Conqify did not record
 * is not a change it can report, and the Event limitation says exactly which
 * ones those are.
 */
function answerChanges(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean, opts: AnswerOptions,
): MemoryAnswer {
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);
  if (timeline.length === 0) {
    return {
      ...noEvidence(plan, implicit ? IMPLICIT_NOTE : undefined),
      heading: `Nothing recorded${rangeSuffix(plan, range, implicit)}`,
      summary: "Conqify recorded nothing in that period. That is a gap in the record, not a description of the time.",
    };
  }

  // One record, one line. "Marcus still hasn't sent the lease" is created and
  // marked waiting in the same breath, and printing both makes one thing look
  // like two — the same de-duplication `buildWeekReview` applies to its Added
  // section, for the same reason.
  const waitStarted = new Set(
    timeline.filter((e) => e.kind === "waiting_started").map((e) => e.recordRef.id),
  );

  const items: MemoryAnswerItem[] = [];
  const parts: string[] = [];
  for (const g of CHANGE_GROUPS) {
    const hits = timeline.filter((e) => g.kinds.includes(e.kind)
      && !(e.kind === "action_created" && waitStarted.has(e.recordRef.id)));
    if (!hits.length) continue;
    parts.push(g.clause(hits.length));
    for (const e of hits) {
      const attribution = isMachineProduced(e.origin)
        ? attributionFor(e.recordRef.kind, e.origin)
        : g.attribution;
      const item = itemOf(state, e, attribution);
      // The timeline stores a wait's detail as the bare name the user typed.
      // On its own line that reads as an unexplained word next to a title.
      if (e.kind === "waiting_started" && e.detail) item.detail = `Waiting on ${e.detail}`;
      items.push(item);
    }
  }

  const asked = /\bchange|moved|shifted\b/.test(plan.question.toLowerCase());
  return {
    status: "ANSWERED",
    heading: `${asked ? "What changed" : "What Conqify recorded"}${rangeSuffix(plan, range, implicit)}`,
    summary: `You ${sentence(parts)}.`,
    items,
    limitation: [EVENT_HISTORY_LIMITATION, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" "),
    sourceRefs: refsOf(items),
    plan,
  };
}

// ----------------------------------------------------------------- PROJECT --

export const PROJECT_LIMITATION =
  "These are records linked to the project. Conqify keeps no history of project changes, so it cannot say whether the project moved forward.";

/**
 * What happened with a project (§11).
 *
 * Counts of dated, linked facts — and no vocabulary at all for momentum. The
 * summary sentence is assembled from clauses like "2 linked actions were
 * completed"; there is no clause anywhere in this function that could produce
 * "made progress", because `Project` records `createdAt` and `updatedAt` and
 * nothing that would justify one.
 */
function answerProject(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean,
  searchIndex: SearchEntry[], opts: AnswerOptions,
): MemoryAnswer {
  if (!plan.entityQuery) {
    return noEvidence(plan, MEMORY_UNRESOLVED_LABEL.no_entity);
  }

  const all = resolveEntities(searchIndex, plan.entityQuery);
  if (all.length === 0) {
    return { ...noEvidence(plan), heading: `Nothing about “${plan.entityQuery}”`,
      summary: `Conqify has no record whose title matches “${plan.entityQuery}”.` };
  }
  const candidates = focused(all, opts.focusRef);
  if (candidates.length > 1) return needsChoice(plan.question, candidates, plan);

  const only = candidates[0];
  const timeline = buildAutobiographicalTimeline(state, range, opts.index);

  if (only.kind !== "project") {
    // A single non-project match — an Action, an Event, a Note. Answer about
    // that record specifically rather than pretending it is a project.
    return answerAboutRecord(state, plan, only, timeline, range, implicit);
  }

  const linked = timeline.filter((e) => e.projectRef?.id === only.id
    || (state.events ?? []).find((ev) => ev.id === e.recordRef.id)?.linkedEntityRefs
      ?.some((r) => r.kind === "project" && r.id === only.id));

  const completed = linked.filter((e) => (COMPLETION_KINDS as string[]).includes(e.kind));
  const added = linked.filter((e) => e.kind === "action_created");
  const events = linked.filter((e) => e.kind === "event_scheduled");
  const waitingOpen = (state.nextActions ?? []).filter((a) => a.projectId === only.id && a.status === "waiting");

  if (linked.length === 0 && waitingOpen.length === 0) {
    return {
      ...noEvidence(plan, [PROJECT_LIMITATION, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" ")),
      heading: `${only.title}${rangeSuffix(plan, range, implicit)}`,
      summary: `Conqify has no dated activity linked to ${only.title} in that period.`,
    };
  }

  const parts: string[] = [];
  if (completed.length) parts.push(`${plural(completed.length, "linked action")} ${completed.length === 1 ? "was" : "were"} completed`);
  if (added.length) parts.push(`${plural(added.length, "linked action")} ${added.length === 1 ? "was" : "were"} added`);
  if (events.length) parts.push(`${plural(events.length, "linked event")} ${events.length === 1 ? "was" : "were"} on the calendar`);
  if (waitingOpen.length) parts.push(`${plural(waitingOpen.length, "waiting item")} ${waitingOpen.length === 1 ? "is" : "are"} still open`);

  // A wait that STARTED inside the window is already a line in `linked`. Adding
  // the current-state row too would print the same wait twice under two dates,
  // which reads as two separate things having happened.
  const waitAlreadyShown = new Set(
    linked.filter((e) => e.kind === "waiting_started").map((e) => e.recordRef.id),
  );
  const items = [
    ...linked.map((e) => itemOf(state, e)),
    ...waitingOpen.filter((a) => !waitAlreadyShown.has(a.id)).map((a) => waitingItem(state, a)),
  ];

  return {
    status: "ANSWERED",
    heading: `${only.title}${rangeSuffix(plan, range, implicit)}`,
    summary: `${sentence(parts)}.`,
    items,
    limitation: [PROJECT_LIMITATION, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" "),
    sourceRefs: [{ kind: "project", id: only.id }, ...refsOf(items)],
    plan,
  };
}

/** "What happened with X" where X turned out to be one ordinary record. */
function answerAboutRecord(
  state: StoreState, plan: MemoryQueryPlan, entry: SearchEntry,
  timeline: AutobiographicalEvent[], range: ResolvedRange, implicit: boolean,
): MemoryAnswer {
  const facts = timeline.filter((e) => e.recordRef.id === entry.id);
  const isEvent = entry.kind === "event";

  if (facts.length === 0) {
    return {
      status: "PARTIALLY_ANSWERED",
      heading: entry.title,
      summary: `Conqify has a ${(KIND_LABEL[entry.kind] ?? entry.kind).toLowerCase()} called “${entry.title}”, but nothing dated about it in that period.`,
      items: [],
      limitation: isEvent ? ATTENDANCE_LIMITATION : implicit ? IMPLICIT_NOTE : undefined,
      sourceRefs: [{ kind: entry.kind, id: entry.id }],
      plan,
    };
  }

  const items = facts.map((e) => itemOf(state, e));
  return {
    status: isEvent ? "PARTIALLY_ANSWERED" : "ANSWERED",
    heading: `${entry.title}${rangeSuffix(plan, range, implicit)}`,
    summary: isEvent
      ? `Conqify can show when it was scheduled. What happened at it was never recorded.`
      : `${plural(facts.length, "recorded fact")} about it.`,
    items,
    limitation: isEvent ? ATTENDANCE_LIMITATION : implicit ? IMPLICIT_NOTE : undefined,
    sourceRefs: refsOf(items),
    plan,
  };
}

// -------------------------------------------------------------- REFLECTION --

/** Where a person's own words live (§5). Events are absent on purpose. */
const AUTHORED_KINDS: readonly string[] = ["reflection", "note", "capture", "decision"];

export const EMOTION_LIMITATION_PREFIX =
  "Conqify does not record how you felt. These are records whose text contains";

/**
 * What the user said about something (§5, §6).
 *
 * Searches only the four record types a person writes in, which is why an Event
 * titled "teaching prep" cannot become "you said something about teaching". Each
 * hit keeps its own provenance, so an AI-generated note found by the same search
 * is listed with the attribution that is true of it.
 */
function answerReflection(state: StoreState, plan: MemoryQueryPlan, searchIndex: SearchEntry[]): MemoryAnswer {
  const term = plan.entityQuery ?? plan.emotionWord;
  if (!term) {
    return noEvidence(plan, "Conqify couldn't tell what topic that question is about.");
  }

  const pool = searchIndex.filter((e) => AUTHORED_KINDS.includes(e.kind));
  const hits = searchFlat(pool, term, 40);

  const dated = hits
    .map((h) => datedAuthored(state, h.entry))
    .filter((x): x is MemoryAnswerItem => !!x)
    .filter((x) => !plan.range || (!!x.day && x.day >= plan.range!.startKey && x.day <= plan.range!.endKey))
    .sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));

  const emotionNote = plan.emotionWord
    ? `${EMOTION_LIMITATION_PREFIX} “${plan.emotionWord}”. Whether you felt it is not something Conqify knows.`
    : undefined;

  if (dated.length === 0) {
    return {
      ...noEvidence(plan, emotionNote),
      heading: `Nothing written about “${term}”`,
      summary: plan.range
        ? `Conqify found no note, reflection, capture or decision from that period whose text mentions “${term}”.`
        : `Conqify found no note, reflection, capture or decision whose text mentions “${term}”.`,
    };
  }

  const authored = dated.filter((i) => !isMachineProduced(i.origin));
  const machine = dated.filter((i) => isMachineProduced(i.origin));

  // Every match is machine prose. There is evidence about the topic, and none
  // of it is the user speaking — so the question as asked is not answered.
  if (authored.length === 0) {
    return {
      status: "PARTIALLY_ANSWERED",
      heading: `About “${term}”`,
      summary: `Conqify found ${plural(machine.length, "record")} mentioning “${term}”, but ${machine.length === 1 ? "it was" : "they were"} AI-generated rather than written by you.`,
      items: machine,
      limitation: emotionNote,
      sourceRefs: refsOf(machine),
      plan,
    };
  }

  return {
    // An emotion question is never fully answered, however good the match.
    // "What was I worried about?" asks about a state of mind; what Conqify can
    // return is text containing the word. Reporting that as ANSWERED would let
    // a search result stand in for a feeling — §23's fifth negative assertion.
    status: machine.length || plan.emotionWord ? "PARTIALLY_ANSWERED" : "ANSWERED",
    heading: `What you wrote about “${term}”${plan.range ? ` · ${plan.range.label}` : ""}`,
    summary: `${plural(authored.length, "record")} you wrote ${authored.length === 1 ? "mentions" : "mention"} “${term}”.`,
    items: [...authored, ...machine],
    limitation: [emotionNote, machine.length
      ? `${plural(machine.length, "other record")} mentioning it ${machine.length === 1 ? "was" : "were"} AI-generated and ${machine.length === 1 ? "is" : "are"} marked as such.`
      : ""].filter(Boolean).join(" ") || undefined,
    sourceRefs: refsOf([...authored, ...machine]),
    plan,
  };
}

/**
 * Attach the recorded date and provenance to a search hit.
 *
 * Returns `undefined` for a record that has disappeared since the index was
 * built — a line with no record behind it is a fabricated memory.
 */
function datedAuthored(state: StoreState, entry: SearchEntry): MemoryAnswerItem | undefined {
  const record = resolveRecord(state, entry.kind, entry.id);
  if (!record) return undefined;

  let createdAt: string | undefined;
  let text = entry.title;
  let origin: OriginType = "unknown";
  let evidence = "";

  switch (entry.kind) {
    case "reflection": {
      const r = (state.reflections ?? []).find((x) => x.id === entry.id);
      if (!r) return undefined;
      createdAt = r.createdAt; text = r.response || r.prompt; evidence = "reflection.createdAt";
      origin = classifyOrigin({ kind: "reflection", text: r.response });
      break;
    }
    case "note": {
      const n = (state.notes ?? []).find((x) => x.id === entry.id);
      if (!n || n.archived) return undefined;
      createdAt = n.createdAt; text = (n.title?.trim() || n.body).trim(); evidence = "note.createdAt";
      origin = classifyOrigin({ kind: "note", text: n.body, fromAiText: n.fromAiText });
      break;
    }
    case "capture": {
      const c = state.captures.find((x) => x.id === entry.id);
      if (!c) return undefined;
      createdAt = c.createdAt; text = c.workingText ?? c.text; evidence = "capture.createdAt";
      origin = classifyOrigin({ kind: "capture", text: c.text });
      break;
    }
    case "decision": {
      const d = state.decisions.find((x) => x.id === entry.id);
      if (!d) return undefined;
      createdAt = d.createdAt; text = d.title; evidence = "decision.createdAt";
      origin = classifyOrigin({ kind: "decision", text: d.title });
      break;
    }
    default: return undefined;
  }

  const day = createdAt?.slice(0, 10);
  return {
    text: displayText(text),
    // "You said" is earned here and nowhere else: this record type is one a
    // person writes in, and its provenance says they wrote it.
    attribution: canQuoteAsSaid(entry.kind, origin) ? "You said" : attributionFor(entry.kind, origin),
    day, when: day ? fmt(day) : undefined,
    ref: { kind: entry.kind, id: entry.id },
    href: record.href,
    evidence, origin,
  };
}

// --------------------------------------------------------------- OPEN_WORK --

/**
 * What still needs attention.
 *
 * Delegates to `buildWeekReview` rather than re-deriving "open", so the answer
 * and the Still Open section on the same page can never disagree.
 */
function answerOpenWork(state: StoreState, plan: MemoryQueryPlan, today: DayKey, opts: AnswerOptions): MemoryAnswer {
  const review = buildWeekReview(state, "this_week", { today, index: opts.index });
  const items: MemoryAnswerItem[] = review.stillOpen.map((o) => {
    // The date shown is the one the reason is ABOUT: a due date for something
    // overdue, the day a wait began for something waiting. A "next in project"
    // line has neither, and gets no date rather than a borrowed one.
    const day = o.reason === "waiting" ? o.action.waitingSince?.slice(0, 10) : o.action.dueDate;
    return {
      text: o.action.title,
      attribution: attributionFor("action", classifyOrigin({ kind: "action", text: o.action.title })),
      day, when: day ? fmt(day) : undefined,
      detail: o.detail,
      ref: { kind: "action", id: o.action.id },
      href: `/actions/${o.action.id}`,
      evidence: o.reason === "waiting" ? "action.waitingSince" : "action.dueDate",
      origin: classifyOrigin({ kind: "action", text: o.action.title }),
    };
  });

  if (items.length === 0) {
    return {
      ...noEvidence(plan),
      heading: "Nothing flagged",
      summary: "No action is overdue, due soon, or waiting on someone. That is what Conqify has recorded — it is not a claim about everything on your mind.",
    };
  }

  const overdue = review.stillOpen.filter((o) => o.reason === "overdue").length;
  const soon = review.stillOpen.filter((o) => o.reason === "due_soon").length;
  const waiting = review.stillOpen.filter((o) => o.reason === "waiting").length;
  const nextUp = review.stillOpen.filter((o) => o.reason === "project_next").length;
  const parts: string[] = [];
  if (overdue) parts.push(`${plural(overdue, "item is", "items are")} past a due date you set`);
  if (soon) parts.push(`${plural(soon, "item is", "items are")} due within a week`);
  if (waiting) parts.push(`${plural(waiting, "item is", "items are")} waiting on someone`);
  // Counted, because every listed line must be accounted for in the sentence
  // above it. A summary that adds up to fewer items than the list is a small
  // arithmetic lie that makes the reader distrust the rest.
  if (nextUp) parts.push(`${plural(nextUp, "item is", "items are")} the next step in a project`);

  return {
    status: "ANSWERED",
    heading: "Still open",
    summary: `${sentence(parts)}.`,
    items,
    limitation: "This is what has a due date or a recorded wait. Anything you never wrote down isn't here.",
    sourceRefs: refsOf(items),
    plan,
  };
}

// -------------------------------------------------------------------- TIME --

export const NO_TIME_EVIDENCE_FOR_EVENT =
  "Conqify keeps no change history for calendar events. It can show where this one stands now, but not when it moved.";

/**
 * When did I do X (§12).
 *
 * Reads the exact field for the aspect asked about — `completedAt` for finishing,
 * a `due_set`/`deferred` history entry for moving, `createdAt` for adding — and
 * scans history arrays directly rather than projecting a timeline, so it is not
 * bounded by the implicit lookback window.
 */
function answerTime(
  state: StoreState, plan: MemoryQueryPlan, searchIndex: SearchEntry[], opts: AnswerOptions,
): MemoryAnswer {
  if (!plan.entityQuery) return noEvidence(plan, MEMORY_UNRESOLVED_LABEL.no_entity);

  const all = resolveEntities(searchIndex, plan.entityQuery, ["action", "event", "note", "capture", "decision", "project"]);
  if (all.length === 0) {
    return { ...noEvidence(plan), heading: `Nothing called “${plan.entityQuery}”`,
      summary: `Conqify has no record whose title matches “${plan.entityQuery}”.` };
  }
  const candidates = focused(all, opts.focusRef);
  if (candidates.length > 1) return needsChoice(plan.question, candidates, plan);

  const only = candidates[0];
  const aspect = plan.timeAspect ?? "completed";

  // §10's named case. An Event that was moved leaves no trace, and the honest
  // answer is the current schedule plus the fact that the history is missing.
  if (only.kind === "event") {
    const ev = (state.events ?? []).find((e) => e.id === only.id)!;
    if (aspect === "moved") {
      return {
        status: "PARTIALLY_ANSWERED",
        heading: only.title,
        summary: `“${ev.title}” is on the calendar for ${fmt(ev.date)}. Conqify has no record of when — or whether — it was moved there.`,
        items: [], limitation: NO_TIME_EVIDENCE_FOR_EVENT,
        sourceRefs: [{ kind: "event", id: ev.id }], plan,
      };
    }
    return {
      status: "PARTIALLY_ANSWERED",
      heading: only.title,
      summary: `“${ev.title}” was scheduled for ${fmt(ev.date)}.`,
      items: [{
        text: ev.title, attribution: "On your calendar", day: ev.date, when: fmt(ev.date),
        ref: { kind: "event", id: ev.id }, href: resolveRecord(state, "event", ev.id)?.href,
        evidence: "event.date", origin: classifyOrigin({ kind: "event", text: ev.title, fromAiText: ev.fromAiText }),
      }],
      limitation: ATTENDANCE_LIMITATION,
      sourceRefs: [{ kind: "event", id: ev.id }], plan,
    };
  }

  if (only.kind === "action") {
    const a = (state.nextActions ?? []).find((x) => x.id === only.id)!;
    return timeFromAction(state, plan, a, aspect, opts);
  }

  // A note, capture, decision or project: `createdAt` is the only moment.
  const created = createdAtOf(state, only.kind, only.id);
  if (!created) return noEvidence(plan);
  const day = created.slice(0, 10);
  return {
    status: aspect === "added" ? "ANSWERED" : "PARTIALLY_ANSWERED",
    heading: only.title,
    summary: aspect === "added"
      ? `You added “${only.title}” on ${fmt(day)}.`
      : `Conqify records when “${only.title}” was created — ${fmt(day)} — and nothing else dated about it.`,
    items: [{
      text: only.title, attribution: attributionFor(only.kind, "user_authored"),
      day, when: fmt(day), ref: { kind: only.kind, id: only.id },
      href: resolveRecord(state, only.kind, only.id)?.href,
      evidence: `${only.kind}.createdAt`, origin: "user_authored",
    }],
    sourceRefs: [{ kind: only.kind, id: only.id }],
    plan,
  };
}

function createdAtOf(state: StoreState, kind: string, id: string): string | undefined {
  switch (kind) {
    case "note": return (state.notes ?? []).find((x) => x.id === id)?.createdAt;
    case "capture": return state.captures.find((x) => x.id === id)?.createdAt;
    case "decision": return state.decisions.find((x) => x.id === id)?.createdAt;
    case "project": return (state.projects ?? []).find((x) => x.id === id)?.createdAt;
    case "reflection": return (state.reflections ?? []).find((x) => x.id === id)?.createdAt;
    default: return undefined;
  }
}

/** The dated moments an Action actually records, per aspect. */
function timeFromAction(
  state: StoreState, plan: MemoryQueryPlan, a: NextAction,
  aspect: NonNullable<MemoryQueryPlan["timeAspect"]>, opts: AnswerOptions,
): MemoryAnswer {
  const ref: RecordRefLite = { kind: "action", id: a.id };
  const href = `/actions/${a.id}`;
  const origin = classifyOrigin({ kind: "action", text: a.title });
  const base = { text: a.title, ref, href, origin };

  const item = (day: DayKey, attribution: MemoryAttribution, evidence: string, detail?: string): MemoryAnswerItem =>
    ({ ...base, attribution, day, when: fmt(day), evidence, detail });

  if (aspect === "completed") {
    const items: MemoryAnswerItem[] = [];
    if (a.completedAt) items.push(item(a.completedAt.slice(0, 10), "You completed", "action.completedAt"));
    // A recurring action is kept, not finished. Each occurrence is its own date,
    // and collapsing them into one "completed on" would claim the standing
    // commitment had ended.
    const ix = opts.index ?? buildActivityIndex(state);
    for (const e of ix) {
      if (e.recordId !== a.id || e.type !== "action_completed") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.detail ?? "")) continue;
      items.push(item(e.detail!, "You completed", "recurrenceCompletions[].occurrenceDate", "recurring occurrence"));
    }
    if (items.length === 0) {
      return {
        status: "NO_RECORDED_EVIDENCE",
        heading: a.title,
        summary: `“${a.title}” has no completion recorded. Its status is “${a.status}”.`,
        items: [], sourceRefs: [ref], plan,
      };
    }
    items.sort((x, y) => (x.day ?? "").localeCompare(y.day ?? ""));
    const last = items[items.length - 1];
    return {
      status: "ANSWERED",
      heading: a.title,
      summary: items.length === 1
        ? `You completed “${a.title}” on ${last.when}.`
        : `“${a.title}” was completed on ${items.length} recorded occasions, most recently ${last.when}.`,
      items, sourceRefs: [ref], plan,
    };
  }

  if (aspect === "moved") {
    const moves = (a.history ?? [])
      .filter((h) => h.action === "due_set" || h.action === "due_cleared" || h.action === "deferred")
      .map((h) => item(
        h.at.slice(0, 10),
        "You recorded",
        `action.history[].${h.action}`,
        h.action === "due_cleared" ? "due date cleared"
          : h.detail ? `${h.action === "deferred" ? "deferred until" : "new due date"} ${fmt(h.detail)}` : undefined,
      ))
      .sort((x, y) => (x.day ?? "").localeCompare(y.day ?? ""));
    if (moves.length === 0) {
      return {
        status: "NO_RECORDED_EVIDENCE",
        heading: a.title,
        summary: `Conqify has no recorded change of date for “${a.title}”.`,
        items: [], sourceRefs: [ref], plan,
      };
    }
    const last = moves[moves.length - 1];
    return {
      status: "ANSWERED",
      heading: a.title,
      summary: moves.length === 1
        ? `You moved “${a.title}” on ${last.when} — ${last.detail ?? "recorded in its history"}.`
        : `“${a.title}” has ${moves.length} recorded date changes, the last on ${last.when}.`,
      items: moves, sourceRefs: [ref], plan,
    };
  }

  if (aspect === "started_waiting") {
    if (!a.waitingSince) {
      return { status: "NO_RECORDED_EVIDENCE", heading: a.title,
        summary: `Conqify has no wait recorded for “${a.title}”.`, items: [], sourceRefs: [ref], plan };
    }
    const day = a.waitingSince.slice(0, 10);
    return {
      status: "ANSWERED", heading: a.title,
      summary: `You marked “${a.title}” as waiting on ${fmt(day)}.`,
      items: [item(day, "You added", "action.waitingSince", a.waitingOn ? `Waiting on ${a.waitingOn}` : undefined)],
      sourceRefs: [ref], plan,
    };
  }

  const day = a.createdAt.slice(0, 10);
  return {
    status: "ANSWERED", heading: a.title,
    summary: `You added “${a.title}” on ${fmt(day)}.`,
    items: [item(day, "You added", "action.createdAt")],
    sourceRefs: [ref], plan,
  };
}

// ------------------------------------------------------ the AI seam (§17) ---

/**
 * The bounded packet an AI layer would be given — and the ONLY thing it would.
 *
 * Retrieval has already happened by the time this is built, so a model cannot
 * reach past it: there is no store handle in the packet, no ids beyond the ones
 * already retrieved, and — by `MEMORY_EXCLUDED_KINDS` upstream — nothing from
 * the Constitution or Beliefs. A model asked to phrase this can only rearrange
 * facts that were already true.
 */
export interface MemoryEvidencePacket {
  question: string;
  kind: string;
  rangeLabel?: string;
  status: MemoryAnswerStatus;
  facts: Array<{ text: string; attribution: string; when?: string; detail?: string; evidence: string }>;
  limitation?: string;
  /** The only ids a model may refer to (§18). */
  allowedRefs: RecordRefLite[];
}

export function buildEvidencePacket(answer: MemoryAnswer): MemoryEvidencePacket {
  return {
    question: answer.plan?.question ?? "",
    kind: answer.plan?.kind ?? "",
    rangeLabel: answer.plan?.range?.label,
    status: answer.status,
    facts: answer.items.map((i) => ({
      text: i.text, attribution: i.attribution, when: i.when, detail: i.detail, evidence: i.evidence,
    })),
    limitation: answer.limitation,
    allowedRefs: answer.sourceRefs,
  };
}

/**
 * Validate a classification a model produced (§18).
 *
 * Rejects, never repairs. "Almost valid" model output is output that meant
 * something else, and coercing it into the nearest legal value is how a question
 * about June gets answered about July.
 */
export function validateAiPlan(
  raw: unknown,
  allowed: { kinds: readonly string[]; ranges: readonly string[]; ids: readonly string[] },
): { ok: true; kind: string; range?: string; ids: string[] } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_an_object" };
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || !allowed.kinds.includes(r.kind)) return { ok: false, reason: "unknown_kind" };
  if (r.range !== undefined) {
    if (typeof r.range !== "string" || !allowed.ranges.includes(r.range)) return { ok: false, reason: "unknown_range" };
  }
  const ids = r.ids === undefined ? [] : r.ids;
  if (!Array.isArray(ids)) return { ok: false, reason: "ids_not_a_list" };
  for (const id of ids) {
    if (typeof id !== "string" || !allowed.ids.includes(id)) return { ok: false, reason: "unknown_id" };
  }
  return { ok: true, kind: r.kind, range: r.range as string | undefined, ids: ids as string[] };
}

/** Every generated string in an answer. User content is excluded by design. */
export function answerStrings(answer: MemoryAnswer): string[] {
  return [
    answer.heading, answer.summary ?? "", answer.limitation ?? "",
    ...answer.items.map((i) => i.attribution),
    ...(answer.choices ?? []).map((c) => c.kindLabel),
  ];
}
