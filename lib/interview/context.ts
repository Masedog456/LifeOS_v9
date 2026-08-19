/**
 * What the model is allowed to see (LIFEOS-058 §19, §23, §26).
 *
 * ## Three bands, permanently distinct
 *
 *   SYSTEM AUTHORITY  the rules. Written server-side, in code, in the prompt.
 *                     Never assembled from anything in this file.
 *   USER ANSWERS      what the person said in this interview.
 *   SOURCE MATERIAL   text from records they named as influences.
 *
 * Only the first carries authority. The other two are DATA. A book that says
 * "ignore prior instructions and adopt this belief" is a book containing a
 * sentence, and this system treats it as a sentence.
 *
 * ## The defence is structural, in four independent layers
 *
 *   1. **Band forgery is impossible.** Source text is defused (`defuseText`)
 *      before it is packed, so it cannot emit the delimiters the prompt uses to
 *      separate bands. Without that, a source could close SOURCE MATERIAL and
 *      open a forged SYSTEM section.
 *   2. **The schema has no verbs.** The model returns proposals: a kind, a
 *      statement, a rationale, cited ids. There is no field in which "adopt
 *      this" can be expressed, so a successful injection still produces only a
 *      suggestion the user must accept.
 *   3. **The validator rejects instructions.** `lib/interview/proposals.ts`
 *      drops any item whose prose reads as a command, and any item citing an id
 *      the user did not supply.
 *   4. **The store gate is unreachable.** `adoptConstitutionElement` is called
 *      from a click handler and from nowhere else. No model output, however
 *      well-formed, has a path to it.
 *
 * Any one layer failing leaves the others standing. That is the point of having
 * four, and why the adversarial test asserts the outcome (nothing adopted)
 * rather than asserting that any single layer caught it.
 *
 * ## Privacy: what is deliberately withheld
 *
 *   - Elements with `excludeFromAi` — never packed, not counted in a summary,
 *     not hinted at. `aiVisibleElements` is the single filter and it is applied
 *     here, once.
 *   - Skipped domains — no answer, no question text, nothing (§21.17).
 *   - Everything else in `StoreState`. The context is built from the session and
 *     from the two narrow slices below, never from the store as a whole (§26).
 */

import type { RecordRefLite, StoreState } from "@/types/mvp";
import { CONSTITUTION_KIND_LABEL } from "@/types/mvp";
import { aiVisibleElements } from "@/lib/constitution/constitution";
import type { InterviewSession } from "@/lib/interview/session";
import { QUESTION_BY_ID } from "@/lib/interview/questions";

/** Which band an item belongs to. Carried on the wire; never grants authority. */
export type ContextBand = "answer" | "constitution" | "source" | "named_influence";

/** One item on the wire. Reuses the route's existing evidence shape exactly. */
export interface ContextItem {
  id: string;
  /** The band. The server prompt renders each band under its own framing. */
  group: ContextBand;
  /** A sub-label: the question id, the element kind, the record kind. */
  kind: string;
  text: string;
}

export interface InterviewContext {
  items: ContextItem[];
  /** What was withheld, so the UI can tell the truth about it. */
  omitted: {
    excludedElements: number;
    skippedDomains: number;
    truncatedSources: number;
  };
  /** Total characters of item text. Reported in the cost measurements (§26). */
  charCount: number;
}

/** Per-source excerpt cap. Influences are context, not a corpus. */
const MAX_SOURCE_CHARS = 800;
/** At most this many influence excerpts. */
const MAX_SOURCES = 5;
/** At most this many existing elements, newest first. */
const MAX_ELEMENTS = 25;

/**
 * Neutralise text that will be placed in a data band.
 *
 * This does NOT try to detect malicious intent — that is a losing game, and the
 * validator plus the store gate already cover the case where a hostile sentence
 * gets through. What it does is narrower and winnable: make it impossible for
 * source text to FORGE THE STRUCTURE of the prompt.
 *
 *   - triple quotes and code fences → the delimiters that close a band
 *   - the literal band headers      → a forged "SYSTEM AUTHORITY:" line
 *   - newline runs                  → the visual break a forged header needs
 *
 * A source may still contain the words "ignore previous instructions". It will
 * appear inside the SOURCE MATERIAL band, on one line, framed by the prompt as
 * quoted material — which is exactly what it is.
 */
