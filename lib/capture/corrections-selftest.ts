/**
 * LIFEOS-097 — what can be put right, asserted.
 *
 * The MODEL is asserted here — which corrections apply, which are honestly not
 * offered, and which records an undo may touch. The setters themselves are
 * asserted in the browser, against the real store, because the sprint's claim
 * is that corrections reuse canonical operations and a fake ops object would be
 * asserting that claim about itself.
 */

import type { StoreState, RecordRefLite as RefLite } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import {
  buildCaptureCorrection, correctableOutcome, createdBy, undoableRefs, keptRefs,
  outcomeStillStands, currentValue, correctionStrings, asDayKey,
  NO_TYPE_CONVERSION, NO_WAITING_OBJECT, UNDOABLE_KINDS,
} from "@/lib/capture/corrections";
import { interpret } from "@/lib/capture/interpret";
import { cleanCandidateTitle } from "@/lib/capture/titles";

const T = "2026-09-06";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

const act = (p: Record<string, unknown>) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"), ...p,
}) as unknown as StoreState["nextActions"][number];

/**
 * A capture that created a wait, an action and a note, plus an action it only
 * MATCHED — the record undo must never touch.
 */
function world(): StoreState {
  const s = emptyStoreState();
  s.projects = [
    { id: "p-clinic", title: "Clinic launch", description: "", status: "active", priority: "medium",
      notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
    { id: "p-apps", title: "Graduate applications", description: "", status: "active", priority: "high",
      notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
  ] as StoreState["projects"];
  s.goals = [{
    id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as StoreState["goals"];
  s.nextActions = [
    act({ id: "a-wait", title: "Transcript from Maria", status: "waiting", waitingOn: "Maria",
      waitingSince: D("2026-09-02"), followUpDate: "2026-09-11", sourceCaptureId: "c1" }),
    act({ id: "a-do", title: "Call the dentist", dueDate: "2026-09-07", dueTime: "14:00",
      projectId: "p-clinic", sourceCaptureId: "c1" }),
    // Pre-existing. The capture matched it; it did not make it.
    act({ id: "a-old", title: "Send the recommendation request", projectId: "p-apps" }),
  ] as StoreState["nextActions"];
  s.notes = [{ id: "n1", title: "", body: "The lease expires Friday", createdAt: D(T), updatedAt: D(T),
    tags: [], linkedEntityRefs: [], sourceCaptureId: "c1" }] as StoreState["notes"];
  s.captures = [{
    id: "c1", text: "I'm waiting on Maria for the transcript and call the dentist",
    createdAt: D(T, 10), processingStatus: "processed", processedAt: D(T, 10),
    linkedEntityRefs: [
      { kind: "action", id: "a-wait" }, { kind: "action", id: "a-do" },
      { kind: "note", id: "n1" }, { kind: "action", id: "a-old" },
    ],
  }] as StoreState["captures"];
  return s;
}

export function runCaptureCorrectionSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  const s = world();

  // ---- §40, §4. The model ------------------------------------------------
  {
    const c = buildCaptureCorrection(s, "c1")!;
    ok("97.1 §4 the correction carries the sentence, verbatim",
      c.source === "I'm waiting on Maria for the transcript and call the dentist", c.source);
    ok("97.2 §21 one entry per record the capture is linked to",
      c.outcomes.length === 4, c.outcomes.map((o) => `${o.label}:${o.title}`).join(" | "));
    ok("97.3 §21 …each named for itself",
      c.outcomes.map((o) => o.title).join(" | ")
        === "Transcript from Maria | Call the dentist | The lease expires Friday | Send the recommendation request",
      c.outcomes.map((o) => o.title).join(" | "));
    ok("97.4 §19 …and only the ones this capture made are undoable",
      c.outcomes.filter((o) => o.createdByCapture).map((o) => o.id).join(",") === "a-wait,a-do,n1",
      c.outcomes.map((o) => `${o.id}:${o.createdByCapture}`).join(" "));
  }

  // ---- §6. Only the fields that record has -------------------------------
  {
    const wait = correctableOutcome(s, { kind: "action", id: "a-wait" } as RefLite, { createdByCapture: true })!;
    const names = wait.fields.map((f) => f.field);
    ok("97.5 §6 a wait is asked about the person and the follow-up day",
      names.includes("waitingOn") && names.includes("dueDate"), names.join(","));
    ok("97.6 §9 …and never about a clock time, which a follow-up has no room for",
      !names.includes("dueTime"), names.join(","));
    ok("97.7 §6 …with the values the store holds now",
      wait.fields.find((f) => f.field === "waitingOn")?.value === "Maria"
      && wait.fields.find((f) => f.field === "dueDate")?.value === "2026-09-11",
      JSON.stringify(wait.fields));
    ok("97.8 §16 a wait's label is Waiting, not Action", wait.label === "Waiting", wait.label);

    const doit = correctableOutcome(s, { kind: "action", id: "a-do" } as RefLite, { createdByCapture: true })!;
    ok("97.9 §6 an ordinary action is asked about a date and a time",
      doit.fields.map((f) => f.field).join(",") === "title,dueDate,dueTime,project,goal",
      doit.fields.map((f) => f.field).join(","));
    ok("97.10 §10 …and shows the Project it is actually on",
      doit.fields.find((f) => f.field === "project")?.value === "Clinic launch",
      String(doit.fields.find((f) => f.field === "project")?.value));
  }
  {
    // A time with no day is a value the store refuses, so the control is not
    // offered — an affordance that cannot save is worse than none.
    const s2 = world();
    s2.nextActions = [act({ id: "a-nodate", title: "Email the registrar", sourceCaptureId: "c1" })] as StoreState["nextActions"];
    const o = correctableOutcome(s2, { kind: "action", id: "a-nodate" } as RefLite, { createdByCapture: true })!;
    ok("97.11 §9 an action with no date is not offered a time",
      !o.fields.some((f) => f.field === "dueTime"), o.fields.map((f) => f.field).join(","));
  }

  // ---- §17, §18. What is honestly not offered ----------------------------
  {
    const wait = correctableOutcome(s, { kind: "action", id: "a-wait" } as RefLite, { createdByCapture: true })!;
    ok("97.12 §17 record-type conversion is declared unsupported, not omitted",
      wait.unsupported.some((u) => u.id === NO_TYPE_CONVERSION.id),
      wait.unsupported.map((u) => u.id).join(","));
    ok("97.13 §17 …and the reason names the cost, not an apology",
      /history and links/i.test(NO_TYPE_CONVERSION.reason), NO_TYPE_CONVERSION.reason);
    ok("97.14 §13 a wait says why the object is not a field",
      wait.unsupported.some((u) => u.id === NO_WAITING_OBJECT.id)
      && /part of the title/i.test(NO_WAITING_OBJECT.reason), NO_WAITING_OBJECT.reason);
    const doit = correctableOutcome(s, { kind: "action", id: "a-do" } as RefLite, { createdByCapture: true })!;
    ok("97.15 §13 …and an ordinary action does not, having no waiting object",
      !doit.unsupported.some((u) => u.id === NO_WAITING_OBJECT.id),
      doit.unsupported.map((u) => u.id).join(","));
  }
  {
    // A domain with its own editing rules gets its own page rather than a sheet
    // that half works — LIFEOS-096 §33's principle, one layer up.
    const s3 = world();
    s3.decisions = [{ id: "d1", title: "Choose graduate program", question: "q", status: "exploring",
      options: [], criteria: [], createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["decisions"];
    ok("97.16 §33 a domain with no safe sheet returns none rather than a broken one",
      correctableOutcome(s3, { kind: "decision", id: "d1" } as RefLite, { createdByCapture: true }) === null);
  }

  // ---- §19, §20. Undo removes only what the capture created --------------
  {
    const undoable = undoableRefs(s, "c1").map((r) => r.id);
    ok("97.17 §19 undo covers the records this capture made",
      undoable.join(",") === "a-wait,a-do,n1", undoable.join(","));
    ok("97.18 §20 …and never the record it merely matched",
      !undoable.includes("a-old"), undoable.join(","));
    ok("97.19 §20 …which is decided by the record's own sourceCaptureId",
      createdBy(s, { kind: "action", id: "a-old" } as RefLite, "c1") === false
      && createdBy(s, { kind: "action", id: "a-do" } as RefLite, "c1") === true, "");
    ok("97.20 §20 …and the matched record is reported as kept",
      keptRefs(s, "c1").map((r) => r.id).join(",") === "a-old",
      keptRefs(s, "c1").map((r) => r.id).join(","));
  }
  {
    // A record created by a DIFFERENT capture is not this capture's to remove,
    // even though both are linked to it.
    const s4 = world();
    s4.nextActions = (s4.nextActions ?? []).map((a) =>
      a.id === "a-do" ? { ...a, sourceCaptureId: "c-other" } : a) as StoreState["nextActions"];
    ok("97.21 §20 a record another capture created is kept",
      !undoableRefs(s4, "c1").some((r) => r.id === "a-do"),
      undoableRefs(s4, "c1").map((r) => r.id).join(","));
  }
  ok("97.22 §19 only kinds with a delete that takes its dependents are undoable",
    [...UNDOABLE_KINDS].sort().join(",") === "action,event,note", [...UNDOABLE_KINDS].join(","));
  {
    // A protocol IS attributable — it carries sourceCaptureId — but has no
    // delete primitive here, so it is deliberately not undoable from this
    // surface rather than half-removed.
    const s5 = world();
    s5.protocols = [{ id: "pr1", trigger: "Marcus replies", response: "send the lease",
      status: "active", sourceCaptureId: "c1", createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["protocols"];
    s5.captures[0].linkedEntityRefs = [...(s5.captures[0].linkedEntityRefs ?? []), { kind: "protocol", id: "pr1" }];
    ok("97.23 §19 an attributable record with no safe delete is kept, not half-removed",
      createdBy(s5, { kind: "protocol", id: "pr1" } as RefLite, "c1") === true
      && !undoableRefs(s5, "c1").some((r) => r.id === "pr1"),
      undoableRefs(s5, "c1").map((r) => r.id).join(","));
  }

  // ---- §32. Staleness -----------------------------------------------------
  {
    const o = correctableOutcome(s, { kind: "action", id: "a-do" } as RefLite, { createdByCapture: true })!;
    ok("97.24 §32 a record that is still there still stands", outcomeStillStands(s, o) === true);
    const gone = { ...s, nextActions: (s.nextActions ?? []).filter((a) => a.id !== "a-do") } as StoreState;
    ok("97.25 §32 …and one deleted underneath does not", outcomeStillStands(gone, o) === false);
    const moved = {
      ...s,
      nextActions: (s.nextActions ?? []).map((a) => a.id === "a-do" ? { ...a, dueDate: "2026-10-01" } : a),
    } as StoreState;
    ok("97.26 §32 the current value is read from the store, not from the sheet",
      currentValue(moved, o, "dueDate") === "2026-10-01"
      && o.fields.find((f) => f.field === "dueDate")?.value === "2026-09-07",
      `${currentValue(moved, o, "dueDate")} vs ${o.fields.find((f) => f.field === "dueDate")?.value}`);
  }

  // ---- §3, §25. The sentence, and where the title comes from -------------
  {
    const before = JSON.stringify(s.captures);
    buildCaptureCorrection(s, "c1");
    correctableOutcome(s, { kind: "action", id: "a-do" } as RefLite, { createdByCapture: true });
    undoableRefs(s, "c1");
    ok("97.27 §3 building the model writes nothing at all",
      JSON.stringify(s.captures) === before);
    ok("97.28 §25 …and every outcome still points back at its capture",
      (s.nextActions ?? []).filter((a) => a.sourceCaptureId === "c1").length === 2,
      String((s.nextActions ?? []).filter((a) => a.sourceCaptureId === "c1").length));
  }
  ok("97.29 §36 nothing in this layer speaks of AI, learning or preferences",
    !correctionStrings(buildCaptureCorrection(s, "c1")!).some((x) =>
      /\bAI\b|learn|training|preference|model/i.test(x)),
    correctionStrings(buildCaptureCorrection(s, "c1")!).filter((x) => /\bAI\b|learn/i.test(x)).join(" | "));

  // ---- A capture that is gone, and a ref that is gone --------------------
  ok("97.30 §31 a capture that does not exist produces no model",
    buildCaptureCorrection(s, "nope") === null);
  {
    const dangling = world();
    dangling.captures[0].linkedEntityRefs = [{ kind: "action", id: "vanished" }];
    ok("97.31 §31 a ref the store cannot back produces no outcome",
      buildCaptureCorrection(dangling, "c1")!.outcomes.length === 0);
  }

  // ---- §22 of 096. The regression this sprint's audit found --------------
  {
    const empty = emptyStoreState();
    for (const [text, want] of [
      ["I'm waiting on Maria for the transcript Friday", "Transcript from Maria"],
      ["I'm waiting on Marcus for the lease tomorrow", "Lease from Marcus"],
      ["I'm waiting on Ana for the signed form next Monday", "Signed form from Ana"],
    ] as const) {
      const c = (interpret(text, empty, T).candidates ?? [])[0];
      ok(`97.32 §22 a date the record holds does not stay in its name — "${text.slice(0, 34)}…"`,
        cleanCandidateTitle(c, T).title === want,
        `${cleanCandidateTitle(c, T).title} (waitingFor="${c?.fields.waitingFor}", dueDate=${c?.fields.dueDate})`);
      ok(`97.33 §22 …and the date is genuinely in a field`,
        !!c?.fields.dueDate, String(c?.fields.dueDate));
    }
    // An UNRESOLVED phrase stays, because the words are the only place it lives.
    const vague = (interpret("I'm waiting on Sam for the report sometime", empty, T).candidates ?? [])[0];
    ok("97.34 §22 an unresolved phrase is kept in the name",
      /sometime/i.test(cleanCandidateTitle(vague, T).title),
      cleanCandidateTitle(vague, T).title);
    // Without a day there is nothing to resolve against, and nothing is guessed.
    const c2 = (interpret("I'm waiting on Maria for the transcript Friday", empty, T).candidates ?? [])[0];
    ok("97.35 §22 …and with no day to resolve against, nothing is removed",
      cleanCandidateTitle(c2).title === "Transcript Friday from Maria",
      cleanCandidateTitle(c2).title);
  }

  // ---- Day keys are validated in one place -------------------------------
  ok("97.36 §8 a malformed date is refused rather than stored",
    asDayKey("2026-09-07") === "2026-09-07" && asDayKey("next friday") === undefined
    && asDayKey("") === undefined && asDayKey(undefined) === undefined, "");

  // ---- §45. The model is cheap -------------------------------------------
  {
    const big = world();
    for (let i = 0; i < 5000; i += 1) {
      big.nextActions.push(act({ id: `b${i}`, title: `Action ${i}` }));
    }
    const t = Date.now();
    for (let i = 0; i < 50; i += 1) buildCaptureCorrection(big, "c1");
    const ms = (Date.now() - t) / 50;
    ok("97.37 §45 building the model over 5,000 records takes under 20ms",
      ms < 20, `${ms.toFixed(2)}ms`);
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - t0,
    results,
  };
}
