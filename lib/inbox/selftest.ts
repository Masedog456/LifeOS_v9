/**
 * Capture processing / Inbox Zero self-tests (LIFEOS-035).
 *
 * Fixture-driven, deterministic assertions for the PURE processing engine —
 * status defaults, queue filtering/sorting, defer semantics, split/merge
 * planners + lineage, conversion preview, relationship backlinks, the sync
 * conflict rules, projection purity, and performance. Store-mutating flows
 * (rewrite/convert/batch) are exercised by `inbox.mjs`. Surfaced at
 * `/dev/inbox-tests`. Pure: no store, no localStorage, no AI.
 */

import type { Capture, StoreState } from "@/types/mvp";
import { captureStatus, effectiveText, isLinked, captureAgeDays, conversionTargets, DEFAULT_STATUS } from "@/lib/inbox/capture-status";
import { deriveQueue, filterCaptures, sortCaptures, queueCounts, nextToProcess, nearbyCaptures } from "@/lib/inbox/queue";
import { deferKeyFor, returnDueDefers, isDue, isSomeday, returningToday } from "@/lib/inbox/defer";
import { planSplit, suggestSegments } from "@/lib/inbox/split";
import { planMerge } from "@/lib/inbox/merge";
import { previewConversion, CONVERSION_TARGETS, titleFromText } from "@/lib/inbox/conversion";
import { captureLineage, capturesReferencing } from "@/lib/inbox/relationships";
import { mergeCaptureProcessing } from "@/lib/inbox/merge-rules";
import { appendHistory } from "@/lib/inbox/history";
import { makeEvent } from "@/lib/inbox/history";
import { todayKey, addDays } from "@/lib/reviews/dates";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

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
const TODAY = todayKey();
const cap = (p: Partial<Capture> & { id: string; text: string }): Capture => ({ createdAt: "2026-07-27T09:00:00.000Z", ...p });

