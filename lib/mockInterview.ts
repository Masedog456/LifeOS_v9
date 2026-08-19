/**
 * Deterministic offline output for the Constitution Builder (LIFEOS-058).
 *
 * Follows the established pattern (`lib/mockAI.ts`, `lib/mockFormation.ts`, …):
 * when no provider is configured, or a call fails, the product still works. For
 * this feature that matters more than usual — a person part-way through an
 * interview about their marriage should not be told to come back later because a
 * key expired.
 *
 * ## The rule these mocks obey
 *
 * They produce the SAME SHAPE as the model and go through the SAME validator.
 * Nothing here bypasses `lib/interview/proposals.ts`. If a mock emitted a fifth
 * Constitution kind, the validator would reject it exactly as it rejects the
 * model's — which is how the offline path stays honest rather than privileged.
 *
 * ## Why the mock proposals are cautious
 *
 * Every mock statement is drawn from the user's own words plus a small connective
 * phrase, and every one cites the answer it came from. A mock that invented a
 * philosophy would be worse than no mock: the user cannot tell from the screen
 * which path produced a proposal, so the offline path must be no more
 * presumptuous than the online one.
 */

import type { ConstitutionKind } from "@/types/mvp";

/** The wire shape the route and client both use for interview context. */
export interface MockContextItem {
  id: string;
  group: string;
  kind: string;
  text: string;
}

/** Themes the deterministic path can recognise. Content-word matching only. */
interface Theme {
  id: string;
  /** Any of these words present in an answer marks the theme. */
  words: readonly string[];
  kind: ConstitutionKind;
  /** The proposed statement. Deliberately general, never a plan. */
  statement: string;
  /** Follow-up questions offered when this theme appears. */
  followups: readonly string[];
}

const THEMES: readonly Theme[] = [
  {
    id: "attention",
    words: ["phone", "scroll", "scrolling", "distract", "distracted", "attention", "focus", "social media", "screen", "evenings", "evening"],
    kind: "principle",
    statement: "Direct my attention deliberately rather than surrendering it by default.",
    followups: [
      "What would you rather be doing during that time?",
      "Is the problem primarily habit, fatigue, boredom, avoidance, or something else?",
      "When does it happen most often?",
      "What have you already tried?",
    ],
  },
  {
    id: "presence",
    words: ["family", "wife", "husband", "partner", "kids", "children", "son", "daughter", "present", "presence"],
    kind: "value",
    statement: "The people closest to me get my actual presence, not my leftover attention.",
    followups: [
      "What does being present with them actually look like on an ordinary day?",
      "When is it hardest?",
    ],
  },
  {
    id: "learning",
    words: ["read", "reading", "books", "study", "studying", "learn", "learning", "understand"],
    kind: "value",
    statement: "Understanding things well is worth the slow, unglamorous work it takes.",
    followups: [
      "What are you actually trying to understand?",
      "What tends to stop you part-way through?",
    ],
  },
  {
    id: "health",
    words: ["exercise", "sleep", "health", "eat", "eating", "run", "running", "gym", "walk", "tired", "energy"],
    kind: "standard",
    statement: "I keep the physical foundations I depend on — sleep, movement, food — in working order.",
    followups: [
      "Which of those foundations is currently under the most strain?",
      "What does your routine do that gets in the way?",
    ],
  },
  {
    id: "automatic",
    words: ["automatic", "automatically", "autopilot", "habit", "mindless", "default", "deliberate", "deliberately", "intention", "intentional"],
    kind: "principle",
    statement: "Act on purpose. When I notice I am running on automatic, I stop and choose.",
    followups: [
      "Where does acting automatically cost you the most?",
      "Is there a moment in the day when you could reliably notice it?",
    ],
  },
  {
    id: "work",
    words: ["work", "job", "career", "build", "contribute", "craft", "business"],
    kind: "purpose",
    statement: "My work is meant to build something worth having built, not merely to keep me occupied.",
    followups: [
      "What are you trying to build or contribute?",
      "Which responsibilities genuinely cannot be ignored?",
    ],
  },
  {
    id: "money",
    words: ["money", "spend", "spending", "debt", "save", "saving", "budget", "finances"],
    kind: "value",
    statement: "Money is a means to the life I actually want, and I want to handle it accordingly.",
    followups: [
      "What does responsible use of money mean to you specifically?",
      "Where does the uncertainty show up?",
    ],
  },
  {
    id: "meaning",
    words: ["faith", "god", "prayer", "meditation", "stoic", "stoicism", "buddhis", "christian", "philosophy", "spiritual", "meaning", "tradition"],
    kind: "purpose",
    statement: "What I believe about how to live should show up in how I actually live.",
    // Note: never asserts what a tradition teaches (§25) — it asks.
    followups: [
      "What about that resonates with you?",
      "Which of its practices do you actually want to live?",
    ],
  },
];

