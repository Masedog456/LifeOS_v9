/**
 * LIFEOS-101 §2 — the seeded store the corpus runs against.
 *
 * Existing-record matching (§26) and completion detection (§10) both read the
 * store, so a corpus run against an EMPTY store would measure a different
 * product from the one people use: "I called the dentist" has nothing to match
 * and "waiting on Maria" cannot duplicate anything that isn't there.
 *
 * Every record here exists so some corpus sentence can hit or miss it:
 *
 *   "Call the dentist"              "I called the dentist", "Dentist call done"
 *   "Transcript from Maria" (wait)  the waiting duplicates in §8
 *   "Email Marcus about the lease"  "Never got around to emailing Marcus"
 *   "Submit the application"        "That application is submitted", "I didn't…"
 *   "Request the recommendation"    "Finished the recommendation request"
 *   a certification Goal            "I'm not doing the certification anymore"
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
const H = (action, when, x = {}) => ({ id: `nh${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p,
});

function world() {
  return {
    ...EMPTY(),
    goals: [
      { id: "g1", title: "Open the clinic", description: "", status: "active", priority: "high",
        notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
        history: [{ id: "gh0", at: at(-60, 8), kind: "created" }],
        createdAt: at(-90), updatedAt: at(-60) },
      // §12. "I'm not doing the certification anymore" has a real target.
      { id: "g2", title: "Finish the certification", description: "", status: "active", priority: "medium",
        notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
        history: [{ id: "gh1", at: at(-40, 8), kind: "created" }],
        createdAt: at(-40), updatedAt: at(-40) },
    ],
    projects: [{
      id: "p1", title: "Clinic launch", goalId: "g1", description: "", status: "active",
      priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: at(-90), updatedAt: at(-90),
    }],
    nextActions: [
      act({ id: "a-dentist", title: "Call the dentist", projectId: "p1", dueDate: dk(1) }),
      act({ id: "a-marcus", title: "Email Marcus about the lease", projectId: "p1" }),
      act({ id: "a-apply", title: "Submit the application", projectId: "p1", dueDate: dk(3) }),
      act({ id: "a-rec", title: "Request the recommendation", projectId: "p1" }),
      act({ id: "a-brochure", title: "Draft the clinic brochure", projectId: "p1" }),
      // §8, §26. The open wait a second "waiting on Maria" must not duplicate.
      act({ id: "a-wait", title: "Transcript from Maria", projectId: "p1", status: "waiting",
        waitingOn: "Maria", waitingSince: at(-7), followUpDate: dk(0),
        history: [H("waiting", at(-7), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
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

module.exports = { world, DOMAINS, EMPTY, dk, at, act, H };
