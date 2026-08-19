/**
 * Client helper for the single AI route (`/api/ai`). Every screen that
 * needs AI goes through here. If the network call fails entirely, it
 * falls back to the same deterministic mocks the route uses, so no
 * feature ever hard-depends on connectivity.
 */

import { mockProposals, type ProposalDraft } from "@/lib/proposals";
import {
  mockAnswer,
  mockConcepts,
  mockMapChunk,
  mockQuotes,
  mockReduceSummary,
  mockSummary,
  type ChunkMap,
} from "@/lib/mockAI";
import { mockCompare } from "@/lib/mockCompare";
import { mockDialectic } from "@/lib/mockDialectic";
import { mockThreadSynthesis } from "@/lib/mockThreadSynthesis";
import { mockAlignment, mockPractices, mockWeeklySynthesis } from "@/lib/mockFormation";
import { mockReasoning } from "@/lib/mockReasoning";
import { mockDecision, type MockDecisionContext } from "@/lib/mockDecision";
import { mockFormationSynthesis, type MockFormationContext } from "@/lib/mockFormationSession";
import { mockWorld } from "@/lib/mockWorld";
import { mockOutlines, mockSectionDraft } from "@/lib/mockAuthoring";
import type { DraftTransform, EvidenceItem, ProjectEvidence } from "@/types/mvp";
import { authedJsonHeaders } from "@/lib/security/api-token";
import { mockFollowups, mockInterviewSynthesis } from "@/lib/mockInterview";
import type { ContextItem } from "@/lib/interview/context";

export type AiSource = "ai" | "mock";
export type { ChunkMap } from "@/lib/mockAI";

/**
 * Why a request fell back to deterministic output. Reported so the UI can say
 * something TRUE — the previous copy blamed a missing API key for every failure,
 * including a plain session expiry, which sent users to fix an env var that was
 * already correct (LIFEOS-055T).
 */
export type DegradedReason = "auth" | "rate_limited" | "provider" | "offline";

export const DEGRADED_MESSAGE: Record<DegradedReason, string> = {
  auth: "Sign in again to use AI — your session expired.",
  rate_limited: "Too many AI requests just now. Try again in a moment.",
  provider: "AI is unavailable right now, so this is a offline-generated answer.",
  offline: "Couldn't reach AI, so this is a offline-generated answer.",
};

async function call<T>(
  body: Record<string, unknown>,
  fallback: () => T,
): Promise<{ result: T; source: AiSource; degradedReason?: DegradedReason }> {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      // Attach the existing Supabase session so the server can tell a real user
      // from the open internet. Signed out => no header => route serves mocks.
      headers: await authedJsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Distinguish the causes rather than blaming the API key for all of them.
      const reason: DegradedReason =
        res.status === 401 || res.status === 403 ? "auth"
          : res.status === 429 ? "rate_limited"
            : "provider";
      return { result: fallback(), source: "mock", degradedReason: reason };
    }
    const data = (await res.json()) as { result: T; source: AiSource };
    return { result: data.result, source: data.source };
  } catch {
    // Network failure — genuinely offline, not an auth or key problem.
    return { result: fallback(), source: "mock", degradedReason: "offline" };
  }
}

export function generateBeliefs(text: string) {
  return call<ProposalDraft[]>({ task: "beliefs", text }, () => mockProposals(text));
}

export function summarize(text: string) {
  return call<string>({ task: "summary", text }, () => mockSummary(text));
}

export function extractQuotes(text: string) {
  return call<string[]>({ task: "quotes", text }, () => mockQuotes(text));
}

export function extractConcepts(text: string) {
  return call<string[]>({ task: "concepts", text }, () => mockConcepts(text));
}

export function askQuestion(text: string, question: string) {
  return call<string>({ task: "question", text, question }, () =>
    mockAnswer(text, question),
  );
}

// ---------- Long-source map/reduce (LIFEOS-007) ----------

/** Map one chunk → structured {summary, concepts, quotes(+spans), claims}. One AI call. */
export function mapChunk(text: string) {
  return call<ChunkMap>({ task: "map", text }, () => mockMapChunk(text));
}

/** Reduce many chunk summaries → one source-wide summary. One AI call. */
export function reduceSummary(summaries: string[]) {
  return call<string>({ task: "reduce_summary", summaries }, () =>
    mockReduceSummary(summaries),
  );
}

// ---------- Comparative intelligence (LIFEOS-010) ----------

