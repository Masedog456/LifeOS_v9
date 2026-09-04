/**
 * Universal search — one query, every domain (LIFEOS-085 §5).
 *
 * ## What this is NOT
 *
 * Not a second search engine. LIFEOS-027 already built the index
 * (`buildSearchEntries`), the ranking (`scoreEntry`, `compareResults`) and the
 * palette, and LIFEOS-030's workspace search already reuses them rather than
 * forking. All of that is kept. This is the composition layer the audit found
 * missing between a good lexical index and a person's ordinary sentence.
 *
 * It adds five things, each of which the audit measured as absent:
 *
 *   FILTERS      "rules about anger", "completed applications" — a domain or
 *                status word is a FILTER, not text to match. The product stores
 *                a "ConstitutionElement"; the person says "rules".
 *   DATES        "notes from last week" — through `resolveMemoryRange`, the
 *                existing backward-looking parser. There is no second one.
 *   PRECEDENCE   a raw inbox capture outranked the Goal the query named, purely
 *                because it happened to contain the phrase verbatim.
 *   ONE HOP      an Action linked to Goal "Graduate school" is a useful result
 *                for "grad school" even with no lexical match. One hop, never
 *                two.
 *   HANDOFF      "what did I say about teaching?" is a question Memory answers.
 *                Search recognises it and points; it does not reimplement it.
 *
 * ## Pure
 *
 * A function of `(state, query, options)`. No store writes, no clock of its own
 * beyond the `today` a caller passes, no network, no AI, no persistence. The
 * index is passed in when the caller already has one, so the hot keystroke path
 * rebuilds nothing (§36).
 *
 * ## No relevance number reaches a person (§8)
 *
 * Scores exist inside `ranking.ts` and stay there. Every row carries a
 * `matchReason` that is a factual sentence — "Title match", "Contains 'anger'",
 * "Linked to Graduate school" — and never a percentage, a confidence or a rank.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { StoreState } from "@/types/mvp";
import type { OriginType } from "@/lib/provenance";
import type { ResolvedRange } from "@/lib/insights/range";
import type { SearchEntry, SearchResult } from "@/lib/command/types";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { isMachineProduced } from "@/lib/provenance";
import { classifyOrigin } from "@/lib/provenance/classify";
import { buildIndex } from "@/lib/command/search";
import { RECORD_LABELS } from "@/lib/command/records";
import { compareResults, normalizeQuery, queryTokens, scoreEntry } from "@/lib/command/ranking";
import { planMemoryQuery, resolveMemoryRange } from "@/lib/memory/query";
import { personHint, personSummaryLine } from "@/lib/people/context";

// ------------------------------------------------------------------ caps ---

/** §34. Enough to find the thing; never a database dump. */
export const SEARCH_LIMIT = 20;
/** §19. Linked results are context, not a second result set. */
export const MAX_LINKED = 3;

// --------------------------------------------------------------- filters ---

/**
 * Words that name a DOMAIN rather than a record (§33 as language).
 *
 * The audit's "rules about anger" returned nothing: tokens `rules` and `anger`
 * both had to be found, and no standard contains the word "rules" — the product
 * calls it a Standard. Read as a filter, the same sentence works, and it works
 * for the reason a person would expect: they named a kind and a topic.
 *
 * §20: "rules" deliberately selects BOTH Standards and Protocols. There is no
 * Rules-only search island, and a person asking about their rules means both.
 */
export const DOMAIN_WORDS: Record<string, readonly string[]> = {
  action: ["action", "actions", "task", "tasks", "todo", "todos"],
  project: ["project", "projects"],
  goal: ["goal", "goals"],
  note: ["note", "notes"],
  reflection: ["reflection", "reflections"],
  event: ["event", "events", "calendar", "appointment", "appointments", "meeting", "meetings"],
  constitution_element: ["rule", "rules", "standard", "standards"],
  protocol: ["protocol", "protocols"],
  document: ["document", "documents", "pdf", "pdfs", "paper", "papers", "book", "books"],
  capture: ["capture", "captures"],
  decision: ["decision", "decisions"],
};

