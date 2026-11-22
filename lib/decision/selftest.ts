/**
 * Decision regression suite (PR 2).
 *
 * `lib/decision/` had no self-test. Its promise (LIFEOS-016) is that LifeOS
 * clarifies a decision and never makes it. Pinned here:
 *
 *   D1  Tradeoff arithmetic is the user's own ratings × weights — unrated cells
 *       skipped, ties preserved — and is labelled one perspective, not a verdict.
 *   D2  The AI layer is citation-gated: uncited tradeoffs, risks, assumptions,
 *       values claims and strongest cases are dropped and flagged; prescriptive
 *       and falsely-certain language is flagged; unknown enum values degrade to
 *       "unclear"/"unknown"; missing fields fall back to the user's own framing.
 *   D3  Sensitive topics get the right caution (self-harm first, with 988), and
 *       ordinary decisions get none.
 *   D4  runDecisionAnalysis works offline, enforces the option bounds, cites
 *       only real records, and mutates nothing — not the store, not the
 *       decision, and never the user's choice or rationale.
 *   D5  A hostile AI response cannot get a fabricated citation through, cannot
 *       choose for the user, and the large-decision verification pass can only
 *       REMOVE statements, never add them.
 *
 * Offline by construction, like lib/reasoning/selftest.ts; D5 plays the AI by
 * replacing `fetch` for one call.
 */

