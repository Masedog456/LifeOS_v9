/**
 * Provenance self-tests (LIFEOS-050). Pure and deterministic — no browser, no
 * network, no AI. Surfaced at `/dev/provenance-tests`.
 *
 * These exist to prove the one invariant the product depends on: **AI prose can
 * never become evidence of what a source says**, no matter which record type it
 * is saved into.
 */

import {
  ORIGIN_TYPES, ORIGIN_LABEL, groundingAuthority, canGroundSource, canGroundSelf,
  isMachineProduced, isAiGenerated, lineagePreservesSource, lineageRoots,
  effectiveOrigin, recordGrounding, sourceGroundableSegments,
  withAttribution, detectAttribution, attributionPrefix,
  type OriginType, type Provenance, type LineageLink,
} from "@/lib/provenance";
import { classifyOrigin, classifyLegacy, AMBIGUOUS_KINDS, isStructurallyUserAuthored, isStructurallySource, practiceSourceFor } from "@/lib/provenance/classify";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

export function runProvenanceSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") => results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ---- 1. Vocabulary ----
  ok("1.1 seven origin types", ORIGIN_TYPES.length === 7);
  ok("1.2 every type has a plain-language label", ORIGIN_TYPES.every((t) => !!ORIGIN_LABEL[t]));
  ok("1.3 no label leaks jargon", ORIGIN_TYPES.every((t) => !/provenance|origin_type|entity|derived_from/i.test(ORIGIN_LABEL[t])));

  // ---- 2. Grounding authority — the core invariant ----
  ok("2.1 original source grounds source claims", canGroundSource("original_source"));
  ok("2.2 original source is NOT the user's own view", !canGroundSelf("original_source"));
  ok("2.3 user-authored grounds the user's own thinking", canGroundSelf("user_authored") && canGroundSelf("imported_user_authored"));
  ok("2.4 user-authored does NOT ground external source claims", !canGroundSource("user_authored") && !canGroundSource("imported_user_authored"));
  ok("2.5 external AI grounds NOTHING", !canGroundSource("external_ai") && !canGroundSelf("external_ai"));
  ok("2.6 Conqify AI grounds NOTHING", !canGroundSource("conqify_ai") && !canGroundSelf("conqify_ai"));
  ok("2.7 derived material grounds NOTHING", !canGroundSource("derived") && !canGroundSelf("derived"));
  ok("2.8 unknown fails safe", !canGroundSource("unknown") && !canGroundSelf("unknown"));
  ok("2.9 ONLY original_source may ground a source claim", ORIGIN_TYPES.filter(canGroundSource).length === 1);
  ok("2.10 authority is total (every type resolves)", ORIGIN_TYPES.every((t) => typeof groundingAuthority(t).source === "boolean"));
  ok("2.11 machine/AI predicates agree with authority", isMachineProduced("derived") && isAiGenerated("conqify_ai") && !isAiGenerated("derived") && !isMachineProduced("user_authored"));

  // ---- 3. Structural classification (no stored metadata) ----
  ok("3.1 reading passage → original_source", classifyOrigin({ kind: "passage" }) === "original_source");
  ok("3.2 highlight → original_source (the source's own words)", classifyOrigin({ kind: "highlight" }) === "original_source");
  ok("3.3 capture → user_authored", classifyOrigin({ kind: "capture" }) === "user_authored");
  ok("3.4 annotation + reflection → user_authored", classifyOrigin({ kind: "annotation" }) === "user_authored" && classifyOrigin({ kind: "reflection" }) === "user_authored");
  ok("3.5 retrieval chunk + embedding → derived structure", classifyOrigin({ kind: "retrieval_chunk" }) === "derived" && classifyOrigin({ kind: "embedding" }) === "derived");
  ok("3.6 049 part summary + synthesis → derived", classifyOrigin({ kind: "part_summary" }) === "derived" && classifyOrigin({ kind: "document_synthesis" }) === "derived");
  ok("3.7 explicit provenance wins over structure", classifyOrigin({ kind: "capture", provenance: { originType: "external_ai" } }) === "external_ai");
  ok("3.8 text known to be AI is AI regardless of kind", classifyOrigin({ kind: "belief", fromAiText: true }) === "conqify_ai");
  ok("3.9 legacy `source` markers are reused, not replaced", classifyOrigin({ kind: "concept", source: "ai" }) === "conqify_ai" && classifyOrigin({ kind: "concept", source: "user" }) === "user_authored" && classifyOrigin({ kind: "concept", source: "deterministic" }) === "derived");
  ok("3.10 structural helpers agree", isStructurallyUserAuthored("capture") && isStructurallySource("passage") && !isStructurallyUserAuthored("passage"));

  // ---- 4. Honest uncertainty ----
  ok("4.1 ambiguous kinds with nothing recorded → unknown", [...AMBIGUOUS_KINDS].every((k) => classifyOrigin({ kind: k }) === "unknown"));
  ok("4.2 unknown is NEVER promoted to user_authored", classifyOrigin({ kind: "belief" }) !== "user_authored");
  ok("4.3 unknown is NEVER promoted to original_source", classifyOrigin({ kind: "research_project" }) !== "original_source");
  ok("4.4 an unrecognised kind is unknown, not guessed", classifyOrigin({ kind: "some_future_kind" }) === "unknown");

  // ---- 5. Legacy records (no data rewrite required) ----
  ok("5.1 legacy capture classifies correctly from structure alone", classifyLegacy("capture") === "user_authored");
  ok("5.2 legacy passage classifies correctly from structure alone", classifyLegacy("passage") === "original_source");
  ok("5.3 legacy ambiguous record is unknown, not falsely authored", classifyLegacy("belief") === "unknown");
  ok("5.4 legacy unknown cannot ground a source claim", !canGroundSource(classifyLegacy("belief")));

  // ---- 6. Lineage ----
  const quoted: LineageLink[] = [{ relation: "quoted_from", ref: { kind: "passage", id: "p1" } }];
  const derivedChain: LineageLink[] = [{ relation: "derived_from", ref: { kind: "passage", id: "p1" } }];
  const mixed: LineageLink[] = [...quoted, ...derivedChain];
  ok("6.1 quoted_from preserves source authority", lineagePreservesSource(quoted));
  ok("6.2 derived_from destroys source authority", !lineagePreservesSource(derivedChain));
  ok("6.3 ONE derived link in a chain destroys it (049 rule, generalized)", !lineagePreservesSource(mixed));
  ok("6.4 empty lineage grounds nothing", !lineagePreservesSource([]));
  ok("6.5 roots resolve to real record refs", lineageRoots(mixed).length === 2 && lineageRoots(quoted)[0].id === "p1");

  // ---- 7. Segment-level provenance (mixed authorship is never flattened) ----
  const conversation: Provenance = {
    originType: "external_ai",
    originSystem: "some-assistant",
    segments: [
      { start: 0, end: 40, originType: "user_authored", role: "user" },
      { start: 40, end: 200, originType: "external_ai", role: "assistant" },
      { start: 200, end: 260, originType: "user_authored", role: "user" },
    ],
  };
  ok("7.1 mixed material keeps distinct segment types", new Set(conversation.segments!.map((s) => s.originType)).size === 2);
  ok("7.2 mixed artifact resolves to its LEAST privileged part", effectiveOrigin(conversation) === "external_ai");
  ok("7.3 a mixed artifact grounds nothing as a whole", !recordGrounding(conversation).source && !recordGrounding(conversation).self);
  ok("7.4 no segment of an AI conversation may ground a source claim", sourceGroundableSegments(conversation).length === 0);
  const quotingArtifact: Provenance = { originType: "external_ai", segments: [{ originType: "original_source" }, { originType: "external_ai" }] };
  ok("7.5 a quoted source segment is identifiable inside AI material", sourceGroundableSegments(quotingArtifact).length === 1);
  ok("7.6 …but the artifact as a whole still cannot ground", !recordGrounding(quotingArtifact).source);
  ok("7.7 unsegmented provenance falls back to its stated type", effectiveOrigin({ originType: "user_authored" }) === "user_authored");
  ok("7.8 unknown in any segment poisons the whole artifact", effectiveOrigin({ originType: "user_authored", segments: [{ originType: "unknown" }] }) === "unknown");

  // ---- 8. Provider openness (no enum, no migration for new AI products) ----
  ok("8.1 any origin system is representable without a code change", (() => {
    const p: Provenance = { originType: "external_ai", originSystem: "a-product-that-launches-next-year" };
    return p.originSystem === "a-product-that-launches-next-year" && !canGroundSource(p.originType);
  })());
  ok("8.2 externalId is available for future idempotent re-import", (() => {
    const p: Provenance = { originType: "imported_user_authored", externalId: "abc-123" };
    return p.externalId === "abc-123" && canGroundSelf(p.originType);
  })());

  // ---- 9. The three distinguishable questions (§8 of the sprint) ----
  // "What did the author say?" / "What did I think?" / "What did an AI tell me?"
  const sourceish: OriginType[] = ORIGIN_TYPES.filter((t) => groundingAuthority(t).source);
  const selfish: OriginType[] = ORIGIN_TYPES.filter((t) => groundingAuthority(t).self);
  const aiish: OriginType[] = ORIGIN_TYPES.filter(isAiGenerated);
  ok("9.1 source-evidence set is exactly {original_source}", sourceish.length === 1 && sourceish[0] === "original_source");
  ok("9.2 user-thought set is exactly the two user-authored kinds", selfish.length === 2 && selfish.every((t) => t.includes("user_authored")));
  ok("9.3 AI set is exactly {external_ai, conqify_ai}", aiish.length === 2);
  ok("9.4 the three sets are mutually exclusive", sourceish.every((t) => !selfish.includes(t) && !aiish.includes(t)) && selfish.every((t) => !aiish.includes(t)));

  // ==================== 10. Adversarial save matrix (LIFEOS-050A) ====================
  // Every destination that can receive prose, exercised with source / AI /
  // derived / user material. The invariant: AI prose may keep LINEAGE to a
  // source, but must never become the source, and must never become the user.
  const AI_ANSWER = "Schuon argues that individuality is a veil over the Self.";
  const asNote = withAttribution(AI_ANSWER, "conqify_ai", "saved from Ask & study");
  const asCapture = withAttribution(AI_ANSWER, "conqify_ai", "saved from your reading");
  const asSummary = withAttribution("Across the work the author returns to...", "derived", "generated");
  const fromChatGpt = withAttribution("Schuon argues X.", "external_ai", "imported", "ChatGPT");

  // 10.1–10.4 Citation attacks: AI prose into every convertPassage target.
  // convertPassage writes a Citation only when canGroundSource(origin) is true.
  for (const target of ["belief", "concept", "research", "question", "synthesis", "capture"]) {
    ok(`10.1 AI answer → ${target} cannot mint a source citation`, !canGroundSource("conqify_ai"), target);
  }
  ok("10.2 derived summary → any target cannot mint a source citation", !canGroundSource("derived"));
  ok("10.3 external AI → any target cannot mint a source citation", !canGroundSource("external_ai"));
  ok("10.4 ONLY source text mints a citation", canGroundSource("original_source") && ORIGIN_TYPES.filter(canGroundSource).length === 1);

  // 10.5–10.9 Authorship laundering: structurally user-authored records.
  ok("10.5 AI answer saved as a NOTE does not become user-authored", classifyOrigin({ kind: "annotation", text: asNote }) === "conqify_ai");
  ok("10.6 AI answer saved as a CAPTURE does not become user-authored", classifyOrigin({ kind: "capture", text: asCapture }) === "conqify_ai");
  ok("10.7 imported external AI stays external", classifyOrigin({ kind: "annotation", text: fromChatGpt }) === "external_ai");
  ok("10.8 derived prose stays derived", classifyOrigin({ kind: "capture", text: asSummary }) === "derived");
  ok("10.9 laundered records ground NOTHING on either axis", (() => {
    const o = classifyOrigin({ kind: "annotation", text: asNote });
    return !canGroundSource(o) && !canGroundSelf(o);
  })());

  // 10.10–10.12 Genuine user material is untouched (no false positives).
  ok("10.10 a real user note is still user-authored", classifyOrigin({ kind: "annotation", text: "I disagree because attention is a discipline." }) === "user_authored");
  ok("10.11 a real capture is still user-authored", classifyOrigin({ kind: "capture", text: "Remember to water the plants" }) === "user_authored");
  ok("10.12 user material retains self-authority", canGroundSelf(classifyOrigin({ kind: "reflection" })));

  // 10.13 Multi-hop: AI prose carried through several destinations stays AI.
  ok("10.13 AI prose survives multiple hops without gaining authority", (() => {
    let text = AI_ANSWER;
    for (const ctx of ["saved from Ask & study", "saved from your reading", "again"]) {
      text = withAttribution(text, "conqify_ai", ctx);
    }
    const o = classifyOrigin({ kind: "capture", text });
    return o === "conqify_ai" && !canGroundSource(o) && !canGroundSelf(o);
  })());
  ok("10.14 attribution is never double-stamped", withAttribution(asNote, "conqify_ai", "again") === asNote);

  // 10.15 Save ≠ authorship. Only a genuine rewrite (marker removed) transfers it.
  ok("10.15 rewriting in the user's own words DOES transfer authorship", classifyOrigin({ kind: "annotation", text: "In my own words: attention is a discipline." }) === "user_authored");
  ok("10.16 a trivial edit that keeps the marker keeps AI provenance", classifyOrigin({ kind: "annotation", text: asNote + " (typo fixed)" }) === "conqify_ai");

  // 10.17 Export/restore round trip cannot launder origin (the marker IS the content).
  ok("10.17 export→restore round trip preserves origin", (() => {
    const archived = JSON.parse(JSON.stringify({ kind: "annotation", text: asNote }));
    return classifyOrigin(archived) === "conqify_ai";
  })());
  ok("10.18 round trip cannot turn unknown into user/source", (() => {
    const o = classifyOrigin(JSON.parse(JSON.stringify({ kind: "belief" })));
    return o === "unknown" && !canGroundSource(o) && !canGroundSelf(o);
  })());

  // 10.19 Attribution helpers are well-formed and reversible.
  ok("10.19 prefix→detect round-trips for every machine origin", (["conqify_ai", "external_ai", "derived"] as OriginType[]).every((t) => {
    const detected = detectAttribution(attributionPrefix(t, "x") + "body");
    return t === "external_ai" ? detected === "conqify_ai" : detected === t;
  }));
  ok("10.20 a named non-Conqify system is detected as external", detectAttribution(attributionPrefix("external_ai", "imported", "Gemini") + "body") === "external_ai");
  ok("10.21 unmarked text yields no attribution", detectAttribution("Just my own thoughts.") === null && detectAttribution(undefined) === null);
  ok("10.22 withAttribution never marks source or user material", withAttribution("plain", "original_source", "x") === "plain" && withAttribution("plain", "user_authored", "x") === "plain");

  // 10.23 Query-authority separation (the three future questions).
  ok("10.23 'what did the source say' excludes every AI/derived record", (() => {
    const corpus: OriginType[] = [classifyOrigin({ kind: "passage" }), classifyOrigin({ kind: "annotation", text: asNote }), classifyOrigin({ kind: "reflection" }), classifyOrigin({ kind: "document_synthesis" })];
    return corpus.filter(canGroundSource).length === 1;
  })());
  ok("10.24 'what did I think' excludes AI material saved as notes", (() => {
    const corpus: OriginType[] = [classifyOrigin({ kind: "annotation", text: asNote }), classifyOrigin({ kind: "annotation", text: "my own words" })];
    return corpus.filter(canGroundSelf).length === 1;
  })());

  // ---- 11. Capture → Practice authorship (LIFEOS-050B, D-1) ----
  //
  // The regression these lock down: `convertCapture`'s practice branch used to
  // hard-code `"mock"`, so a practice the user made from their OWN capture was
  // classified `conqify_ai` and silently lost self-authority over their own
  // thought. The fix routes the capture's real origin through
  // `practiceSourceFor`. Provenance must not GAIN false authorship (10.x) and
  // must not LOSE real authorship (here) — both directions are defects.
  //
  // Pure by construction: this asserts the classification chain
  // (capture text → origin → practice source → practice origin) and never calls
  // the store, because these tests run against the user's live data at
  // `/dev/provenance-tests`.
  const practiceOriginFor = (captureText: string): OriginType =>
    classifyOrigin({ kind: "practice", source: practiceSourceFor(classifyOrigin({ kind: "capture", text: captureText })) });

  // 11.1–11.3 The invariant: the user's own thought survives the conversion.
  ok("11.1 user capture → practice stays user_authored", practiceOriginFor("Sit with the discomfort before answering.") === "user_authored");
  ok("11.2 user capture → practice keeps SELF authority", canGroundSelf(practiceOriginFor("Sit with the discomfort before answering.")));
  ok("11.3 user capture → practice gains NO source authority", !canGroundSource(practiceOriginFor("Sit with the discomfort before answering.")));

  // 11.4–11.7 The same path must not become a laundering route (the 10.x hole,
  // arriving by a different door). AI prose saved into a Capture then converted
  // to a Practice must never emerge as the user's own.
  ok("11.4 AI answer captured → practice does NOT become user-authored", practiceOriginFor(asCapture) === "conqify_ai");
  ok("11.5 AI answer captured → practice grounds NOTHING", (() => {
    const o = practiceOriginFor(asCapture);
    return !canGroundSource(o) && !canGroundSelf(o);
  })());
  ok("11.6 imported external AI → practice does not become user-authored", !canGroundSelf(practiceOriginFor(fromChatGpt)));
  ok("11.7 derived summary → practice does not become user-authored", !canGroundSelf(practiceOriginFor(asSummary)));

  // 11.8–11.10 The mapping itself: strict, total, and failing safe. Unlike the
  // concept mapping, anything we cannot positively call the user's is "ai".
  ok("11.8 only genuinely user material maps to a user-authored practice", ORIGIN_TYPES.filter((t) => practiceSourceFor(t) === "user").length === 2);
  ok("11.9 imported user material keeps its authorship", practiceSourceFor("imported_user_authored") === "user");
  ok("11.10 unknown origin fails SAFE to machine authorship", practiceSourceFor("unknown") === "ai" && !canGroundSelf(classifyOrigin({ kind: "practice", source: "ai" })));

  // 11.11–11.12 LIFEOS-050A is not weakened: the AI-proposed practice path
  // (`/review` → addPractices(..., "mock")) still reads back as machine prose.
  ok("11.11 AI-proposed practice still classifies as conqify_ai", classifyOrigin({ kind: "practice", source: "mock" }) === "conqify_ai");
  ok("11.12 AI-proposed practice grounds NOTHING", (() => {
    const o = classifyOrigin({ kind: "practice", source: "mock" });
    return !canGroundSource(o) && !canGroundSelf(o);
  })());

  // 11.13 A practice is NOT structurally user-authored — its `source` is the
  // only thing that decides, which is why the hard-coded value was so costly.
  ok("11.13 practice authorship comes from source, never from its kind", !isStructurallyUserAuthored("practice") && classifyOrigin({ kind: "practice" }) === "unknown");

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
