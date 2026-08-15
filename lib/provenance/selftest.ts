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
  type OriginType, type Provenance, type LineageLink,
} from "@/lib/provenance";
import { classifyOrigin, classifyLegacy, AMBIGUOUS_KINDS, isStructurallyUserAuthored, isStructurallySource } from "@/lib/provenance/classify";

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

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
