/**
 * Living Memory (LIFEOS-026, Feature 1).
 *
 * A READ-ONLY subsystem that surfaces meaningful records the user already owns
 * — it never modifies knowledge and stores nothing new (everything is derived
 * from `StoreState` + the LIFEOS-021 graph at call time). Each candidate carries
 * a full, transparent MemoryExplanation: which deterministic rules fired, the
 * supporting records, a qualitative confidence, and when it was generated. A
 * single record can accrue several reasons (e.g. "last reviewed 96 days ago;
 * connected to 3 recent captures; unresolved dialogue still exists").
 *
 * No AI, no inference beyond what the records state, no background work.
 */

import type { StoreState } from "@/types/mvp";
import { buildGraph, backReferences, type KnowledgeGraph } from "@/lib/graph";
import { levelFromCount } from "@/lib/dialectic/confidence";
import { daysSince, explain, type MemoryExplanation, type MemoryRecordRef, type MemoryTrigger } from "@/lib/memory/explanation";

export type MemoryKind =
  | "not_revisited"
  | "related_to_recent_capture"
  | "recurring_concept"
  | "unfinished_dialogue"
  | "unresolved_tension"
  | "abandoned_research"
  | "forgotten_decision"
  | "recurring_theme"
  | "anniversary"
  | "frequently_referenced";

export interface MemoryCandidate {
  /** Stable id — kind + record id, so re-running never duplicates. */
  id: string;
  kind: MemoryKind;
  title: string;
  recordKind: string;
  recordId: string;
  href: string;
  explanation: MemoryExplanation;
}

// Deterministic thresholds (days / counts), all explicit and inspectable.
const STALE_DAYS = 90;
const RECENT_DAYS = 14;
const DRIFTED_DAYS = 21;
const ABANDONED_DAYS = 60;
const FORGOTTEN_DAYS = 45;
const RECURRING_MIN = 3;
const FREQUENT_MIN = 5;
const ANNIVERSARY_WINDOW_DAYS = 3;

const STOP = new Set(["about","above","after","again","against","because","before","being","between","could","every","other","should","their","there","these","thing","things","those","through","under","until","where","which","while","would","your","yours","really","actually","something","someone"]);

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w)),
  );
}

function beliefLastTouched(b: StoreState["beliefs"][number]): string {
  const times = [b.updatedAt, ...b.judgments.map((j) => j.at), ...b.revisions.map((r) => r.at)];
  return times.reduce((a, c) => (Date.parse(c) > Date.parse(a) ? c : a), b.createdAt);
}

function refCount(graph: KnowledgeGraph, id: string): { total: number; kinds: Set<string> } {
  const b = backReferences(graph, id);
  const froms = new Set<string>();
  const kinds = new Set<string>();
  for (const bucket of [b.referencedBy, b.usedIn, b.investigatedBy, b.authoredFrom, b.mentionedIn, b.supports, b.contradicts, b.relatedTo]) {
    for (const e of bucket) { froms.add(e.from); kinds.add(e.fromKind); }
  }
  return { total: froms.size, kinds };
}

interface Draft {
  recordKind: string;
  recordId: string;
  title: string;
  href: string;
  order: number;              // primary-kind priority (lower wins)
  primaryKind: MemoryKind;
  triggers: MemoryTrigger[];
  evidence: MemoryRecordRef[];
}

const KIND_ORDER: MemoryKind[] = [
  "not_revisited", "unresolved_tension", "unfinished_dialogue", "abandoned_research",
  "forgotten_decision", "related_to_recent_capture", "recurring_theme", "recurring_concept",
  "frequently_referenced", "anniversary",
];

