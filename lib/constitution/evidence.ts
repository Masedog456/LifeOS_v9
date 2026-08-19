/**
 * Constitution in Practice — the evidence projection (LIFEOS-057).
 *
 * Answers one narrow question: **what has Conqify actually recorded about the
 * records this Constitution element is linked to?**
 *
 * It does NOT answer whether the person is living well. It cannot: Conqify sees
 * what was typed into Conqify and nothing else. Every statement this module
 * produces is therefore about *recorded evidence*, never about a life.
 *
 * ## Three rules that govern every line here
 *
 * 1. **Only explicit links count.** Evidence comes from `element.linkedRefs` —
 *    records the user deliberately connected. No text similarity, no keyword
 *    matching, no embeddings, no AI. A statement about family does not silently
 *    acquire evidence because a note mentions "family".
 *
 * 2. **Absence is never inferred into a claim.** Three different situations
 *    produce three different sentences, and they must never collapse:
 *      - no links            → Conqify has nothing it *can* use as evidence
 *      - links, no records   → nothing was recorded here in this period
 *      - links with records  → this is what was recorded
 *    None of them means the person did or did not do anything.
 *
 * 3. **Nothing is persisted.** The projection is recomputed from current state
 *    every time, so it can never present a stale number as current — the same
 *    rule `SavedInsightView` already follows.
 *
 * ## Honest limits of the underlying data
 *
 * `buildActivityIndex` emits timestamped events for actions, documents,
 * sessions, captures and a few knowledge records. It emits **no events at all**
 * for practices, protocols or notes. For those kinds the only recorded facts are
 * the record's own `createdAt` / `updatedAt`, which this module reports as
 * exactly that — "created"/"updated", never as "activity". `EVIDENCE_CAPABILITY`
 * makes the difference explicit and the coverage disclosure states it.
 */

import type { ConstitutionElement, RecordRefLite, StoreState } from "@/types/mvp";
import type { ActivityEvent } from "@/lib/insights/activity";
import { eventsInRange } from "@/lib/insights/activity";
import type { ResolvedRange } from "@/lib/insights/range";
import { previousRange, rangeDays } from "@/lib/insights/range";
import type { KnowledgeGraph } from "@/lib/graph";

/**
 * Does Conqify record timestamped ACTIVITY EVENTS for this kind of record, or
 * only the record's own create/update timestamps?
 *
 * This is a statement about the product's instrumentation, not about the user.
 * A protocol showing no activity means Conqify never watches protocols — which
 * is deliberate (LIFEOS-054) — not that the protocol went unused.
 */
export type EvidenceCapability = "events" | "timestamps_only";

export const EVIDENCE_CAPABILITY: Record<string, EvidenceCapability> = {
  action: "events",
  document: "events",
  project: "events",
  goal: "events",
  note: "timestamps_only",
  practice: "timestamps_only",
  protocol: "timestamps_only",
};

/** Plain labels for the kinds a Constitution element can link to. */
export const EVIDENCE_KIND_LABEL: Record<string, string> = {
  action: "Actions",
  document: "Reading",
  project: "Projects",
  goal: "Goals",
  note: "Notes",
  practice: "Practices",
  protocol: "Protocols",
};

/** One recorded fact, with enough detail to explain itself. */
export interface EvidenceObservation {
  at: string;
  /** Plain-language description of what was recorded. Never interpretive. */
  label: string;
  /** Where this came from: an activity event, or the record's own timestamp. */
  source: "event" | "record_timestamp";
}

/** One linked record, resolved, with whatever was recorded about it in range. */
export interface EvidenceRelation {
  ref: RecordRefLite;
  /** The record's title, or undefined when the link no longer resolves. */
  title?: string;
  /** False when the linked record no longer exists (deleted elsewhere). */
  exists: boolean;
  capability: EvidenceCapability;
  observations: EvidenceObservation[];
  lastAt?: string;
}

export interface EvidenceByKind {
  kind: string;
  label: string;
  links: number;
  observations: number;
  lastAt?: string;
  capability: EvidenceCapability;
}

