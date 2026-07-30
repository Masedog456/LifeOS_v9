/**
 * Duplicate detection (LIFEOS-038, Feature 2).
 *
 * DETERMINISTIC duplicate CANDIDATES only — never a fuzzy/AI match, never an
 * automatic merge. Records are grouped when they share an exact normalized
 * signal: same title, same normalized title, same URL, same ISBN / DOI /
 * external identifier, or a manually-chosen shared alias. Each group gets a
 * STABLE id (hash of reason + sorted member keys) so the same duplicate found
 * on two devices resolves to one decision record. The user always chooses.
 */

import type { StoreState, DuplicateCandidate, DuplicateReason, RecordRefLite } from "@/types/mvp";
import { normKey } from "@/lib/dedup";
import { hashText } from "@/lib/hash";
import { refKey, type MaintenanceIndex } from "@/lib/maintenance/integrity";

const REASON_LABEL: Record<DuplicateReason, string> = {
  same_title: "Same title",
  same_normalized_title: "Same normalized title",
  same_url: "Same URL",
  same_citation: "Same citation",
  same_isbn: "Same ISBN",
  same_doi: "Same DOI",
  same_identifier: "Same external identifier",
  alias: "Shared alias",
};
export { REASON_LABEL as DUPLICATE_REASON_LABEL };

/** Stable candidate id: independent of member order and run. */
export function duplicateId(reason: DuplicateReason, members: RecordRefLite[]): string {
  const keys = members.map(refKey).sort();
  return `dup_${hashText(`${reason}::${keys.join("|")}`)}`;
}

/** Extract a normalized ISBN/DOI/identifier from a provenance string, if present. */
function extractIdentifier(raw: string | undefined): { kind: "isbn" | "doi" | "identifier"; value: string } | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const isbn = s.match(/\b(?:isbn[:\s]*)?((?:97[89][- ]?)?\d(?:[- ]?\d){8,11}[\dxX])\b/i);
  if (isbn) { const v = isbn[1].replace(/[- ]/g, "").toLowerCase(); if (v.length === 10 || v.length === 13) return { kind: "isbn", value: v }; }
  const doi = s.match(/\b(10\.\d{4,9}\/[-._;()/:a-z0-9]+)\b/i);
  if (doi) return { kind: "doi", value: doi[1].toLowerCase() };
  return undefined;
}

/** Normalize a URL for equality (strip scheme/trailing slash/query fragment noise). */
function normUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (!/^https?:\/\//.test(s) && !s.includes("/") ) return undefined;
  return s.replace(/^https?:\/\//, "").replace(/[#?].*$/, "").replace(/\/+$/, "");
}

interface Bucket { reason: DuplicateReason; kind: string; key: string; members: RecordRefLite[] }

function collect(buckets: Map<string, Bucket>, reason: DuplicateReason, kind: string, key: string | undefined, ref: RecordRefLite) {
  if (!key) return;
  const bk = `${reason}::${kind}::${key}`;
  const b = buckets.get(bk) ?? { reason, kind, key, members: [] };
  b.members.push(ref);
  buckets.set(bk, b);
}

/**
 * All open duplicate candidates, derived deterministically. Groups the user has
 * already decided on (ignored / merged, per `index.decidedDuplicateIds`) are
 * suppressed. Sorted by reason then key for a stable order.
 */
export function duplicateCandidates(state: StoreState, index: MaintenanceIndex): DuplicateCandidate[] {
  const buckets = new Map<string, Bucket>();

  // Documents: exact title, normalized title, url, isbn/doi.
  for (const d of state.documents ?? []) {
    const ref: RecordRefLite = { kind: "document", id: d.id };
    collect(buckets, "same_title", "document", d.title?.trim() || undefined, ref);
    collect(buckets, "same_normalized_title", "document", normKey(d.title || "") || undefined, ref);
    const prov = d.sourceMetadata?.importedFrom;
    collect(buckets, "same_url", "document", normUrl(prov), ref);
    const idf = extractIdentifier(prov);
    if (idf?.kind === "isbn") collect(buckets, "same_isbn", "document", idf.value, ref);
    else if (idf?.kind === "doi") collect(buckets, "same_doi", "document", idf.value, ref);
    else if (idf) collect(buckets, "same_identifier", "document", idf.value, ref);
  }

  // Sources: title, url/origin, isbn/doi.
  for (const s of state.sources ?? []) {
    const ref: RecordRefLite = { kind: "source", id: s.id };
    collect(buckets, "same_normalized_title", "source", normKey(s.title || "") || undefined, ref);
    collect(buckets, "same_url", "source", normUrl(s.origin), ref);
    const idf = extractIdentifier(s.origin);
    if (idf?.kind === "isbn") collect(buckets, "same_isbn", "source", idf.value, ref);
    else if (idf?.kind === "doi") collect(buckets, "same_doi", "source", idf.value, ref);
  }

  // Beliefs: same normalized text.
  for (const b of state.beliefs ?? []) collect(buckets, "same_normalized_title", "belief", normKey(b.text || "") || undefined, { kind: "belief", id: b.id });

  // Concepts: same normalized name, and shared aliases.
  for (const c of state.concepts ?? []) {
    const ref: RecordRefLite = { kind: "concept", id: c.id };
    collect(buckets, "same_normalized_title", "concept", normKey(c.name || "") || undefined, ref);
    for (const a of c.aliases ?? []) collect(buckets, "alias", "concept", normKey(a) || undefined, ref);
  }

  // Research projects: same normalized title / question.
  for (const r of state.researchProjects ?? []) {
    const ref: RecordRefLite = { kind: "research_project", id: r.id };
    collect(buckets, "same_normalized_title", "research_project", normKey(r.title || r.question || "") || undefined, ref);
  }

  const out: DuplicateCandidate[] = [];
  for (const b of buckets.values()) {
    if (b.members.length < 2) continue;
    // Dedup member refs (a record can't duplicate itself within one bucket).
    const seen = new Set<string>();
    const members = b.members.filter((m) => { const k = refKey(m); if (seen.has(k)) return false; seen.add(k); return true; });
    if (members.length < 2) continue;
    const idv = duplicateId(b.reason, members);
    if (index.decidedDuplicateIds.has(idv)) continue; // already ignored/merged
    out.push({ id: idv, reason: b.reason, kind: b.kind, members, key: b.key, status: "open", createdAt: "", updatedAt: "", history: [] });
  }
  return out.sort((a, b) => a.reason.localeCompare(b.reason) || a.key.localeCompare(b.key));
}

/** Count of open duplicate candidates (dashboard headline). */
export function duplicateCount(state: StoreState, index: MaintenanceIndex): number {
  return duplicateCandidates(state, index).length;
}
