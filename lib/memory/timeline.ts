/**
 * Insight Timeline (LIFEOS-026, Feature 2).
 *
 * A chronological projection of the user's intellectual evolution, generated
 * ONLY from existing records — belief revisions, important captures, accepted
 * syntheses, research milestones, formation milestones, decision outcomes, and
 * dialogue completions. No inference beyond what the records state; every entry
 * carries the evidence it was derived from. Read-only, stores nothing.
 */

import type { StoreState } from "@/types/mvp";
import type { MemoryRecordRef } from "@/lib/memory/explanation";

export type TimelineKind =
  | "belief_formed"
  | "belief_changed"
  | "capture"
  | "synthesis"
  | "research_milestone"
  | "formation_milestone"
  | "decision_outcome"
  | "dialogue_completed";

export interface TimelineEntry {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail: string;
  evidence: MemoryRecordRef[];
}

function snip(s: string, n = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function buildInsightTimeline(state: StoreState, opts?: { limit?: number }): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const push = (id: string, at: string, kind: TimelineKind, title: string, detail: string, evidence: MemoryRecordRef[]) => {
    if (at && !Number.isNaN(Date.parse(at))) out.push({ id, at, kind, title, detail, evidence });
  };

  for (const b of state.beliefs) {
    const href = "/constitution";
    const ev: MemoryRecordRef[] = [{ kind: "belief", id: b.id, label: b.text, href }];
    // Belief formed (first accepted revision, or creation).
    push(`bf:${b.id}`, b.createdAt, "belief_formed", "Belief formed", snip(b.text), ev);
    // Belief changed over time — each rewrite/reaffirmation/questioning after creation.
    for (let i = 0; i < b.revisions.length; i++) {
      const r = b.revisions[i];
      if (r.reason === "proposed") continue;
      push(`br:${b.id}:${i}`, r.at, "belief_changed", `Belief ${r.reason}`, snip(r.text), ev);
    }
  }

  // Important captures — those that seeded a source or a belief (not every stray note).
  const beliefCaptureIds = new Set(state.beliefs.map((b) => b.captureId).filter(Boolean));
  for (const c of state.captures) {
    const important = Boolean(c.sourceId) || beliefCaptureIds.has(c.id);
    if (!important) continue;
    push(`cap:${c.id}`, c.createdAt, "capture", "Important capture", snip(c.text), [{ kind: "capture", id: c.id, label: c.text, href: "/" }]);
  }

  // Major syntheses — accepted only.
  for (const s of state.syntheses) {
    if (s.status !== "accepted") continue;
    push(`syn:${s.id}`, s.updatedAt, "synthesis", "Synthesis accepted", snip(s.statement), [{ kind: "synthesis", id: s.id, label: s.statement, href: `/dialogue/${s.dialogueId}` }]);
  }

  // Research milestones — project created + handed off to authoring.
  for (const rp of state.researchProjects) {
    push(`rp:${rp.id}`, rp.createdAt, "research_milestone", "Research opened", snip(rp.title), [{ kind: "research_project", id: rp.id, label: rp.title, href: `/research/${rp.id}` }]);
    if (rp.seededProjectId) push(`rps:${rp.id}`, rp.updatedAt, "research_milestone", "Research → writing", snip(rp.title), [{ kind: "research_project", id: rp.id, label: rp.title, href: `/research/${rp.id}` }]);
  }

  // Formation milestones.
  for (const f of state.formationSessions) {
    push(`fm:${f.id}`, f.createdAt, "formation_milestone", "Reflection", snip(f.title || f.prompt), [{ kind: "formation", id: f.id, label: f.title || f.prompt, href: "/formation" }]);
  }

  // Decision outcomes.
  for (const d of state.decisions) {
    if (d.status === "decided") push(`dd:${d.id}`, d.updatedAt, "decision_outcome", "Decision made", snip(d.title), [{ kind: "decision", id: d.id, label: d.title, href: `/decisions/${d.id}` }]);
    for (let i = 0; i < d.outcomeReviews.length; i++) {
      const r = d.outcomeReviews[i] as { at?: string };
      if (r?.at) push(`do:${d.id}:${i}`, r.at, "decision_outcome", "Outcome reviewed", snip(d.title), [{ kind: "decision", id: d.id, label: d.title, href: `/decisions/${d.id}` }]);
    }
  }

  // Dialogue completions.
  for (const d of state.dialogueSessions) {
    if (d.status === "concluded") push(`dc:${d.id}`, d.updatedAt, "dialogue_completed", "Dialogue concluded", snip(d.title), [{ kind: "dialogue", id: d.id, label: d.title, href: `/dialogue/${d.id}` }]);
  }

  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first
  return typeof opts?.limit === "number" ? out.slice(0, opts.limit) : out;
}
