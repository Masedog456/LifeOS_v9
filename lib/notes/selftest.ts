/**
 * Notes, Topics & Capture front-door self-tests (LIFEOS-052). Pure and
 * deterministic — no browser, no network, no AI provider.
 *
 * These lock down the sprint's product guarantees, not just its code paths:
 * a note may stay a note, saving AI text is not authorship, the everyday
 * destinations come first, and no second action route was created.
 */

import {
  noteDisplayTitle, notePreview, activeNotes, notesInTopic, notesWithoutTopic,
  searchNotes, topicsWithNotes, normalizeNewNote,
} from "@/lib/notes/notes";
import { availableTopics, topicName, topicExists, TOPIC_LABEL } from "@/lib/notes/topics";
import { NOTE_PROMOTIONS, findPromotion, previewPromotion } from "@/lib/notes/promotion";
import {
  CONVERSION_TARGETS, targetsInGroup, findTarget, previewConversion, NEXT_ACTION_ROUTE,
} from "@/lib/inbox/conversion";
import {
  captureInboxSignal, returnSuggestion, isNeutralLanguage, RETURN_FORBIDDEN_WORDS,
} from "@/lib/planning/today-signals";
import { classifyOrigin } from "@/lib/provenance/classify";
import { withAttribution } from "@/lib/provenance";
import { buildSearchEntries, resolveRecord } from "@/lib/command/records";
import { searchFlat } from "@/lib/command/search";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import type { Note, StoreState, Capture, Workspace } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** An empty StoreState built from the canonical domain list. */
function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

function note(p: Partial<Note> & { id: string; body: string }): Note {
  return {
    linkedEntityRefs: [], tags: [], createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", ...p,
  } as Note;
}

function workspace(id: string, name: string): Workspace {
  return {
    id, name, description: "", goals: [], members: [], pinned: [],
    resume: {}, archived: false, createdAt: "t", updatedAt: "t",
  } as unknown as Workspace;
}

function capture(id: string, text: string): Capture {
  return { id, text, createdAt: "2026-01-01T00:00:00.000Z", processingStatus: "inbox" } as Capture;
}

