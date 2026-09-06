/**
 * LIFEOS-095 — the front door, asserted.
 *
 * Every capture below is run through the REAL `interpret` and the REAL
 * `suggestContext`. Nothing here fakes a candidate: the whole point of the
 * sprint is that Home now acts on what those two already say, so a fixture that
 * hand-built its own `authority` would be testing a copy of the decision rather
 * than the decision.
 */

import type { StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { interpret } from "@/lib/capture/interpret";
import { buildCaptureContextIndex, suggestContext } from "@/lib/capture/context";
import { preselected } from "@/lib/capture/authority";
import {
  canFinishWithoutAsking, askingBecause, describeCreated, recentCaptures,
  captureHomeStrings, HOME_PROMPT, HOME_PLACEHOLDER, MAX_RECENT_CAPTURES,
  OUTCOME_LABEL, KEPT_UNORGANISED,
  type FinishInput,
} from "@/lib/capture/home";

const T = "2026-09-05";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

const proj = (p: { id: string; title: string; goalId?: string }) => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"), ...p,
}) as StoreState["projects"][number];

function world(): StoreState {
  const s = emptyStoreState();
  s.projects = [proj({ id: "p-apps", title: "Graduate applications" }), proj({ id: "p-teach", title: "Teaching portfolio" })];
  s.goals = [{
    id: "g1", title: "Graduate school", description: "", status: "active", priority: "high", notes: "",
    tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as StoreState["goals"];
  return s;
}

/** The real pipeline, exactly as the composer runs it. */
function read(s: StoreState, text: string, hasPendingEdit = false): FinishInput {
  const candidates = interpret(text, s, T).candidates ?? [];
  const index = buildCaptureContextIndex(s);
  return {
    candidates,
    context: candidates.flatMap((c) => suggestContext(c, s, index)),
    hasPendingEdit,
  };
}

export function runCaptureHomeSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  const s = world();

  // ---- §31. Auto-safe captures finish without a second press --------------
  for (const [text, why] of [
    ["Email Marcus about the lease tomorrow", "an ordinary dated action"],
    ["I'm waiting on Maria for the transcript", "a wait on a person"],
    ["Apply to philosophy programs", "an ordinary undated action"],
    ["Call the dentist tomorrow, finish the report, and Marcus still owes me the file",
      "three auto-safe things in one sentence"],
  ] as const) {
    const inp = read(s, text);
    ok(`95.1 §31 finishes without asking — ${why}`,
      canFinishWithoutAsking(inp),
      `${askingBecause(inp) ?? ""} · ${inp.candidates.map((c) => `${c.kind}/${c.authority}`).join(",")}`);
    ok(`95.2 §31 …and says nothing about why it asked, because it did not — ${why}`,
      askingBecause(inp) === null, String(askingBecause(inp)));
  }

  // ---- §32, §33. Consequential kinds still ask ----------------------------
  for (const [text, why, expect] of [
    ["When I feel overwhelmed I go for a walk", "a protocol is normative", /protocol/],
    ["I realized teaching isn't what I want", "a low-confidence reading", /note/],
  ] as const) {
    const inp = read(s, text);
    ok(`95.3 §32 still asks — ${why}`, !canFinishWithoutAsking(inp),
      inp.candidates.map((c) => `${c.kind}/${c.authority}`).join(","));
    ok(`95.4 §32 …and names the kind that needs the person — ${why}`,
      expect.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
  }

  // ---- §11, §13. Ambiguity is the reason, when it is real -----------------
  {
    const inp = read(s, "Follow up on the applications and the portfolio review");
    ok("95.5 §11 a genuinely contested context asks",
      !canFinishWithoutAsking(inp), String(askingBecause(inp)));
    ok("95.6 §11 …and says so, rather than blaming the kind",
      /more than one/i.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
    ok("95.7 §11 …on a capture whose own candidate WOULD have been auto-safe",
      inp.candidates.every((c) => preselected(c.authority)),
      inp.candidates.map((c) => `${c.kind}/${c.authority}`).join(","));
  }

  // ---- §18 of 089. You may already have this -----------------------------
  {
    // The regression LIFEOS-089's own browser suite caught. This capture is a
    // high-confidence wait with no ambiguity anywhere, so §31 finished it — and
    // wrote a second wait on Maria beside the one already open. A front door
    // that silently duplicates a commitment is worse than one that asks twice.
    const w = world();
    w.nextActions = [{ id: "a-maria", title: "Ask Maria for the transcript", description: "",
      status: "waiting", waitingOn: "Maria", waitingSince: D("2026-09-01"), notes: "",
      linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 1, history: [], createdAt: D("2026-09-01"), updatedAt: D("2026-09-01") }] as StoreState["nextActions"];
    const inp = read(w, "I'm waiting on Maria for the transcript.");
    ok("95.7b §18 a capture that may duplicate an open record asks",
      !canFinishWithoutAsking(inp), String(askingBecause(inp)));
    ok("95.7c §18 …and says that is why",
      /already have/i.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
    ok("95.7d §18 …on a capture that is otherwise entirely auto-safe",
      inp.candidates.every((c) => preselected(c.authority) && c.unresolved.length === 0)
      && inp.context.every((c) => c.ambiguousAlternatives.length === 0),
      inp.context.map((c) => `${c.contextType}/${c.strength}`).join(","));
    // Without that open wait, the identical sentence finishes.
    ok("95.7e §18 …and the same sentence finishes when there is nothing to duplicate",
      canFinishWithoutAsking(read(world(), "I'm waiting on Maria for the transcript.")),
      String(askingBecause(read(world(), "I'm waiting on Maria for the transcript."))));
  }

  // ---- §19 of 060. Something unstorable is said, never compressed away ----
  //
  // Both fixtures here were found by mutation. The first version of this block
  // used "Dinner with Ana sometime next quarter maybe", which is ALSO a
  // low-confidence note — so deleting the unresolved guard changed nothing and
  // deleting the date guard changed nothing, and two clauses sat untested
  // behind a third. These two captures are auto-safe in every respect except
  // the one being tested.
  {
    // A high-confidence Action. "sometime" and "soon" are the user's own words
    // about WHEN, and no field can hold them — finishing silently would drop
    // the only part of the sentence Conqify could not keep.
    const inp = read(s, "Call the dentist sometime soon");
    ok("95.8 §9 a capture with an unstorable fragment asks",
      !canFinishWithoutAsking(inp), String(askingBecause(inp)));
    ok("95.9 §9 …and says which half of it is the problem",
      /couldn't be stored/i.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
    ok("95.9b §9 …on a capture that is otherwise entirely auto-safe",
      inp.candidates.every((c) => preselected(c.authority)) && inp.candidates.length > 0,
      inp.candidates.map((c) => `${c.kind}/${c.authority}`).join(","));
  }
  {
    // A high-confidence Note carrying a Friday a note cannot keep. The kind is
    // auto_with_undo and the context is clean; the date is the whole reason.
    const inp = read(s, "Remember that the deadline is Friday");
    ok("95.9c §9 a date the kind would drop asks instead of dropping it",
      !canFinishWithoutAsking(inp), String(askingBecause(inp)));
    ok("95.9d §9 …and says that is why",
      /date/i.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
    ok("95.9e §9 …on a capture that is otherwise entirely auto-safe",
      inp.candidates.every((c) => preselected(c.authority) && c.unresolved.length === 0),
      inp.candidates.map((c) => `${c.kind}/${c.authority}/${c.unresolved.length}`).join(","));
  }

  // ---- §33. A change to an existing record is never automatic ------------
  {
    const inp = read(s, "Email Marcus about the lease tomorrow", true);
    ok("95.10 §33 a pending change to an existing record always asks",
      !canFinishWithoutAsking(inp), String(askingBecause(inp)));
    ok("95.11 §33 …and it outranks every other reason",
      /already have/i.test(askingBecause(inp) ?? ""), String(askingBecause(inp)));
  }

  // ---- Nothing found is not the same as safe ------------------------------
  {
    const inp: FinishInput = { candidates: [], context: [], hasPendingEdit: false };
    ok("95.12 §29 an empty reading is never auto-finished", !canFinishWithoutAsking(inp));
    ok("95.13 §29 …and produces no explanation, because there is nothing to explain",
      askingBecause(inp) === null, String(askingBecause(inp)));
  }

  // ---- §10, §16. What the finished state says ----------------------------
  {
    const w = world();
    w.nextActions = [
      { id: "a1", title: "Email Marcus about the lease", description: "", status: "open", notes: "",
        linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1,
        history: [], dueDate: "2026-09-06", createdAt: D(T, 10), updatedAt: D(T, 10) },
      { id: "a2", title: "Transcript from Maria", description: "", status: "waiting", waitingOn: "Maria",
        notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
        order: 1, history: [], createdAt: D(T, 10), updatedAt: D(T, 10) },
    ] as StoreState["nextActions"];
    w.notes = [{ id: "n1", title: "", body: "Teaching isn't what I want", createdAt: D(T, 11),
      updatedAt: D(T, 11), tags: [], linkedEntityRefs: [] }] as StoreState["notes"];

    const made = describeCreated(w, [
      { kind: "action", id: "a1" }, { kind: "action", id: "a2" }, { kind: "note", id: "n1" },
    ]);
    ok("95.14 §10 the finished state names the record, not a count",
      made[0]?.title === "Email Marcus about the lease", made.map((m) => m.title).join(" | "));
    ok("95.15 §10 …and the product word for what it became",
      made[0]?.label === "Action", made.map((m) => m.label).join(","));
    ok("95.16 §10 …and one fact about it",
      /Sep 6/.test(made[0]?.detail ?? ""), String(made[0]?.detail));
    // LIFEOS-096 §9 moved WHERE the person is named, not whether. This row's
    // title is now "Transcript from Maria", so repeating "Waiting on Maria" in
    // the detail said the name twice. The guarantee 095 wanted — the row says
    // who — is asserted where it actually lives rather than at one address.
    ok("95.17 §16 a wait is called a wait, not an action",
      made[1]?.label === "Waiting", String(made[1]?.label));
    ok("95.17b §16 …and the row still says who, in the title or the detail",
      /Maria/.test(`${made[1]?.title} ${made[1]?.detail ?? ""}`),
      `${made[1]?.title} · ${made[1]?.detail ?? "(no detail)"}`);
    ok("95.18 §16 a note is a note", made[2]?.label === "Note", String(made[2]?.label));
    ok("95.19 §17 every outcome can be opened",
      made.every((m) => m.href.length > 1), made.map((m) => m.href).join(" "));

    // The reason it reads the store rather than the candidates it was given.
    const ghost = describeCreated(w, [{ kind: "action", id: "nope" }]);
    ok("95.20 §10 a ref the store did not write is not claimed as saved",
      ghost.length === 0, String(ghost.length));
    ok("95.21 §16 no pipeline word reaches the surface",
      made.every((m) => !/candidate|processingStatus|inbox|auto_with_undo|confirm/i.test(`${m.label} ${m.detail ?? ""}`)),
      made.map((m) => m.label).join(","));
  }

  // ---- §15, §17, §18. The recent list -------------------------------------
  {
    const w = world();
    w.nextActions = [{ id: "a1", title: "Email Marcus about the lease", description: "", status: "open",
      notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 1, history: [], dueDate: "2026-09-06", createdAt: D(T, 10), updatedAt: D(T, 10) }] as StoreState["nextActions"];
    w.notes = [{ id: "n1", title: "", body: "A thought", createdAt: D(T, 9), updatedAt: D(T, 9),
      tags: [], linkedEntityRefs: [] }] as StoreState["notes"];
    w.captures = [
      { id: "c1", text: "Email Marcus about the lease tomorrow", createdAt: D(T, 10),
        processingStatus: "processed", processedAt: D(T, 10),
        linkedEntityRefs: [{ kind: "action", id: "a1" }, { kind: "note", id: "n1" }] },
      { id: "c2", text: "Book the venue", createdAt: D(T, 8), processingStatus: "inbox", linkedEntityRefs: [] },
      { id: "c3", text: "Old and gone", createdAt: D(T, 7), processingStatus: "inbox",
        archivedAt: D(T, 7), linkedEntityRefs: [] },
      { id: "c4", text: "Older still", createdAt: D("2026-09-01"), processingStatus: "inbox", linkedEntityRefs: [] },
      { id: "c5", text: "Older again", createdAt: D("2026-08-31"), processingStatus: "inbox", linkedEntityRefs: [] },
      { id: "c6", text: "Oldest", createdAt: D("2026-08-30"), processingStatus: "inbox", linkedEntityRefs: [] },
    ] as StoreState["captures"];

    const rows = recentCaptures(w);
    ok("95.22 §15 the recent list is bounded",
      rows.length <= MAX_RECENT_CAPTURES, `${rows.length} of ${w.captures.length}`);
    ok("95.23 §15 …newest first", rows[0]?.id === "c1", rows.map((r) => r.id).join(","));
    ok("95.24 §15 an archived capture is not recent, it is gone",
      !rows.some((r) => r.id === "c3"), rows.map((r) => r.id).join(","));
    ok("95.25 §18 a capture that made two records is ONE row",
      rows.filter((r) => r.id === "c1").length === 1 && rows[0]?.outcomes.length === 2,
      `${rows.filter((r) => r.id === "c1").length} rows, ${rows[0]?.outcomes.length} outcomes`);
    ok("95.26 §17 the row keeps what the person typed",
      rows[0]?.text === "Email Marcus about the lease tomorrow", String(rows[0]?.text));
    ok("95.27 §16 …beside what it became, in product words",
      rows[0]?.outcomes.map((o) => o.label).join(",") === "Action,Note",
      rows[0]?.outcomes.map((o) => o.label).join(","));
    ok("95.28 §16 an unfiled capture says nothing it did not do",
      rows.find((r) => r.id === "c2")?.unfiled === true
      && rows.find((r) => r.id === "c2")?.outcomes.length === 0, "");
    {
      // The defect a fixture found before a user did. `convertCapture` files a
      // capture as a concept, a dialogue, a practice and six other kinds this
      // surface has no reader for — so an empty outcome list is not evidence
      // the capture is unfiled, and treating it that way told people their
      // filed capture was still waiting and pointed them at an inbox it is not
      // in. `unfiled` reads `processingStatus`, which is the store's answer.
      const w2 = world();
      w2.captures = [{ id: "cx", text: "A thought worth keeping", createdAt: D(T, 10),
        processingStatus: "processed", processedAt: D(T, 10),
        linkedEntityRefs: [{ kind: "concept", id: "k1" }] }] as StoreState["captures"];
      const r2 = recentCaptures(w2)[0];
      ok("95.28b §16 a capture filed into a domain Home cannot render is still filed",
        r2?.unfiled === false, `unfiled=${r2?.unfiled}`);
      ok("95.28c §16 …and Home claims no outcome it cannot name",
        r2?.outcomes.length === 0, String(r2?.outcomes.length));
      const w3 = world();
      w3.beliefs = [{ id: "b1", captureId: "cb", proposalId: "pr1",
        text: "Teaching is the safe path.", status: "accepted", revisions: [], judgments: [],
        createdAt: D(T, 9), updatedAt: D(T, 9) }] as unknown as StoreState["beliefs"];
      w3.captures = [{ id: "cb", text: "Teaching is the safe path", createdAt: D(T, 9),
        processingStatus: "processed", processedAt: D(T, 9),
        linkedEntityRefs: [{ kind: "belief", id: "b1" }] }] as StoreState["captures"];
      ok("95.28d §16 a capture converted to a belief says so",
        recentCaptures(w3)[0]?.outcomes[0]?.label === "Belief",
        String(recentCaptures(w3)[0]?.outcomes[0]?.label));
    }
    ok("95.29 §34 reading the recent list writes nothing",
      (() => { const before = JSON.stringify(w); recentCaptures(w); recentCaptures(w); return JSON.stringify(w) === before; })());
    ok("95.30 §15 a limit of zero is honoured rather than ignored",
      recentCaptures(w, 0).length === 0, String(recentCaptures(w, 0).length));
  }

  // ---- §7, §8. The copy ----------------------------------------------------
  ok("95.31 §7 the prompt is one short question",
    HOME_PROMPT.endsWith("?") && HOME_PROMPT.length <= 24 && HOME_PROMPT.split(" ").length <= 4,
    HOME_PROMPT);
  ok("95.32 §8 the placeholder is one example, not a paragraph",
    !HOME_PLACEHOLDER.includes(",") && HOME_PLACEHOLDER.length <= 60, HOME_PLACEHOLDER);
  ok("95.33 §29 the failure sentence claims only what is true",
    /Saved your capture/.test(KEPT_UNORGANISED) && /couldn't fully organize/.test(KEPT_UNORGANISED),
    KEPT_UNORGANISED);
  {
    const w = world();
    w.captures = [{ id: "c1", text: "Email Marcus", createdAt: D(T, 10), processingStatus: "inbox",
      linkedEntityRefs: [] }] as StoreState["captures"];
    const bad = captureHomeStrings(recentCaptures(w)).filter((x) =>
      /\bcandidate\b|processingStatus|auto_with_undo|auto_safe|never_auto|confidence|interpret\(/i.test(x));
    ok("95.34 §15 no internal vocabulary can reach the page", bad.length === 0, bad.join(" | "));
  }
  ok("95.35 §16 every outcome word is a product word, not an ontology word",
    Object.values(OUTCOME_LABEL).every((w) => /^[A-Z][a-z]+$/.test(w)),
    Object.values(OUTCOME_LABEL).join(","));

  // ---- §43. Bounded work at scale ----------------------------------------
  for (const n of [1000, 5000]) {
    const big = world();
    big.captures = Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, text: `Capture ${i}`, createdAt: D("2026-09-01", 9), processingStatus: "inbox",
      linkedEntityRefs: [],
    })) as StoreState["captures"];
    const t = Date.now();
    const rows = recentCaptures(big);
    const ms = Date.now() - t;
    ok(`95.36.${n} §43 the recent list over ${n} captures builds in under 100ms`, ms < 100, `${ms}ms`);
    ok(`95.37.${n} §15 …and stays bounded`, rows.length === MAX_RECENT_CAPTURES, String(rows.length));
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
