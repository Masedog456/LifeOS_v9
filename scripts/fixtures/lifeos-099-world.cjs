/**
 * LIFEOS-099 §48 — the accessibility fixture, as a module.
 *
 * One world, shared by the audit probes and by the browser proof, so a
 * measurement and the assertion that pins it are looking at the same pixels.
 * LIFEOS-098's probes re-declared their world by `eval`-ing slices out of the
 * smoke script, which broke twice and is not a thing to repeat.
 *
 * Shaped for the things §3 asks to measure rather than for a tidy demo:
 *
 *   a LONG action title        §18 wrapping, §19 truncation
 *   an overdue action          §11 colour-only state, §7 metadata
 *   a wait with a passed
 *     follow-up, and one due   §11 two states that must not read alike
 *   a blocked action + blocker §19 the blocker must stay discoverable
 *   a cancelled + completed    §33 terminal-state legibility, §11 state
 *   a long PROJECT and GOAL    §18 metadata overlapping controls
 *   a decision                 §23 the inbox is a scoped surface
 *   a reflection               §28 the evening close
 *   a capture with an outcome  §25 Home's result row, Edit/Undo
 *   an event                   §26 search results
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
const H = (action, when, x = {}) => ({ id: `h${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
  createdAt: at(-8), updatedAt: at(-8), ...p,
});

/** §18. Long enough to wrap on a 390px viewport and to test a dense desktop row. */
const LONG_TITLE =
  "Email the graduate admissions office about the missing recommendation letter and the transcript deadline";
const LONG_PROJECT = "Clinic launch and community health outreach programme";
const LONG_GOAL = "Finish graduate school and start an independent practice";
const LONG_PERSON = "Dr. Maria Consuelo Fernández-Villanueva";

function world() {
  return {
    ...EMPTY(),
    goals: [{
      id: "g1", title: LONG_GOAL, description: "", status: "active", priority: "high",
      notes: "", tags: [], linkedWorkspaces: [], linkedKnowledge: [], horizon: "medium",
      history: [
        { id: "gh0", at: at(-60, 8), kind: "created" },
        { id: "gh1", at: at(-1, 10), kind: "horizon", fromHorizon: "near", toHorizon: "medium" },
      ],
      createdAt: at(-90), updatedAt: at(-1),
    }],
    projects: [{
      id: "p1", title: LONG_PROJECT, goalId: "g1", description: "", status: "active",
      priority: "high", notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
      createdAt: at(-90), updatedAt: at(-90),
    }],
    nextActions: [
      // §18, §19. The long one, and it is also overdue so it carries metadata.
      act({ id: "a-long", title: LONG_TITLE, projectId: "p1", dueDate: dk(-2) }),
      act({ id: "a-today", title: "Call the dentist", projectId: "p1", dueDate: dk(0), dueTime: "14:00" }),
      act({ id: "a-over", title: "Pay the application fee", projectId: "p1", dueDate: dk(-6) }),
      // §11. Two waits whose states must not read alike.
      act({ id: "a-wait-due", title: `Transcript from ${LONG_PERSON}`, projectId: "p1",
        status: "waiting", waitingOn: LONG_PERSON, waitingSince: at(-7), followUpDate: dk(0),
        history: [H("waiting", at(-7), { detail: LONG_PERSON, fromStatus: "open", toStatus: "waiting" })] }),
      act({ id: "a-wait-late", title: "Signed form from Ana", projectId: "p1",
        status: "waiting", waitingOn: "Ana", waitingSince: at(-9), followUpDate: dk(-4),
        history: [H("waiting", at(-9), { detail: "Ana", fromStatus: "open", toStatus: "waiting" })] }),
      // §19. The blocker's name is the only copy of that fact.
      act({ id: "a-blocked", title: "Open the clinic doors", projectId: "p1", dueDate: dk(1) }),
      act({ id: "a-blocker", title: "Landlord signs the lease amendment", projectId: "p1" }),
      // §33, §11. Terminal states, which are drawn differently from live work.
      act({ id: "a-stop", title: "Order the banner", projectId: "p1", status: "cancelled",
        history: [H("created", at(-8)), H("cancelled", at(-1, 9), { fromStatus: "open", toStatus: "cancelled" })] }),
      act({ id: "a-done", title: "Book the venue", projectId: "p1", status: "completed",
        completedAt: at(-1, 11),
        history: [H("created", at(-8)), H("completed", at(-1, 11), { fromStatus: "open", toStatus: "completed" })] }),
      // §19. A deferral, so the decision inbox has something to ask about.
      act({ id: "a-defer", title: "Request the second recommendation", projectId: "p1",
        status: "open", dueDate: dk(-1),
        history: [H("created", at(-30)), H("deferred", at(-9, 17)), H("deferred", at(-4, 17)),
          H("deferred", at(-1, 17))] }),
    ],
    actionDependencies: [
      { id: "d1", blockedId: "a-blocked", blockerId: "a-blocker", createdAt: at(-8) },
    ],
    events: [{
      id: "e1", title: "Interview with the admissions committee", date: dk(2),
      startTime: "14:00", allDay: false, createdAt: at(-8), updatedAt: at(-8),
    }],
    reflections: [{
      id: "r1", prompt: "What mattered today?",
      response: "The clinic finally felt real, and I stopped apologising for taking it seriously.",
      context: dk(0), createdAt: at(0, 20), updatedAt: at(0, 20),
    }],
    captures: [{
      id: "c1", text: `I'm waiting on ${LONG_PERSON} for the transcript`,
      createdAt: at(0, 10), processingStatus: "processed", processedAt: at(0, 10),
      linkedEntityRefs: [{ kind: "action", id: "a-wait-due" }],
    }],
    constitutionElements: [{
      id: "ce1", kind: "standard", status: "adopted",
      statement: "I answer messages once a day, not all day.",
      adoptedAt: at(0, 8), createdAt: at(-30), updatedAt: at(0, 8),
    }],
    constitutionRevisions: [{
      id: "cr1", elementId: "ce1", changeKind: "adopted", at: at(0, 8),
      newStatement: "I answer messages once a day, not all day.",
    }],
  };
}

module.exports = { world, DOMAINS, EMPTY, dk, at, act, H, LONG_TITLE, LONG_PROJECT, LONG_GOAL, LONG_PERSON };
