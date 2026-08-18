/**
 * Formation timeline (LIFEOS-017, Phase 6).
 *
 * A DERIVED, read-only, chronological record of the user's formation —
 * reflections, belief revisions, decisions and their outcome reviews,
 * inquiries, practice changes, new threads. Built fresh from existing records
 * each render; never stored, never editable, never duplicated (each event has
 * a stable, unique id). Pure and offline.
 */

import type { FormationTimelineItem, StoreState } from "@/types/mvp";

function snippet(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/**
 * Build the full formation timeline, newest first. `limit` caps the result
 * for calm rendering (the whole history is always derivable).
 */
export function buildFormationTimeline(state: StoreState, limit = 200): FormationTimelineItem[] {
  const items: FormationTimelineItem[] = [];

  // Reflection sessions (LIFEOS-017) and standalone reflections (LIFEOS-013).
  for (const s of state.formationSessions) {
    if (!s.reflection.trim()) continue;
    items.push({
      id: `fs:${s.id}`,
      kind: "reflection",
      at: s.createdAt,
      title: s.title,
      detail: snippet(s.reflection),
      href: `/formation/${s.id}`,
    });
  }
  for (const r of state.reflections) {
    items.push({
      id: `refl:${r.id}`,
      kind: "reflection",
      at: r.createdAt,
      title: "Reflection",
      detail: snippet(r.response),
    });
  }

  // Belief revisions — each append-only revision is one dated event.
  for (const b of state.beliefs) {
    for (let i = 0; i < b.revisions.length; i++) {
      const rev = b.revisions[i];
      if (rev.reason === "proposed") continue; // creation isn't a revision event
      items.push({
        id: `rev:${b.id}:${i}`,
        kind: "belief_revision",
        at: rev.at,
        title: `Belief ${rev.reason}`,
        detail: snippet(rev.text),
        href: "/beliefs",
      });
    }
  }

  // Decisions (final choice) + their outcome reviews.
  for (const d of state.decisions) {
    if (d.finalChoice) {
      const chosen = d.options.find((o) => o.id === d.finalChoice)?.name;
      items.push({
        id: `dec:${d.id}`,
        kind: "decision",
        at: d.updatedAt,
        title: `Decided: ${snippet(d.title, 60)}`,
        detail: chosen ? `You chose “${chosen}”.` : undefined,
        href: `/decisions/${d.id}`,
      });
    }
    for (let i = 0; i < d.outcomeReviews.length; i++) {
      const o = d.outcomeReviews[i];
      items.push({
        id: `out:${d.id}:${i}`,
        kind: "outcome_review",
        at: o.at,
        title: `Outcome review: ${snippet(d.title, 50)}`,
        detail: snippet(o.whatHappened),
        href: `/decisions/${d.id}`,
      });
    }
  }

  // Inquiries resolved/updated.
  for (const iq of state.inquiries) {
    if (iq.status === "resolved" || iq.status === "provisional") {
      items.push({
        id: `inq:${iq.id}`,
        kind: "inquiry",
        at: iq.updatedAt,
        title: `Inquiry ${iq.status}`,
        detail: snippet(iq.question),
        href: `/inquiry/${iq.id}`,
      });
    }
  }

  // Practice status changes (accepted / paused / completed).
  for (const p of state.practices) {
    for (let i = 0; i < p.history.length; i++) {
      const h = p.history[i];
      if (h.status === "proposed") continue;
      items.push({
        id: `prac:${p.id}:${i}`,
        kind: "practice_change",
        at: h.at,
        title: `Practice ${h.status}`,
        detail: snippet(p.userWording || p.title),
        href: "/review",
      });
    }
  }

  // New threads.
  for (const t of state.megathreads) {
    items.push({
      id: `thr:${t.id}`,
      kind: "thread_created",
      at: t.createdAt,
      title: `Thread started: ${snippet(t.title, 60)}`,
      href: `/threads/${t.id}`,
    });
  }

  // Chronological (newest first), deduped by id, capped.
  const seen = new Set<string>();
  return items
    .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
