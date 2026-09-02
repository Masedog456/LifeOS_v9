/**
 * Executive Memory Query self-tests (LIFEOS-069 §22, §23, §24, §25).
 *
 * Section 3 is the load-bearing one. Every assertion in it is a sentence the
 * product must never produce — that a scheduled event was attended, that a
 * created action was an accomplishment, that a project moved, that AI prose is
 * something the user said, that a note containing "worried" is a mood — and each
 * is written against a fixture built to make exactly that mistake tempting.
 *
 * The rest of the file is the deterministic contract: the same question asked
 * twice returns the same answer, an ambiguous one returns choices rather than a
 * guess, a deleted record vanishes from every future answer with no
 * invalidation step, and no answer is ever written anywhere.
 */

import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { Capture, LifeEvent, NextAction, Note, Project, Reflection, StoreState } from "@/types/mvp";
import { violatesReviewLanguage } from "@/lib/memory/week";
import { buildIndex } from "@/lib/command/search";
import { RECORD_LABELS, RECORD_ORDER, resolveRecord } from "@/lib/command/records";
import {
  planMemoryQuery, resolveMemoryRange, extractEntity, MEMORY_QUERY_KINDS,
} from "@/lib/memory/query";
import {
  answerMemoryQuery, answerStrings, attributionFor, canQuoteAsSaid,
  buildEvidencePacket, validateAiPlan, resolveEntities,
  MEMORY_EXCLUDED_KINDS, NO_EVIDENCE_LINE, IMPLICIT_LOOKBACK_DAYS,
  type MemoryAnswer,
} from "@/lib/memory/answer";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

// ------------------------------------------------------------- the fixture --
//
// Today is SUNDAY 2026-08-23.
//   last week   = Mon 2026-08-10 … Sun 2026-08-16
//   this week   = Mon 2026-08-17 … Sun 2026-08-23
//   yesterday   = Sat 2026-08-22
//   last Tuesday= Tue 2026-08-18
// May 2026 is deliberately empty. June 2026 holds exactly one record.

const TODAY = "2026-08-23";
const at = (day: string, h = 10) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

let seq = 0;
function act(p: Partial<NextAction> & { title: string; createdAt: string }): NextAction {
  seq += 1;
  return {
    id: p.id ?? `a${seq}`, description: "", status: "open", updatedAt: p.createdAt,
    notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
    energy: "unspecified", order: seq, history: [],
    ...p,
  } as NextAction;
}

const ev = (p: Partial<LifeEvent> & { id: string; title: string; date: string }): LifeEvent =>
  ({ notes: "", linkedEntityRefs: [], createdAt: at("2026-08-01"), updatedAt: at("2026-08-01"), ...p }) as LifeEvent;

const note = (id: string, body: string, createdAt: string, extra: Partial<Note> = {}): Note =>
  ({ id, body, tags: [], linkedEntityRefs: [], createdAt, updatedAt: createdAt, ...extra }) as Note;

const reflection = (id: string, response: string, createdAt: string): Reflection =>
  ({ id, prompt: "What mattered this week?", response, createdAt, annotations: [] });

const project = (id: string, title: string, updatedAt = at("2026-08-21")): Project => ({
  id, title, description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [],
  createdAt: at("2026-07-01"), updatedAt,
} as Project);

const capture = (id: string, text: string, createdAt: string): Capture =>
  ({ id, text, createdAt, processingStatus: "inbox", linkedEntityRefs: [], history: [] }) as unknown as Capture;

/**
 * A recorded life with every confusion built into it on purpose.
 *
 * The dentist is on the calendar and nowhere else. `Draft the newsletter` was
 * created and never finished. `Dashboard` is the name of both a project and an
 * action. One note about teaching is the user's; another is AI-generated. One
 * project was touched last night and has no dated activity at all.
 */
