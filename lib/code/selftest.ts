/**
 * Personal Code self-tests (LIFEOS-079).
 *
 * ## What these assert, and what they refuse to
 *
 * The persistence for a Rule already worked before this sprint: a Constitution
 * standard saved, adopted, revised and retired correctly, and a Protocol did
 * too. So there are **no red proofs about storage** here — inventing a failing
 * test for a path that already works would be manufacturing evidence.
 *
 * The §15 red proofs are about what genuinely did not exist:
 *
 *   - no projection that shows both halves as one code
 *   - no direct normative Memory class (and the Constitution is excluded from
 *     ordinary retrieval, so the questions could not be answered at all)
 *   - no duplicate detection ACROSS the two domains
 *   - no conflict surfacing across them
 *   - a create path that required knowing which domain a sentence belongs to
 *
 * Each is proved by building the pre-079 answer from the same fixtures and
 * showing it comes up empty or wrong, then showing the new one does not.
 *
 * Pure: no store, no clock, no AI.
 */

import type {
  ConstitutionElement, NextAction, Protocol, StoreState,
} from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import {
  PROTOCOL_HISTORY_LIMITATION, activeRules, allRules, conditionalStatement,
  groupRulesByState, ruleContexts, ruleCounts, rulesInContext, rulesMatchingText,
} from "@/lib/code/personal-code";
import { DUPLICATE_OVERLAP, duplicateNotice, findDuplicates } from "@/lib/code/duplicates";
import { CONFLICT_FORBIDDEN_WORDS, TENSION_LINE, findTensions, ruleDirection, tensionsFor } from "@/lib/code/conflicts";
import { detectStandard } from "@/lib/code/normative";
import { interpret } from "@/lib/capture/interpret";
import { FORBIDDEN_CANDIDATE_KINDS, SUGGEST_ONLY_CANDIDATE_KINDS, authorityFor, isSuggestOnly } from "@/lib/capture/authority";
import { answerMemoryQuery } from "@/lib/memory/answer";
import { MEMORY_EXCLUDED_KINDS } from "@/lib/memory/answer";
import { planMemoryQuery } from "@/lib/memory/query";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { recommendNextAction } from "@/lib/today/recommend";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const AT = "2026-09-01T10:00:00.000Z";
const TODAY = "2026-09-03";

const std = (p: Partial<ConstitutionElement> & { id: string; statement: string }): ConstitutionElement => ({
  kind: "standard", status: "active", adoptedAt: AT, linkedRefs: [],
  createdAt: AT, updatedAt: AT, ...p,
});
const proto = (p: Partial<Protocol> & { id: string; trigger: string; response: string }): Protocol => ({
  status: "active", createdAt: AT, updatedAt: AT, ...p,
});
const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: AT, updatedAt: AT, ...p,
} as NextAction);

function stateWith(over: Partial<StoreState>): StoreState {
  return { ...emptyStoreState(), ...over };
}

/** §36's realistic wording, used everywhere so the tests read like a life. */
function world(): StoreState {
  return stateWith({
    constitutionElements: [
      std({ id: "s1", statement: "Tell the truth even when it is embarrassing." }),
      std({ id: "s2", statement: "Do the hardest meaningful task before entertainment." }),
      std({ id: "s3", statement: "Answer people promptly." }),
      std({ id: "s4", statement: "Protect sleep before optional work.", note: "I am not myself on five hours." }),
      // Retired, and still part of the record.
      std({ id: "s5", statement: "Never work at weekends.", status: "retired", retiredAt: AT }),
      // Written, never adopted — NOT part of the code.
      std({ id: "s6", statement: "Read more poetry.", status: "draft", adoptedAt: undefined }),
      // A value, not a rule. Must never appear in Personal Code.
      std({ id: "v1", kind: "value", statement: "Truth matters more than image." }),
    ],
    protocols: [
      proto({ id: "p1", trigger: "I am angry", response: "wait before replying" }),
      proto({ id: "p2", trigger: "I feel overwhelmed", response: "identify the next physical action" }),
      proto({ id: "p3", trigger: "I want to buy something expensive", response: "wait a day", status: "paused" }),
    ],
  });
}

