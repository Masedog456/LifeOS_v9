/**
 * Living Constitution — pure domain logic (LIFEOS-056).
 *
 * The normative layer of Conqify: **what the user has consciously adopted as
 * part of how they intend to live.** Not a Belief (what is true), not a Practice
 * (what is done), not a Goal (what is wanted), not a Protocol (a conditional
 * intention), and never source authority or AI output.
 *
 * This module creates nothing and mutates nothing — it computes the shapes the
 * store then persists, exactly like `lib/notes/notes.ts`. Every function here is
 * deterministic and offline: there is no AI in this sprint at all.
 *
 * ## The two rules that matter
 *
 * 1. **Adoption is explicit.** `newElement` always produces `status: "draft"`
 *    with no `adoptedAt`. Nothing — not a save, not an import, not a promotion
 *    from a Note or a Reading passage — can produce an adopted element. Only
 *    `adopt()` does, and only a person calls it.
 *
 * 2. **Adoption is not authorship.** Adopting machine prose keeps
 *    `fromAiText: true`; only rewriting the statement in the user's own words
 *    transfers authorship (`lib/provenance/index.ts` states this for text, and
 *    the Constitution inherits it unchanged). A constitutional statement never
 *    gains source-grounding authority by being adopted.
 */

import type {
  ConstitutionElement,
  ConstitutionKind,
  ConstitutionRevision,
  ISO,
  RecordRefLite,
  StoreState,
} from "@/types/mvp";
import { CONSTITUTION_KINDS } from "@/types/mvp";

export { CONSTITUTION_KINDS, CONSTITUTION_KIND_LABEL, CONSTITUTION_KIND_HINT } from "@/types/mvp";

/** Display order — direction first, then conduct. Stable and deliberate. */
export const CONSTITUTION_KIND_ORDER: readonly ConstitutionKind[] = [
  "purpose", "value", "principle", "standard",
];

export function isConstitutionKind(k: string): k is ConstitutionKind {
  return (CONSTITUTION_KINDS as readonly string[]).includes(k);
}

export interface NewElementInput {
  kind: ConstitutionKind;
  statement: string;
  note?: string;
  workspaceId?: string;
  linkedRefs?: RecordRefLite[];
  sourceCaptureId?: string;
  fromAiText?: boolean;
  excludeFromAi?: boolean;
}

/**
 * Normalize a new element. **Always a draft** — this function has no way to
 * produce an adopted element, which is the point.
 */
export function normalizeNewElement(
  input: NewElementInput,
  id: string,
  at: ISO,
): ConstitutionElement {
  return {
    id,
    kind: input.kind,
    statement: (input.statement ?? "").trim(),
    note: input.note?.trim() ? input.note.trim() : undefined,
    status: "draft",
    adoptedAt: undefined,
    retiredAt: undefined,
    supersedesId: undefined,
    workspaceId: input.workspaceId || undefined,
    linkedRefs: dedupeRefs(input.linkedRefs ?? []),
    sourceCaptureId: input.sourceCaptureId || undefined,
    fromAiText: input.fromAiText === true ? true : undefined,
    excludeFromAi: input.excludeFromAi === true ? true : undefined,
    createdAt: at,
    updatedAt: at,
  };
}

/** A statement must carry actual words before it can be adopted. */
export function isAdoptable(el: Pick<ConstitutionElement, "statement" | "status">): boolean {
  return el.statement.trim().length > 0 && el.status !== "active";
}

/** De-duplicate typed references, preserving first-seen order. */
export function dedupeRefs(refs: readonly RecordRefLite[]): RecordRefLite[] {
  const seen = new Set<string>();
  const out: RecordRefLite[] = [];
  for (const r of refs) {
    if (!r || !r.kind || !r.id) continue;
    const k = `${r.kind}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: r.kind, id: r.id });
  }
  return out;
}

export function refsEqual(a: readonly RecordRefLite[], b: readonly RecordRefLite[]): boolean {
  const key = (r: readonly RecordRefLite[]) => r.map((x) => `${x.kind}:${x.id}`).sort().join("|");
  return key(a) === key(b);
}

// ------------------------------------------------------------ projections ----

/**
 * The Constitution itself: adopted, not retired, in kind order then adoption
 * order. Drafts are absent by construction — they are not constitutional.
 */
export function activeConstitution(state: StoreState): ConstitutionElement[] {
  return (state.constitutionElements ?? [])
    .filter((e) => e.status === "active")
    .slice()
    .sort(compareElements);
}

/** Written but not adopted. Shown separately, never counted as constitutional. */
export function draftElements(state: StoreState): ConstitutionElement[] {
  return (state.constitutionElements ?? []).filter((e) => e.status === "draft").slice().sort(compareElements);
}

/** Once adopted, now not. The history is deliberately preserved. */
export function retiredElements(state: StoreState): ConstitutionElement[] {
  return (state.constitutionElements ?? []).filter((e) => e.status === "retired").slice().sort(compareElements);
}

function compareElements(a: ConstitutionElement, b: ConstitutionElement): number {
  const ka = CONSTITUTION_KIND_ORDER.indexOf(a.kind);
  const kb = CONSTITUTION_KIND_ORDER.indexOf(b.kind);
  if (ka !== kb) return ka - kb;
  const aa = a.adoptedAt ?? a.createdAt;
  const bb = b.adoptedAt ?? b.createdAt;
  return aa.localeCompare(bb) || a.id.localeCompare(b.id);
}

export function elementById(state: StoreState, id: string): ConstitutionElement | undefined {
  return (state.constitutionElements ?? []).find((e) => e.id === id);
}

/** An element's history, oldest first. */
export function revisionsFor(state: StoreState, elementId: string): ConstitutionRevision[] {
  return (state.constitutionRevisions ?? [])
    .filter((r) => r.elementId === elementId)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Elements grouped for display, in the fixed kind order. Empty kinds included. */
export function byKind(elements: readonly ConstitutionElement[]): { kind: ConstitutionKind; elements: ConstitutionElement[] }[] {
  return CONSTITUTION_KIND_ORDER.map((kind) => ({
    kind,
    elements: elements.filter((e) => e.kind === kind),
  }));
}

/** The chain of elements this one replaced, newest-first. Cycle-safe. */
export function supersessionChain(state: StoreState, id: string, maxDepth = 32): ConstitutionElement[] {
  const out: ConstitutionElement[] = [];
  const seen = new Set<string>([id]);
  let cur = elementById(state, id)?.supersedesId;
  let depth = 0;
  while (cur && depth < maxDepth) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const el = elementById(state, cur);
    if (!el) break; // the prior element was deleted — the chain honestly ends
    out.push(el);
    cur = el.supersedesId;
    depth++;
  }
  return out;
}

// --------------------------------------------------------------- AI scope ----

/**
 * The elements an AI request may see.
 *
 * Two independent gates, both required:
 *   - the element must be **adopted** (a draft is not a position the user holds)
 *   - the element must not be **excluded** by the user
 *
 * Note what this deliberately does NOT do: nothing in Conqify assembles
 * Constitution content into an AI packet today, and this sprint adds no such
 * path. This function exists so that the first path which ever wants one has an
 * obviously-correct thing to call, rather than reaching into the collection.
 */
export function aiVisibleElements(state: StoreState): ConstitutionElement[] {
  return activeConstitution(state).filter((e) => e.excludeFromAi !== true);
}

/** Is this element withheld from AI? Total, and defaults to visible. */
export function isAiExcluded(el: Pick<ConstitutionElement, "excludeFromAi">): boolean {
  return el.excludeFromAi === true;
}
