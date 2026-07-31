/**
 * Density model (LIFEOS-041, Features 3 + 35).
 *
 * Three bounded density levels adjust control heights and row padding — a
 * restrained personalization (Feature 35), never a behavioral or layout redesign.
 * The chosen density is a UI preference (prefs.ui.density) that syncs but never
 * touches domain content.
 */
import { CONTROL_HEIGHT } from "@/lib/design/tokens";

export type Density = "compact" | "comfortable" | "spacious";
export const DENSITIES: Density[] = ["compact", "comfortable", "spacious"];
export const DEFAULT_DENSITY: Density = "comfortable";

export interface DensitySpec { controlHeightRem: number; rowPaddingRem: number; gapRem: number }

export function densitySpec(d: Density): DensitySpec {
  switch (d) {
    case "compact": return { controlHeightRem: CONTROL_HEIGHT.compact, rowPaddingRem: 0.375, gapRem: 0.5 };
    case "spacious": return { controlHeightRem: CONTROL_HEIGHT.spacious, rowPaddingRem: 0.875, gapRem: 1 };
    default: return { controlHeightRem: CONTROL_HEIGHT.comfortable, rowPaddingRem: 0.625, gapRem: 0.75 };
  }
}

export function isDensity(v: unknown): v is Density {
  return typeof v === "string" && (DENSITIES as string[]).includes(v);
}
