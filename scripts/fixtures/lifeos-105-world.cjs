/**
 * LIFEOS-105 §52 — the lifecycle torture world.
 *
 * One deterministic store holding every record shape the brief's transition
 * matrix walks through. Days are offsets from a fixed anchor, so "overdue by
 * four days" stays overdue by four days and the same fixture means the same
 * thing tomorrow.
 *
 * The ids say what each record is FOR, because the audit reads this world's
 * output far more often than it reads this file.
 */

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

const ANCHOR = "2026-09-07"; // a Monday

function dk(n = 0) {
  const d = new Date(`${ANCHOR}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const at = (n = 0, h = 9, m = 0) =>
  `${dk(n)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

let hn = 0;
const H = (action, when, x = {}) => ({ id: `lh${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1,
  history: [H("created", at(-20))],
  createdAt: at(-20), updatedAt: at(-20), ...p,
});
const goal = (p) => ({
  description: "", status: "active", priority: "medium", notes: "", tags: [],
  linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
  history: [H("created", at(-60, 8))],
  createdAt: at(-60), updatedAt: at(-60), ...p,
});
const project = (p) => ({
  description: "", status: "active", priority: "medium", notes: "",
  milestones: [], relatedDocuments: [], relatedEntities: [],
  createdAt: at(-60), updatedAt: at(-60), ...p,
});
/** A wait, with the history entry every change engine reads. */
const waiting = (p) => act({
  status: "waiting", waitingSince: at(-7),
  history: [H("created", at(-20)), H("waiting", at(-7), { detail: p.waitingOn, fromStatus: "open", toStatus: "waiting" })],
  ...p,
});
/** An action with `times` recorded deferrals, the last landing on `until`. */
const deferred = (id, title, times, until, extra = {}) => act({
  id, title, status: "deferred", deferredUntil: until,
  history: [H("created", at(-20)), ...Array.from({ length: times }, (_, i) =>
    H("deferred", at(-14 + i * 3, 10), { fromStatus: "open", toStatus: "deferred", detail: until }))],
  ...extra,
});

/** §52. The world every chain in the audit starts from. */
function base() {
  return {
    ...EMPTY(),
    goals: [
      goal({ id: "g-live", title: "Open the clinic" }),         // carried by p-live
      goal({ id: "g-direct", title: "Apply to programs" }),     // carried by a-goal only
      goal({ id: "g-nopath", title: "Learn to sail" }),         // nothing carries it
    ],
    projects: [
      project({ id: "p-live", title: "Clinic launch", goalId: "g-live" }),
      project({ id: "p-empty", title: "Clinic lease", goalId: "g-live" }),
    ],
    nextActions: [
      // ---- the ordinary spine -------------------------------------------
      act({ id: "a-plain", title: "Send the invoice", dueDate: dk(0) }),
      act({ id: "a-overdue", title: "File the insurance claim", dueDate: dk(-4) }),
      act({ id: "a-future", title: "Renew the passport", dueDate: dk(30) }),
      act({ id: "a-undated", title: "Read the licensing guidance" }),
      // ---- waiting -------------------------------------------------------
      act({ id: "a-wait", title: "Deposit receipt", dueDate: dk(0) }), // becomes a wait in chain B
      waiting({ id: "a-wait-none", title: "Quote", waitingOn: "Priya", waitingSince: at(-21) }),
      waiting({ id: "a-wait-due", title: "Transcript", waitingOn: "Maria", followUpDate: dk(0) }),
      // ---- deferral ------------------------------------------------------
      deferred("a-defer1", "Sort the loft", 1, dk(9)),
      deferred("a-defer3", "Do the tax return", 3, dk(6)),
      // ---- blocking ------------------------------------------------------
      act({ id: "a-blocked", title: "Install the reception desk", projectId: "p-live", dueDate: dk(0) }),
      act({ id: "a-blocker", title: "Get lease approval", projectId: "p-live" }),
      // ---- recurrence ----------------------------------------------------
      act({ id: "a-recur", title: "Take the medication", dueTime: "08:00",
        recurrence: { frequency: "daily", interval: 1 } }),
      // ---- ancestry ------------------------------------------------------
      act({ id: "a-proj", title: "Draft the brochure", projectId: "p-live" }),
      act({ id: "a-goal", title: "Request the recommendation", goalId: "g-direct" }),
      // ---- history the change engines read -------------------------------
      act({ id: "a-done", title: "Book the venue", status: "completed",
        completedAt: at(-1, 15), updatedAt: at(-1, 15),
        history: [H("created", at(-9)), H("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
    ],
    actionDependencies: [
      { id: "d-1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-10) },
    ],
    events: [{
      id: "e-1", title: "Advisor meeting", date: dk(0), startTime: "11:00", endTime: "12:00",
      allDay: false, createdAt: at(-10), updatedAt: at(-10),
    }],
  };
}

module.exports = { base, EMPTY, DOMAINS, ANCHOR, dk, at, act, goal, project, waiting, deferred, H };