import type { Belief, Decision, DecisionCriterion, DecisionOption, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { computeTradeoffs, tradeoffContext } from "@/lib/decision/tradeoffs";
import { validateDecisionAnalysis } from "@/lib/decision/schema";
import { decisionCaution } from "@/lib/decision/safety";
import { runDecisionAnalysis } from "@/lib/decision/run";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const AT = "2026-10-01T12:00:00.000Z";

function belief(id: string, text: string): Belief {
  return { id, captureId: "", proposalId: "", text, status: "accepted", createdAt: AT, updatedAt: AT, revisions: [], judgments: [] };
}
function option(id: string, name: string, extra: Partial<DecisionOption> = {}): DecisionOption {
  return { id, name, kind: "named", benefits: [], costs: [], risks: [], reversibility: "unknown", evidenceIds: [], assumptions: [], openQuestions: [], ...extra };
}
function crit(id: string, name: string, weight?: number): DecisionCriterion {
  return { id, name, weight };
}
function decision(extra: Partial<Decision> = {}): Decision {
  return {
    id: "d1", title: "Graduate school", question: "Should I apply to graduate school this year or keep working?",
    status: "exploring",
    options: [option("o-apply", "Apply to graduate school this year"), option("o-work", "Keep working for now")],
    criteria: [crit("c-growth", "Growth", 5), crit("c-money", "Money"), crit("c-time", "Time with family", 2)],
    ratings: { "o-apply": { "c-growth": 2, "c-money": -1 }, "o-work": { "c-growth": 0, "c-money": 2, "c-time": 1 } },
    constraints: ["Savings must cover tuition"], assumptions: ["Funding is available"], seedRefs: [], evidence: [],
    history: [], judgments: [], revisions: [], outcomeReviews: [],
    rationale: "Leaning on growth", provisionalChoice: "o-work",
    aiModel: "mock", source: "mock", coverage: null, partial: false, verified: false, createdAt: AT, updatedAt: AT,
    ...extra,
  };
}
function world(): StoreState {
  return {
    ...emptyStoreState(),
    beliefs: [
      belief("b-growth", "Graduate school growth matters more than money this year"),
      belief("b-family", "Time with family is worth protecting while working"),
      belief("b-unrelated", "Sourdough needs a warm kitchen"),
    ],
  };
}
const snap = (s: unknown) => JSON.stringify(s);

/** Play the AI: answers each `/api/ai` task from `byTask`. */
async function withAi<T>(byTask: Record<string, unknown>, fn: () => Promise<T>): Promise<{ value: T; calls: string[] }> {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    if (url !== "/api/ai") throw new Error(`unexpected fetch to ${url}`);
    const task = String((JSON.parse(String(init?.body ?? "{}")) as { task?: string }).task);
    calls.push(task);
    return { ok: true, status: 200, json: async () => ({ result: byTask[task] ?? {}, source: "ai" }) };
  }) as unknown as typeof fetch;
  try {
    return { value: await fn(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

export async function runDecisionSelfTests(): Promise<SelfTestReport> {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---------------------------------------------------------------------- D1
  {
    const t = computeTradeoffs(decision());
    const apply = t.tallies.find((x) => x.optionId === "o-apply")!;
    const work = t.tallies.find((x) => x.optionId === "o-work")!;
    ok("D1.1 weighted total = Σ weight × rating (5×2 + 3×−1 = 7)", apply.weightedTotal === 7, String(apply.weightedTotal));
    ok("D1.2 an unweighted criterion counts as 3 (5×0 + 3×2 + 2×1 = 8)", work.weightedTotal === 8, String(work.weightedTotal));
    ok("D1.3 unrated cells are skipped, and the count says so", apply.ratedCriteria === 2 && apply.totalCriteria === 3, `${apply.ratedCriteria}/${apply.totalCriteria}`);
    const tie = computeTradeoffs(decision({ ratings: { "o-apply": { "c-growth": 1 }, "o-work": { "c-growth": 1 } } }));
    ok("D1.4 a tie on a criterion keeps both leaders", snap(tie.leaders.find((l) => l.criterionId === "c-growth")?.leaders) === snap(["Apply to graduate school this year", "Keep working for now"]));
    ok("D1.5 a criterion nobody rated has no leader", !tie.leaders.some((l) => l.criterionId === "c-time"));
    const none = computeTradeoffs(decision({ ratings: {} }));
    ok("D1.6 no ratings at all is reported as empty, not as zeroes to compare", none.empty === true);
    ok("D1.7 the AI is told the user has not rated yet", tradeoffContext(decision({ ratings: {} })).startsWith("The user has not rated"));
    ok("D1.8 the totals are framed as one perspective, not a verdict", tradeoffContext(decision()).includes("one perspective, not a verdict"));
  }

  // ---------------------------------------------------------------------- D2
  {
    const valid = new Set(["b-growth", "b-family"]);
    const fb = { question: "Q?", options: ["A", "B"], criteria: ["Growth"], coverageNote: "note" };
    const v = validateDecisionAnalysis({
      tradeoffs: [
        { statement: "Applying trades income for growth.", evidenceIds: ["b-growth"], option: "Apply" },
        { statement: "Working is better because I say so.", evidenceIds: ["b-nowhere"] },
        { statement: "You should choose to keep working.", evidenceIds: ["b-family"] },
      ],
      risks: [{ statement: "There is an 80% chance funding falls through.", evidenceIds: ["b-growth"] }],
      assumptions: [{ statement: "No evidence for this.", evidenceIds: [] }],
      valuesAlignment: [
        { option: "Apply", verdict: "strongly_supports", statement: "Fits your growth belief.", evidenceIds: ["b-growth"] },
        { option: "Work", verdict: "conflicts", statement: "Uncited values claim.", evidenceIds: ["fake"] },
      ],
      reversibilityNotes: [{ option: "Apply", assessment: "totally_fine", note: "n" }],
      strongestFor: [{ option: "Apply", statement: "Growth.", evidenceIds: [] }],
      scenarios: [{ option: "Apply", best: "You will definitely get in.", expected: "", worst: "" }],
      hybridSuggestion: "Clearly the best is to defer one year.",
      tradeoffsExtra: "ignored",
    }, valid, fb);
    const tradeoffs = v.tradeoffs.map((x) => x.statement);
    const flagged = v.flagged ?? [];
    ok("D2.1 a cited tradeoff is kept with its option", tradeoffs.includes("Applying trades income for growth.") && v.tradeoffs[0].option === "Apply");
    ok("D2.2 a tradeoff citing an unknown id is dropped", !tradeoffs.includes("Working is better because I say so."), tradeoffs.join(" | "));
    ok("D2.3 …and flagged as unsupported", flagged.some((f) => f.startsWith("Unsupported tradeoff") && f.includes("because I say so")));
    ok("D2.4 an uncited assumption is dropped and flagged", v.assumptions.length === 0 && flagged.some((f) => f.startsWith("Unsupported assumption")));
    ok("D2.5 'you should choose' is flagged as prescriptive", flagged.some((f) => f.startsWith("Prescriptive language") && f.includes("You should choose")), flagged.join(" | "));
    // Current behaviour, pinned on purpose: the flag text says "softened", but the
    // statement is kept verbatim. Reported in PR 2 as a product question; change
    // this assertion together with the behaviour if the text is ever rewritten.
    ok("D2.6 …and the flagged statement is currently kept verbatim (see note)", tradeoffs.includes("You should choose to keep working."));
    ok("D2.7 a fabricated probability is flagged", flagged.some((f) => f.startsWith("Overclaims certainty") && f.includes("80% chance")));
    ok("D2.8 'definitely' in a scenario is flagged", flagged.some((f) => f.startsWith("Overclaims certainty") && f.includes("definitely")));
    ok("D2.9 'clearly the best' in a hybrid suggestion is flagged", flagged.some((f) => f.startsWith("Prescriptive language") && f.includes("Clearly the best")));
    ok("D2.10 an unknown alignment verdict becomes 'unclear'", v.valuesAlignment.length === 1 && v.valuesAlignment[0].verdict === "unclear", snap(v.valuesAlignment));
    ok("D2.11 a values claim citing no real belief is dropped and flagged", !v.valuesAlignment.some((x) => x.statement === "Uncited values claim.") && flagged.some((f) => f.startsWith("Unsupported values-alignment")));
    ok("D2.12 an unknown reversibility becomes 'unknown'", v.reversibilityNotes[0]?.assessment === "unknown");
    ok("D2.13 an uncited strongest case is dropped", v.strongestFor.length === 0);
    ok("D2.14 omitted framing falls back to the user's own question, options and criteria",
      v.question === "Q?" && snap(v.options) === snap(["A", "B"]) && snap(v.criteria) === snap(["Growth"]) && v.coverageNote === "note");
    const many = validateDecisionAnalysis({ tradeoffs: Array.from({ length: 40 }, (_, i) => ({ statement: `T${i}`, evidenceIds: ["b-growth"] })) }, valid, fb);
    ok("D2.15 grounded lists are capped at 24", many.tradeoffs.length === 24, String(many.tradeoffs.length));
    for (const [label, raw] of [["null", null], ["a string", "pick option A"], ["an array", []]] as const) {
      const e = validateDecisionAnalysis(raw, valid, fb);
      ok(`D2.16 ${label} as AI output yields the user's framing and no findings`,
        e.question === "Q?" && e.tradeoffs.length === 0 && e.risks.length === 0 && e.flagged === undefined, snap(e).slice(0, 200));
    }
  }

  // ---------------------------------------------------------------------- D3
  {
    ok("D3.1 self-harm gets the safety caution with 988", (decisionCaution("Should I end it all or keep going?") ?? "").includes("988"));
    ok("D3.2 self-harm takes precedence over a medical match", (decisionCaution("Stop my medication and hurt myself, or kill myself?") ?? "").includes("988"));
    ok("D3.3 a medical decision names a clinician", (decisionCaution("Should I have the surgery now?") ?? "").includes("clinician"));
    ok("D3.4 a legal decision names a lawyer", (decisionCaution("Should I file a lawsuit against my landlord?") ?? "").includes("lawyer"));
    ok("D3.5 high-risk trading is not treated as advice", (decisionCaution("Should I put all my savings into day trading?") ?? "").includes("does not give trading or investment advice"));
    ok("D3.6 harm to others is reflection only", (decisionCaution("Should I take revenge on him?") ?? "").includes("will not plan harmful actions"));
    ok("D3.7 an ordinary decision gets no banner", decisionCaution("Should I apply to graduate school this year?") === undefined);
  }

  // ---------------------------------------------------------------------- D4
  {
    const s = world();
    const d = decision();
    const beforeState = snap(s), beforeDecision = snap(d);
    const r = await runDecisionAnalysis(s, d);
    const real = new Set(s.beliefs.map((b) => b.id));
    const cited = [...r.analysis.tradeoffs, ...r.analysis.risks, ...r.analysis.assumptions, ...r.analysis.valuesAlignment].flatMap((x) => x.evidenceIds);
    ok("D4.1 offline: the deterministic fallback answers", r.source === "mock");
    ok("D4.2 the evidence packet contains only real records", r.evidence.length > 0 && r.evidence.every((e) => real.has(e.id)), snap(r.evidence.map((e) => e.id)));
    ok("D4.3 the relevant beliefs are retrieved and the unrelated one is not",
      r.evidence.some((e) => e.id === "b-growth") && !r.evidence.some((e) => e.id === "b-unrelated"), snap(r.evidence.map((e) => e.id)));
    ok("D4.4 every citation in the analysis is in the evidence packet", cited.every((id) => r.evidence.some((e) => e.id === id)));
    ok("D4.5 analysis mutates nothing in the store", snap(s) === beforeState);
    ok("D4.6 …nor the decision — choice, rationale and history untouched", snap(d) === beforeDecision);
    ok("D4.7 the result carries no choice field at all", !("finalChoice" in r) && !("provisionalChoice" in r) && !("finalChoice" in r.analysis));
    ok("D4.8 two options: no verification pass", r.verified === false);
    let threw = "";
    try { await runDecisionAnalysis(s, decision({ options: [option("o1", "Only one")] })); } catch (e) { threw = String((e as Error).message); }
    ok("D4.9 fewer than two options is refused", threw === "Add at least 2 options first.", threw);
    threw = "";
    try { await runDecisionAnalysis(s, decision({ options: Array.from({ length: 9 }, (_, i) => option(`o${i}`, `Option ${i}`)) })); } catch (e) { threw = String((e as Error).message); }
    ok("D4.10 more than eight options is refused", threw === "At most 8 options are supported.", threw);
  }

  // ---------------------------------------------------------------------- D5
  {
    const s = world();
    const d = decision({ options: Array.from({ length: 5 }, (_, i) => option(`o${i}`, `Graduate school option ${i}`)) });
    const beforeState = snap(s), beforeDecision = snap(d);
    const synthesis = {
      question: "Which option should you take?",
      tradeoffs: [
        { statement: "Option 0 trades income for growth.", evidenceIds: ["b-growth"] },
        { statement: "Option 1 is objectively correct.", evidenceIds: ["admin", "b-9999"] },
        { statement: "Option 2 costs family time.", evidenceIds: ["b-family"] },
      ],
      finalChoice: "o1",
      provisionalChoice: "o1",
      hybridSuggestion: "You must choose option 1.",
    };
    const verify = {
      removeStatements: ["Option 2 costs family time.", "A statement the verifier invented."],
      cautions: ["Verifier: evidence is thin."],
    };
    const { value: r, calls } = await withAi({ decision_synthesis: synthesis, decision_verify: verify }, () => runDecisionAnalysis(s, d));
    const statements = r.analysis.tradeoffs.map((x) => x.statement);
    ok("D5.1 the AI path and the verification pass both ran", r.source === "ai" && calls.join() === "decision_synthesis,decision_verify" && r.verified === true, `${r.source} ${calls.join()}`);
    ok("D5.2 a grounded AI tradeoff is kept", statements.includes("Option 0 trades income for growth."));
    ok("D5.3 a tradeoff citing fabricated ids is dropped", !statements.includes("Option 1 is objectively correct."), statements.join(" | "));
    ok("D5.4 verification removed the statement it named", !statements.includes("Option 2 costs family time."), statements.join(" | "));
    ok("D5.5 verification cannot ADD a statement", !statements.includes("A statement the verifier invented.") && statements.length === 1, statements.join(" | "));
    ok("D5.6 verifier cautions are surfaced as flags", (r.analysis.flagged ?? []).includes("Verifier: evidence is thin."));
    ok("D5.7 a prescriptive hybrid suggestion is flagged", (r.analysis.flagged ?? []).some((f) => f.startsWith("Prescriptive language") && f.includes("You must choose")));
    ok("D5.8 an AI 'finalChoice' is ignored — the result has no choice", !("finalChoice" in r.analysis) && !("provisionalChoice" in r.analysis) && !("finalChoice" in r));
    ok("D5.9 the store is unchanged", snap(s) === beforeState);
    ok("D5.10 the decision, including the user's own provisional choice, is unchanged", snap(d) === beforeDecision && d.provisionalChoice === "o-work" && d.finalChoice === undefined);
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
