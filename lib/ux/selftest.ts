/**
 * Product-polish UX self-tests (LIFEOS-032).
 *
 * Deterministic assertions for the shared UX engine — dirty-state detection,
 * confirmation impact summaries, toast dedup, backup serialization, restore
 * validation / preview / merge-vs-overwrite / malformed rejection, diagnostics
 * sanitization, and performance budgets over a large fixture. Surfaced at
 * `/dev/ux-tests`, asserted by `ux.mjs`. Pure: no store, no localStorage, no AI.
 */

import type { Prefs } from "@/lib/prefs";
import type { StoreState } from "@/types/mvp";
import { shouldEmit, type Toast } from "@/lib/ux/feedback";
import { isDirty, normalizeText } from "@/lib/ux/dirty-state";
import { buildImpact, impactSummary } from "@/lib/ux/confirmations";
import { exportBackup, backupCounts, serializeBackup, safePrefs, totalRecords, STORE_DOMAINS } from "@/lib/ux/backup";
import { validateBackup, previewRestore, applyRestore } from "@/lib/ux/restore";
import { maskEmail, sanitizeMessage } from "@/lib/ux/diagnostics";
import { budget } from "@/lib/ux/performance";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const iso = (d: number) => new Date(Date.parse("2026-11-01T00:00:00.000Z") - d * 86400000).toISOString();

function emptyState(): StoreState {
  return {
    captures: [], proposals: [], beliefs: [], sources: [], feedback: [], comparisons: [], inquiries: [],
    megathreads: [], reflections: [], practices: [], reviews: [], reasonings: [], embeddings: [], decisions: [],
    formationSessions: [], concepts: [], conceptRelationships: [], principles: [], frameworks: [], knowledgeProjects: [],
    researchProjects: [], dialogueSessions: [], tensions: [], syntheses: [], recommendations: [], documents: [], citations: [], workspaces: [], sessions: [], goals: [], projects: [], dailyReviews: [], nextActions: [], actionDependencies: [], actionTemplates: [], planningAssignments: [], focusSessions: [], maintenanceEvents: [], duplicateCandidates: [], savedInsightViews: [],
    notes: [],
    protocols: [],
  };
}

function fixture(): StoreState {
  const s = emptyState();
  s.beliefs = [{ id: "b1", captureId: "", proposalId: "", text: "Attention is scarce.", theme: "attention", status: "accepted", createdAt: iso(10), updatedAt: iso(5), revisions: [], judgments: [] }];
  s.documents = [{
    id: "doc-1", title: "The Attention Essays", subtitle: "", authors: ["Simone Weil"], kind: "book", status: "reading", tags: [], notes: "",
    sections: [{ id: "sec-1", title: "One", order: 0, passages: [{ id: "p-1", sectionId: "sec-1", text: "Attention is generosity.", order: 0,
      highlights: [{ id: "h-1", passageId: "p-1", color: "yellow", text: "generosity", start: 13, end: 23, linked: [], createdAt: iso(4), updatedAt: iso(4) }],
      annotations: [{ id: "an-1", passageId: "p-1", text: "note", createdAt: iso(3), updatedAt: iso(3) }], linked: [] }] }],
    progress: { status: "reading", percent: 20, readPassageIds: [] }, sourceMetadata: { importFormat: "markdown" }, createdAt: iso(15), updatedAt: iso(6),
  } as StoreState["documents"][number]];
  s.citations = [{ id: "cit-1", recordKind: "belief", recordId: "b1", documentId: "doc-1", documentTitle: "The Attention Essays", author: "Simone Weil", sectionId: "sec-1", passageId: "p-1", createdAt: iso(4) } as StoreState["citations"][number]];
  s.workspaces = [{ id: "ws-1", name: "Thesis", description: "", goals: [], members: [{ kind: "belief", id: "b1" }], pinned: [], resume: {}, archived: false, createdAt: iso(20), updatedAt: iso(2) }];
  s.sessions = [{ id: "ses-1", workspaceId: "ws-1", type: "thinking", goal: "", notes: "", startedAt: iso(2), endedAt: iso(2), activity: [] }];
  s.projects = [{ id: "pr-1", title: "Chapter 1", description: "", status: "active", priority: "high", goalId: "g-1", workspaceId: "ws-1", notes: "",
    milestones: [{ id: "m1", title: "Outline", status: "done", completedDate: iso(3), notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: iso(8), updatedAt: iso(3) }, { id: "m2", title: "Draft", status: "open", notes: "", linkedSessions: [], linkedKnowledge: [], createdAt: iso(7), updatedAt: iso(7) }],
    relatedDocuments: [], relatedEntities: [], createdAt: iso(12), updatedAt: iso(3) }];
  s.goals = [{ id: "g-1", title: "Finish Thesis", description: "", status: "active", priority: "high", notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [{ kind: "belief", id: "b1" }], createdAt: iso(30), updatedAt: iso(2) }];
  return s;
}