export function buildLivingMemory(state: StoreState, opts?: { now?: number; generatedAt?: string; graph?: KnowledgeGraph; limit?: number }): MemoryCandidate[] {
  const now = opts?.now ?? Date.now();
  const generatedAt = opts?.generatedAt ?? new Date(now).toISOString();
  const graph = opts?.graph ?? buildGraph(state);
  const drafts = new Map<string, Draft>();

  const touch = (recordKind: string, recordId: string, title: string, href: string, kind: MemoryKind, trigger: MemoryTrigger, evidence: MemoryRecordRef[] = []) => {
    const key = recordId;
    const order = KIND_ORDER.indexOf(kind);
    let d = drafts.get(key);
    if (!d) { d = { recordKind, recordId, title, href, order, primaryKind: kind, triggers: [], evidence: [] }; drafts.set(key, d); }
    if (order < d.order) { d.order = order; d.primaryKind = kind; }
    if (!d.triggers.some((t) => t.rule === trigger.rule)) d.triggers.push(trigger);
    for (const ev of evidence) if (!d.evidence.some((x) => x.id === ev.id && x.note === ev.note)) d.evidence.push(ev);
  };

  const recentCaptures = state.captures.filter((c) => daysSince(c.createdAt, now) <= RECENT_DAYS);

  // Concept vocabulary, split by shape, computed once. Single-word terms match on
  // the ≥5-char token set (as tokens() defines); multi-word terms match on a
  // substring. Precomputing each record's term-set turns the belief×capture
  // relatedness check from an O(beliefs·captures·concepts) scan into a set
  // intersection over the few terms a record actually contains.
  const singleTerms: string[] = [];
  const phraseTerms: string[] = [];
  for (const c of state.concepts) {
    for (const t of [c.name, ...(c.aliases ?? [])].map((x) => x.toLowerCase()).filter((x) => x.length >= 3)) {
      (t.includes(" ") ? phraseTerms : singleTerms).push(t);
    }
  }
  const termsOf = (text: string): Set<string> => {
    const toks = tokens(text);
    const low = text.toLowerCase();
    const set = new Set<string>();
    for (const t of singleTerms) if (toks.has(t)) set.add(t);
    for (const t of phraseTerms) if (low.includes(t)) set.add(t);
    return set;
  };
  const capTermSets = recentCaptures.map((c) => termsOf(c.text));

  // ---- Beliefs: not_revisited (+ related recent captures + related open dialogue) ----
  for (const b of state.beliefs) {
    if (b.status === "rejected") continue;
    const href = "/constitution";
    const self: MemoryRecordRef = { kind: "belief", id: b.id, label: b.text, href };
    const age = daysSince(beliefLastTouched(b), now);
    if (b.status === "accepted" && age >= STALE_DAYS) {
      touch("belief", b.id, b.text, href, "not_revisited", { rule: "not_revisited", label: `last reviewed ${age} days ago` }, [self]);
    }
    // related to recent captures — a capture and this belief mention the same concept term.
    const bTerms = termsOf(b.text);
    const relatedCaps = bTerms.size === 0 ? [] : recentCaptures.filter((_, i) => {
      for (const t of capTermSets[i]) if (bTerms.has(t)) return true;
      return false;
    });
    if (relatedCaps.length > 0 && (age >= DRIFTED_DAYS || b.status === "accepted")) {
      touch("belief", b.id, b.text, href, "related_to_recent_capture",
        { rule: "related_to_recent_capture", label: `connected to ${relatedCaps.length} recent capture${relatedCaps.length === 1 ? "" : "s"}` },
        [self, ...relatedCaps.slice(0, 3).map((c): MemoryRecordRef => ({ kind: "capture", id: c.id, label: c.text, href: "/", note: "recent capture" }))]);
    }
    // an open dialogue still references this belief.
    const openDlg = state.dialogueSessions.find((d) => d.seedRefs.includes(b.id) && (d.status === "open" || d.status === "active" || d.status === "paused"));
    if (openDlg && drafts.has(b.id)) {
      touch("belief", b.id, b.text, href, "not_revisited", { rule: "unresolved_dialogue_exists", label: "an unresolved dialogue still references it" },
        [{ kind: "dialogue", id: openDlg.id, label: openDlg.title, href: `/dialogue/${openDlg.id}`, note: "still open" }]);
    }
  }

  // ---- Concepts: recurring / frequently referenced / recurring theme / not revisited ----
  for (const c of state.concepts) {
    if (c.status === "archived" || c.status === "merged") continue;
    const href = `/themes/${c.id}`;
    const self: MemoryRecordRef = { kind: "concept", id: c.id, label: c.name, href: `/world/concept/${c.id}` };
    const { total, kinds } = refCount(graph, c.id);
    if (total >= FREQUENT_MIN) {
      touch("concept", c.id, c.name, href, "frequently_referenced", { rule: "frequently_referenced", label: `referenced by ${total} records` }, [self]);
    } else if (total >= RECURRING_MIN) {
      touch("concept", c.id, c.name, href, "recurring_concept", { rule: "recurring_concept", label: `recurs across ${total} records` }, [self]);
    }
    if (kinds.size >= RECURRING_MIN) {
      touch("concept", c.id, c.name, href, "recurring_theme", { rule: "recurring_theme", label: `a recurring theme across ${kinds.size} kinds of record` }, [self]);
    }
  }

  // ---- Unfinished dialogues that have drifted ----
  for (const d of state.dialogueSessions) {
    if (!(d.status === "open" || d.status === "active" || d.status === "paused")) continue;
    const age = daysSince(d.updatedAt, now);
    if (age < DRIFTED_DAYS) continue;
    touch("dialogue", d.id, d.title, `/dialogue/${d.id}`, "unfinished_dialogue",
      { rule: "unfinished_dialogue", label: `unfinished dialogue, last touched ${age} days ago` },
      [{ kind: "dialogue", id: d.id, label: d.title, href: `/dialogue/${d.id}` }]);
  }

  // ---- Unresolved tensions ----
  for (const t of state.tensions) {
    if (!(t.status === "open" || t.status === "under_synthesis")) continue;
    const dlg = state.dialogueSessions.find((d) => d.id === t.dialogueId);
    if (!dlg) continue;
    touch("tension", t.id, t.title, `/dialogue/${t.dialogueId}`, "unresolved_tension",
      { rule: "unresolved_tension", label: `unresolved tension still ${t.status.replace(/_/g, " ")}` },
      [{ kind: "tension", id: t.id, label: t.title, href: `/dialogue/${t.dialogueId}` }, { kind: "dialogue", id: dlg.id, label: dlg.title, href: `/dialogue/${dlg.id}`, note: "hosts the tension" }]);
  }

  // ---- Abandoned research ----
  for (const rp of state.researchProjects) {
    if (rp.seededProjectId) continue;
    const age = daysSince(rp.updatedAt, now);
    if (age < ABANDONED_DAYS) continue;
    touch("research_project", rp.id, rp.title, `/research/${rp.id}`, "abandoned_research",
      { rule: "abandoned_research", label: `research untouched for ${age} days` },
      [{ kind: "research_project", id: rp.id, label: rp.title, href: `/research/${rp.id}` }]);
  }

  // ---- Forgotten decisions ----
  for (const d of state.decisions) {
    const age = daysSince(d.updatedAt, now);
    const stalledOpen = (d.status === "exploring" || d.status === "narrowed") && age >= FORGOTTEN_DAYS;
    const unreviewed = d.status === "decided" && d.outcomeReviews.length === 0 && age >= FORGOTTEN_DAYS;
    if (!stalledOpen && !unreviewed) continue;
    touch("decision", d.id, d.title, `/decisions/${d.id}`, "forgotten_decision",
      { rule: "forgotten_decision", label: stalledOpen ? `decision left ${d.status} for ${age} days` : `decided ${age} days ago, never reviewed` },
      [{ kind: "decision", id: d.id, label: d.title, href: `/decisions/${d.id}` }]);
  }

  // ---- Anniversaries (whole years since creation) ----
  const anniversaryOf = (iso: string): number | null => {
    const then = new Date(iso), nd = new Date(now);
    if (Number.isNaN(then.getTime())) return null;
    const years = nd.getFullYear() - then.getFullYear();
    if (years < 1) return null;
    const thisYear = new Date(then); thisYear.setFullYear(then.getFullYear() + years);
    return Math.abs(nd.getTime() - thisYear.getTime()) <= ANNIVERSARY_WINDOW_DAYS * 86400000 ? years : null;
  };
  const anni = (kind: string, id: string, title: string, href: string, iso: string) => {
    const y = anniversaryOf(iso);
    if (y === null) return;
    touch(kind, id, title, href, "anniversary", { rule: "anniversary", label: `${y} year${y === 1 ? "" : "s"} ago today` }, [{ kind, id, label: title, href }]);
  };
  for (const b of state.beliefs) if (b.status !== "rejected") anni("belief", b.id, b.text, "/constitution", b.createdAt);
  for (const c of state.captures) anni("capture", c.id, c.text, "/", c.createdAt);
  for (const d of state.decisions) anni("decision", d.id, d.title, `/decisions/${d.id}`, d.createdAt);

  // ---- Assemble, order, explain ----
  const candidates: MemoryCandidate[] = [...drafts.values()].map((d) => ({
    id: `${d.primaryKind}:${d.recordId}`,
    kind: d.primaryKind,
    title: d.title,
    recordKind: d.recordKind,
    recordId: d.recordId,
    href: d.href,
    explanation: explain({
      triggers: d.triggers,
      evidence: d.evidence,
      // more corroborating reasons → higher confidence, deterministically.
      confidence: levelFromCount(d.triggers.length),
      generatedAt,
    }),
  }));

  // Most-reasons first, then most-recently-relevant primary kind.
  candidates.sort((a, b) => {
    const t = b.explanation.triggers.length - a.explanation.triggers.length;
    if (t !== 0) return t;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  });
  return typeof opts?.limit === "number" ? candidates.slice(0, opts.limit) : candidates;
}
