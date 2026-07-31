/**
 * Landmark & heading model (LIFEOS-041, Feature 29).
 *
 * The semantic landmarks every LifeOS route must expose and the heading rules
 * (exactly one h1 = the route title, no skipped levels). A pure auditor checks a
 * simplified DOM description so the E2E can assert structure deterministically.
 */

export const REQUIRED_LANDMARKS = ["banner", "navigation", "main"] as const;
export type Landmark = (typeof REQUIRED_LANDMARKS)[number] | "complementary" | "contentinfo" | "search";

export interface DomNode { role?: string; tag?: string; level?: number; label?: string }

/** Map an element description to its implicit/explicit landmark role. */
export function landmarkOf(node: DomNode): string | null {
  if (node.role) return node.role;
  switch ((node.tag ?? "").toLowerCase()) {
    case "header": return "banner";
    case "nav": return "navigation";
    case "main": return "main";
    case "aside": return "complementary";
    case "footer": return "contentinfo";
    default: return null;
  }
}

export interface LandmarkAudit { ok: boolean; problems: string[] }

/** Audit a route's node list for required landmarks + heading correctness. */
export function auditLandmarks(nodes: DomNode[]): LandmarkAudit {
  const problems: string[] = [];
  const roles = new Set(nodes.map(landmarkOf).filter(Boolean) as string[]);
  for (const req of REQUIRED_LANDMARKS) if (!roles.has(req)) problems.push(`missing ${req} landmark`);
  const headings = nodes.filter((n) => (n.tag ?? "").match(/^h[1-6]$/i) || n.role === "heading").map((n) => n.level ?? Number((n.tag ?? "h6")[1]));
  const h1s = headings.filter((l) => l === 1).length;
  if (h1s === 0) problems.push("no h1 (route title)");
  if (h1s > 1) problems.push(`multiple h1 (${h1s})`);
  let prev = 0;
  for (const l of headings) { if (prev && l > prev + 1) problems.push(`heading level jumps ${prev}→${l}`); prev = l; }
  return { ok: problems.length === 0, problems };
}

/** A navigation landmark and main must both carry an accessible name when duplicated. */
export function requiresLabel(role: string, count: number): boolean {
  return count > 1 && (role === "navigation" || role === "complementary");
}
