/**
 * Meaning capture self-tests (LIFEOS-093).
 *
 * ## The reds this suite pins
 *
 * §2's audit measured four:
 *
 *   1. LIFEOS-091 wrote `context: date` on every reflection and NOTHING read
 *      it — a reflection typed at 22:00 about yesterday appeared on today's
 *      review and was absent from the day it was about
 *   2. Memory had no words for meaning: what mattered, what I learned, what was
 *      difficult, what I am realizing, a decision worth remembering — every one
 *      fell through to the generic capability line with no evidence
 *   3. the Evening Close offered one generic prompt, for today only
 *   4. wins / lessons / friction had no writer (by design, from 092)
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * This layer earns trust by what it refuses: to make writing mandatory, to
 * restamp a timestamp, to file a reflection under a day it was not about, to
 * read a machine's sentence back as the user's, to score a feeling, to turn
 * reflective prose into a rule or a goal change, or to say a single word about
 * what a difficult day means about a person.
 *
 * Pure: no store, no clock, no AI.
 */

import type { Reflection, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildEveningClose } from "@/lib/today/evening";
import { buildExecutiveChanges } from "@/lib/memory/changes";
import { answerMemoryQuery, isTopiclessTerm } from "@/lib/memory/answer";
import { resolveRange } from "@/lib/insights/range";
import { dayKeyFromIso } from "@/lib/reviews/dates";
import {
  REFLECTION_PROMPTS, PRIMARY_PROMPT_KINDS, MAX_VISIBLE_PROMPTS,
  primaryPrompts, otherPrompts, promptFor, promptKindOf,
  reflectionDayKey, hasReviewedDay, meaningEntry, meaningForDay, meaningPageForDay,
  MAX_MEANING_CARDS,
  writtenLaterNote, meaningStrings,
  MEANING_EMPTY, MEANING_MORE, MEANING_FORBIDDEN_WORDS,
  type ReflectionPromptKind,
} from "@/lib/reviews/meaning";

const TODAY = "2026-09-09";
const YEST = "2026-09-08";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

const refl = (p: Partial<Reflection> & { id: string; response: string }): Reflection => ({
  prompt: "Anything worth remembering?", createdAt: D(TODAY, 21), annotations: [], ...p,
} as Reflection);

function world(): StoreState {
  const s = emptyStoreState();
  s.goals = [{
    id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
    history: [], createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  } as StoreState["goals"][number]];
  s.reflections = [
    refl({ id: "r-today", prompt: "What mattered today?",
      response: "I finally felt clear that philosophy is the direction I want.",
      context: TODAY, createdAt: D(TODAY, 21) }),
    // Typed today, ABOUT yesterday. The audit's RED 1.
    refl({ id: "r-yest", prompt: "What did you learn?",
      response: "Yesterday's meeting was the turning point.",
      context: YEST, createdAt: D(TODAY, 22) }),
    // No context at all — an older record, or one written elsewhere.
    refl({ id: "r-bare", prompt: "What did you learn?",
      response: "Reading aloud catches what the eye skips.",
      createdAt: D(TODAY, 20) }),
    // A free-form context that is NOT a day. Must not become a date.
    refl({ id: "r-mood", prompt: "What felt difficult?",
      response: "Writing the statement felt impossible.",
      context: "on the train", createdAt: D(TODAY, 19) }),
  ];
  // §9, §10. Historical structured content, kept readable.
  s.dailyReviews = [{
    id: "dr1", date: "2026-08-20", status: "completed", summary: "A good day.",
    // Field names checked against the schema, not guessed: a win and a lesson
    // each carry `links`, and a friction has `description` rather than `text`,
    // plus a severity, an area and a resolution.
    wins: [{ id: "w1", text: "Sent the first application", links: [], createdAt: D("2026-08-20", 20) }],
    lessons: [{ id: "l1", text: "Start the essay earlier", links: [], createdAt: D("2026-08-20", 20) }],
    friction: [{ id: "f1", description: "The portal kept timing out", severity: "low",
      area: "workflow", resolved: false, resolutionNotes: "", createdAt: D("2026-08-20", 20) }],
    openLoops: [], tomorrowFocus: [], notes: "", linkedGoals: [], linkedProjects: [],
    linkedWorkspaces: [], linkedEntities: [],
    createdAt: D("2026-08-20"), updatedAt: D("2026-08-20"),
  } as StoreState["dailyReviews"][number]];
  return s;
}

