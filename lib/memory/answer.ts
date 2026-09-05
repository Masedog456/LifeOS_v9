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
import type { Goal, GoalHistoryEvent, GoalStatus, NextAction, RecordRefLite, StoreState } from "@/types/mvp";
import { GOAL_HORIZON_LABEL } from "@/lib/execution/horizons";
import { GOAL_LIFECYCLE_LABEL, goalHistory } from "@/lib/execution/lifecycle";
import { goalLinkedProjects, goalsCarriedByActions, goalsWithoutAnyPath } from "@/lib/execution/alignment";
import {
  CODE_CONTEXTS, PROTOCOL_HISTORY_LIMITATION, allRules, ruleContexts,
  rulesMatchingText, type CodeRule,
} from "@/lib/code/personal-code";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { buildActivityIndex, type ActivityEvent } from "@/lib/insights/activity";
import { classifyOrigin } from "@/lib/provenance/classify";
import { isMachineProduced, type OriginType } from "@/lib/provenance";
import { buildIndex, searchFlat } from "@/lib/command/search";
import { resolveRecord } from "@/lib/command/records";
import type { SearchEntry } from "@/lib/command/types";
import { buildProjectContext } from "@/lib/execution/context";
import { isLive } from "@/lib/actions/due";
import {
  buildPersonContext, namesPerson, longerForms,
  PERSON_HEADINGS, NOTHING_OPEN, MENTION_NOTE, IDENTITY_LIMITATION, AMBIGUOUS_NAME,
} from "@/lib/people/context";
import {
  buildAutobiographicalTimeline, resolveWeekRange, COMPLETION_KINDS,
  type AutobiographicalEvent,
} from "@/lib/memory/week";
import { buildTodayIndexes, type TodayIndexes } from "@/lib/today/indexes";
import { recommendNextAction, NO_STANDOUT } from "@/lib/today/recommend";
import { buildDailyExecutiveView, NOTHING_TOMORROW } from "@/lib/today/daily";
import {
  buildCommitmentSignals, COMMITMENT_ORDER, NOTHING_STANDS_OUT,
  type CommitmentSignal,
} from "@/lib/commitment/signals";
import {
  planMemoryQuery, MEMORY_QUERY_EXAMPLES, MEMORY_UNRESOLVED_LABEL,
  type MemoryQueryPlan, type ChangeAspect,
} from "@/lib/memory/query";
import {
  buildAttentionShortlist, inAttentionScope,
  ATTENTION_HEADING, NOTHING_NEEDS_ATTENTION,
} from "@/lib/guidance/attention";
import {
  buildExecutiveChanges, repeatedlyPostponed, postponedLine,
  MOVED_FORWARD_KINDS, DIRECTION_KINDS, PROTOCOL_CHANGE_LIMITATION,
  type ExecutiveChange, type ExecutiveChangeKind,
} from "@/lib/memory/changes";
import {
  buildCarryForward, buildReconsider, CARRY_FORWARD_DEFAULT,
} from "@/lib/memory/weekly";

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
  /**
   * The commitment signal this row came from, when it came from one
   * (LIFEOS-071 §18).
   *
   * Carried so Memory can offer the SAME resolution controls Today offers, from
   * the same builder — not so Memory can compute its own. Present only for the
   * forgetting/attention class; a completion or a reflection has no commitment
   * behind it and gets no controls.
   */
  signal?: CommitmentSignal;
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

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const exact = pool.filter((e) => e.titleLower === q || e.aliasesLower.includes(q));
  if (exact.length) return exact;
  const word = new RegExp(`\\b${esc(q)}\\b`);
  const titled = pool.filter((e) => word.test(e.titleLower));
  if (titled.length) return titled;
  const contained = pool.filter((e) => e.titleLower.includes(q));
  if (contained.length) return contained;

  /**
   * Last resort: every word of the fragment appears in the title (LIFEOS-088).
   *
   * The frame stripper removes stopwords, so "what changed with Open the
   * clinic?" arrives here as "open clinic" — which is not a substring of "open
   * the clinic" and matched nothing at all. The scope then silently did not
   * apply and the answer reported the whole store while appearing to be about
   * one goal, with a completed action from a DIFFERENT goal in the list.
   *
   * Word-level and unordered, so it cannot match on a fragment of a longer word;
   * single-word fragments are excluded because the three passes above already
   * cover them and a bare word here would only widen the net. When this matches
   * more than one record the caller's ambiguity guard asks which was meant —
   * that is the right outcome, not a silent pick.
   */
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const words = tokens.map((t) => new RegExp(`\\b${esc(t)}\\b`));
  return pool.filter((e) => words.every((w) => w.test(e.titleLower)));
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
  /** Prebuilt Today indexes, when the caller already has them (§23). */
  todayIndexes?: TodayIndexes;
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
  //
  // TOMORROW is the single exception, and a narrow one (LIFEOS-073 §16). Every
  // other class asks what HAPPENED, so a future range genuinely holds nothing.
  // "What do I have tomorrow?" asks what is SCHEDULED, and a commitment dated
  // tomorrow is a record that exists today — refusing it would be the product
  // declining to read its own calendar.
  const future = plan.kind === "TOMORROW"
    ? undefined
    : plan.unresolved.find((u) => u.reason === "future_range");
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
    case "CHANGES": return answerChanges(state, plan, range, implicit, searchIndex, opts);
    case "PROJECT": return answerProject(state, plan, range, implicit, searchIndex, opts, today);
    case "REFLECTION": return answerReflection(state, plan, searchIndex);
    case "OPEN_WORK": return answerOpenWork(state, plan, today, searchIndex, opts);
    case "NEXT_ACTION": return answerNextAction(state, plan, today, opts);
    case "TOMORROW": return answerTomorrow(state, plan, today, opts);
    case "TIME": return answerTime(state, plan, searchIndex, opts);
    case "GOALS": return answerGoals(state, plan, range, implicit);
    case "RULES": return answerRules(state, plan);
    case "PERSON": return answerPerson(state, plan, today, opts);
    default: return noEvidence(plan);
  }
}

// ------------------------------------------------------------------ RULES --

/**
 * What standards a person has chosen for themselves (LIFEOS-079 §5).
 *
 * ## Why this class exists rather than a relaxed exclusion
 *
 * `MEMORY_EXCLUDED_KINDS` keeps constitutional statements out of ordinary
 * retrieval, because LIFEOS-056 drew that line deliberately: a question about
 * last week has no business reaching what someone believes about themselves.
 * That line is UNCHANGED. This class does not search the Constitution — it
 * reads the Personal Code projection directly, and only when the question
 * explicitly asks about rules.
 *
 * ## The history limitation, said out loud
 *
 * Unconditional rules carry `ConstitutionRevision` history and can say when
 * they changed. Conditional rules cannot: `Protocol` has no history, and
 * `updatedAt` moves when a typo is fixed, so offering it as "when you changed
 * this rule" would be inventing a life event. The `history` aspect says so.
 */
function ruleItem(rule: CodeRule, detail?: string, day?: DayKey): MemoryAnswerItem {
  return {
    text: rule.statement,
    // The user wrote it. An AI-suggested wording they kept is still not
    // Conqify's sentence to claim, which is what `fromAiText` records.
    attribution: rule.fromAiText ? "An AI-generated note contains" : "You recorded",
    day,
    when: day ? fmt(day) : undefined,
    detail,
    ref: { kind: rule.recordKind, id: rule.id },
    href: rule.recordKind === "protocol" ? `/protocols?protocol=${rule.id}` : `/constitution?element=${rule.id}`,
    evidence: rule.recordKind === "protocol" ? "protocol.trigger | protocol.response" : "constitutionElement.statement",
    origin: rule.fromAiText ? "conqify_ai" : "user_authored",
  };
}

/** The shape of a rule, said in the user's terms rather than the schema's. */
const shapeDetail = (r: CodeRule): string => (r.shape === "conditional" ? "when/then" : "always");

