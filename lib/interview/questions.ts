/**
 * The question bank for the Life Architecture Interview (LIFEOS-058).
 *
 * ## Why this is data, not a database
 *
 * A questionnaire is a *script*, not a domain. The brief is explicit — "do not
 * create a questionnaire ontology", "do not create a LifeArea table merely for
 * this feature" — so life domains are a frozen constant here and questions are
 * plain objects. Nothing in this file is persisted, synced, or migrated. If the
 * script changes next sprint, no user's data changes with it.
 *
 * ## Why the skeleton is deterministic
 *
 * The interview must work with the AI unavailable, offline, or degraded. Every
 * question a user is *required* to see comes from this file. The model's only
 * job is to add TARGETED FOLLOW-UPS on top (see `lib/interview/context.ts`), so
 * a provider outage degrades the interview from "adaptive" to "structured" —
 * never from "working" to "broken", and never loses an answer already given.
 *
 * ## What a domain is not
 *
 * A domain is an organising header for questions. It is not a category the user
 * belongs to, not a facet of a person, and not a slot that must be filled. The
 * copy says so, every domain is skippable, and no completeness is computed
 * across them — "you have not answered the Spirituality questions" is not a fact
 * about a life, and this product will not imply that it is.
 */

/** Broad organising domains. IDs are stable; labels are copy. */
export type DomainId =
  | "direction" | "character" | "attention" | "health" | "relationships"
  | "family" | "work" | "learning" | "money" | "home"
  | "spirituality" | "recreation" | "creativity" | "service";

export interface LifeDomain {
  id: DomainId;
  label: string;
  /** One line shown under the heading. Never evaluative. */
  blurb: string;
  /** True for domains whose answers are likely to be sensitive (§14). */
  sensitive?: boolean;
}

/**
 * The domains, in the brief's order.
 *
 * `sensitive` does not restrict anything by itself — every domain is skippable
 * and every answer is optional. It drives one thing: the skip affordance is made
 * *explicit and prominent* on these, rather than a small link the user has to
 * find while being asked about their sexuality or their faith.
 */
export const LIFE_DOMAINS: readonly LifeDomain[] = [
  { id: "direction", label: "Direction & Meaning", blurb: "What you want this life to be for." },
  { id: "character", label: "Character", blurb: "The kind of person you are trying to be." },
  { id: "attention", label: "Attention", blurb: "Where your hours and focus actually go." },
  { id: "health", label: "Health", blurb: "The physical foundations you depend on.", sensitive: true },
  { id: "relationships", label: "Relationships", blurb: "How you want to show up with people.", sensitive: true },
  { id: "family", label: "Family", blurb: "The people you are responsible to.", sensitive: true },
  { id: "work", label: "Work", blurb: "What you are trying to build or contribute." },
  { id: "learning", label: "Learning", blurb: "What you are trying to understand." },
  { id: "money", label: "Money", blurb: "What responsible use of money means to you.", sensitive: true },
  { id: "home", label: "Home & Environment", blurb: "The surroundings you live inside." },
  { id: "spirituality", label: "Spirituality & Philosophy", blurb: "The traditions and ideas you take seriously.", sensitive: true },
  { id: "recreation", label: "Recreation", blurb: "What genuinely restores you." },
  { id: "creativity", label: "Creativity", blurb: "What you want to make." },
  { id: "service", label: "Service & Community", blurb: "What you owe to people beyond yourself." },
];

export const DOMAIN_BY_ID: Readonly<Record<DomainId, LifeDomain>> = Object.freeze(
  Object.fromEntries(LIFE_DOMAINS.map((d) => [d.id, d])) as Record<DomainId, LifeDomain>,
);

/** The two conceptual starts (§3). The user may switch at any point. */
export type StartMode = "friction" | "stocktake";

export const START_MODE_LABEL: Record<StartMode, string> = {
  friction: "I know what I am struggling with",
  stocktake: "Help me take stock of my life",
};

export const START_MODE_BLURB: Record<StartMode, string> = {
  friction: "Start from what feels hardest right now and work outward.",
  stocktake: "Walk through the broad areas of a life and see what surfaces.",
};

/**
 * The friction-mode opening chips. These are EXAMPLES, offered to make the blank
 * page easier — not a taxonomy the user must choose from. The opening question
 * is free text and a chip only prefills it.
 */
export const FRICTION_EXAMPLES: readonly string[] = [
  "attention", "procrastination", "relationships", "money", "health",
  "discipline", "meaning", "work", "learning", "spiritual life",
  "household", "direction",
];

/** A question in the script. */
export interface InterviewQuestion {
  id: string;
  domain: DomainId;
  /** The question as asked. */
  text: string;
  /** Optional clarifying line under the question. Never a hint at a "right" answer. */
  help?: string;
  /** Stage 1 questions are the domain's opener; stage 2 are its deeper follow-ups. */
  stage: 1 | 2;
}

/**
 * The bank. Every question is drawn verbatim from the brief's §5 where the brief
 * supplied one, because those questions were written with care and rewording
 * them would be an unforced change of meaning.
 */