/** "rules" must reach Protocols too (§20). */
const DOMAIN_ALSO: Record<string, readonly string[]> = {
  constitution_element: ["protocol"],
};

/**
 * Status words the store actually records (§14).
 *
 * Nothing here is invented: each maps to a `status` a record genuinely carries,
 * which is why there is no "stalled", "urgent" or "important" — Conqify records
 * none of those, and recognising them would be a promise it cannot keep.
 */
export const STATUS_WORDS: Record<string, readonly string[]> = {
  open: ["open"],
  completed: ["completed", "complete", "done", "finished"],
  waiting: ["waiting"],
  retired: ["retired"],
  paused: ["paused"],
  active: ["active"],
};

export interface SearchFilters {
  /** Record kinds the query named. Empty means every domain. */
  domains: string[];
  /** The status word the query named, if any. */
  status?: string;
  /** The period the query named, through the EXISTING parser. */
  range?: ResolvedRange;
  /** The words the filters consumed, so a surface can show what it read. */
  consumed: string[];
}

// --------------------------------------------------------------- results ---

export interface UniversalSearchResult {
  /** Stable derived key. Same state and query, same id. */
  id: string;
  /** The store's kind. Internal — never rendered (§10). */
  entityType: string;
  /** The product's word for that kind. This is what a person sees. */
  label: string;
  entityId: string;
  title: string;
  /** Short, and never the whole body (§11). */
  snippet: string;
  /** Why this row is here, as a sentence. Never a number (§8). */
  matchReason: string;
  date?: string;
  status?: string;
  /** Who wrote it, so a surface can attribute honestly (§12). */
  origin?: OriginType;
  route: string;
}

/**
 * A question the product answers somewhere else (§16, §17).
 *
 * Search does not answer it and does not reimplement the answer — it says which
 * surface owns the question and links there with the question intact.
 */
export interface SearchHandoff {
  kind: "memory" | "guidance";
  /** What the destination is called, in the product's own words. */
  label: string;
  question: string;
  route: string;
}

export interface UniversalSearch {
  query: string;
  results: UniversalSearchResult[];
  handoff?: SearchHandoff;
  filters: SearchFilters;
  /** Matches before the cap, so "showing 20 of 63" is honest. */
  total: number;
  capped: boolean;
  /** Captures folded into the record they became (§27). */
  suppressed: number;
}

// ------------------------------------------------------------ the reader ---

/**
 * Read filters out of the query and return the text that remains.
 *
 * Order matters: the date phrase is consumed first because it is the longest
 * and most distinctive ("last week"), then domain and status words, and what is
 * left is the actual subject. A word is only consumed when something else in
 * the query survives it — "notes" alone is a search for the word "notes", not
 * an empty query with a filter, because a person typing one word means it.
 */
export function readFilters(query: string, today: DayKey): { filters: SearchFilters; text: string } {
  const consumed: string[] = [];
  let rest = normalizeQuery(query);

  // Dates through the EXISTING backward-looking parser (§13). `lib/capture/dates`
  // leans FORWARD because it exists to schedule things, which is exactly wrong
  // for finding something — and writing a third parser is worse still.
  const rm = resolveMemoryRange(query, today);
  let range: ResolvedRange | undefined;
  if (rm.range && rm.phrase) {
    const phrase = normalizeQuery(rm.phrase);
    if (phrase && rest.includes(phrase)) {
      range = rm.range;
      consumed.push(rm.phrase);
      rest = rest.replace(phrase, " ").replace(/\s+/g, " ").trim();
    }
  }

  const words = rest.split(" ").filter(Boolean);
  const domains = new Set<string>();
  let status: string | undefined;
  const kept: string[] = [];

  for (const w of words) {
    let taken = false;
    for (const [kind, forms] of Object.entries(DOMAIN_WORDS)) {
      if (forms.includes(w)) {
        domains.add(kind);
        for (const also of DOMAIN_ALSO[kind] ?? []) domains.add(also);
        consumed.push(w);
        taken = true;
        break;
      }
    }
    if (taken) continue;
    for (const [s, forms] of Object.entries(STATUS_WORDS)) {
      if (forms.includes(w)) { status = s; consumed.push(w); taken = true; break; }
    }
    if (!taken) kept.push(w);
  }

  // A single word that happens to name a domain is a SEARCH for that word, not
  // a filter with nothing behind it. "notes" should find the note titled
  // "Notes", and "waiting" should still list what is waiting — but the filter
  // only earns the right to eat the query when something else remains.
  if (kept.length === 0 && consumed.length === 1 && !range) {
    return { filters: { domains: [], consumed: [] }, text: rest };
  }

  // Stopwords are dropped from what REMAINS, not just from token matching.
  // Leaving them in made "things I'm waiting on" search for the literal text
  // "things i m on" — a status filter that had correctly read `waiting` and was
  // then handed a query no record could satisfy, so it returned nothing.
  return { filters: { domains: [...domains].sort(), status, range, consumed }, text: queryTokens(kept.join(" ")).join(" ") };
}