function answerRules(state: StoreState, plan: MemoryQueryPlan): MemoryAnswer {
  const aspect = plan.ruleAspect ?? "live_by";
  const all = allRules(state);

  if (all.length === 0) {
    return {
      ...noEvidence(plan),
      heading: "No rules recorded",
      summary: "You haven't written any rules for yourself yet.",
    };
  }

  if (aspect === "retired") {
    const retired = all.filter((r) => r.state === "retired");
    if (retired.length === 0) {
      return { ...noEvidence(plan), heading: "Nothing retired", summary: "No rule has been retired." };
    }
    const items = retired.map((r) => ruleItem(r, shapeDetail(r)));
    return {
      status: "ANSWERED",
      heading: "Rules you retired",
      summary: `${plural(items.length, "rule is", "rules are")} retired. They stay in your Personal Code as part of the record.`,
      items,
      limitation: retired.some((r) => !r.hasLifecycleHistory) ? PROTOCOL_HISTORY_LIMITATION : undefined,
      sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "conditional") {
    const conditional = all.filter((r) => r.shape === "conditional" && r.state === "active");
    if (conditional.length === 0) {
      return { ...noEvidence(plan), heading: "No when/then rules", summary: "No active rule is written as a when/then." };
    }
    const items = conditional.map((r) => ruleItem(r));
    return {
      status: "ANSWERED",
      heading: "Your when/then rules",
      summary: `${plural(items.length, "rule", "rules")} name a situation and what you want to do in it.`,
      items, sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "history") {
    // §4 of the approval: do NOT fabricate change dates from `updatedAt`.
    const withHistory = all.filter((r) => r.hasLifecycleHistory);
    const items = withHistory
      .map((r) => {
        const revs = (state.constitutionRevisions ?? [])
          .filter((v) => v.elementId === r.id && (v.changeKind === "revised" || v.changeKind === "edited"))
          .sort((a, b) => a.at.localeCompare(b.at));
        const last = revs[revs.length - 1];
        return last ? ruleItem(r, last.changeKind === "revised" ? "wording revised" : "wording corrected", last.at.slice(0, 10) as DayKey) : null;
      })
      .filter((x): x is MemoryAnswerItem => x !== null);

    if (items.length === 0) {
      return {
        ...noEvidence(plan),
        heading: "No recorded rule changes",
        summary: "No rule has a recorded change.",
        limitation: PROTOCOL_HISTORY_LIMITATION,
      };
    }
    return {
      status: "PARTIALLY_ANSWERED",
      heading: "When your rules changed",
      summary: `${plural(items.length, "rule has", "rules have")} a recorded change.`,
      items,
      limitation: PROTOCOL_HISTORY_LIMITATION,
      sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "context") {
    // The context comes from the question's own words, matched against the same
    // fixed vocabulary the Personal Code view uses. No embedding, no scoring.
    const asked = CODE_CONTEXTS.filter((c) => new RegExp(`\\b${c}`, "i").test(plan.question));
    const matched = asked.length
      ? all.filter((r) => r.state === "active" && ruleContexts(r).some((c) => asked.includes(c)))
      : rulesMatchingText(state, plan.entityQuery ?? plan.question);

    if (matched.length === 0) {
      return {
        ...noEvidence(plan),
        heading: "No rule about that",
        summary: "No active rule of yours mentions it.",
      };
    }
    const items = matched.map((r) => ruleItem(r, shapeDetail(r)));
    return {
      status: "ANSWERED",
      heading: asked.length ? `Rules about ${asked.join(", ")}` : "Related rules",
      summary: `${plural(items.length, "rule", "rules")} of yours ${items.length === 1 ? "mentions" : "mention"} it.`,
      items, sourceRefs: refsOf(items), plan,
    };
  }

  // "live_by" — the whole active code.
  const active = all.filter((r) => r.state === "active");
  if (active.length === 0) {
    return {
      ...noEvidence(plan),
      heading: "No rules in force",
      summary: `You have ${plural(all.length, "rule", "rules")} written, but none is currently active.`,
    };
  }
  const items = active.map((r) => ruleItem(r, shapeDetail(r)));
  const unconditional = active.filter((r) => r.shape === "unconditional").length;
  const conditional = active.length - unconditional;
  const parts: string[] = [];
  if (unconditional) parts.push(`${plural(unconditional, "always")}`);
  if (conditional) parts.push(`${plural(conditional, "when/then")}`);
  return {
    status: "ANSWERED",
    heading: "The rules you live by",
    summary: `${plural(items.length, "rule", "rules")} in force — ${parts.join(", ")}.`,
    items,
    limitation: conditional > 0 ? PROTOCOL_HISTORY_LIMITATION : undefined,
    sourceRefs: refsOf(items), plan,
  };
}

// ------------------------------------------------------------------ GOALS --

/**
 * What a life is pointed at, and what happened to the goals in it (LIFEOS-078).
 *
 * ## Every line traces to a stored field
 *
 * The goal's own `status`, `horizon`, `successorGoalId`, and its append-only
 * `history`. Nothing here counts an EDIT as progress: a retitled goal, a
 * changed horizon and a moved target date are all recorded transitions, and
 * none of them is a thing getting done. "Moved forward" means a completed
 * action or a completed project under the goal, and nothing else (§19).
 *
 * ## What it refuses to say
 *
 * No ranking of goals, no "on track", no percentage, and no claim that a goal
 * is neglected. When a replacement chain points at a goal that no longer
 * exists, the answer says so rather than printing an id (§17).
 */
function goalItem(goal: Goal, text: string, evidence: string, detail?: string, day?: DayKey): MemoryAnswerItem {
  return {
    text,
    // The user wrote the goal. Conqify is reporting a field, not authoring it.
    attribution: "You recorded",
    day,
    when: day ? fmt(day) : undefined,
    detail,
    ref: { kind: "goal", id: goal.id },
    href: `/goal/${goal.id}`,
    evidence,
    origin: "user_authored",
  };
}

function answerGoals(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean,
): MemoryAnswer {
  const goals = state.goals ?? [];
  const aspect = plan.goalAspect ?? "direction";
  const byId = new Map(goals.map((g) => [g.id, g]));

  /** The most recent history entry of a kind, within the answer's window. */
  const lastTransition = (g: Goal, match: (e: GoalHistoryEvent) => boolean): GoalHistoryEvent | undefined =>
    [...goalHistory(g)].filter(match).sort((a, b) => a.at.localeCompare(b.at)).pop();

  if (aspect === "direction") {
    // Long and life horizons ARE the answer to "what am I working toward" —
    // and the unplaced goals are named too, because a goal the user has not
    // placed is not evidence that they are pointed nowhere.
    const far = goals.filter((g) => (g.horizon === "long" || g.horizon === "life") && g.status === "active");
    const unplaced = goals.filter((g) => !g.horizon && g.status === "active");
    if (far.length === 0) {
      return {
        ...noEvidence(plan),
        heading: "No long-range goal is recorded",
        summary: unplaced.length
          ? `${plural(unplaced.length, "active goal has", "active goals have")} no horizon set, so Conqify cannot say which of them are long-range.`
          : "No active goal carries a long or life horizon.",
        status: "NO_RECORDED_EVIDENCE",
      };
    }
    const items = far.map((g) => goalItem(g, g.title, "goal.horizon", GOAL_HORIZON_LABEL[g.horizon!]));
    return {
      status: unplaced.length ? "PARTIALLY_ANSWERED" : "ANSWERED",
      heading: "What you are working toward",
      summary: `${plural(items.length, "goal is", "goals are")} set at a long or life horizon.`,
      items,
      limitation: unplaced.length
        ? `${plural(unplaced.length, "other active goal has", "other active goals have")} no horizon set, so they are not counted here.`
        : undefined,
      sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "paused" || aspect === "achieved" || aspect === "abandoned") {
    const status: GoalStatus = aspect === "paused" ? "paused" : aspect === "achieved" ? "completed" : "abandoned";
    const matching = goals.filter((g) => g.status === status);
    const label = GOAL_LIFECYCLE_LABEL[status].toLowerCase();
    if (matching.length === 0) {
      return { ...noEvidence(plan), heading: `No goal is marked ${label}`, summary: `No goal currently has that status.` };
    }
    const items = matching.map((g) => {
      // The DATE the transition happened, when the record holds one. An
      // `updatedAt` is not that date — a title edit moves it too.
      const t = lastTransition(g, (e) => e.toStatus === status);
      return goalItem(g, g.title, t ? "goal.history[].toStatus" : "goal.status",
        t ? undefined : "no transition date recorded", t?.at.slice(0, 10) as DayKey | undefined);
    });
    const undated = items.filter((i) => !i.day).length;
    return {
      status: undated ? "PARTIALLY_ANSWERED" : "ANSWERED",
      heading: `Goals ${label}`,
      summary: `${plural(items.length, "goal is", "goals are")} marked ${label}.`,
      items,
      limitation: undated
        ? `${plural(undated, "of them was", "of them were")} marked before Conqify recorded goal transitions, so the date is not known.`
        : undefined,
      sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "replaced") {
    const replaced = goals.filter((g) => g.status === "replaced" || g.successorGoalId);
    if (replaced.length === 0) {
      return { ...noEvidence(plan), heading: "No goal was replaced", summary: "No goal records a successor." };
    }
    const items = replaced.map((g) => {
      const successor = g.successorGoalId ? byId.get(g.successorGoalId) : undefined;
      const t = lastTransition(g, (e) => e.kind === "replaced");
      return goalItem(
        g, g.title, "goal.successorGoalId",
        // §17. A deleted successor is reported as deleted. The id is never shown.
        successor ? `became “${successor.title}”` : "the goal it became has since been deleted",
        t?.at.slice(0, 10) as DayKey | undefined,
      );
    });
    const gone = items.filter((i) => i.detail?.includes("deleted")).length;
    return {
      status: gone ? "PARTIALLY_ANSWERED" : "ANSWERED",
      heading: "Goals you replaced",
      summary: `${plural(items.length, "goal was", "goals were")} replaced by another.`,
      items,
      limitation: gone ? `${plural(gone, "successor has", "successors have")} since been deleted, so Conqify cannot name ${gone === 1 ? "it" : "them"}.` : undefined,
      sourceRefs: refsOf(items), plan,
    };
  }

  if (aspect === "no_path") {
    /**
     * LIFEOS-088 §14. The question is about a PATH, so it is answered about the
     * path.
     *
     * LIFEOS-078 answered it from linked projects alone and printed the gap as a
     * limitation: "a goal whose work is tracked as directly-linked actions still
     * appears here". It did appear here — an active goal with an open action
     * linked straight to it, and a recommender happy to name that action, was
     * listed as having nothing carrying it. Those goals are now named as what
     * they are instead of counted as what they are not.
     */
    const missing = goalsWithoutAnyPath(state);
    const carried = goalsCarriedByActions(state);
    const carriedNote = carried.length
      ? `${plural(carried.length, "other active goal has", "other active goals have")} no project, but ${carried.length === 1 ? "is" : "are"} carried by actions linked directly to ${carried.length === 1 ? "it" : "them"}.`
      : undefined;

    if (missing.length === 0) {
      return {
        ...noEvidence(plan),
        heading: "Every active goal has something carrying it",
        summary: "No active goal is without a project or a directly-linked action.",
        limitation: carriedNote,
      };
    }
    const items = missing.map((g) => goalItem(g, g.title, "project.goalId | action.goalId",
      "no active project, and no action linked directly to it"));
    return {
      status: "ANSWERED",
      heading: "Goals with nothing carrying them",
      summary: `${plural(items.length, "active goal has", "active goals have")} no active project and no action linked directly to ${items.length === 1 ? "it" : "them"}.`,
      items,
      limitation: carriedNote,
      sourceRefs: refsOf(items), plan,
    };
  }

  // "moved" — progress evidence, and ONLY the four qualifying kinds (§19).
  const from = range.startKey, to = range.endKey;
  const inRange = (iso?: string) => {
    const d = iso?.slice(0, 10);
    return !!d && d >= from && d <= to;
  };
  const moved: MemoryAnswerItem[] = [];
  for (const g of goals) {
    const projects = goalLinkedProjects(state, g.id);
    const projectIds = new Set(projects.map((p) => p.id));
    const doneActions = (state.nextActions ?? []).filter((a) =>
      a.status === "completed"
      && (a.goalId === g.id || (a.projectId ? projectIds.has(a.projectId) : false))
      && inRange(a.completedAt ?? a.updatedAt));
    const doneProjects = projects.filter((p) => p.status === "completed" && inRange(p.updatedAt));
    if (doneActions.length === 0 && doneProjects.length === 0) continue;
    const parts: string[] = [];
    if (doneActions.length) parts.push(`${plural(doneActions.length, "action")} completed`);
    if (doneProjects.length) parts.push(`${plural(doneProjects.length, "project")} completed`);
    moved.push(goalItem(g, g.title, "action.completedAt | project.status", parts.join(" · ")));
  }
  if (moved.length === 0) {
    return {
      ...noEvidence(plan),
      heading: `No goal moved forward${rangeSuffix(plan, range, implicit)}`,
      summary: "No action or project under a goal was completed in that period.",
      limitation: GOAL_PROGRESS_LIMITATION,
    };
  }
  return {
    status: "ANSWERED",
    heading: `Goals that moved forward${rangeSuffix(plan, range, implicit)}`,
    summary: `${plural(moved.length, "goal", "goals")} had work completed under ${moved.length === 1 ? "it" : "them"}.`,
    items: moved,
    limitation: GOAL_PROGRESS_LIMITATION,
    sourceRefs: refsOf(moved), plan,
  };
}

/** Said on every progress answer, because the exclusion is the point (§19). */
const GOAL_PROGRESS_LIMITATION =
  "Progress counts completed actions and projects only. Editing a goal, changing its horizon or moving its target date is recorded, but is not progress.";

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
/**
 * What is open with a person (LIFEOS-086 §19, §20).
 *
 * One class, five aspects, one derivation — `buildPersonContext`. Six separate
 * question kinds would have been six routers to keep in agreement.
 *
 * ## Ambiguity is surfaced, never resolved (§7, §8, §35)
 *
 * If the store also holds a longer name beginning with the one asked for, this
 * returns `NEEDS_CHOICE`. Conqify has no contact records, so it genuinely
 * cannot tell whether "Marcus" and "Marcus Webb" are one person — and picking
 * one would attribute someone's commitments to someone else.
 */
function answerPerson(
  state: StoreState, plan: MemoryQueryPlan, today: DayKey, opts: AnswerOptions,
): MemoryAnswer {
  const name = plan.personName;
  if (!name) {
    return {
      ...noEvidence(plan, IDENTITY_LIMITATION),
      heading: "Conqify couldn't tell who that is",
      summary: "Name the person as you wrote them — Conqify matches the name on your own records.",
    };
  }

  const forms = longerForms(state, name);
  if (forms.length > 0) {
    // §8, §25. Not a merge, and not a guess. The question is handed back.
    return {
      status: "NEEDS_CHOICE",
      heading: "More than one name matches",
      summary: AMBIGUOUS_NAME(name, forms),
      items: [],
      choices: [name, ...forms].map((n) => ({
        ref: { kind: "person_name", id: n },
        title: n,
        kindLabel: "Person",
        href: `/people/${encodeURIComponent(n)}`,
      })),
      limitation: IDENTITY_LIMITATION,
      sourceRefs: [],
      plan,
    };
  }

  const ix = opts.todayIndexes ?? buildTodayIndexes(state, today);
  const c = buildPersonContext(state, name, ix, today);
  const aspect = plan.personAspect ?? "all";

  const owe: MemoryAnswerItem[] = c.openCommitments.map((x) => ({
    text: x.action.title,
    attribution: "You recorded",
    day: x.dueDate as DayKey | undefined,
    when: x.dueDate ? fmt(x.dueDate as DayKey) : undefined,
    detail: [x.reason, x.attention].filter(Boolean).join(" "),
    ref: { kind: "action", id: x.action.id },
    href: `/actions/${x.action.id}`,
    evidence: "action.title",
    origin: "user_authored",
  }));

  const waits: MemoryAnswerItem[] = c.waiting.map((x) => ({
    text: x.action.title,
    attribution: "You recorded",
    day: x.since as DayKey | undefined,
    when: x.since ? fmt(x.since as DayKey) : undefined,
    // §34. Real temporal facts only, and a future follow-up is not a due one.
    detail: [
      `Waiting on ${x.waitingOn}${x.since ? ` since ${fmt(x.since as DayKey)}` : ""}.`,
      x.followUpDate ? (x.followUpDue ? "Follow up today." : `Follow up ${fmt(x.followUpDate as DayKey)}.`) : "",
    ].filter(Boolean).join(" "),
    ref: { kind: "action", id: x.action.id },
    href: `/actions/${x.action.id}`,
    evidence: "action.waitingOn",
    origin: "user_authored",
  }));

  const linkItems: MemoryAnswerItem[] = c.links.map((x) => ({
    text: x.title,
    attribution: "You recorded",
    detail: x.reason,
    ref: { kind: x.kind, id: x.id.split(":")[1] },
    href: x.route,
    evidence: `${x.kind}.description`,
    origin: "user_authored",
  }));

  const mentionItems: MemoryAnswerItem[] = c.mentions.map((x) => ({
    text: x.text,
    // §16. User-authored only — `buildPersonContext` filters machine prose out,
    // so this attribution can never land over a model's sentence.
    attribution: "You wrote",
    day: x.date as DayKey,
    when: fmt(x.date as DayKey),
    detail: "",
    ref: { kind: x.kind, id: x.id.split(":")[1] },
    href: x.route,
    evidence: `${x.kind}.createdAt`,
    origin: x.origin,
  }));

  const pick = aspect === "owe" ? owe
    : aspect === "waiting" ? waits
    : aspect === "mentions" ? mentionItems
    : aspect === "links" ? linkItems
    : [...owe, ...waits];

  const heading = aspect === "owe" ? `Open with ${name}`
    : aspect === "waiting" ? `Waiting on ${name}`
    : aspect === "mentions" ? `What you wrote about ${name}`
    : aspect === "links" ? `${PERSON_HEADINGS.links} · ${name}`
    : `Unresolved with ${name}`;

  if (pick.length === 0) {
    return {
      ...noEvidence(plan, IDENTITY_LIMITATION),
      heading,
      // §37. Bounded to the record, and it manufactures no follow-up.
      // The sentence has to answer the question that was ASKED. A links
      // question answered with "no open commitments or waiting items" reports
      // on a different thing entirely.
      summary: aspect === "mentions"
        ? `Conqify has nothing you wrote that names ${name}.`
        : aspect === "links"
          ? `No project or goal names ${name}.`
          : aspect === "waiting"
            ? `No action is marked as waiting on ${name}.`
            : NOTHING_OPEN(name),
      status: "NO_RECORDED_EVIDENCE",
    };
  }

  return {
    status: "ANSWERED",
    heading,
    summary: aspect === "mentions"
      ? `${plural(pick.length, "record")} you wrote naming ${name}.`
      : `${plural(pick.length, "item")} recorded with ${name}.`,
    items: pick,
    limitation: [aspect === "mentions" ? MENTION_NOTE : "", IDENTITY_LIMITATION].filter(Boolean).join(" "),
    sourceRefs: refsOf(pick),
    plan,
  };
}

function answerWaiting(
  state: StoreState, plan: MemoryQueryPlan, today: DayKey,
): MemoryAnswer {
  const asOf = plan.range && plan.range.endKey < today ? plan.range.endKey : undefined;
  /**
   * LIFEOS-086 §35. The person the question names, honoured.
   *
   * The audit measured "What am I waiting on from Maria?" planning WAITING with
   * `entityQuery` = "maria" and then answering with ALL THREE waiting records —
   * Jordan's form and a letting agency's lease included. The planner extracted
   * the person and this function discarded her, which is worse than not
   * answering: it is a confident wrong answer. Scoped on `waitingOn`, the one
   * structured field that records who a wait is on.
   */
  /**
   * LIFEOS-087 RED 2. `entityQuery` is NOT a person.
   *
   * LIFEOS-086 scoped this by `personName ?? entityQuery`, and the fallback was
   * wrong: for "What am I waiting on for Clinic launch?" the entity query is
   * the PROJECT's title, so the filter searched `waitingOn` for "clinic launch"
   * and reported "No action is marked as waiting on clinic launch" — while that
   * project held two waits. A person scopes by `waitingOn`; a project scopes by
   * `projectId`; nothing else scopes at all.
   */
  const who = plan.personName;
  const projectId = plan.projectRef?.id;
  const waiting = (state.nextActions ?? []).filter((a) =>
    a.status === "waiting"
    && (!who || namesPerson(a.waitingOn, who))
    && (!projectId || a.projectId === projectId));

  const scopeLabel = projectId
    ? (state.projects ?? []).find((p) => p.id === projectId)?.title
    : undefined;

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
      heading: asOf ? `Waiting · ${fmt(asOf)}`
        : who ? `Not waiting on anything from ${who}`
        : scopeLabel ? `Not waiting on anything for ${scopeLabel}`
        : "Not waiting on anything",
      summary: asOf
        ? `Conqify has no wait recorded as having started on or before ${fmt(asOf)} that is still open.`
        : who
          ? `No action is marked as waiting on ${who}.`
          : scopeLabel
            ? `No action in ${scopeLabel} is marked as waiting on anyone.`
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
    heading: asOf ? `Waiting as of ${fmt(asOf)}`
      : who ? `Waiting on ${who}`
      : scopeLabel ? `Waiting · ${scopeLabel}`
      : "Waiting on someone",
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

/**
 * The sections a "what changed?" answer is built from (LIFEOS-081 §20).
 *
 * Ordered as a person would want to read them — what moved, then what changed
 * direction, then what slipped — and never ranked by invented importance. An
 * empty section is dropped rather than printed (§20).
 *
 * `Moved forward` holds completions and NOTHING else. LIFEOS-078 drew that line
 * and §9 restates it: a horizon edit is a change of direction, not progress, and
 * putting the two in one section would tell someone that changing their mind was
 * getting something done.
 */
const CHANGE_SECTIONS: Array<{
  label: string;
  kinds: ExecutiveChangeKind[];
  clause: (n: number) => string;
  attribution: MemoryAttribution;
}> = [
  {
    label: "Moved forward",
    kinds: ["completed", "recurring_completed"],
    clause: (n) => `completed ${plural(n, "item")}`,
    attribution: "You completed",
  },
  {
    label: "Changed direction",
    kinds: ["goal_status_changed", "goal_horizon_changed", "goal_target_changed", "goal_replaced"],
    clause: (n) => `changed direction on ${plural(n, "goal")}`,
    attribution: "You recorded",
  },
  {
    label: "Added",
    kinds: ["created", "goal_created"],
    clause: (n) => `added ${plural(n, "item")}`,
    attribution: "You added",
  },
  {
    label: "Deferred",
    kinds: ["deferred", "returned", "rescheduled", "due_cleared"],
    clause: (n) => `moved the date on ${plural(n, "item")}`,
    attribution: "You recorded",
  },
  {
    label: "Waiting",
    kinds: ["waiting_started", "waiting_ended"],
    clause: (n) => `changed what you're waiting on ${n === 1 ? "once" : `${n} times`}`,
    attribution: "You recorded",
  },
  {
    label: "Your code",
    kinds: ["rule_adopted", "rule_revised", "rule_retired"],
    clause: (n) => `changed ${plural(n, "rule")} in your Personal Code`,
    attribution: "You recorded",
  },
  {
    label: "In your own words",
    kinds: ["reflection_added", "note_added", "capture_added", "decision_recorded"],
    clause: (n) => `wrote ${plural(n, "note or reflection", "notes and reflections")}`,
    attribution: "You wrote",
  },
  {
    label: "On the calendar",
    kinds: ["event_scheduled"],
    clause: (n) => `had ${plural(n, "event")} on the calendar`,
    attribution: "On your calendar",
  },
  {
    label: "Other changes",
    kinds: ["cancelled", "restored", "planned", "prerequisite_removed"],
    clause: (n) => `recorded ${plural(n, "other change")}`,
    attribution: "You recorded",
  },
];

/** Human wording for a change, used as the row's detail. Facts only (§21). */
const CHANGE_DETAIL: Partial<Record<ExecutiveChangeKind, string>> = {
  recurring_completed: "Done for the day",
  cancelled: "Cancelled",
  returned: "Came back from a deferral",
  restored: "Restored",
  due_cleared: "Date removed",
  planned: "Planned",
  prerequisite_removed: "Prerequisite removed",
  waiting_ended: "Stopped waiting",
  goal_created: "Goal added",
  goal_target_changed: "Target date changed",
  rule_adopted: "Rule adopted",
  rule_revised: "Rule revised",
  rule_retired: "Rule retired",
};

/** One change, as a row. The detail names the transition's two ends when known. */
function changeItem(state: StoreState, c: ExecutiveChange, attribution: MemoryAttribution): MemoryAnswerItem {
  const record = resolveRecord(state, c.entity.kind, c.entity.id);
  // A recorded transition says what it moved BETWEEN. "Near → Medium" is the
  // whole content of a horizon change, and printing the goal's title alone
  // would report that something happened without saying what.
  const transition = c.from && c.to ? `${c.from} → ${c.to}`
    : c.to ? `→ ${c.to}`
    : undefined;
  const detail = [CHANGE_DETAIL[c.kind], transition, c.detail].filter(Boolean).join(" · ") || undefined;
  return {
    text: displayText(c.title),
    attribution: isMachineProduced(c.origin) ? attributionFor(c.entity.kind, c.origin) : attribution,
    day: c.day,
    when: fmt(c.day),
    detail,
    ref: c.entity,
    href: record?.href,
    evidence: c.evidence,
    origin: c.origin,
  };
}

/**
 * What changed (§3, §20).
 *
 * ## One derivation, six questions
 *
 * `buildExecutiveChanges` is the only source. The aspect decides which slice of
 * it is read — and `postponed` is the one that is not a slice at all, because
 * counting repeated deferrals per record is a different shape from listing
 * changes in order.
 *
 * ## Entity scope is resolved, never guessed (§19)
 *
 * The audit found `entityQuery` being extracted and then ignored, so "what
 * changed with my graduate school goal?" returned the whole week over a
 * twelve-month window. It is now resolved first, and two matching goals produce
 * `NEEDS_CHOICE` rather than an arbitrary pick.
 */
function answerChanges(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean,
  searchIndex: SearchEntry[], opts: AnswerOptions,
): MemoryAnswer {
  const aspect = plan.changeAspect ?? "all";

  // ---- entity scope, before any derivation (§19) --------------------------
  let entity: RecordRefLite | undefined;
  let scopeTitle: string | undefined;
  if (plan.entityQuery) {
    // "my graduate school GOAL" names the record kind, and the kind is not part
    // of the title. Leaving it in made `resolveEntities` match nothing at all,
    // so the question silently fell back to the un-scoped answer — which is how
    // the audit found "what changed with my grad school goal?" returning the
    // whole week. Stripped here rather than in the router, because every other
    // class wants the noun ("what happened with the kitchen PROJECT" resolves
    // through a project-titled entry).
    const scopeQuery = plan.entityQuery
      .replace(/\b(?:goal|project|action|task|rule|standard|note)s?\b\s*$/i, "")
      .trim() || plan.entityQuery;
    const all = resolveEntities(searchIndex, scopeQuery);
    const candidates = focused(all, opts.focusRef);
    if (candidates.length > 1) return needsChoice(plan.question, candidates, plan);
    if (candidates.length === 1) {
      entity = { kind: candidates[0].kind as RecordRefLite["kind"], id: candidates[0].id };
      scopeTitle = candidates[0].title;
    }
    // No match at all is not an error: "what changed this week" extracts a
    // fragment that names nothing, and answering the un-scoped question is
    // right. A scope is applied only when a record actually resolved.
  }

  /**
   * The project this question is about, when it is about one.
   *
   * `entityQuery` is a fragment the frame stripper produced, and for "what keeps
   * getting deferred on Clinic launch?" it resolves to no record at all — so the
   * scope silently did not apply and an action from another project came back
   * in the answer. The router already resolved the project; this uses it, as a
   * FALLBACK so the ambiguity guard above still runs first.
   */
  const projectScope = entity?.kind === "project" ? entity.id
    : !entity && plan.projectRef ? plan.projectRef.id
    : undefined;

  // ---- §14: repeated postponement is its own derivation -------------------
  if (aspect === "postponed") {
    const postponed = repeatedlyPostponed(state, range)
      // A project scope means its actions — comparing an action's id to a
      // PROJECT's id matched nothing, so the question came back empty.
      .filter((p) => projectScope
        ? p.action.projectId === projectScope
        : !entity || p.action.id === entity.id);
    if (postponed.length === 0) {
      return {
        ...noEvidence(plan, implicit ? IMPLICIT_NOTE : undefined),
        heading: `Nothing was deferred more than once${rangeSuffix(plan, range, implicit)}`,
        summary:
          "Conqify counts this from recorded deferrals only. A task with an old due date was not deferred — it was scheduled and the day passed.",
      };
    }
    const items: MemoryAnswerItem[] = postponed.map((p) => ({
      text: displayText(p.action.title),
      attribution: "You recorded",
      day: p.lastAt.slice(0, 10) as DayKey,
      when: fmt(p.lastAt.slice(0, 10) as DayKey),
      detail: postponedLine(p),
      ref: { kind: "action", id: p.action.id },
      href: resolveRecord(state, "action", p.action.id)?.href,
      evidence: "action.history[].deferred",
      origin: "user_authored",
    }));
    return {
      status: "ANSWERED",
      heading: `Deferred more than once${rangeSuffix(plan, range, implicit)}`,
      summary: `${plural(items.length, "item was", "items were")} deferred more than once.`,
      items,
      // §15, stated rather than assumed: a weekly commitment pushed a day is not
      // avoidance, and the person should know it was never in this count.
      limitation: [
        "Counted from recorded deferrals. Work on a repeating schedule is not included.",
        implicit ? IMPLICIT_NOTE : "",
      ].filter(Boolean).join(" "),
      sourceRefs: refsOf(items),
      plan,
    };
  }

  // ---- §18: a second look, offered — never a recommendation to drop ---------
  //
  // The narrowest derivation in this file: deferred several times AND carrying
  // no due date. Both facts are stated and the answer stops there. There is no
  // "drop this", no "give up on", and no staleness number that could grow into
  // one — LIFEOS-084 §18 is explicit that the user decides.
  if (aspect === "reconsider") {
    const candidates = buildReconsider(state, repeatedlyPostponed(state, range))
      .filter((c) => !entity || c.entity.id === entity.id);
    if (candidates.length === 0) {
      return {
        ...noEvidence(plan, implicit ? IMPLICIT_NOTE : undefined),
        heading: `Nothing stands out for a second look${rangeSuffix(plan, range, implicit)}`,
        summary:
          "Conqify offers this only where a record was deferred several times and has no due date. Nothing recorded matches that.",
      };
    }
    const items: MemoryAnswerItem[] = candidates.map((c) => ({
      text: displayText(c.title),
      attribution: "You recorded",
      detail: c.explanation,
      ref: c.entity,
      href: resolveRecord(state, c.entity.kind, c.entity.id)?.href,
      evidence: c.evidence,
      origin: "user_authored",
    }));
    return {
      status: "ANSWERED",
      heading: `Worth a second look${rangeSuffix(plan, range, implicit)}`,
      // The sentence describes the SHAPE of the evidence, not the person.
      summary: `${plural(items.length, "record has", "records have")} been deferred several times without a due date.`,
      items,
      limitation: [
        "Conqify is not suggesting you drop anything. Work on a repeating schedule is not included.",
        implicit ? IMPLICIT_NOTE : "",
      ].filter(Boolean).join(" "),
      sourceRefs: refsOf(items),
      plan,
    };
  }

  // ---- everything else is a slice of the one derivation -------------------
  const changes = buildExecutiveChanges(state, range, { index: opts.index, entity });

  const ASPECT_KINDS: Partial<Record<ChangeAspect, ExecutiveChangeKind[]>> = {
    forward: [...MOVED_FORWARD_KINDS],
    // NOT `returned`. A deferral coming back is the timer elapsing, not the
    // person putting something off again — merging them would inflate the
    // answer to "what did I defer?" with events the user did not cause.
    deferred: ["deferred", "rescheduled"],
    waiting_ended: ["waiting_ended"],
    rules: ["rule_adopted", "rule_revised", "rule_retired"],
    // LIFEOS-084 §36. Recorded transitions of a goal or a rule — the same slice
    // the weekly review calls `changedDirection`, so the two surfaces cannot
    // disagree about what "changed direction" means (§32).
    direction: [...DIRECTION_KINDS, "rule_adopted", "rule_revised", "rule_retired"],
  };
  const wanted = ASPECT_KINDS[aspect];
  const scoped = wanted ? changes.filter((c) => wanted.includes(c.kind)) : changes;

  const where = scopeTitle ? ` · ${scopeTitle}` : "";
  // A rules question always carries the Protocol limitation, answered or not:
  // the absence of when/then history is the reason the answer may look short.
  const ruleLimit = aspect === "rules" ? PROTOCOL_CHANGE_LIMITATION : "";

  if (scoped.length === 0) {
    return {
      ...noEvidence(plan, [ruleLimit, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" ")),
      heading: `Nothing recorded${where}${rangeSuffix(plan, range, implicit)}`,
      summary: scopeTitle
        ? `Conqify recorded no change to ${scopeTitle} in that period.`
        : "Conqify recorded nothing in that period. That is a gap in the record, not a description of the time.",
    };
  }

  const items: MemoryAnswerItem[] = [];
  const parts: string[] = [];
  for (const section of CHANGE_SECTIONS) {
    const hits = scoped.filter((c) => section.kinds.includes(c.kind));
    if (!hits.length) continue;          // §20: no empty sections
    // The summary counts RECORDS, the list shows every change. Three deferrals
    // of one task is one thing being put off, and "moved the date on 3 items"
    // would claim three tasks slipped.
    parts.push(section.clause(new Set(hits.map((c) => c.entity.id)).size));
    for (const c of hits) {
      const item = changeItem(state, c, section.attribution);
      // A wait's detail is the bare name the user typed, which on its own line
      // reads as an unexplained word beside a title.
      if (c.kind === "waiting_started" && c.detail) item.detail = `Waiting on ${c.detail}`;
      items.push(item);
    }
  }

  // The heading answers the question that was asked. "What did I stop waiting
  // on?" headed "What Conqify recorded" reads like a different answer.
  const ASPECT_HEADING: Partial<Record<ChangeAspect, string>> = {
    forward: "What moved forward",
    deferred: "What you deferred",
    waiting_ended: "What you stopped waiting on",
    rules: "What changed in your Personal Code",
  };
  const asked = /\bchange|moved|shifted\b/.test(plan.question.toLowerCase());
  const heading = ASPECT_HEADING[aspect] ?? (asked ? "What changed" : "What Conqify recorded");
  return {
    status: "ANSWERED",
    heading: `${heading}${where}${rangeSuffix(plan, range, implicit)}`,
    summary: `You ${sentence(parts)}.`,
    items,
    limitation: [EVENT_HISTORY_LIMITATION, ruleLimit, implicit ? IMPLICIT_NOTE : ""].filter(Boolean).join(" "),
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
/** §12's conservatism, said out loud wherever project people are listed. */
const PEOPLE_LIMITATION =
  "Conqify matches names as you wrote them on this project's records. It has no contact records, so two people who share a name cannot be told apart.";

function answerProject(
  state: StoreState, plan: MemoryQueryPlan, range: ResolvedRange, implicit: boolean,
  searchIndex: SearchEntry[], opts: AnswerOptions, today: DayKey = todayKey(),
): MemoryAnswer {
  if (!plan.entityQuery) {
    return noEvidence(plan, MEMORY_UNRESOLVED_LABEL.no_entity);
  }

  // The router already resolved the project when the question named one, and
  // it is more reliable than the extracted fragment: the frame stripper turns
  // "Who is involved in Clinic launch?" into "nvolved clinic launch", which
  // matches no record at all.
  // A FALLBACK, never a preference: preferring it skipped the ambiguity guard,
  // so "what happened with the dashboard?" — two plausible records — silently
  // answered about one of them instead of asking.
  const resolved = resolveEntities(searchIndex, plan.entityQuery);
  const all = resolved.length > 0
    ? resolved
    : plan.projectRef
      ? searchIndex.filter((e) => e.kind === "project" && e.id === plan.projectRef!.id)
      : [];
  if (all.length === 0) {
    return { ...noEvidence(plan), heading: `Nothing about “${plan.entityQuery}”`,
      summary: `Conqify has no record whose title matches “${plan.entityQuery}”.` };
  }
  const candidates = focused(all, opts.focusRef);
  if (candidates.length > 1) return needsChoice(plan.question, candidates, plan);

  const only = candidates[0];

  /**
   * §17. "Who is involved in this project?"
   *
   * Answered from `buildProjectContext`'s people, so there is ONE people
   * derivation rather than two that could disagree — and so §12's conservatism
   * and §34's refusal to merge "Marcus" with "Marcus Webb" hold here too,
   * because they are the same code.
   */
  if (plan.projectAspect === "people" && only.kind === "project") {
    const ix = opts.todayIndexes ?? buildTodayIndexes(state, today);
    const ctx = buildProjectContext(state, only.id, ix, today);
    const people = ctx?.people ?? [];
    if (people.length === 0) {
      return {
        ...noEvidence(plan, PEOPLE_LIMITATION),
        heading: `Nobody is named in ${only.title}`,
        summary: `No action or description in ${only.title} names a person Conqify has anything recorded about.`,
      };
    }
    const items: MemoryAnswerItem[] = people.map((p) => ({
      text: p.name,
      attribution: "You recorded",
      detail: [
        p.grounding === "waiting" ? `You are waiting on them` : `Named in ${plural(p.actions, "action")}`,
        p.longerForms.length ? `Conqify also has “${p.longerForms[0]}”.` : "",
      ].filter(Boolean).join(" · "),
      ref: { kind: "person_name", id: p.name },
      href: p.route,
      evidence: p.grounding === "waiting" ? "action.waitingOn" : "action.title",
      origin: "user_authored",
    }));
    return {
      status: "ANSWERED",
      heading: `Named in ${only.title}`,
      summary: `${plural(items.length, "person is", "people are")} named in this project's records.`,
      items,
      limitation: PEOPLE_LIMITATION,
      sourceRefs: [],
      plan,
    };
  }

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
 * Words that survive frame-stripping but name no topic (LIFEOS-081 §17).
 *
 * Each is the remnant of a question about the person's own words in general —
 * "what did I say MATTERED this week", "what was I THINKING about". Treating one
 * as a search term looks for records containing the word itself, which is almost
 * never what was written.
 *
 * Deliberately small and literal. A term not on this list is a topic, and a
 * topic is searched for, exactly as before.
 */
const TOPICLESS_TERMS = new Set([
  "mattered", "matter", "matters", "important", "thinking", "think", "thought",
  "on my mind", "mind", "going on", "happening", "say", "said", "saying",
  "write", "wrote", "writing", "reflect", "reflected", "reflecting",
]);

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

  // LIFEOS-081 §17. A TOPICLESS question, answered by the range instead.
  //
  // "What did I say mattered this week?" has no topic — "mattered" is part of
  // the question frame — and the audit measured the consequence: the search
  // looked for records containing the literal word "mattered", the user's actual
  // reflection did not contain it, and the answer was NO_RECORDED_EVIDENCE while
  // the sentence sat in the store.
  //
  // The provenance boundary is untouched by this: the split below is what keeps
  // "you said" restricted to what the person actually wrote, and a topicless
  // question goes through exactly the same split.
  const topicless = !plan.emotionWord && TOPICLESS_TERMS.has(term.toLowerCase().trim());
  const hits = topicless && plan.range
    ? pool.map((entry) => ({ entry }))
    : searchFlat(pool, term, 40);

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
      heading: topicless ? "Nothing written in that period" : `Nothing written about “${term}”`,
      summary: topicless
        ? "Conqify found no note, reflection, capture or decision you wrote in that period."
        : plan.range
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
    // A topicless question found these by RANGE, not by the word. Saying they
    // "mention 'mattered'" would be false about every one of them.
    heading: topicless
      ? `What you wrote${plan.range ? ` · ${plan.range.label}` : ""}`
      : `What you wrote about “${term}”${plan.range ? ` · ${plan.range.label}` : ""}`,
    summary: topicless
      ? `${plural(authored.length, "record")} you wrote in that period.`
      : `${plural(authored.length, "record")} you wrote ${authored.length === 1 ? "mentions" : "mention"} “${term}”.`,
    items: [...authored, ...machine],
    limitation: [emotionNote, machine.length
      ? `${plural(machine.length, "other record")}${topicless ? " from that period" : " mentioning it"} ${machine.length === 1 ? "was" : "were"} AI-generated and ${machine.length === 1 ? "is" : "are"} marked as such.`
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
 * What may be slipping out of view (LIFEOS-070 §17).
 *
 * Delegates entirely to `buildCommitmentSignals` — the same deduplicated model
 * Today renders. That is the whole point of routing these questions here rather
 * than writing a second answer engine: asking "what am I forgetting?" on the
 * Memory page and reading Needs Attention on Today are two views of one list,
 * and they cannot drift because there is only one computation.
 */
/**
 * Is this signal about the named record, or about work under it? (LIFEOS-082 §25)
 *
 * Delegates the goal/project containment question to `inAttentionScope` so the
 * shortlist and the full list cannot disagree about what "with graduate school"
 * means — the whole point of one guidance model.
 */
function signalInScope(state: StoreState, s: CommitmentSignal, entity: RecordRefLite): boolean {
  return inAttentionScope(state, {
    entity: s.recordRef,
    projectRef: s.projectRef,
  }, entity);
}

/**
 * The shortlist (LIFEOS-082 §9, §10, §11).
 *
 * Three items by default, five at most. Every row says why it is there, and
 * carries the resolution seam it already had: a signal-backed row travels with
 * its `CommitmentSignal` so the surface builds LIFEOS-071's controls, and a
 * `repeated_deferral` row carries its action id instead — the same split
 * LIFEOS-072 made for recommendations, rather than synthesising a signal no
 * evidence supports.
 */
function answerFocus(
  state: StoreState, plan: MemoryQueryPlan, ix: TodayIndexes, today: DayKey,
  entity: RecordRefLite | undefined, scopeTitle: string | undefined,
): MemoryAnswer {
  const shortlist = buildAttentionShortlist(state, ix, today, { entity });
  const where = scopeTitle ? ` · ${scopeTitle}` : "";

  if (shortlist.length === 0) {
    return {
      ...noEvidence(plan, COMMITMENT_COVERAGE),
      heading: `Nothing stands out${where}`,
      // §24. The question may have said "neglecting"; the answer does not. And
      // this is bounded to the record — never "you're all caught up", which
      // would be a claim about a life rather than about Conqify's contents.
      summary: scopeTitle
        ? `Nothing Conqify has recorded about ${scopeTitle} is asking for attention right now.`
        : NOTHING_NEEDS_ATTENTION,
    };
  }

  const items: MemoryAnswerItem[] = shortlist.map((a) => ({
    text: a.title,
    attribution: attributionFor(a.entity.kind, classifyOrigin({ kind: a.entity.kind, text: a.title })),
    day: a.date,
    when: a.date ? fmt(a.date) : undefined,
    // §10. Every row answers "why am I being shown this?" — the explanation,
    // then any other true fact about the same item, then the user's own rule as
    // CONTEXT. The rule is last because it informs; it does not rank (§21).
    detail: [
      a.explanation,
      ...a.secondaryReasons.map((r) => r.text),
      ...a.ruleContext.map((r) => `Your Personal Code includes “${r}”`),
    ].join(" "),
    ref: a.entity,
    href: resolveRecord(state, a.entity.kind, a.entity.id)?.href,
    evidence: a.evidence,
    origin: classifyOrigin({ kind: a.entity.kind, text: a.title }),
    signal: a.signal,
  }));

  return {
    status: "ANSWERED",
    heading: `${ATTENTION_HEADING}${where}`,
    summary: `${plural(items.length, "thing", "things")} Conqify can point at from what it has recorded.`,
    items,
    limitation: COMMITMENT_COVERAGE,
    sourceRefs: refsOf(items),
    plan,
  };
}

/**
 * What is worth carrying into next week (LIFEOS-084 §15, §25, §26).
 *
 * The same attention shortlist `answerFocus` reads, projected forward and
 * capped. The difference is not the evidence — it is that these rows are
 * offered rather than ranked, and the answer says so.
 *
 * **This proposes; it does not plan.** Nothing here writes a date, moves a
 * commitment or touches the store. §26 is explicit that the review may not
 * silently change plans, and the guarantee is structural: `buildCarryForward`
 * is a pure function and this returns a list of rows.
 */
function answerCarry(
  state: StoreState, plan: MemoryQueryPlan, ix: TodayIndexes, today: DayKey,
  entity: RecordRefLite | undefined, scopeTitle: string | undefined,
): MemoryAnswer {
  const shortlist = buildAttentionShortlist(state, ix, today, { entity });
  const range = resolveWeekRange("this_week", today);
  const carry = buildCarryForward(
    state, shortlist, repeatedlyPostponed(state, range), today, CARRY_FORWARD_DEFAULT)
    .filter((c) => !entity || c.entity.id === entity.id);
  const where = scopeTitle ? ` · ${scopeTitle}` : "";

  if (carry.length === 0) {
    return {
      ...noEvidence(plan, COMMITMENT_COVERAGE),
      heading: `Nothing to carry forward${where}`,
      // Bounded to the record, like every other empty answer in this file. NOT
      // "you're on top of everything", which would be a claim about a life.
      summary: scopeTitle
        ? `Nothing Conqify has recorded about ${scopeTitle} is unresolved right now.`
        : "Nothing Conqify has recorded is unresolved right now. That is a statement about the records.",
    };
  }

  const items: MemoryAnswerItem[] = carry.map((c) => ({
    text: c.title,
    attribution: attributionFor(c.entity.kind, classifyOrigin({ kind: c.entity.kind, text: c.title })),
    day: c.attention?.date,
    when: c.attention?.date ? fmt(c.attention.date) : undefined,
    detail: [c.explanation, ...(c.attention?.secondaryReasons ?? []).map((r) => r.text)].join(" "),
    ref: c.entity,
    href: resolveRecord(state, c.entity.kind, c.entity.id)?.href,
    evidence: c.evidence,
    origin: classifyOrigin({ kind: c.entity.kind, text: c.title }),
    signal: c.attention?.signal,
  }));

  return {
    status: "ANSWERED",
    heading: `Worth carrying into next week${where}`,
    summary: `${plural(items.length, "thing is", "things are")} unresolved and still open.`,
    // §26, said out loud rather than merely implemented.
    limitation: `Nothing has been scheduled. ${COMMITMENT_COVERAGE}`,
    items,
    sourceRefs: refsOf(items),
    plan,
  };
}

function answerOpenWork(
  state: StoreState, plan: MemoryQueryPlan, today: DayKey,
  searchIndex: SearchEntry[], opts: AnswerOptions,
): MemoryAnswer {
  const ix = opts.todayIndexes ?? buildTodayIndexes(state, today);

  // ---- entity scope, resolved before any derivation (LIFEOS-082 §25) ------
  //
  // A frame word ("stuck", "neglecting") resolves to nothing and simply leaves
  // the question un-scoped, which is right. A named record scopes it. Two
  // matching records ask rather than pick — the rule LIFEOS-081 established for
  // `answerChanges`, applied to the builder that had the same defect.
  let entity: RecordRefLite | undefined;
  let scopeTitle: string | undefined;
  if (plan.entityQuery) {
    const scopeQuery = plan.entityQuery
      .replace(/\b(?:goal|project|action|task)s?\b\s*$/i, "").trim() || plan.entityQuery;
    const candidates = focused(resolveEntities(searchIndex, scopeQuery), opts.focusRef);
    if (candidates.length > 1) return needsChoice(plan.question, candidates, plan);
    if (candidates.length === 1) {
      entity = { kind: candidates[0].kind as RecordRefLite["kind"], id: candidates[0].id };
      scopeTitle = candidates[0].title;
    }
  }

  // ---- §23's shortlist: the same evidence, cut to what one can act on -----
  if (plan.guidanceAspect === "focus") {
    return answerFocus(state, plan, ix, today, entity, scopeTitle);
  }
  // ---- LIFEOS-084 §15: the same shortlist, read forward -------------------
  if (plan.guidanceAspect === "carry") {
    return answerCarry(state, plan, ix, today, entity, scopeTitle);
  }

  /**
   * LIFEOS-087 §3.7. "What is blocked?" asks about DEPENDENCY STATE.
   *
   * The `blocked` commitment SIGNAL is deliberately narrower than that:
   * LIFEOS-070 only raises it when the blocked action is itself due or its
   * blocker has gone quiet, because being blocked is not by itself worth
   * interrupting someone about. That is right for attention and wrong for a
   * direct question — asked "what is blocked on Clinic launch?" the product
   * answered "Nothing stands out" while an action sat behind an unfinished
   * blocker.
   *
   * So this reads the same index `buildProjectContext` reads. One derivation of
   * "blocked", used by both.
   */
  if (plan.signalKinds?.length === 1 && plan.signalKinds[0] === "blocked") {
    const scope = plan.projectRef?.id;
    const rows = (state.nextActions ?? []).filter((a) =>
      ix.blockedActionIds.has(a.id)
      && (!scope || a.projectId === scope)
      && (!entity || entity.kind === "project" || a.id === entity.id));
    const where = scopeTitle ? ` · ${scopeTitle}` : "";
    if (rows.length === 0) {
      return {
        ...noEvidence(plan, COMMITMENT_COVERAGE),
        heading: `Nothing is blocked${where}`,
        summary: "No action is waiting on another unfinished action.",
      };
    }
    const items: MemoryAnswerItem[] = rows.map((a) => {
      const blocker = [...(ix.blockedByMap.get(a.id) ?? [])]
        .map((bid) => ix.actionsById.get(bid))
        .find((b) => !!b && isLive(b));
      return {
        text: a.title,
        attribution: "You recorded",
        // Names the UNFINISHED blocker. A completed one is not what is holding
        // this up, and `blockedActionIds` already excluded rows whose only
        // blocker is done.
        detail: blocker ? `Blocked by “${blocker.title}”` : "Blocked by unfinished work",
        ref: { kind: "action", id: a.id },
        href: `/actions/${a.id}`,
        evidence: "actionDependencies",
        origin: "user_authored",
      };
    });
    return {
      status: "ANSWERED",
      heading: `Blocked${where}`,
      summary: `${plural(items.length, "action is", "actions are")} waiting on unfinished work.`,
      items,
      limitation: COMMITMENT_COVERAGE,
      sourceRefs: refsOf(items),
      plan,
    };
  }

  const all = buildCommitmentSignals(state, ix, { today });
  const byKind = plan.signalKinds?.length
    ? all.filter((s) => plan.signalKinds!.includes(s.kind))
    : all;
  const wanted = entity
    ? byKind.filter((s) => signalInScope(state, s, entity!))
    : byKind;

  const items: MemoryAnswerItem[] = wanted.map((s) => ({
    text: s.title,
    attribution: attributionFor(s.recordRef.kind, classifyOrigin({ kind: s.recordRef.kind, text: s.title })),
    day: s.date,
    when: s.date ? fmt(s.date) : undefined,
    // The explanation IS the answer for this class — every row says why it is
    // here, in the record's own terms.
    detail: [s.explanation, ...s.secondaryReasons.map((r) => r.text)].join(" "),
    ref: s.recordRef,
    href: resolveRecord(state, s.recordRef.kind, s.recordRef.id)?.href,
    evidence: s.evidence,
    origin: classifyOrigin({ kind: s.recordRef.kind, text: s.title }),
    // §18. The signal travels with the row so the surface can build the same
    // resolutions Today builds — one resolver, two places it is rendered.
    signal: s,
  }));

  if (items.length === 0) {
    return {
      ...noEvidence(plan, COMMITMENT_COVERAGE),
      heading: "Nothing stands out",
      // §20. Bounded to the record. NOT "you're all caught up", which would be
      // a claim about the user's life rather than about Conqify's contents.
      summary: NOTHING_STANDS_OUT,
    };
  }

  // Counts by kind, so the sentence above the list accounts for every row in it.
  const counted = new Map<string, number>();
  for (const s of wanted) counted.set(s.kind, (counted.get(s.kind) ?? 0) + 1);
  const phrase: Record<string, (n: number) => string> = {
    overdue: (n) => `${plural(n, "item is", "items are")} past a due date you set`,
    follow_up_due: (n) => `${plural(n, "follow-up date has", "follow-up dates have")} arrived`,
    returned_today: (n) => `${plural(n, "item")} came back from deferral today`,
    recurring_due: (n) => `${plural(n, "recurring occurrence is", "recurring occurrences are")} due today`,
    blocked: (n) => `${plural(n, "item is", "items are")} blocked by unfinished work`,
    due_soon: (n) => `${plural(n, "item is", "items are")} due soon`,
    project_no_next_action: (n) => `${plural(n, "project has", "projects have")} no executable next action`,
    goal_path_missing: (n) => `${plural(n, "goal has", "goals have")} no active project`,
    dormant: (n) => `${plural(n, "open item has", "open items have")} no recorded activity`,
  };
  const parts = [...counted.entries()]
    .sort((a, b) => COMMITMENT_ORDER.indexOf(a[0] as never) - COMMITMENT_ORDER.indexOf(b[0] as never))
    .map(([kind, n]) => (phrase[kind] ? phrase[kind](n) : `${plural(n, "item")} (${kind})`));

  return {
    status: "ANSWERED",
    heading: "What may need attention",
    summary: `${sentence(parts)}.`,
    items,
    limitation: COMMITMENT_COVERAGE,
    sourceRefs: refsOf(items),
    plan,
  };
}

/**
 * What should I do next (LIFEOS-072 §21).
 *
 * Delegates to `recommendNextAction` — the same function Today's Suggested Next
 * card calls, with the same indexes. Asking Memory and reading Today therefore
 * cannot give different answers, because there is one builder and no second
 * guidance path. A tie still produces no standout here, exactly as it does
 * there: refusing to guess is the answer, not a gap to fill.
 */
function answerNextAction(state: StoreState, plan: MemoryQueryPlan, today: DayKey, opts: AnswerOptions): MemoryAnswer {
  const ix = opts.todayIndexes ?? buildTodayIndexes(state, today);
  const result = recommendNextAction(state, ix, today);

  if (!result.recommendation) {
    return {
      status: "NO_RECORDED_EVIDENCE",
      heading: "No single next action stands out",
      summary: result.note ?? NO_STANDOUT,
      items: [],
      limitation: result.consideredCount > 0
        ? `${plural(result.consideredCount, "action is", "actions are")} ready to start; none of them has a date or dependency that puts it ahead of the others.`
        : "Nothing Conqify has recorded is ready to start right now.",
      sourceRefs: [], plan,
    };
  }

  const { action, reasons, counterfactual } = result.recommendation;
  const ref: RecordRefLite = { kind: "action", id: action.id };
  return {
    status: "ANSWERED",
    heading: action.title,
    // Reasons first, then the short comparison — the same two things the card
    // shows, in the same order.
    summary: [reasons.map((r) => r.text).join(" · "), counterfactual].filter(Boolean).join(". "),
    items: [{
      text: action.title,
      attribution: attributionFor("action", classifyOrigin({ kind: "action", text: action.title })),
      day: action.dueDate,
      when: action.dueDate ? fmt(action.dueDate) : undefined,
      detail: reasons.map((r) => r.text).join(" · "),
      ref,
      href: `/actions/${action.id}`,
      evidence: reasons.map((r) => r.code).join(","),
      origin: classifyOrigin({ kind: "action", text: action.title }),
    }],
    limitation: COMMITMENT_COVERAGE,
    sourceRefs: [ref],
    plan,
  };
}

/**
 * What do I have tomorrow (LIFEOS-073 §15, §16).
 *
 * Reads the SAME tomorrow-preview the daily loop builds, so Memory and Today
 * can never disagree about tomorrow. Dated evidence only: events, actions due
 * tomorrow, occurrences falling tomorrow, and a deferral whose own return date
 * is tomorrow. Undated open work is never invented into tomorrow — the whole
 * point of §14's no-carry-forward rule.
 */
function answerTomorrow(state: StoreState, plan: MemoryQueryPlan, today: DayKey, opts: AnswerOptions): MemoryAnswer {
  const ix = opts.todayIndexes ?? buildTodayIndexes(state, today);
  const view = buildDailyExecutiveView(state, ix, today);
  const day = addDays(today, 1);

  if (view.tomorrow.length === 0) {
    return {
      status: "NO_RECORDED_EVIDENCE",
      heading: `Nothing dated for ${fmt(day)}`,
      summary: NOTHING_TOMORROW,
      items: [],
      // Never "you're free tomorrow" — an empty calendar is a fact about the
      // records, not about the day (§22).
      limitation: TOMORROW_COVERAGE,
      sourceRefs: [], plan,
    };
  }

  const items = view.tomorrow.map((t) => {
    const ref: RecordRefLite = { kind: t.kind === "event" ? "event" : "action", id: t.id };
    const origin = classifyOrigin({ kind: ref.kind, text: t.title });
    return {
      text: t.title,
      // An Event is on the calendar. It is never "attended" (§29).
      attribution: attributionFor(ref.kind, origin),
      day,
      when: [t.time, t.detail].filter(Boolean).join(" · ") || fmt(day),
      ref,
      href: ref.kind === "event" ? `/today` : `/actions/${t.id}`,
      evidence: t.kind === "recurring" ? "recurrence occurrence" : t.kind === "event" ? "event.date" : "action.dueDate",
      origin,
    };
  });

  const events = view.tomorrow.filter((t) => t.kind === "event").length;
  const work = view.tomorrow.length - events;
  const clauses = [
    events ? `${plural(events, "event is", "events are")} on your calendar` : "",
    work ? `${plural(work, "item is", "items are")} dated for it` : "",
  ].filter(Boolean);

  return {
    status: "ANSWERED",
    heading: fmt(day),
    summary: `${clauses.join(" and ")}.`,
    items,
    limitation: TOMORROW_COVERAGE,
    sourceRefs: items.map((i) => i.ref),
    plan,
  };
}

/** §15. Dated evidence only — nothing was carried forward to fill this. */
const TOMORROW_COVERAGE =
  "This is what Conqify has a date for tomorrow. Open work with no date isn't moved here automatically.";

/** §22. The answer is bounded by the record, and says so. */
const COMMITMENT_COVERAGE =
  "This is what Conqify has recorded a date or a dependency for. Anything you never wrote down isn't here.";

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
