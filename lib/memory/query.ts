/**
 * Memory query planning — turning an ordinary question into a bounded retrieval
 * (LIFEOS-069 §2, §3, §4).
 *
 * ## What this file is, and what it deliberately is not
 *
 * It is a ROUTER. It reads a sentence, decides which of eight recorded-evidence
 * questions it is, extracts the thing being asked about, and resolves the time
 * window against the range helpers the rest of the product already uses. That is
 * the whole job. It never touches the store, never scores anything, and never
 * produces prose.
 *
 * It is not a natural-language understander. A question it cannot route comes
 * back as `null`, and the answer layer says so in plain words rather than
 * guessing a class — because a misrouted question does not fail loudly, it
 * quietly answers a DIFFERENT question, which is worse than not answering.
 *
 * ## There is no second date parser (§4)
 *
 * `lib/capture/dates.ts` exists to decide what a person is scheduling, so every
 * one of its resolutions leans FORWARD: "August 25" written in September means
 * next August. That is right for a deadline and exactly wrong for a memory —
 * nobody asking "what happened in August" means the one that has not occurred.
 *
 * So this file does not parse dates. It maps a small closed vocabulary of
 * BACKWARD-LOOKING phrases onto the existing range engine:
 *
 *   1. relative windows   — today, yesterday, this/last week, last N days,
 *                           this/last month, this year
 *   2. named months       — "in June" → the most recent June that has begun
 *   3. named weekdays     — "last Tuesday" → the most recent Tuesday
 *
 * Every one of those produces a `ResolvedRange` by calling `resolveRange` or
 * `resolveWeekRange`; the only date arithmetic here is `addDays`, which is the
 * shared engine's own. Anything outside those three shapes is reported as
 * `unresolved` and the question is answered over all recorded time, with the
 * unsupported phrase named. Marking a phrase unsupported is cheap. Silently
 * choosing a window the user did not ask for is not.
 *
 * ## Nothing is persisted (§2)
 *
 * A plan is a value. It lives for one render.
 */

import type { DayKey } from "@/lib/reviews/dates";
import { addDays, todayKey, weekStartKey } from "@/lib/reviews/dates";
import { resolveRange, type ResolvedRange } from "@/lib/insights/range";
import { resolveWeekRange } from "@/lib/memory/week";

// ------------------------------------------------------------------ kinds ---

/**
 * The eight questions Conqify can answer from recorded evidence (§2).
 *
 * Each maps to evidence that actually exists. There is no `FEELINGS`, no
 * `PROGRESS` and no `SUMMARY`, because nothing in the schema records a mood, a
 * rate of movement, or a judgement — and a class with no evidence behind it is a
 * promise the retrieval layer would have to invent an answer to keep.
 */
export type MemoryQueryKind =
  | "COMPLETION"   // what did I finish
  | "EVENTS"       // what was on my calendar
  | "WAITING"      // what am I waiting on
  | "CHANGES"      // what changed / what happened
  | "PROJECT"      // what happened with <project>
  | "REFLECTION"   // what did I say about <topic>
  | "OPEN_WORK"    // what still needs attention
  | "TIME"         // when did I <verb> <thing>
  | "NEXT_ACTION"  // what should I do next
  | "TOMORROW";    // what do I have tomorrow

export const MEMORY_QUERY_KINDS: readonly MemoryQueryKind[] = [
  "COMPLETION", "EVENTS", "WAITING", "CHANGES", "PROJECT", "REFLECTION", "OPEN_WORK", "TIME",
  "NEXT_ACTION", "TOMORROW",
];

/**
 * For a TIME question, which recorded moment is being asked for.
 *
 * "When did I finish X" and "when did I move X" read completely different
 * fields — a `completedAt` and a `history[].due_set` — and answering one from
 * the other would date an event that never happened.
 */
export type TimeAspect = "completed" | "added" | "moved" | "started_waiting";

/** Why part of a question could not be turned into a retrieval constraint. */
export type MemoryUnresolvedReason = "unsupported_range" | "future_range" | "no_entity";

export const MEMORY_UNRESOLVED_LABEL: Record<MemoryUnresolvedReason, string> = {
  unsupported_range: "Conqify couldn't turn that into a date range, so this looks at everything recorded.",
  future_range: "That period hasn't happened yet, so there is nothing recorded in it.",
  no_entity: "Conqify couldn't tell what this question is about.",
};

