/**
 * Interview session state (LIFEOS-058).
 *
 * ## The storage decision, and why it is not a migration
 *
 * An interview needs to survive a reload. It does NOT need to survive into the
 * user's synced record set, and making it do so would have been the wrong
 * default: these answers can contain religion, sexuality, addiction, money,
 * trauma and family conflict (§14). A new `interview_sessions` table would have
 * put that material on a server, in a backup, in an export and in a tombstone
 * ledger — permanently — in exchange for a convenience the browser can provide
 * on its own.
 *
 * So session state lives in ONE browser-local key, outside `StoreState`:
 *
 *   - not in `StoreState`      → not synced, not exported, not in a backup
 *   - not in `EXPORT_DOMAINS`  → the domain list and its order are untouched
 *   - not in any table         → zero migrations (§28)
 *   - one key                  → deletion is total and instant
 *
 * This follows existing precedent rather than inventing a pattern: the sync
 * journal (`lib/sync/journal.ts`), recovery report (`lib/sync/recovery.ts`),
 * preferences (`lib/prefs.ts`) and the quick-capture draft all keep their own
 * local keys for exactly this reason.
 *
 * ## Every path that destroys it (LIFEOS-058A)
 *
 *   Discard / Finish   the Builder calls `clearInterviewSession()` directly
 *   Skip a section     that section's answers are deleted immediately
 *   Sign out           `authStore.signOut()` calls it — see the note there for
 *                      why the ACTION is the seam and not `handleSession(null)`
 *   Reset local data   `clearState()` in `lib/persistence.ts` calls it
 *
 * The sign-out path is a DELIBERATE exception to the product's local-first
 * retention rule. Ordinary Conqify local data survives sign-out on purpose; an
 * unfinished interview does not, because it holds answers about faith, health,
 * money and family that the user was told would not outlive the session. An
 * answer about someone's marriage must not outlive the account on the machine.
 *
 * The original 058 wiring reached `clearState()` only, which is not on the
 * sign-out path at all — so the disclosure promised a deletion that never
 * happened. Anything the user CHOSE to keep (an adopted element, a draft, a
 * saved Note) is ordinary local data and is untouched by all of this.
 *
 * ## What is durable, then?
 *
 * Only what the user explicitly chose: an adopted or kept-as-draft
 * `ConstitutionElement`, and — if they ask for it — their answers saved as an
 * ordinary Note. Everything else is scaffolding, and scaffolding comes down.
 *
 * ## Purity
 *
 * Every function here is a pure transformation of a session value. Reading and
 * writing the browser key is confined to the three functions at the bottom, so
 * the whole state machine is testable in Node with no DOM.
 */

import type { ConstitutionKind, ISO, RecordRefLite } from "@/types/mvp";
import type { DomainId, StartMode } from "@/lib/interview/questions";
import { MAX_AI_FOLLOWUPS_PER_DOMAIN } from "@/lib/interview/questions";

/** The browser key. Versioned so a future shape change is a discard, not a bug. */
export const INTERVIEW_STORAGE_KEY = "conqify.interview.v1";

/** One answer the user typed. Always the user's own words, never rewritten. */
export interface InterviewAnswer {
  /** A bank question id, or a follow-up id. */
  questionId: string;
  domain: DomainId;
  text: string;
  at: ISO;
}

/**
 * A model-generated follow-up question.
 *
 * It is a QUESTION, not a claim — the lowest-authority thing the model produces
 * here, which is why follow-ups are the only AI output the interview shows
 * without a review step.
 */
export interface InterviewFollowup {
  id: string;
  domain: DomainId;
  text: string;
  /** The answer that prompted it, so the UI can show the thread. */
  inResponseTo: string;
}

/**
 * A Constitution candidate the model proposed.
 *
 * Note what is absent and can never be added: `adoptedAt`, `status`, and any
 * store id. A proposal is not a record. It becomes one only when the user says
 * so, at which point `createConstitutionElement` mints the id — so the model can
 * never name, address, or overwrite anything that already exists.
 */
export interface InterviewProposal {
  /** Client-minted, session-local. Never becomes a `ConstitutionElement` id. */
  id: string;
  kind: ConstitutionKind;
  /** Machine prose. Adoption never makes this the user's own words. */
  statement: string;
  /** Why the model suggested it. Machine prose; decision support, not a record. */
  rationale: string;
  /** Question ids whose answers the proposal was drawn from. */
  supportingAnswerIds: string[];
  /** Existing Conqify records the user named as influences. References only. */
  sourceRefs: RecordRefLite[];
  /**
   * How well the model thinks this FITS as a proposal — never how true it is.
   * The brief permits confidence "only if it means proposal-fit confidence,
   * never truth", so the type carries no other reading.
   */
  fitConfidence?: "low" | "medium" | "high";
  /** Stable identity for dedupe across retries. See `proposalSignature`. */
  signature: string;
}

