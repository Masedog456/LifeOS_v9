/**
 * Accessibility audit model (LIFEOS-041, Feature 29).
 *
 * A deterministic checklist + pure checks over a simplified DOM description:
 * target size (≥44px where practical), icon-only controls have accessible
 * names, form controls are labelled, focus is never suppressed without
 * replacement, and status is not color-only. We DOCUMENT exceptions rather than
 * hide them.
 *
 * ## What this does NOT do, stated because the header used to imply otherwise
 *
 * `auditElement` has never been pointed at a rendered page. Its only caller is
 * `lib/accessibility/selftest.ts`, which passes four hand-written `ElementDesc`
 * literals — so the ≥44px rule below is a STANDARD, not an enforced gate, and
 * no assertion in the suite can fail because of a real control's size
 * (LIFEOS-074 §2).
 *
 * Measured against the production build at a 390px viewport, the shipped UI is
 * reachable but does not meet that standard everywhere: of 68 interactive
 * controls on Today and 29 on Action detail, four buttons are under 24px — the
 * occurrence "Mark done" (23px), "Delete permanently…" and "Stop repeating"
 * (17px each), and the skip link (16px). All four are on-screen and
 * hit-testable at their centre; none sits behind a horizontal scroll. Closing
 * the gap between the standard and the build is a design decision, not an
 * audit repair, so it is recorded rather than quietly done.
 */

import { MIN_TOUCH_TARGET } from "@/lib/design/tokens";

export interface ElementDesc {
  tag: string;
  role?: string;
  iconOnly?: boolean;
  accessibleName?: string;
  width?: number;
  height?: number;
  isControl?: boolean;
  hasLabel?: boolean;
  outlineNone?: boolean;
  focusVisibleReplacement?: boolean;
  colorOnlyMeaning?: boolean;
  textEquivalent?: boolean;
}

export interface AuditIssue { rule: string; detail: string }

/** Documented exceptions (target size may be smaller for inline dense controls). */
export const TARGET_SIZE_EXCEPTIONS = ["inline-tag-remove", "table-sort-caret"];

export function auditElement(el: ElementDesc, exceptionTag?: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  // Accessible name for icon-only controls.
  if (el.iconOnly && !el.accessibleName) issues.push({ rule: "name", detail: `${el.tag} icon-only control has no accessible name` });
  // Labelled form controls.
  if (el.isControl && !el.hasLabel && !el.accessibleName) issues.push({ rule: "label", detail: `${el.tag} control has no label` });
  // Focus never removed without a visible replacement.
  if (el.outlineNone && !el.focusVisibleReplacement) issues.push({ rule: "focus", detail: `${el.tag} removes outline without a replacement focus style` });
  // Status must not be color-only.
  if (el.colorOnlyMeaning && !el.textEquivalent) issues.push({ rule: "color", detail: `${el.tag} conveys meaning by color alone` });
  // Target size for interactive controls (unless a documented exception).
  if ((el.isControl || el.role === "button" || el.tag === "button" || el.tag === "a") && !TARGET_SIZE_EXCEPTIONS.includes(exceptionTag ?? "")) {
    const w = el.width ?? MIN_TOUCH_TARGET, h = el.height ?? MIN_TOUCH_TARGET;
    if (w < MIN_TOUCH_TARGET || h < MIN_TOUCH_TARGET) issues.push({ rule: "target-size", detail: `${el.tag} is ${w}×${h}, below ${MIN_TOUCH_TARGET}px` });
  }
  return issues;
}

/** The WCAG 2.2 AA checklist LifeOS tracks (documentation + coverage). */
export const AUDIT_CHECKLIST = [
  "semantic landmarks", "one h1 per route", "labels for controls", "descriptions where needed",
  "keyboard reachable", "logical focus order", "focus trapping in dialogs", "skip link",
  "dialog semantics (role=dialog, aria-modal)", "live regions for status", "error association",
  "table semantics", "color contrast AA", "zoom to 200%", "reflow at 320px", "reduced motion",
  "target size ≥44px", "drag alternatives", "screen-reader naming", "status announcements",
] as const;

/** Roll a set of element audits into a report. */
export function auditReport(elements: { el: ElementDesc; exception?: string }[]): { ok: boolean; issues: AuditIssue[] } {
  const issues = elements.flatMap(({ el, exception }) => auditElement(el, exception));
  return { ok: issues.length === 0, issues };
}