export interface ConstitutionEvidence {
  elementId: string;
  range: ResolvedRange;
  directRelations: EvidenceRelation[];
  /** Total observations across every linked record, inside the range. */
  recordedActivity: number;
  /** How many linked records recorded anything at all in the range. */
  activeRelations: number;
  evidenceByKind: EvidenceByKind[];
  lastRecordedAt?: string;
  /** The same count over the immediately preceding window of equal length. */
  priorRecordedActivity: number;
  /** What this view can and cannot see. Always shown. */
  coverage: string[];
  /** "Why am I seeing this" — the deterministic rules that produced the above. */
  reasons: string[];
}

// ------------------------------------------------------------- resolution ----

/** Resolve a linked reference to a display title, without copying the record. */
function resolveTitle(state: StoreState, ref: RecordRefLite): string | undefined {
  switch (ref.kind) {
    case "practice": {
      const p = (state.practices ?? []).find((x) => x.id === ref.id);
      return p ? (p.userWording || p.title) : undefined;
    }
    case "protocol": {
      const p = (state.protocols ?? []).find((x) => x.id === ref.id);
      return p ? `When ${p.trigger} → ${p.response}` : undefined;
    }
    case "action": return (state.nextActions ?? []).find((x) => x.id === ref.id)?.title;
    case "project": return (state.projects ?? []).find((x) => x.id === ref.id)?.title;
    case "goal": return (state.goals ?? []).find((x) => x.id === ref.id)?.title;
    case "note": {
      const n = (state.notes ?? []).find((x) => x.id === ref.id);
      return n ? (n.title || n.body.slice(0, 60)) : undefined;
    }
    case "document": return (state.documents ?? []).find((x) => x.id === ref.id)?.title;
    default: return undefined;
  }
}

/** The record's own create/update timestamps, for kinds with no event stream. */
function recordTimestamps(state: StoreState, ref: RecordRefLite): { createdAt?: string; updatedAt?: string } {
  const find = <T extends { id: string; createdAt?: string; updatedAt?: string }>(rows: T[] | undefined) =>
    (rows ?? []).find((x) => x.id === ref.id);
  switch (ref.kind) {
    case "practice": return find(state.practices) ?? {};
    case "protocol": return find(state.protocols) ?? {};
    case "note": return find(state.notes) ?? {};
    case "action": return find(state.nextActions) ?? {};
    case "project": return find(state.projects) ?? {};
    case "goal": return find(state.goals) ?? {};
    case "document": return find(state.documents) ?? {};
    default: return {};
  }
}

/**
 * Plain description of an activity event. Deliberately literal — it says what
 * was recorded, never what it means.
 */
export function describeEvent(e: ActivityEvent): string {
  const map: Record<string, string> = {
    action_created: "Action created",
    action_started: "Action started",
    action_completed: "Action completed",
    action_deferred: "Action deferred",
    action_waiting: "Action moved to waiting",
    action_cancelled: "Action cancelled",
    action_restored: "Action reopened",
    document_opened: "Document opened",
    highlight_created: "Highlight added",
    annotation_created: "Annotation added",
    citation_added: "Citation added",
    focus_started: "Focus session started",
    focus_ended: "Focus session ended",
    session_started: "Session started",
    session_ended: "Session ended",
    planning_planned: "Planned",
    planning_moved: "Moved in planning",
  };
  return map[e.type] ?? e.type.replace(/_/g, " ");
}

// -------------------------------------------------------------- projection ----

export interface EvidenceOptions {
  /** Built ONCE by the caller and shared across every element on a page. */
  index: ActivityEvent[];
  /** Optional; only used to confirm a link still resolves to a real node. */
  graph?: KnowledgeGraph;
}

/**
 * Project one Constitution element against what Conqify recorded in `range`.
 *
 * Pure. Nothing is persisted, nothing is cached, nothing is inferred. The
 * activity index is passed in rather than rebuilt so a page showing thirty
 * elements builds it once (LIFEOS-057 §17).
 */
