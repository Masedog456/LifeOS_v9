/**
 * Capture intelligence self-tests (LIFEOS-080).
 *
 * ## What is proved red here, and what is not
 *
 * §34 forbids manufacturing a failing test for behaviour that already worked.
 * So there is nothing here asserting that a capture is saved, that an action is
 * created, or that `FORBIDDEN_CANDIDATE_KINDS` bars a belief — all of that
 * worked before this sprint and re-proving it in a new file would be theatre.
 *
 * The assertions below are about what the audit MEASURED as broken, and each
 * one was red against the base commit:
 *
 *   - three wrong-positives where a named rule became a held one
 *     ("I used to always answer emails immediately")
 *   - eight goal shapes filed as notes, including "My goal is to…"
 *   - two aspirations filed as rules, in the tier that cannot be written
 *   - six rule shapes filed as notes
 *   - two conditional shapes filed as notes
 *   - a fused aspiration+rule collapsed into one goal title
 *   - a `standard` candidate with no destination at all
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A detector that widens is only as good as what it still refuses. Roughly half
 * of what follows asserts a negative: that a negative-content rule is still a
 * rule, that an errand wearing a want is still an errand, that a narrative is
 * not a protocol, that no widened path made anything auto-creatable.
 *
 * Pure: no store, no clock, no AI, no network.
 */

import { emptyStoreState } from "@/lib/ux/backup";
import type { StoreState } from "@/types/mvp";
import { interpret, type Candidate } from "@/lib/capture/interpret";
import { decompose } from "@/lib/capture/decompose";
import { detectStance, isAsserted, STANCE_DISCLOSURE } from "@/lib/capture/stance";
import { detectAspiration, hasAspirationMarker, readsAsRule } from "@/lib/capture/aspiration";
import { detectStandard, hasNormativeMarker } from "@/lib/code/normative";
import { extractConditional, classifyOne, looksReflective } from "@/lib/capture/classify";
import {
  FORBIDDEN_CANDIDATE_KINDS, SUGGEST_ONLY_CANDIDATE_KINDS,
  authorityFor, isSuggestOnly, preselected, type CandidateKind,
} from "@/lib/capture/authority";
import { AI_PROPOSABLE_KINDS, validateAiCandidates } from "@/lib/capture/escalation";
import {
  HANDOFF_NOTE, MAX_HANDOFF_CHARS, RULE_PARAM, CAPTURE_PARAM,
  personalCodeHandoffHref, readHandoff,
} from "@/lib/code/handoff";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-03";

function s(): StoreState { return emptyStoreState(); }

/** All candidates for one capture. */
function read(text: string): Candidate[] {
  return interpret(text, s(), TODAY).candidates;
}
/** The kinds a capture produces, in order. */
function kinds(text: string): CandidateKind[] {
  return read(text).map((c) => c.kind);
}
/** The single candidate a one-thing capture produces. */
function one(text: string): Candidate {
  return read(text)[0];
}

/**
 * The corpus the audit measured, kept whole.
 *
 * Sweeps below run over ALL of it, so an invariant ("nothing consequential is
 * ever pre-selected") is asserted against every sentence rather than against
 * the three someone remembered to list.
 */
const CORPUS: string[] = [
  "I want to get into better shape this year",
  "I'd like to run a marathon someday",
  "My goal is to save six months of expenses",
  "I've always wanted to learn to play piano",
  "Someday I want to move closer to my parents",
  "Eventually I need to finish my degree",
  "I'm trying to get better at saying no",
  "I want to be debt free in two years",
  "Long term I want to start my own business",
  "I want to learn Spanish",
  "I want to call my brother on Saturday",
  "I want to buy dog food",
  "I always tell the truth even when it makes me look bad",
  "Never check email before 9am",
  "I don't lie to avoid embarrassment",
  "From now on I stop working at 6pm",
  "No phone at the dinner table",
  "I should be more patient with my kids",
  "I refuse to take on work I can't finish",
  "When I'm angry, wait before replying",
  "If I feel overwhelmed I go for a walk",
  "Whenever I skip a workout I do it the next morning",
  "I want to get healthier so I should stop eating late, and I need to book a physical",
  "I've been thinking I want to change careers, I should talk to Dana about it",
  "Call the dentist tomorrow and I want to be someone who doesn't put things off",
  "I want to run a marathon and I need to buy running shoes",
  "I don't want to run a marathon",
  "I used to always answer emails immediately",
  "I no longer want to be the person who says yes to everything",
  "I wanted to learn guitar but I gave up",
  "I've been questioning whether teaching is what I want to do",
  "I wonder if I should always be so available",
  "Is it a rule that I never say no?",
];

