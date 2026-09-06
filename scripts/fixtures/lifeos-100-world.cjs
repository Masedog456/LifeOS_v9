/**
 * LIFEOS-100 §51 — the global fixture, as a module.
 *
 * One store visited from every scoped route, so "capture from here" is measured
 * against the same world each time. Shaped for the questions §12-§17 ask about
 * CONTEXT rather than for a tidy demo:
 *
 *   a Project and a Goal      §13, §14 — viewing one must not link to it
 *   an open Action            §15 — capturing from Today must not mean "due today"
 *   a WAITING item on Maria   §20 — an existing-record match must still ask
 *   a Reflection              §16 — reviewing the past must not date the new record
 *   a decision-worthy item    §17 — capture is not a decision resolution
 *   a recent capture          §25 — Home keeps the list; quick capture does not
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
const H = (action, when, x = {}) => ({ id: `qh${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p,
});

function world() {
  return {
    ...EMPTY(),
    goals: [{
      id: "g1", title: "Open the clinic", description: "", status: "active", priority: "high",
      notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
      history: [{ id: "gh0", at: at(-60, 8), kind: "created" }],
      createdAt: at(-90), updatedAt: at(-60),
    }],
    projects: [{
      id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
      priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: at(-90), updatedAt: at(-90),
    }],
    nextActions: [
      act({ id: "a-plain", title: "Draft the clinic brochure", projectId: "p1" }),
      act({ id: "a-over", title: "Pay the application fee", projectId: "p1", dueDate: dk(-4) }),
      act({ id: "a-today", title: "Call the dentist", projectId: "p1", dueDate: dk(0), dueTime: "14:00" }),
      /**
       * §20. The open wait LIFEOS-089 §18 protects: a second capture naming
       * Maria must ask rather than silently writing a duplicate commitment, and
       * that has to remain true from a quick-capture sheet.
       */
      act({ id: "a-wait", title: "Transcript from Maria", projectId: "p1", status: "waiting",
        waitingOn: "Maria", waitingSince: at(-7), followUpDate: dk(0),
        history: [H("waiting", at(-7), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
      // §17. Repeatedly postponed, so the decision inbox has a real question.
      act({ id: "a-defer", title: "Request the second recommendation", projectId: "p1",
        dueDate: dk(-1),
        history: [H("created", at(-30)), H("deferred", at(-9, 17)), H("deferred", at(-4, 17)),
          H("deferred", at(-1, 17))] }),
    ],
    reflections: [{
      id: "r1", prompt: "What mattered today?",
      response: "The clinic finally felt real.",
      context: dk(0), createdAt: at(0, 20), updatedAt: at(0, 20),
    }],
    captures: [{
      id: "c1", text: "I'm waiting on Maria for the transcript",
      createdAt: at(-1, 10), processingStatus: "processed", processedAt: at(-1, 10),
      linkedEntityRefs: [{ kind: "action", id: "a-wait" }],
    }],
    events: [{
      id: "e1", title: "Interview with the committee", date: dk(2),
      startTime: "14:00", allDay: false, createdAt: at(-8), updatedAt: at(-8),
    }],
  };
}

/** The routes §2 scopes, in the order a person moves between them. */
const ROUTES = [
  ["home", "/"],
  ["today", "/today"],
  ["project", "/project/p1"],
  ["goal", "/goal/g1"],
  ["decisions", "/today/decisions"],
  ["evening", "/today/review"],
  ["week", "/memory"],
  ["actions", "/actions"],
];

module.exports = { world, ROUTES, DOMAINS, EMPTY, dk, at, act, H };