const PREFS: Prefs = { onboarding: "done", onboardingStep: 3, recent: [], pinned: [], workspace: { current: "ws-1" }, execution: { currentGoal: "g-1" } };

export function runUxSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });
  const state = fixture();

  // --- Dirty state (Feature 2) ---
  ok("1. isDirty false for equal snapshots", !isDirty({ a: 1, b: "x" }, { b: "x", a: 1 }));
  ok("2. isDirty true when a field changes", isDirty({ a: 1 }, { a: 2 }));
  ok("3. normalizeText ignores trailing whitespace", normalizeText("hello  \n") === "hello" && !isDirty(normalizeText("hi"), normalizeText("hi  ")));

  // --- Toast dedup (Feature 4) ---
  const now = Date.now();
  const existing: Toast[] = [{ id: "t1", kind: "success", message: "Capture created", at: now, duration: 3000, dedupeKey: "success:Capture created" }];
  ok("4. shouldEmit suppresses a rapid duplicate", !shouldEmit(existing, "success:Capture created", now + 500));
  ok("5. shouldEmit allows a repeat after the window", shouldEmit(existing, "success:Capture created", now + 5000));
  ok("6. shouldEmit allows a distinct key", shouldEmit(existing, "error:Sync failed", now + 100));

  // --- Confirmation impact (Feature 3) ---
  const docImpact = buildImpact(state, "document", "doc-1");
  ok("7. document delete is high-impact", docImpact.severity === "high" && !docImpact.undoable);
  ok("8. document impact lists children", docImpact.children.some((c) => c.label === "highlight") && docImpact.children.some((c) => c.label === "passage"));
  ok("9. document impact notes derived records survive", (docImpact.linkedNote ?? "").toLowerCase().includes("kept"));
  const wsImpact = buildImpact(state, "workspace", "ws-1");
  ok("10. workspace delete is high-impact + notes references kept", wsImpact.severity === "high" && (wsImpact.linkedNote ?? "").includes("references"));
  const projImpact = buildImpact(state, "project", "pr-1");
  ok("11. project with milestones is high-impact", projImpact.severity === "high" && projImpact.children.some((c) => c.label === "milestone" && c.count === 2));
  const goalImpact = buildImpact(state, "goal", "g-1");
  ok("12. goal delete notes projects are orphaned not deleted", (goalImpact.linkedNote ?? "").toLowerCase().includes("unlinked") && goalImpact.children.some((c) => c.label === "project"));
  ok("13. belief with a citation is high-impact", buildImpact(state, "belief", "b1").severity === "high");
  ok("14. reset impact is high + names everything", buildImpact(state, "reset", "reset").severity === "high" && buildImpact(state, "reset", "reset").verb === "Reset");
  ok("15. impactSummary reads cleanly", impactSummary(docImpact).startsWith("Delete Document"));

  // --- Backup (Feature 8) ---
  const backup = exportBackup(state, PREFS, { appVersion: "test", now: iso(0) });
  ok("16. backup carries schema version + timestamp", backup.schemaVersion === 1 && backup.exportedAt === iso(0));
  ok("17. backup includes every canonical domain", STORE_DOMAINS.every((d) => d in backup.data));
  const counts = backupCounts(backup.data);
  ok("18. backup counts are accurate", counts.beliefs === 1 && counts.documents === 1 && counts.projects === 1 && counts.goals === 1);
  ok("19. total records counted", totalRecords(counts) >= 6);
  ok("20. safePrefs excludes transient onboardingStep", safePrefs(PREFS).onboardingStep === undefined && safePrefs(PREFS).onboarding === "done");
  ok("21. serialize → parse round-trips", JSON.parse(serializeBackup(backup)).data.beliefs.length === 1);

  // --- Restore validation (Feature 8) ---
  const good = validateBackup(serializeBackup(backup));
  ok("22. valid backup validates ok", good.ok && good.version === 1 && good.counts.beliefs === 1);
  ok("23. non-JSON rejected", !validateBackup("{not json").ok);
  ok("24. missing schemaVersion rejected", !validateBackup(JSON.stringify({ data: {} })).ok);
  ok("25. missing data rejected", !validateBackup(JSON.stringify({ schemaVersion: 1 })).ok);
  ok("26. malformed domain rejected", !validateBackup(JSON.stringify({ schemaVersion: 1, data: { beliefs: "nope" } })).ok);
  const future = validateBackup(JSON.stringify({ schemaVersion: 99, data: { beliefs: [], extraDomain: [] } }));
  ok("27. unknown domains → warning, not error", future.ok && future.incompatibleFields.includes("extraDomain") && future.warnings.length > 0);

  // --- Restore preview + apply (Feature 8) ---
  const current = emptyState();
  current.beliefs = [{ ...state.beliefs[0], id: "b1", text: "OLD wording" }];
  current.captures = [{ id: "cap-x", text: "keep me", createdAt: iso(1) }];
  const prevMerge = previewRestore(current, backup, "merge");
  const prevOver = previewRestore(current, backup, "overwrite");
  ok("28. merge preview keeps non-conflicting current records", prevMerge.domains.find((d) => d.domain === "captures")!.resulting === 1);
  ok("29. overwrite preview replaces a domain", prevOver.domains.find((d) => d.domain === "captures")!.resulting === 0);
  const merged = applyRestore(current, backup, "merge");
  ok("30. merge: incoming wins on id conflict", merged.beliefs.find((b) => b.id === "b1")!.text === "Attention is scarce.");
  ok("31. merge: unrelated current records preserved", merged.captures.some((c) => c.id === "cap-x"));
  const over = applyRestore(current, backup, "overwrite");
  ok("32. overwrite: current-only records dropped", !over.captures.some((c) => c.id === "cap-x"));
  ok("33. restore is pure (current unchanged)", current.beliefs[0].text === "OLD wording");

  // --- Diagnostics sanitization (Feature 7) ---
  ok("34. maskEmail hides the local part", maskEmail("mason@example.com") === "m••••@example.com");
  ok("35. sanitize strips JWT-ish tokens", !sanitizeMessage("failed eyJhbGciOiJIUzI1NiI9 bad").includes("eyJhbGci"));
  ok("36. sanitize strips bearer + api keys", sanitizeMessage("Bearer abc.def.ghi key-ABCDEFGH").includes("«token»") && sanitizeMessage("key-ABCDEFGH").includes("«key»"));

  // --- Performance budgets (Feature 12) ---
  const big = emptyState();
  for (let i = 0; i < 5000; i++) big.captures.push({ id: `c${i}`, text: `capture ${i}`, createdAt: iso(0) });
  for (let i = 0; i < 400; i++) big.beliefs.push({ id: `b${i}`, captureId: "", proposalId: "", text: `belief ${i}`, theme: "t", status: "accepted", createdAt: iso(0), updatedAt: iso(0), revisions: [], judgments: [] });
  const bExport = budget("backup export (5k+400)", 500, () => { serializeBackup(exportBackup(big, PREFS, { now: iso(0) })); });
  ok(`37. backup export under budget (${bExport.ms}ms)`, bExport.pass, `${bExport.ms}ms > ${bExport.budgetMs}ms`);
  const raw = serializeBackup(exportBackup(big, PREFS, { now: iso(0) }));
  const bValidate = budget("restore validate", 500, () => { validateBackup(raw); });
  ok(`38. restore validate under budget (${bValidate.ms}ms)`, bValidate.pass, `${bValidate.ms}ms > ${bValidate.budgetMs}ms`);
  const bCounts = budget("backup counts", 100, () => { backupCounts(big); });
  ok(`39. backup counts under budget (${bCounts.ms}ms)`, bCounts.pass);

  // --- Determinism ---
  ok("40. backup is deterministic given a fixed clock", serializeBackup(exportBackup(state, PREFS, { now: iso(0) })) === serializeBackup(exportBackup(fixture(), PREFS, { now: iso(0) })));

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
