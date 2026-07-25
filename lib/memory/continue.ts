/**
 * Continue Thinking (LIFEOS-026, Feature 5).
 *
 * A deterministic projection of every open thread of thought the user can pick
 * back up: unfinished dialogues, unfinished research, unresolved tensions,
 * pending belief reviews, pending (candidate) syntheses, and stale decisions.
 * Read-only; each item links to the record itself and states why it's here.
 */

import type { StoreState } from "@/types/mvp";
import { daysSince } from "@/lib/memory/explanation";

export type ContinueKind =
  | "dialogue" | "research" | "tension" | "belief_review" | "synthesis" | "decision";

export interface ContinueItem {
  id: string;
  kind: ContinueKind;
  title: string;
  reason: string;
  href: string;
  at: string;
}

const STALE_BELIEF_DAYS = 90;
const STALE_DECISION_DAYS = 30;

export function buildContinueThinking(state: StoreState, opts?: { now?: number }): ContinueItem[] {
  const now = opts?.now ?? Date.now();
  const out: ContinueItem[] = [];

  for (const d of state.dialogueSessions) {
    if (d.status === "open" || d.status === "active" || d.status === "paused")
      out.push({ id: `dlg:${d.id}`, kind: "dialogue", title: d.title, reason: `dialogue ${d.status}`, href: `/dialogue/${d.id}`, at: d.updatedAt });
  }
  for (const rp of state.researchProjects) {
    if (!rp.seededProjectId)
      out.push({ id: `rp:${rp.id}`, kind: "research", title: rp.title, reason: "research in progress", href: `/research/${rp.id}`, at: rp.updatedAt });
  }
  for (const t of state.tensions) {
    if (t.status === "open" || t.status === "under_synthesis")
      out.push({ id: `t:${t.id}`, kind: "tension", title: t.title, reason: `tension ${t.status.replace(/_/g, " ")}`, href: `/dialogue/${t.dialogueId}`, at: t.updatedAt });
  }
  for (const b of state.beliefs) {
    if (b.status === "accepted" && daysSince(b.updatedAt, now) >= STALE_BELIEF_DAYS)
      out.push({ id: `b:${b.id}`, kind: "belief_review", title: b.text, reason: `unreviewed ${daysSince(b.updatedAt, now)} days`, href: "/constitution", at: b.updatedAt });
    if (b.status === "questioned")
      out.push({ id: `bq:${b.id}`, kind: "belief_review", title: b.text, reason: "you flagged it as questioned", href: "/constitution", at: b.updatedAt });
  }
  for (const s of state.syntheses) {
    if (s.status === "candidate")
      out.push({ id: `s:${s.id}`, kind: "synthesis", title: s.statement, reason: "candidate synthesis — accept, revise, or reject", href: `/dialogue/${s.dialogueId}`, at: s.updatedAt });
  }
  for (const d of state.decisions) {
    const age = daysSince(d.updatedAt, now);
    if ((d.status === "exploring" || d.status === "narrowed") && age >= STALE_DECISION_DAYS)
      out.push({ id: `d:${d.id}`, kind: "decision", title: d.title, reason: `decision ${d.status} for ${age} days`, href: `/decisions/${d.id}`, at: d.updatedAt });
    if (d.status === "decided" && d.outcomeReviews.length === 0 && age >= STALE_DECISION_DAYS)
      out.push({ id: `dr:${d.id}`, kind: "decision", title: d.title, reason: "decided but never outcome-reviewed", href: `/decisions/${d.id}`, at: d.updatedAt });
  }

  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out;
}