// -------------------------------------------------------------- handoff ----

/**
 * Is this a question rather than a name?
 *
 * The distinction §16 draws, made syntactic so it is checkable: a question
 * opens with a question word or ends with a question mark. "grad school" is a
 * name. "what changed with grad school?" is a question.
 *
 * Deliberately NOT "did `planMemoryQuery` return a plan" — it happily routes
 * "things I'm waiting on" and "my long-term goals", which are searches for
 * records and which Search should answer itself.
 */
export function isQuestion(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.endsWith("?")) return true;
  return /^(what|when|where|who|whom|whose|why|how|which|should i|do i|did i|am i|have i|can i)\b/.test(q);
}

/** Which surface owns a question class. */
function handoffFor(query: string, today: DayKey, projects: { id: string; title: string }[]): SearchHandoff | undefined {
  if (!isQuestion(query)) return undefined;
  const plan = planMemoryQuery(query, { today, projects });
  if (!plan) return undefined;
  // Guidance is an OPEN_WORK question read through 082's shortlist; everything
  // else Memory answers. Both live on `/memory` — one surface, as §4 requires.
  const guidance = plan.kind === "OPEN_WORK" || plan.kind === "NEXT_ACTION";
  return {
    kind: guidance ? "guidance" : "memory",
    label: guidance ? "Ask what to focus on" : "Ask your memory",
    question: query.trim(),
    route: `/memory?ask=${encodeURIComponent(query.trim())}`,
  };
}

// --------------------------------------------------------------- reasons ---

/** §8. A sentence about the record, never a number about the match. */
function reasonFor(r: SearchResult, text: string): string {
  switch (r.matchField) {
    case "title-exact": return "Exact title match";
    case "title-prefix": return "Title starts with your search";
    case "title": return "Title match";
    case "title-tokens": return "Title contains your words";
    case "alias": return "Tag or alias match";
    case "body": return text ? `Contains “${text}”` : "Text match";
    case "body-tokens": return "Text contains your words";
    default: return "Match";
  }
}

/** §10. The product's word, singular, derived from the group label. */
export function labelFor(kind: string): string {
  const plural = RECORD_LABELS[kind] ?? kind;
  if (plural === "Next actions") return "Action";
  if (plural === "Calendar") return "Event";
  if (plural === "Library") return "Source";
  if (plural === "Reflection sessions") return "Reflection session";
  if (plural === "Reading notes") return "Reading note";
  return plural.endsWith("ies") ? `${plural.slice(0, -3)}y`
    : plural.endsWith("s") ? plural.slice(0, -1)
    : plural;
}

/** A waiting action is a Waiting record to a person, whatever table it lives in. */
function labelForEntry(entry: SearchEntry): string {
  if (entry.kind === "action" && entry.status === "waiting") return "Waiting";
  return labelFor(entry.kind);
}

// ------------------------------------------------------------- the search ---

