/**
 * LIFEOS-102 §42 — the transparency fixture.
 *
 * One store shaped so each of §2's twenty audit captures lands on something
 * real. Transparency claims are about what the product KNOWS at render time, so
 * a fixture with nothing to match would let a summary look honest while
 * describing an empty world.
 *
 *   two "recommendation request" actions   §10, §15 completion AMBIGUITY
 *   one "Submit the application"           §15 completion EXACT
 *   an open wait on Maria                  §16 waiting, and duplicate protection
 *   a blocked action + its blocker         §25 "Blocked by"
 *   two similarly named projects           §33 "Which Project?" with real choices
 *   a goal                                 §21 goal context
 *   a recurring action                     §24 canonical recurrence language
 */

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const dk = (o = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const at = (o = 0, h = 9) => `${dk(o)}T${String(h).padStart(2, "0")}:00:00.000Z`;

let hn = 0;
const H = (action, when, x = {}) => ({ id: `th${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p,
});

function world() {
  return {
    ...EMPTY(),
    goals: [{
      id: "g1", title: "Apply to philosophy programs", description: "", status: "active",
      priority: "high", notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [],
      horizon: "medium", history: [{ id: "gh0", at: at(-60, 8), kind: "created" }],
      createdAt: at(-90), updatedAt: at(-60),
    }],
    projects: [
      { id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
        priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
        createdAt: at(-90), updatedAt: at(-90) },
      // §33. A second, similarly-named project so "Which Project?" has real choices.
      { id: "p2", title: "Clinic lease", goalId: "g1", description: "", status: "active",
        priority: "medium", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
        createdAt: at(-70), updatedAt: at(-70) },
    ],
    nextActions: [
      // §15 completion EXACT — one unambiguous target.
      act({ id: "a-apply", title: "Submit the application", projectId: "p1", dueDate: dk(3) }),
      // §10, §15 completion AMBIGUITY — two records one sentence can mean.
      act({ id: "a-rec-smith", title: "Request recommendation from Smith", projectId: "p1" }),
      act({ id: "a-rec-jones", title: "Request recommendation from Jones", projectId: "p1" }),
      // §16 waiting — the open wait a second mention must not duplicate.
      act({ id: "a-wait", title: "Transcript from Maria", projectId: "p1", status: "waiting",
        waitingOn: "Maria", waitingFor: "the transcript", waitingSince: at(-7), followUpDate: dk(0),
        history: [H("waiting", at(-7), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
      // §25 blocked — the dependency pair.
      act({ id: "a-blocked", title: "Open the clinic doors", projectId: "p1", dueDate: dk(5) }),
      act({ id: "a-blocker", title: "Lease approval", projectId: "p2" }),
      // §24 recurrence — an existing repeating commitment.
      act({ id: "a-rec", title: "Pay rent", projectId: "p1",
        recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 1 } }),
      act({ id: "a-plain", title: "Draft the clinic brochure", projectId: "p1" }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-8) },
    ],
    events: [{
      id: "e1", title: "Interview with the committee", date: dk(2),
      startTime: "14:00", allDay: false, createdAt: at(-8), updatedAt: at(-8),
    }],
    captures: [{
      id: "c1", text: "I'm waiting on Maria for the transcript",
      createdAt: at(-1, 10), processingStatus: "processed", processedAt: at(-1, 10),
      linkedEntityRefs: [{ kind: "action", id: "a-wait" }],
    }],
  };
}

/**
 * §2's twenty audit captures, in order, each named by the state it exercises.
 * `scripts/smoke-102-transparency.cjs` and the audit probe both read this, so
 * the sentence a claim is made about is the sentence that was measured.
 */
const CAPTURES = [
  ["01 simple action", "Email the landlord"],
  ["02 action + date", "Call the dentist Friday"],
  ["03 action + time", "Call Marcus tomorrow at 2pm"],
  ["04 waiting", "I'm waiting on Ana for the signed lease"],
  ["05 event", "Interview Tuesday at 2"],
  ["06 note", "Maria's number is 555-0142"],
  ["07 reflection", "I've been thinking teaching isn't what I want"],
  ["08 goal suggestion", "I'd like to run a marathon"],
  ["09 rule suggestion", "I should never reply when I'm angry"],
  ["10 mixed intent", "Email Marcus tomorrow and remember the lease expires Friday"],
  ["11 completion exact", "I submitted the application"],
  ["12 completion ambiguous", "Finished the recommendation request"],
  ["13 project exact", "Draft the brochure for Clinic launch"],
  ["14 project possible", "Book the venue for the clinic"],
  ["15 goal context", "Read more about philosophy programs"],
  ["16 recurrence", "Run every Monday"],
  ["17 blocked", "I can't open the clinic doors until the lease approval comes through"],
  ["18 uncertainty", "Maybe I should call the dentist"],
  ["19 historical", "When I was applying to college I called Maria every week"],
  ["20 negated", "I don't need to call Marcus"],
];

module.exports = { world, CAPTURES, DOMAINS, EMPTY, dk, at, act, H };
