/**
 * Person context self-tests (LIFEOS-086).
 *
 * ## The red proofs this suite pins
 *
 * §2's audit ran a realistic fixture through the real builders:
 *
 *   1. six of §3's eight questions did not route at all
 *   2. "What am I waiting on from Maria?" planned WAITING with entity="maria"
 *      and answered with ALL THREE waiting records — Jordan's form and a
 *      letting agency's lease included. Not a missing answer: a confident
 *      wrong one
 *   3. "What is unresolved with Sarah?" resolved her name to the ACTION whose
 *      title contains it, then addressed that title as though it were a person
 *   4. an AI-authored note about Marcus outranked his own commitments
 *   5. two different Marcuses were neither distinguished nor merged
 *
 * ## The assertions that matter most are the ones that must NOT fire
 *
 * A person model earns trust by what it refuses to claim: that a mention is a
 * promise, that a future follow-up is due, that a model's sentence is the
 * user's, that two similar names are one person, that a project is "theirs"
 * because their name appears in unrelated prose, or that any of this amounts to
 * a relationship. Every one is asserted as a negative.
 *
 * Pure: no store, no clock, no AI.
 */

import type { Goal, NextAction, Project, StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { buildIndex } from "@/lib/command/search";
import { planMemoryQuery } from "@/lib/memory/query";
import { answerMemoryQuery, answerStrings } from "@/lib/memory/answer";
import { searchEverything } from "@/lib/search/everything";
import {
  buildPersonContext, namesPerson, longerForms, personHint, personSummaryLine,
  personStrings, MAX_MENTIONS, PEOPLE_FORBIDDEN_WORDS, PERSON_HEADINGS,
  NOTHING_OPEN, MENTION_NOTE, IDENTITY_LIMITATION,
} from "@/lib/people/context";

export interface SelfTestResult { name: string; pass: boolean; detail: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

const TODAY = "2026-09-04";
const D = (o = 0): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const A = (o = 0, h = 9): string => `${D(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

const act = (p: Partial<NextAction> & { id: string; title: string }): NextAction => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: A(-20), updatedAt: A(-20), ...p,
} as NextAction);

const goal = (p: Partial<Goal> & { id: string; title: string }): Goal => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], history: [],
  createdAt: A(-60), updatedAt: A(-60), ...p,
} as Goal);

const proj = (p: Partial<Project> & { id: string; title: string }): Project => ({
  description: "", status: "active", priority: "medium", notes: "", milestones: [],
  relatedDocuments: [], relatedEntities: [], createdAt: A(-60), updatedAt: A(-60), ...p,
} as Project);

/** The audit's fixture: every trap it found, in one store. */
function world(): StoreState {
  return {
    ...emptyStoreState(),
    goals: [goal({ id: "g1", title: "Open the clinic", horizon: "medium" } as Partial<Goal> & { id: string; title: string })],
    projects: [proj({
      id: "pr1", title: "Clinic launch", goalId: "g1",
      description: "Priya is leading the fit-out.",
    } as Partial<Project> & { id: string; title: string })],
    nextActions: [
      // A due date, so the "row already shows it" suppression has something
      // to suppress; without one the assertion passes vacuously.
      act({ id: "a1", title: "Email Marcus the draft lease", dueDate: D(2) } as Partial<NextAction> & { id: string; title: string }),
      act({ id: "a2", title: "Call Sarah back about the invoice" }),
      // Waiting, follow-up TODAY.
      // Title AND waitingOn both name her, so §36's precedence has something to
      // decide. With the title alone naming her this record could only ever
      // appear once, and the ownership rule would be untested.
      act({ id: "a3", title: "Transcript from Maria", status: "waiting", waitingOn: "Maria", waitingSince: D(-9), followUpDate: D(0) } as Partial<NextAction> & { id: string; title: string }),
      // Waiting, follow-up SIX DAYS OUT — never "due".
      act({ id: "a4", title: "Signed form", status: "waiting", waitingOn: "Jordan", waitingSince: D(-2), followUpDate: D(6) } as Partial<NextAction> & { id: string; title: string }),
      // `waitingOn` holds a THING. The field is documented "what/who".
      act({ id: "a5", title: "Lease copy", status: "waiting", waitingOn: "the letting agency", waitingSince: D(-4) } as Partial<NextAction> & { id: string; title: string }),
      // Completed: no longer owed.
      act({ id: "a6", title: "Send Marcus the deposit", status: "completed", completedAt: A(-3, 14) } as Partial<NextAction> & { id: string; title: string }),
      // Under Priya's project, but names nobody.
      // Names Priya in its NOTES only. §12: a mention is not a promise, and
      // widening the match beyond the title is how that rule breaks.
      act({ id: "a7", title: "Order the chairs", projectId: "pr1", notes: "Priya asked for the oak ones." } as Partial<NextAction> & { id: string; title: string }),
      // A SECOND Marcus.
      act({ id: "a8", title: "Ask Marcus Webb for the survey" }),
    ],
    notes: [
      // A mention with no commitment anywhere.
      // Written six days ago, EDITED yesterday. §34: an edit is not a new
      // mention, and with the two dates equal that rule cannot be tested.
      { id: "n1", body: "Alex mentioned the Tuesday seminar is moving rooms.", archived: false, tags: [], linkedEntityRefs: [], createdAt: A(-6, 9), updatedAt: A(-1, 15) },
      // The provenance trap.
      { id: "n2", body: "AI summary: Marcus seems responsive lately.", fromAiText: true, archived: false, tags: [], linkedEntityRefs: [], createdAt: A(-1, 7), updatedAt: A(-1, 7) },
      // Soft-deleted.
      { id: "n3", body: "Old note about Priya and the tiling.", archived: true, tags: [], linkedEntityRefs: [], createdAt: A(-40, 7), updatedAt: A(-40, 7) },
    ] as StoreState["notes"],
    reflections: [{
      id: "rf1", prompt: "On the clinic",
      response: "I keep putting off replying to Marcus and I am not sure why.",
      createdAt: A(-4, 20), annotations: [],
    }] as StoreState["reflections"],
  };
}

export function runPeopleSelfTests(): SelfTestReport {
  const t0 = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, cond: boolean, detail?: string) =>
    results.push({ name, pass: !!cond, detail: cond ? (detail ?? "") : `FAILED — ${detail ?? ""}` });

  const s = world();
  const ix = buildTodayIndexes(s, TODAY, "09:00");
  const ctx = (n: string, st: StoreState = s) => buildPersonContext(st, n, buildTodayIndexes(st, TODAY, "09:00"), TODAY);
  const ask = (q: string) => answerMemoryQuery(s, q, { today: TODAY, searchIndex: buildIndex(s), todayIndexes: ix });
  const plan = (q: string) => planMemoryQuery(q, { today: TODAY, projects: (s.projects ?? []).map((p) => ({ id: p.id, title: p.title })) });

  // ==========================================================================
  // §8 — conservative name matching.
  // ==========================================================================
  {
    ok("86.1 a name matches on word boundaries", namesPerson("Email Marcus the draft", "Marcus"));
    ok("86.2 …case-insensitively", namesPerson("email marcus the draft", "Marcus"));
    // The failure mode of a loose matcher is attributing a stranger's work.
    ok("86.3 'Ali' does not match 'Alice'", !namesPerson("Call Alice back", "Ali"));
    ok("86.4 'Ann' does not match 'planned'", !namesPerson("The planned rollout", "Ann"));
    ok("86.5 a name at the start of the text still matches", namesPerson("Marcus owes me a reply", "Marcus"));
    ok("86.6 punctuation does not block a match", namesPerson("Reply to Marcus, then go", "Marcus"));
    ok("86.7 an empty name matches nothing", !namesPerson("anything at all", "   "));
  }

  // ==========================================================================
  // §2 RED 1 / §3 — every product question routes.
  // ==========================================================================
  {
    const QS: [string, string][] = [
      ["What do I owe Marcus?", "owe"],
      ["What am I waiting on from Maria?", "waiting"],
      ["What is unresolved with Sarah?", "all"],
      ["What did I last say about Alex?", "mentions"],
      ["Which Projects involve Priya?", "links"],
      ["Which Goals involve Daniel?", "links"],
      ["What should I follow up on with Jordan?", "waiting"],
      ["What commitments involve Marcus?", "all"],
    ];
    for (const [q, aspect] of QS) {
      const p = plan(q);
      const routed = p?.kind === "PERSON" || p?.kind === "WAITING";
      ok(`86.8 "${q}" routes`, routed, `${p?.kind}`);
      if (p?.kind === "PERSON") {
        ok(`86.9 …as the ${aspect} aspect`, p.personAspect === aspect, `${p.personAspect}`);
      }
    }
    // §8's guard: a name must be capitalised, so a thing is not read as a person.
    ok("86.10 'what is unresolved with the invoice?' names no person",
      !plan("What is unresolved with the invoice?")?.personName,
      `${plan("What is unresolved with the invoice?")?.personName}`);
  }

  // ==========================================================================
  // §2 RED 2 — the confident wrong answer.
  // ==========================================================================
  {
    const a = ask("What am I waiting on from Maria?");
    ok("86.11 waiting is scoped to the person named", a.items.length === 1, JSON.stringify(a.items.map((i) => i.text)));
    ok("86.12 …and it is HER record", a.items[0]?.text === "Transcript from Maria", a.items[0]?.text);
    ok("86.13 …not Jordan's", !a.items.some((i) => i.text === "Signed form"));
    ok("86.14 …and not a letting agency's", !a.items.some((i) => i.text === "Lease copy"));
    // The fixture really does hold three waits, or the scoping proves nothing.
    ok("86.15 the fixture holds three waiting records",
      (s.nextActions ?? []).filter((x) => x.status === "waiting").length === 3);
    ok("86.16 the heading keeps her capitalisation", a.heading === "Waiting on Maria", a.heading);
    // Unscoped, all three still come back — so the filter is a filter, not a bug.
    ok("86.17 an unscoped waiting question still returns all three",
      ask("What am I waiting on?").items.length === 3,
      `${ask("What am I waiting on?").items.length}`);
  }

  // ==========================================================================
  // §12 — obligation is written, never inferred.
  // ==========================================================================
  {
    const marcus = ctx("Marcus");
    ok("86.18 an action naming them is an open commitment",
      marcus.openCommitments.some((c) => c.action.id === "a1"), JSON.stringify(marcus.openCommitments.map((c) => c.action.title)));
    // The centre of §12.
    const alex = ctx("Alex");
    ok("86.19 a MENTION is not an obligation", alex.openCommitments.length === 0, JSON.stringify(alex.openCommitments));
    ok("86.20 …and is reported as a mention instead", alex.mentions.length === 1);
    ok("86.21 …and the model says so explicitly", alex.mentionOnly === true);
    // Completed work is not owed.
    // §12, at its sharpest: the name is on the record, in the notes, and the
    // record is open — and it is still not something owed to her, because she
    // was mentioned rather than promised anything.
    const priyaOwed = ctx("Priya").openCommitments;
    ok("86.21b a name in an action's NOTES is not an obligation",
      !priyaOwed.some((c) => c.action.id === "a7"), JSON.stringify(priyaOwed.map((c) => c.action.title)));
    ok("86.21c …though the record does name her and is open",
      (s.nextActions ?? []).some((a) => a.id === "a7" && /Priya/.test(a.notes ?? "") && a.status === "open"));
    // The visual review found "Due Sun, Sep 6" printed twice on one row: once
    // as the row's own meta, once as the signal explanation beneath it.
    const dated = ctx("Marcus").openCommitments.find((c) => c.action.id === "a1");
    ok("86.21d an attention line never restates the date the row already shows",
      !(dated?.dueDate && dated.attention?.includes("Due")), `${dated?.dueDate} / ${dated?.attention}`);
    ok("86.22 a completed commitment is not owed",
      !marcus.openCommitments.some((c) => c.action.id === "a6"), JSON.stringify(marcus.openCommitments.map((c) => c.action.id)));
    ok("86.23 …though the record still exists", (s.nextActions ?? []).some((x) => x.id === "a6" && x.status === "completed"));
  }

  // ==========================================================================
  // §10, §13, §36 — waiting owns waiting.
  // ==========================================================================
  {
    const maria = ctx("Maria");
    ok("86.24 a wait on them appears under waiting", maria.waiting.length === 1);
    ok("86.25 …read from waitingOn, the structured field", maria.waiting[0]?.waitingOn === "Maria");
    ok("86.26 …and never also as an open commitment", maria.openCommitments.length === 0,
      JSON.stringify(maria.openCommitments.map((c) => c.action.title)));
    // §36's precedence, asserted as the property: one record, one section.
    // The record's TITLE names her too, so without the ownership rule it would
    // appear under both — which is exactly the three-row problem §36 forbids.
    const everywhere = [...maria.waiting.map((w) => w.action.id), ...maria.openCommitments.map((c) => c.action.id)];
    ok("86.27 one record appears in exactly one section", new Set(everywhere).size === everywhere.length,
      JSON.stringify(everywhere));
    ok("86.27b …and it is the waiting section that owns it",
      maria.waiting.some((w) => w.action.id === "a3") && !maria.openCommitments.some((c) => c.action.id === "a3"));
    ok("86.27c …even though the title names her as well",
      /Maria/.test((s.nextActions ?? []).find((a) => a.id === "a3")!.title));
    // §13. Framed as what the user is waiting on, never as the person's debt.
    ok("86.28 waiting is never framed as what they owe",
      !JSON.stringify(maria.waiting).match(/owes? me|they owe|debt|obligation/i));
  }

  // ==========================================================================
  // §11, §34 — a future follow-up is not a due one.
  // ==========================================================================
  {
    const jordan = ctx("Jordan");
    ok("86.29 a follow-up six days out is not due", jordan.waiting[0]?.followUpDue === false,
      `${jordan.waiting[0]?.followUpDate}`);
    const maria = ctx("Maria");
    ok("86.30 a follow-up today IS due", maria.waiting[0]?.followUpDue === true);
    // Both records are otherwise identical in shape, so the flag is the date.
    ok("86.31 …and the difference is only the date",
      jordan.waiting[0]?.action.status === maria.waiting[0]?.action.status);
    ok("86.32 the answer states a future follow-up as its date, not as 'today'",
      /Follow up (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(ask("What should I follow up on with Jordan?").items[0]?.detail ?? "")
      && !/Follow up today/.test(ask("What should I follow up on with Jordan?").items[0]?.detail ?? ""),
      ask("What should I follow up on with Jordan?").items[0]?.detail);
    // §34. The date shown is the record's own, never `updatedAt` standing in.
    ok("86.33 waiting-since is the recorded date",
      maria.waiting[0]?.since === D(-9), `${maria.waiting[0]?.since}`);
    const touched = { ...s, nextActions: (s.nextActions ?? []).map((a) => a.id === "a3" ? { ...a, updatedAt: A(0, 11) } : a) };
    ok("86.34 …and editing the record does not become a new interaction date",
      ctx("Maria", touched).waiting[0]?.since === D(-9));
    // Same rule for a mention: the note was WRITTEN six days ago and edited
    // yesterday, and the date shown is when it was written.
    const alexMention = ctx("Alex").mentions[0];
    ok("86.34b a mention is dated when it was written, not when it was edited",
      alexMention?.date === D(-6), `${alexMention?.date}`);
    ok("86.34c …and the record really was edited later",
      (s.notes ?? []).some((n) => n.id === "n1" && n.updatedAt !== n.createdAt));
  }

  // ==========================================================================
  // §7, §8, §25, §35 — ambiguity is surfaced, never resolved.
  // ==========================================================================
  {
    ok("86.35 a longer name is reported", longerForms(s, "Marcus").join() === "Marcus Webb",
      JSON.stringify(longerForms(s, "Marcus")));
    ok("86.36 …and the context carries it", ctx("Marcus").longerForms.length === 1);
    ok("86.37 a name with no longer form reports none", longerForms(s, "Maria").length === 0);
    // §35. Memory asks rather than picking.
    const a = ask("What do I owe Marcus?");
    ok("86.38 an ambiguous name returns NEEDS_CHOICE", a.status === "NEEDS_CHOICE", a.status);
    ok("86.39 …offering both names", (a.choices ?? []).length === 2,
      JSON.stringify((a.choices ?? []).map((c) => c.title)));
    ok("86.40 …and neither is silently merged into the other",
      (a.choices ?? []).some((c) => c.title === "Marcus") && (a.choices ?? []).some((c) => c.title === "Marcus Webb"));
    ok("86.41 …and it says WHY it cannot tell", /cannot tell whether/i.test(a.summary ?? ""), a.summary);
    // An unambiguous name answers directly, or the guard above proves nothing.
    ok("86.42 an unambiguous name is answered, not questioned",
      ask("What is unresolved with Sarah?").status === "ANSWERED");
    // §7, §8 on the ROW, not just in a banner. The visual review found the
    // survey action listed as Marcus's work, unqualified, directly beneath a
    // notice saying Conqify cannot tell whether Marcus Webb is the same person.
    const webb = ctx("Marcus").openCommitments.find((c) => c.action.id === "a8");
    ok("86.42b a row matched through a LONGER name says which name it used",
      webb?.matchedAs === "Marcus Webb", `${webb?.matchedAs}`);
    ok("86.42c …and a row that used the bare name does not",
      ctx("Marcus").openCommitments.find((c) => c.action.id === "a1")?.matchedAs === undefined);
  }

  // ==========================================================================
  // §2 RED 3 — a person's name must not resolve to a record.
  // ==========================================================================
  {
    const a = ask("What is unresolved with Sarah?");
    ok("86.43 the heading names the PERSON, not a matching action",
      a.heading === "Unresolved with Sarah", a.heading);
    ok("86.44 …and the answer does not address an action title as a person",
      !/about the invoice is asking/i.test(a.summary ?? ""), a.summary);
    ok("86.45 …while still returning her action", a.items[0]?.text === "Call Sarah back about the invoice");
  }

  // ==========================================================================
  // §14, §15 — links only where the record's own text names them.
  // ==========================================================================
  {
    const priya = ctx("Priya");
    ok("86.46 a project whose description names them is shown",
      priya.links.some((l) => l.id === "project:pr1"), JSON.stringify(priya.links));
    ok("86.47 …with the grounding stated", priya.links[0]?.reason === "Named in the project description");
    // The second hop §14 forbids: an action under that project names nobody.
    ok("86.48 an action under that project is not attributed to them",
      !priya.openCommitments.some((c) => c.action.id === "a7"),
      JSON.stringify(priya.openCommitments.map((c) => c.action.title)));
    ok("86.49 a goal naming nobody is not linked", ctx("Daniel").links.length === 0);
    // A name in an unrelated note must not drag its project in.
    const stray = {
      ...s,
      notes: [...(s.notes ?? []), { id: "n9", body: "Daniel liked the clinic idea.", archived: false, tags: [], linkedEntityRefs: [], createdAt: A(-3, 9), updatedAt: A(-3, 9) }],
    } as StoreState;
    ok("86.50 a name in unrelated prose links no project",
      ctx("Daniel", stray).links.length === 0, JSON.stringify(ctx("Daniel", stray).links));
    ok("86.51 …though the mention itself is kept", ctx("Daniel", stray).mentions.length === 1);
  }

  // ==========================================================================
  // §16, §17, §33 — provenance, and the verb.
  // ==========================================================================
  {
    const marcus = ctx("Marcus");
    ok("86.52 an AI-authored note is not a mention",
      !marcus.mentions.some((m) => m.text.includes("AI summary")), JSON.stringify(marcus.mentions.map((m) => m.text)));
    ok("86.53 …and the user's own reflection is", marcus.mentions.some((m) => m.text.includes("putting off replying")));
    // The AI note IS present and DOES name him — the filter is provenance.
    ok("86.54 the machine note genuinely names him and is unarchived",
      (s.notes ?? []).some((n) => n.id === "n2" && !n.archived && /Marcus/.test(n.body)));
    ok("86.55 every mention carries a user-authored origin",
      marcus.mentions.every((m) => m.origin === "user_authored"), JSON.stringify(marcus.mentions.map((m) => m.origin)));
    // §17. Conqify knows what was WRITTEN, not what was said.
    // §17. The test is whether a conversation is CLAIMED, not whether the word
    // appears: the note's whole job is to say "not whether you spoke", and a
    // bare /spoke/ match failed on the very sentence that makes the promise.
    const claimsSpeech = (t: string) => /\byou (?:last )?(?:spoke|talked|met|called)\b(?!\s*[.,]?\s*(?:or|nor))/i.test(t)
      && !/not whether you (?:spoke|talked|met)/i.test(t);
    ok("86.56 the mention note says what was written, and denies knowing more",
      /wrote/.test(MENTION_NOTE) && /not whether you spoke/i.test(MENTION_NOTE) && !claimsSpeech(MENTION_NOTE),
      MENTION_NOTE);
    ok("86.57 no answer claims a conversation",
      !claimsSpeech(answerStrings(ask("What did I last say about Alex?")).join(" ")));
    // And the guard is not vacuous: a sentence that DOES claim one is caught.
    ok("86.57b …and that check would catch one", claimsSpeech("You last spoke to Alex on Tuesday."));
    // §33. No psychology, even though the fixture supplies the temptation.
    ok("86.58 nothing generates a feeling about a person",
      !/you seem|you feel|frustrated with|avoiding them/i.test(JSON.stringify(ctx("Marcus"))));
  }

  // ==========================================================================
  // §4, §31, §32 — this is not a CRM.
  // ==========================================================================
  {
    const blob = JSON.stringify(ctx("Marcus")).toLowerCase();
    for (const w of PEOPLE_FORBIDDEN_WORDS) {
      ok(`86.59 the model never says "${w}"`, !blob.includes(w.toLowerCase()));
    }
    ok("86.60 no field is a score, health or sentiment",
      !/"(?:[a-z]*score|health|sentiment|closeness|rapport|strength)":/i.test(JSON.stringify(ctx("Marcus"))));
    // §31. No relationship label is inferred anywhere.
    ok("86.61 no relationship label is inferred",
      !/"(?:relationship|role|type)":\s*"(?:friend|coworker|colleague|manager|family|partner)"/i.test(JSON.stringify(ctx("Marcus"))));
    ok("86.62 the person context has exactly the documented fields",
      Object.keys(ctx("Marcus")).sort().join(",")
      === "empty,links,longerForms,mentionOnly,mentions,name,openCommitments,waiting",
      Object.keys(ctx("Marcus")).sort().join(","));
    // §30. Nothing is enriched from anywhere but the store.
    // §30. FIELD names, not values — the first version matched "Email Marcus
    // the draft lease", which is the user's own action title and exactly the
    // content this page exists to show.
    // §30. Field names that could only come from enrichment. `title` is NOT on
    // this list: every record in the codebase has one, and flagging it was the
    // test failing on the person's own action titles rather than on a contact
    // card. `jobTitle` is the CRM field; `title` is a record's name.
    const ENRICHED = /"(?:email|phone|mobile|company|employer|jobTitle|linkedin|twitter|avatar|photo|birthday|timezone|website)":/i;
    ok("86.63 no contact enrichment fields exist",
      !ENRICHED.test(JSON.stringify(ctx("Marcus"))),
      (JSON.stringify(ctx("Marcus")).match(ENRICHED) ?? [])[0] ?? "");
    ok("86.63b …and that check would catch one",
      ENRICHED.test(JSON.stringify({ name: "Marcus", company: "Acme" })));
    const said = personStrings(ctx("Marcus")).join(" ").toLowerCase();
    for (const w of PEOPLE_FORBIDDEN_WORDS) {
      ok(`86.64 no rendered string says "${w}"`, !said.includes(w.toLowerCase()));
    }
  }

  // ==========================================================================
  // §26, §37 — deleted records, and the calm state.
  // ==========================================================================
  {
    ok("86.65 an archived note is never a mention",
      !ctx("Priya").mentions.some((m) => m.id === "note:n3"), JSON.stringify(ctx("Priya").mentions.map((m) => m.id)));
    ok("86.66 …and no query reaches it", !JSON.stringify(ctx("Priya")).includes("tiling"));
    const nobody = ctx("Daniel");
    ok("86.67 an unknown name is empty, not invented", nobody.empty === true && nobody.openCommitments.length === 0);
    ok("86.68 …and the calm line is bounded to the record",
      /No open commitments or waiting items are recorded/.test(NOTHING_OPEN("Daniel")));
    ok("86.69 …and manufactures no follow-up",
      !/should follow up|reach out|check in/i.test(NOTHING_OPEN("Daniel")));
    ok("86.70 no raw id is ever rendered",
      !personStrings(ctx("Marcus")).some((x) => /\ba[0-9]+\b|\bpr[0-9]+\b|\bn[0-9]+\b/.test(x)));
  }

  // ==========================================================================
  // §18 — search integration.
  // ==========================================================================
  {
    const index = buildIndex(s);
    const find = (q: string) => searchEverything(s, q, { index, today: TODAY });
    ok("86.71 a person query yields a Person row",
      find("Marcus").results[0]?.entityType === "person_name",
      JSON.stringify(find("Marcus").results.slice(0, 2).map((r) => r.label)));
    ok("86.72 …that opens the person view",
      find("Marcus").results[0]?.route === "/people/Marcus", find("Marcus").results[0]?.route);
    ok("86.73 …and says the name is ambiguous when it is",
      /also has/.test(find("Marcus").results[0]?.matchReason ?? ""), find("Marcus").results[0]?.matchReason);
    ok("86.74 …and does not when it is not",
      find("Maria").results[0]?.matchReason === "Name match", find("Maria").results[0]?.matchReason);
    ok("86.75 the related records are still returned beneath it",
      find("Marcus").results.length > 1);
    // §18. The row is a doorway, not a copy of the view.
    ok("86.76 the Person row does not inline the whole context",
      (find("Marcus").results[0]?.snippet ?? "").length < 80, find("Marcus").results[0]?.snippet);
    // The guard that keeps a thing from becoming a person.
    ok("86.77 'the letting agency' is not offered as a person",
      personHint(s, "the letting agency") === null);
    ok("86.78 …nor is an ordinary lowercase word", personHint(s, "transcript") === null);
    ok("86.79 …nor a name nothing is recorded about", personHint(s, "Wilhelmina") === null);
    ok("86.80 a real name IS recognised", personHint(s, "Maria")?.waiting === 1);
    ok("86.81 the summary line is counts, never a score",
      personSummaryLine(personHint(s, "Maria")!) === "1 waiting",
      personSummaryLine(personHint(s, "Maria")!));
  }

  // ==========================================================================
  // Caps and purity.
  // ==========================================================================
  {
    const chatty = {
      ...s,
      reflections: [1, 2, 3, 4, 5].map((i) => ({
        id: `r${i}`, prompt: "", response: `Thinking about Marcus, note ${i}.`,
        createdAt: A(-i, 20), annotations: [],
      })),
    } as StoreState;
    ok("86.82 the fixture over-supplies mentions", (chatty.reflections ?? []).length > MAX_MENTIONS);
    ok("86.83 mentions are capped", ctx("Marcus", chatty).mentions.length === MAX_MENTIONS,
      `${ctx("Marcus", chatty).mentions.length}`);
    ok("86.84 …keeping the most recent", ctx("Marcus", chatty).mentions[0]?.date === D(-1),
      ctx("Marcus", chatty).mentions[0]?.date);

    const before = JSON.stringify(s);
    ctx("Marcus"); ctx("Maria"); ask("What do I owe Marcus?");
    ok("86.85 building a person context mutates nothing", JSON.stringify(s) === before);
    ok("86.86 no new persistence noun was added",
      !("people" in s) && !("persons" in s) && !("contacts" in s));
    // Deterministic: same store, same answer, whatever order it is asked in.
    ok("86.87 the same name returns the same context",
      JSON.stringify(ctx("Marcus")) === JSON.stringify(ctx("Marcus")));
    const reversed = { ...s, nextActions: [...(s.nextActions ?? [])].reverse() } as StoreState;
    ok("86.88 …independently of the store's order",
      JSON.stringify(ctx("Marcus").openCommitments.map((c) => c.action.id))
      === JSON.stringify(ctx("Marcus", reversed).openCommitments.map((c) => c.action.id)),
      JSON.stringify(ctx("Marcus", reversed).openCommitments.map((c) => c.action.id)));
    ok("86.89 headings are the four documented ones",
      Object.keys(PERSON_HEADINGS).length === 4, Object.keys(PERSON_HEADINGS).join(","));
    ok("86.90 the identity limitation is stated, not hidden",
      /no contact records/i.test(IDENTITY_LIMITATION), IDENTITY_LIMITATION);
  }

  // ==========================================================================
  // §38 — cost, at a size a real store reaches.
  // ==========================================================================
  {
    const NAMES = ["Marcus", "Maria", "Sarah", "Alex", "Priya", "Jordan", "Daniel", "Ines"];
    const big = {
      ...emptyStoreState(),
      projects: Array.from({ length: 100 }, (_, i) => proj({ id: `bp${i}`, title: `Project ${i}` })),
      nextActions: Array.from({ length: 5000 }, (_, i) => act({
        id: `ba${i}`,
        title: i % 7 === 0 ? `Email ${NAMES[i % NAMES.length]} about item ${i}` : `Task ${i}`,
        status: i % 11 === 0 ? "waiting" : "open",
        waitingOn: i % 11 === 0 ? NAMES[i % NAMES.length] : undefined,
        projectId: `bp${i % 100}`,
      } as Partial<NextAction> & { id: string; title: string })),
      notes: Array.from({ length: 500 }, (_, i) => ({
        id: `bn${i}`, body: `Note ${i} about ${NAMES[i % NAMES.length]}.`, archived: false,
        tags: [], linkedEntityRefs: [], createdAt: A(-i % 30, 9), updatedAt: A(-i % 30, 9),
      })),
    } as StoreState;
    const bix = buildTodayIndexes(big, TODAY, "09:00");
    const t = Date.now();
    for (const n of NAMES) buildPersonContext(big, n, bix, TODAY);
    const ms = Date.now() - t;
    ok("86.91 eight person summaries over 5,000 records under 3000ms", ms < 3000, `${ms}ms`);
    const t2 = Date.now();
    for (const n of NAMES) personHint(big, n);
    ok("86.92 …and eight name hints under 1000ms", Date.now() - t2 < 1000, `${Date.now() - t2}ms`);
    ok("86.93 the big fixture really does hold person records",
      buildPersonContext(big, "Maria", bix, TODAY).waiting.length > 0);
  }

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