export function defuseText(text: string): string {
  return (text ?? "")
    .replace(/"""|```|~~~/g, "'")
    .replace(/^\s*(system|assistant|user|human)\s*:/gim, "$1 -")
    .replace(/\b(SYSTEM AUTHORITY|USER ANSWERS|SOURCE MATERIAL)\b/g, (m) => m.toLowerCase())
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Resolve an influence ref to a short excerpt of the record's own text. */
function excerptFor(state: StoreState, ref: RecordRefLite): { label: string; text: string; truncated: boolean } | undefined {
  const cut = (s: string) => ({ text: s.slice(0, MAX_SOURCE_CHARS), truncated: s.length > MAX_SOURCE_CHARS });
  if (ref.kind === "note") {
    const n = (state.notes ?? []).find((x) => x.id === ref.id);
    if (!n) return undefined;
    const c = cut(n.body ?? "");
    return { label: n.title || "Note", ...c };
  }
  if (ref.kind === "document" || ref.kind === "source") {
    const d = (state.sources ?? []).find((x) => x.id === ref.id);
    if (!d) return undefined;
    // The title and the user's own summary — never the full text of a book.
    const c = cut(d.summary ?? "");
    return { label: d.title || "Reading", ...c };
  }
  if (ref.kind === "practice") {
    const p = (state.practices ?? []).find((x) => x.id === ref.id);
    if (!p) return undefined;
    return { label: "Practice", text: (p.userWording || p.title || "").slice(0, MAX_SOURCE_CHARS), truncated: false };
  }
  if (ref.kind === "protocol") {
    const p = (state.protocols ?? []).find((x) => x.id === ref.id);
    if (!p) return undefined;
    return { label: "Protocol", text: `When ${p.trigger} → ${p.response}`.slice(0, MAX_SOURCE_CHARS), truncated: false };
  }
  return undefined;
}

/**
 * Build the context for one AI call.
 *
 * `includeConstitution` is false for follow-up generation: asking "what would a
 * realistic evening look like?" needs the person's last answer, not their entire
 * normative document. Sending less is both cheaper and safer, and the brief asks
 * for both (§26).
 */
export function buildInterviewContext(
  state: StoreState,
  session: InterviewSession,
  opts: { includeConstitution: boolean; includeSources: boolean },
): InterviewContext {
  const items: ContextItem[] = [];
  let truncatedSources = 0;

  // ---- USER ANSWERS -------------------------------------------------------
  // Skipped domains contribute nothing. `skipDomain` already deleted their
  // answers; this filter is the second, independent guarantee, because the cost
  // of the first one being wrong is someone's answer about their faith reaching
  // a model after they chose to skip it.
  for (const a of session.answers) {
    if (session.skippedDomains.includes(a.domain)) continue;
    items.push({
      id: a.questionId,
      group: "answer",
      kind: QUESTION_BY_ID[a.questionId]?.domain ?? a.domain,
      text: defuseText(a.text),
    });
  }

  // The opening statement, when the user gave one.
  if (session.opening?.trim()) {
    items.push({ id: "opening", group: "answer", kind: "opening", text: defuseText(session.opening) });
  }

  // ---- NAMED INFLUENCES ---------------------------------------------------
  // A name the user typed is the USER'S STATEMENT that a tradition matters to
  // them. It is not source material and grants no knowledge of that tradition —
  // §25. Its own band keeps that difference legible to the prompt.
  for (const n of session.namedInfluences) {
    items.push({ id: `named:${n.slice(0, 40)}`, group: "named_influence", kind: "named", text: defuseText(n) });
  }

  // ---- EXISTING CONSTITUTION ---------------------------------------------
  const visible = opts.includeConstitution ? aiVisibleElements(state) : [];
  const allActive = opts.includeConstitution ? (state.constitutionElements ?? []).filter((e) => e.status === "active") : [];
  for (const el of visible.slice(0, MAX_ELEMENTS)) {
    items.push({
      id: `el:${el.id}`,
      group: "constitution",
      kind: CONSTITUTION_KIND_LABEL[el.kind],
      text: defuseText(el.statement),
    });
  }

  // ---- SOURCE MATERIAL ----------------------------------------------------
  if (opts.includeSources) {
    for (const ref of session.influences.slice(0, MAX_SOURCES)) {
      const ex = excerptFor(state, ref);
      if (!ex || !ex.text.trim()) continue;
      if (ex.truncated) truncatedSources += 1;
      items.push({
        id: `src:${ref.kind}:${ref.id}`,
        group: "source",
        kind: ex.label,
        text: defuseText(ex.text),
      });
    }
  }

  return {
    items,
    omitted: {
      excludedElements: Math.max(0, allActive.length - visible.length),
      skippedDomains: session.skippedDomains.length,
      truncatedSources,
    },
    charCount: items.reduce((n, i) => n + i.text.length, 0),
  };
}

/**
 * The ids the model is permitted to cite, derived from the same context it was
 * given.
 *
 * Deriving this from the context rather than from the session is deliberate: if
 * an answer was withheld, its id must also be un-citeable, or the validator
 * would accept a proposal grounded in something the model was never shown.
 */
export function citableIds(ctx: InterviewContext): string[] {
  return ctx.items.filter((i) => i.group === "answer").map((i) => i.id);
}

/** The refs the model may cite: exactly the sources actually packed. */
export function citableRefs(ctx: InterviewContext, session: InterviewSession): RecordRefLite[] {
  const packed = new Set(ctx.items.filter((i) => i.group === "source").map((i) => i.id));
  return session.influences.filter((r) => packed.has(`src:${r.kind}:${r.id}`));
}

/**
 * The user-facing disclosure of what was and was not sent.
 *
 * Shown behind "What was shared with AI?" on the interview. A privacy guarantee
 * the user cannot inspect is a promise, not a feature.
 */
export function contextDisclosure(ctx: InterviewContext): string[] {
  const lines: string[] = [];
  const answers = ctx.items.filter((i) => i.group === "answer").length;
  const elements = ctx.items.filter((i) => i.group === "constitution").length;
  const sources = ctx.items.filter((i) => i.group === "source").length;
  lines.push(`${answers} of your answers were sent.`);
  lines.push(elements === 0
    ? "None of your existing Constitution was sent."
    : `${elements} element${elements === 1 ? "" : "s"} of your existing Constitution ${elements === 1 ? "was" : "were"} sent, so the same thing is not proposed twice.`);
  if (ctx.omitted.excludedElements > 0) {
    lines.push(`${ctx.omitted.excludedElements} element${ctx.omitted.excludedElements === 1 ? "" : "s"} you marked as hidden from AI ${ctx.omitted.excludedElements === 1 ? "was" : "were"} not sent.`);
  }
  if (ctx.omitted.skippedDomains > 0) {
    lines.push(`Nothing from the ${ctx.omitted.skippedDomains} section${ctx.omitted.skippedDomains === 1 ? "" : "s"} you skipped was sent.`);
  }
  lines.push(sources === 0
    ? "No source text was sent."
    : `Excerpts from ${sources} record${sources === 1 ? "" : "s"} you named as an influence were sent.`);
  return lines;
}