export function recordedLife(): StoreState {
  seq = 0;
  const s = emptyState();

  s.projects = [
    project("p-lot", "LotPilot"),
    project("p-dash", "Dashboard"),
    // Touched at 23:00 last night and carrying nothing dated. The one project
    // whose `updatedAt` invites "made progress".
    project("p-quiet", "Garden rebuild", at("2026-08-22", 23)),
  ];

  s.nextActions = [
    act({ id: "a-deploy", title: "Ship the deployment", createdAt: at("2026-08-10", 9), projectId: "p-lot",
      status: "completed", completedAt: at("2026-08-13", 14),
      history: [{ id: "h1", at: at("2026-08-13", 14), action: "completed" }] }),
    act({ id: "a-invoices", title: "Send the invoices", createdAt: at("2026-08-10", 9), projectId: "p-lot",
      status: "completed", completedAt: at("2026-08-14", 11),
      history: [{ id: "h2", at: at("2026-08-14", 11), action: "completed" }] }),
    act({ id: "a-meds", title: "Refill the medication box", createdAt: at("2026-07-01", 8),
      recurrence: { frequency: "daily", interval: 1 },
      history: [{ id: "h3", at: at("2026-08-12", 7), action: "completed", detail: "2026-08-12" }] }),
    // Created last week, never completed. §23 assertion 2.
    act({ id: "a-news", title: "Draft the newsletter", createdAt: at("2026-08-11", 9), projectId: "p-lot",
      history: [{ id: "h4", at: at("2026-08-11", 9), action: "created" }] }),
    act({ id: "a-lease", title: "Marcus to send the signed lease", createdAt: at("2026-08-12", 9),
      projectId: "p-lot", status: "waiting", waitingOn: "Marcus", waitingSince: at("2026-08-12", 9),
      followUpDate: "2026-08-19",
      history: [{ id: "h5", at: at("2026-08-12", 9), action: "waiting", detail: "Marcus" }] }),
    // Began AFTER last Tuesday. Must never appear in an "as of Tuesday" answer.
    act({ id: "a-quote", title: "Plumber to send the quote", createdAt: at("2026-08-20", 9),
      status: "waiting", waitingOn: "the plumber", waitingSince: at("2026-08-20", 9),
      history: [{ id: "h6", at: at("2026-08-20", 9), action: "waiting", detail: "the plumber" }] }),
    act({ id: "a-assign", title: "History assignment", createdAt: at("2026-08-09", 9), dueDate: "2026-08-20",
      history: [
        { id: "h7", at: at("2026-08-09", 9), action: "created" },
        { id: "h8", at: at("2026-08-11", 16), action: "due_set", detail: "2026-08-20" },
      ] }),
    act({ id: "a-dash", title: "Dashboard", createdAt: at("2026-08-10", 9) }),
  ];

  s.events = [
    ev({ id: "e-dentist", title: "Dentist", date: "2026-08-22", startTime: "09:00" }),
    ev({ id: "e-review", title: "LotPilot review", date: "2026-08-12", startTime: "15:00",
      linkedEntityRefs: [{ kind: "project", id: "p-lot" }] }),
    // An Event whose TITLE mentions teaching. "What did I say about teaching?"
    // must never quote it, because nobody said anything by scheduling it (§5).
    ev({ id: "e-teach", title: "Teaching prep", date: "2026-08-13", startTime: "08:00" }),
  ];

  s.notes = [
    note("n-teach", "Teaching is the part of the work I actually want to keep.", at("2026-08-12", 20)),
    // Machine prose kept as a note, marked the way LIFEOS-050A marks it.
    note("n-ai-teach",
      "_AI-generated — Summary of your week:_\n\nTeaching came up repeatedly in your notes this week.",
      at("2026-08-13", 21), { fromAiText: true }),
    note("n-june", "Worried about whether the lease will close in time.", at("2026-06-14", 22)),
    // A feeling, written down once. It must not become a claim about a week.
    note("n-sad", "Felt sad most of Thursday and I don't know why.", at("2026-08-13", 23)),
  ];

  s.reflections = [
    reflection("r-teach", "I keep coming back to teaching. It is the only part I would do unpaid.", at("2026-08-15", 19)),
  ];

  s.captures = [capture("c-lease", "Chase Marcus about the lease again", at("2026-08-16", 8))];

  s.recurrenceCompletions = [
    { id: "rc1", actionId: "a-meds", occurrenceDate: "2026-08-12", completedAt: at("2026-08-12", 7) },
  ];

  // Private material that memory-query retrieval must never reach (§19).
  s.beliefs = [{
    id: "b-teach", text: "Teaching is how I want to spend my remaining working years.",
    status: "accepted", revisions: [], judgments: [], captureId: "", proposalId: "",
    createdAt: at("2026-05-01"), updatedAt: at("2026-05-01"),
  }] as unknown as StoreState["beliefs"];
  s.constitutionElements = [{
    id: "ce-teach", kind: "value", statement: "I protect time for teaching above everything else.",
    status: "active", createdAt: at("2026-05-01"), updatedAt: at("2026-05-01"),
  }] as unknown as StoreState["constitutionElements"];

  return s;
}

// ---------------------------------------------------------------- the suite --