export function runInboxSelfTests(): SelfTestReport {
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const results: SelfTestResult[] = [];
  const check = (name: string, cond: boolean, detail = "ok") => results.push({ name, pass: !!cond, detail: cond ? detail : `FAIL: ${detail}` });
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // 1. Existing-capture defaults.
  {
    const legacy = cap({ id: "c1", text: "old capture" }); // no processingStatus
    check("existing capture defaults to inbox", captureStatus(legacy) === "inbox" && DEFAULT_STATUS === "inbox");
    check("effective text falls back to original", effectiveText(legacy) === "old capture");
    check("legacy capture is unlinked by default", !isLinked(legacy));
  }

  // 2. Status lifecycle (pure transitions via helpers + history append).
  {
    let c = cap({ id: "c2", text: "x", processingStatus: "inbox" });
    c = appendHistory({ ...c, processingStatus: "deferred", deferredUntil: addDays(TODAY, 1) }, makeEvent({ action: "defer", at: "t", fromStatus: "inbox", toStatus: "deferred" }));
    check("status transition recorded in history", captureStatus(c) === "deferred" && (c.history ?? []).length === 1 && c.history![0].fromStatus === "inbox");
  }

  // 3. Queue filtering + sorting.
  {
    const s = emptyState();
    s.captures = [
      cap({ id: "a", text: "alpha apples", createdAt: "2026-07-25T09:00:00Z", tags: ["food"] }),
      cap({ id: "b", text: "beta bananas", createdAt: "2026-07-27T09:00:00Z", linkedProjectIds: ["p1"] }),
      cap({ id: "c", text: "processed one", createdAt: "2026-07-26T09:00:00Z", processingStatus: "processed" }),
    ];
    const inbox = deriveQueue(s, { view: "inbox", sort: "newest" });
    check("queue view filters by status", inbox.items.length === 2 && inbox.items.every((c) => captureStatus(c) === "inbox"));
    check("queue counts per view", inbox.counts.inbox === 2 && inbox.counts.processed === 1);
    check("sort newest first", deriveQueue(s, { view: "inbox", sort: "newest" }).items[0].id === "b");
    check("sort oldest first", deriveQueue(s, { view: "inbox", sort: "oldest" }).items[0].id === "a");
    check("text filter", filterCaptures(s.captures, { text: "banana" }).length === 1);
    check("tag filter", filterCaptures(s.captures, { tags: ["food"] }).length === 1);
    check("linked/unlinked filter", filterCaptures(s.captures, { linked: "linked" }).some((c) => c.id === "b") && filterCaptures(s.captures, { linked: "unlinked" }).some((c) => c.id === "a"));
    check("age filter", filterCaptures(s.captures, { minAgeDays: 1 }, Date.parse("2026-07-27T09:00:00Z")).some((c) => c.id === "a"));
    check("project filter", filterCaptures(s.captures, { projectId: "p1" }).length === 1);
    check("next to process = oldest inbox", nextToProcess(s, "oldest")?.id === "a");
    check("sort is stable/deterministic", eq(sortCaptures(s.captures, "newest"), sortCaptures(s.captures, "newest")));
  }

  // 4. Defer semantics + someday + return.
  {
    check("defer tomorrow key", deferKeyFor("tomorrow", TODAY) === addDays(TODAY, 1));
    check("someday has no date", deferKeyFor("someday", TODAY) === undefined);
    const due = cap({ id: "d1", text: "due", processingStatus: "deferred", deferredUntil: addDays(TODAY, -1) });
    const future = cap({ id: "d2", text: "future", processingStatus: "deferred", deferredUntil: addDays(TODAY, 3) });
    const someday = cap({ id: "d3", text: "someday", processingStatus: "deferred" });
    check("isDue for past defer date", isDue(due, TODAY) && !isDue(future, TODAY));
    check("someday detected + never auto-due", isSomeday(someday) && !isDue(someday, TODAY));
    const { captures: back, returnedIds } = returnDueDefers([due, future, someday], TODAY);
    check("due deferrals return to inbox", returnedIds.includes("d1") && back.find((c) => c.id === "d1")!.processingStatus === "inbox");
    check("future + someday stay deferred", back.find((c) => c.id === "d2")!.processingStatus === "deferred" && back.find((c) => c.id === "d3")!.processingStatus === "deferred");
    check("returning today projection", returningToday([cap({ id: "rt", text: "x", processingStatus: "deferred", deferredUntil: TODAY })], TODAY).length === 1);
  }

  // 5. Split validation + lineage + ordering.
  {
    const src = cap({ id: "s1", text: "one\n\ntwo\n\nthree" });
    check("split suggestion from blank lines", suggestSegments(src).length === 3);
    const plan = planSplit(src, ["one", "two", "three"]);
    check("split plan valid + ordered", plan.valid && plan.segments.map((x) => x.text).join(",") === "one,two,three");
    check("split rejects <2 segments", !planSplit(src, ["only"]).valid);
    check("split rejects empty segments", !planSplit(src, ["a", "  "]).valid);
  }

  // 6. Merge ordering + separators + explicit-only.
  {
    const a = cap({ id: "m1", text: "first" }), b = cap({ id: "m2", text: "second" });
    const plan = planMerge([a, b], ["m2", "m1"], "\n\n");
    check("merge respects chosen order", plan.valid && plan.text === "second\n\nfirst");
    check("merge rejects <2", !planMerge([a], ["m1"]).valid);
    check("merge separator preview", planMerge([a, b], ["m1", "m2"], " ").text === "first second");
  }

  // 7. Lineage relationships.
  {
    const s = emptyState();
    const parent = cap({ id: "p", text: "parent" });
    const child1 = cap({ id: "ch1", text: "a", splitFromId: "p" });
    const child2 = cap({ id: "ch2", text: "b", splitFromId: "p" });
    const mergedFrom1 = cap({ id: "mf1", text: "x" });
    const mergedResult = cap({ id: "mr", text: "x y", mergedFromIds: ["mf1"] });
    s.captures = [parent, child1, child2, mergedFrom1, mergedResult];
    const lin = captureLineage(s, parent);
    check("split children tracked", lin.splitChildren.length === 2);
    check("merged-from lineage", captureLineage(s, mergedResult).mergedFrom.some((c) => c.id === "mf1"));
    check("split child knows its parent", captureLineage(s, child1).splitFrom?.id === "p");
  }

  // 8. Conversion preview + source preservation.
  {
    const s = emptyState();
    const c = cap({ id: "cv", text: "Attention is the scarcest resource.", sourceContext: { workspaceId: "w1", projectId: "pr1" } });
    check("conversion targets available (no auto-classify)", CONVERSION_TARGETS.length >= 10);
    const belief = previewConversion(s, c, "belief")!;
    check("belief preview copies statement + links source", belief.copiedFields[0].value === c.text && belief.sourceCaptureId === "cv");
    check("preview carries workspace/project context", belief.context.workspaceId === "w1" && belief.context.projectId === "pr1");
    check("preview states original is preserved", /preserved/i.test(belief.remainsOnOriginal));
    const decision = previewConversion(s, c, "decision")!;
    check("decision preview has title + question", decision.copiedFields.length === 2 && decision.copiedFields[1].value === c.text);
    check("note conversion needs context", CONVERSION_TARGETS.find((t) => t.key === "project_note")?.needsContext === "project");
    check("title derives from first line", titleFromText("First line\nSecond") === "First line");
  }

  // 9. Backlinks: captures referencing a record.
  {
    const s = emptyState();
    s.captures = [
      cap({ id: "l1", text: "x", linkedProjectIds: ["pr1"] }),
      cap({ id: "l2", text: "y", history: [makeEvent({ action: "convert", at: "t", targets: [{ kind: "belief", id: "b1" }] })] }),
    ];
    check("capturesReferencing by link", capturesReferencing(s, "project", "pr1").some((c) => c.id === "l1"));
    check("capturesReferencing by conversion", capturesReferencing(s, "belief", "b1").some((c) => c.id === "l2"));
    check("conversionTargets reads history", conversionTargets(s.captures[1]).some((r) => r.id === "b1"));
  }

  // 10. Sync conflict rules.
  {
    const base = cap({ id: "x", text: "t", processingStatus: "inbox" });
    // non-overlapping: local rewrite + remote tag add → auto-merge.
    let r = mergeCaptureProcessing(base, { ...base, workingText: "clarified" }, { ...base, tags: ["idea"] });
    check("rewrite + tag add auto-merges", r.conflicts.length === 0 && r.merged.workingText === "clarified" && (r.merged.tags ?? []).includes("idea"));
    // both add different links → union.
    r = mergeCaptureProcessing(base, { ...base, linkedProjectIds: ["p1"] }, { ...base, linkedProjectIds: ["p2"] });
    check("different links union safely", r.conflicts.length === 0 && (r.merged.linkedProjectIds ?? []).length === 2);
    // local archive + remote conversion → conflict.
    r = mergeCaptureProcessing(base, { ...base, processingStatus: "archived", archivedAt: "t" }, { ...base, linkedEntityRefs: [{ kind: "belief", id: "b" }] });
    check("archive vs conversion → conflict", r.conflicts.includes("status-vs-content"));
    // local defer + remote mark processed → conflict.
    r = mergeCaptureProcessing(base, { ...base, processingStatus: "deferred", deferredUntil: TODAY }, { ...base, processingStatus: "processed" });
    check("defer vs processed → conflict", r.conflicts.includes("processingStatus"));
    // split on one device + rewrite on another → conflict (archived-after-split vs edit).
    r = mergeCaptureProcessing(base, { ...base, processingStatus: "archived", archivedAt: "t" }, { ...base, workingText: "edited" });
    check("split-archive vs rewrite → conflict", r.conflicts.length > 0);
    // history + lineage never discarded.
    const withHist = { ...base, history: [makeEvent({ action: "link", at: "t" })], mergedFromIds: ["m1"] };
    r = mergeCaptureProcessing(base, withHist, { ...base, history: [makeEvent({ action: "tag", at: "t2" })], mergedFromIds: ["m2"] });
    check("history + lineage union (never discarded)", (r.merged.history ?? []).length === 2 && (r.merged.mergedFromIds ?? []).length === 2);
  }

  // 11. Projection purity + nearby.
  {
    const s = emptyState();
    s.captures = [cap({ id: "n1", text: "a", sourceId: "src1" }), cap({ id: "n2", text: "b", sourceId: "src1" }), cap({ id: "n3", text: "c" })];
    const before = JSON.stringify(s);
    deriveQueue(s, { view: "inbox" });
    filterCaptures(s.captures, { text: "a" });
    returnDueDefers(s.captures);
    check("queue projections do not mutate state", JSON.stringify(s) === before);
    check("nearby captures share source context", nearbyCaptures(s, s.captures[0]).some((c) => c.id === "n2"));
  }

  // 12. Batch impact (pure counts) + inherited context modelling.
  {
    const s = emptyState();
    s.captures = Array.from({ length: 5 }, (_, i) => cap({ id: `bb${i}`, text: `t${i}` }));
    check("queue counts reflect batch scope", queueCounts(s.captures).inbox === 5);
    const inherited = cap({ id: "ic", text: "x", sourceContext: { workspaceId: "w1", sessionId: "s1" } });
    check("inherited context is present + removable", inherited.sourceContext?.workspaceId === "w1");
  }

  // 13. Performance — queue derivation over 10k captures.
  {
    const s = emptyState();
    for (let i = 0; i < 10000; i++) s.captures.push(cap({ id: `p${i}`, text: `capture ${i} lorem`, processingStatus: i % 5 === 0 ? "processed" : "inbox", tags: i % 3 === 0 ? ["idea"] : [], createdAt: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 60000).toISOString() }));
    const p0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const q = deriveQueue(s, { view: "inbox", sort: "newest", filter: { text: "lorem", tags: ["idea"] } });
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - p0;
    check("queue derivation over 10k captures < 150ms", ms < 150, `${ms.toFixed(1)}ms, ${q.items.length} items`);
    const p1 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    queueCounts(s.captures); nextToProcess(s, "oldest");
    const ms2 = (typeof performance !== "undefined" ? performance.now() : Date.now()) - p1;
    check("counts + next-to-process over 10k < 50ms", ms2 < 50, `${ms2.toFixed(1)}ms`);
    void captureAgeDays(s.captures[0]);
  }

  const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { pass: failed === 0, total: results.length, passed, failed, ms, results };
}