export interface MemoryUnresolved {
  /** The user's own words, verbatim, so the UI quotes rather than paraphrases. */
  phrase: string;
  reason: MemoryUnresolvedReason;
}

/**
 * A transient retrieval plan. Not stored, not exported, not shown as-is.
 */
export interface MemoryQueryPlan {
  kind: MemoryQueryKind;
  /** The question exactly as asked. Never normalised back onto the user. */
  question: string;
  range?: ResolvedRange;
  /** How the range was said — "last week", "in June". Used in headings. */
  rangeLabel?: string;
  /** The thing being asked about, with question-frame and date words removed. */
  entityQuery?: string;
  /** Set only when `entityQuery` matched exactly one project title. */
  projectRef?: { kind: "project"; id: string };
  /** Which moment a TIME question wants. */
  timeAspect?: TimeAspect;
  /**
   * `high` when an explicit signal in the sentence chose the class; `low` when
   * the class came from a weaker fallback. The answer layer states low
   * confidence rather than hiding it.
   */
  confidence: "high" | "low";
  unresolved: MemoryUnresolved[];
  /**
   * True when the question asks about a feeling. Conqify records words, not
   * moods, so the answer layer must say so (§23, negative assertion 5).
   */
  emotionWord?: string;
  /**
   * For an OPEN_WORK question that names ONE kind of slip — "what follow-ups
   * are due?", "what came back today?" — the commitment kinds it is asking
   * about. Empty means the whole picture (LIFEOS-070 §17).
   */
  signalKinds?: string[];
  /** True when the question asks WHO rather than WHAT ("who am I waiting on"). */
  wantsSubject?: boolean;
}

// ----------------------------------------------------------------- ranges ---

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Backward-looking relative windows, longest phrase first so "last 7 days"
 * cannot be shadowed by "last".
 *
 * Each entry hands the work to the existing helpers. `resolveWeekRange` already
 * knows weeks start Monday and that "this week" ends TODAY rather than Sunday —
 * re-deciding either of those here would put two different weeks on one page.
 */
const RELATIVE_RANGES: Array<{ re: RegExp; resolve: (today: DayKey) => ResolvedRange }> = [
  { re: /\bthe day before yesterday\b/, resolve: (t) => day(addDays(t, -2)) },
  { re: /\blast (?:7|seven) days\b|\bpast (?:7|seven) days\b/, resolve: (t) => resolveWeekRange("last_7_days", t) },
  { re: /\blast (?:30|thirty) days\b|\bpast (?:30|thirty) days\b/, resolve: (t) => resolveRange("last_30_days", { today: t }) },
  { re: /\bpast (?:few )?weeks?\b/, resolve: (t) => resolveWeekRange("last_7_days", t) },
  { re: /\blast week\b|\bthe week before\b/, resolve: (t) => resolveWeekRange("last_week", t) },
  { re: /\bthis week\b|\bso far this week\b/, resolve: (t) => resolveWeekRange("this_week", t) },
  { re: /\blast month\b/, resolve: (t) => resolveRange("last_month", { today: t }) },
  { re: /\bthis month\b|\bpast month\b/, resolve: (t) => resolveRange("this_month", { today: t }) },
  { re: /\bthis year\b|\bpast year\b/, resolve: (t) => resolveRange("this_year", { today: t }) },
  { re: /\byesterday\b/, resolve: (t) => day(addDays(t, -1)) },
  { re: /\btoday\b/, resolve: (t) => resolveRange("today", { today: t }) },
];

/** A single day as a range, through the same engine everything else uses. */
function day(key: DayKey): ResolvedRange {
  return resolveRange("custom", { today: key, customStart: key, customEnd: key });
}

/** The most recent occurrence of a weekday, never today and never ahead. */
function lastWeekday(name: string, today: DayKey): DayKey {
  const target = WEEKDAY_NAMES.indexOf(name);
  // `weekStartKey` returns the Monday of `today`'s week; Sunday is index 0, so
  // the day-of-week is read from that anchor rather than from a Date the host
  // timezone could shift.
  const monday = weekStartKey(today);
  const current = (WEEKDAY_NAMES.indexOf("monday") + dayOffsetFromMonday(today, monday)) % 7;
  let delta = (current - target + 7) % 7;
  if (delta === 0) delta = 7; // "last Tuesday" asked on a Tuesday means the previous one.
  return addDays(today, -delta);
}

