/**
 * Cross-reference engine (LIFEOS-019, Phase 7).
 *
 * While writing, surfaces DETERMINISTIC suggestions — related concepts,
 * missing evidence, contradictions, older drafts, relevant decisions, formation
 * insights, and duplicate paragraphs. Everything is a suggestion the user acts
 * on; NOTHING is inserted automatically. Pure and offline.
 */

import type { CrossRef, DraftSection, KnowledgeProject, StoreState } from "@/types/mvp";
import { assembleEvidence } from "@/lib/authoring/assembly";

function norm(s: string): string {
  return s.trim().toLowerCase();
}
function words(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
}

/** Cross-references for one section within its project. */
export function crossReferences(state: StoreState, project: KnowledgeProject, section: DraftSection): CrossRef[] {
  const out: CrossRef[] = [];
  const sectionText = section.paragraphs.map((p) => p.text).join(" ");
  const sectionWords = words(sectionText);
  const citedIds = new Set(section.paragraphs.flatMap((p) => p.citations));

  // Related concepts: assembled concepts whose name appears in the prose but isn't cited here.
  for (const c of state.concepts) {
    if (!project.assembly.conceptIds.includes(c.id)) continue;
    if (citedIds.has(c.id)) continue;
    if (norm(sectionText).includes(norm(c.name))) {
      out.push({ id: `xr:concept:${section.id}:${c.id}`, kind: "related_concept", title: c.name, detail: "This concept appears in the text but isn't cited here — consider citing it.", refs: [c.id], href: `/world/concept/${c.id}` });
    }
  }

  // Missing evidence: assembled records not cited ANYWHERE in the project yet.
  const usedAnywhere = new Set(project.sections.flatMap((s) => s.paragraphs.flatMap((p) => p.citations)));
  for (const e of assembleEvidence(state, project.assembly)) {
    if (!usedAnywhere.has(e.id)) {
      out.push({ id: `xr:missing:${e.id}`, kind: "missing_evidence", title: e.label, detail: `You assembled this ${e.kind} but haven't cited it anywhere yet.`, refs: [e.id] });
    }
  }

  // Contradictions: cited beliefs currently marked questioned; opposing concepts both cited.
  for (const bId of citedIds) {
    const b = state.beliefs.find((x) => x.id === bId);
    if (b && b.status === "questioned") {
      out.push({ id: `xr:contra:${section.id}:${b.id}`, kind: "contradiction", title: b.text.slice(0, 60), detail: "You're citing a belief you've marked questioned — make sure the section reflects that.", refs: [b.id], href: "/beliefs" });
    }
  }
  const citedConcepts = [...citedIds].map((id) => state.concepts.find((c) => c.id === id)).filter(Boolean) as typeof state.concepts;
  for (const c of citedConcepts) {
    for (const oid of c.opposingConcepts) {
      if (citedIds.has(oid)) {
        const other = state.concepts.find((x) => x.id === oid);
        out.push({ id: `xr:opp:${section.id}:${[c.id, oid].sort().join(":")}`, kind: "contradiction", title: `${c.name} vs ${other?.name ?? "?"}`, detail: "You cite two concepts you've marked as opposing — the section should address the tension.", refs: [c.id, oid] });
      }
    }
  }

  // Older drafts: prior versions of this section.
  if (section.versions.length > 0) {
    out.push({ id: `xr:older:${section.id}`, kind: "older_draft", title: `${section.versions.length} earlier version${section.versions.length === 1 ? "" : "s"}`, detail: "Earlier drafts of this section are kept — compare if you're unsure.", refs: [section.id] });
  }

  // Relevant decisions / formation: assembled but uncited, and lexically related to the section.
  for (const dId of project.assembly.decisionIds) {
    if (usedAnywhere.has(dId)) continue;
    const d = state.decisions.find((x) => x.id === dId);
    if (d && overlap(sectionWords, words(`${d.title} ${d.question}`)) >= 0.15) {
      out.push({ id: `xr:dec:${section.id}:${d.id}`, kind: "relevant_decision", title: d.title, detail: "A decision you assembled seems relevant to this section.", refs: [d.id], href: `/decisions/${d.id}` });
    }
  }
  for (const fId of project.assembly.formationIds) {
    if (usedAnywhere.has(fId)) continue;
    const f = state.formationSessions.find((x) => x.id === fId);
    if (f && overlap(sectionWords, words(f.reflection)) >= 0.15) {
      out.push({ id: `xr:form:${section.id}:${f.id}`, kind: "formation_insight", title: f.title, detail: "A reflection you assembled seems relevant to this section.", refs: [f.id], href: `/formation/${f.id}` });
    }
  }

  // Duplicate paragraphs: near-identical prose elsewhere in the project.
  for (const p of section.paragraphs) {
    const pw = words(p.text);
    if (pw.size < 6) continue;
    for (const other of project.sections) {
      if (other.id === section.id) continue;
      for (const op of other.paragraphs) {
        if (overlap(pw, words(op.text)) >= 0.7) {
          out.push({ id: `xr:dup:${p.id}:${op.id}`, kind: "duplicate_paragraph", title: `Near-duplicate of a paragraph in “${other.heading}”`, detail: "This paragraph closely repeats one elsewhere — consolidate or differentiate.", refs: [p.id, op.id] });
        }
      }
    }
  }

  // De-dup by id, cap for calm.
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, 30);
}