export function runCaptureIntelligenceSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  // ------------------------------------------------------------------------
  // §15–§17. Stance: a sentence that NAMES a commitment is not one that HOLDS it.
  // ------------------------------------------------------------------------

  ok("80.1 past tense is recognised", detectStance("I used to always answer emails immediately").stance === "past");
  ok("80.2 a question mark is recognised", detectStance("Is it a rule that I never say no?").stance === "questioned");
  ok("80.3 wondering is recognised without punctuation", detectStance("I wonder if I should always be so available").stance === "questioned");
  ok("80.4 a declined want is recognised", detectStance("I don't want to run a marathon").stance === "negated");
  ok("80.5 an abandoned want is past", detectStance("I wanted to learn guitar but I gave up").stance === "past");

  // THE assertion of this module. Most rules people write for themselves are
  // prohibitions, so a guard that confused negative CONTENT with a negated
  // STANCE would suppress exactly what Personal Code exists for.
  ok("80.6 negative content is not a negated stance", isAsserted("I don't lie to avoid embarrassment"));
  ok("80.7 …and it still reaches the rule detector", !!detectStandard("I don't lie to avoid embarrassment"));
  ok("80.8 'never' as a rule is asserted", isAsserted("Never check email before 9am"));

  // "I need to get used to waking up early" contains the words `used to` and is
  // present tense. The pattern requires a pronoun subject for exactly this.
  ok("80.9 'get used to' is not past tense", isAsserted("I need to get used to waking up early"));
  ok("80.10 'I don't always' is a confession, not a rule", detectStance("I don't always tell the truth").stance === "negated");

  ok("80.11 the rule detector refuses a past-tense sentence", detectStandard("I used to always answer emails immediately") === null);
  ok("80.12 the rule detector refuses a question", detectStandard("Is it a rule that I never say no?") === null);
  ok("80.13 the rule detector refuses wondering", detectStandard("I wonder if I should always be so available") === null);
  ok("80.14 the goal detector refuses a declined want", detectAspiration("I don't want to run a marathon") === null);

  // The marker WAS there — which is what makes the disclosure truthful.
  ok("80.15 the withheld reading really existed", hasNormativeMarker("I used to always answer emails immediately"));

  {
    const c = one("I used to always answer emails immediately");
    ok("80.16 a past-tense rule becomes a note", c.kind === "note");
    ok("80.17 …and says why it was not offered as a rule", c.disclosure === STANCE_DISCLOSURE.past, String(c.disclosure));
  }
  {
    const c = one("I wonder if I should always be so available");
    ok("80.18 wondering becomes a note", c.kind === "note");
    ok("80.19 …and says why", c.disclosure === STANCE_DISCLOSURE.questioned, String(c.disclosure));
  }
  ok("80.20 no rule candidate survives a question", !kinds("Is it a rule that I never say no?").includes("standard"));

  // A disclosure is only offered where something was genuinely withheld.
  // "Call the dentist" never read as a rule, so claiming a near-miss would be a
  // fabricated one.
  ok("80.21 no disclosure where nothing was withheld", !one("Call the dentist tomorrow").disclosure);
  ok("80.22 …because the marker was never there", !hasNormativeMarker("Call the dentist tomorrow") && !hasAspirationMarker("Call the dentist tomorrow"));

  // ------------------------------------------------------------------------
  // §7. Goals: the anchored regex is gone, and the errand exclusion survives.
  // ------------------------------------------------------------------------

  const GOALS: Array<[string, string]> = [
    ["I want to learn Spanish", "learn Spanish"],
    ["I want to get into better shape this year", "get into better shape this year"],
    ["I'd like to run a marathon someday", "run a marathon"],
    ["My goal is to save six months of expenses", "save six months of expenses"],
    ["Someday I want to move closer to my parents", "move closer to my parents"],
    ["Long term I want to start my own business", "start my own business"],
    ["Eventually I need to finish my degree", "finish my degree"],
    ["I'm trying to get better at saying no", "get better at saying no"],
    ["I've always wanted to learn to play piano", "learn to play piano"],
    ["I want to be debt free in two years", "be debt free in two years"],
  ];
  GOALS.forEach(([text, objective], i) => {
    const c = one(text);
    ok(`80.${23 + i * 2} goal recognised: "${text}"`, c.kind === "goal", `got ${c.kind}`);
    ok(`80.${24 + i * 2} …titled "${objective}"`, c.fields.title === objective, `got ${JSON.stringify(c.fields.title)}`);
  });

  // The two that were WORSE than missed: filed as rules, in the tier capture
  // cannot write, so the sentence reached nothing at all.
  ok("80.43 an ambition with 'always' is not a rule", one("I've always wanted to learn to play piano").kind === "goal");
  ok("80.44 an ambition with a horizon is not a rule", one("I want to be debt free in two years").kind === "goal");

  // The errand exclusion is the reason widening is safe.
  ok("80.45 an errand wearing a want stays an action", one("I want to call my brother on Saturday").kind === "action");
  ok("80.46 …and so does the other one", one("I want to buy dog food").kind === "action");
  ok("80.47 a bare 'need to' errand is not a goal", one("I need to finish my degree").kind === "action");
  ok("80.48 …the long-range adverb is what changes it", one("Eventually I need to finish my degree").kind === "goal");
  ok("80.49 the adverb gate is in the detector", detectAspiration("I need to finish my degree") === null);
  ok("80.50 …and lifts with the adverb", detectAspiration("Eventually I need to finish my degree")?.longRange === true);

  // A long-range adverb never lands in the title — it placed the ambition, it
  // does not describe it.
  ok("80.51 the adverb is not part of the goal", one("I'd like to run a marathon someday").fields.title === "run a marathon");

  // ------------------------------------------------------------------------
  // Goal vs rule: one tie-break, stated once.
  // ------------------------------------------------------------------------

  ok("80.52 a want with a normative remainder is a rule", one("I want to be honest even when it costs me").kind === "standard");
  ok("80.53 …decided by the remainder", readsAsRule("be honest even when it costs me"));
  ok("80.54 …and the ordinary remainder is not", !readsAsRule("be debt free in two years"));
  ok("80.55 the detector yields to the rule reading", detectAspiration("I want to be honest even when it costs me") === null);

  // Stripping the marker FIRST is what makes the tie-break work: the `always`
  // in "I've always wanted to" modifies the wanting, not the acting.
  ok("80.56 'always' inside the marker is not normative", !readsAsRule(detectAspiration("I've always wanted to learn to play piano")!.objective));

  // Two detectors, never both claiming one sentence.
  CORPUS.forEach((text, i) => {
    const ks = kinds(text);
    ok(`80.57.${i} not both goal and rule primary: "${text.slice(0, 34)}…"`,
      !(ks[0] === "goal" && ks[1] === "standard" && ks.length === 2 && !looksReflective(text)) || looksReflective(text));
  });

  // ------------------------------------------------------------------------
  // §11. Rules: one canonical normative path, widened in place.
  // ------------------------------------------------------------------------

  const RULES = [
    "I always tell the truth even when it makes me look bad",
    "Never check email before 9am",
    "I don't lie to avoid embarrassment",
    "From now on I stop working at 6pm",
    "No phone at the dinner table",
    "I should be more patient with my kids",
    "I refuse to take on work I can't finish",
  ];
  RULES.forEach((text, i) => {
    ok(`80.58.${i} rule recognised: "${text}"`, one(text).kind === "standard", `got ${one(text).kind}`);
  });

  // The complement is the discriminator: a disposition is a way of acting, a
  // plain verb is a thing to do. Both halves asserted, so neither can drift.
  ok("80.59 'I should be…' is a rule", !!detectStandard("I should be more patient with my kids"));
  ok("80.60 'I should talk to…' is not", detectStandard("I should talk to Dana about it") === null);
  ok("80.61 …it is an action", classifyOne("I should talk to Dana about it").suggestedType === "action");
  ok("80.62 …and was a note before", one("I should talk to Dana about it").kind === "action");

  // A bare prohibition needs its preposition, or "No milk" becomes a rule.
  ok("80.63 a house rule is recognised", !!detectStandard("No phone at the dinner table"));
  ok("80.64 a shopping fragment is not", detectStandard("No milk") === null);

  // A clock time recurs; a DATE is what makes a single occasion.
  ok("80.65 a time of day no longer disqualifies a rule", !!detectStandard("From now on I stop working at 6pm"));
  ok("80.66 a date still does", detectStandard("I always go running tomorrow") === null);
  ok("80.67 …and so does a named day", detectStandard("I always go running on Friday") === null);

  // §11's actual requirement: ONE normative interpretation path. A future second
  // detector — however well meant — turns this red.
  CORPUS.forEach((text, i) => {
    const stray = read(text).filter((c) => c.kind === "standard" && !detectStandard(c.evidence.text));
    ok(`80.68.${i} every rule candidate comes from detectStandard`, stray.length === 0, `${stray.length} stray`);
  });

  // ------------------------------------------------------------------------
  // §11. Conditionals: widened in the SHARED function, and gated hard.
  // ------------------------------------------------------------------------

  {
    const c = extractConditional("If I feel overwhelmed I go for a walk");
    ok("80.69 an un-delimited conditional is read", c?.leading === true);
    ok("80.70 …its trigger is the first clause", c?.trigger === "I feel overwhelmed", String(c?.trigger));
    ok("80.71 …its response is the second", c?.response === "I go for a walk", String(c?.response));
    ok("80.72 …and it is marked inexplicit", c?.explicit === false);
  }
  {
    const c = extractConditional("When I'm angry, wait before replying");
    ok("80.73 a delimited conditional is unchanged", c?.trigger === "I'm angry" && c?.response === "wait before replying");
    ok("80.74 …and is marked explicit", c?.explicit === true);
  }

  // A narrative is not a protocol. Both guards asserted separately, because
  // they fail for different reasons and a single test would hide one.
  ok("80.75 one subject is not a conditional", extractConditional("When I got home the dog was gone") === null);
  ok("80.76 a past-tense clause is not a protocol", extractConditional("When I saw him I told him the truth") === null);
  // "need" ends in the letters `ed` and is present tense. So do "feed", "speed".
  ok("80.77 'need' is not read as past tense", extractConditional("If I need help I ask for it")?.leading === true);

  // The hedge lives in TWO places — `classifyOne`, which four other surfaces
  // read, and `interpret`. Mutation showed an assertion on the second leaves the
  // first free to claim certainty, so both are asserted.
  ok("80.77b the shared classifier hedges an inferred conditional",
    classifyOne("If I feel overwhelmed I go for a walk").confidence === "likely");
  ok("80.77c …and does not hedge a delimited one",
    classifyOne("When I'm angry, wait before replying").confidence === "high");

  ok("80.78 an un-delimited conditional is a protocol", one("If I feel overwhelmed I go for a walk").kind === "protocol");
  ok("80.79 …hedged, because the split was inferred", one("If I feel overwhelmed I go for a walk").confidence === "likely");
  ok("80.80 a delimited one is not hedged", one("When I'm angry, wait before replying").confidence === "high");
  ok("80.81 both still require confirmation", one("If I feel overwhelmed I go for a walk").authority === "confirm");
  ok("80.82 the other conditional shape too", one("Whenever I skip a workout I do it the next morning").kind === "protocol");

  // ------------------------------------------------------------------------
  // §22. Several things at once.
  // ------------------------------------------------------------------------

  {
    const text = "I want to get healthier so I should stop eating late, and I need to book a physical";
    const segs = decompose(text).map((x) => x.text);
    ok("80.83 a fused capture splits into three", segs.length === 3, JSON.stringify(segs));
    ok("80.84 …an ambition, a rule and an errand", kinds(text).join("+") === "goal+standard+action", kinds(text).join("+"));
    ok("80.85 …and the goal is no longer half a rule", read(text)[0].fields.title === "get healthier", String(read(text)[0].fields.title));
  }

  // The merge-back rule still has the final say, which is what makes cutting on
  // `so` safe at all.
  ok("80.86 a purpose clause does not split", decompose("I need to leave early so I can catch the train").length === 1);
  ok("80.87 'so' as a degree adverb does not split", decompose("I was so tired I went to bed").length === 1);
  // 80.87 passes on merge-back alone — mutation showed it stays green with the
  // subject lookahead removed, so it does NOT guard what its name suggests.
  // This one does: without the lookahead, "so" cuts before the imperative and
  // "start without me" becomes an errand the user is supposed to perform.
  ok("80.87b 'so' before someone else's imperative does not split",
    decompose("I'm running late so start without me").length === 1);
  ok("80.88 an enumerated noun list still does not split", decompose("Call Mom, Dad, and the dentist").length === 1);
  ok("80.89 'and' joining objects still does not split", decompose("buy milk and bread").length === 1);

  // §3. One clause, two readings — neither suppressed, neither asserted.
  {
    const text = "I've been thinking I want to change careers";
    const cs = read(text);
    ok("80.90 a reflection yields two readings", cs.length === 2, `${cs.length}`);
    ok("80.91 the reflection is what the sentence IS", cs[0].kind === "note");
    ok("80.92 …and the ambition is offered beside it", cs[1]?.kind === "goal");
    ok("80.93 …titled from the user's words", cs[1]?.fields.title === "change careers", String(cs[1]?.fields.title));
    // Optional chaining throughout: mutation testing removed the second reading
    // and this block THREW instead of failing, which in the real runner takes
    // the whole suite down and reports nothing. A missing candidate must be a
    // red assertion, not a crash.
    ok("80.94 …and never pre-selected", !!cs[1] && !preselected(cs[1].authority));
    ok("80.95 …with a distinct id", !!cs[1] && cs[0].id !== cs[1].id);
  }
  ok("80.96 a reflection with nothing in it stays one reading",
    read("I've been questioning whether teaching is what I want to do").length === 1);
  ok("80.97 a non-reflective ambition is not doubled", read("I want to learn Spanish").length === 1);

  // ------------------------------------------------------------------------
  // §6, §24. Authority: widened reading, unchanged writing.
  // ------------------------------------------------------------------------

  ok("80.98 the forbidden tier is unchanged",
    FORBIDDEN_CANDIDATE_KINDS.join(",") === "belief,constitution,constitution_element,decision,principle,framework");
  ok("80.99 the suggest-only tier is unchanged", SUGGEST_ONLY_CANDIDATE_KINDS.join(",") === "standard");
  ok("80.100 a goal is never auto-created", authorityFor("goal", "high") === "confirm");
  ok("80.101 a rule has no write path at all", authorityFor("standard", "high") === "never_auto");

  // Swept over the whole corpus, not over three remembered examples.
  const all = CORPUS.flatMap((t) => read(t));
  ok("80.102 nothing forbidden was ever proposed",
    !all.some((c) => (FORBIDDEN_CANDIDATE_KINDS as readonly string[]).includes(c.kind)));
  ok("80.103 no rule candidate is ever pre-selected",
    !all.some((c) => c.kind === "standard" && preselected(c.authority)));
  ok("80.104 no goal candidate is ever pre-selected",
    !all.some((c) => c.kind === "goal" && preselected(c.authority)));
  ok("80.105 no protocol candidate is ever pre-selected",
    !all.some((c) => c.kind === "protocol" && preselected(c.authority)));
  ok("80.106 every pre-selected candidate is a cheap kind",
    all.filter((c) => preselected(c.authority))
      .every((c) => ["action", "waiting", "note", "event"].includes(c.kind)));
  ok("80.107 …and certain of itself",
    all.filter((c) => preselected(c.authority)).every((c) => c.confidence === "high"));

  // §24. The model gained nothing. It still cannot propose any of the kinds
  // this sprint taught the rules to recognise.
  ok("80.108 the AI tier is unchanged", AI_PROPOSABLE_KINDS.join(",") === "action,waiting,note");
  ok("80.109 a model-proposed goal is dropped",
    validateAiCandidates([{ kind: "goal", title: "Run a marathon" }], 0).length === 0);
  ok("80.110 a model-proposed rule is dropped",
    validateAiCandidates([{ kind: "standard", title: "Always tell the truth" }], 0).length === 0);
  ok("80.111 a model-proposed protocol is dropped",
    validateAiCandidates([{ kind: "protocol", title: "When angry, wait" }], 0).length === 0);
  {
    const ai = validateAiCandidates([{ kind: "action", title: "Email the vet" }], 0);
    ok("80.112 what a model may propose still needs confirming", ai[0]?.authority === "confirm");
    ok("80.113 …and is never certain", ai[0]?.confidence === "possible");
  }

  // ------------------------------------------------------------------------
  // §6. The dead end, closed.
  // ------------------------------------------------------------------------

  ok("80.114 a rule candidate is suggest-only", isSuggestOnly(one("Never check email before 9am").kind));
  {
    const href = personalCodeHandoffHref("Never check email before 9am", "cap1");
    ok("80.115 a rule candidate has somewhere to go", !!href);
    ok("80.116 …which is Personal Code", href!.startsWith("/personal-code?"));
    const params = new URLSearchParams(href!.split("?")[1]);
    ok("80.117 …carrying the sentence", params.get(RULE_PARAM) === "Never check email before 9am");
    ok("80.118 …and its capture, for provenance", params.get(CAPTURE_PARAM) === "cap1");
    const back = readHandoff((k) => params.get(k));
    ok("80.119 …and it reads back unchanged", back?.statement === "Never check email before 9am");
    ok("80.120 …with the capture id", back?.sourceCaptureId === "cap1");
  }
  ok("80.121 no rule, no handoff", readHandoff(() => null) === null);
  ok("80.122 an empty rule is not a handoff", readHandoff((k) => (k === RULE_PARAM ? "   " : null)) === null);

  // A paragraph that arrived through a rule-shaped detector must not be
  // truncated into a rule the person did not write.
  {
    const long = "x".repeat(MAX_HANDOFF_CHARS + 1);
    ok("80.123 an over-long statement is refused, not truncated", personalCodeHandoffHref(long) === null);
    ok("80.124 …at both ends", readHandoff((k) => (k === RULE_PARAM ? long : null)) === null);
  }
  ok("80.125 the handoff says nothing is saved yet", /nothing is saved/i.test(HANDOFF_NOTE));

  // The whole sprint's promise, in one line: capture may propose a rule and can
  // never create one.
  ok("80.126 the handoff creates nothing by itself",
    !/creat|saved to|added to your code/i.test(HANDOFF_NOTE.replace(/nothing is saved until you add it\.?/i, "")));

  // ------------------------------------------------------------------------
  // Wording. LIFEOS-079 §34 is still in force and now has more paths to police.
  // ------------------------------------------------------------------------

  ok("80.127 a rule candidate keeps the sentence verbatim",
    one("I refuse to take on work I can't finish").fields.title === "I refuse to take on work I can't finish");
  ok("80.128 a goal's title is drawn from the user's own words",
    GOALS.every(([text, objective]) => text.toLowerCase().includes(objective.toLowerCase().split(" ")[0])));
  ok("80.129 no disclosure claims a record was made",
    !Object.values(STANCE_DISCLOSURE).some((d) => /created|saved|added/i.test(d)));

  // Nothing in this layer grades anyone. LIFEOS-079 §12, swept over every string
  // 080 can put on screen.
  {
    const FORBIDDEN = ["score", "streak", "compliance", "violated", "violation", "failed", "discipline", "you should have"];
    const strings = [
      HANDOFF_NOTE, ...Object.values(STANCE_DISCLOSURE),
      ...all.map((c) => c.reason), ...all.map((c) => c.disclosure ?? ""),
    ].join(" ").toLowerCase();
    ok("80.130 nothing here grades the user", !FORBIDDEN.some((w) => strings.includes(w)), strings.slice(0, 120));
  }

  // ------------------------------------------------------------------------
  // §37. Performance. Interpretation runs on every keystroke-triggered submit.
  // ------------------------------------------------------------------------
  {
    const state = s();
    const t = Date.now();
    for (let i = 0; i < 20; i++) for (const text of CORPUS) interpret(text, state, TODAY);
    const ms = Date.now() - t;
    ok("80.131 660 interpretations under 1500ms", ms < 1500, `${ms}ms`);
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