export async function runMemoryQuerySelfTests(): Promise<SelfTestReport> {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => { results.push({ name, pass, detail }); };
  const eq = (name: string, a: unknown, b: unknown) =>
    ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

  const state = recordedLife();
  const ask = (q: string, s: StoreState = state): MemoryAnswer =>
    answerMemoryQuery(s, q, { today: TODAY });
  /** Everything an answer SAYS — headings, summaries, limitations, attributions. */
  const said = (a: MemoryAnswer): string => answerStrings(a).join(" ").toLowerCase();
  /**
   * What an answer CLAIMS — everything except the limitation.
   *
   * A limitation exists to name what Conqify does not know, so it is the one
   * place the forbidden words legitimately appear: "no record of whether you
   * attended" is the opposite of claiming attendance. Scanning it for those
   * words would make the honest sentence fail the test the dishonest one passes.
   */
  const claims = (a: MemoryAnswer): string =>
    [a.heading, a.summary ?? "", ...a.items.map((i) => `${i.attribution} ${i.detail ?? ""}`)]
      .join(" ").toLowerCase();
  const titles = (a: MemoryAnswer): string[] => a.items.map((i) => i.text);

  // ============================================ 1. the router (§3, §4)

  {
    const p = planMemoryQuery("What did I finish last week?", { today: TODAY })!;
    eq("1.1 “what did I finish last week” → COMPLETION", p.kind, "COMPLETION");
    eq("1.2 …over Mon–Sun of last week", [p.range?.startKey, p.range?.endKey], ["2026-08-10", "2026-08-16"]);

    eq("1.3 “what was on my calendar yesterday” → EVENTS",
      planMemoryQuery("What was on my calendar yesterday?", { today: TODAY })?.kind, "EVENTS");
    eq("1.4 …dated to yesterday",
      planMemoryQuery("What was on my calendar yesterday?", { today: TODAY })?.range?.startKey, "2026-08-22");
    eq("1.5 “what am I waiting on” → WAITING with no range",
      [planMemoryQuery("What am I waiting on?", { today: TODAY })?.kind,
       planMemoryQuery("What am I waiting on?", { today: TODAY })?.range], ["WAITING", undefined]);
    eq("1.6 “what changed last week” → CHANGES",
      planMemoryQuery("What changed last week?", { today: TODAY })?.kind, "CHANGES");
    eq("1.7 “what happened with LotPilot” → PROJECT",
      planMemoryQuery("What happened with LotPilot?", { today: TODAY })?.kind, "PROJECT");
    eq("1.8 “what did I say about teaching” → REFLECTION + teaching",
      [planMemoryQuery("What did I say about teaching?", { today: TODAY })?.kind,
       planMemoryQuery("What did I say about teaching?", { today: TODAY })?.entityQuery],
      ["REFLECTION", "teaching"]);
    eq("1.9 “when did I finish deployment” → TIME/completed + deployment",
      [planMemoryQuery("When did I finish deployment?", { today: TODAY })?.kind,
       planMemoryQuery("When did I finish deployment?", { today: TODAY })?.timeAspect,
       planMemoryQuery("When did I finish deployment?", { today: TODAY })?.entityQuery],
      ["TIME", "completed", "deployment"]);
    eq("1.10 “what still needs attention” → OPEN_WORK",
      planMemoryQuery("What still needs attention?", { today: TODAY })?.kind, "OPEN_WORK");

    ok("1.11 an off-topic question routes to nothing at all",
      planMemoryQuery("How's the weather in Lisbon?", { today: TODAY }) === null);
    ok("1.12 …and so does small talk",
      planMemoryQuery("Tell me a joke", { today: TODAY }) === null);
    // LIFEOS-072 added NEXT_ACTION as the ninth class: "What should I do next?" routes
    // into the SAME deterministic recommender Today uses, never a second guidance path.
    // LIFEOS-073 added TOMORROW as the tenth — and the ONLY forward-looking
    // class. Every other kind asks what happened, which is why the future-range
    // refusal still guards the rest of them (asserted at 1.16 below).
    // LIFEOS-078 added GOALS as the eleventh: a question about a goal's
    // lifecycle or direction names a STATE rather than a time window, and
    // routing it through COMPLETION answered "which goals did I achieve" with a
    // list of finished actions.
    eq("1.13 the router supports exactly the eleven named classes",
      [...MEMORY_QUERY_KINDS].sort().join(","),
      ["COMPLETION", "EVENTS", "WAITING", "CHANGES", "PROJECT", "REFLECTION", "OPEN_WORK", "TIME", "NEXT_ACTION", "TOMORROW", "GOALS"].sort().join(","));
    eq("1.14 “what should I do next” routes to NEXT_ACTION",
      planMemoryQuery("What should I do next?", { today: TODAY })?.kind, "NEXT_ACTION");
    eq("1.15 …and so does “what's next”",
      planMemoryQuery("What's next?", { today: TODAY })?.kind, "NEXT_ACTION");
    eq("1.16 “what do I have tomorrow” routes to TOMORROW",
      planMemoryQuery("What do I have tomorrow?", { today: TODAY })?.kind, "TOMORROW");
    // The forward-looking exemption is exactly one class wide. Asking what
    // HAPPENED tomorrow is still a question about a period that has not
    // occurred, and must still be refused rather than answered emptily.
    ok("1.17 …while “what did I finish tomorrow” is NOT a TOMORROW question",
      planMemoryQuery("What did I finish tomorrow?", { today: TODAY })?.kind !== "TOMORROW",
      String(planMemoryQuery("What did I finish tomorrow?", { today: TODAY })?.kind));
    eq("1.18 “what's on tomorrow” is", planMemoryQuery("What's on tomorrow?", { today: TODAY })?.kind, "TOMORROW");
    eq("1.19 …and “anything tomorrow?” is too",
      planMemoryQuery("Anything tomorrow?", { today: TODAY })?.kind, "TOMORROW");
  }

  // ============================================ 2. ranges resolve BACKWARDS (§4)

  {
    eq("2.1 “last Tuesday” is the most recent Tuesday",
      resolveMemoryRange("What was I waiting on last Tuesday?", TODAY).range?.startKey, "2026-08-18");
    eq("2.2 “in June” is the June that has been, not the one ahead",
      [resolveMemoryRange("What did I write in June?", TODAY).range?.startKey,
       resolveMemoryRange("What did I write in June?", TODAY).range?.endKey],
      ["2026-06-01", "2026-06-30"]);
    eq("2.3 “in December” rolls back a year rather than forward",
      resolveMemoryRange("What happened in December?", TODAY).range?.startKey, "2025-12-01");
    eq("2.4 “this week” starts Monday and ends today",
      [resolveMemoryRange("What happened this week?", TODAY).range?.startKey,
       resolveMemoryRange("What happened this week?", TODAY).range?.endKey],
      ["2026-08-17", "2026-08-23"]);
    eq("2.5 “last 30 days” reuses the shared preset",
      resolveMemoryRange("What did I finish in the last 30 days?", TODAY).range?.kind, "last_30_days");

    // §4: unsupported wording is REPORTED, never guessed at.
    const vague = resolveMemoryRange("What did I finish a while ago?", TODAY);
    ok("2.6 “a while ago” resolves to no range", vague.range === undefined);
    eq("2.7 …and is reported as unsupported", vague.unresolved?.reason, "unsupported_range");

    const future = planMemoryQuery("What did I finish next week?", { today: TODAY })!;
    eq("2.8 a forward-looking window is refused as future", future.unresolved[0]?.reason, "future_range");
    const a = ask("What did I finish next week?");
    eq("2.9 …and answered as such", a.status, "NO_RECORDED_EVIDENCE");
    ok("2.10 …without inventing anything", a.items.length === 0);
  }

  // ============================================ 3. THE NEGATIVE ASSERTIONS (§23)

  {
    // ---- 1. a past Event does not imply attendance
    const cal = ask("What was on my calendar yesterday?");
    ok("3.1 a calendar answer never claims attendance",
      !/\battended|went to|met with|was at\b/.test(claims(cal)), claims(cal));
    ok("3.2 …it says the event was scheduled", /on your calendar|scheduled/.test(said(cal)));
    ok("3.3 …and states the limitation every time",
      /no record of whether you attended/.test(said(cal)));

    // ---- 2. a created Action does not imply accomplishment
    const fin = ask("What did I finish last week?");
    ok("3.4 a completion answer excludes the action that was only created",
      !titles(fin).includes("Draft the newsletter"), titles(fin).join(" | "));
    eq("3.5 …and counts exactly the recorded completions", fin.items.length, 3);
    ok("3.6 every completion line traces to a completion field",
      fin.items.every((i) => /completedAt|occurrenceDate/.test(i.evidence)),
      fin.items.map((i) => i.evidence).join(","));
    const acc = ask("What did I accomplish last week?");
    eq("3.7 “accomplish” retrieves the same evidence as “finish”", titles(acc), titles(fin));
    ok("3.8 …with no creation inflation", acc.items.length === fin.items.length);

    // ---- 3. Project.updatedAt does not imply progress
    const quiet = ask("What happened with Garden rebuild?");
    ok("3.9 a project touched last night with no dated activity reports none",
      quiet.status === "NO_RECORDED_EVIDENCE", quiet.status);
    ok("3.10 …and never uses the word progress", !/progress|moved forward|momentum/.test(quiet.summary!.toLowerCase()), quiet.summary);
    const lot = ask("What happened with LotPilot?");
    ok("3.11 a project answer counts linked records",
      /linked action/.test(lot.summary ?? ""), lot.summary);
    ok("3.12 …and never characterises the project",
      !/progress|momentum|healthy|on track|stalled|good|well/.test(said(lot)), said(lot));

    // ---- 4. an AI-generated Note does not become "you said"
    const teach = ask("What did I say about teaching?");
    const aiItem = teach.items.find((i) => i.ref?.id === "n-ai-teach");
    ok("3.13 the AI note is found", !!aiItem);
    ok("3.14 …and is NOT attributed to the user",
      aiItem?.attribution === "An AI-generated note contains", aiItem?.attribution);
    ok("3.15 …while the user's own note is",
      teach.items.find((i) => i.ref?.id === "n-teach")?.attribution === "You said");
    ok("3.16 …and the difference is stated in the answer",
      /ai-generated/.test(said(teach)), said(teach));

    // ---- 5. a sadness note does not become "you were sad that week"
    const sad = ask("What was I sad about last week?");
    ok("3.17 an emotion question is never fully answered",
      sad.status === "PARTIALLY_ANSWERED" || sad.status === "NO_RECORDED_EVIDENCE", sad.status);
    ok("3.18 …and says Conqify does not record feelings",
      /does not record how you felt/.test(said(sad)), said(sad));
    ok("3.19 …and never asserts the feeling itself",
      !/you were sad|you felt sad|a sad week/.test(said(sad)), said(sad));

    // ---- 6. no evidence produces no filler
    const may = ask("What happened in May?");
    eq("3.20 an empty month is NO_RECORDED_EVIDENCE", may.status, "NO_RECORDED_EVIDENCE");
    eq("3.21 …with no items at all", may.items.length, 0);
    ok("3.22 …and no invented narrative",
      !/probably|likely|seems|may have|perhaps|you were/.test(said(may)), said(may));

    // ---- 7. ambiguity never silently resolves
    const dash = ask("What happened with the dashboard?");
    eq("3.23 two plausible entities produce a choice", dash.status, "NEEDS_CHOICE");
    eq("3.24 …naming both", dash.choices?.length, 2);
    eq("3.25 …and answering neither", dash.items.length, 0);
    ok("3.26 …and each choice is openable", (dash.choices ?? []).every((c) => !!c.href));

    // ---- 8. current waiting state never rewrites historical waiting
    const past = ask("What was I waiting on last Tuesday?");
    eq("3.27 a historical waiting question is partial", past.status, "PARTIALLY_ANSWERED");
    ok("3.28 …excluding the wait that began after that day",
      !titles(past).includes("Plumber to send the quote"), titles(past).join(" | "));
    ok("3.29 …including only what demonstrably predates it",
      titles(past).includes("Marcus to send the signed lease"));
    ok("3.30 …and stating what cannot be recovered",
      /keeps no log of waits ending/.test(said(past)), said(past));
  }

  // ============================================ 4. the 15 torture questions (§22)

  {
    const t1 = ask("What did I finish last week?");
    ok("4.1 finished last week → completions only",
      t1.status === "ANSWERED" && t1.items.every((i) => i.attribution === "You completed"));

    const t3 = ask("What was on my calendar yesterday?");
    ok("4.3 calendar yesterday → the dentist, scheduled", titles(t3).includes("Dentist"));

    const t4 = ask("What am I waiting on?");
    eq("4.4 waiting now → both open waits", t4.items.length, 2);
    eq("4.4b …and it is a full answer", t4.status, "ANSWERED");

    const t5 = ask("Who am I waiting to hear from?");
    ok("4.5 “who” names the people the user wrote down",
      /marcus/i.test(t5.summary ?? "") && /plumber/i.test(t5.summary ?? ""), t5.summary);

    const t6 = ask("When did I finish the deployment?");
    ok("4.6 when did I finish → the exact recorded date",
      t6.status === "ANSWERED" && /aug 13/i.test(t6.summary ?? ""), t6.summary);

    const t7 = ask("When did I move the assignment?");
    ok("4.7 when did I move → the due_set history entry",
      t7.status === "ANSWERED" && t7.items[0]?.evidence === "action.history[].due_set", t7.items[0]?.evidence);
    ok("4.7b …dated to when the change was recorded, not to the new date",
      t7.items[0]?.day === "2026-08-11", t7.items[0]?.day);

    const t8 = ask("What changed last week?");
    ok("4.8 what changed → grouped, evidence-backed",
      t8.status === "ANSWERED" && t8.items.every((i) => !!i.evidence));

    const t9 = ask("What happened with LotPilot?");
    ok("4.9 project → a factual rollup", /2 linked actions were completed/.test(t9.summary ?? ""), t9.summary);

    const t10 = ask("What did I say about teaching?");
    ok("4.10 what did I say → dated user-authored sources",
      t10.items.filter((i) => i.attribution === "You said").length === 2);
    ok("4.10b …and every one carries its date", t10.items.every((i) => !!i.day));

    const t11 = ask("What was I worried about in June?");
    ok("4.11 worried in June → the June record whose text says so",
      t11.items.length === 1 && t11.items[0].ref?.id === "n-june", titles(t11).join("|"));
    eq("4.11b …reported as partial, because the feeling is not recorded", t11.status, "PARTIALLY_ANSWERED");

    const t13 = ask("What happened in May?");
    eq("4.13 empty May → no recorded evidence", t13.summary, "Conqify recorded nothing in that period. That is a gap in the record, not a description of the time.");

    const t14 = ask("What did I do at my dentist appointment?");
    eq("4.14 content of an appointment → partial", t14.status, "PARTIALLY_ANSWERED");
    ok("4.14b …showing the schedule and refusing the content",
      /what happened at it was never recorded/i.test(t14.summary ?? ""), t14.summary);
  }

  // ============================================ 5. wording guards

  {
    const questions = [
      "What did I finish last week?", "What was on my calendar yesterday?",
      "What am I waiting on?", "What changed last week?", "What happened with LotPilot?",
      "What did I say about teaching?", "What still needs attention?",
      "What happened in May?", "What was I waiting on last Tuesday?",
      "What did I do at my dentist appointment?", "What happened with the dashboard?",
    ];
    const every = questions.map((q) => said(ask(q))).join(" ");
    const claimed = questions.map((q) => claims(ask(q))).join(" ");

    const banned = violatesReviewLanguage(every);
    ok("5.1 no answer characterises the reader", banned.length === 0, banned.join(", "));
    ok("5.2 no answer claims attendance",
      !/\battended\b|\bwent to\b|\bmet with\b/.test(claimed), claimed.slice(0, 200));
    ok("5.3 no answer claims progress",
      !/made progress|good progress|moving well|momentum/.test(every));
    ok("5.4 no answer praises",
      !/great job|well done|productive|nice work|keep it up/.test(every));
    ok("5.5 no answer hedges into invention",
      !/\bprobably\b|\blikely\b|\bi think\b|\bit seems\b|\bmust have\b/.test(every));

    // "You said" is a claim about authorship, and it is earned per record.
    ok("5.6 “you said” requires an authored record of the right kind",
      canQuoteAsSaid("note", "user_authored") && canQuoteAsSaid("reflection", "user_authored"));
    ok("5.7 …never an Event", !canQuoteAsSaid("event", "user_authored"));
    ok("5.8 …never AI prose", !canQuoteAsSaid("note", "conqify_ai"));
    ok("5.9 …never an imported item verbatim", !canQuoteAsSaid("note", "imported_user_authored"));
    eq("5.10 an unknown-origin action is reported neutrally", attributionFor("action", "unknown"), "Conqify recorded");
    eq("5.11 an event is always calendar-attributed", attributionFor("event", "unknown"), "On your calendar");
    eq("5.12 AI prose in a note is labelled as such", attributionFor("note", "conqify_ai"), "An AI-generated note contains");

    // An Event whose title mentions the topic must not be quoted as speech (§5).
    const teach = ask("What did I say about teaching?");
    ok("5.13 an Event titled “Teaching prep” is not something the user said",
      !teach.items.some((i) => i.ref?.kind === "event"), JSON.stringify(teach.items.map((i) => i.ref)));
  }

  // ============================================ 6. privacy (§19)

  {
    const index = buildIndex(state);
    ok("6.1 Beliefs are in the ordinary search index", index.some((e) => e.kind === "belief"));
    ok("6.2 …and Constitution elements too", index.some((e) => e.kind === "constitution_element"));

    // …and neither may be retrieved by a memory question, even though both
    // contain the word being searched for.
    const teach = ask("What did I say about teaching?");
    ok("6.3 no Belief reaches a memory answer",
      !teach.items.some((i) => i.ref?.kind === "belief"), JSON.stringify(teach.sourceRefs));
    ok("6.4 no Constitution element reaches one",
      !teach.items.some((i) => i.ref?.kind === "constitution_element"));
    ok("6.5 …nor through entity resolution",
      resolveEntities(index, "teaching").every((e) => !MEMORY_EXCLUDED_KINDS.includes(e.kind)));

    const packet = buildEvidencePacket(teach);
    ok("6.6 the AI packet carries only retrieved facts",
      packet.facts.length === teach.items.length);
    ok("6.7 …and no ids beyond the ones already retrieved",
      packet.allowedRefs.every((r) => teach.sourceRefs.some((s) => s.id === r.id)));
    ok("6.8 …and no Belief or Constitution content",
      !JSON.stringify(packet).includes("remaining working years")
      && !JSON.stringify(packet).includes("above everything else"));
  }

  // ============================================ 7. AI validation (§18)

  {
    const allowed = { kinds: ["COMPLETION", "EVENTS"], ranges: ["last_week"], ids: ["a-deploy"] };
    ok("7.1 a valid classification is accepted",
      validateAiPlan({ kind: "COMPLETION", range: "last_week", ids: ["a-deploy"] }, allowed).ok);
    eq("7.2 an unknown class is rejected, not coerced",
      validateAiPlan({ kind: "MOOD", range: "last_week" }, allowed), { ok: false, reason: "unknown_kind" });
    eq("7.3 an unknown range is rejected",
      validateAiPlan({ kind: "EVENTS", range: "last_fortnight" }, allowed), { ok: false, reason: "unknown_range" });
    eq("7.4 an id that was never retrieved is rejected",
      validateAiPlan({ kind: "EVENTS", ids: ["a-invented"] }, allowed), { ok: false, reason: "unknown_id" });
    eq("7.5 a non-object is rejected", validateAiPlan("COMPLETION", allowed), { ok: false, reason: "not_an_object" });
    ok("7.6 an omitted range is allowed", validateAiPlan({ kind: "EVENTS" }, allowed).ok);
  }

  // ============================================ 8. source links (§16)

  {
    for (const q of ["What did I finish last week?", "What was on my calendar yesterday?",
      "What am I waiting on?", "What did I say about teaching?", "What still needs attention?"]) {
      const a = ask(q);
      ok(`8.x every item in “${q}” opens somewhere`,
        a.items.every((i) => !!i.href), a.items.filter((i) => !i.href).map((i) => i.text).join("|"));
    }
    eq("8.1 a Reflection opens where its text is shown",
      resolveRecord(state, "reflection", "r-teach")?.href, "/formation/timeline");
    eq("8.2 a past Event opens on Memory", resolveRecord(state, "event", "e-dentist")?.href, "/memory");
    ok("8.3 the index carries reflections", buildIndex(state).some((e) => e.kind === "reflection"));
    ok("8.4 …and events", buildIndex(state).some((e) => e.kind === "event"));
    ok("8.5 both kinds have display labels", !!RECORD_LABELS.reflection && !!RECORD_LABELS.event);
    ok("8.6 …and a place in the group order",
      RECORD_ORDER.includes("reflection") && RECORD_ORDER.includes("event"));
    ok("8.7 reflections and reflection sessions are labelled differently",
      RECORD_LABELS.reflection !== RECORD_LABELS.formation);
  }

  // ============================================ 9. determinism, purity, deletion

  {
    const before = JSON.stringify(state);
    const a = ask("What changed last week?");
    const b = ask("What changed last week?");
    eq("9.1 the same question returns the same answer", JSON.stringify(a), JSON.stringify(b));
    eq("9.2 asking changes nothing in the store", JSON.stringify(state), before);
    ok("9.3 recency is not a tie-breaker anywhere",
      ask("What happened with the dashboard?").status === "NEEDS_CHOICE");

    // §19 / smoke K–M. Deleting the source removes the memory, with no
    // invalidation step, because nothing was stored.
    const withNote = ask("What did I say about teaching?");
    ok("9.4 the note is in the answer", withNote.items.some((i) => i.ref?.id === "n-teach"));
    const pruned: StoreState = { ...state, notes: (state.notes ?? []).filter((n) => n.id !== "n-teach") };
    const after = answerMemoryQuery(pruned, "What did I say about teaching?", { today: TODAY });
    ok("9.5 deleting it removes it from the next answer",
      !after.items.some((i) => i.ref?.id === "n-teach"), titles(after).join("|"));
    ok("9.6 …and the remaining evidence is unchanged",
      after.items.some((i) => i.ref?.id === "r-teach"));

    // Deleting everything about a topic returns to no evidence, not to a guess.
    const emptied: StoreState = {
      ...state, notes: [], reflections: [], captures: [], decisions: [],
    } as StoreState;
    const none = answerMemoryQuery(emptied, "What did I say about teaching?", { today: TODAY });
    eq("9.7 with every source gone the answer is no evidence", none.status, "NO_RECORDED_EVIDENCE");
    ok("9.8 …and says so plainly", /no note, reflection, capture or decision/.test(none.summary ?? ""), none.summary);

    const blank = answerMemoryQuery(emptyState(), "What did I finish last week?", { today: TODAY });
    eq("9.9 an empty store answers with no evidence", blank.status, "NO_RECORDED_EVIDENCE");
    ok("9.10 …and never says the user did nothing",
      !/you did nothing|nothing was achieved|unproductive/.test(said(blank)), said(blank));

    ok("9.11 an unroutable question offers real examples, not a guess",
      ask("How's the weather?").items.length === 0
      && /what you finished/.test(said(ask("How's the weather?"))));
    ok("9.12 the no-evidence line is the one §14 asks for",
      NO_EVIDENCE_LINE === "I found no recorded evidence for that in Conqify.");
  }

  // ============================================ 10. no persistence (§28)

  {
    eq("10.1 the store still has 46 domains", STORE_DOMAINS.length, 46);
    ok("10.2 no memory-query domain was added",
      !(STORE_DOMAINS as string[]).some((d) => /memoryquery|queryhistory|chat|conversation|askhistory/i.test(d)),
      (STORE_DOMAINS as string[]).join(","));
    ok("10.3 an answer is a value, not a record — it has no id",
      !("id" in (ask("What am I waiting on?") as unknown as Record<string, unknown>)));
    ok("10.4 the implicit window is stated rather than hidden",
      /last 12 months|last 365 days/.test(said(ask("What happened with LotPilot?"))));
    eq("10.5 …and it is a year", IMPLICIT_LOOKBACK_DAYS, 365);
  }

  // ============================================ 11. entity extraction

  {
    eq("11.1 routing words are not topics", extractEntity("What was on my calendar yesterday?", "yesterday"), undefined);
    eq("11.2 an explicit topic survives intact", extractEntity("What happened with the calendar migration?"), "calendar migration");
    eq("11.3 the frame is stripped", extractEntity("When did I finish the deployment?"), "deployment");
    eq("11.4 …and so is the date", extractEntity("When did I finish the deployment last week?", "last week"), "deployment");
    eq("11.5 a waiting question has no topic", extractEntity("Who am I waiting to hear from?"), undefined);
  }

  // ============================================ 12. performance (§25)

  {
    const big = bigLife();
    const t = (q: string) => { const s = Date.now(); answerMemoryQuery(big, q, { today: TODAY }); return Date.now() - s; };
    const week = t("What changed last week?");
    const month = t("What changed last month?");
    const year = t("What happened this year?");
    ok(`12.1 a week answers fast at scale (${week}ms)`, week < 400, `${week}ms`);
    ok(`12.2 a month answers fast (${month}ms)`, month < 800, `${month}ms`);
    ok(`12.3 a year answers within budget (${year}ms)`, year < 2500, `${year}ms`);

    // The indexes are built once and passed down, not rebuilt per section.
    const shared = buildIndex(big);
    const s0 = Date.now();
    answerMemoryQuery(big, "What did I say about teaching?", { today: TODAY, searchIndex: shared });
    const reused = Date.now() - s0;
    ok(`12.4 a caller's prebuilt index is reused (${reused}ms)`, reused < 400, `${reused}ms`);
  }

  const passed = results.filter((x) => x.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - started,
    results,
  };
}