const close = (s: StoreState, date: string) =>
  buildEveningClose(s, buildTodayIndexes(s, date), { date, today: TODAY, offsetMinutes: 0 });

export function runMeaningCaptureSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  const s = world();

  // ---- §5, §6. The prompts -----------------------------------------------
  ok("93.1 §5 three prompts are offered without asking for more",
    primaryPrompts().length === MAX_VISIBLE_PROMPTS, String(primaryPrompts().length));
  ok("93.2 §5 …and the rest exist behind one press",
    otherPrompts().length > 0 && otherPrompts().every((p) => !PRIMARY_PROMPT_KINDS.includes(p.kind)),
    otherPrompts().map((p) => p.kind).join(","));
  ok("93.3 §5 every prompt kind appears exactly once",
    new Set(REFLECTION_PROMPTS.map((p) => p.kind)).size === REFLECTION_PROMPTS.length);
  ok("93.4 §6 every prompt is a plain question",
    REFLECTION_PROMPTS.every((p) => p.text.trim().endsWith("?")),
    REFLECTION_PROMPTS.map((p) => p.text).join(" | "));
  ok("93.5 §6, §24 no prompt asks for a rating, a mood or a diagnosis",
    !MEANING_FORBIDDEN_WORDS.some((w) =>
      meaningStrings().join(" ").toLowerCase().includes(w)),
    MEANING_FORBIDDEN_WORDS.filter((w) => meaningStrings().join(" ").toLowerCase().includes(w)).join(", "));
  ok("93.6 §6 …and none uses therapeutic framing",
    !/emotional state|limiting belief|rate the quality|how do you feel about yourself/i
      .test(meaningStrings().join(" ")));
  ok("93.7 §4, §29 the resting copy says nothing about what was not written",
    /optional/i.test(MEANING_EMPTY) && !/haven't|incomplete|finish|remember to/i.test(MEANING_EMPTY),
    MEANING_EMPTY);
  ok("93.8 §36 there is no streak or completion vocabulary anywhere",
    !/streak|\d\s*of\s*\d|badge|complete your/i.test(meaningStrings().join(" ") + MEANING_MORE));

  // ---- §7. The kind travels in the prompt, with no schema ----------------
  ok("93.9 §7 a stored reflection reports the kind it answers",
    promptKindOf({ prompt: "What mattered today?" }) === "mattered",
    String(promptKindOf({ prompt: "What mattered today?" })));
  ok("93.10 §7 …for every prompt in the set",
    REFLECTION_PROMPTS.every((p) => promptKindOf({ prompt: p.text }) === p.kind));
  ok("93.11 §7 LIFEOS-091's older prompt still reads as a kind",
    promptKindOf({ prompt: "Anything about today worth remembering?" }) === "remember",
    String(promptKindOf({ prompt: "Anything about today worth remembering?" })));
  ok("93.12 §7 …and an unrelated reflection reports none rather than guessing",
    promptKindOf({ prompt: "What did the book say?" }) === null,
    String(promptKindOf({ prompt: "What did the book say?" })));

  // ---- §11, §27. One writer, one save at a time --------------------------
  {
    const e = meaningEntry("learned", "  Reading aloud catches what the eye skips.  ", YEST);
    ok("93.13 §11 an answer becomes a reflection, not a journal record",
      !!e && e.prompt === promptFor("learned").text, JSON.stringify(e));
    ok("93.14 §27 …carrying the reviewed day, not today",
      e?.context === YEST, String(e?.context));
    ok("93.15 §11 …with the user's words trimmed but not altered",
      e?.response === "Reading aloud catches what the eye skips.", JSON.stringify(e?.response));
    ok("93.16 §4, §29 an empty answer writes nothing at all",
      meaningEntry("learned", "   ", TODAY) === null);
  }

  // ---- RED 1 (§13, §14). The reviewed day is now READ --------------------
  ok("93.17 §13 an explicit reviewed day wins over the writing day",
    reflectionDayKey({ context: YEST, createdAt: D(TODAY, 22) }) === YEST);
  ok("93.18 §13 …and a reflection with no context falls back to when it was written",
    reflectionDayKey({ createdAt: D(TODAY, 20) }) === TODAY);
  ok("93.19 §13 …and a NON-date context is never read as a date",
    reflectionDayKey({ context: "on the train", createdAt: D(TODAY, 19) }) === TODAY,
    reflectionDayKey({ context: "on the train", createdAt: D(TODAY, 19) }));
  ok("93.20 §13 …which `hasReviewedDay` reports honestly",
    hasReviewedDay({ context: YEST }) && !hasReviewedDay({ context: "on the train" })
    && !hasReviewedDay({}));
  {
    const today = close(s, TODAY);
    const yest = close(s, YEST);
    const ids = (xs: { entity: { id: string } }[]) => xs.map((x) => x.entity.id).sort();
    ok("93.21 RED 1 a reflection about yesterday belongs to yesterday's review",
      ids(yest.reflections).includes("r-yest"), ids(yest.reflections).join(","));
    ok("93.22 RED 1 …and is absent from today's",
      !ids(today.reflections).includes("r-yest"), ids(today.reflections).join(","));
    ok("93.23 §13 today's own reflections are still today's",
      ids(today.reflections).includes("r-today") && ids(today.reflections).includes("r-bare"),
      ids(today.reflections).join(","));
    ok("93.24 §13 …including the one whose context is not a date",
      ids(today.reflections).includes("r-mood"), ids(today.reflections).join(","));
    ok("93.25 §31 no reflection appears on two days at once",
      ids(today.reflections).every((id) => !ids(yest.reflections).includes(id)),
      `${ids(today.reflections).join(",")} vs ${ids(yest.reflections).join(",")}`);
  }
  {
    // §13. Nothing is restamped. The instant stays exactly what it was.
    const day = resolveRange("custom", { customStart: YEST, customEnd: YEST, offsetMinutes: 0 });
    const ch = buildExecutiveChanges(s, day).filter((c) => c.entity.id === "r-yest");
    ok("93.26 §13 the reflection is filed under the day it is about",
      ch[0]?.day === YEST, String(ch[0]?.day));
    ok("93.27 §13 …while its recorded instant is untouched",
      ch[0]?.occurredAt === D(TODAY, 22), String(ch[0]?.occurredAt));
    ok("93.28 §13 …and the evidence names which field decided it",
      ch[0]?.evidence === "reflection.context", String(ch[0]?.evidence));
    const bare = buildExecutiveChanges(s,
      resolveRange("custom", { customStart: TODAY, customEnd: TODAY, offsetMinutes: 0 }))
      .find((c) => c.entity.id === "r-bare");
    ok("93.29 §13 …and a reflection with no context still says createdAt",
      bare?.evidence === "reflection.createdAt", String(bare?.evidence));
  }

  // ---- §30, §31. The cards ------------------------------------------------
  {
    const cards = meaningForDay(s.reflections, TODAY);
    ok("93.30 §30 a day's cards carry the prompt and the response",
      cards.every((c) => !!c.prompt && !!c.reflection.response), String(cards.length));
    ok("93.31 §30 …and the kind, where the prompt is one of ours",
      cards.some((c) => c.kind === "mattered"), cards.map((c) => c.kind).join(","));
    ok("93.32 §31 …with no reflection from another day",
      !cards.some((c) => c.reflection.id === "r-yest"), cards.map((c) => c.reflection.id).join(","));
    // Guarded: a mutation that empties this list must REDDEN the assertion, not
    // crash it on `undefined.writtenLater`. A throw is not a catch.
    const later = meaningForDay(s.reflections, YEST)[0];
    ok("93.33 §13 a reflection written later says so",
      !!later && later.writtenLater === true && !!writtenLaterNote(later, (d) => d),
      later ? String(writtenLaterNote(later, (d) => d)) : "(yesterday has no reflection)");
    ok("93.34 §13 …and one written on the day it is about does not",
      cards.every((c) => c.writtenLater === false),
      cards.map((c) => `${c.reflection.id}:${c.writtenLater}`).join(","));
    ok("93.35 §30 cards are ordered by when they were written",
      cards.map((c) => c.reflection.createdAt).join("|")
        === [...cards].sort((a, b) => a.reflection.createdAt.localeCompare(b.reflection.createdAt))
          .map((c) => c.reflection.createdAt).join("|"));
  }

  // ---- RED 2 (§16). Memory has words for meaning -------------------------
  {
    const asked = (q: string) => answerMemoryQuery(s, q, { today: TODAY });
    const grounded = (q: string) => {
      const a = asked(q);
      const text = `${a.heading ?? ""} ${a.summary ?? ""}`;
      return !/answers questions about what it recorded|found no recorded evidence/i.test(text);
    };
    for (const q of [
      "what mattered today?",
      "what did I learn this week?",
      "what felt difficult today?",
      "what was I realizing this week?",
      "what decisions did I want to remember this week?",
    ]) {
      ok(`93.36 §16 Memory answers “${q}”`, grounded(q),
        `${asked(q).heading ?? ""} — ${(asked(q).summary ?? "").slice(0, 80)}`);
      // …and answers it as a question about the PERIOD, not about the literal
      // word. Removing "learn" from the vocabulary first escaped this suite
      // because the fixture's own prompt text contains "learn", so a literal
      // search still found two records — the wrong answer, passing a test that
      // only asked whether SOME answer came back.
      const a = asked(q);
      ok(`93.36a §16 …as a question about the period, not the word`,
        !/mention/i.test(`${a.heading ?? ""} ${a.summary ?? ""}`),
        `${a.heading ?? ""} — ${(a.summary ?? "").slice(0, 80)}`);
    }
    for (const term of ["learn", "learned", "mattered", "difficult", "realizing", "decisions", "remember"]) {
      ok(`93.36b §16 “${term}” is frame, not a topic to search for`,
        isTopiclessTerm(term), String(isTopiclessTerm(term)));
    }
    ok("93.37 §17 a topic question still searches for its topic",
      /philosophy/i.test(asked("what did I say about philosophy?").summary ?? ""),
      asked("what did I say about philosophy?").summary ?? "");
    ok("93.38 §16 …so the meaning verbs did not swallow every question",
      !isTopiclessTerm("philosophy") && !isTopiclessTerm("the deployment"),
      `${isTopiclessTerm("philosophy")} ${isTopiclessTerm("the deployment")}`);
    ok("93.39 §16 a multiword frame remnant is recognised as frame",
      isTopiclessTerm("decisions i want remember") && isTopiclessTerm("felt difficult"),
      `${isTopiclessTerm("decisions i want remember")} ${isTopiclessTerm("felt difficult")}`);
    ok("93.40 §16 …but a frame word beside a real topic is not",
      !isTopiclessTerm("learn about teaching"), String(isTopiclessTerm("learn about teaching")));
  }

  // ---- §9, §10. History stays readable -----------------------------------
  {
    const dr = s.dailyReviews[0];
    ok("93.41 §9 historical wins are still there", dr.wins.length === 1);
    ok("93.42 §9 …and lessons", dr.lessons.length === 1);
    ok("93.43 §9 …and friction", dr.friction.length === 1);
    ok("93.44 §10 …and nothing this sprint writes touches that record",
      meaningEntry("learned", "x", TODAY)?.prompt !== undefined
      && !("wins" in (meaningEntry("learned", "x", TODAY) ?? {})));
  }

  // ---- §12, §21, §22, §23. What it refuses to infer ----------------------
  {
    const decision = meaningEntry("decision", "I decided not to apply to law school.", TODAY);
    ok("93.45 §22 a decision reflection is a reflection, and nothing else",
      !!decision && Object.keys(decision).sort().join(",") === "context,prompt,response",
      Object.keys(decision ?? {}).join(","));
    ok("93.46 §22 …it carries no goal id to mutate",
      !JSON.stringify(decision).includes("g1"));
    const hard = meaningEntry("difficult", "Writing the statement felt impossible.", TODAY);
    ok("93.47 §23 a difficulty reflection is stored as written",
      hard?.response === "Writing the statement felt impossible.", String(hard?.response));
    ok("93.48 §23, §24 …with nothing inferred about the person",
      !/avoidance|anxiety|burnout|stress|struggling/i.test(JSON.stringify(hard)));
    ok("93.49 §21 …and reflective prose is never shaped into a rule",
      !JSON.stringify(meaningEntry("realization", "I need to stop replying when angry.", TODAY))
        .match(/protocol|standard|constitution/i));
  }
  ok("93.50 §25 nothing here generates prose about the day",
    !meaningStrings().some((x) => /today's themes|overall|in summary/i.test(x)));

  // ---- §42. Bounded work --------------------------------------------------
  {
    const big = emptyStoreState();
    for (let i = 0; i < 2000; i += 1) {
      big.reflections.push(refl({ id: `b${i}`, response: `Thought number ${i}`,
        context: i % 2 ? TODAY : YEST, createdAt: D(TODAY, 12) }));
    }
    const t = Date.now();
    const cards = meaningForDay(big.reflections, TODAY);
    const ms = Date.now() - t;
    ok("93.51 §42 two thousand reflections filter in under 100ms", ms < 100, `${ms}ms`);
    ok("93.52 §42 …and only the day's own are returned",
      cards.length === 1000, String(cards.length));
    // §41. A performance run at 5,000 records rendered 251 cards. Everything
    // else in this product caps a list and counts the rest; this does too.
    const page = meaningPageForDay(big.reflections, TODAY);
    ok("93.52a §41 the rendered page is bounded",
      page.cards.length <= MAX_MEANING_CARDS, String(page.cards.length));
    ok("93.52b §41 …and the remainder is counted rather than dropped",
      page.cards.length + page.more === 1000, `${page.cards.length} + ${page.more}`);
    ok("93.52c §41 a normal day is not truncated at all",
      meaningPageForDay(s.reflections, TODAY).more === 0,
      String(meaningPageForDay(s.reflections, TODAY).more));
  }

  // ---- §4. The close survives with nothing written -----------------------
  {
    const bare = emptyStoreState();
    const c = close(bare, TODAY);
    ok("93.53 §4 a day with no reflection still closes", c.quiet === true && c.reflections.length === 0);
    ok("93.54 §4 …and nothing calls it unfinished",
      !/incomplete|unfinished|finish/i.test(`${MEANING_EMPTY} ${MEANING_MORE}`));
  }
  ok("93.55 §13 the day helper agrees with the timeline's own derivation",
    (s.reflections).every((r) =>
      reflectionDayKey(r) === (hasReviewedDay(r) ? r.context : dayKeyFromIso(r.createdAt))));

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

/** Re-exported so the mutation harness can target one kind by name. */
export type { ReflectionPromptKind };