function answersOf(items: readonly MockContextItem[]): MockContextItem[] {
  return items.filter((i) => i.group === "answer");
}

/** Which themes appear in an answer's text. */
function themesIn(text: string): Theme[] {
  const low = (text ?? "").toLowerCase();
  return THEMES.filter((t) => t.words.some((w) => low.includes(w)));
}

/**
 * Deterministic follow-up questions for the most recent answer.
 *
 * Falls back to two general clarifiers when no theme matches, because "we have
 * nothing to ask you" is a worse offline experience than a genuinely useful
 * generic question. Both fallbacks are open questions about the user's own
 * meaning — neither proposes anything.
 */
export function mockFollowups(items: readonly MockContextItem[]): { followups: string[] } {
  const answers = answersOf(items);
  const last = answers[answers.length - 1];
  if (!last) return { followups: [] };
  const matched = themesIn(last.text);
  if (matched.length === 0) {
    return { followups: ["What makes that matter to you?", "When does it show up most?"] };
  }
  // Stable across runs: theme order is the declaration order above.
  const out: string[] = [];
  for (const t of matched) {
    for (const q of t.followups) {
      if (out.length >= 2) break;
      if (!out.includes(q)) out.push(q);
    }
    if (out.length >= 2) break;
  }
  return { followups: out };
}

/**
 * Deterministic synthesis: themes → Constitution candidates.
 *
 * A theme is proposed only when it appears in at least one answer, and the
 * proposal cites every answer it appeared in. A theme present in no answer
 * produces nothing — the offline path never fills the review screen just to
 * have something on it.
 */
export function mockInterviewSynthesis(items: readonly MockContextItem[]): {
  proposals: { kind: ConstitutionKind; statement: string; rationale: string; supportingAnswerIds: string[]; sourceRefs: []; fitConfidence: "low" | "medium" | "high" }[];
  tensions: { observation: string; betweenAnswerIds: string[] }[];
} {
  const answers = answersOf(items);
  const existing = items.filter((i) => i.group === "constitution").map((i) => i.text.toLowerCase());

  const hits = new Map<string, { theme: Theme; ids: string[] }>();
  for (const a of answers) {
    for (const t of themesIn(a.text)) {
      const cur = hits.get(t.id) ?? { theme: t, ids: [] };
      if (!cur.ids.includes(a.id)) cur.ids.push(a.id);
      hits.set(t.id, cur);
    }
  }

  const proposals = Array.from(hits.values())
    .filter(({ theme }) => {
      // Do not re-propose something the existing Constitution already says
      // almost verbatim. The real duplicate check is `lib/interview/duplicates`,
      // which the UI runs over ALL elements; this is just the offline path
      // declining to be obviously redundant.
      const key = theme.statement.toLowerCase().slice(0, 30);
      return !existing.some((e) => e.includes(key));
    })
    .map(({ theme, ids }) => ({
      kind: theme.kind,
      statement: theme.statement,
      rationale: `You mentioned this in ${ids.length} answer${ids.length === 1 ? "" : "s"}.`,
      supportingAnswerIds: ids,
      sourceRefs: [] as [],
      // Offline output never claims better than "medium" fit: it matched words,
      // it did not understand the person.
      fitConfidence: (ids.length > 1 ? "medium" : "low") as "low" | "medium" | "high",
    }));

  // Tensions require two grounded answers, so the offline path proposes one only
  // in the single case it can actually justify: the user named both a commitment
  // to unbounded availability and a commitment to protected time.
  const tensions: { observation: string; betweenAnswerIds: string[] }[] = [];
  const openness = answers.find((a) => /\b(every opportunity|say yes|all opportunities|never turn down)\b/i.test(a.text));
  const protectedTime = answers.find((a) => /\b(uninterrupted|protect|evenings with|time with my family|guard)\b/i.test(a.text));
  if (openness && protectedTime && openness.id !== protectedTime.id) {
    tensions.push({
      observation: "These may compete for the same time. Would you like to think through how you want to handle that?",
      betweenAnswerIds: [openness.id, protectedTime.id],
    });
  }

  return { proposals, tensions };
}
