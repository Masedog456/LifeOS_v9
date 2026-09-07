/**
 * LIFEOS-103 — capture follow-through, asserted.
 *
 * The rule is three facts about a row, so most of this file is the pairing that
 * proves it is a rule and not a constant: for every record that qualifies there
 * is a near neighbour that must not, and the neighbours are the assertions worth
 * reading.
 *
 * The REJECTED kinds are asserted too. §2 refused goal and project
 * follow-through on measured grounds, and a test that only covers what was built
 * lets the next sprint quietly add them back without noticing the reasons.
 */

import type { StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import {
  followThroughFor, waitNeedsFollowUp, FOLLOW_THROUGH_STRINGS, MAX_VISIBLE,
  NO_FOLLOW_UP_REASON,
} from "@/lib/capture/follow-through";
import type { CaptureOutcome } from "@/lib/capture/home";
import { goalPathState, goalsWithoutAnyPath } from "@/lib/execution/alignment";

const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

type A = StoreState["nextActions"][number];
const act = (p: Partial<A> & { id: string; title: string }): A => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"), ...p,
} as A);

function world(): StoreState {
  const s = emptyStoreState();
  s.nextActions = [
    // qualifies: waiting, a person, no follow-up date
    act({ id: "w-none", title: "Quote from Priya", status: "waiting", waitingOn: "Priya", waitingSince: D("2026-09-01") }),
    // does not: the date is already set
    act({ id: "w-set", title: "Keys from Sam", status: "waiting", waitingOn: "Sam", waitingSince: D("2026-09-01"), followUpDate: "2026-09-20" }),
    // does not: nobody named, so §8 forbids a reason we cannot state
    act({ id: "w-anon", title: "Something from someone", status: "waiting", waitingSince: D("2026-09-01") }),
    // does not: not waiting at all, even though it once did
    act({ id: "w-open", title: "Chase the quote", status: "open", waitingOn: "Priya" }),
    // does not: ordinary live work
    act({ id: "a-plain", title: "Email the landlord" }),
    act({ id: "a-dated", title: "Call the dentist", dueDate: "2026-09-11" }),
    act({ id: "a-rec", title: "Pay rent", recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 1 } }),
    // does not: finished work
    act({ id: "a-done", title: "Book the venue", status: "completed", completedAt: D("2026-09-05") }),
    // a second qualifying wait, for the §27 cap
    act({ id: "w-two", title: "Lease from Ana", status: "waiting", waitingOn: "Ana", waitingSince: D("2026-09-01") }),
    act({ id: "w-three", title: "Form from Dana", status: "waiting", waitingOn: "Dana", waitingSince: D("2026-09-01") }),
  ] as StoreState["nextActions"];
  return s;
}

const out = (id: string, kind = "action"): CaptureOutcome =>
  ({ kind, id, title: id, label: "Action", href: `/actions/${id}` });

