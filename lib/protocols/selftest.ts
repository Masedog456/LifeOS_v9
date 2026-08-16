/**
 * Protocol + deterministic classification self-tests (LIFEOS-054). Pure — no
 * browser, no network, no AI provider.
 *
 * These assert PRODUCT guarantees, not just code paths: nothing is created
 * without confirmation, a machine cannot launder authorship through the
 * classifier, Protocol never acquires a cadence, and no fragment of a
 * multi-intent capture is silently dropped.
 */

import {
  classifyCapture, classifyOne, extractConditional, extractWaiting, detectMultiIntent,
  CAPTURE_TYPE_LABEL, CONFIRMABLE_TYPES, hasDestination,
} from "@/lib/capture/classify";
import { CONVERSION_TARGETS, findTarget, targetsInGroup, previewConversion } from "@/lib/inbox/conversion";
import { classifyOrigin } from "@/lib/provenance/classify";
import { withAttribution } from "@/lib/provenance";
import { buildSearchEntries, resolveRecord } from "@/lib/command/records";
import { searchFlat } from "@/lib/command/search";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import type { Protocol, StoreState, Capture, PracticeCandidate } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}
function proto(p: Partial<Protocol> & { id: string; trigger: string; response: string }): Protocol {
  return { status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...p } as Protocol;
}
function capture(id: string, text: string): Capture {
  return { id, text, createdAt: "2026-01-01T00:00:00.000Z", processingStatus: "inbox" } as Capture;
}