/** What the user decided about a proposal. `pending` until they decide. */
export type ProposalOutcome = "pending" | "adopted" | "kept_draft" | "dismissed";

/** A possible tension the model flagged. A question to the user, never a verdict. */
export interface InterviewTension {
  id: string;
  /** The model's neutral description of what may compete. */
  observation: string;
  /** Question ids the observation rests on. Both must exist, or it is dropped. */
  betweenAnswerIds: string[];
}

/** The whole in-flight interview. */
export interface InterviewSession {
  version: 1;
  mode: StartMode;
  startedAt: ISO;
  /**
   * When the user accepted the pre-start disclosure (§2). A session cannot exist
   * without this — `startSession` is the only constructor and it requires it, so
   * "the interview started without telling me" is unrepresentable.
   */
  disclosureAcceptedAt: ISO;
  /** Free-text opening for friction mode. */
  opening?: string;
  answers: InterviewAnswer[];
  followups: InterviewFollowup[];
  /** Domains the user chose to skip. Nothing from them is ever sent to a model. */
  skippedDomains: DomainId[];
  /** Existing records the user named as influences (§11). References, never copies. */
  influences: RecordRefLite[];
  /** Free-text influences the user typed. Treated as the USER'S statement, not a source. */
  namedInfluences: string[];
  proposals: InterviewProposal[];
  outcomes: Record<string, ProposalOutcome>;
  tensions: InterviewTension[];
  /** Count of AI calls made in this session (§24 — asserted in tests). */
  aiCalls: number;
}

// ---------------------------------------------------------------- construct --

let counter = 0;
/** Session-local id. Deliberately not the store's `id()` — these never persist. */
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Reset the id counter. Test-only, so signatures are reproducible across runs. */
export function __resetInterviewIds(): void {
  counter = 0;
}

/**
 * Begin a session. The disclosure timestamp is a REQUIRED argument, not an
 * optional field, because the type system is a better place to enforce informed
 * consent than a code review is.
 */
export function startSession(mode: StartMode, disclosureAcceptedAt: ISO, at: ISO): InterviewSession {
  return {
    version: 1,
    mode,
    startedAt: at,
    disclosureAcceptedAt,
    answers: [],
    followups: [],
    skippedDomains: [],
    influences: [],
    namedInfluences: [],
    proposals: [],
    outcomes: {},
    tensions: [],
    aiCalls: 0,
  };
}

// ------------------------------------------------------------------ answers --

/**
 * Record an answer. Re-answering the same question REPLACES it rather than
 * appending, so "Back" then a correction leaves one answer, not a contradictory
 * pair the model would then try to reconcile.
 *
 * An empty answer removes the entry entirely — that is what "I'd rather not say"
 * looks like once the user has cleared the box, and a blank string must never be
 * sent to a model as though it were a response.
 */
export function recordAnswer(s: InterviewSession, questionId: string, domain: DomainId, text: string, at: ISO): InterviewSession {
  const trimmed = text.trim();
  const without = s.answers.filter((a) => a.questionId !== questionId);
  if (!trimmed) return { ...s, answers: without };
  return { ...s, answers: [...without, { questionId, domain, text: trimmed, at }] };
}

/** The answer to one question, if any. */
export function answerFor(s: InterviewSession, questionId: string): InterviewAnswer | undefined {
  return s.answers.find((a) => a.questionId === questionId);
}

/** Question ids answered so far. Drives which stage-2 questions unlock. */
export function answeredIds(s: InterviewSession): string[] {
  return s.answers.map((a) => a.questionId);
}

/**
 * Skip a domain.
 *
 * This also DELETES any answers already given in that domain. If someone answers
 * a question about their faith and then decides to skip the section, leaving the
 * answer in place — where it would still be sent to a model — would make the
 * skip a lie. Skipping means "forget this", and it does.
 */
export function skipDomain(s: InterviewSession, domain: DomainId): InterviewSession {
  return {
    ...s,
    skippedDomains: s.skippedDomains.includes(domain) ? s.skippedDomains : [...s.skippedDomains, domain],
    answers: s.answers.filter((a) => a.domain !== domain),
    followups: s.followups.filter((f) => f.domain !== domain),
  };
}