export interface SearchOptions {
  index?: SearchEntry[];
  today?: DayKey;
  limit?: number;
  /** A domain chip, from the UI. Intersects with any domain the query named. */
  domain?: string;
}

/**
 * Domain precedence when the same idea exists twice (§27).
 *
 * A confirmed record beats the raw capture it came from. This is not a
 * relevance judgement — it is the observation that a capture's whole purpose is
 * to become something else, and once it has, showing both is showing one thing
 * twice.
 */
const CAPTURE_KIND = "capture";

export function searchEverything(
  state: StoreState,
  query: string,
  options: SearchOptions = {},
): UniversalSearch {
  const today = options.today ?? todayKey();
  const index = options.index ?? buildIndex(state);
  const limit = options.limit ?? SEARCH_LIMIT;
  const projects = (state.projects ?? []).map((p) => ({ id: p.id, title: p.title }));

  const { filters, text: filtered } = readFilters(query, today);
  const handoff = handoffFor(query, today, projects);

  /**
   * A question's SUBJECT, not its frame.
   *
   * "What did I say about philosophy?" leaves `what did say philosophy` after
   * stopwords, and token matching requires every word — so a question found
   * nothing even when the product held the record. `planMemoryQuery` already
   * extracts the thing being asked about, with the question frame and date
   * words removed, and reusing it means there is no second frame stripper to
   * drift from the first.
   *
   * Pointing at Memory and showing the literal matches are not in tension:
   * §17 forbids reimplementing Memory's ANSWER, not showing records.
   */
  const text = handoff
    ? (planMemoryQuery(query, { today, projects })?.entityQuery || filtered)
    : filtered;

  // A UI chip narrows whatever the sentence already said (§33).
  //
  // An empty INTERSECTION means nothing matches — "rules about anger" with the
  // Goals chip selected. Representing that as an empty set would mean "no
  // filter", i.e. everything, so the chip would silently widen the very result
  // it was clicked to narrow; `impossible` says so instead.
  const domains = new Set(filters.domains);
  let impossible = false;
  if (options.domain) {
    if (domains.size === 0) domains.add(options.domain);
    else {
      impossible = !domains.has(options.domain);
      domains.clear();
      if (!impossible) domains.add(options.domain);
    }
  }

  const q = normalizeQuery(text);
  const inDomain = (e: SearchEntry) => domains.size === 0 || domains.has(e.kind);
  const inStatus = (e: SearchEntry) => !filters.status || e.status === filters.status;
  const inRange = (e: SearchEntry) => {
    if (!filters.range) return true;
    const day = (e.updatedAt || "").slice(0, 10);
    return !!day && day >= filters.range.startKey && day <= filters.range.endKey;
  };

  const hits: SearchResult[] = [];
  if (impossible) {
    // Deliberately nothing. The chip and the sentence name different domains.
  } else if (q) {
    for (const entry of index) {
      if (!inDomain(entry) || !inStatus(entry) || !inRange(entry)) continue;
      const r = scoreEntry(entry, q);
      if (r) hits.push(r);
    }
  } else if (domains.size > 0 || filters.status || filters.range) {
    // The query was ALL filter — "things I'm waiting on", "notes from last
    // week". Listing what matches is the honest answer; returning nothing
    // because no text remained would be a parser complaining at a person.
    for (const entry of index) {
      if (!inDomain(entry) || !inStatus(entry) || !inRange(entry)) continue;
      hits.push({ entry, score: 0, matchField: "title" });
    }
    hits.sort((a, b) => (a.entry.updatedAt < b.entry.updatedAt ? 1 : a.entry.updatedAt > b.entry.updatedAt ? -1 : a.entry.id.localeCompare(b.entry.id)));
  }
  if (q) hits.sort(compareResults);

  // ---- §27: a capture that already became something is not a second result --
  //
  // The signal is the RECORDED LINK, not text similarity. Several record kinds
  // carry `sourceCaptureId`, written by the store when a capture is processed,
  // so "did this capture already become that?" is a fact the product knows
  // rather than a resemblance a matcher guesses at. The first draft compared
  // normalized strings and got it wrong in both directions — it missed the pair
  // it was written for, because the action's indexed body repeats its own
  // title.
  //
  // Access to the source is never destroyed (§27): the capture is still on the
  // inbox and still reachable from the record it produced. It is only kept out
  // of a result list that already shows what it became.
  const producedFrom = new Set<string>();
  for (const a of state.nextActions ?? []) if (a.sourceCaptureId) producedFrom.add(a.sourceCaptureId);
  for (const n of state.notes ?? []) if (n.sourceCaptureId) producedFrom.add(n.sourceCaptureId);
  for (const p of state.protocols ?? []) if (p.sourceCaptureId) producedFrom.add(p.sourceCaptureId);
  for (const e of state.constitutionElements ?? []) if (e.sourceCaptureId) producedFrom.add(e.sourceCaptureId);
  for (const e of state.events ?? []) if (e.sourceCaptureId) producedFrom.add(e.sourceCaptureId);

  let suppressed = 0;
  const kept = hits.filter((h) => {
    if (h.entry.kind !== CAPTURE_KIND) return true;
    if (!producedFrom.has(h.entry.id)) return true;   // still raw — §26 keeps it
    suppressed++;
    return false;
  });

  // ---- §19: one hop, and one hop only -------------------------------------
  const seen = new Set(kept.map((h) => `${h.entry.kind}:${h.entry.id}`));
  const linked: UniversalSearchResult[] = [];
  if (q) {
    const anchors = kept.filter((h) => h.entry.kind === "goal" || h.entry.kind === "project").slice(0, 2);
    for (const a of anchors) {
      const goalId = a.entry.kind === "goal" ? a.entry.id : undefined;
      const projectIds = new Set(
        goalId
          ? (state.projects ?? []).filter((p) => p.goalId === goalId).map((p) => p.id)
          : [a.entry.id],
      );
      for (const act of state.nextActions ?? []) {
        if (linked.length >= MAX_LINKED) break;
        const belongs = (goalId && act.goalId === goalId) || (act.projectId ? projectIds.has(act.projectId) : false);
        if (!belongs) continue;
        const key = `action:${act.id}`;
        if (seen.has(key)) continue;
        // A finished thing is not a useful contextual result for "find X".
        if (act.status === "completed" || act.status === "cancelled") continue;
        seen.add(key);
        linked.push({
          id: `linked:action:${act.id}`,
          entityType: "action",
          label: act.status === "waiting" ? "Waiting" : "Action",
          entityId: act.id,
          title: act.title || "(untitled action)",
          snippet: act.description || act.notes || "",
          // The reason names the record it came through, so the hop is visible
          // rather than mysterious.
          matchReason: `Linked to ${a.entry.title}`,
          date: act.dueDate,
          status: act.status,
          // Classified, not assumed. Hardcoding `user_authored` here made a
          // linked row claim "You wrote this" directly beneath a Goal row that
          // — correctly — claimed nothing, because an Action's authorship is
          // not something the schema guarantees. Both paths now ask the same
          // classifier, so they cannot disagree about the same record.
          origin: classifyOrigin({ kind: "action", text: act.title }),
          route: `/actions/${act.id}`,
        });
      }
    }
  }

  // §27. A capture's whole purpose is to become something else. One that has
  // not yet is still worth showing — it may hold wording nothing else does —
  // but it is raw, unconfirmed material and does not belong above the record a
  // person actually keeps. The audit measured an inbox capture ranking first
  // for "grad school", above the Goal of that name.
  const ordered = [
    ...kept.filter((h) => h.entry.kind !== CAPTURE_KIND),
    ...kept.filter((h) => h.entry.kind === CAPTURE_KIND),
  ];

  const primary: UniversalSearchResult[] = ordered.map((h) => ({
    id: `search:${h.entry.kind}:${h.entry.id}`,
    entityType: h.entry.kind,
    label: labelForEntry(h.entry),
    entityId: h.entry.id,
    title: h.entry.title,
    snippet: h.entry.snippet,
    matchReason: q ? reasonFor(h, text.trim()) : filterReason(filters),
    date: h.entry.updatedAt ? h.entry.updatedAt.slice(0, 10) : undefined,
    status: h.entry.status,
    origin: h.entry.origin,
    route: h.entry.href,
  }));

  /**
   * A Person row, when the query names someone the store has work about
   * (LIFEOS-086 §18).
   *
   * Placed FIRST because it is the thing the query named; the rows beneath are
   * the records that mention them. It does not duplicate the person view — it
   * is one row that opens it.
   *
   * `personHint` returns null unless the text is plausibly a name and something
   * is actually recorded, so an ordinary word never grows a Person row.
   */
  const person: UniversalSearchResult[] = [];
  if (q && domains.size === 0 && !impossible && filters.consumed.length === 0) {
    // The RAW query, not the residual: `readFilters` normalizes to lowercase,
    // and capitalisation is the only evidence available that a word is a name.
    // Restricted to queries where no filter fired, which is the bare-name case
    // this row exists for — "notes about Marcus" is a note search.
    const hint = personHint(state, query.trim());
    if (hint) {
      person.push({
        id: `person:${hint.name}`,
        entityType: "person_name",
        label: "Person",
        entityId: hint.name,
        title: hint.name,
        snippet: personSummaryLine(hint),
        // §8, §25 surfaced right here: if a longer name exists, the row says so
        // rather than implying Conqify knows which person is meant.
        matchReason: hint.longerForms.length
          ? `Name match · Conqify also has “${hint.longerForms[0]}”`
          : "Name match",
        status: undefined,
        // No origin: a person is not authored text, and claiming otherwise is
        // the failure LIFEOS-085 caught over a document.
        route: `/people/${encodeURIComponent(hint.name)}`,
      });
    }
  }

  const all = [...person, ...primary, ...linked];
  return {
    query,
    results: all.slice(0, limit),
    handoff,
    filters,
    total: all.length,
    capped: all.length > limit,
    suppressed,
  };
}