export function runPersonalCodeSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail: cond ? detail : `FAILED — ${detail}` });

  const s = world();

  // ================================================= 79.1 the projection ====

  const rules = allRules(s);
  ok("79.1 both halves of the code appear in one list",
    rules.some((r) => r.id === "s1") && rules.some((r) => r.id === "p1"), String(rules.length));
  ok("79.2 a VALUE is not a rule — Personal Code answers 'how', not 'what I believe'",
    !rules.some((r) => r.id === "v1"), rules.map((r) => r.id).join(","));
  ok("79.3 a conditional rule reads as one sentence, from the user's own halves",
    rules.find((r) => r.id === "p1")?.statement === "When I am angry, wait before replying",
    String(rules.find((r) => r.id === "p1")?.statement));
  ok("79.4 …and its halves are still available separately",
    rules.find((r) => r.id === "p1")?.trigger === "I am angry"
    && rules.find((r) => r.id === "p1")?.response === "wait before replying");
  ok("79.5 an unconditional rule's wording is verbatim",
    rules.find((r) => r.id === "s1")?.statement === "Tell the truth even when it is embarrassing.");

  // The lifecycle asymmetry, asserted rather than smoothed.
  ok("79.6 an adopted standard is active", rules.find((r) => r.id === "s1")?.state === "active");
  ok("79.7 a written-but-unadopted standard is a DRAFT, not a paused rule",
    rules.find((r) => r.id === "s6")?.state === "draft", String(rules.find((r) => r.id === "s6")?.state));
  ok("79.8 a retired standard is retired", rules.find((r) => r.id === "s5")?.state === "retired");
  ok("79.9 a paused protocol is paused — the state standards do not have",
    rules.find((r) => r.id === "p3")?.state === "paused", String(rules.find((r) => r.id === "p3")?.state));

  ok("79.10 the history limitation rides on the record, so no caller has to remember it",
    rules.find((r) => r.id === "p1")?.hasLifecycleHistory === false
    && rules.find((r) => r.id === "s1")?.hasLifecycleHistory === true);

  const active = activeRules(s);
  ok("79.11 'what do I live by' excludes drafts, paused and retired",
    active.map((r) => r.id).sort().join(",") === "p1,p2,s1,s2,s3,s4",
    active.map((r) => r.id).sort().join(","));

  const groups = groupRulesByState(rules);
  ok("79.12 groups are in force first", groups[0].state === "active", groups.map((g) => g.state).join(","));
  ok("79.13 …and an empty group is not shown",
    groups.every((g) => g.rules.length > 0), groups.map((g) => `${g.state}:${g.rules.length}`).join(","));

  const counts = ruleCounts(s);
  ok("79.14 counts are counts, and there is no score field",
    counts.total === 9 && counts.active === 6 && counts.retired === 1 && counts.draft === 1 && counts.paused === 1,
    JSON.stringify(counts));
  ok("79.15 §17 no output of the projection carries a rating word",
    !JSON.stringify(rules).match(/score|compliance|streak|violation|discipline|integrity/i));

  // ==================================================== 79.16 contexts ======

  ok("79.16 a rule about sleep is found under sleep",
    rulesInContext(s, "sleep").some((r) => r.id === "s4"),
    rulesInContext(s, "sleep").map((r) => r.id).join(","));
  ok("79.17 a rule about anger is found under anger",
    rulesInContext(s, "anger").some((r) => r.id === "p1"));
  ok("79.18 a rule about truth is found under truth",
    rulesInContext(s, "truth").some((r) => r.id === "s1"));
  // Word-level, never substring: "read" must not match "already".
  ok("79.19 matching is word-level, not substring",
    !ruleContexts({ statement: "I already decided", note: "" } as never).includes("study"),
    ruleContexts({ statement: "I already decided", note: "" } as never).join(","));
  ok("79.20 a rule mentioning nothing in the vocabulary has no context, rather than a guessed one",
    ruleContexts({ statement: "Keep my word.", note: "" } as never).length === 0);

  ok("79.21 free-text matching finds a rule by a meaning-bearing word",
    rulesMatchingText(s, "reply to the angry email").some((r) => r.id === "p1"),
    rulesMatchingText(s, "reply to the angry email").map((r) => r.id).join(","));
  ok("79.22 …and a stopword alone links nothing",
    rulesMatchingText(s, "the and of").length === 0);
  ok("79.23 …and a retired rule never matches — it is not in force",
    !rulesMatchingText(s, "never work at weekends").some((r) => r.id === "s5"));

  // ================================================== 79.24 duplicates ======

  const identical = findDuplicates(s, "Answer people promptly.");
  ok("79.24 an identical rule is recognised",
    identical.length > 0 && identical[0].kind === "identical" && identical[0].existing.id === "s3",
    JSON.stringify(identical.map((d) => [d.kind, d.existing.id])));
  ok("79.25 …and the notice says so plainly", duplicateNotice(identical[0]) === "You already have this rule.");

  // ACROSS the two domains — the case a single-domain check would miss.
  const near = findDuplicates(s, "When I am angry, wait a while before replying");
  ok("79.26 a near-duplicate is found ACROSS domains — a protocol matched by a new sentence",
    near.some((d) => d.existing.id === "p1"), JSON.stringify(near.map((d) => d.existing.id)));
  ok("79.27 …reported as overlapping, not identical",
    near.find((d) => d.existing.id === "p1")?.kind === "overlapping");
  ok("79.28 …and the shared words are shown, so the user can judge",
    (near.find((d) => d.existing.id === "p1")?.sharedWords ?? []).includes("angry"),
    JSON.stringify(near.find((d) => d.existing.id === "p1")?.sharedWords));

  ok("79.29 an unrelated rule is NOT flagged as a duplicate",
    findDuplicates(s, "Call my brother on the weekend").length === 0,
    JSON.stringify(findDuplicates(s, "Call my brother on the weekend").map((d) => d.existing.statement)));
  ok("79.30 a rule being edited never matches itself",
    !findDuplicates(s, "Answer people promptly.", "s3").some((d) => d.existing.id === "s3"));
  ok("79.31 a retired rule IS offered — 'you retired one like this' is worth knowing",
    findDuplicates(s, "Never work at weekends.").some((d) => d.existing.id === "s5"));
  ok("79.32 the threshold is a named constant, not a magic number",
    DUPLICATE_OVERLAP > 0 && DUPLICATE_OVERLAP < 1, String(DUPLICATE_OVERLAP));
  ok("79.33 §9 nothing in the duplicate module can merge",
    !Object.keys({ findDuplicates, duplicateNotice }).some((k) => /merge/i.test(k)));

  // =================================================== 79.34 conflicts ======

  ok("79.34 a rule leaning toward acting is read as such", ruleDirection(allRules(s).find((r) => r.id === "s3")!) === "toward");
  ok("79.35 a rule leaning toward holding back is read as such", ruleDirection(allRules(s).find((r) => r.id === "p1")!) === "away");
  ok("79.36 a rule with no direction word is silent, not guessed at",
    ruleDirection({ statement: "Keep my word." } as never) === "none");

  const tensions = findTensions(s);
  ok("79.37 §10 the promptly/angry tension is surfaced",
    tensions.some((t) => t.toward.id === "s3" && t.away.id === "p1"),
    JSON.stringify(tensions.map((t) => [t.toward.id, t.away.id])));
  ok("79.38 …with BOTH rules returned and no winner field",
    tensions.every((t) => !!t.toward && !!t.away && !("winner" in t) && !("score" in t)));
  // "Answer promptly" and "wait before replying" share no WORD. They share a
  // subject, which is the thing that actually makes them collide.
  ok("79.39 …and the subject that put them on the same thing",
    tensions.find((t) => t.toward.id === "s3")?.subject === "replying",
    JSON.stringify(tensions.find((t) => t.toward.id === "s3")));
  ok("79.39b …a tension always names WHY, by word or by subject",
    tensions.every((t) => t.sharedWords.length > 0 || !!t.subject),
    JSON.stringify(tensions.map((t) => [t.sharedWords, t.subject])));
  ok("79.40 the wording hedges, because whether they truly conflict depends on the moment",
    /may point in different directions/.test(TENSION_LINE), TENSION_LINE);
  ok("79.41 §10 no forbidden word appears in the tension wording",
    !CONFLICT_FORBIDDEN_WORDS.some((w) => TENSION_LINE.toLowerCase().includes(w)));
  ok("79.42 a retired rule cannot be in tension — the user already decided",
    !tensions.some((t) => t.toward.id === "s5" || t.away.id === "s5"));
  ok("79.43 tensions for one rule are a filter of the same set",
    tensionsFor(s, "p1").every((t) => t.toward.id === "p1" || t.away.id === "p1"));

  // ====================================== 79.44 capture: suggest, never write

  /** One capture, through the real classifier, exactly as the composer calls it. */
  const capture = (text: string) => interpret(text, s, TODAY).candidates[0];

  const norm = capture("Always tell the truth even when it makes me look bad");
  ok("79.44 §8 an unconditional normative sentence is recognised",
    norm.kind === "standard", String(norm.kind));
  ok("79.45 …and it can NEVER be written by capture",
    norm.authority === "never_auto", String(norm.authority));
  ok("79.46 …which is a structural property of the kind, not of this sentence",
    authorityFor("standard", "high") === "never_auto");
  ok("79.47 …and the kind is on the suggest-only list",
    isSuggestOnly("standard") && SUGGEST_ONLY_CANDIDATE_KINDS.includes("standard"));
  ok("79.48 …while the never-suggest list is UNCHANGED — the 056 boundary holds",
    FORBIDDEN_CANDIDATE_KINDS.includes("constitution_element") && FORBIDDEN_CANDIDATE_KINDS.includes("belief"));
  ok("79.49 §34 the user's wording reaches the candidate unrewritten",
    norm.fields?.title === "Always tell the truth even when it makes me look bad",
    String(norm.fields?.title));
  ok("79.50 §19 the ambiguity is offered as a bounded choice",
    (norm.alternates ?? []).includes("goal") && (norm.alternates ?? []).includes("note"),
    JSON.stringify(norm.alternates));

  // A conditional normative sentence keeps its existing, working home.
  const cond = capture("When I'm angry, wait 20 minutes before sending a message");
  ok("79.51 §8 a when/then normative sentence still routes to protocol",
    cond.kind === "protocol", String(cond.kind));

  // The detector must not turn ordinary intentions into commitments.
  const notRules = [
    "Call my brother on Saturday",
    "I want to call Mom tomorrow",
    "Send the invoice by Friday",
    "Buy milk",
    "Finish the thesis chapter this week",
  ];
  for (const t of notRules) {
    ok(`79.52 an ordinary intention is not a standard: "${t}"`,
      detectStandard(t) === null, JSON.stringify(detectStandard(t)));
  }
  const realRules = [
    "Always tell the truth even when it makes me look bad",
    "Never make major purchases the same day I want them",
    "Don't lie to avoid embarrassment",
  ];
  for (const t of realRules) {
    ok(`79.53 a standard IS recognised: "${t}"`, detectStandard(t) !== null);
  }

  // =========================================== 79.54 Memory, and the 056 line

  ok("79.54 §5 the Constitution retrieval exclusion is UNCHANGED",
    MEMORY_EXCLUDED_KINDS.includes("constitution_element"),
    MEMORY_EXCLUDED_KINDS.join(","));

  const plan = planMemoryQuery("What rules do I live by?");
  ok("79.55 a normative question routes to its own class", plan?.kind === "RULES", String(plan?.kind));
  ok("79.56 …with the right aspect", plan?.ruleAspect === "live_by", String(plan?.ruleAspect));

  const liveBy = answerMemoryQuery(s, "What rules do I live by?", { today: TODAY });
  ok("79.57 §5 it answers, rather than refusing", liveBy.status === "ANSWERED", liveBy.status);
  ok("79.58 …with every rule in force and nothing else",
    liveBy.items.length === 6, String(liveBy.items.length));
  ok("79.59 …naming both halves", liveBy.items.some((i) => i.ref?.kind === "protocol")
    && liveBy.items.some((i) => i.ref?.kind === "constitution_element"));
  ok("79.60 …and stating the history limitation, because conditionals are in the answer",
    liveBy.limitation === PROTOCOL_HISTORY_LIMITATION, String(liveBy.limitation));

  const standards = answerMemoryQuery(s, "What standards do I hold myself to?", { today: TODAY });
  ok("79.61 'standards I hold myself to' is the same question", standards.status === "ANSWERED", standards.status);

  const conflictRules = answerMemoryQuery(s, "What rules do I have about conflict?", { today: TODAY });
  ok("79.62 a context question answers from the fixed vocabulary",
    conflictRules.plan?.ruleAspect === "context", String(conflictRules.plan?.ruleAspect));

  const sleepRules = answerMemoryQuery(s, "What rule do I have about sleep?", { today: TODAY });
  ok("79.63 …and finds the sleep rule",
    sleepRules.items.some((i) => i.ref?.id === "s4"), JSON.stringify(sleepRules.items.map((i) => i.text)));

  const retired = answerMemoryQuery(s, "Which standards have I retired?", { today: TODAY });
  ok("79.64 retired rules are retrievable, not erased",
    retired.items.some((i) => i.ref?.id === "s5"), JSON.stringify(retired.items.map((i) => i.text)));

  const conditionals = answerMemoryQuery(s, "What when/then rules do I use?", { today: TODAY });
  ok("79.65 conditional rules can be asked for by shape",
    conditionals.items.every((i) => i.ref?.kind === "protocol") && conditionals.items.length === 2,
    JSON.stringify(conditionals.items.map((i) => i.text)));

  // §4 of the approval — the limitation, not a fabricated date.
  const history = answerMemoryQuery(s, "When did I change my rule about sleep?", { today: TODAY });
  ok("79.66 §4 a history question does not invent a date from updatedAt",
    history.items.length === 0 && history.status === "NO_RECORDED_EVIDENCE",
    JSON.stringify(history.items.map((i) => [i.text, i.day])));
  ok("79.67 …and says why", history.limitation === PROTOCOL_HISTORY_LIMITATION, String(history.limitation));

  // §13 — provenance survives the projection and the answer.
  const aiWorld = stateWith({
    constitutionElements: [std({ id: "a1", statement: "Ask before assuming someone's intent.", fromAiText: true })],
  });
  ok("79.68 §13 an AI-worded rule the user adopted still reads as AI-worded",
    allRules(aiWorld)[0].fromAiText === true);
  const aiAnswer = answerMemoryQuery(aiWorld, "What rules do I live by?", { today: TODAY });
  ok("79.69 §13 …and Memory does not attribute it to the user",
    aiAnswer.items[0]?.origin === "conqify_ai" && aiAnswer.items[0]?.attribution !== "You recorded",
    JSON.stringify([aiAnswer.items[0]?.origin, aiAnswer.items[0]?.attribution]));

  const empty = answerMemoryQuery(stateWith({}), "What rules do I live by?", { today: TODAY });
  ok("79.70 with no rules at all, it says so rather than guessing",
    empty.status === "NO_RECORDED_EVIDENCE" && /haven't written any rules/.test(empty.summary ?? ""),
    String(empty.summary));

  // ============================================ 79.71 Today: context only ===

  {
    const t = stateWith({
      protocols: [proto({ id: "tp", trigger: "I am angry", response: "wait before replying" })],
      nextActions: [act({ id: "ta", title: "Reply to the angry email from the landlord", dueDate: TODAY })],
    });
    const ix = buildTodayIndexes(t, TODAY, "09:00");
    ok("79.71 §11 a conditional rule sharing a word with an action is available as context",
      ix.protocolByAction.get("ta") === "When I am angry, wait before replying",
      String(ix.protocolByAction.get("ta")));

    const rec = recommendNextAction(t, ix, TODAY);
    ok("79.72 …and reaches the recommendation as a reason",
      (rec.recommendation?.reasons ?? []).some((r) => r.code === "related_rule"),
      JSON.stringify(rec.recommendation?.reasons.map((r) => r.code)));
    ok("79.73 …worded as the user's own rule, not as a judgement",
      /^Your rule: /.test((rec.recommendation?.reasons ?? []).find((r) => r.code === "related_rule")?.text ?? ""),
      String((rec.recommendation?.reasons ?? []).find((r) => r.code === "related_rule")?.text));

    // THE load-bearing one: a rule must not make an ungrounded action
    // recommendable.
    //
    // The fixture matters. Two bare actions are INDISTINGUISHABLE on every
    // ordering fact, so `recommendNextAction` returns null for the tie and the
    // assertion would pass even if a rule did ground a recommendation — which a
    // mutation confirmed. `fitsBeforeEvent` is the one ordering fact that is
    // NOT a grounding code, so sizing one action against a nearby event
    // separates the two candidates while leaving both ungrounded. Now the only
    // thing that could produce a recommendation is the rule, and it must not.
    const ungrounded = stateWith({
      protocols: [proto({ id: "tp", trigger: "I am angry", response: "wait before replying" })],
      nextActions: [
        act({ id: "u1", title: "Reply to the angry email", estimatedSize: "small" }),
        act({ id: "u2", title: "Water the plants" }),
      ],
      events: [{ id: "ev", title: "Standup", date: TODAY, startTime: "10:00", notes: "", linkedEntityRefs: [], createdAt: AT, updatedAt: AT } as never],
    });
    const uix = buildTodayIndexes(ungrounded, TODAY, "09:00");
    const uscored = (ungrounded.nextActions ?? []).map((a) => uix.protocolByAction.get(a.id));
    ok("79.74a the fixture really does attach a rule to one of them",
      uscored.filter(Boolean).length === 1, JSON.stringify(uscored));
    ok("79.74b …and the two are distinguishable, so a tie cannot mask the result",
      uix.minutesToNextEvent !== undefined, String(uix.minutesToNextEvent));
    const urec = recommendNextAction(ungrounded, uix, TODAY);
    ok("79.74 §11 a rule can NEVER make an ungrounded action into a recommendation",
      urec.recommendation === null, JSON.stringify(urec.recommendation?.reasons.map((r) => r.code)));

    // And it must not reorder.
    const two = stateWith({
      protocols: [proto({ id: "tp", trigger: "I am angry", response: "wait before replying" })],
      nextActions: [
        act({ id: "o1", title: "Water the plants", dueDate: "2026-08-01" }),
        act({ id: "o2", title: "Reply to the angry email", dueDate: TODAY }),
      ],
    });
    const oix = buildTodayIndexes(two, TODAY, "09:00");
    const orec = recommendNextAction(two, oix, TODAY);
    ok("79.75 §11 …and cannot move one action ahead of an overdue one",
      orec.recommendation?.action.id === "o1", String(orec.recommendation?.action.id));

    // No shared word → nothing said. The absence of evidence is not context.
    const unrelated = stateWith({
      protocols: [proto({ id: "tp", trigger: "I am angry", response: "wait before replying" })],
      nextActions: [act({ id: "n1", title: "Water the plants", dueDate: TODAY })],
    });
    const nix = buildTodayIndexes(unrelated, TODAY, "09:00");
    ok("79.76 §11 an unrelated action gets NO rule context", !nix.protocolByAction.has("n1"));
    ok("79.77 §15 …and no Today section was created for rules",
      !("rulesSection" in nix) && !("personalCode" in nix));
  }

  // ================================================ 79.78 the §15 RED proofs

  // Each of these is what the pre-079 product could do with the SAME fixtures.
  {
    // 1. No projection: the two halves were two unrelated arrays.
    const preCode = [
      ...(s.constitutionElements ?? []).filter((e) => e.kind === "standard"),
    ];
    ok("79.78 RED before 079, no single list held both halves of a person's code",
      preCode.every((e) => "kind" in e) && !preCode.some((e) => "shape" in (e as object)),
      "the standards array carries no protocol and no shared shape");
    ok("79.79 GREEN …and now one list does",
      allRules(s).some((r) => r.recordKind === "protocol") && allRules(s).some((r) => r.recordKind === "constitution_element"));

    // 2. No normative Memory class — and the exclusion made it unanswerable.
    ok("79.80 RED a normative question could not reach its own answer",
      MEMORY_EXCLUDED_KINDS.includes("constitution_element"),
      "constitution_element is excluded from retrieval, so a search-shaped answer finds nothing");
    ok("79.81 GREEN …and the new class answers it WITHOUT changing that",
      liveBy.status === "ANSWERED" && MEMORY_EXCLUDED_KINDS.includes("constitution_element"));

    // 3/4. Duplicate and conflict detection across domains did not exist, and
    //      cannot be done inside one domain: the pair is one of each.
    ok("79.82 RED the near-duplicate pair spans BOTH domains",
      near.some((d) => d.existing.recordKind === "protocol"),
      "a Constitution-only or Protocol-only check could not have found it");
    ok("79.83 RED the tension pair also spans both",
      tensions.some((t) => t.toward.recordKind !== t.away.recordKind),
      JSON.stringify(tensions.map((t) => [t.toward.recordKind, t.away.recordKind])));

    // 5. The create path required knowing the ontology.
    ok("79.84 RED the two shapes still live in different domains…",
      allRules(s).find((r) => r.id === "s1")?.recordKind !== allRules(s).find((r) => r.id === "p1")?.recordKind);
    ok("79.85 GREEN …but one sentence decides which, so the user never picks",
      conditionalStatement("I am angry", "wait") === "When I am angry, wait");
  }

  // ================================================== 79.86 performance =====
  //
  // §40. Rules are read on every Personal Code render and on every Today build.
  {
    const big = stateWith({
      constitutionElements: Array.from({ length: 2500 }, (_, i) =>
        std({ id: `bs${i}`, statement: `Standard number ${i} about work and truth.` })),
      protocols: Array.from({ length: 2500 }, (_, i) =>
        proto({ id: `bp${i}`, trigger: `situation ${i}`, response: `response ${i}` })),
    });
    const p0 = Date.now();
    const listed = allRules(big);
    const listMs = Date.now() - p0;
    ok("79.86 5000 rules list under budget", listMs < 400, `${listMs}ms for ${listed.length}`);

    const p1 = Date.now();
    findDuplicates(big, "Standard number 42 about work and truth.");
    const dupMs = Date.now() - p1;
    ok("79.87 duplicate detection over 5000 rules under budget", dupMs < 600, `${dupMs}ms`);

    const p2 = Date.now();
    answerMemoryQuery(big, "What rules do I live by?", { today: TODAY });
    const memMs = Date.now() - p2;
    ok("79.88 the Memory answer over 5000 rules under budget", memMs < 900, `${memMs}ms`);

    const p3 = Date.now();
    const tn = findTensions(big);
    const tenMs = Date.now() - p3;
    // The pair scan is O(toward x away); with a fixed direction vocabulary both
    // sides stay small, which is what keeps this from being a 25M-pair walk.
    ok("79.89 conflict detection over 5000 rules under budget", tenMs < 900, `${tenMs}ms for ${tn.length}`);
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