/** Evidence sent to the compare task (provenance kept for prompt + citation). */
function toWire(evidence: EvidenceItem[]) {
  return evidence.map((e) => ({ id: e.id, group: e.group, kind: e.kind, text: e.text, page: e.page }));
}

/** One structured comparison call. Returns the RAW result object (validated by caller). */
export function runComparison(args: {
  evidence: EvidenceItem[];
  question: string;
  title: string;
  sourcesCompared: string[];
  coverageNote: string;
}) {
  const wire = toWire(args.evidence);
  return call<unknown>(
    {
      task: "compare",
      evidence: wire,
      question: args.question,
      title: args.title,
      sourcesCompared: args.sourcesCompared,
      coverageNote: args.coverageNote,
    },
    () =>
      mockCompare({
        evidence: args.evidence,
        question: args.question,
        title: args.title,
        sourcesCompared: args.sourcesCompared,
        coverageNote: args.coverageNote,
      }),
  );
}

/** Optional second-opinion verification pass (larger comparisons only). */
export function verifyComparison(evidence: EvidenceItem[], draft: unknown) {
  return call<{ cautions?: string[]; removeStatements?: string[] }>(
    { task: "compare_verify", evidence: toWire(evidence), draft: JSON.stringify(draft) },
    () => ({ cautions: [], removeStatements: [] }),
  );
}

// ---------- Dialectical intelligence (LIFEOS-011) ----------

/** One structured dialectic call. Returns the RAW result object (validated by caller). */
export function runDialectic(args: { evidence: EvidenceItem[]; question: string; coverageNote: string }) {
  return call<unknown>(
    {
      task: "dialectic",
      evidence: toWire(args.evidence),
      question: args.question,
      coverageNote: args.coverageNote,
    },
    () => mockDialectic({ evidence: args.evidence, question: args.question, coverageNote: args.coverageNote }),
  );
}

/** Optional second-opinion verification pass (larger inquiries only). */
export function verifyDialectic(evidence: EvidenceItem[], draft: unknown) {
  return call<{ cautions?: string[]; removeStatements?: string[] }>(
    { task: "dialectic_verify", evidence: toWire(evidence), draft: JSON.stringify(draft) },
    () => ({ cautions: [], removeStatements: [] }),
  );
}

// ---------- Megathreads (LIFEOS-012) ----------

/** One structured thread-synthesis call. Returns the RAW object (validated by caller). */
export function synthesizeThread(args: { evidence: EvidenceItem[]; title: string; coverageNote: string }) {
  return call<unknown>(
    { task: "thread_synthesis", evidence: toWire(args.evidence), title: args.title, coverageNote: args.coverageNote },
    () => mockThreadSynthesis({ evidence: args.evidence, title: args.title, coverageNote: args.coverageNote }),
  );
}

// ---------- Daily formation (LIFEOS-013) ----------

/** Suggest small practices from a belief/thread packet. RAW object (validated by caller). */
export function suggestPractices(args: { evidence: EvidenceItem[] }) {
  return call<unknown>(
    { task: "practice_suggest", evidence: toWire(args.evidence) },
    () => mockPractices({ evidence: args.evidence }),
  );
}

/** One weekly narrative synthesis. `summary` carries the deterministic counts. */
export function weeklySynthesis(args: { evidence: EvidenceItem[]; summary: string }) {
  return call<unknown>(
    { task: "weekly_synthesis", evidence: toWire(args.evidence), question: args.summary },
    () => mockWeeklySynthesis({ evidence: args.evidence, summary: args.summary }),
  );
}

/** One cautious alignment reflection over accepted beliefs + reflections + practices. */
export function alignmentReflection(args: { evidence: EvidenceItem[] }) {
  return call<unknown>(
    { task: "alignment_reflection", evidence: toWire(args.evidence) },
    () => mockAlignment({ evidence: args.evidence }),
  );
}

// ---------- Reasoning engine (LIFEOS-014) ----------

/** One AI synthesis over the reasoning packet. RAW object (validated by caller). */
export function reasoningSynthesis(args: { evidence: EvidenceItem[]; question: string; mode: string }) {
  return call<unknown>(
    { task: "reasoning_synthesis", evidence: toWire(args.evidence), question: args.question, title: args.mode },
    () => mockReasoning({ evidence: args.evidence, question: args.question, mode: args.mode }),
  );
}

/** Optional verification pass for large-scope reasoning. */
export function verifyReasoning(evidence: EvidenceItem[], draft: unknown) {
  return call<{ cautions?: string[]; removeStatements?: string[] }>(
    { task: "reasoning_verify", evidence: toWire(evidence), draft: JSON.stringify(draft) },
    () => ({ cautions: [], removeStatements: [] }),
  );
}

