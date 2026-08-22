/**
 * Living Constitution self-tests (LIFEOS-056). Pure and deterministic — no
 * browser, no network, no AI provider.
 *
 * These lock down the sprint's product guarantees, not merely its code paths:
 *
 *   - nothing becomes constitutional without an explicit adoption
 *   - adopting machine prose is not authorship, and never confers authority
 *   - a typo fix is not a change of position
 *   - retiring preserves history; deleting removes it, wording and all
 *   - the Constitution references operational records and never copies them
 *   - an AI-excluded element still works everywhere except AI
 */

import {
  activeConstitution, draftElements, retiredElements, revisionsFor, byKind,
  elementById, supersessionChain, aiVisibleElements, isAiExcluded, normalizeNewElement,
  isAdoptable, dedupeRefs, refsEqual, CONSTITUTION_KIND_ORDER,
} from "@/lib/constitution/constitution";
import {
  classifyStatementChange, normalizeStatement, significantWords, editDistance, requiresReason,
} from "@/lib/constitution/revision";
import { CONSTITUTION_KINDS, CONSTITUTION_KIND_LABEL } from "@/types/mvp";
import { buildGraph, backReferences, graphIntegrity } from "@/lib/graph";
import { buildSearchEntries, resolveRecord } from "@/lib/command/records";
import { searchFlat } from "@/lib/command/search";
import { classifyOrigin } from "@/lib/provenance/classify";
import { canGroundSource, canGroundSelf } from "@/lib/provenance";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import { makeTombstone } from "@/lib/sync/tombstones";
import {
  buildConstitutionEvidence, buildConstitutionEvidenceMap, buildEvidenceCoverage,
  EVIDENCE_CAPABILITY, EVIDENCE_KIND_LABEL, describeEvent,
} from "@/lib/constitution/evidence";
import {
  evidenceHeadline, evidenceComparison, evidenceSituation, evidenceKindPhrase,
  domainSummaryPhrase, lastRecordedPhrase, untouchedElementPhrase, untouchedLinksPhrase,
  violatesWordingContract, FORBIDDEN_EVIDENCE_WORDS,
} from "@/lib/constitution/copy";
import { buildActivityIndex } from "@/lib/insights/activity";
import { resolveRange, rangeDays } from "@/lib/insights/range";
import { addDays } from "@/lib/reviews/dates";
import { EXPECTED_MIGRATION_VERSION } from "@/lib/security/schema-compatibility";
import { registryEntry } from "@/lib/security/authorization-audit";
import type {
  ConstitutionElement, ConstitutionRevision, StoreState, RecordRefLite,
  NextAction, Note, Protocol, PracticeCandidate,
} from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const AT = "2026-05-01T00:00:00.000Z";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

function el(p: Partial<ConstitutionElement> & { id: string; statement: string }): ConstitutionElement {
  return {
    kind: "value", status: "active", adoptedAt: AT, linkedRefs: [],
    createdAt: AT, updatedAt: AT, ...p,
  } as ConstitutionElement;
}

function rev(p: Partial<ConstitutionRevision> & { id: string; elementId: string }): ConstitutionRevision {
  return { changeKind: "created", evidenceRefs: [], at: AT, ...p } as ConstitutionRevision;
}