export function runCaptureFollowThroughSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });
  const s = world();

  // ---- the rule, and its three clauses ------------------------------------
  ok("103.1 §7 a wait with a person and no follow-up date qualifies",
    waitNeedsFollowUp(s.nextActions.find((a) => a.id === "w-none")));
  ok("103.2 §8 a wait whose follow-up date is already set does not",
    !waitNeedsFollowUp(s.nextActions.find((a) => a.id === "w-set")));
  ok("103.3 §8 a wait with nobody named does not — the reason could not be stated",
    !waitNeedsFollowUp(s.nextActions.find((a) => a.id === "w-anon")));
  ok("103.4 §7 a record returned to open does not, even though it kept the person",
    !waitNeedsFollowUp(s.nextActions.find((a) => a.id === "w-open")));

  // ---- §5, §6, §17: work that is its own next move ------------------------
  for (const [id, why] of [
    ["a-plain", "§5 an ordinary Action IS the next move"],
    ["a-dated", "§6 a well-formed dated Action needs nothing"],
    ["a-rec", "§17 a recurring Action already has a future loop"],
    ["a-done", "§18 finished work gets no capture follow-through"],
  ] as const) {
    ok(`103.5 ${why}`, followThroughFor(s, [out(id)]).length === 0,
      JSON.stringify(followThroughFor(s, [out(id)])));
  }

  // ---- §9, §10, §11, §19: kinds that are never taskified -------------------
  for (const [kind, why] of [
    ["event", "§9 an Event"],
    ["note", "§10 a Note"],
    ["reflection", "§11 a Reflection"],
    ["constitution_element", "§19 a Rule"],
    ["goal", "§12 a Goal"],
    ["project", "§14 a Project"],
  ] as const) {
    ok(`103.6 ${why} gets no follow-through`,
      followThroughFor(s, [out("w-none", kind)]).length === 0,
      `${kind} → ${JSON.stringify(followThroughFor(s, [out("w-none", kind)]))}`);
  }
  // The control: the SAME id as an action does qualify, so 103.6 is about the
  // kind and not about the id happening to miss.
  ok("103.7 …and the control — that same id as an Action does qualify",
    followThroughFor(s, [out("w-none")]).length === 1);

  // ---- §20, §27: multi-outcome ---------------------------------------------
  {
    const mixed = followThroughFor(s, [out("a-plain"), out("w-none")]);
    ok("103.8 §20 in a mixed capture only the qualifying outcome suggests",
      mixed.length === 1 && mixed[0].outcomeId === "w-none",
      JSON.stringify(mixed.map((f) => f.outcomeId)));
    const many = followThroughFor(s, [out("w-none"), out("w-two"), out("w-three")]);
    ok("103.9 §27 at most two are shown, however many qualify",
      many.length === MAX_VISIBLE, `${many.length} of 3`);
  }

  // ---- §8, §43, §24, §25: what it says ------------------------------------
  {
    const f = followThroughFor(s, [out("w-none")])[0];
    ok("103.10 §8 the reason is a fact about the record",
      f?.reason === NO_FOLLOW_UP_REASON, JSON.stringify(f?.reason));
    ok("103.11 §25 the title is the record's own, and no task text is generated",
      f?.title === "Quote from Priya", JSON.stringify(f?.title));
    /**
     * §24, §43, §44, §45. The forbidden registers, swept over every string this
     * file can put on screen. Fabricated work ("research options"), advice
     * ("you should"), psychology ("stuck", "overwhelmed") and any score.
     */
    const banned = /research|make a plan|think about|break this down|you should|the best thing|seem|stuck|overwhelm|behind|\d\s?%|confidence/i;
    const bad = FOLLOW_THROUGH_STRINGS.filter((x) => banned.test(x));
    ok("103.12 §24, §43, §44, §45 no fabricated work, advice, psychology or score",
      bad.length === 0, JSON.stringify(bad));
  }

  // ---- §39, §40: it is derived, so state changes remove it ----------------
  {
    const corrected = world();
    corrected.nextActions = corrected.nextActions.map((a) =>
      a.id === "w-none" ? { ...a, followUpDate: "2026-09-25" } : a) as StoreState["nextActions"];
    ok("103.13 §39 a correction that adds the date removes the suggestion",
      followThroughFor(corrected, [out("w-none")]).length === 0);

    const undone = world();
    undone.nextActions = undone.nextActions.filter((a) => a.id !== "w-none") as StoreState["nextActions"];
    ok("103.14 §40 an undo that removes the record removes the suggestion",
      followThroughFor(undone, [out("w-none")]).length === 0);

    const stopped = world();
    stopped.nextActions = stopped.nextActions.map((a) =>
      a.id === "w-none" ? { ...a, status: "open", waitingOn: undefined } : a) as StoreState["nextActions"];
    ok("103.15 §39 …and so does ending the wait",
      followThroughFor(stopped, [out("w-none")]).length === 0);
  }

  // ---- §12, §14, §37: the predicates the audit refused to misuse ----------
  //
  // Not a test of this sprint's code — a test of the reason it did not ship
  // goal follow-through. `goal_path_missing` asks only about projects and would
  // have fired on a goal a live action already carries; `goalsWithoutAnyPath`
  // is the truthful predicate and does not.
  {
    const g = emptyStoreState();
    g.goals = [
      { id: "g-none", title: "Learn to sail", status: "active", description: "", priority: "medium",
        notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
        createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
      { id: "g-direct", title: "Apply to programs", status: "active", description: "", priority: "medium",
        notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
        createdAt: D("2026-06-01"), updatedAt: D("2026-06-01") },
    ] as StoreState["goals"];
    g.nextActions = [act({ id: "a-g", title: "Request the recommendation", goalId: "g-direct" })] as StoreState["nextActions"];
    ok("103.16 §37 a goal carried by a direct action is not path-less",
      goalPathState(g, g.goals[1]) === "actions"
      && goalsWithoutAnyPath(g).map((x) => x.id).join() === "g-none",
      `${goalPathState(g, g.goals[1])} · ${JSON.stringify(goalsWithoutAnyPath(g).map((x) => x.id))}`);
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