// ---------- Decision intelligence (LIFEOS-016) ----------

/** One structured decision-analysis call. RAW object (validated by caller). */
export function decisionSynthesis(args: { evidence: EvidenceItem[]; context: MockDecisionContext }) {
  return call<unknown>(
    {
      task: "decision_synthesis",
      evidence: toWire(args.evidence),
      question: args.context.question,
      draft: JSON.stringify(args.context),
    },
    () => mockDecision({ evidence: args.evidence, context: args.context }),
  );
}

/** Optional verification pass for large decisions. */
export function verifyDecision(evidence: EvidenceItem[], draft: unknown) {
  return call<{ cautions?: string[]; removeStatements?: string[] }>(
    { task: "decision_verify", evidence: toWire(evidence), draft: JSON.stringify(draft) },
    () => ({ cautions: [], removeStatements: [] }),
  );
}

// ---------- Reflective practice & formation (LIFEOS-017) ----------

/** One structured formation-synthesis call over a reflection. RAW object (validated by caller). */
export function formationSynthesis(args: { evidence: EvidenceItem[]; context: MockFormationContext; reflection: string }) {
  return call<unknown>(
    {
      task: "formation_synthesis",
      evidence: toWire(args.evidence),
      text: args.reflection,
      draft: JSON.stringify(args.context),
    },
    () => mockFormationSynthesis({ evidence: args.evidence, context: args.context }),
  );
}

// ---------- Worldview & concept graph (LIFEOS-018) ----------

/** One structured world-model proposal call. RAW object (validated by caller). */
export function proposeWorldModel(args: { evidence: EvidenceItem[] }) {
  return call<unknown>(
    { task: "concept_extract", evidence: toWire(args.evidence) },
    () => mockWorld({ evidence: args.evidence }),
  );
}

// ---------- Knowledge synthesis & authoring (LIFEOS-019) ----------

/** Project evidence → the route's evidence wire shape (id/group/kind/text). */
function projectToWire(evidence: ProjectEvidence[]) {
  return evidence.map((e) => ({ id: e.id, group: e.kind, kind: e.kind, text: e.text }));
}

/** Generate candidate outlines. RAW object (validated by caller). */
export function generateOutlines(args: { evidence: ProjectEvidence[]; kind: string; title: string; purpose: string; audience: string }) {
  const context = { kind: args.kind, title: args.title, purpose: args.purpose, audience: args.audience };
  return call<unknown>(
    { task: "outline_generate", evidence: projectToWire(args.evidence), draft: JSON.stringify(context) },
    () => mockOutlines({ evidence: projectToWire(args.evidence), context }),
  );
}

/** Draft one section (optionally with a transform). RAW object (validated by caller). */
export function draftSection(args: { evidence: ProjectEvidence[]; heading: string; purpose: string; transform?: DraftTransform; existing?: string }) {
  const context = { heading: args.heading, purpose: args.purpose, transform: args.transform, existing: args.existing };
  return call<unknown>(
    { task: "section_draft", evidence: projectToWire(args.evidence), draft: JSON.stringify(context) },
    () => mockSectionDraft({ evidence: projectToWire(args.evidence), context: { heading: args.heading, purpose: args.purpose, transform: args.transform } }),
  );
}

// ---------- Life Architecture Interview (LIFEOS-058) ----------

/**
 * Both interview calls send the SAME banded context shape, and both return RAW
 * objects that `lib/interview/proposals.ts` must validate before anything
 * reaches session state. Nothing here interprets model output — that separation
 * is what keeps the validator the single place where trust is granted.
 *
 * The `items` are already defused and privacy-filtered by
 * `lib/interview/context.ts`; this function only puts them on the wire.
 */
function interviewWire(items: readonly ContextItem[]) {
  return items.map((i) => ({ id: i.id, group: i.group, kind: i.kind, text: i.text }));
}

/** Up to two targeted follow-up questions about the most recent answer. One call. */
export function interviewFollowups(items: readonly ContextItem[]) {
  return call<unknown>(
    { task: "interview_followups", evidence: interviewWire(items) },
    () => mockFollowups(items),
  );
}

/** One synthesis pass: answers → Constitution candidates + possible tensions. */
export function interviewSynthesis(items: readonly ContextItem[]) {
  return call<unknown>(
    { task: "interview_synthesis", evidence: interviewWire(items) },
    () => mockInterviewSynthesis(items),
  );
}