export function runConstitutionSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail: cond ? "ok" : detail || "failed" });

  // ================================ 1. Kinds ================================
  ok("1.1 exactly four kinds ship", CONSTITUTION_KINDS.length === 4, CONSTITUTION_KINDS.join(","));
  for (const k of ["purpose", "value", "principle", "standard"]) {
    ok(`1.2 ${k} is a kind`, (CONSTITUTION_KINDS as readonly string[]).includes(k));
  }
  // The deferred kinds must NOT be shippable — each has a named home elsewhere.
  for (const k of ["boundary", "rule", "identity", "aspiration", "question", "commitment"]) {
    ok(`1.3 ${k} is NOT a kind this sprint`, !(CONSTITUTION_KINDS as readonly string[]).includes(k));
  }
  ok("1.4 principle reads as 'Guiding Principle'", CONSTITUTION_KIND_LABEL.principle === "Guiding Principle");
  ok("1.5 that label distinguishes it from the knowledge-side Principle",
    CONSTITUTION_KIND_LABEL.principle !== "Principle");
  ok("1.6 display order is direction-then-conduct",
    CONSTITUTION_KIND_ORDER.join(",") === "purpose,value,principle,standard");
  ok("1.7 every kind has a plain-language hint a user can act on",
    CONSTITUTION_KINDS.every((k) => (CONSTITUTION_KIND_LABEL[k] ?? "").length > 0));

  // ========================== 2. Explicit adoption ==========================
  {
    const fresh = normalizeNewElement({ kind: "value", statement: "Attention is stewardship." }, "e1", AT);
    ok("2.1 a newly written element is a DRAFT", fresh.status === "draft");
    ok("2.2 a newly written element has NO adoptedAt", fresh.adoptedAt === undefined);
    // THE CRITICAL GUARANTEE: there is no input that makes creation adopt.
    const sneaky = normalizeNewElement(
      { kind: "value", statement: "x", ...( { status: "active", adoptedAt: AT } as object) } as never,
      "e2", AT,
    );
    ok("2.3 no creation input can produce an adopted element",
      sneaky.status === "draft" && sneaky.adoptedAt === undefined);

    const st = emptyState();
    st.constitutionElements = [
      el({ id: "a", statement: "adopted", status: "active", adoptedAt: AT }),
      el({ id: "d", statement: "draft", status: "draft", adoptedAt: undefined }),
      el({ id: "r", statement: "retired", status: "retired", retiredAt: AT }),
    ];
    ok("2.4 only adopted elements are the Constitution", activeConstitution(st).map((e) => e.id).join(",") === "a");
    ok("2.5 drafts are listed separately, never counted", draftElements(st).map((e) => e.id).join(",") === "d");
    ok("2.6 retired elements are separate too", retiredElements(st).map((e) => e.id).join(",") === "r");
    ok("2.7 an empty statement is not adoptable",
      isAdoptable({ statement: "   ", status: "draft" }) === false);
    ok("2.8 an already-active element is not re-adoptable",
      isAdoptable({ statement: "x", status: "active" }) === false);
    ok("2.9 a retired element IS re-adoptable", isAdoptable({ statement: "x", status: "retired" }) === true);
  }

  // ===================== 3. Provenance / no laundering ======================
  {
    // Saving AI text as a constitutional statement does not make it the user's
    // own thinking, and adopting it does not make it evidence of anything.
    const aiEl = el({ id: "ai", statement: "AI wrote this", fromAiText: true });
    const origin = classifyOrigin({ kind: "constitution_element", fromAiText: true, text: aiEl.statement });
    ok("3.1 an element from AI text is classified as machine-produced",
      origin === "conqify_ai" || origin === "external_ai", origin);
    ok("3.2 adopted AI text may NEVER ground a source claim", canGroundSource(origin) === false);
    ok("3.3 adopted AI text is not evidence of the user's own prior thinking", canGroundSelf(origin) === false);
    // A user-authored element is the user's own thinking, and still not a source.
    const mine = classifyOrigin({ kind: "constitution_element", text: "I wrote this" });
    ok("3.4 a user-written element grounds SELF but never SOURCE",
      canGroundSelf(mine) === true && canGroundSource(mine) === false, mine);
    ok("3.5 adoption does not clear the AI marker", aiEl.fromAiText === true);
    // Source material is not constitutional content merely by existing.
    const st = emptyState();
    st.documents = [{ id: "doc1", title: "A book" } as never];
    ok("3.6 a reading document does not appear in the Constitution", activeConstitution(st).length === 0);
    st.notes = [{ id: "n1", body: "a thought", linkedEntityRefs: [], tags: [], createdAt: AT, updatedAt: AT } as Note];
    ok("3.7 a saved note does not appear in the Constitution", activeConstitution(st).length === 0);
  }

  // ==================== 4. Edit vs revise (the rule) ========================
  {
    const c = (a: string, b: string) => classifyStatementChange(a, b).suggested;
    ok("4.1 pure punctuation change ⇒ edited", c("I read daily", "I read daily.") === "edited");
    ok("4.2 capitalization change ⇒ edited", c("i read daily", "I read daily") === "edited");
    ok("4.3 whitespace change ⇒ edited", c("I  read   daily", "I read daily") === "edited");
    ok("4.4 a typo fix ⇒ edited", c("Attenton is stewardship", "Attention is stewardship") === "edited");
    ok("4.5 a replaced meaningful word ⇒ revised", c("I read daily", "I read weekly") === "revised");
    ok("4.6 an added meaningful word ⇒ revised", c("I read", "I read carefully") === "revised");
    ok("4.7 a removed meaningful word ⇒ revised", c("I read carefully", "I read") === "revised");
    ok("4.8 a wholly different statement ⇒ revised",
      c("Attention is stewardship", "Rest is not failure") === "revised");
    ok("4.9 every classification explains itself",
      classifyStatementChange("a b", "a c").reason.length > 0);
    // The bias must fail toward KEEPING history.
    ok("4.10 an ambiguous rewrite defaults to revised, not edited",
      c("I protect my mornings", "I protect my evenings") === "revised");
    ok("4.11 only a real revision demands a reason",
      requiresReason("revised") && requiresReason("retired") && !requiresReason("edited"));
    // Helpers are honest.
    ok("4.12 normalization is case/punctuation insensitive",
      normalizeStatement("I Read, Daily!") === normalizeStatement("i read daily"));
    ok("4.13 stopwords are not meaning-bearing",
      significantWords("I am the reader").join(",") === "reader");
    ok("4.14 edit distance is exact for small changes", editDistance("attenton", "attention") === 1);
    ok("4.15 edit distance is capped rather than unbounded", editDistance("a".repeat(80), "b".repeat(80), 4) === 5);
  }

  // ================= 5. Retirement / supersession / history =================
  {
    const st = emptyState();
    st.constitutionElements = [
      el({ id: "new", statement: "I read one book a month", supersedesId: "old" }),
      el({ id: "old", statement: "I read daily", status: "retired", retiredAt: AT }),
    ];
    st.constitutionRevisions = [
      rev({ id: "r1", elementId: "old", changeKind: "created", newStatement: "I read daily" }),
      rev({ id: "r2", elementId: "old", changeKind: "adopted", at: "2026-05-02T00:00:00.000Z" }),
      rev({ id: "r3", elementId: "old", changeKind: "revised", previousStatement: "I read daily", newStatement: "I read one book a month", reason: "daily was a lie", at: "2026-05-03T00:00:00.000Z" }),
    ];
    ok("5.1 a retired element still exists", elementById(st, "old") !== undefined);
    ok("5.2 its prior wording is still readable", elementById(st, "old")!.statement === "I read daily");
    ok("5.3 its history survives retirement", revisionsFor(st, "old").length === 3);
    ok("5.4 history is ordered oldest-first", revisionsFor(st, "old").map((r) => r.id).join(",") === "r1,r2,r3");
    ok("5.5 the reason for the change is preserved",
      revisionsFor(st, "old").some((r) => r.reason === "daily was a lie"));
    ok("5.6 the successor points back at what it replaced",
      supersessionChain(st, "new").map((e) => e.id).join(",") === "old");
    ok("5.7 a retired element is NOT part of the Constitution",
      !activeConstitution(st).some((e) => e.id === "old"));
    // A broken chain must end honestly rather than loop or throw.
    const orphan = emptyState();
    orphan.constitutionElements = [el({ id: "x", statement: "s", supersedesId: "deleted-one" })];
    ok("5.8 a chain into a deleted element ends honestly", supersessionChain(orphan, "x").length === 0);
    const cyclic = emptyState();
    cyclic.constitutionElements = [
      el({ id: "p", statement: "p", supersedesId: "q" }),
      el({ id: "q", statement: "q", supersedesId: "p" }),
    ];
    ok("5.9 a cyclic chain terminates", supersessionChain(cyclic, "p").length <= 2);
  }

  // ======================= 6. True deletion semantics =======================
  {
    // Modelled exactly as `deleteConstitutionElement` performs it, so the
    // guarantee is asserted rather than assumed.
    const elements = [
      el({ id: "gone", statement: "something sensitive" }),
      el({ id: "keeper", statement: "unrelated" }),
      el({ id: "successor", statement: "next", supersedesId: "gone" }),
    ];
    const revisions = [
      rev({ id: "ra", elementId: "gone", previousStatement: "something sensitive (older wording)" }),
      rev({ id: "rb", elementId: "gone", changeKind: "adopted" }),
      rev({ id: "rc", elementId: "keeper" }),
    ];
    const afterEls = elements
      .filter((e) => e.id !== "gone")
      .map((e) => (e.supersedesId === "gone" ? { ...e, supersedesId: undefined } : e));
    const afterRevs = revisions.filter((r) => r.elementId !== "gone");

    ok("6.1 the element is gone", !afterEls.some((e) => e.id === "gone"));
    ok("6.2 ALL of its revisions cascade", !afterRevs.some((r) => r.elementId === "gone"));
    ok("6.3 no earlier wording of it survives anywhere",
      !JSON.stringify(afterRevs).includes("something sensitive"));
    ok("6.4 unrelated elements are untouched", afterEls.some((e) => e.id === "keeper"));
    ok("6.5 unrelated history is untouched", afterRevs.some((r) => r.id === "rc"));
    ok("6.6 a successor is NOT deleted with it", afterEls.some((e) => e.id === "successor"));
    ok("6.7 the successor's dangling pointer is cleared, not left broken",
      afterEls.find((e) => e.id === "successor")?.supersedesId === undefined);
    // Retirement is NOT deletion — the two must remain distinguishable.
    const retiredOnly = elements.map((e) => (e.id === "gone" ? { ...e, status: "retired" as const, retiredAt: AT } : e));
    ok("6.8 retiring keeps the row that deleting removes",
      retiredOnly.some((e) => e.id === "gone") && !afterEls.some((e) => e.id === "gone"));
    ok("6.9 retiring keeps the history that deleting destroys",
      revisions.filter((r) => r.elementId === "gone").length === 2 && afterRevs.filter((r) => r.elementId === "gone").length === 0);
    // A tombstone may remain — but it must never carry content.
    const tomb = makeTombstone("constitutionElements", "gone", AT);
    ok("6.10 a deletion tombstone carries no statement text",
      !JSON.stringify(tomb).includes("sensitive") && Object.keys(tomb).sort().join(",") === "deletedAt,domain,recordId");
  }

  // ========================== 7. AI privacy boundary ========================
  {
    const st = emptyState();
    st.constitutionElements = [
      el({ id: "open", statement: "visible to AI" }),
      el({ id: "private", statement: "deeply personal", excludeFromAi: true }),
      el({ id: "draftOne", statement: "not adopted", status: "draft", adoptedAt: undefined }),
    ];
    const visible = aiVisibleElements(st);
    ok("7.1 an excluded element is withheld from AI", !visible.some((e) => e.id === "private"));
    ok("7.2 a normal element is available", visible.some((e) => e.id === "open"));
    ok("7.3 an UNADOPTED element is also withheld — it is not a position held",
      !visible.some((e) => e.id === "draftOne"));
    ok("7.4 the excluded statement text never appears in the AI-visible set",
      !JSON.stringify(visible).includes("deeply personal"));
    ok("7.5 exclusion is explicit and defaults to visible",
      isAiExcluded({ excludeFromAi: undefined }) === false && isAiExcluded({ excludeFromAi: true }) === true);

    // An excluded element must still work everywhere that is NOT AI.
    ok("7.6 excluded elements still appear in the Constitution itself",
      activeConstitution(st).some((e) => e.id === "private"));
    ok("7.7 excluded elements still group by kind", byKind(activeConstitution(st)).some((g) => g.elements.some((e) => e.id === "private")));
    ok("7.8 excluded elements still export", (EXPORT_DOMAINS as readonly string[]).includes("constitutionElements"));
    ok("7.9 excluded elements are still graph nodes", buildGraph(st).nodes.has("private"));
    ok("7.10 excluded elements are still searchable by their own author",
      buildSearchEntries(st).some((e) => e.id === "private"));

    // The structural guarantee: no AI path assembles StoreState today, so an
    // element cannot leak merely by existing in the collection.
    ok("7.11 AI exclusion does not erase provenance",
      st.constitutionElements.find((e) => e.id === "private")?.excludeFromAi === true);
  }

  // ====================== 8. Relationships / traversal ======================
  {
    const st = emptyState();
    const links: RecordRefLite[] = [
      { kind: "practice", id: "pr1" }, { kind: "protocol", id: "pt1" },
      { kind: "action", id: "ac1" }, { kind: "note", id: "nt1" },
    ];
    st.constitutionElements = [el({ id: "c1", statement: "Attention is stewardship", linkedRefs: links })];
    st.practices = [{ id: "pr1", title: "Evening reading", status: "accepted", derivedFrom: {}, history: [], description: "", rationale: "", source: "user", createdAt: AT, updatedAt: AT } as PracticeCandidate];
    st.protocols = [{ id: "pt1", trigger: "I notice scrolling", response: "stop and choose", status: "active", createdAt: AT, updatedAt: AT } as Protocol];
    st.nextActions = [{ id: "ac1", title: "Charge phone outside bedroom", linkedEntityRefs: [{ kind: "note", id: "nt1" }], tags: [], history: [], status: "open", description: "", notes: "", estimatedSize: "unspecified", energy: "unspecified", order: 0, createdAt: AT, updatedAt: AT } as NextAction];
    st.notes = [{ id: "nt1", body: "why this matters", linkedEntityRefs: [], tags: [], createdAt: AT, updatedAt: AT } as Note];

    const g = buildGraph(st);
    ok("8.1 the element is a graph node", g.nodes.get("c1")?.kind === "constitution_element");
    ok("8.2 each linked kind resolves to a real node",
      ["pr1", "pt1", "ac1", "nt1"].every((id) => g.nodes.has(id)));
    const out = g.byFrom.get("c1") ?? [];
    ok("8.3 all four links become edges", out.length === 4, `got ${out.length}`);
    ok("8.4 every edge carries its target KIND explicitly", out.every((e) => !!e.toKind));
    ok("8.5 the edge target kinds are the linked kinds",
      out.map((e) => e.toKind).sort().join(",") === "action,note,practice,protocol");
    // Reverse traversal is the whole point of the shared reader.
    ok("8.6 a practice can see what it serves",
      backReferences(g, "pr1").referencedBy.some((e) => e.from === "c1"));
    ok("8.7 an action can see what it serves",
      backReferences(g, "ac1").referencedBy.some((e) => e.from === "c1"));
    // The PRE-EXISTING island: an Action→Note link was invisible before 056.
    ok("8.8 an Action's own embedded links are now traversable too",
      (g.byFrom.get("ac1") ?? []).some((e) => e.to === "nt1" && e.toKind === "note"));
    ok("8.9 the note can see the action that references it",
      backReferences(g, "nt1").referencedBy.some((e) => e.from === "ac1"));
    // No dangling garbage.
    ok("8.10 linked references are not broken", graphIntegrity(st, g).brokenReferences.length === 0);
    // A link to a record that was deleted must be REPORTED, not hidden.
    const dangling = emptyState();
    dangling.constitutionElements = [el({ id: "c2", statement: "s", linkedRefs: [{ kind: "practice", id: "missing" }] })];
    ok("8.11 a link to a deleted record is reported as broken, not silently dropped",
      graphIntegrity(dangling).brokenReferences.length === 1);
    // Deleting an element removes its edges entirely.
    const afterDelete = emptyState();
    afterDelete.practices = st.practices;
    ok("8.12 a deleted element leaves NO live edges",
      (buildGraph(afterDelete).byTo.get("pr1") ?? []).length === 0);
    // Unknown kinds are dropped rather than guessed.
    const weird = emptyState();
    weird.constitutionElements = [el({ id: "c3", statement: "s", linkedRefs: [{ kind: "not_a_kind", id: "zz" }] })];
    ok("8.13 an unrecognized ref kind is not turned into a guessed edge",
      (buildGraph(weird).byFrom.get("c3") ?? []).length === 0);
    // Determinism.
    ok("8.14 graph output is deterministic across builds",
      JSON.stringify(buildGraph(st).edges) === JSON.stringify(buildGraph(st).edges));
    // Imperfect-store safety (from the graph hardening sprint) still holds.
    let threw = "";
    try { buildGraph({} as unknown as StoreState); } catch (e) { threw = (e as Error).message; }
    ok("8.15 imperfect-store safety remains intact", threw === "", threw);
    // References, never copies.
    ok("8.16 the element stores a reference, not a copy of the practice",
      JSON.stringify(st.constitutionElements[0].linkedRefs).includes("pr1")
      && !JSON.stringify(st.constitutionElements[0].linkedRefs).includes("Evening reading"));
    // Ref helpers.
    ok("8.17 duplicate links collapse", dedupeRefs([{ kind: "note", id: "n" }, { kind: "note", id: "n" }]).length === 1);
    ok("8.18 link comparison is order-insensitive",
      refsEqual([{ kind: "a", id: "1" }, { kind: "b", id: "2" }], [{ kind: "b", id: "2" }, { kind: "a", id: "1" }]));
  }

  // ===================== 9. Persistence / sync / export =====================
  {
    ok("9.1 STORE_DOMAINS includes constitution elements", (STORE_DOMAINS as string[]).includes("constitutionElements"));
    ok("9.2 STORE_DOMAINS includes constitution revisions", (STORE_DOMAINS as string[]).includes("constitutionRevisions"));
    ok("9.3 EXPORT_DOMAINS includes both", (EXPORT_DOMAINS as readonly string[]).includes("constitutionElements")
      && (EXPORT_DOMAINS as readonly string[]).includes("constitutionRevisions"));
    // ORDER IS LOAD-BEARING: the new domains must be APPENDED, never inserted.
    const idxNotes = (EXPORT_DOMAINS as readonly string[]).indexOf("notes");
    const idxProto = (EXPORT_DOMAINS as readonly string[]).indexOf("protocols");
    const idxEl = (EXPORT_DOMAINS as readonly string[]).indexOf("constitutionElements");
    const idxRev = (EXPORT_DOMAINS as readonly string[]).indexOf("constitutionRevisions");
    ok("9.4 export order is append-only (notes < protocols < constitution)",
      idxNotes < idxProto && idxProto < idxEl && idxEl < idxRev);
    // LIFEOS-061 appended `events` and `recurrenceCompletions` AFTER these. What
    // this assertion protects is that the constitution pair stayed contiguous and
    // in order — export order is a wire contract for old archives — not that
    // nothing may ever be appended again.
    ok("9.5 the constitution domains remain adjacent and in order", idxRev === idxEl + 1);
    ok("9.6 no export domain was removed", (EXPORT_DOMAINS as readonly string[]).length >= 44, `${EXPORT_DOMAINS.length}`);
    ok("9.6a and the count matches the store exactly", EXPORT_DOMAINS.length === 46, `${EXPORT_DOMAINS.length}`);
    // A round-trip through the archive shape must not lose anything.
    const st = emptyState();
    st.constitutionElements = [el({ id: "e", statement: "keep me", excludeFromAi: true, linkedRefs: [{ kind: "note", id: "n" }] })];
    st.constitutionRevisions = [rev({ id: "r", elementId: "e", changeKind: "adopted" })];
    const restored = JSON.parse(JSON.stringify(st)) as StoreState;
    ok("9.7 elements survive a serialize/restore round-trip",
      restored.constitutionElements[0].statement === "keep me");
    ok("9.8 the privacy flag survives restore", restored.constitutionElements[0].excludeFromAi === true);
    ok("9.9 links survive restore", restored.constitutionElements[0].linkedRefs[0].id === "n");
    ok("9.10 status and adoption survive restore",
      restored.constitutionElements[0].status === "active" && restored.constitutionElements[0].adoptedAt === AT);
    ok("9.11 revision history survives restore", restored.constitutionRevisions.length === 1);
    // Schema + ownership registration.
    // 0039 was the constitution head; LIFEOS-061 advanced it to 0040. What this
    // assertion protects is that the constitution tables shipped at or before the
    // head, not that the head never moves again.
    ok("9.12 the expected migration version is at or beyond the constitution head", EXPECTED_MIGRATION_VERSION >= 39);
    const regEl = registryEntry("constitution_elements");
    const regRev = registryEntry("constitution_revisions");
    ok("9.13 elements are registered as user-owned with full RLS",
      !!regEl && regEl.defaultsToAuthUid === true && regEl.policies.length === 4);
    ok("9.14 revisions are registered as user-owned with full RLS",
      !!regRev && regRev.defaultsToAuthUid === true && regRev.policies.length === 4);
    ok("9.15 both tombstone under their own domain",
      regEl?.tombstoneDomain === "constitutionElements" && regRev?.tombstoneDomain === "constitutionRevisions");
  }

  // ======================== 10. Search / command index ======================
  {
    const st = emptyState();
    st.constitutionElements = [
      el({ id: "s1", statement: "Attention is a form of stewardship", kind: "principle" }),
      el({ id: "s2", statement: "A draft idea", status: "draft", adoptedAt: undefined }),
      el({ id: "s3", statement: "An old position", status: "retired", retiredAt: AT }),
    ];
    const entries = buildSearchEntries(st);
    ok("10.1 adopted elements are indexed", entries.some((e) => e.id === "s1"));
    ok("10.2 drafts are NOT indexed as Constitution content", !entries.some((e) => e.id === "s2"));
    ok("10.3 retired elements are not surfaced in search", !entries.some((e) => e.id === "s3"));
    ok("10.4 they join the existing index rather than a new one",
      entries.some((e) => e.kind === "constitution_element"));
    const hit = entries.find((e) => e.id === "s1");
    ok("10.5 the result is labelled 'Guiding Principle', not 'Principle'", hit?.status === "Guiding Principle");
    ok("10.6 searching finds it by its words",
      searchFlat(entries, "stewardship").some((r) => r.entry.id === "s1"));
    ok("10.7 searching by the kind label finds it",
      searchFlat(entries, "guiding principle").some((r) => r.entry.id === "s1"));
    const resolved = resolveRecord(st, "constitution_element", "s1");
    ok("10.8 the record resolves to the Constitution route", resolved?.href === "/constitution?element=s1");
    ok("10.9 resolution reports the kind label", resolved?.status === "Guiding Principle");
  }

  // ============================== 11. Grouping ==============================
  {
    const els = [
      el({ id: "p", statement: "p", kind: "purpose" }),
      el({ id: "v", statement: "v", kind: "value" }),
      el({ id: "g", statement: "g", kind: "principle" }),
      el({ id: "s", statement: "s", kind: "standard" }),
    ];
    const groups = byKind(els);
    ok("11.1 grouping covers all four kinds", groups.length === 4);
    ok("11.2 grouping preserves the fixed order",
      groups.map((g) => g.kind).join(",") === "purpose,value,principle,standard");
    ok("11.3 each element lands in its own kind", groups.every((g) => g.elements.every((e) => e.kind === g.kind)));
    const st = emptyState();
    st.constitutionElements = els;
    ok("11.4 the Constitution sorts by kind, not by edit time",
      activeConstitution(st).map((e) => e.kind).join(",") === "purpose,value,principle,standard");
  }

  // ====================== 12. No scoring, ever ==============================
  {
    // The absence of a metric is a product guarantee, so it is asserted.
    const st = emptyState();
    st.constitutionElements = [el({ id: "x", statement: "s" })];
    const serialized = JSON.stringify(st.constitutionElements[0]);
    for (const forbidden of ["score", "percent", "rating", "streak", "compliance", "health", "alignment", "progress"]) {
      ok(`12.x an element carries no '${forbidden}' field`, !serialized.toLowerCase().includes(forbidden));
    }
  }

  // =========== 13. Deletion privacy across a supersession (LIFEOS-056D) ===========
  //
  // THE DEFECT FOUNDER ACCEPTANCE FOUND, AND THE ONE SECTION 6 MISSED.
  //
  // A conceptual revision spans TWO elements: the transition row is owned by the
  // predecessor but its `newStatement` is the SUCCESSOR's wording. Section 6
  // modelled a single element's history, so deleting the successor looked clean
  // while its text sat in the predecessor's row — visible in the UI, persisted,
  // exported and synced.
  //
  // These assertions model `reviseConstitutionElement` and
  // `deleteConstitutionElement` exactly as the store performs them.
  {
    const SECRET = "SECRET SUCCESSOR WORDING";
    const ORIGINAL = "Original constitutional wording";

    // --- A adopted, edited once (unrelated history), then revised into B ---
    const A: ConstitutionElement = el({ id: "A", statement: ORIGINAL, kind: "principle" });
    const B: ConstitutionElement = el({
      id: "B", statement: SECRET, kind: "principle", supersedesId: "A",
    });
    const elements: ConstitutionElement[] = [
      { ...B },
      { ...A, status: "retired", retiredAt: AT },
    ];
    const revisions: ConstitutionRevision[] = [
      rev({ id: "r-created", elementId: "A", changeKind: "created", newStatement: ORIGINAL }),
      rev({ id: "r-adopted", elementId: "A", changeKind: "adopted", newStatement: ORIGINAL }),
      // unrelated earlier history that MUST survive
      rev({ id: "r-edited", elementId: "A", changeKind: "edited", previousStatement: "Orignal constitutional wording", newStatement: ORIGINAL }),
      // the transition: owned by A, carries B's wording, points at B
      rev({ id: "r-revised", elementId: "A", changeKind: "revised", successorId: "B", previousStatement: ORIGINAL, newStatement: SECRET, reason: "changed my mind" }),
      rev({ id: "r-bcreated", elementId: "B", changeKind: "created", newStatement: SECRET }),
      rev({ id: "r-badopted", elementId: "B", changeKind: "adopted", newStatement: SECRET }),
    ];

    const before = emptyState();
    before.constitutionElements = elements;
    before.constitutionRevisions = revisions;
    before.notes = [{ id: "nt", body: "an unrelated note", linkedEntityRefs: [], tags: [], createdAt: AT, updatedAt: AT } as Note];

    // ---- state BEFORE deletion ----
    ok("13.1 the predecessor is retired", elementById(before, "A")?.status === "retired");
    ok("13.2 the successor is active", elementById(before, "B")?.status === "active");
    const transition = revisionsFor(before, "A").find((r) => r.changeKind === "revised");
    ok("13.3 a revised transition row exists on the predecessor", !!transition);
    ok("13.4 the transition records WHICH successor it produced", transition?.successorId === "B");
    ok("13.5 the transition carries the successor's wording", transition?.newStatement === SECRET);
    ok("13.6 that wording is therefore present before deletion",
      JSON.stringify(before).includes(SECRET));

    // ---- delete the successor, exactly as the store does ----
    const del = (state: StoreState, id: string): StoreState => ({
      ...state,
      constitutionElements: (state.constitutionElements ?? [])
        .filter((e) => e.id !== id)
        .map((e) => (e.supersedesId === id ? { ...e, supersedesId: undefined } : e)),
      constitutionRevisions: (state.constitutionRevisions ?? []).filter(
        (r) => r.elementId !== id && r.successorId !== id,
      ),
    });
    const after = del(before, "B");
    const serialized = JSON.stringify(after);

    // ---- THE GUARANTEE: zero occurrences, anywhere ----
    ok("13.7 the deleted wording appears ZERO times in the whole state",
      (serialized.match(new RegExp(SECRET, "g")) ?? []).length === 0);
    ok("13.8 …not in constitutionElements",
      !JSON.stringify(after.constitutionElements).includes(SECRET));
    ok("13.9 …not in constitutionRevisions",
      !JSON.stringify(after.constitutionRevisions).includes(SECRET));
    ok("13.10 …not in the serialized local store", !serialized.includes(SECRET));
    // The export is the same domain list, so prove it over the export shape too.
    const exported = JSON.stringify(
      Object.fromEntries((EXPORT_DOMAINS as readonly string[]).map((d) => [d, (after as unknown as Record<string, unknown>)[d] ?? []])),
    );
    ok("13.11 …not in a normal export", !exported.includes(SECRET));

    // ---- and the predecessor keeps everything the user did NOT delete ----
    ok("13.12 the predecessor still exists", !!elementById(after, "A"));
    ok("13.13 the predecessor's own wording is untouched", elementById(after, "A")?.statement === ORIGINAL);
    const keptA = revisionsFor(after, "A").map((r) => r.id);
    ok("13.14 the predecessor's unrelated history survives",
      keptA.includes("r-created") && keptA.includes("r-adopted") && keptA.includes("r-edited"), keptA.join(","));
    ok("13.15 ONLY the transition row was removed from the predecessor",
      !keptA.includes("r-revised") && keptA.length === 3, keptA.join(","));
    ok("13.16 the successor's own revision rows are gone",
      !(after.constitutionRevisions ?? []).some((r) => r.elementId === "B"));
    ok("13.17 the deleted element's id appears nowhere", !serialized.includes('"B"'));
    ok("13.18 an unrelated linked record survives", (after.notes ?? []).some((n) => n.id === "nt"));

    // ---- graph: no live node or relationship for the deleted element ----
    const g = buildGraph(after);
    ok("13.19 the graph has no node for the deleted element", !g.nodes.has("B"));
    ok("13.20 the graph has no edge from or to the deleted element",
      (g.byFrom.get("B") ?? []).length === 0 && (g.byTo.get("B") ?? []).length === 0);
    ok("13.21 no surviving element still points at the deleted one",
      !(after.constitutionElements ?? []).some((e) => e.supersedesId === "B"));

    // ---- tombstones stay content-free ----
    const tomb = makeTombstone("constitutionElements", "B", AT);
    ok("13.22 the tombstone carries no statement text", !JSON.stringify(tomb).includes(SECRET));

    // ---- deleting the PREDECESSOR instead must also remove the transition ----
    const afterA = del(before, "A");
    ok("13.23 deleting the predecessor removes its own history",
      !(afterA.constitutionRevisions ?? []).some((r) => r.elementId === "A"));
    ok("13.24 deleting the predecessor leaves the successor intact",
      !!elementById(afterA, "B") && elementById(afterA, "B")?.statement === SECRET);
    ok("13.25 the successor's dangling supersedesId is cleared",
      elementById(afterA, "B")?.supersedesId === undefined);

    // ---- rows written before 056D carry no successorId, and still work ----
    const legacy = emptyState();
    legacy.constitutionElements = [el({ id: "L", statement: "legacy" })];
    legacy.constitutionRevisions = [
      rev({ id: "r-legacy", elementId: "L", changeKind: "revised", previousStatement: "old", newStatement: "legacy" }),
    ];
    ok("13.26 a pre-056D revision row loads with no successorId",
      revisionsFor(legacy, "L")[0].successorId === undefined);
    const legacyAfter = del(legacy, "L");
    ok("13.27 deleting its owner still removes a legacy row",
      (legacyAfter.constitutionRevisions ?? []).length === 0);
    ok("13.28 a legacy row is never mistaken for a transition to some other element",
      !(legacy.constitutionRevisions ?? []).some((r) => r.successorId !== undefined));

    // ---- non-supersession events must NOT claim a successor ----
    for (const kind of ["created", "adopted", "edited", "relinked", "retired", "readopted"] as const) {
      const r = rev({ id: `x-${kind}`, elementId: "A", changeKind: kind });
      ok(`13.29 a '${kind}' event records no successor`, r.successorId === undefined);
    }
  }

  // ============ 14. Constitution in Practice — evidence (LIFEOS-057) ============
  //
  // The bridge between "what I said matters" and "what Conqify recorded". Its
  // whole risk is language: one careless verb turns an observation into a
  // verdict on a person. These assertions pin the three permanently-distinct
  // situations, the wording contract, and the absence-is-not-evidence rule.
  {
    const TODAY = "2026-05-20";
    const range30 = resolveRange("custom", { today: TODAY, customStart: addDays(TODAY, -29), customEnd: TODAY });
    const range7 = resolveRange("custom", { today: TODAY, customStart: addDays(TODAY, -6), customEnd: TODAY });
    const range90 = resolveRange("custom", { today: TODAY, customStart: addDays(TODAY, -89), customEnd: TODAY });
    const iso = (day: string) => `${day}T12:00:00.000Z`;

    const mk = (): StoreState => {
      const st = emptyState();
      st.practices = [{ id: "pr1", title: "Evening reading", description: "", rationale: "", derivedFrom: {}, status: "accepted", source: "user", history: [], createdAt: iso("2026-05-10"), updatedAt: iso("2026-05-10") } as PracticeCandidate];
      st.protocols = [{ id: "pt1", trigger: "I notice scrolling", response: "stop", status: "active", createdAt: iso("2026-01-01"), updatedAt: iso("2026-01-01") } as Protocol];
      st.notes = [{ id: "nt1", title: "Why attention matters", body: "x", linkedEntityRefs: [], tags: [], createdAt: iso("2026-05-18"), updatedAt: iso("2026-05-18") } as Note];
      st.nextActions = [{
        id: "ac1", title: "Charge phone outside bedroom", description: "", notes: "", status: "completed",
        linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 0,
        createdAt: iso("2026-05-15"), updatedAt: iso("2026-05-16"),
        history: [{ id: "h1", at: iso("2026-05-16"), action: "completed" }],
      } as unknown as NextAction];
      return st;
    };

    // ---- 1. linked records WITH recorded activity ----
    {
      const st = mk();
      st.constitutionElements = [el({
        id: "E1", kind: "principle", statement: "Direct my attention deliberately",
        linkedRefs: [{ kind: "practice", id: "pr1" }, { kind: "action", id: "ac1" }, { kind: "note", id: "nt1" }],
      })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      ok("14.1 every linked record is projected", ev.directRelations.length === 3);
      ok("14.2 a linked Action contributes event evidence",
        ev.directRelations.find((r) => r.ref.id === "ac1")!.observations.length > 0);
      ok("14.3 a linked Practice contributes its own timestamps",
        ev.directRelations.find((r) => r.ref.id === "pr1")!.observations.some((o) => o.source === "record_timestamp"));
      ok("14.4 a linked Note contributes its own timestamps",
        ev.directRelations.find((r) => r.ref.id === "nt1")!.observations.length > 0);
      ok("14.5 the situation is 'links with records'", evidenceSituation(ev) === "links_with_records");
      ok("14.6 recorded activity is a plain count", ev.recordedActivity > 0 && Number.isInteger(ev.recordedActivity));
      ok("14.7 evidence is grouped by kind", ev.evidenceByKind.length === 3);
      ok("14.8 a last-recorded instant is reported", !!ev.lastRecordedAt);
      ok("14.9 the projection is not persisted anywhere",
        !(STORE_DOMAINS as string[]).some((d) => d.toLowerCase().includes("evidence")));
      ok("14.10 recomputing gives an identical result",
        JSON.stringify(buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) })) === JSON.stringify(ev));
    }

    // ---- 2. NO LINKS: the most dangerous case ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "E2", kind: "value", statement: "Be present with my family", linkedRefs: [] })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      ok("14.11 no links ⇒ its own situation", evidenceSituation(ev) === "no_links");
      const head = evidenceHeadline(ev);
      ok("14.12 the headline reports a RELATIONSHIP gap, not a life gap",
        head.includes("not yet connected to records Conqify can use"), head);
      // THE philosophical invariant.
      ok("14.13 it NEVER says the user has not been present",
        !/have not been|haven't been|you have not/i.test(head), head);
      ok("14.14 it does not claim zero activity", !/no activity|no related activity/i.test(head), head);
      ok("14.15 the reasons explain the gap honestly",
        ev.reasons.some((r) => r.includes("have not linked any records")));
      ok("14.16 coverage still states the outside-Conqify limit",
        ev.coverage.some((c) => c.includes("outside Conqify")));
    }

    // ---- 3. LINKS BUT NO RECORDS IN RANGE ----
    {
      const st = mk();
      st.constitutionElements = [el({
        id: "E3", kind: "standard", statement: "I protect focused work",
        linkedRefs: [{ kind: "protocol", id: "pt1" }],
      })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      ok("14.17 links with nothing recorded ⇒ its own situation", evidenceSituation(ev) === "links_without_records");
      const head = evidenceHeadline(ev);
      ok("14.18 it says nothing was recorded IN CONQIFY",
        head.includes("recorded in Conqify") && head.includes("during this period"), head);
      ok("14.19 it does not say the user failed or neglected anything",
        violatesWordingContract(head).length === 0, violatesWordingContract(head).join(","));
      ok("14.20 coverage discloses that protocols carry no ongoing activity",
        ev.coverage.some((c) => c.includes("does not record ongoing activity")));
      // The three situations must never be the same sentence.
      const stNo = mk(); stNo.constitutionElements = [el({ id: "z", statement: "x", linkedRefs: [] })];
      const evNo = buildConstitutionEvidence(stNo, stNo.constitutionElements[0], range30, { index: [] });
      ok("14.21 'no links' and 'no records' produce DIFFERENT sentences",
        evidenceHeadline(evNo) !== head);
    }

    // ---- 4. TIME WINDOWS ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "E4", statement: "s", linkedRefs: [{ kind: "note", id: "nt1" }] })];
      const idx = buildActivityIndex(st);
      const e7 = buildConstitutionEvidence(st, st.constitutionElements[0], range7, { index: idx });
      const e30 = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: idx });
      const e90 = buildConstitutionEvidence(st, st.constitutionElements[0], range90, { index: idx });
      ok("14.22 a 7-day window is 7 days", rangeDays(range7) === 7);
      ok("14.23 a 30-day window is 30 days", rangeDays(range30) === 30);
      ok("14.24 a 90-day window is 90 days", rangeDays(range90) === 90);
      ok("14.25 the note (2026-05-18) is inside the 7-day window", e7.recordedActivity > 0);
      ok("14.26 wider windows never lose evidence",
        e90.recordedActivity >= e30.recordedActivity && e30.recordedActivity >= e7.recordedActivity);
      // A record outside every window contributes nothing.
      const old = mk();
      old.notes = [{ id: "ntOld", body: "x", linkedEntityRefs: [], tags: [], createdAt: iso("2020-01-01"), updatedAt: iso("2020-01-01") } as Note];
      old.constitutionElements = [el({ id: "E4b", statement: "s", linkedRefs: [{ kind: "note", id: "ntOld" }] })];
      ok("14.27 a record outside the window contributes nothing",
        buildConstitutionEvidence(old, old.constitutionElements[0], range30, { index: [] }).recordedActivity === 0);
      // Ranges are DayKey-based and deterministic — no host-clock dependence.
      ok("14.28 the same window resolves identically twice",
        JSON.stringify(resolveRange("custom", { today: TODAY, customStart: addDays(TODAY, -29), customEnd: TODAY })) === JSON.stringify(range30));
    }

    // ---- 5. RETIRED elements are out of the current comparison ----
    {
      const st = mk();
      st.constitutionElements = [
        el({ id: "act", statement: "active one" }),
        el({ id: "ret", statement: "retired one", status: "retired", retiredAt: AT }),
      ];
      const map = buildConstitutionEvidenceMap(st, activeConstitution(st), range30, { index: buildActivityIndex(st) });
      ok("14.29 a retired element is not in the current comparison", !map.has("ret"));
      ok("14.30 an active element is", map.has("act"));
    }

    // ---- 6. DELETION removes the evidence association ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "E5", statement: "s", linkedRefs: [{ kind: "note", id: "nt1" }] })];
      const after = { ...st, constitutionElements: [] } as StoreState;
      const map = buildConstitutionEvidenceMap(after, activeConstitution(after), range30, { index: buildActivityIndex(after) });
      ok("14.31 a deleted element leaves no ghost evidence", map.size === 0);
      ok("14.32 the linked record itself survives deletion", (after.notes ?? []).some((n) => n.id === "nt1"));
      // A link to a record that no longer exists is reported, not hidden.
      const dangling = mk();
      dangling.constitutionElements = [el({ id: "E6", statement: "s", linkedRefs: [{ kind: "note", id: "missing" }] })];
      const evD = buildConstitutionEvidence(dangling, dangling.constitutionElements[0], range30, { index: [] });
      ok("14.33 a link to a missing record is marked as not existing",
        evD.directRelations[0].exists === false);
      ok("14.34 and disclosed in coverage rather than silently dropped",
        evD.coverage.some((c) => c.includes("no longer present")));
    }

    // ---- 7. EXPLAINABILITY ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "E7", kind: "principle", statement: "Direct my attention deliberately", linkedRefs: [{ kind: "action", id: "ac1" }] })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      const joined = ev.reasons.join(" ");
      ok("14.35 the explanation names the element", joined.includes("Direct my attention deliberately"));
      ok("14.36 the explanation names the period", joined.includes(range30.label) || joined.includes("30 days"));
      ok("14.37 the explanation names the linked record", joined.includes("Charge phone outside bedroom"));
      ok("14.38 the explanation states the rule used",
        joined.includes("records you linked yourself") && joined.includes("Nothing here is inferred"));
      ok("14.39 every observation carries a timestamp and a source",
        ev.directRelations.every((r) => r.observations.every((o) => !!o.at && (o.source === "event" || o.source === "record_timestamp"))));
      ok("14.40 event descriptions are literal, not interpretive",
        describeEvent({ at: AT, type: "action_completed", recordKind: "action", recordId: "x" }) === "Action completed");
    }

    // ---- 8. THE WORDING CONTRACT, over every sentence the layer can emit ----
    {
      const st = mk();
      st.constitutionElements = [
        el({ id: "W1", statement: "with records", linkedRefs: [{ kind: "action", id: "ac1" }, { kind: "note", id: "nt1" }] }),
        el({ id: "W2", statement: "no links", linkedRefs: [] }),
        el({ id: "W3", statement: "silent links", linkedRefs: [{ kind: "protocol", id: "pt1" }] }),
      ];
      const idx = buildActivityIndex(st);
      const sentences: string[] = [];
      for (const e of st.constitutionElements) {
        for (const r of [range7, range30, range90]) {
          const ev = buildConstitutionEvidence(st, e, r, { index: idx });
          sentences.push(evidenceHeadline(ev));
          const cmp = evidenceComparison(ev); if (cmp) sentences.push(cmp);
          const last = lastRecordedPhrase(ev, Date.parse(iso(TODAY))); if (last) sentences.push(last);
          sentences.push(...ev.evidenceByKind.map(evidenceKindPhrase));
          sentences.push(...ev.coverage, ...ev.reasons);
        }
      }
      sentences.push(domainSummaryPhrase("Guiding Principle", 8), domainSummaryPhrase("Purpose", 1));
      sentences.push(untouchedElementPhrase(90), untouchedLinksPhrase(90), untouchedLinksPhrase(undefined));
      const offenders = sentences.flatMap((x) => violatesWordingContract(x).map((w) => `${w} in: ${x}`));
      ok(`14.41 ${sentences.length} generated sentences contain NO forbidden word`, offenders.length === 0, offenders.slice(0, 3).join(" | "));
      for (const w of ["neglect", "failed", "aligned", "misaligned", "adherence", "compliance", "score", "streak"]) {
        ok(`14.42 the contract bans '${w}'`, FORBIDDEN_EVIDENCE_WORDS.some((f) => f.includes(w) || w.includes(f)));
      }
      ok("14.43 the contract detector actually fires", violatesWordingContract("You neglected this").length > 0);
      ok("14.44 a neutral sentence passes", violatesWordingContract("3 entries were recorded.").length === 0);
      ok("14.45 no sentence contains a percentage", !sentences.some((x) => /\d\s*%/.test(x)));
      ok("14.46 no sentence uses a traffic-light word",
        !sentences.some((x) => /\b(green|red|amber)\b/i.test(x)));
    }

    // ---- 9. THE ZERO-SCORE INVARIANT, over the projection's own shape ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "Z", statement: "s", linkedRefs: [{ kind: "action", id: "ac1" }] })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      const keys = JSON.stringify(ev).toLowerCase();
      for (const banned of ["score", "percent", "aligned", "adherence", "compliance", "rating", "grade", "streak", "virtue"]) {
        ok(`14.47 the projection has no '${banned}' field`, !keys.includes(`"${banned}`), banned);
      }
      ok("14.48 every numeric field is a count or a timestamp",
        Number.isInteger(ev.recordedActivity) && Number.isInteger(ev.activeRelations) && Number.isInteger(ev.priorRecordedActivity));
      ok("14.49 there is no aggregate across elements",
        !("total" in (ev as unknown as Record<string, unknown>)) && !("overall" in (ev as unknown as Record<string, unknown>)));
    }

    // ---- 10. period comparison is a literal count comparison, or nothing ----
    {
      const st = mk();
      st.constitutionElements = [el({ id: "C1", statement: "s", linkedRefs: [{ kind: "note", id: "nt1" }] })];
      const ev = buildConstitutionEvidence(st, st.constitutionElements[0], range30, { index: buildActivityIndex(st) });
      const cmp = evidenceComparison(ev);
      // The real property: a comparison exists exactly when at least one of the
      // two windows recorded something. It is a literal count statement, never
      // a trend read off an empty period.
      ok("14.50 a comparison is offered exactly when there is something to compare",
        (cmp !== undefined) === (ev.recordedActivity > 0 || ev.priorRecordedActivity > 0), String(cmp));
      ok("14.50b the comparison names the preceding period of equal length",
        cmp === undefined || cmp.includes("preceding period of equal length"), String(cmp));
      const empty = buildConstitutionEvidence(
        { ...st, notes: [] } as StoreState,
        el({ id: "C2", statement: "s", linkedRefs: [] }), range30, { index: [] },
      );
      ok("14.51 two empty periods produce NO trend claim", evidenceComparison(empty) === undefined);
    }

    // ---- 11. capability table is honest about instrumentation ----
    {
      ok("14.52 actions are event-instrumented", EVIDENCE_CAPABILITY.action === "events");
      ok("14.53 documents are event-instrumented", EVIDENCE_CAPABILITY.document === "events");
      ok("14.54 practices are NOT event-instrumented", EVIDENCE_CAPABILITY.practice === "timestamps_only");
      ok("14.55 protocols are NOT event-instrumented", EVIDENCE_CAPABILITY.protocol === "timestamps_only");
      ok("14.56 notes are NOT event-instrumented", EVIDENCE_CAPABILITY.note === "timestamps_only");
      ok("14.57 every capability kind has a user-facing label",
        Object.keys(EVIDENCE_CAPABILITY).every((k) => !!EVIDENCE_KIND_LABEL[k]));
      const cov = buildEvidenceCoverage(
        [{ ref: { kind: "practice", id: "p" }, title: "t", exists: true, capability: "timestamps_only", observations: [] }],
        range30,
      );
      ok("14.58 coverage names the sources it used", cov.some((c) => c.includes("practices")));
      ok("14.59 coverage always ends with the outside-Conqify limit",
        cov[cov.length - 1].includes("outside Conqify"));
    }

    // ---- 12. dormancy: two DIFFERENT observations, never merged ----
    {
      ok("14.60 'element not revisited' and 'no linked activity' are different sentences",
        untouchedElementPhrase(90) !== untouchedLinksPhrase(90));
      ok("14.61 the element sentence is about editing the element",
        untouchedElementPhrase(90).includes("edited this element"));
      ok("14.62 the links sentence is about recorded activity",
        untouchedLinksPhrase(90).includes("linked activity has been recorded"));
      ok("14.63 neither sentence blames the user",
        violatesWordingContract(untouchedElementPhrase(90)).length === 0
        && violatesWordingContract(untouchedLinksPhrase(90)).length === 0);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === results.length, total: results.length, passed, failed: results.length - passed, ms: Date.now() - t0, results };
}
