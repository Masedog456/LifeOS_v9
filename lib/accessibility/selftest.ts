/**
 * Accessibility self-tests (LIFEOS-041).
 *
 * Keyboard-shortcut conflicts + text-entry suppression, landmark/heading rules,
 * focus order + trapping + safe initial focus, live-region redaction, target
 * size + naming audit, and confirmation levels/keys.
 */

import { SHORTCUTS, detectConflicts, validateKeyboard, isTextEntry, shouldFire } from "@/lib/accessibility/keyboard";
import { auditLandmarks, landmarkOf } from "@/lib/accessibility/landmarks";
import { focusOrder, nextTrapped, initialFocus, initialFocusIsSafe } from "@/lib/accessibility/focus";
import { auditElement, auditReport, AUDIT_CHECKLIST } from "@/lib/accessibility/audit";
import { confirmForEntity, confirmForLevel, dialogKeys, levelForBehavior } from "@/lib/design/confirmation";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

export function runAccessibilitySelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Keyboard ----
  ok("1.1 no shortcut conflicts", detectConflicts().length === 0, detectConflicts().join(","));
  ok("1.2 keyboard model valid", validateKeyboard().ok, validateKeyboard().problems.join(","));
  ok("1.3 every shortcut has a visible affordance", SHORTCUTS.every((s) => s.visibleAffordance.length > 0));
  ok("1.4 mod+k not reserved conflict", !detectConflicts().some((p) => p.includes("mod+k")));
  ok("1.5 textarea is text entry", isTextEntry({ tagName: "TEXTAREA" }));
  ok("1.6 checkbox is not text entry", !isTextEntry({ tagName: "INPUT", getAttribute: () => "checkbox" }));
  ok("1.7 '/' search suppressed while typing", !shouldFire(SHORTCUTS.find((s) => s.id === "search")!, true));
  ok("1.8 mod+shift+k capture fires even in input", shouldFire(SHORTCUTS.find((s) => s.id === "capture")!, true));

  // ---- 2. Landmarks / headings ----
  ok("2.1 header→banner, nav→navigation, main→main", landmarkOf({ tag: "header" }) === "banner" && landmarkOf({ tag: "nav" }) === "navigation" && landmarkOf({ tag: "main" }) === "main");
  ok("2.2 good route passes", auditLandmarks([{ tag: "header" }, { tag: "nav" }, { tag: "main" }, { tag: "h1", level: 1 }, { tag: "h2", level: 2 }]).ok);
  ok("2.3 missing main flagged", auditLandmarks([{ tag: "header" }, { tag: "nav" }, { tag: "h1", level: 1 }]).problems.some((p) => /main/.test(p)));
  ok("2.4 multiple h1 flagged", auditLandmarks([{ tag: "header" }, { tag: "nav" }, { tag: "main" }, { tag: "h1", level: 1 }, { tag: "h1", level: 1 }]).problems.some((p) => /multiple h1/.test(p)));
  ok("2.5 heading jump flagged", auditLandmarks([{ tag: "header" }, { tag: "nav" }, { tag: "main" }, { tag: "h1", level: 1 }, { tag: "h4", level: 4 }]).problems.some((p) => /jump/.test(p)));

  // ---- 3. Focus ----
  ok("3.1 positive tabindex first", focusOrder([{ id: "a" }, { id: "b", tabindex: 1 }, { id: "c" }])[0] === "b");
  ok("3.2 disabled skipped", !focusOrder([{ id: "a", disabled: true }, { id: "b" }]).includes("a"));
  ok("3.3 trap cycles forward", nextTrapped(["a", "b", "c"], "c") === "a");
  ok("3.4 trap cycles backward", nextTrapped(["a", "b", "c"], "a", true) === "c");
  ok("3.5 initial focus avoids destructive", initialFocus([{ id: "del", destructive: true }, { id: "cancel" }]) === "cancel");
  ok("3.6 initial focus safe check", initialFocusIsSafe([{ id: "del", destructive: true }, { id: "cancel" }]));
  ok("3.7 initial focus unsafe when only destructive+ordering", !initialFocusIsSafe([{ id: "del", destructive: true }]));

  // ---- 4. Audit ----
  ok("4.1 icon-only without name flagged", auditElement({ tag: "button", iconOnly: true }).some((i) => i.rule === "name"));
  ok("4.2 icon-only with name ok", auditElement({ tag: "button", iconOnly: true, accessibleName: "Delete", width: 44, height: 44 }).length === 0);
  ok("4.3 small target flagged", auditElement({ tag: "button", accessibleName: "x", width: 20, height: 20 }).some((i) => i.rule === "target-size"));
  ok("4.4 documented exception exempt", auditElement({ tag: "button", accessibleName: "remove tag", width: 18, height: 18 }, "inline-tag-remove").every((i) => i.rule !== "target-size"));
  ok("4.5 outline:none without replacement flagged", auditElement({ tag: "a", accessibleName: "x", width: 44, height: 44, outlineNone: true }).some((i) => i.rule === "focus"));
  ok("4.6 color-only meaning flagged", auditElement({ tag: "span", colorOnlyMeaning: true }).some((i) => i.rule === "color"));
  ok("4.7 report aggregates", !auditReport([{ el: { tag: "button", iconOnly: true } }]).ok);
  ok("4.8 checklist covers >= 18 items", AUDIT_CHECKLIST.length >= 18);

  // ---- 5. Confirmation ----
  ok("5.1 archive = level 2 with undo, no typed phrase", (() => { const c = confirmForEntity("project"); return c.level === 2 && c.undo && !c.requiresTypedPhrase; })());
  ok("5.2 belief delete (tombstone) = level 3, destructive not pre-focused", (() => { const c = confirmForEntity("belief"); return c.level === 3 && !c.destructivePreFocus; })());
  ok("5.3 account = level 4 typed phrase", confirmForEntity("account").level === 4 && confirmForEntity("account").requiresTypedPhrase);
  ok("5.4 discard reversible level 2 with undo", (() => { const c = confirmForEntity("capture"); return c.level === 2 && c.undo; })());
  ok("5.5 level 3+ Enter does not confirm", !dialogKeys(3).enterConfirms && dialogKeys(3).escapeCancels && dialogKeys(2).enterConfirms);
  ok("5.6 behavior mapping", levelForBehavior("permanent") === 4 && levelForBehavior("archive") === 2);
  ok("5.7 generic level-4 requires phrase", confirmForLevel(4, { title: "t", body: "b", confirmLabel: "Delete" }).requiresTypedPhrase);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