/** Un-skip a domain. Answers are gone; the questions come back blank. */
export function unskipDomain(s: InterviewSession, domain: DomainId): InterviewSession {
  return { ...s, skippedDomains: s.skippedDomains.filter((d) => d !== domain) };
}

// --------------------------------------------------------------- follow-ups --

/**
 * Add model-generated follow-ups, capped per domain (§6).
 *
 * The cap counts what is ALREADY in the session, so repeated synthesis passes
 * cannot walk past it one question at a time. Follow-ups for a skipped domain
 * are dropped outright.
 */
export function addFollowups(
  s: InterviewSession,
  domain: DomainId,
  inResponseTo: string,
  texts: readonly string[],
): InterviewSession {
  if (s.skippedDomains.includes(domain)) return s;
  const existing = s.followups.filter((f) => f.domain === domain).length;
  const room = Math.max(0, MAX_AI_FOLLOWUPS_PER_DOMAIN - existing);
  if (room === 0) return s;
  // `seen` grows as we go, so a batch that repeats itself is deduped too — the
  // model returning the same question twice must not consume both slots.
  const seen = new Set(s.followups.map((f) => f.text.trim().toLowerCase()));
  const fresh: InterviewFollowup[] = [];
  for (const raw of texts) {
    if (fresh.length >= room) break;
    const text = raw.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    fresh.push({ id: localId("fu"), domain, text, inResponseTo });
  }
  return fresh.length ? { ...s, followups: [...s.followups, ...fresh] } : s;
}

// ---------------------------------------------------------------- proposals --

/**
 * A proposal's stable identity: its kind plus its normalised statement.
 *
 * Two synthesis passes over the same answers produce the same signature, so a
 * retry after a failed call MERGES rather than duplicating (§21.23). Deliberately
 * not the id — ids are minted per call and would defeat the purpose.
 */
export function proposalSignature(kind: ConstitutionKind, statement: string): string {
  const norm = statement.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return `${kind}:${norm}`;
}

/**
 * Merge freshly-proposed candidates into the session.
 *
 * Three rules, all of which exist to protect a decision the user already made:
 *   1. A signature already present is IGNORED — never re-added, never re-worded.
 *   2. A signature the user DISMISSED stays dismissed. A retry must not
 *      resurrect something they said no to.
 *   3. Existing outcomes are untouched. Nothing the user adopted or kept can be
 *      altered by a later model response.
 */
export function mergeProposals(s: InterviewSession, incoming: readonly Omit<InterviewProposal, "id">[]): InterviewSession {
  const bySig = new Map(s.proposals.map((p) => [p.signature, p]));
  const dismissed = new Set(
    s.proposals.filter((p) => s.outcomes[p.id] === "dismissed").map((p) => p.signature),
  );
  const added: InterviewProposal[] = [];
  for (const c of incoming) {
    if (bySig.has(c.signature) || dismissed.has(c.signature)) continue;
    const p: InterviewProposal = { ...c, id: localId("prop") };
    bySig.set(p.signature, p);
    added.push(p);
  }
  if (added.length === 0) return s;
  return {
    ...s,
    proposals: [...s.proposals, ...added],
    outcomes: { ...s.outcomes, ...Object.fromEntries(added.map((p) => [p.id, "pending" as ProposalOutcome])) },
  };
}

/**
 * Edit a proposal's wording before deciding on it (§18).
 *
 * The signature is recomputed so an edited proposal is a different candidate —
 * otherwise a later synthesis pass would see the ORIGINAL wording as "already
 * present" and silently suppress it, which would be the model quietly winning an
 * argument the user thought they had settled.
 *
 * Editing does NOT change provenance. The user reworded machine prose inside a
 * proposal; whether that rewrite amounts to authorship is decided by the
 * existing rule in `lib/provenance` when the element is created, not here.
 */
export function editProposal(s: InterviewSession, proposalId: string, statement: string, kind?: ConstitutionKind): InterviewSession {
  const text = statement.trim();
  if (!text) return s;
  return {
    ...s,
    proposals: s.proposals.map((p) =>
      p.id === proposalId
        ? { ...p, statement: text, kind: kind ?? p.kind, signature: proposalSignature(kind ?? p.kind, text) }
        : p),
  };
}