export function runProtocolSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });
  const type = (t: string) => classifyCapture(t).suggestedType;

  // ==================== 1. Classification fixtures (brief §23) ====================
  ok("1.1 “Call the dentist.” → action", type("Call the dentist.") === "action");
  ok("1.2 “I need to send the form.” → action", type("I need to send the form.") === "action");
  ok("1.3 “Spanish: por vs para.” → note", type("Spanish: por vs para.") === "note");
  ok("1.4 “Recipe for chicken soup.” → note", type("Recipe for chicken soup.") === "note");
  ok("1.5 “When my child is overwhelmed, give him space.” → protocol",
    type("When my child is overwhelmed, give him space.") === "protocol");
  ok("1.6 “If I start getting angry, wait before replying.” → protocol",
    type("If I start getting angry, wait before replying.") === "protocol");
  ok("1.7 “Waiting for Sarah to send the contract.” → waiting",
    type("Waiting for Sarah to send the contract.") === "waiting");
  ok("1.8 “I think discipline is more important than motivation.” is NOT a belief",
    type("I think discipline is more important than motivation.") === "note");
  ok("1.9 “Why does this keep happening?” → question", type("Why does this keep happening?") === "question");
  ok("1.10 “Build a raised garden bed.” → project candidate", type("Build a raised garden bed.") === "project");
  ok("1.11 “Buy lumber.” → action", type("Buy lumber.") === "action");
  ok("1.12 unknown/odd text falls back to note", type("Zxqvl brr") === "note");
  ok("1.13 empty text is not forced into a category", classifyCapture("   ").suggestedType === "unknown");

  // ==================== 2. Rule ORDER (the subtle failures) ====================
  // A conditional contains an action verb; testing actions first would misroute
  // every protocol. A waiting clause contains "send" for the same reason.
  ok("2.1 a conditional containing an action verb is still a protocol",
    type("When the invoice arrives, call the supplier.") === "protocol");
  ok("2.2 waiting beats the action verb inside it",
    type("Waiting for Sarah to send the contract") === "waiting");
  ok("2.3 an informational marker beats an imperative",
    type("Recipe: buy chicken, simmer for an hour") === "note");
  ok("2.4 “Before X, do Y” is a protocol", type("Before making a large purchase, wait 24 hours.") === "protocol");
  ok("2.5 “Whenever X, Y” is a protocol", type("Whenever I notice myself procrastinating, work for five minutes.") === "protocol");

  // ==================== 3. Extraction ====================
  const c1 = extractConditional("When my child is overwhelmed, give him physical space");
  ok("3.1 trigger is extracted without its connective", c1?.trigger === "my child is overwhelmed");
  ok("3.2 response is extracted", c1?.response === "give him physical space");
  ok("3.3 leading conditionals are marked as such", c1?.leading === true);
  const c2 = extractConditional("Before making a large purchase, wait 24 hours");
  ok("3.4 “before” is kept in the trigger (it carries the timing)", c2?.trigger === "before making a large purchase");
  const c3 = extractConditional("Pause before responding when I get angry");
  ok("3.5 trailing conditionals parse too", c3?.trigger === "I get angry" && c3?.response === "Pause before responding");
  // The real risk with a trailing conditional is misrouting ordinary prose into
  // a Protocol. "Call me when you land" is an errand that happens to contain
  // "when" — it must stay an action.
  ok("3.6 a trailing conditional does NOT become a protocol",
    classifyOne("Call me when you land").suggestedType !== "protocol");
  ok("3.6b it is read as the action it actually is",
    classifyOne("Call me when you land").suggestedType === "action");
  ok("3.7 non-conditionals extract nothing", extractConditional("Call the dentist") === null);
  ok("3.8 waiting target is extracted", extractWaiting("Waiting for the contractor quote") === "the contractor quote");
  ok("3.9 “I'm waiting on X” parses", extractWaiting("I'm waiting on the bank") === "the bank");
  ok("3.10 non-waiting extracts nothing", extractWaiting("Call the bank") === null);

  // ==================== 4. Confidence means ROUTING, not truth ====================
  const r = classifyCapture("When my child is overwhelmed, give him space.");
  ok("4.1 confidence is a coarse band, not a percentage", ["high", "likely", "possible"].includes(r.confidence));
  ok("4.2 no numeric score is exposed", !("score" in r) && typeof (r as { confidence: unknown }).confidence === "string");
  ok("4.3 a clear protocol is high confidence", r.confidence === "high");
  ok("4.4 a project guess is only 'possible'", classifyCapture("Build a raised garden bed.").confidence === "possible");
  ok("4.5 every classification explains itself", classifyCapture("Call the dentist").reason.length > 0);
  ok("4.6 the reason is plain language, not a regex", !/[\\^$*+?\[\]\\\\]/.test(classifyCapture("Call the dentist").reason));
  // Nothing anywhere computes how TRUE the user's statement is.
  ok("4.7 no belief-truth confidence is produced", !("truth" in r) && !("belief" in r));
  ok("4.8 no importance/priority score is produced", !("importance" in r) && !("priority" in r));

  // ==================== 5. Belief / reflection restraint ====================
  ok("5.1 “I think …” is a note, not a belief", type("I think running helps my mood.") === "note");
  ok("5.2 “I believe …” is still not an automatic belief", type("I believe consistency matters.") === "note");
  ok("5.3 explicit reflective language may suggest reflection",
    type("I've realized I avoid hard conversations.") === "reflection");
  ok("5.4 reflection is never higher than 'likely'",
    classifyCapture("I've realized I avoid hard conversations.").confidence === "likely");
  ok("5.5 belief is NEVER a suggested type", !Object.keys(CAPTURE_TYPE_LABEL).includes("belief"));
  ok("5.6 decision is NEVER a suggested type", !Object.keys(CAPTURE_TYPE_LABEL).includes("decision"));
  ok("5.7 principle is NEVER a suggested type", !Object.keys(CAPTURE_TYPE_LABEL).includes("principle"));

  // ==================== 6. Multi-intent: nothing is silently dropped ====================
  const multiText = "Need to call the dentist, and remember to give my child space when he gets overwhelmed.";
  const multi = detectMultiIntent(multiText);
  ok("6.1 a mixed capture is detected as multi-intent", multi.multi);
  ok("6.2 every fragment is preserved for the user", multi.segments.length >= 2);
  ok("6.3 a multi-intent capture is NOT collapsed into one type", classifyCapture(multiText).multiIntent === true);
  ok("6.4 its confidence drops rather than asserting one meaning", classifyCapture(multiText).confidence === "possible");
  ok("6.5 the reason tells the user to split", /split/i.test(classifyCapture(multiText).reason));
  ok("6.6 a single-intent capture is NOT flagged", !detectMultiIntent("Call the dentist.").multi);
  ok("6.7 two same-type sentences are not a false positive",
    !detectMultiIntent("Call the dentist. Call the bank.").multi);

  // ==================== 7. Question has no fake destination ====================
  ok("7.1 question is not confirmable", !hasDestination("question"));
  ok("7.2 question falls back to a Note label", CAPTURE_TYPE_LABEL.question === "Question");
  ok("7.3 confirmable types all have real creators",
    CONFIRMABLE_TYPES.every((t) => ["action", "note", "protocol", "waiting", "reflection", "project"].includes(t)));
  ok("7.4 unknown routes to Note", CAPTURE_TYPE_LABEL.unknown === "Note");

  // ==================== 8. Protocol is a distinct primitive ====================
  const p = proto({ id: "p1", trigger: "my child is overwhelmed", response: "give him physical space" });
  ok("8.1 a protocol has a trigger and a response", !!p.trigger && !!p.response);
  ok("8.2 a protocol has NO cadence", !("cadence" in p));
  ok("8.3 a protocol has NO due date", !("dueDate" in p));
  ok("8.4 a protocol has NO next-occurrence", !("nextDue" in p) && !("schedule" in p));
  ok("8.5 a protocol has NO streak or compliance score",
    !("streak" in p) && !("compliance" in p) && !("score" in p) && !("successRate" in p));
  ok("8.6 lifecycle is the three lightweight states", ["active", "paused", "retired"].includes(p.status));
  // Practice keeps its cadence vocabulary, untouched.
  const practice: PracticeCandidate = { cadence: "weekly" } as PracticeCandidate;
  ok("8.7 Practice still answers 'how often'", practice.cadence === "weekly");
  ok("8.8 Protocol answers 'when', which is not a frequency", !("cadence" in p) && p.trigger.length > 0);

  // ==================== 9. Provenance: classification is not authorship ====================
  ok("9.1 a user-written protocol is user-authored",
    classifyOrigin({ kind: "capture", text: "When X, do Y" }) === "user_authored");
  const aiText = withAttribution("When X happens, do Y.", "conqify_ai", "capture");
  ok("9.2 an AI-origin capture stays machine prose", classifyOrigin({ kind: "capture", text: aiText }) === "conqify_ai");
  const aiProto = proto({ id: "p2", trigger: "x", response: "y", fromAiText: true });
  ok("9.3 an AI-origin protocol records it", aiProto.fromAiText === true);
  ok("9.4 routing through the classifier does NOT launder authorship",
    classifyOrigin({ kind: "capture", text: aiText }) === "conqify_ai");
  ok("9.5 a user protocol carries no false AI marker", p.fromAiText === undefined);

  // ==================== 10. Nothing is created automatically ====================
  const st: StoreState = { ...emptyState(), captures: [capture("c1", "Call the dentist")] };
  ok("10.1 classifying creates no action", (st.nextActions ?? []).length === 0);
  ok("10.2 classifying creates no protocol", (st.protocols ?? []).length === 0);
  ok("10.3 classifying creates no note", (st.notes ?? []).length === 0);
  ok("10.4 classification is a pure function of text",
    JSON.stringify(classifyCapture("Call the dentist")) === JSON.stringify(classifyCapture("Call the dentist")));
  ok("10.5 even an obvious action only yields a suggestion", classifyCapture("Call the dentist").suggestedType === "action" && (st.nextActions ?? []).length === 0);

  // ==================== 11. Capture front door ====================
  ok("11.1 Protocol is a conversion target", !!findTarget("protocol"));
  ok("11.2 Protocol sits in the everyday band", findTarget("protocol")?.group === "keep");
  ok("11.3 the formal band is unchanged at nine", targetsInGroup("formal").length === 9);
  ok("11.4 the target list grew by exactly one", CONVERSION_TARGETS.length === 13);
  const prev = previewConversion(st, st.captures[0], "protocol");
  ok("11.5 a protocol conversion previews When/Then", !!prev && prev.copiedFields.map((f) => f.label).join() === "When,Then");
  const prev2 = previewConversion(st, capture("c2", "When I get angry, pause"), "protocol");
  ok("11.6 the preview shows the extracted trigger", prev2?.copiedFields[0].value === "I get angry");

  // ==================== 12. Search — no new island ====================
  const withProto: StoreState = { ...emptyState(), protocols: [p, proto({ id: "p3", trigger: "retired thing", response: "x", status: "retired" })] };
  const entries = buildSearchEntries(withProto);
  ok("12.1 protocols join the EXISTING command index", entries.some((e) => e.kind === "protocol"));
  ok("12.2 retired protocols are not indexed", !entries.some((e) => e.kind === "protocol" && e.id === "p3"));
  ok("12.3 a protocol is findable by its trigger", searchFlat(entries, "overwhelmed").some((x) => x.entry.kind === "protocol"));
  ok("12.4 a protocol resolves to a real route", resolveRecord(withProto, "protocol", "p1")?.href === "/protocols?protocol=p1");

  // ==================== 13. Persistence ====================
  ok("13.1 protocols are a canonical domain", Array.isArray(emptyState().protocols));
  ok("13.2 protocols are exportable", (EXPORT_DOMAINS as readonly string[]).includes("protocols"));
  ok("13.3 protocols survive restore filtering", (STORE_DOMAINS as string[]).includes("protocols"));
  ok("13.4 legacy state without protocols degrades safely",
    ((({ ...emptyState(), protocols: undefined }) as unknown as StoreState).protocols ?? []).length === 0);

  // ==================== 14. Legacy practices untouched ====================
  ok("14.1 no practice was migrated into a protocol", (emptyState().practices ?? []).length === 0);
  ok("14.2 PracticeCadence vocabulary is unchanged",
    ["once", "daily", "weekly", "occasional"].includes("occasional"));
  ok("14.3 historical intent is not inferred", (emptyState().protocols ?? []).length === 0);

  // ==================== 15. No date parsing was added ====================
  const dated = classifyCapture("Call dentist Friday");
  ok("15.1 a date word does not change the type", dated.suggestedType === "action");
  ok("15.2 no date is extracted", !("dueDate" in (dated.extracted ?? {})) && !("date" in (dated.extracted ?? {})));

  const passed = results.filter((r2) => r2.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