/**
 * A year of ordinary use, at the scale §25 asks for: ~1,200 actions, 400 events,
 * 600 notes, 200 reflections and 40 projects spread across twelve months.
 */
function bigLife(): StoreState {
  seq = 0;
  const s = emptyState();
  const day = (i: number): string => {
    const d = new Date(Date.UTC(2025, 7, 24));
    d.setUTCDate(d.getUTCDate() + (i % 365));
    return d.toISOString().slice(0, 10);
  };

  s.projects = Array.from({ length: 40 }, (_, i) => project(`bp${i}`, `Project ${i}`));

  const actions: NextAction[] = [];
  for (let i = 0; i < 1200; i += 1) {
    const d = day(i);
    const done = i % 3 === 0;
    actions.push(act({
      id: `ba${i}`, title: `Task ${i}`, createdAt: at(d, 9), projectId: `bp${i % 40}`,
      status: done ? "completed" : "open",
      completedAt: done ? at(d, 15) : undefined,
      history: [
        { id: `bh${i}a`, at: at(d, 9), action: "created" },
        ...(done ? [{ id: `bh${i}b`, at: at(d, 15), action: "completed" as const }] : []),
      ],
    } as Partial<NextAction> & { title: string; createdAt: string }));
  }
  s.nextActions = actions;

  s.events = Array.from({ length: 400 }, (_, i) =>
    ev({ id: `be${i}`, title: `Meeting ${i}`, date: day(i), startTime: "10:00" }));
  s.notes = Array.from({ length: 600 }, (_, i) =>
    note(`bn${i}`, `Note ${i} about teaching and other things.`, at(day(i), 20)));
  s.reflections = Array.from({ length: 200 }, (_, i) =>
    reflection(`br${i}`, `Reflection ${i} on teaching.`, at(day(i), 21)));

  return s;
}
