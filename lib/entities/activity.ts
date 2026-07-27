/**
 * Entity activity (LIFEOS-029, Feature 4).
 *
 * A deterministic, chronological history for any entity — creation, edits,
 * belief revisions/judgments, highlights, annotations, knowledge conversions,
 * reading progress, decision activity, dialogue turns/conclusions, synthesis
 * revisions — derived from the records themselves (append-only histories where
 * they exist). No new storage, no AI. Newest-first by default.
 */

import type { EntityContext } from "@/lib/entities/entity";

export type ActivityKind =
  | "created" | "updated" | "revised" | "judged" | "highlight" | "annotation"
  | "conversion" | "reading" | "decision" | "turn" | "concluded";

export interface ActivityEvent {
  at: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
}

const snip = (s: string, n = 70): string => { const t = (s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const valid = (at: string | undefined): at is string => Boolean(at) && !Number.isNaN(Date.parse(at as string));

/** Every activity event for an entity, newest-first (deterministic, stable). */
export function entityActivity(ctx: EntityContext, kind: string, id: string): ActivityEvent[] {
  const { state } = ctx;
  const out: ActivityEvent[] = [];
  const push = (at: string | undefined, k: ActivityKind, label: string, detail?: string) => { if (valid(at)) out.push({ at, kind: k, label, detail }); };

  switch (kind) {
    case "belief": {
      const b = state.beliefs.find((x) => x.id === id);
      if (b) {
        push(b.createdAt, "created", "Belief formed");
        b.revisions.forEach((r) => { if (r.reason !== "proposed") push(r.at, "revised", `Belief ${r.reason}`, snip(r.text)); });
        b.judgments.forEach((j) => push(j.at, "judged", `Judged: ${j.decision}`, j.note ? snip(j.note) : undefined));
      }
      break;
    }
    case "document": {
      const d = state.documents.find((x) => x.id === id);
      if (d) {
        push(d.createdAt, "created", "Document imported");
        for (const s of d.sections) for (const p of s.passages) {
          for (const h of p.highlights) push(h.createdAt, "highlight", "Highlight added", snip(h.text));
          for (const a of p.annotations) push(a.createdAt, "annotation", "Note added", snip(a.text));
          for (const l of p.linked) push(d.updatedAt, "conversion", `Converted to ${l.kind}`);
        }
        if (d.progress.startedAt) push(d.progress.startedAt, "reading", "Started reading");
        if (d.progress.finishedAt) push(d.progress.finishedAt, "reading", "Finished reading");
        push(d.updatedAt, "updated", "Document updated");
      }
      break;
    }
    case "passage": case "highlight": {
      for (const d of state.documents) for (const s of d.sections) for (const p of s.passages) {
        if (kind === "passage" && p.id === id) {
          for (const h of p.highlights) push(h.createdAt, "highlight", "Highlight added", snip(h.text));
          for (const a of p.annotations) push(a.createdAt, "annotation", "Note added", snip(a.text));
          for (const l of p.linked) push(d.updatedAt, "conversion", `Converted to ${l.kind}`);
        }
        if (kind === "highlight") for (const h of p.highlights) if (h.id === id) { push(h.createdAt, "highlight", "Highlight added", snip(h.text)); push(h.updatedAt, "updated", "Highlight updated"); }
      }
      break;
    }
    case "decision": {
      const d = state.decisions.find((x) => x.id === id);
      if (d) {
        push(d.createdAt, "created", "Decision opened");
        (d.revisions ?? []).forEach((r) => push(r.at, "decision", "Revised", snip(r.note)));
        (d.outcomeReviews ?? []).forEach((r) => push((r as { at?: string }).at, "decision", "Outcome reviewed"));
        if (d.status === "decided") push(d.updatedAt, "decision", "Decision made");
      }
      break;
    }
    case "dialogue": {
      const d = state.dialogueSessions.find((x) => x.id === id);
      if (d) {
        push(d.createdAt, "created", "Dialogue opened");
        d.turns.forEach((t) => push(t.createdAt, "turn", `${t.kind} turn`, snip(t.text)));
        if (d.status === "concluded") push(d.updatedAt, "concluded", "Dialogue concluded");
      }
      break;
    }
    case "synthesis": {
      const s = state.syntheses.find((x) => x.id === id);
      if (s) { push(s.createdAt, "created", "Synthesis drafted"); s.revisions.forEach((r) => push(r.at, "revised", "Revised", snip(r.statement))); if (s.status === "accepted") push(s.updatedAt, "updated", "Accepted"); }
      break;
    }
    default: {
      // Generic: creation + last update from the entity's own timestamps.
      const e = describeGeneric(ctx, kind, id);
      push(e.createdAt, "created", "Created");
      if (e.updatedAt && e.updatedAt !== e.createdAt) push(e.updatedAt, "updated", "Updated");
    }
  }

  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out;
}

function describeGeneric(ctx: EntityContext, kind: string, id: string): { createdAt?: string; updatedAt?: string } {
  // Avoid a circular import: read timestamps via a light lookup mirroring entity.ts.
  const s = ctx.state;
  const find = <T extends { id: string }>(arr: T[]) => arr.find((x) => x.id === id);
  switch (kind) {
    case "capture": return { createdAt: find(s.captures)?.createdAt };
    case "concept": case "theme": { const c = find(s.concepts); return { createdAt: c?.createdAt, updatedAt: c?.updatedAt }; }
    case "research_project": { const r = find(s.researchProjects); return { createdAt: r?.createdAt, updatedAt: r?.updatedAt }; }
    case "tension": { const t = find(s.tensions); return { createdAt: t?.createdAt, updatedAt: t?.updatedAt }; }
    case "inquiry": { const i = find(s.inquiries); return { createdAt: i?.createdAt, updatedAt: i?.updatedAt }; }
    case "formation": { const f = find(s.formationSessions); return { createdAt: f?.createdAt, updatedAt: f?.updatedAt }; }
    case "source": { const x = find(s.sources); return { createdAt: x?.addedAt }; }
    default: return {};
  }
}