/** Why a row is here when the query was all filter and no text. */
function filterReason(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.status) parts.push(`Status is ${f.status}`);
  if (f.range) parts.push(`In ${f.range.label}`);
  if (parts.length === 0 && f.domains.length > 0) parts.push("Matches the kind you asked for");
  return parts.join(" · ") || "Match";
}

// ----------------------------------------------------------------- words ---

export const SEARCH_EMPTY = (q: string) => `No matches for “${q}”.`;

/**
 * How a result row is attributed (§12).
 *
 * The rule is the one `classifyOrigin`'s own documentation states: uncertainty
 * must not be rounded up into authorship. Most kinds — a Goal, an Action, an
 * Event, a Document — are classified `unknown`, because nothing in the schema
 * guarantees who wrote their text. The first version of this treated anything
 * not machine-produced as the user's, and the visual review caught it claiming
 * "You wrote this" over a PDF written by Jane Reed.
 *
 * So only the kinds whose authorship the schema DOES guarantee earn the
 * sentence, machine prose says so, and everything else says nothing at all —
 * which is also quieter, since a row already states its kind and its reason.
 */
export function attributionFor(r: { origin?: OriginType; date?: string }): string {
  if (!r.origin) return "";
  if (isMachineProduced(r.origin)) return "Written by Conqify";
  if (r.origin === "original_source") return "From a source";
  if (r.origin !== "user_authored" && r.origin !== "imported_user_authored") return "";
  // The product's date format, not an ISO key — every other surface says
  // "Tue, Aug 25", and a search row is not the place to start showing raw keys.
  return r.date ? `You wrote this ${formatDayKey(r.date)}` : "You wrote this";
}

/** §8. Nothing here may ever appear in a result row. */
export const SEARCH_FORBIDDEN_WORDS: readonly string[] = [
  "% relevant", "relevance", "confidence", "importance", "ai score", "score:",
  "ranked", "probability", "similarity",
];