export function buildConstitutionEvidence(
  state: StoreState,
  element: ConstitutionElement,
  range: ResolvedRange,
  opts: EvidenceOptions,
): ConstitutionEvidence {
  const links = element.linkedRefs ?? [];
  const inRangeEvents = eventsInRange(opts.index, range);
  const prior = previousRange(range);
  const priorEvents = eventsInRange(opts.index, prior);

  const withinRange = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= range.startMs && t < range.endMs;
  };
  const withinPrior = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return !Number.isNaN(t) && t >= prior.startMs && t < prior.endMs;
  };

  const directRelations: EvidenceRelation[] = [];
  let priorRecordedActivity = 0;

  for (const ref of links) {
    const capability = EVIDENCE_CAPABILITY[ref.kind] ?? "timestamps_only";
    const title = resolveTitle(state, ref);
    const observations: EvidenceObservation[] = [];

    if (capability === "events") {
      for (const e of inRangeEvents) {
        // Attribution is either the record itself, or (for a project/goal) an
        // event recorded against something inside it.
        const isSelf = e.recordKind === ref.kind && e.recordId === ref.id;
        const isContained =
          (ref.kind === "project" && e.projectId === ref.id) ||
          (ref.kind === "goal" && e.goalId === ref.id);
        if (!isSelf && !isContained) continue;
        observations.push({ at: e.at, label: describeEvent(e), source: "event" });
      }
      for (const e of priorEvents) {
        const isSelf = e.recordKind === ref.kind && e.recordId === ref.id;
        const isContained =
          (ref.kind === "project" && e.projectId === ref.id) ||
          (ref.kind === "goal" && e.goalId === ref.id);
        if (isSelf || isContained) priorRecordedActivity++;
      }
    }

    // Every kind also has its own create/update timestamps. For kinds with no
    // event stream these are the ONLY recorded facts, and they are reported as
    // exactly what they are.
    const ts = recordTimestamps(state, ref);
    if (capability === "timestamps_only") {
      if (withinRange(ts.createdAt)) observations.push({ at: ts.createdAt!, label: "Created", source: "record_timestamp" });
      if (withinRange(ts.updatedAt) && ts.updatedAt !== ts.createdAt) {
        observations.push({ at: ts.updatedAt!, label: "Updated", source: "record_timestamp" });
      }
      if (withinPrior(ts.createdAt)) priorRecordedActivity++;
      if (withinPrior(ts.updatedAt) && ts.updatedAt !== ts.createdAt) priorRecordedActivity++;
    }

    observations.sort((a, b) => a.at.localeCompare(b.at));
    directRelations.push({
      ref,
      title,
      exists: title !== undefined,
      capability,
      observations,
      lastAt: observations.length ? observations[observations.length - 1].at : undefined,
    });
  }

  // ---- roll up by kind, in a stable order ----
  const kinds = [...new Set(links.map((r) => r.kind))].sort();
  const evidenceByKind: EvidenceByKind[] = kinds.map((kind) => {
    const rows = directRelations.filter((r) => r.ref.kind === kind);
    const observations = rows.reduce((n, r) => n + r.observations.length, 0);
    const lastAt = rows.map((r) => r.lastAt).filter(Boolean).sort().pop();
    return {
      kind,
      label: EVIDENCE_KIND_LABEL[kind] ?? kind,
      links: rows.length,
      observations,
      lastAt,
      capability: EVIDENCE_CAPABILITY[kind] ?? "timestamps_only",
    };
  });

  const recordedActivity = directRelations.reduce((n, r) => n + r.observations.length, 0);
  const activeRelations = directRelations.filter((r) => r.observations.length > 0).length;
  const lastRecordedAt = directRelations.map((r) => r.lastAt).filter(Boolean).sort().pop();

  return {
    elementId: element.id,
    range,
    directRelations,
    recordedActivity,
    activeRelations,
    evidenceByKind,
    lastRecordedAt,
    priorRecordedActivity,
    coverage: buildEvidenceCoverage(directRelations, range),
    reasons: buildEvidenceReasons(element, directRelations, range, recordedActivity),
  };
}