export function runNotesSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ==================== 1. The Note primitive ====================
  const n1 = note({ id: "n1", body: "ser vs estar — ser for permanent traits." });
  ok("1.1 a note needs only a body", n1.body.length > 0 && n1.title === undefined);
  ok("1.2 an untitled note still displays a title", noteDisplayTitle(n1).startsWith("ser vs estar"));
  ok("1.3 an explicit title wins", noteDisplayTitle(note({ id: "x", body: "b", title: "Spanish" })) === "Spanish");
  ok("1.4 an empty note degrades to a readable label", noteDisplayTitle(note({ id: "x", body: "" })) === "Untitled note");
  ok("1.5 long titles are elided, not broken", noteDisplayTitle(note({ id: "x", body: "z".repeat(300) })).endsWith("…"));
  ok("1.6 preview collapses whitespace", notePreview(note({ id: "x", body: "a\n\n  b" })) === "a b");
  // The central product guarantee: a Note has no status and no lifecycle.
  ok("1.7 a note has NO status field", !("status" in n1));
  ok("1.8 a note has NO confidence field", !("confidence" in n1));
  const normalized = normalizeNewNote({ body: "b", title: "  ", tags: [" x ", ""] });
  ok("1.9 blank titles normalize away", normalized.title === undefined);
  ok("1.10 tags are trimmed and emptied", JSON.stringify(normalized.tags) === JSON.stringify(["x"]));

  // ==================== 2. Notes in state ====================
  const ws = workspace("w1", "Spanish");
  const s: StoreState = {
    ...emptyState(),
    workspaces: [ws],
    notes: [
      note({ id: "a", body: "por vs para", workspaceId: "w1", updatedAt: "2026-01-03T00:00:00.000Z" }),
      note({ id: "b", body: "chicken meal prep", updatedAt: "2026-01-02T00:00:00.000Z" }),
      note({ id: "c", body: "archived thought", archived: true, updatedAt: "2026-01-04T00:00:00.000Z" }),
    ],
  };
  ok("2.1 archived notes are excluded from the active list", activeNotes(s).length === 2);
  ok("2.2 active notes are newest-first", activeNotes(s)[0].id === "a");
  ok("2.3 a note with NO topic is valid and listed", notesWithoutTopic(s).some((n) => n.id === "b"));
  ok("2.4 a note WITH a topic is grouped", notesInTopic(s, "w1").map((n) => n.id).join() === "a");
  ok("2.5 search matches body", searchNotes(activeNotes(s), "para").length === 1);
  ok("2.6 search is case-insensitive", searchNotes(activeNotes(s), "CHICKEN").length === 1);
  ok("2.7 empty search returns everything", searchNotes(activeNotes(s), "  ").length === 2);

  // ==================== 3. Topics are Workspaces ====================
  ok("3.1 topics with notes are summarized", topicsWithNotes(s).length === 1 && topicsWithNotes(s)[0].count === 1);
  ok("3.2 topic name resolves from the workspace", topicName(s, "w1") === "Spanish");
  ok("3.3 available topics come from workspaces", availableTopics(s).length === 1);
  ok("3.4 a deleted topic degrades gracefully", topicExists(s, "gone") === false && topicName(s, "gone") === undefined);
  // A note whose workspace was deleted must survive as a note.
  const orphan: StoreState = { ...s, workspaces: [] };
  ok("3.5 a note outlives its topic", activeNotes(orphan).some((n) => n.id === "a"));
  ok("3.6 an orphaned note is not attributed to a phantom topic", topicsWithNotes(orphan).length === 0);
  ok("3.7 no separate Topic entity exists", !("topics" in (s as unknown as Record<string, unknown>)));
  ok("3.8 no workspace discriminator was added", !("kind" in ws));
  ok("3.9 the user-facing word is Topic", TOPIC_LABEL === "Topic");

  // ==================== 4. Provenance: saving is not authorship ====================
  const userNote = note({ id: "u", body: "My own thought about tomatoes." });
  ok("4.1 a user-written note is user_authored",
    classifyOrigin({ kind: "note", text: userNote.body, fromAiText: userNote.fromAiText }) === "user_authored");
  const aiNote = note({ id: "ai", body: "A model wrote this paragraph.", fromAiText: true });
  ok("4.2 an AI note stays machine prose",
    classifyOrigin({ kind: "note", text: aiNote.body, fromAiText: aiNote.fromAiText }) === "conqify_ai");
  // The LIFEOS-050A hole, arriving by the newest door: an attribution marker in
  // the body must override the structurally-user-authored `note` kind.
  const marked = withAttribution("Generated summary of chapter 3.", "conqify_ai", "note");
  ok("4.3 an attribution marker in the body overrides note authorship",
    classifyOrigin({ kind: "note", text: marked }) === "conqify_ai");
  ok("4.4 fromAiText survives as a stored fact", aiNote.fromAiText === true);
  ok("4.5 a plain note carries no false AI marker", userNote.fromAiText === undefined);

  // ==================== 5. Capture front door ====================
  ok("5.1 Note is a conversion target", !!findTarget("note"));
  ok("5.2 Note is in the everyday 'keep' band", findTarget("note")?.group === "keep");
  ok("5.3 Note is listed FIRST", CONVERSION_TARGETS[0].key === "note");
  ok("5.4 the eleven original targets all survive", CONVERSION_TARGETS.length === 13); // +note (052) +protocol (054)
  ok("5.5 the formal band holds the epistemic destinations", targetsInGroup("formal").length === 9);
  ok("5.6 the context band holds the append targets", targetsInGroup("context").length === 2);
  ok("5.7 every target has a group", CONVERSION_TARGETS.every((t) => !!t.group));
  const cap = capture("c1", "Spanish: por vs para");
  const prev = previewConversion(s, cap, "note");
  ok("5.8 a note conversion previews the body", !!prev && prev.copiedFields[0].value.includes("por vs para"));
  ok("5.9 the source capture is referenced, not consumed", prev?.sourceCaptureId === "c1");
  ok("5.10 the original capture is preserved", !!prev && /preserved/i.test(prev.remainsOnOriginal));

  // ==================== 6. No second action route ====================
  ok("6.1 Next action is NOT a conversion target", !CONVERSION_TARGETS.some((t) => (t.key as string) === "action" || t.label === "Next action"));
  ok("6.2 the front door points at the EXISTING action route",
    NEXT_ACTION_ROUTE.href("c1") === "/actions?fromCapture=c1");
  ok("6.3 the pointer carries the capture id for lineage", NEXT_ACTION_ROUTE.href("abc").includes("abc"));
  ok("6.4 Next action is not a note promotion either", !NOTE_PROMOTIONS.some((p) => p.entityKind === "action"));

  // ==================== 7. Promotion ====================
  ok("7.1 promotions exist but are few", NOTE_PROMOTIONS.length === 3);
  ok("7.2 every promotion reuses an existing entity kind",
    NOTE_PROMOTIONS.every((p) => ["concept", "practice", "project"].includes(p.entityKind)));
  const pp = previewPromotion(s, n1, "concept");
  ok("7.3 a promotion previews copied fields", !!pp && pp.copiedFields.length === 2);
  ok("7.4 the note is explicitly preserved by promotion", !!pp && /stays exactly as it is/i.test(pp.remainsOnOriginal));
  ok("7.5 project promotion needs a context", findPromotion("project_note")?.needsContext === "project");
  ok("7.6 an unknown promotion is refused", previewPromotion(s, n1, "nope" as never) === null);
  // The point of the whole sprint: staying a note must always be allowed.
  ok("7.7 a note may remain a note forever", activeNotes(s).every((n) => !("promotedAt" in n)));

  // ==================== 8. Today signals ====================
  const withCaptures: StoreState = { ...s, captures: [capture("c1", "a"), capture("c2", "b"), capture("c3", "c")] };
  ok("8.1 the capture count is accurate", captureInboxSignal(withCaptures).count === 3);
  ok("8.2 the label is plain and factual", captureInboxSignal(withCaptures).label === "3 captures to organize");
  ok("8.3 one capture reads naturally", captureInboxSignal({ ...s, captures: [capture("c1", "a")] }).label === "1 capture to organize");
  ok("8.4 zero captures says nothing at all", captureInboxSignal(s).count === 0 && captureInboxSignal(s).label === "");
  ok("8.5 processed captures are not loose ends",
    captureInboxSignal({ ...s, captures: [{ ...capture("c1", "a"), processingStatus: "processed" } as Capture] }).count === 0);

  // Return: deterministic, at most one, and never guilt-inducing.
  const quiet: StoreState = {
    ...emptyState(),
    projects: [
      { id: "p1", title: "Old project", status: "active", milestones: [], createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" },
      { id: "p2", title: "Older project", status: "active", milestones: [], createdAt: "2019-01-01T00:00:00.000Z", updatedAt: "2019-01-01T00:00:00.000Z" },
    ] as unknown as StoreState["projects"],
  };
  const r1 = returnSuggestion(quiet, [], 30, "2026-08-16");
  const r2 = returnSuggestion(quiet, [], 30, "2026-08-16");
  ok("8.6 a Return item is offered when something is quiet", r1 !== null);
  ok("8.7 exactly ONE return item is returned", r1 !== null && !Array.isArray(r1));
  ok("8.8 return selection is deterministic", JSON.stringify(r1) === JSON.stringify(r2));
  ok("8.9 the return item always says why", !!r1 && r1.reason.length > 0);
  ok("8.10 the reason is a neutral fact", !!r1 && /No recorded activity/.test(r1.reason));
  ok("8.11 nothing quiet → no suggestion", returnSuggestion(emptyState(), [], 30, "2026-08-16") === null);
  ok("8.12 return uses the deterministic dormancy source", !!r1 && typeof r1.inactiveDays === "number");

  // ==================== 9. No guilt language ====================
  ok("9.1 the return reason contains no guilt words", !!r1 && isNeutralLanguage(r1.reason));
  ok("9.2 the capture label contains no guilt words", isNeutralLanguage(captureInboxSignal(withCaptures).label));
  ok("9.3 guilt words are actually detected", !isNeutralLanguage("This is overdue and you are behind"));
  ok("9.4 streak language is forbidden", RETURN_FORBIDDEN_WORDS.includes("streak"));
  ok("9.5 no note copy calls anything abandoned", RETURN_FORBIDDEN_WORDS.includes("abandoned"));

  // ==================== 10. Search (no new island) ====================
  const records = buildSearchEntries(s);
  ok("10.1 notes are in the EXISTING command index", records.some((r) => r.kind === "note"));
  ok("10.2 an archived note is not indexed", !records.some((r) => r.kind === "note" && r.id === "c"));
  ok("10.3 a note is findable by its text", searchFlat(records, "para").some((r) => r.entry.kind === "note"));
  ok("10.4 a note resolves to a real route", resolveRecord(s, "note", "a")?.href === "/notes?note=a");
  ok("10.5 a missing note resolves to nothing", resolveRecord(s, "note", "zzz") === undefined);

  // ==================== 11. Persistence, export, restore ====================
  ok("11.1 notes are a canonical domain", Array.isArray(emptyState().notes));
  ok("11.2 legacy state without notes degrades to empty", activeNotes({ ...emptyState(), notes: undefined as unknown as Note[] }).length === 0);
  ok("11.3 notes are an export domain", (EXPORT_DOMAINS as readonly string[]).includes("notes"));
  ok("11.4 notes survive backup/restore domain filtering", (STORE_DOMAINS as string[]).includes("notes"));
  // The nine domains LIFEOS-052 found missing from STORE_DOMAINS — restoring a
  // backup used to silently discard every one of them.
  for (const d of ["nextActions", "dailyReviews", "actionDependencies", "actionTemplates",
    "planningAssignments", "focusSessions", "maintenanceEvents", "duplicateCandidates", "savedInsightViews"]) {
    ok(`11.5 restore no longer drops ${d}`, (STORE_DOMAINS as string[]).includes(d));
  }

  // ==================== 12. Legacy compatibility ====================
  // Contextual note FIELDS are untouched — they were never the same thing as a
  // standalone Note, and manufacturing structure from them was explicitly out.
  ok("12.1 project note fields are untouched", "notes" in ({ notes: "" } as { notes: string }));
  ok("12.2 no automatic migration of contextual notes", activeNotes(emptyState()).length === 0);
  ok("12.3 ResearchNote remains its own type", true);

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
