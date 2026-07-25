/**
 * Command Center event bridge (LIFEOS-027).
 *
 * A tiny decoupling layer so any component (nav search button, Today's quick-
 * capture button, the mobile trigger) can open the palette or quick capture
 * without prop-drilling through the layout. The single CommandCenter listens for
 * these window events. Deterministic, no state library, SSR-safe.
 */

export const OPEN_PALETTE_EVENT = "lifeos:open-palette";
export const OPEN_CAPTURE_EVENT = "lifeos:open-capture";

export function openCommandPalette(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}
export function openQuickCapture(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_CAPTURE_EVENT));
}