/**
 * Project many elements over ONE shared activity index. This is the entry point
 * a page should use — it guarantees the index is built once regardless of how
 * many elements are shown.
 */
export function buildConstitutionEvidenceMap(
  state: StoreState,
  elements: readonly ConstitutionElement[],
  range: ResolvedRange,
  opts: EvidenceOptions,
): Map<string, ConstitutionEvidence> {
  const out = new Map<string, ConstitutionEvidence>();
  for (const e of elements) out.set(e.id, buildConstitutionEvidence(state, e, range, opts));
  return out;
}

// ---------------------------------------------------------------- coverage ----

/**
 * What this view can and cannot see. Always rendered — an observation without
 * its limits is a claim, and this product does not make claims about a life.
 */
export function buildEvidenceCoverage(
  relations: readonly EvidenceRelation[],
  range: ResolvedRange,
): string[] {
  const out: string[] = [];
  const kinds = [...new Set(relations.map((r) => r.ref.kind))];

  if (kinds.length > 0) {
    const labels = kinds.map((k) => (EVIDENCE_KIND_LABEL[k] ?? k).toLowerCase()).sort();
    out.push(`Based on ${labels.join(", ")} you linked to this element, over ${range.label}.`);
  }

  const timestampOnly = kinds.filter((k) => (EVIDENCE_CAPABILITY[k] ?? "timestamps_only") === "timestamps_only");
  if (timestampOnly.length > 0) {
    const labels = timestampOnly.map((k) => (EVIDENCE_KIND_LABEL[k] ?? k).toLowerCase()).sort();
    out.push(`Conqify does not record ongoing activity for ${labels.join(", ")} — only when the record was created or edited here.`);
  }

  const missing = relations.filter((r) => !r.exists).length;
  if (missing > 0) {
    out.push(`${missing} linked record${missing === 1 ? " is" : "s are"} no longer present, so nothing can be shown for ${missing === 1 ? "it" : "them"}.`);
  }

  // THE governing disclosure. Never omitted.
  out.push("This does not include anything that happened outside Conqify unless it was recorded here.");
  return out;
}

// ----------------------------------------------------------------- reasons ----

/** "Why am I seeing this?" — the deterministic rules, stated plainly. */
export function buildEvidenceReasons(
  element: ConstitutionElement,
  relations: readonly EvidenceRelation[],
  range: ResolvedRange,
  recordedActivity: number,
): string[] {
  const out: string[] = [];
  out.push(`This element: “${element.statement}”.`);
  out.push(`Period shown: ${range.label} (${rangeDays(range)} days).`);
  if (relations.length === 0) {
    out.push("You have not linked any records to this element, so Conqify has nothing it can use as evidence.");
    return out;
  }
  out.push(`Linked records considered: ${relations.length}.`);
  for (const r of relations) {
    const name = r.title ?? "(a record that no longer exists)";
    if (!r.exists) { out.push(`· ${name} — the link remains but the record is gone.`); continue; }
    if (r.observations.length === 0) {
      out.push(`· ${name} — nothing recorded in this period.`);
    } else {
      const first = r.observations[0];
      const last = r.observations[r.observations.length - 1];
      out.push(
        r.observations.length === 1
          ? `· ${name} — ${first.label.toLowerCase()} on ${first.at.slice(0, 10)}.`
          : `· ${name} — ${r.observations.length} entries, ${first.at.slice(0, 10)} to ${last.at.slice(0, 10)}.`,
      );
    }
  }
  out.push(recordedActivity === 0
    ? "Nothing was recorded against these links during this period."
    : `Counted ${recordedActivity} recorded ${recordedActivity === 1 ? "entry" : "entries"} in total.`);
  out.push("Counts come from records you linked yourself. Nothing here is inferred from the wording of your statement.");
  return out;
}
