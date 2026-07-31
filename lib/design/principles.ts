/**
 * Design principles (LIFEOS-041, Feature 2).
 *
 * The ten principles LifeOS's interface is held to. Every major UI change in
 * this sprint is traceable to at least one of these (the `traceable` map records
 * the mapping; a self-test asserts each referenced principle exists). Documented
 * in DESIGN_SYSTEM.md.
 */

export interface Principle { id: string; title: string; detail: string }

export const PRINCIPLES: readonly Principle[] = [
  { id: "P1", title: "Show the next meaningful decision", detail: "Each surface surfaces the one action worth taking now, not every possible action." },
  { id: "P2", title: "Reveal complexity progressively", detail: "Start simple; disclose depth on demand. Nothing dumps its full machinery at once." },
  { id: "P3", title: "Preserve context during navigation", detail: "Moving between records keeps scroll, filters, and selection; opening the inspector never destroys workspace width." },
  { id: "P4", title: "Prefer neutral language", detail: "The product states facts. It does not praise, shame, rank, or judge." },
  { id: "P5", title: "Let records feel connected, not crowded", detail: "Relationships are visible but bounded; density is a tool, not a default." },
  { id: "P6", title: "Keep destructive actions quiet but unmistakable", detail: "No alarm colors for ordinary work; irreversible actions read clearly and are never pre-focused." },
  { id: "P7", title: "Make keyboard and pointer equivalent", detail: "Every pointer affordance has a keyboard/touch equal; nothing is hover-only." },
  { id: "P8", title: "Never use visual intensity as a substitute for hierarchy", detail: "Hierarchy comes from size, space, and weight — not saturation." },
  { id: "P9", title: "Empty space is structural", detail: "Whitespace organizes; the interface is information-rich without being crowded." },
  { id: "P10", title: "The interface does not judge the user", detail: "No streaks, scores, celebration, or guilt. Calm, precise, personal." },
];

export function principle(id: string): Principle | undefined {
  return PRINCIPLES.find((p) => p.id === id);
}

/** Trace major sprint changes to the principles they serve (documentation + test). */
export const TRACEABLE: Record<string, string[]> = {
  "app-shell": ["P3", "P6", "P9"],
  "navigation": ["P1", "P9"],
  "today": ["P1", "P8", "P9"],
  "onboarding": ["P2", "P4", "P10"],
  "empty-states": ["P1", "P9", "P10"],
  "confirmation-model": ["P6"],
  "color-system": ["P4", "P8"],
  "typography": ["P8", "P9"],
  "insights": ["P4", "P8", "P10"],
  "maintenance": ["P4", "P6", "P10"],
  "error-language": ["P4", "P6"],
  "motion": ["P8", "P10"],
  "accessibility": ["P7"],
  "help-center": ["P2"],
};

export function validatePrinciples(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const ids = new Set(PRINCIPLES.map((p) => p.id));
  if (PRINCIPLES.length !== 10) problems.push(`expected 10 principles, found ${PRINCIPLES.length}`);
  for (const [change, refs] of Object.entries(TRACEABLE)) {
    if (!refs.length) problems.push(`${change} traces to no principle`);
    for (const r of refs) if (!ids.has(r)) problems.push(`${change} references unknown ${r}`);
  }
  return { ok: problems.length === 0, problems };
}