export const QUESTION_BANK: readonly InterviewQuestion[] = [
  // DIRECTION
  { id: "direction.stand-for", domain: "direction", stage: 1, text: "What do you want your life to stand for?" },
  { id: "direction.dissatisfied", domain: "direction", stage: 2, text: "What would make you deeply dissatisfied with how you had lived?" },
  { id: "direction.responsibilities", domain: "direction", stage: 2, text: "What responsibilities already matter most?" },

  // FRICTION — reachable from either mode; the friction start opens here.
  { id: "friction.wrong", domain: "character", stage: 1, text: "What keeps going wrong?" },
  { id: "friction.promise", domain: "character", stage: 2, text: "What do you repeatedly promise yourself you will change?" },
  { id: "friction.avoid", domain: "character", stage: 2, text: "What do you avoid?" },
  { id: "friction.chaotic", domain: "character", stage: 2, text: "Where does life feel unnecessarily chaotic?" },

  // CHARACTER
  { id: "character.cultivate", domain: "character", stage: 1, text: "What qualities do you want to cultivate?" },
  { id: "character.undermine", domain: "character", stage: 2, text: "Which tendencies repeatedly undermine you?" },

  // ATTENTION
  { id: "attention.disappear", domain: "attention", stage: 1, text: "Where does your attention disappear?" },
  { id: "attention.deserves", domain: "attention", stage: 2, text: "What deserves more of it?" },
  { id: "attention.technology", domain: "attention", stage: 2, text: "What technology helps you, and what tends to pull you away?" },

  // RELATIONSHIPS
  { id: "relationships.who", domain: "relationships", stage: 1, text: "What kind of person do you want to be in your closest relationships?" },
  { id: "relationships.tensions", domain: "relationships", stage: 2, text: "Where do recurring tensions appear?" },

  // FAMILY
  { id: "family.responsibilities", domain: "family", stage: 1, text: "What do the people closest to you actually need from you?" },

  // WORK
  { id: "work.build", domain: "work", stage: 1, text: "What are you trying to build or contribute?" },
  { id: "work.cannot-ignore", domain: "work", stage: 2, text: "What responsibilities cannot be ignored?" },

  // LEARNING
  { id: "learning.master", domain: "learning", stage: 1, text: "What are you trying to understand or master?" },
  { id: "learning.draws-back", domain: "learning", stage: 2, text: "Which subjects repeatedly draw you back?" },

  // MEANING / SPIRITUALITY
  { id: "spirituality.traditions", domain: "spirituality", stage: 1, text: "Which philosophical, religious, ethical, or contemplative traditions influence you?", help: "Only if you want to say. This is skippable, like everything else." },
  { id: "spirituality.practices", domain: "spirituality", stage: 2, text: "Which practices from them do you actually want to live?" },

  // HEALTH
  { id: "health.foundations", domain: "health", stage: 1, text: "What physical foundations matter to you?" },
  { id: "health.interference", domain: "health", stage: 2, text: "Where does your current routine interfere with them?" },

  // ENVIRONMENT
  { id: "home.features", domain: "home", stage: 1, text: "What features of your surroundings help or sabotage your intentions?" },

  // MONEY
  { id: "money.responsible", domain: "money", stage: 1, text: "What does responsible use of money mean to you?" },
  { id: "money.disorder", domain: "money", stage: 2, text: "Where does disorder or uncertainty show up?" },

  // RECREATION
  { id: "recreation.restores", domain: "recreation", stage: 1, text: "What kinds of rest or play genuinely restore you?" },
  { id: "recreation.drift", domain: "recreation", stage: 2, text: "What tends to become unintentional drift instead?" },

  // CREATIVITY
  { id: "creativity.make", domain: "creativity", stage: 1, text: "Is there something you want to make?" },

  // SERVICE
  { id: "service.beyond", domain: "service", stage: 1, text: "What do you owe to people beyond your own household?" },
];

export const QUESTION_BY_ID: Readonly<Record<string, InterviewQuestion>> = Object.freeze(
  Object.fromEntries(QUESTION_BANK.map((q) => [q.id, q])),
);

/**
 * The domain order each start mode walks.
 *
 * Friction mode leads with the two domains where "what keeps going wrong" most
 * often lands, then broadens. Stocktake mode walks the brief's domain order. In
 * both cases the user may jump, skip, or stop; this is the DEFAULT path, not a
 * required one.
 */
export function domainOrder(mode: StartMode): DomainId[] {
  if (mode === "friction") {
    return ["character", "attention", "direction", "relationships", "work", "health", "home", "money", "learning", "family", "recreation", "spirituality", "creativity", "service"];
  }
  return LIFE_DOMAINS.map((d) => d.id);
}

/**
 * The questions for one domain, openers first.
 *
 * Stage-2 questions are only offered once the domain's opener has an answer —
 * the brief's "broad question → response → targeted follow-up" shape. Asking
 * someone "which tendencies repeatedly undermine you?" before they have said
 * anything is an interrogation, not an interview.
 */
export function questionsForDomain(domain: DomainId, answeredIds: readonly string[]): InterviewQuestion[] {
  const all = QUESTION_BANK.filter((q) => q.domain === domain);
  const openers = all.filter((q) => q.stage === 1);
  const openerAnswered = openers.some((q) => answeredIds.includes(q.id));
  return openerAnswered ? all : openers;
}

/**
 * The cap on model-generated follow-ups per domain (§6: "cap follow-ups so a
 * topic does not become an interrogation").
 *
 * Two. Deliberately small. A person answering questions about their marriage
 * does not want a fourth one.
 */
export const MAX_AI_FOLLOWUPS_PER_DOMAIN = 2;

/** The most Constitution proposals one synthesis may produce (§27.4, §24). */
export const MAX_PROPOSALS = 6;
