/**
 * LIFEOS-096 — the record's name, asserted.
 *
 * Every capture below runs through the REAL `interpret`, for the same reason
 * LIFEOS-095's suite does: the sprint's whole claim is that a clean title can be
 * recomposed from fields the interpreter ALREADY extracts, and a fixture that
 * hand-built `waitingOn` and `waitingFor` would be asserting that claim about
 * itself.
 */

import type { StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { interpret } from "@/lib/capture/interpret";
import { readChanges } from "@/lib/capture/completion";
import { buildCaptureContextIndex, suggestContext } from "@/lib/capture/context";
import { cleanCandidateTitle, cleanTitles } from "@/lib/capture/titles";
import { describeCreated, OUTCOME_LABEL } from "@/lib/capture/home";
import { buildSearchEntries } from "@/lib/command/records";
import { scoreEntry } from "@/lib/command/ranking";

const T = "2026-09-06";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

function world(): StoreState {
  const s = emptyStoreState();
  s.projects = [{
    id: "p-clinic", title: "Clinic launch", description: "", status: "active", priority: "medium",
    notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as StoreState["projects"];
  s.goals = [{
    id: "g1", title: "Graduate school", description: "", status: "active", priority: "high",
    notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium", history: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as StoreState["goals"];
  return s;
}

/** The first candidate the real interpreter produces, and its cleaned title. */
function read(text: string, s: StoreState = world()) {
  const c = (interpret(text, s, T).candidates ?? [])[0];
  return { c, clean: c ? cleanCandidateTitle(c) : null };
}

export function runCleanTitleSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  // ---- §8. Waiting: the thing, then who has it ---------------------------
  for (const [text, want, why] of [
    ["I'm waiting on Maria for the transcript", "Transcript from Maria", "the sprint's headline case"],
    ["Maria owes me the recommendation letter", "Recommendation letter from Maria", "owed, without amplifying “owes”"],
    ["I'm waiting on Ana for the review of the book", "Review of the book from Ana", "a noun that opens with a verb word"],
  ] as const) {
    const { c, clean } = read(text);
    ok(`96.1 §8 ${why}`, clean?.title === want, `${c?.kind}: "${clean?.title}"`);
    ok(`96.2 §8 …and it is recorded as a change`, clean?.changed === true, String(clean?.reason));
    // §3: the fields it was built from are untouched, and so is the sentence.
    ok(`96.3 §3 …with the raw evidence and the fields intact`,
      c?.evidence.text === text && !!c?.fields.waitingOn && !!c?.fields.waitingFor,
      `${c?.evidence.text} | ${c?.fields.waitingOn} | ${c?.fields.waitingFor}`);
  }

  // ---- §8. …and when it cannot, it does not -------------------------------
  {
    // `waitingFor` parses as "send the lease" — a verb phrase. "Send the lease
    // from landlord" is worse than the sentence, and §8 says not to fabricate
    // nouns, so the rule declines. This is the assertion that stops the rule
    // becoming a generator.
    const { c, clean } = read("I'm waiting for the landlord to send the lease");
    ok("96.4 §8 a verb-headed object declines rather than composing a worse title",
      clean?.changed === false && clean?.title === c?.fields.title,
      `"${clean?.title}" (${clean?.reason})`);
    ok("96.4b §8 …even though both fields were extracted",
      !!c?.fields.waitingOn && !!c?.fields.waitingFor,
      `${c?.fields.waitingOn} | ${c?.fields.waitingFor}`);
  }
  {
    const { clean } = read("Waiting on Marcus");
    ok("96.5 §8 a wait with no object keeps its own words",
      clean?.title === "Waiting on Marcus" && clean?.changed === false, String(clean?.title));
  }

  // ---- §24. What framing-stripping leaves behind --------------------------
  for (const [text, want] of [
    ["I need to send Marcus the lease", "Send Marcus the lease"],
    ["I have to email the registrar", "Email the registrar"],
    ["I should finish the application", "Finish the application"],
  ] as const) {
    const { clean } = read(text);
    ok(`96.6 §24 "${text}" is capitalised, not re-titled`, clean?.title === want, String(clean?.title));
  }
  ok("96.7 §24 …and nothing is title-cased",
    read("I need to send Marcus the lease").clean?.title !== "Send Marcus The Lease");
  {
    // A word the person cased deliberately is theirs. "iPhone charger" must not
    // come back as "IPhone charger".
    const { clean } = read("I'm waiting on Sam for the iPhone charger");
    ok("96.8 §24 a deliberately-cased word is left exactly as typed",
      clean?.title === "iPhone charger from Sam", String(clean?.title));
  }

  // ---- Already clean stays untouched --------------------------------------
  for (const [text, want, kind] of [
    ["Finish the philosophy statement tomorrow", "Finish the philosophy statement", "action"],
    ["Apply to philosophy programs", "Apply to philosophy programs", "action"],
    ["Dinner with Ana next Thursday at 7", "Dinner with Ana", "event"],
    ["The interview is Tuesday at 2", "The interview", "event"],
    ["My dad's birthday is October 8", "My dad's birthday", "event"],
  ] as const) {
    const { c, clean } = read(text);
    ok(`96.9 ${kind} "${want}" was already clean and is not touched`,
      clean?.title === want && clean?.changed === false, `${c?.kind}: "${clean?.title}"`);
  }

  // ---- §22. A parsed date leaves the title; the fact does not -------------
  for (const [text, field] of [
    ["Finish the philosophy statement tomorrow", "dueDate"],
    ["Dinner with Ana next Thursday at 7", "time"],
    ["My dad's birthday is October 8", "recurrence"],
  ] as const) {
    const { c, clean } = read(text);
    ok(`96.10 §22 "${text}" keeps its ${field} in a field, not in the name`,
      !!c?.fields[field] && !/tomorrow|thursday|october/i.test(clean?.title ?? ""),
      `${clean?.title} | ${JSON.stringify(c?.fields[field])}`);
  }

  // ---- §12, §13, §18, §21. What may never be rewritten --------------------
  for (const [text, why] of [
    ["I realized teaching isn't what I want", "a reflection is the person's own words"],
    ["The clinic launch is blocked by the lease", "there is no structured blocker, so the words are the record"],
    ["I don't need to call Marcus", "the negation lives in the sentence"],
    ["I'm not applying to law school", "so does this one"],
    ["I'm not doing the certification anymore", "and this one"],
    ["Research whether I should apply", "the action is researching, not applying"],
    ["Remember that my passport expires in March", "an unresolved date stays in the words (§22)"],
  ] as const) {
    const { c, clean } = read(text);
    ok(`96.11 §18 untouched — ${why}`,
      clean?.changed === false && clean?.title === c?.fields.title,
      `${c?.kind}: "${clean?.title}"`);
  }
  {
    /**
     * The CLEANABLE guard, asserted where it can actually fail.
     *
     * Mutations M1 and M2 added note and reflection to the cleanable set, and
     * removed the guard entirely, and nothing reddened — because every note in
     * the fixture above was already capitalised and unpunctuated, so the tidy
     * path would have left it alone anyway. Three assertions cannot tell a
     * guard from a coincidence.
     *
     * This capture's title starts lower case, so the tidy path WOULD change it.
     * The note kind is what stops that. (The composer also feeds `body` rather
     * than the cleaned title for note-shaped kinds, so the store is protected
     * twice — this pins the function's own contract, which is what a future
     * caller would rely on.)
     */
    const { c, clean } = read("the clinic launch is blocked by the lease.");
    ok("96.11b §12 a note whose title WOULD tidy is still left alone",
      c?.kind === "note" && clean?.changed === false
      && clean?.title === "the clinic launch is blocked by the lease",
      `${c?.kind}: "${clean?.title}" (${clean?.reason})`);
    ok("96.11c §12 …and the reason names the kind, not a tidiness judgement",
      /note/.test(clean?.reason ?? ""), String(clean?.reason));
  }
  {
    // The specific inversions §18 names, asserted as inversions rather than as
    // "unchanged" — a rule that broke these would produce these exact strings.
    const bad = [
      ["I don't need to call Marcus", /^Call Marcus$/],
      ["I'm not applying to law school", /^Apply to law school$/i],
      ["Research whether I should apply", /^Apply$/i],
      ["I realized teaching isn't what I want", /^Leave teaching$/i],
    ] as const;
    const broken = bad.filter(([text, re]) => re.test(read(text).clean?.title ?? ""));
    ok("96.12 §18 no capture is inverted into its opposite",
      broken.length === 0, broken.map(([t]) => t).join(" | "));
  }

  // ---- §20. A dependency the title never had to carry --------------------
  {
    const { c } = read("When Marcus replies, send the lease");
    ok("96.13 §20 a dependency becomes a trigger, not a stripped title",
      c?.kind === "protocol" && c?.fields.trigger === "Marcus replies"
      && c?.fields.response === "send the lease",
      `${c?.kind}: ${c?.fields.trigger} → ${c?.fields.response}`);
    ok("96.13b §20 …and the title rule refuses that kind outright",
      cleanCandidateTitle(c!).changed === false, String(cleanCandidateTitle(c!).reason));
  }

  // ---- §17. Completion matching runs before any title exists -------------
  {
    const s = world();
    s.nextActions = [{
      id: "a-rec", title: "Send the recommendation request", description: "", status: "open",
      notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 1, history: [], createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"),
    }] as StoreState["nextActions"];
    const ch = readChanges("I finished the recommendation request", s, T);
    ok("96.14 §17 a completion sentence still matches its record",
      ch.changes.length === 1, JSON.stringify(ch.changes.map((x) => x.targetQuery)));
    // The reason it cannot regress: matching reads the RAW capture against
    // stored titles, and this sprint changes neither.
    ok("96.14b §17 …and matching never sees a cleaned title",
      ch.changes[0]?.targetQuery !== undefined
      && !/from |Transcript/i.test(JSON.stringify(ch.changes[0])), JSON.stringify(ch.changes[0]));
  }
  {
    // The forward direction: a record NAMED by this sprint is still findable by
    // a later completion sentence. This is the case the brief worried about.
    const s = world();
    s.nextActions = [{
      id: "a-t", title: "Transcript from Maria", description: "", status: "waiting",
      waitingOn: "Maria", notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
      energy: "unspecified", order: 1, history: [], createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"),
    }] as StoreState["nextActions"];
    ok("96.15 §17 a cleanly-named record is matched by a later completion",
      readChanges("I got the transcript from Maria", s, T).changes.length === 1,
      JSON.stringify(readChanges("I got the transcript from Maria", s, T).changes));
  }

  // ---- §24. One sentence, one casing convention --------------------------
  {
    /**
     * Found by LIFEOS-080's browser suite. "I want to get healthier so I should
     * stop eating late, and I need to book a physical" produces a goal, a rule
     * and an action — and with goals excluded from tidying, the list read
     * "get healthier" beside "Book a physical". §14 and §15 forbid
     * strengthening what the interpreter CLAIMS about an aspiration; they do
     * not require the claim it already made to read like a fragment.
     */
    const cands = interpret(
      "I want to get healthier so I should stop eating late, and I need to book a physical",
      world(), T,
    ).candidates ?? [];
    const named = cleanTitles(cands).map((r, i) => [cands[i].kind, r.title]);
    ok("96.6b §24 a goal is capitalised like everything beside it",
      named.some(([k, t]) => k === "goal" && t === "Get healthier"), JSON.stringify(named));
    ok("96.6c §16 …but a rule's normative wording is not touched at all",
      cleanTitles(cands)[1]?.changed === false
      && named.some(([k, t]) => k === "standard" && t === "I should stop eating late"),
      JSON.stringify(named));
    ok("96.6d §24 …and no title in the set is left lower case",
      named.every(([, t]) => !/^[a-z]/.test(String(t))), JSON.stringify(named));
  }

  // ---- §9, §43. The person is named once ---------------------------------
  {
    const s2 = world();
    s2.nextActions = [
      { id: "a-clean", title: "Transcript from Maria", description: "", status: "waiting",
        waitingOn: "Maria", notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
        energy: "unspecified", order: 1, history: [], createdAt: D(T), updatedAt: D(T) },
      { id: "a-plain", title: "Waiting on Marcus", description: "", status: "waiting",
        waitingOn: "Sam", notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
        energy: "unspecified", order: 1, history: [], createdAt: D(T), updatedAt: D(T) },
    ] as StoreState["nextActions"];
    const clean = describeCreated(s2, [{ kind: "action", id: "a-clean" }])[0];
    ok("96.16c §9 a title that already names the person does not say it again",
      clean?.label === "Waiting" && !clean?.detail,
      `${clean?.label} · ${clean?.title} · ${clean?.detail ?? "(no detail)"}`);
    const plain = describeCreated(s2, [{ kind: "action", id: "a-plain" }])[0];
    ok("96.16d §9 …and a title that does not name them still says who",
      plain?.detail === "Waiting on Sam", String(plain?.detail));
  }

  // ---- §26. Duplicate detection, both directions -------------------------
  {
    // 095 blocks an auto-finish when 089 says a record like this may already
    // exist. A cleaner title is a DIFFERENT haystack, so the guard is checked
    // against a store holding the clean form and against one holding the old.
    const forEach = (title: string) => {
      const s = world();
      s.nextActions = [{
        id: "a1", title, description: "", status: "waiting", waitingOn: "Maria", notes: "",
        linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
        order: 1, history: [], createdAt: D("2026-09-01"), updatedAt: D("2026-09-01"),
      }] as StoreState["nextActions"];
      const ix = buildCaptureContextIndex(s);
      const c = (interpret("I'm waiting on Maria for the transcript", s, T).candidates ?? [])[0];
      return suggestContext(c, s, ix).filter((x) => x.contextType === "action");
    };
    ok("96.16 §26 the duplicate guard still fires against a cleanly-named record",
      forEach("Transcript from Maria").length > 0,
      JSON.stringify(forEach("Transcript from Maria").map((x) => x.label)));
    ok("96.16b §26 …and against a record still carrying the old sentence-title",
      forEach("I'm waiting on Maria for the transcript").length > 0,
      JSON.stringify(forEach("I'm waiting on Maria for the transcript").map((x) => x.label)));
  }

  // ---- §27. Search keeps the words you actually typed ---------------------
  {
    const s = world();
    s.captures = [{
      id: "c1", text: "I'm waiting on Maria for the transcript", createdAt: D(T, 10),
      processingStatus: "processed", processedAt: D(T, 10),
      linkedEntityRefs: [{ kind: "action", id: "a1" }],
    }] as StoreState["captures"];
    s.nextActions = [{
      id: "a1", title: "Transcript from Maria", description: "", status: "waiting",
      waitingOn: "Maria", notes: "", linkedEntityRefs: [], tags: [], estimatedSize: "unspecified",
      energy: "unspecified", order: 1, history: [], sourceCaptureId: "c1",
      createdAt: D(T, 10), updatedAt: D(T, 10),
    }] as StoreState["nextActions"];
    const entries = buildSearchEntries(s);
    const action = entries.find((e) => e.kind === "action" && e.id === "a1");
    ok("96.17 §27 the Action is findable by its clean title",
      !!scoreEntry(action!, "transcript from maria"), String(action?.title));
    ok("96.18 §27 …and by the words the person actually typed",
      !!scoreEntry(action!, "waiting on maria"), String(action?.titleLower));
    // The mechanism, so a future change that drops the source index reddens
    // here rather than only in a ranking assertion that might be tuned away.
    ok("96.18b §27 …because the source capture is in the Action's haystack",
      /waiting on maria/i.test(action?.bodyLower ?? ""), (action?.bodyLower ?? "").slice(0, 90));
    const capture = entries.find((e) => e.kind === "capture");
    ok("96.19 §27 and the capture itself is still its own result",
      !!capture && !!scoreEntry(capture, "waiting on maria"), String(capture?.title));
  }

  // ---- §30, §32, §33. Every domain a capture can become ------------------
  {
    const s = world();
    s.nextActions = [{ id: "x", title: "Call the dentist", description: "", status: "open", notes: "",
      linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified", order: 1,
      history: [], createdAt: D(T), updatedAt: D(T) }] as StoreState["nextActions"];
    s.notes = [{ id: "x", title: "", body: "Passport expires in March", createdAt: D(T), updatedAt: D(T),
      tags: [], linkedEntityRefs: [] }] as StoreState["notes"];
    s.events = [{ id: "x", title: "Interview", date: "2026-09-08", allDay: false,
      createdAt: D(T), updatedAt: D(T) }] as StoreState["events"];
    s.protocols = [{ id: "x", trigger: "Marcus replies", response: "send the lease", status: "active",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["protocols"];
    s.projects = [{ ...s.projects[0], id: "x" }] as StoreState["projects"];
    s.goals = [{ ...s.goals[0], id: "x" }] as StoreState["goals"];
    s.beliefs = [{ id: "x", captureId: "c", proposalId: "p", text: "Teaching is safe",
      status: "accepted", revisions: [], judgments: [], createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["beliefs"];
    s.reflections = [{ id: "x", prompt: "q", response: "I realized teaching isn't what I want",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["reflections"];
    s.concepts = [{ id: "x", name: "Program choice", definition: "d", status: "active",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["concepts"];
    s.decisions = [{ id: "x", title: "Choose graduate program", question: "q", status: "exploring",
      options: [], criteria: [], createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["decisions"];
    s.researchProjects = [{ id: "x", title: "Funding routes", question: "q", status: "active",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["researchProjects"];
    s.dialogueSessions = [{ id: "x", title: "Teaching or research", topic: "t", status: "open",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["dialogueSessions"];
    s.principles = [{ id: "x", statement: "Pause before replying", status: "active",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["principles"];
    s.frameworks = [{ id: "x", name: "Decision matrix", kind: "framework", description: "d",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["frameworks"];
    s.practices = [{ id: "x", title: "Morning walk", description: "d", status: "accepted",
      createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["practices"];
    s.workspaces = [{ id: "x", name: "Home", createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["workspaces"];
    s.constitutionElements = [{ id: "x", kind: "standard", statement: "Pause before replying when angry",
      status: "active", createdAt: D(T), updatedAt: D(T) }] as unknown as StoreState["constitutionElements"];

    const KINDS = ["action", "note", "event", "protocol", "project", "goal", "belief", "formation",
      "concept", "decision", "research_project", "dialogue", "principle", "framework", "practice",
      "workspace", "constitution_element"];
    const unnamed = KINDS.filter((k) => describeCreated(s, [{ kind: k, id: "x" }]).length === 0);
    ok("96.20 §30 every domain a capture can become is named, not “Filed”",
      unnamed.length === 0, unnamed.join(", "));
    {
      // Mutation M10 deleted one OUTCOME_LABEL entry and nothing reddened: the
      // table still produced the record's title, so the row read "Record ·
      // Choose graduate program" instead of "Decision · …" and every assertion
      // was happy. The LABEL is half of what §35's copy says, so it is asserted.
      const want: Record<string, string> = {
        action: "Action", note: "Note", event: "Event", protocol: "Protocol",
        project: "Project", goal: "Goal", belief: "Belief", formation: "Reflection",
        concept: "Concept", decision: "Decision", research_project: "Research",
        dialogue: "Dialogue", principle: "Principle", framework: "Framework",
        practice: "Practice", workspace: "Workspace", constitution_element: "Rule",
      };
      const wrong = KINDS.filter((k) => describeCreated(s, [{ kind: k, id: "x" }])[0]?.label !== want[k]);
      ok("96.20b §35 …under the right product word for its own domain",
        wrong.length === 0,
        wrong.map((k) => `${k}: ${describeCreated(s, [{ kind: k, id: "x" }])[0]?.label}`).join(", "));
    }
    {
      /**
       * A record the store holds but has not named.
       *
       * Mutation M9 replaced the empty-title guard with a literal "Saved" and
       * nothing reddened, because no fixture had a nameless record. §33 is
       * explicit — honest thinness beats fake specificity — so a concept with
       * no name renders as "Filed", not as a word this layer made up.
       */
      const blank = { ...s, concepts: [{ id: "x", name: "  ", definition: "d", status: "active",
        createdAt: D(T), updatedAt: D(T) }] } as unknown as StoreState;
      ok("96.20c §33 a record with no name of its own is never given one",
        describeCreated(blank, [{ kind: "concept", id: "x" }]).length === 0,
        JSON.stringify(describeCreated(blank, [{ kind: "concept", id: "x" }])));
    }
    ok("96.21 §33 …and each says the record's own words",
      describeCreated(s, [{ kind: "decision", id: "x" }])[0]?.title === "Choose graduate program"
      && describeCreated(s, [{ kind: "constitution_element", id: "x" }])[0]?.title === "Pause before replying when angry",
      "");
    ok("96.22 §35 …under a product word, never a domain word",
      Object.values(OUTCOME_LABEL).every((w) => /^[A-Z][a-z]+$/.test(w)),
      Object.values(OUTCOME_LABEL).join(","));
    // §31 survives the new table: a ref the store never wrote is never claimed.
    const ghosts = KINDS.filter((k) => describeCreated(s, [{ kind: k, id: "nope" }]).length > 0);
    ok("96.23 §31 …and a ref the store never wrote is still claimed by none of them",
      ghosts.length === 0, ghosts.join(", "));
  }

  // ---- The rule is applied to every candidate, or none -------------------
  {
    const cands = interpret(
      "Call the dentist tomorrow, finish the report, and Marcus still owes me the file",
      world(), T,
    ).candidates ?? [];
    const all = cleanTitles(cands);
    ok("96.24 one sentence, several records, one rule applied to each",
      all.length === cands.length && all.every((r) => r.title.trim().length > 0),
      all.map((r) => `"${r.title}"`).join(" | "));
    ok("96.25 …and no cleaned title ends in punctuation",
      all.every((r) => !/[.,;:!?]$/.test(r.title)), all.map((r) => r.title).join(" | "));
  }

  // ---- §44. The rule costs nothing ---------------------------------------
  {
    const cands = interpret("I'm waiting on Maria for the transcript", world(), T).candidates ?? [];
    const t = Date.now();
    for (let i = 0; i < 2000; i += 1) cleanTitles(cands);
    const ms = Date.now() - t;
    ok("96.26 §44 two thousand title cleanups take under 100ms", ms < 100, `${ms}ms`);
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
