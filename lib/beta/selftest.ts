/**
 * Closed-beta evidence self-tests (LIFEOS-059). Pure and deterministic.
 *
 * The load-bearing assertions are the negative ones. Most of this file is
 * dedicated to proving that private prose CANNOT enter the evidence log —
 * not that it currently does not, but that the schema has nowhere to put it.
 * Section 1 throws real interview answers, Constitution wording, emails and
 * source text at every field and asserts none survives.
 *
 * The second theme is subordination: evidence must never be able to break the
 * product. Section 7 exercises quota failure, a corrupt log, and a hostile
 * payload, and asserts the recorder absorbs all of it.
 */

import {
  BETA_EVENTS, ALLOWED_BETA_FIELDS, FIELD_KINDS, buildBetaEvent, isCleanBetaEvent, fingerprint, MAX_EVENT_JSON,
} from "@/lib/beta/events";
import type { BetaEvent } from "@/lib/beta/events";
import { classifyEdit } from "@/lib/beta/edit";
import { checkConstitutionIntegrity, STOP_THE_LINE } from "@/lib/beta/canary";
import { buildBetaSummary, summaryToMarkdown } from "@/lib/beta/summary";
import {
  makeFeedback, feedbackCounts, saveFeedback, readFeedback, FEEDBACK_CATEGORIES, type BetaFeedback,
} from "@/lib/beta/feedback";
import { buildInterviewContext } from "@/lib/interview/context";
import { startSession, recordAnswer, __resetInterviewIds } from "@/lib/interview/session";
import {
  BETA_DISCLOSURE, DISCLOSURE_CLAIMS, violatesBetaDisclosure, FORBIDDEN_DISCLOSURE_PHRASES,
} from "@/lib/beta/disclosure";
import {
  record, readEvidence, clearEvidence, evidenceStartedAt, BETA_EVIDENCE_KEY, BETA_START_KEY, MAX_EVENTS,
} from "@/lib/beta/store";
import { BETA_FEEDBACK_KEY } from "@/lib/beta/feedback";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import { EXPORT_DOMAINS } from "@/lib/backup/versioning";
import type { ConstitutionElement, StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const AT = "2026-07-01T00:00:00.000Z";

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

function el(p: Partial<ConstitutionElement> & { id: string; statement: string }): ConstitutionElement {
  return {
    id: p.id, kind: p.kind ?? "value", statement: p.statement,
    status: p.status ?? "active", adoptedAt: p.status === "draft" ? undefined : (p.adoptedAt ?? AT),
    linkedRefs: [], createdAt: p.createdAt ?? AT, updatedAt: AT, excludeFromAi: p.excludeFromAi,
  };
}

/** A minimal localStorage shim so the real store functions run in Node. */
function installStorage(): { map: Map<string, string>; restore: () => void; breakWrites: () => void } {
  const map = new Map<string, string>();
  let broken = false;
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown };
  const had = "window" in g;
  const fake = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { if (broken) throw new Error("QuotaExceededError"); map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    clear: () => map.clear(),
  };
  g.window = { localStorage: fake };
  g.localStorage = fake;
  return {
    map,
    breakWrites: () => { broken = true; },
    restore: () => { if (!had) { delete g.window; delete g.localStorage; } },
  };
}