function dayOffsetFromMonday(today: DayKey, monday: DayKey): number {
  // Both keys are local day keys from the same engine; the difference is whole
  // days by construction.
  let n = 0;
  let cursor = monday;
  while (cursor < today && n < 7) { cursor = addDays(cursor, 1); n += 1; }
  return n;
}

/** The most recent named month that has already begun. */
function lastMonth(monthIndex: number, today: DayKey): ResolvedRange {
  const year = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)) - 1;
  const y = monthIndex <= currentMonth ? year : year - 1;
  const start: DayKey = `${y}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const nextMonth = monthIndex === 11 ? `${y + 1}-01-01` : `${y}-${String(monthIndex + 2).padStart(2, "0")}-01`;
  return resolveRange("custom", { today, customStart: start, customEnd: addDays(nextMonth, -1) });
}

/** Phrases that name a window Conqify cannot resolve backwards. */
const VAGUE_RANGE_RE =
  /\b(?:a while (?:ago|back)|recently|lately|back then|the other day|sometime|some time|at some point|ages ago|last time)\b/;

/** A forward-looking window. Memory has nothing in it, and says so. */
const FUTURE_RANGE_RE = /\b(?:tomorrow|next week|next month|next year|later this week|coming up|upcoming)\b/;

export interface RangeMatch {
  range?: ResolvedRange;
  /** The matched words, for the heading and for `unresolved`. */
  phrase?: string;
  unresolved?: MemoryUnresolved;
}

/**
 * Find the time window in a question, if there is one Conqify can resolve.
 *
 * Returns no range when the question names no period — which is a real answer,
 * not a failure: "what am I waiting on?" is about now, and "what did I say about
 * teaching?" is about all of it.
 */
export function resolveMemoryRange(question: string, today: DayKey = todayKey()): RangeMatch {
  const q = normalise(question);

  const future = FUTURE_RANGE_RE.exec(q);
  if (future) return { phrase: future[0], unresolved: { phrase: future[0], reason: "future_range" } };

  for (const { re, resolve } of RELATIVE_RANGES) {
    const m = re.exec(q);
    if (m) return { range: resolve(today), phrase: m[0] };
  }

  // "last Tuesday", "on Tuesday". A bare weekday in a past-tense question means
  // the one that has been, which is the opposite of what capture's parser does
  // with the same word — hence the separate, deliberately tiny table.
  const wd = /\b(?:last |on |this past )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(q);
  if (wd) {
    const key = lastWeekday(wd[1], today);
    return { range: day(key), phrase: wd[0] };
  }

  // "in June", "during May", "back in March".
  const mo = new RegExp(`\\b(?:in|during|back in|through(?:out)?)\\s+(${MONTH_NAMES.join("|")})\\b`).exec(q);
  if (mo) {
    const idx = MONTH_NAMES.indexOf(mo[1]);
    return { range: lastMonth(idx, today), phrase: mo[0] };
  }

  const vague = VAGUE_RANGE_RE.exec(q);
  if (vague) return { phrase: vague[0], unresolved: { phrase: vague[0], reason: "unsupported_range" } };

  return {};
}

// ---------------------------------------------------------------- routing ---

const normalise = (s: string): string =>
  (s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/**
 * Feeling words. Present so the answer can be honest about a limit, never so it
 * can be scored: Conqify stores text, and text containing "worried" is evidence
 * that the word was written — not evidence of a state of mind (§23).
 */
const EMOTION_WORDS =
  /\b(worried|worry|worrying|anxious|anxiety|stressed|stress|sad|sadness|happy|happiness|angry|upset|excited|afraid|scared|frustrated|overwhelmed|lonely|calm|content)\b/;

/**
 * Class signals, in priority order. Order is the whole design here: several of
 * these overlap, and the earlier rule is the more specific reading.
 */
const SIGNALS: Array<{ kind: MemoryQueryKind; re: RegExp; aspect?: TimeAspect }> = [
  // "What should I do next?" — routed to the SAME deterministic recommender
  // Today uses (LIFEOS-072 §21). First, because "what should I do next" also
  // contains "do", which the COMPLETION signal would otherwise claim.
  { kind: "NEXT_ACTION", re: /\bwhat should (?:i|we) (?:do|work on|start|tackle)\b|\bwhat'?s next\b|\bwhat next\b|\bwhere should (?:i|we) start\b|\bwhat do (?:i|we) do next\b/ },

  // "What do I have tomorrow?" — the only FORWARD-looking class (LIFEOS-073
  // §15, §16). It answers from the same tomorrow-preview model the daily loop
  // uses, so there is no second tomorrow engine.
  //
  // Ahead of every backward signal below, because "what do I have tomorrow"
  // and "what's on tomorrow" both contain words the calendar and open-work
  // rules would otherwise claim and then resolve into a PAST range.
  //
  // The past-tense guard keeps the exemption exactly one class wide. "What did
  // I finish tomorrow?" is a question about a period that has not happened, and
  // it must keep falling through to the future-range refusal — answering it
  // with tomorrow's schedule would be the product quietly changing the question.
  { kind: "TOMORROW", re: /^(?!.*\b(?:did|was|were|had|have i|been)\b).*\btomorrow\b/ },

  // "when did I…" is unambiguous and must beat every topic word after it.
  { kind: "TIME", re: /^(?:so )?when did (?:i|we)\b.*\b(?:finish|complete|completed|finished|do|did|get done|wrap up)\b/, aspect: "completed" },
  { kind: "TIME", re: /^(?:so )?when did (?:i|we)\b.*\b(?:move|moved|reschedul|push|pushed|defer|deferred|change|changed)\w*\b/, aspect: "moved" },
  { kind: "TIME", re: /^(?:so )?when did (?:i|we)\b.*\b(?:add|added|create|created|capture|captured|write|wrote|note)\w*\b/, aspect: "added" },
  { kind: "TIME", re: /^(?:so )?when did (?:i|we)\b.*\bstart(?:ed)? waiting\b/, aspect: "started_waiting" },
  { kind: "TIME", re: /^(?:so )?when (?:did|was)\b/, aspect: "completed" },

  // Waiting is named explicitly whenever it is meant.
  { kind: "WAITING", re: /\bwaiting (?:on|for|to hear)\b|\bam i waiting\b|\bwas i waiting\b|\bstill waiting\b|\bwaiting items?\b|\bblocked on\b|\bowes? me\b|\bhaven'?t heard back\b/ },

  // "what did I say/write/think about X" — authorship questions.
  //
  // A feeling word makes it one too. "What was I sad about last week?" is not a
  // question Conqify can answer about a mood, but it IS a question it can answer
  // about text — and routing it here is what lets the answer layer say exactly
  // that, instead of the router shrugging and the product saying nothing.
  { kind: "REFLECTION", re: new RegExp(
    "\\b(?:did|have) (?:i|we) (?:say|said|write|wrote|note|record|think|thought|mention|reflect)\\b"
    + "|\\bmy (?:notes?|reflections?|thoughts?)\\b"
    + "|\\bwhat (?:was|were) (?:i|we) (?:worried|worrying|thinking|feeling|sad|anxious|stressed|upset|excited|angry|afraid|scared|frustrated|overwhelmed|lonely|happy)\\b") },

  // The calendar, by name.
  { kind: "EVENTS", re: /\bcalendar\b|\bscheduled?\b|\bappointments?\b|\bmeetings?\b|\bon my (?:schedule|agenda)\b|\bevents?\b/ },

  { kind: "CHANGES", re: /\bwhat changed\b|\bwhat (?:has )?moved\b|\bwhat shifted\b|\bany changes\b|\bwhat (?:got )?(?:reschedul|defer|cancel)\w*\b/ },

  { kind: "COMPLETION", re: /\b(?:finish|finished|complete|completed|accomplish|accomplished|get done|got done|got through|checked off|ticked off|wrap(?:ped)? up)\b|\bwhat did (?:i|we) do\b/ },

  // OPEN_WORK is also the "what am I forgetting?" class (LIFEOS-070 §17). Those
  // questions are answered from the SAME commitment signals Today renders, so a
  // person cannot get one answer from the page and a different one from Memory.
  { kind: "OPEN_WORK", re: /\bstill (?:needs?|need) attention\b|\bstill open\b|\bneeds? (?:my )?attention\b|\bwhat'?s left\b|\bwhat'?s outstanding\b|\bstill (?:to do|need to do|owe)\b|\bon my plate\b|\bunfinished\b|\bstill hanging\b|\bam i forgetting\b|\bhave i forgotten\b|\bslipping\b|\bfollow.?ups? (?:are )?due\b|\bcame? back (?:today|from deferral)\b|\bno (?:executable )?next action\b|\bfell through\b/ },

  // "what happened with X" is a project question when X is one, and a general
  // "around X" question otherwise; the retrieval layer decides which.
  { kind: "PROJECT", re: /\bwhat (?:happened|is going on|has been going on|went on) (?:with|on|for)\b|\bhow (?:is|are|did) .+ (?:going|go)\b|\bstate of\b/ },
];

/** Question frames stripped before the entity is read out of the sentence. */
const FRAME_RE = new RegExp(
  "^(?:so |ok(?:ay)?[, ]+|hey[, ]+|and )*" +
  "(?:what|when|who|which|how)?\\s*" +
  "(?:did|do|does|was|were|am|is|are|has|have|had)?\\s*" +
  "(?:i|we|my|conqify)?\\s*",
);

/**
 * An explicit topic marker — the one shape where the user has told us exactly
 * where the subject starts.
 *
 * Deliberately only these four. "on" and "for" look like topic markers and are
 * not: "what was ON my calendar" would hand back "my calendar" as the thing
 * being asked about, and the retrieval layer would then go looking for a record
 * called "calendar". A preposition that usually means something else is worse
 * than no marker at all, because the fallback path below handles those cleanly.
 */
const TOPIC_MARKER_RE = /\b(?:about|regarding|concerning|with)\s+(.+)$/;

/** Words that carry no topic on their own and only pad the entity. */
const ENTITY_STOPWORDS = new Set([
  "the", "a", "an", "my", "our", "some", "any", "that", "this", "it", "thing",
  "stuff", "item", "items", "record", "records", "about", "with", "on", "for",
  "to", "of", "in", "at", "and", "or", "please", "again", "me", "am", "was",
  "from", "back", "up", "out", "over",
]);

/**
 * The vocabulary that ROUTED the question.
 *
 * "What was on my calendar yesterday?" is an EVENTS question because of the word
 * calendar — so carrying that word forward as the topic would make the answer
 * search for a record named "calendar" and find nothing. The word did its job at
 * the router; it is not what the question is about.
 *
 * Applied only when there was no explicit topic marker, so a project genuinely
 * called "Calendar migration" survives "what happened with the calendar
 * migration" intact.
 */
const ROUTING_WORDS =
  /\b(?:calendar|scheduled?|appointments?|meetings?|events?|agenda|waiting|wait|hear|changed?|changes|moved?|shifted?|reschedul\w*|defer\w*|cancel\w*|still|needs?|attention|open|outstanding|left|plate|unfinished|hanging|accomplish\w*|finish\w*|complete[d]?|happen\w*|going|went|worried|worry|blocked)\b/g;

/** Verbs that frame the question rather than name its subject. */
const FRAMING_VERBS =
  /\b(?:say|said|write|wrote|note|noted|think|thought|mention|mentioned|reflect|reflected|record|recorded|add|added|create|created|capture|captured|do|did|done|get|got|go)\b/g;

/**
 * Pull the subject out of a question, with the frame and the date words gone.
 *
 * "When did I finish the deployment last week?" → "deployment". The range phrase
 * is removed first, because leaving it in would make the lexical search look for
 * a record whose title contains "last week".
 */
export function extractEntity(question: string, rangePhrase?: string): string | undefined {
  let q = normalise(question).replace(/[?!.]+$/g, "");
  if (rangePhrase) q = q.replace(rangePhrase, " ");

  const marked = TOPIC_MARKER_RE.exec(
    q.replace(/\bwhat (?:did|do|was|were|is|are|has|have)\b/, " ").replace(/\b(?:i|we)\b/g, " "),
  );
  let tail = marked ? marked[1] : q.replace(FRAME_RE, "");

  tail = tail.replace(FRAMING_VERBS, " ");
  // Only on the fallback path — see ROUTING_WORDS.
  if (!marked) tail = tail.replace(ROUTING_WORDS, " ");
  tail = tail.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

  const words = tail.split(" ").filter((w) => w && !ENTITY_STOPWORDS.has(w));
  const entity = words.join(" ").trim();
  return entity.length >= 2 ? entity : undefined;
}

export interface PlanOptions {
  today?: DayKey;
  /**
   * Project titles, so an unambiguous project name can be bound in the plan.
   * A LIST, not the store: the router has no business reading records.
   */
  projects?: ReadonlyArray<{ id: string; title: string }>;
}

/**
 * Route a question, or refuse to.
 *
 * Returns `null` when no signal matched. That is not a bug to be smoothed over
 * with a default class — answering "what did I finish last week?" for a question
 * that was actually about something else is the failure mode this whole sprint
 * exists to prevent.
 */
export function planMemoryQuery(question: string, opts: PlanOptions = {}): MemoryQueryPlan | null {
  const raw = (question ?? "").trim();
  if (!raw) return null;
  const q = normalise(raw);
  const today = opts.today ?? todayKey();

  const rm = resolveMemoryRange(raw, today);
  const unresolved: MemoryUnresolved[] = rm.unresolved ? [rm.unresolved] : [];

  let kind: MemoryQueryKind | undefined;
  let timeAspect: TimeAspect | undefined;
  for (const s of SIGNALS) {
    if (!s.re.test(q)) continue;
    kind = s.kind;
    timeAspect = s.aspect;
    break;
  }

  let confidence: "high" | "low" = "high";
  if (!kind) {
    // A bare "what happened <range>?" has no class word in it at all, and its
    // honest reading is "everything you recorded then" — which is exactly the
    // CHANGES rollup. This is the ONLY fallback, and it requires a range so it
    // can never swallow an off-topic question.
    if (/\bwhat happened\b|\bwhat went on\b|\bwhat did (?:i|we) get up to\b/.test(q) && rm.range) {
      kind = "CHANGES";
      confidence = "low";
    } else {
      return null;
    }
  }

  const entityQuery = extractEntity(raw, rm.phrase);

  // A PROJECT or REFLECTION or TIME question with no subject cannot be
  // retrieved against anything. Said out loud rather than answered generically.
  if (!entityQuery && (kind === "PROJECT" || kind === "TIME")) {
    unresolved.push({ phrase: raw, reason: "no_entity" });
  }

  let projectRef: MemoryQueryPlan["projectRef"];
  if (entityQuery && opts.projects?.length) {
    const hits = opts.projects.filter((p) => {
      const t = p.title.toLowerCase();
      return t === entityQuery || t.includes(entityQuery) || entityQuery.includes(t);
    });
    // Exactly one, or nothing. Two projects called "dashboard" is an ambiguity
    // for the retrieval layer to surface as a choice — never resolved here by
    // picking the first, the newest, or the closest (§13).
    if (hits.length === 1) projectRef = { kind: "project", id: hits[0].id };
  }

  const emotion = EMOTION_WORDS.exec(q);

  // A narrower forgetting question asks about one kind of slip. Anything else
  // gets the whole picture rather than a guessed subset.
  let signalKinds: string[] | undefined;
  if (kind === "OPEN_WORK") {
    if (/\bfollow.?ups?\b/.test(q)) signalKinds = ["follow_up_due"];
    else if (/\bcame? back\b|\bfrom deferral\b/.test(q)) signalKinds = ["returned_today"];
    // LIFEOS-078. Asked BEFORE the project branch: "which goals have no
    // project?" contains the word "project" too, and the older ordering would
    // have answered a question about goals with a list of projects.
    else if (/\bgoals?\b/.test(q)) signalKinds = ["goal_path_missing"];
    else if (/\bprojects?\b/.test(q)) signalKinds = ["project_no_next_action"];
    else if (/\bblocked\b/.test(q)) signalKinds = ["blocked"];
  }

  return {
    kind,
    signalKinds,
    question: raw,
    range: rm.range,
    rangeLabel: rm.phrase,
    entityQuery,
    projectRef,
    timeAspect,
    confidence,
    unresolved,
    emotionWord: emotion ? emotion[0] : undefined,
    wantsSubject: /^who\b|\bwho (?:am|are|was|were|is|do|did) /.test(q) || undefined,
  };
}

/** Example questions shown when nothing routes. Every one is answerable (§14). */
export const MEMORY_QUERY_EXAMPLES: readonly string[] = [
  "What did I finish last week?",
  "What was on my calendar yesterday?",
  "What am I waiting on?",
  "What changed last week?",
  "What did I say about teaching?",
  "When did I finish the deployment?",
  "What still needs attention?",
];