/** Record the user's decision. The ONLY way an outcome changes. */
export function setOutcome(s: InterviewSession, proposalId: string, outcome: ProposalOutcome): InterviewSession {
  if (!s.proposals.some((p) => p.id === proposalId)) return s;
  return { ...s, outcomes: { ...s.outcomes, [proposalId]: outcome } };
}

/** Proposals still awaiting a decision. */
export function pendingProposals(s: InterviewSession): InterviewProposal[] {
  return s.proposals.filter((p) => (s.outcomes[p.id] ?? "pending") === "pending");
}

// ---------------------------------------------------------------- influences --

/** Attach an existing Conqify record as an influence. References, never copies. */
export function addInfluence(s: InterviewSession, ref: RecordRefLite): InterviewSession {
  if (s.influences.some((r) => r.kind === ref.kind && r.id === ref.id)) return s;
  return { ...s, influences: [...s.influences, ref] };
}

export function removeInfluence(s: InterviewSession, ref: RecordRefLite): InterviewSession {
  return { ...s, influences: s.influences.filter((r) => !(r.kind === ref.kind && r.id === ref.id)) };
}

/**
 * Record a free-text influence ("Stoicism", "my grandmother").
 *
 * Kept in its own field, separate from `influences`, because it is categorically
 * different: a `RecordRefLite` points at material Conqify actually has, while
 * this is a NAME the user typed. §25 turns on that distinction — the product may
 * ask "what about Stoicism resonates with you?" but may never assert what
 * Stoicism teaches, because it has no text to read.
 */
export function addNamedInfluence(s: InterviewSession, name: string): InterviewSession {
  const t = name.trim();
  if (!t || s.namedInfluences.some((n) => n.toLowerCase() === t.toLowerCase())) return s;
  return { ...s, namedInfluences: [...s.namedInfluences, t] };
}

// -------------------------------------------------------------------- counts --

/** Increment the AI call counter. Every call site goes through this. */
export function countAiCall(s: InterviewSession): InterviewSession {
  return { ...s, aiCalls: s.aiCalls + 1 };
}

/**
 * Per-domain progress, as the brief asks (§17): "Attention · 2 questions
 * answered". Deliberately NOT a percentage — the path branches, so a percentage
 * would be fake precision, and a "completeness" number over someone's life is
 * exactly the kind of score this product refuses to compute.
 */
export function domainProgress(s: InterviewSession, domain: DomainId): { answered: number; skipped: boolean } {
  return {
    answered: s.answers.filter((a) => a.domain === domain).length,
    skipped: s.skippedDomains.includes(domain),
  };
}

// ------------------------------------------------------------- browser store --

/**
 * Read the session from the browser.
 *
 * Any malformed or unknown-version payload is discarded rather than repaired.
 * Half-parsing an interview would mean showing someone a review screen built
 * from answers they cannot see, and there is nothing here worth that risk.
 */
export function loadInterviewSession(): InterviewSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INTERVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InterviewSession>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.answers) || !parsed.disclosureAcceptedAt) return null;
    return {
      version: 1,
      mode: parsed.mode === "stocktake" ? "stocktake" : "friction",
      startedAt: String(parsed.startedAt ?? ""),
      disclosureAcceptedAt: String(parsed.disclosureAcceptedAt),
      opening: typeof parsed.opening === "string" ? parsed.opening : undefined,
      answers: parsed.answers as InterviewAnswer[],
      followups: Array.isArray(parsed.followups) ? parsed.followups : [],
      skippedDomains: Array.isArray(parsed.skippedDomains) ? parsed.skippedDomains : [],
      influences: Array.isArray(parsed.influences) ? parsed.influences : [],
      namedInfluences: Array.isArray(parsed.namedInfluences) ? parsed.namedInfluences : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      outcomes: parsed.outcomes && typeof parsed.outcomes === "object" ? parsed.outcomes : {},
      tensions: Array.isArray(parsed.tensions) ? parsed.tensions : [],
      aiCalls: typeof parsed.aiCalls === "number" ? parsed.aiCalls : 0,
    };
  } catch {
    return null;
  }
}

/** Write the session. Best-effort: a full quota must not lose the user's typing. */
export function saveInterviewSession(s: InterviewSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* non-critical: the in-memory session continues */
  }
}

/**
 * Destroy the session. Called on Finish, on Discard, and from `clearState()`.
 *
 * One key, one removal, nothing left behind — which is the entire argument for
 * having stored it this way.
 */
export function clearInterviewSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(INTERVIEW_STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