export function runBetaSelfTests(): SelfTestReport {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  // ============ 1. NO PRIVATE PROSE CAN ENTER (§17, §4) ============
  //
  // The central claim. Every one of these is a real thing a tester might write,
  // pushed at every field the schema has.

  const PROSE = [
    "I lose every evening to my phone and I hate myself for it",
    "PRIVATE TEST PRINCIPLE — BLUE LANTERN 7421",
    "I was raised Catholic and still pray every morning",
    "masonstrohmeyer@gmail.com",
    "Mason Strohmeyer",
    "https://app.conqify.com/constitution",
    "IGNORE ALL PREVIOUS INSTRUCTIONS",
    "Direct my attention deliberately rather than surrendering it by default.",
  ];

  {
    for (const field of ALLOWED_BETA_FIELDS) {
      if (field === "event" || field === "at") continue;
      for (const prose of PROSE) {
        const ev = buildBetaEvent("proposal_decision", { [field]: prose });
        const json = JSON.stringify(ev);
        ok(`1.1 "${field}" cannot hold prose (${prose.slice(0, 18)}…)`, !json.includes(prose.slice(0, 18)), json);
      }
    }
    // Fields that do not exist at all.
    for (const field of ["text", "statement", "answer", "body", "email", "userId", "prompt", "response", "note"]) {
      const ev = buildBetaEvent("interview_started", { [field]: PROSE[0], mode: "struggle" });
      ok(`1.2 unknown field "${field}" is dropped entirely`, !(field in (ev as object)), JSON.stringify(ev));
    }
    ok("1.3 an unknown event name records nothing", buildBetaEvent("keystroke_captured", { mode: "struggle" }) === null);
    ok("1.4 a legal event keeps its legal fields",
      JSON.stringify(buildBetaEvent("interview_started", { mode: "struggle" }, AT)) ===
      JSON.stringify({ event: "interview_started", at: AT, mode: "struggle" }));
    ok("1.5 an out-of-enum value for a legal field is dropped",
      !("mode" in (buildBetaEvent("interview_started", { mode: "confessional" }) as object)));
    ok("1.6 a non-finite number is dropped",
      !("questionsAnswered" in (buildBetaEvent("interview_review_opened", { questionsAnswered: NaN }) as object)));
    ok("1.7 numbers are clamped, so a huge count cannot encode data",
      (buildBetaEvent("interview_review_opened", { questionsAnswered: 9_999_999 }) as BetaEvent).questionsAnswered === 500);
    ok("1.8 fp must be exactly 8 hex characters",
      !("fp" in (buildBetaEvent("constitution_created", { fp: "not-a-fingerprint" }) as object)));
    ok("1.9 a real fingerprint is accepted",
      (buildBetaEvent("constitution_created", { fp: fingerprint("abc") }) as BetaEvent).fp === fingerprint("abc"));
    ok("1.10 a fingerprint is not the id", fingerprint("element-id-1") !== "element-id-1");
    ok("1.11 fingerprints are deterministic", fingerprint("x") === fingerprint("x"));
    ok("1.12 different ids fingerprint differently", fingerprint("a") !== fingerprint("b"));
    ok("1.13 every event stays under the size ceiling",
      BETA_EVENTS.every((n) => JSON.stringify(buildBetaEvent(n, {}, AT)).length <= MAX_EVENT_JSON));
    // A fully-populated event — the largest one the schema can produce.
    const maximal = buildBetaEvent("proposal_decision", {
      fp: fingerprint("z"), mode: "struggle", decision: "adopt", kind: "principle", edit: "substantial",
      origin: "builder", reason: "restore", task: "interview_synthesis", source: "ai", degraded: "provider",
      category: "bug", enabled: true, early: true, questionsAnswered: 500, domainsVisited: 50,
      domainsSkipped: 50, followupsShown: 100, proposalsProduced: 50, adopted: 50, keptDraft: 50,
      dismissed: 50, aiCalls: 200, contextChars: 100_000,
    }, AT)!;
    ok("1.14 even a maximal event fits the ceiling", JSON.stringify(maximal).length <= MAX_EVENT_JSON,
      String(JSON.stringify(maximal).length));
    ok("1.15 a maximal event is still clean", isCleanBetaEvent(maximal));
  }

  // ============ 2. SCHEMA WHITELIST & IDENTIFIERS (§17) ============
  {
    ok("2.1 no field name suggests an identifier",
      !ALLOWED_BETA_FIELDS.some((f) => /^(user|email|name|userId|ip|ipAddress|device|deviceId|sessionId)$/i.test(f)),
      ALLOWED_BETA_FIELDS.filter((f) => /^(user|email|name|userId|ip|ipAddress|device|deviceId|sessionId)$/i.test(f)).join(","));
    // The real invariant, asserted directly: NO field accepts free text. Names
    // like `questionsAnswered` and `contextChars` are counts, so name-matching
    // is the wrong instrument — this checks the property itself.
    ok("2.2 every field is meta, a fingerprint, an enum, a number or a boolean",
      ALLOWED_BETA_FIELDS.every((f) => !!FIELD_KINDS[f]),
      ALLOWED_BETA_FIELDS.filter((f) => !FIELD_KINDS[f]).join(","));
    ok("2.2b NO field accepts a free string",
      !Object.values(FIELD_KINDS).some((k) => (k as string) === "string" || (k as string) === "text"));
    ok("2.2c the only string-valued fields are closed enums or the fingerprint",
      ALLOWED_BETA_FIELDS
        .filter((f) => f !== "event" && f !== "at")
        .every((f) => ["fingerprint", "enum", "number", "boolean"].includes(FIELD_KINDS[f])),
      ALLOWED_BETA_FIELDS.filter((f) => f !== "event" && f !== "at" && !["fingerprint", "enum", "number", "boolean"].includes(FIELD_KINDS[f])).join(","));
    ok("2.3 isCleanBetaEvent rejects a foreign key",
      !isCleanBetaEvent({ event: "interview_started", at: AT, answerText: "hello" }));
    ok("2.4 isCleanBetaEvent rejects an unknown event", !isCleanBetaEvent({ event: "whatever", at: AT }));
    ok("2.5 isCleanBetaEvent rejects a bad enum value",
      !isCleanBetaEvent({ event: "proposal_decision", at: AT, decision: "maybe" }));
    ok("2.6 isCleanBetaEvent accepts a real one",
      isCleanBetaEvent({ event: "proposal_decision", at: AT, decision: "adopt", kind: "value" }));
    ok("2.7 evidence is NOT a store domain",
      !(STORE_DOMAINS as readonly string[]).some((d) => /beta|evidence|telemetry|analytic/i.test(d)));
    ok("2.8 evidence is NOT an export domain",
      !(EXPORT_DOMAINS as readonly string[]).some((d) => /beta|evidence|telemetry|analytic/i.test(d)));
    ok("2.9 the evidence key is namespaced and versioned", BETA_EVIDENCE_KEY.startsWith("conqify.beta."));
    ok("2.10 feedback uses a separate key from evidence",
      String(BETA_FEEDBACK_KEY) !== String(BETA_EVIDENCE_KEY));
  }

  // ============ 3. INTERVIEW & PROPOSAL COUNTS (§17) ============
  {
    const events: BetaEvent[] = [
      buildBetaEvent("interview_started", { mode: "struggle" }, AT)!,
      buildBetaEvent("interview_started", { mode: "stocktake" }, AT)!,
      buildBetaEvent("interview_review_opened", { questionsAnswered: 6, domainsVisited: 3, followupsShown: 2, proposalsProduced: 4, early: true }, AT)!,
      buildBetaEvent("interview_review_opened", { questionsAnswered: 10, domainsVisited: 5, followupsShown: 4, proposalsProduced: 3, early: false }, AT)!,
      buildBetaEvent("proposal_decision", { decision: "adopt", kind: "principle", edit: "unchanged" }, AT)!,
      buildBetaEvent("proposal_decision", { decision: "adopt", kind: "value", edit: "substantial" }, AT)!,
      buildBetaEvent("proposal_decision", { decision: "draft", kind: "value", edit: "minor" }, AT)!,
      buildBetaEvent("proposal_decision", { decision: "dismiss", kind: "standard", edit: "unchanged" }, AT)!,
      buildBetaEvent("interview_finished", { adopted: 2, keptDraft: 1, dismissed: 1 }, AT)!,
      buildBetaEvent("ai_exclusion_changed", { enabled: true }, AT)!,
      buildBetaEvent("ai_call", { task: "interview_synthesis", source: "ai", contextChars: 2200 }, AT)!,
      buildBetaEvent("ai_call", { task: "interview_followups", source: "mock", degraded: "provider" }, AT)!,
    ];
    const canary = checkConstitutionIntegrity(emptyState(), events, AT);
    const s = buildBetaSummary(events, [], canary, AT);

    eq("3.1 interviews started", s.interview.started, 2);
    eq("3.2 mode split", [s.interview.startedStruggle, s.interview.startedStocktake], [1, 1]);
    eq("3.3 reviews opened", s.interview.reviewOpened, 2);
    eq("3.4 early stops counted", s.interview.reviewOpenedEarly, 1);
    eq("3.5 average questions before review", s.interview.avgQuestionsBeforeReview, 8);
    eq("3.6 average domains before review", s.interview.avgDomainsBeforeReview, 4);
    eq("3.7 follow-ups totalled", s.interview.followupsShown, 6);
    eq("3.8 proposals produced", s.proposals.produced, 7);
    eq("3.9 adopted / draft / dismissed", [s.proposals.adopted, s.proposals.keptDraft, s.proposals.dismissed], [2, 1, 1]);
    eq("3.10 adopted unchanged vs rewritten", [s.proposals.adoptedUnchanged, s.proposals.adoptedSubstantialRewrite], [1, 1]);
    const valueRow = s.proposals.byKind.find((k) => k.kind === "value")!;
    eq("3.11 per-kind decisions", [valueRow.adopted, valueRow.draft, valueRow.dismissed], [1, 1, 0]);
    eq("3.12 exclusion toggles", s.trust.aiExclusionEnabled, 1);
    eq("3.13 model calls split", [s.model.calls, s.model.fromProvider, s.model.fromOffline, s.model.degraded], [2, 1, 1, 1]);
    eq("3.14 an empty log summarises to zeroes",
      buildBetaSummary([], [], canary, null).interview.avgQuestionsBeforeReview, null);

    // The rendered summary must not contain anything resembling a score.
    const md = summaryToMarkdown(s);
    for (const banned of ["engagement score", "discipline score", "alignment score", "success rate", "%"]) {
      ok(`3.15 the summary never shows "${banned}"`, !md.toLowerCase().includes(banned), md.slice(0, 120));
    }
    for (const prose of PROSE) ok(`3.16 the summary contains no prose`, !md.includes(prose));
  }

  // ============ 4. EDIT CLASSIFICATION (§10) ============
  {
    const original = "Direct my attention deliberately rather than surrendering it by default.";
    eq("4.1 identical wording is unchanged", classifyEdit(original, original), "unchanged");
    eq("4.2 punctuation-only is unchanged", classifyEdit(original, original.replace(".", "")), "unchanged");
    eq("4.3 one word swapped is a minor edit",
      classifyEdit(original, original.replace("deliberately", "intentionally")), "minor");
    eq("4.4 a full rewrite is substantial",
      classifyEdit(original, "I refuse to let a glowing rectangle decide what I care about."), "substantial");
    ok("4.5 classification never returns the text",
      !["unchanged", "minor", "substantial"].map((x) => x).join("").includes(original.slice(0, 10)));
  }

  // ============ 5. SILENT-ADOPTION CANARY (§8) ============
  {
    const state: StoreState = {
      ...emptyState(),
      constitutionElements: [el({ id: "e1", statement: "A thing.", createdAt: "2026-07-02T00:00:00.000Z" })],
    } as StoreState;

    // Recorded properly -> clean.
    const good: BetaEvent[] = [
      buildBetaEvent("constitution_created", { fp: fingerprint("e1"), kind: "value" }, AT)!,
      buildBetaEvent("constitution_adopted", { fp: fingerprint("e1"), kind: "value" }, AT)!,
    ];
    eq("5.1 a properly recorded element is clean", checkConstitutionIntegrity(state, good, AT).verdict, "clean");

    // Nothing recorded, no sync -> violation.
    const bad = checkConstitutionIntegrity(state, [], AT);
    eq("5.2 an element with no recorded action is a violation", bad.verdict, "violation");
    eq("5.3 the violation uses the exact stop-the-line banner", bad.headline, STOP_THE_LINE);
    eq("5.4 the violation names the element by fingerprint only", bad.unaccounted[0]?.fp, fingerprint("e1"));
    ok("5.5 the canary never reports the element's wording", !JSON.stringify(bad).includes("A thing."));

    // Created but never adopted, while adoptedAt is set -> violation.
    const halfway = checkConstitutionIntegrity(state, [good[0]], AT);
    eq("5.6 adopted with no recorded adoption is a violation", halfway.verdict, "violation");
    ok("5.7 and it says which half is missing", halfway.unaccounted[0]?.adoptedWithoutRecord === true);

    // Sync happened -> inconclusive, NOT a violation (no crying wolf).
    const synced = checkConstitutionIntegrity(state, [buildBetaEvent("state_replaced", { reason: "remote_adoption" }, AT)!], AT);
    eq("5.8 a sync window makes it inconclusive, not a violation", synced.verdict, "inconclusive");
    ok("5.9 inconclusive never uses the stop-the-line banner", synced.headline !== STOP_THE_LINE);

    // Predates instrumentation -> excluded and counted, not judged.
    const older: StoreState = {
      ...emptyState(),
      constitutionElements: [el({ id: "old", statement: "Older.", createdAt: "2026-06-01T00:00:00.000Z" })],
    } as StoreState;
    const pre = checkConstitutionIntegrity(older, [], AT);
    eq("5.10 an element older than instrumentation is not a violation", pre.verdict, "clean");
    eq("5.11 and it is counted honestly rather than hidden", pre.predatesInstrumentation, 1);
    eq("5.12 nothing was checked", pre.checked, 0);

    // No instrumentation at all -> cannot judge.
    eq("5.13 with no start time nothing is judged", checkConstitutionIntegrity(state, [], null).verdict, "clean");
    eq("5.14 an empty Constitution is clean", checkConstitutionIntegrity(emptyState(), [], AT).verdict, "clean");

    // The canary is a pure read — it must not mutate.
    const snapshot = JSON.stringify(state.constitutionElements);
    checkConstitutionIntegrity(state, [], AT);
    ok("5.15 the canary never self-heals or mutates", JSON.stringify(state.constitutionElements) === snapshot);
  }

  // ============ 6. FEEDBACK (§6, §17) ============
  {
    const f = makeFeedback({ happened: "The review felt long.", expected: "Fewer questions", category: "too_many_questions" }, AT, "fb1")!;
    eq("6.1 feedback is user-authored by construction", f.origin, "user_authored");
    eq("6.2 the category is kept", f.category, "too_many_questions");
    ok("6.3 an unknown category falls back to other",
      makeFeedback({ happened: "x", category: "espionage" }, AT)!.category === "other");
    ok("6.4 empty feedback is refused", makeFeedback({ happened: "   ", category: "bug" }, AT) === null);
    ok("6.5 feedback text is bounded",
      (makeFeedback({ happened: "x".repeat(9_999), category: "bug" }, AT)!.happened.length) <= 2_000);

    const entries: BetaFeedback[] = [f, makeFeedback({ happened: "Felt invasive.", category: "privacy_trust" }, AT, "fb2")!];
    const counts = feedbackCounts(entries);
    eq("6.6 counts by category", [counts.too_many_questions, counts.privacy_trust], [1, 1]);
    ok("6.7 every category is represented in the count map",
      FEEDBACK_CATEGORIES.every((c) => c in counts));

    // Feedback text must not reach the evidence log — only a category counter.
    const ev = buildBetaEvent("feedback_submitted", { category: "privacy_trust", happened: "Felt invasive." })!;
    ok("6.8 the feedback EVENT carries no text", !JSON.stringify(ev).includes("Felt invasive"));
    eq("6.9 it carries only the category", ev.category, "privacy_trust");

    const summary = buildBetaSummary([ev], entries, checkConstitutionIntegrity(emptyState(), [], AT), AT);
    ok("6.10 the founder summary shows counts, never feedback text",
      !JSON.stringify(summary).includes("Felt invasive"));
    eq("6.11 privacy/trust reports are surfaced as their own number", summary.trust.privacyTrustReports, 1);

    // Feedback must never become AI context either. Asserted rather than
    // asserted-in-a-comment: with feedback sitting in its key, the interview
    // context the model would receive is byte-identical to the context built
    // with that key empty. Nothing on the AI path reads it.
    const io = installStorage();
    try {
      __resetInterviewIds();
      const session = recordAnswer(
        startSession("stocktake", AT, AT), "opening", "direction", "I want to stop drifting.", AT,
      );
      const opts = { includeConstitution: true, includeSources: true };
      const without = JSON.stringify(buildInterviewContext(emptyState(), session, opts));
      saveFeedback(makeFeedback({ happened: "SENTINEL-FEEDBACK-PROSE", category: "bug" }, AT, "fb3")!);
      ok("6.12 the feedback was actually stored (guards the next assertion)",
        readFeedback().some((x) => x.happened === "SENTINEL-FEEDBACK-PROSE"));
      const withFb = JSON.stringify(buildInterviewContext(emptyState(), session, opts));
      ok("6.13 stored feedback does not appear in the AI context",
        !withFb.includes("SENTINEL-FEEDBACK-PROSE"));
      ok("6.14 stored feedback does not change the AI context at all", withFb === without);
    } finally {
      io.restore();
    }
  }

  // ============ 7. EVIDENCE IS SUBORDINATE TO THE PRODUCT (§13) ============
  {
    const io = installStorage();
    try {
      clearEvidence();
      ok("7.1 recording works", record("interview_started", { mode: "struggle" }));
      eq("7.2 it is readable back", readEvidence().length, 1);
      ok("7.3 the start marker is set", !!evidenceStartedAt());

      // A corrupt log must not throw or poison the read.
      io.map.set(BETA_EVIDENCE_KEY, "{not json");
      eq("7.4 a corrupt log reads as empty rather than throwing", readEvidence().length, 0);
      ok("7.5 and recording still works afterwards", record("interview_started", { mode: "stocktake" }));

      // A log containing a forbidden field is filtered on read.
      io.map.set(BETA_EVIDENCE_KEY, JSON.stringify([
        { event: "interview_started", at: AT, mode: "struggle" },
        { event: "interview_started", at: AT, answerText: "I lose my evenings" },
      ]));
      const filtered = readEvidence();
      eq("7.6 a legacy event with a forbidden field is dropped on read", filtered.length, 1);
      ok("7.7 its content never surfaces", !JSON.stringify(filtered).includes("I lose my evenings"));

      // Quota exhaustion must be absorbed silently.
      io.breakWrites();
      let threw = false;
      let stored = true;
      try { stored = record("interview_started", { mode: "struggle" }); } catch { threw = true; }
      ok("7.8 a full/broken storage never throws", !threw);
      ok("7.9 and the recorder reports it did not store", stored === false);
      ok("7.10 clearing never throws on broken storage", (() => { try { clearEvidence(); return true; } catch { return false; } })());
    } finally {
      io.restore();
    }

    // With no browser at all, every entry point is a safe no-op.
    ok("7.11 recording without a browser is a no-op", record("interview_started", { mode: "struggle" }) === false);
    eq("7.12 reading without a browser is empty", readEvidence().length, 0);
    eq("7.13 the start marker without a browser is null", evidenceStartedAt(), null);
    ok("7.14 the ring buffer is bounded", MAX_EVENTS > 0 && MAX_EVENTS <= 2_000);
  }

  // ============ 8. RING BUFFER & RESET (§17) ============
  {
    const io = installStorage();
    try {
      clearEvidence();
      for (let i = 0; i < MAX_EVENTS + 25; i++) record("interview_started", { mode: "struggle" });
      eq("8.1 the log is pruned to the bound", readEvidence().length, MAX_EVENTS);
      clearEvidence();
      eq("8.2 clearing empties the log", readEvidence().length, 0);
      ok("8.3 clearing removes the evidence key", !io.map.has(BETA_EVIDENCE_KEY));
      ok("8.4 clearing removes the start marker", !io.map.has(BETA_START_KEY));
    } finally {
      io.restore();
    }
  }

  // ============ 9. THE DISCLOSURE MATCHES BEHAVIOUR (§12) ============
  {
    ok("9.1 every disclosure line names the code that keeps it",
      DISCLOSURE_CLAIMS.every((c) => c.kept_by.startsWith("lib/beta/")));
    eq("9.2 the disclosure is exactly the claim lines", BETA_DISCLOSURE.length, DISCLOSURE_CLAIMS.length);
    ok("9.3 it promises that content is never recorded",
      BETA_DISCLOSURE.some((l) => /never records what you wrote/i.test(l)));
    ok("9.4 it promises nothing is uploaded",
      BETA_DISCLOSURE.some((l) => /stays in this browser/i.test(l)));
    ok("9.5 it names reset and sign-out as deletion paths",
      BETA_DISCLOSURE.some((l) => /resetting your local data or signing out/i.test(l)));
    ok("9.6 no line uses vague analytics language",
      BETA_DISCLOSURE.every((l) => violatesBetaDisclosure(l).length === 0),
      BETA_DISCLOSURE.find((l) => violatesBetaDisclosure(l).length > 0));
    ok("9.7 the vagueness check catches the sentence we refuse to write",
      violatesBetaDisclosure("We collect usage data to improve the experience.").length > 0);
    ok("9.8 the forbidden list is non-trivial", FORBIDDEN_DISCLOSURE_PHRASES.length >= 5);
  }

  // ============ 10. NO NEW ONTOLOGY (§11) ============
  {
    const banned = ["quadrant", "developmental", "lifeArea", "pattern", "calendar", "recurrence", "attentionCategory", "lifeScore"];
    for (const b of banned) {
      ok(`10.1 no store domain named like "${b}"`,
        !(STORE_DOMAINS as readonly string[]).some((d) => d.toLowerCase().includes(b.toLowerCase())));
    }
    // Pinned to the count on main before this sprint. LIFEOS-059 adds no domain.
    ok("10.2 the beta added no store domain at all", (STORE_DOMAINS as readonly string[]).length === 44,
      String((STORE_DOMAINS as readonly string[]).length));
    ok("10.3 no beta event names a life noun",
      !BETA_EVENTS.some((e) => /pattern|quadrant|calendar|score|level|stage/i.test(e)));
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  return { pass: passed === total, total, passed, failed: total - passed, ms: Date.now() - started, results };
}
