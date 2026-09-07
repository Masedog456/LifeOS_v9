/**
 * LIFEOS-103 §49 — the follow-through fixture.
 *
 * One store holding every record shape §2 asks about, so "does this capture end
 * with a grounded next move?" is measured against a world where the answer can
 * genuinely be either way.
 *
 * The pairs matter more than the rows. Each candidate follow-through has a
 * record that SHOULD qualify and one that must NOT, because a suggestion that
 * fires for both is noise:
 *
 *   waiting no follow-up   vs   waiting WITH follow-up          §7 / §8
 *   goal with no path      vs   goal with a direct action       §12
 *                          vs   goal with an active project     §12
 *   project with no work   vs   project with an executable one  §14
 *                          vs   project whose only work is blocked §15
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
const H = (action, when, x = {}) => ({ id: `fh${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p,
});

const goal = (p) => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
  history: [{ id: `g${p.id}`, at: at(-60, 8), kind: "created" }],
  createdAt: at(-90), updatedAt: at(-60), ...p,
});

const project = (p) => ({
  description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [],
  createdAt: at(-90), updatedAt: at(-90), ...p,
});

function world() {
  return {
    ...EMPTY(),
    goals: [
      // §12. Nothing carries this one — `goalPathState` "none".
      goal({ id: "g-nopath", title: "Learn to sail" }),
      // §12. Carried by a directly-linked action — "actions", NOT "none".
      goal({ id: "g-direct", title: "Apply to philosophy programs" }),
      // §12. Carried by an active project — "project".
      goal({ id: "g-project", title: "Open the clinic" }),
    ],
    projects: [
      // §14. Under g-project, and it has executable work.
      project({ id: "p-live", title: "Clinic launch", goalId: "g-project" }),
      // §14. No actions at all — `project_no_next_action`.
      project({ id: "p-empty", title: "Clinic lease", goalId: "g-project" }),
      // §15. Has work, but every piece of it is blocked or waiting.
      project({ id: "p-blocked", title: "Clinic fit-out", goalId: "g-project" }),
    ],
    nextActions: [
      // ordinary executable work under p-live
      act({ id: "a-live", title: "Draft the clinic brochure", projectId: "p-live" }),
      act({ id: "a-dated", title: "Pay the application fee", projectId: "p-live", dueDate: dk(2) }),
      // §12. The direct action that gives g-direct a path.
      act({ id: "a-direct", title: "Request the recommendation", goalId: "g-direct" }),
      // §7. A wait with NO follow-up date — the sprint's candidate.
      act({ id: "a-wait-none", title: "Transcript from Maria", projectId: "p-live",
        status: "waiting", waitingOn: "Maria", waitingSince: at(-7),
        history: [H("waiting", at(-7), { detail: "Maria", fromStatus: "open", toStatus: "waiting" })] }),
      // §8. A wait that already HAS one, three days out — must stay quiet.
      act({ id: "a-wait-set", title: "Signed lease from Ana", projectId: "p-live",
        status: "waiting", waitingOn: "Ana", waitingSince: at(-5), followUpDate: dk(3),
        history: [H("waiting", at(-5), { detail: "Ana", fromStatus: "open", toStatus: "waiting" })] }),
      // §15. p-blocked's only work: one blocked, one waiting.
      act({ id: "a-blocked", title: "Install the reception desk", projectId: "p-blocked", dueDate: dk(4) }),
      // The blocker lives under p-live, NOT p-empty. An earlier draft put it in
      // p-empty and quietly made that project non-empty — the audit caught it,
      // and a fixture that cannot produce the state it is named for tests
      // nothing.
      act({ id: "a-blocker", title: "Lease approval", projectId: "p-live" }),
      act({ id: "a-blocked-wait", title: "Quote from the contractor", projectId: "p-blocked",
        status: "waiting", waitingOn: "the contractor", waitingSince: at(-4), followUpDate: dk(1),
        history: [H("waiting", at(-4), { detail: "the contractor", fromStatus: "open", toStatus: "waiting" })] }),
      // §17. Recurring work already has its own future loop.
      act({ id: "a-recurring", title: "Pay rent", projectId: "p-live",
        recurrence: { frequency: "monthly", interval: 1, dayOfMonth: 1 } }),
      // §18. A completed action, so completion follow-through can be audited.
      act({ id: "a-done", title: "Book the venue", projectId: "p-live", status: "completed",
        completedAt: at(-1, 11),
        history: [H("created", at(-8)), H("completed", at(-1, 11), { fromStatus: "open", toStatus: "completed" })] }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-8) },
    ],
    events: [{
      id: "e1", title: "Interview with the committee", date: dk(2),
      startTime: "14:00", allDay: false, createdAt: at(-8), updatedAt: at(-8),
    }],
    notes: [{ id: "n1", title: "Passport expires in March", body: "Passport expires in March",
      tags: [], createdAt: at(-3), updatedAt: at(-3) }],
    constitutionElements: [{
      id: "ce1", kind: "standard", status: "adopted",
      statement: "I answer messages once a day, not all day.",
      adoptedAt: at(-2, 8), createdAt: at(-30), updatedAt: at(-2, 8),
    }],
    captures: [{
      id: "c1", text: "I'm waiting on Maria for the transcript",
      createdAt: at(-1, 10), processingStatus: "processed", processedAt: at(-1, 10),
      linkedEntityRefs: [{ kind: "action", id: "a-wait-none" }],
    }],
  };
}

/** §2's sixteen audit captures, in order, each named by the state it exercises. */
const CAPTURES = [
  ["01 ordinary action", "Email the landlord"],
  ["02 action with due date", "Call the dentist Friday"],
  ["03 action, no project", "Buy a new notebook"],
  ["04 waiting, no follow-up", "I'm waiting on Priya for the quote"],
  ["05 waiting, follow-up given", "Waiting on Sam for the keys, follow up Friday"],
  ["06 event", "Interview Tuesday at 2"],
  ["07 reflection", "I've been thinking teaching isn't what I want"],
  ["08 goal, direct action exists", "I'd like to apply to philosophy programs"],
  ["09 goal, no executable work", "I'd like to learn to sail"],
  ["10 project with next action", "Draft the brochure for Clinic launch"],
  ["11 project with no next action", "Sort out the Clinic lease"],
  ["12 blocked action", "Install the reception desk"],
  ["13 recurring action", "Pay rent on the first of every month"],
  ["14 completion", "I booked the venue"],
  ["15 rule suggestion", "I should never reply when I'm angry"],
  ["16 mixed action + note", "Email Marcus tomorrow and remember the lease expires Friday"],
];

module.exports = { world, CAPTURES, DOMAINS, EMPTY, dk, at, act, goal, project, H };
