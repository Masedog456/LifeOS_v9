/**
 * LIFEOS-104 §2, §57 — the twenty audit worlds, and the torture world.
 *
 * §2 names twenty states a real person's Today can be in. Each `WORLDS` entry
 * is the smallest store that genuinely produces one of them, so that when the
 * audit says "on a quiet day Today shows X" the claim is about a state the
 * product can actually reach rather than about a store contrived to make a
 * section render.
 *
 * `torture()` is §57's single large world: every record shape in the brief, in
 * one store, with DETERMINISTIC timestamps. Days are expressed as offsets from
 * a fixed anchor rather than from `Date.now()`, so the same fixture produces the
 * same view tomorrow — a torture world whose overdue action silently becomes
 * due-today overnight tests something different every day it is run.
 */

const DOMAINS = ["captures","proposals","beliefs","sources","feedback","comparisons","inquiries","megathreads","reflections","practices","reviews","reasonings","embeddings","decisions","formationSessions","concepts","conceptRelationships","principles","frameworks","knowledgeProjects","researchProjects","dialogueSessions","tensions","syntheses","recommendations","documents","citations","workspaces","sessions","goals","projects","dailyReviews","nextActions","actionDependencies","actionTemplates","planningAssignments","focusSessions","maintenanceEvents","duplicateCandidates","savedInsightViews","notes","protocols","constitutionElements","constitutionRevisions","events","recurrenceCompletions"];
const EMPTY = () => Object.fromEntries(DOMAINS.map((d) => [d, []]));

/**
 * The fixed anchor. Every date below is an offset from this day, and `ANCHOR`
 * is what the probe passes as `today` — so "overdue by two days" stays overdue
 * by two days forever (§57).
 */
const ANCHOR = "2026-09-07"; // a Monday

/** ANCHOR + n days, as a DayKey. */
function dk(n = 0) {
  const d = new Date(`${ANCHOR}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ANCHOR + n days at hour h, as an ISO instant. */
const at = (n = 0, h = 9, m = 0) =>
  `${dk(n)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

let hn = 0;
const H = (action, when, x = {}) => ({ id: `h${++hn}`, action, at: when, ...x });

const act = (p) => ({
  description: "", status: "open", notes: "", linkedEntityRefs: [], tags: [],
  estimatedSize: "unspecified", energy: "unspecified", order: 1, history: [],
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
const event = (p) => ({
  allDay: false, createdAt: at(-10), updatedAt: at(-10), ...p,
});
/** A wait, with the history entry the change engines read. */
const waiting = (p) => act({
  status: "waiting", waitingSince: at(-7),
  history: [H("waiting", at(-7), { detail: p.waitingOn, fromStatus: "open", toStatus: "waiting" })],
  ...p,
});
/** An action deferred `n` times, the last one landing on `until`. */
const deferred = (id, title, times, until, extra = {}) => act({
  id, title, status: "deferred", deferredUntil: until,
  history: Array.from({ length: times }, (_, i) =>
    H("deferred", at(-14 + i * 3, 10), { fromStatus: "open", toStatus: "deferred", detail: until })),
  ...extra,
});

// ---------------------------------------------------------------------------
// The twenty worlds (§2). Each is the SMALLEST store that reaches its state.
// ---------------------------------------------------------------------------

const WORLDS = {
  /** A. Quiet day — live work exists, nothing dated, nothing overdue. */
  A: () => ({ ...EMPTY(), nextActions: [
    act({ id: "a1", title: "Sort the bookshelf" }),
    act({ id: "a2", title: "Look into a new bike lock" }),
  ] }),

  /** B. One clear next Action — a single dated, executable item. */
  B: () => ({ ...EMPTY(), nextActions: [
    act({ id: "b1", title: "Call the dentist", dueDate: dk(0) }),
  ] }),

  /** C. Several due Actions — four things dated today, one of them timed. */
  C: () => ({ ...EMPTY(), nextActions: [
    act({ id: "c1", title: "Send the invoice", dueDate: dk(0) }),
    act({ id: "c2", title: "Renew the parking permit", dueDate: dk(0) }),
    act({ id: "c3", title: "Confirm the caterer", dueDate: dk(0), dueTime: "16:00" }),
    act({ id: "c4", title: "Return the library books", dueDate: dk(0) }),
  ] }),

  /** D. Overdue Action — due four days ago, alongside ordinary live work. */
  D: () => ({ ...EMPTY(), nextActions: [
    act({ id: "d1", title: "File the insurance claim", dueDate: dk(-4) }),
    act({ id: "d2", title: "Tidy the garage" }),
  ] }),

  /** E. Waiting follow-up due — the date has arrived. §12. */
  E: () => ({ ...EMPTY(), nextActions: [
    waiting({ id: "e1", title: "Transcript", waitingOn: "Maria", followUpDate: dk(0) }),
    act({ id: "e2", title: "Draft the personal statement" }),
  ] }),

  /** F. Waiting with NO follow-up — §13's whole question. */
  F: () => ({ ...EMPTY(), nextActions: [
    waiting({ id: "f1", title: "Quote", waitingOn: "Priya", waitingSince: at(-21) }),
    act({ id: "f2", title: "Draft the personal statement" }),
  ] }),

  /** G. Blocked high-value work, with an executable blocker. §14, §43. */
  G: () => ({ ...EMPTY(),
    projects: [project({ id: "pg", title: "Clinic launch" })],
    nextActions: [
      act({ id: "g-blocked", title: "Install the reception desk", projectId: "pg", dueDate: dk(0) }),
      act({ id: "g-blocker", title: "Get lease approval", projectId: "pg" }),
    ],
    actionDependencies: [{ id: "dg", blockedId: "g-blocked", blockerId: "g-blocker", createdAt: at(-10) }],
  }),

  /** H. Recurring Action due today. §23. */
  H: () => ({ ...EMPTY(), nextActions: [
    act({ id: "h1", title: "Take the medication", dueTime: "08:00",
      recurrence: { frequency: "daily", interval: 1 } }),
    act({ id: "h2", title: "Water the plants",
      recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [1] } }),
  ] }),

  /** I. Event-heavy day — four fixed-time obligations and one thing to do. §21. */
  I: () => ({ ...EMPTY(),
    events: [
      event({ id: "i1", title: "Standup", date: dk(0), startTime: "09:00", endTime: "09:15" }),
      event({ id: "i2", title: "Advisor meeting", date: dk(0), startTime: "11:00", endTime: "12:00" }),
      event({ id: "i3", title: "Dentist", date: dk(0), startTime: "14:00", endTime: "14:45" }),
      event({ id: "i4", title: "Parents' evening", date: dk(0), allDay: true }),
    ],
    nextActions: [act({ id: "i5", title: "Print the consent form", dueDate: dk(0) })],
  }),

  /** J. Goal with no path — judgment, not work. §17. */
  J: () => ({ ...EMPTY(),
    goals: [
      goal({ id: "j-none", title: "Learn to sail" }),
      goal({ id: "j-path", title: "Apply to graduate school" }),
    ],
    nextActions: [act({ id: "j1", title: "Request the recommendation", goalId: "j-path" })],
  }),

  /** K. Project with no next Action. §18. */
  K: () => ({ ...EMPTY(),
    projects: [
      project({ id: "k-empty", title: "Clinic lease" }),
      project({ id: "k-live", title: "Clinic launch" }),
    ],
    nextActions: [act({ id: "k1", title: "Draft the brochure", projectId: "k-live" })],
  }),

  /** L. Repeated deferrals — three recorded deferrals, back today. §20. */
  L: () => ({ ...EMPTY(), nextActions: [
    deferred("l1", "Do the tax return", 3, dk(0)),
    act({ id: "l2", title: "Book the MOT" }),
  ] }),

  /** M. Multiple Decision Inbox items — goal-no-path, deferral, long wait. §19. */
  M: () => ({ ...EMPTY(),
    goals: [goal({ id: "m-g1", title: "Learn to sail" }), goal({ id: "m-g2", title: "Run a half marathon" })],
    nextActions: [
      deferred("m1", "Do the tax return", 3, dk(0)),
      waiting({ id: "m2", title: "Signed lease", waitingOn: "Ana", waitingSince: at(-30), followUpDate: dk(-2) }),
      act({ id: "m3", title: "Draft the personal statement" }),
    ],
  }),

  /** N. Yesterday had meaningful changes — finished, stopped waiting, changed direction. §26. */
  N: () => ({ ...EMPTY(),
    nextActions: [
      act({ id: "n1", title: "Book the venue", status: "completed", completedAt: at(-1, 15),
        updatedAt: at(-1, 15),
        history: [H("created", at(-9)), H("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
      act({ id: "n2", title: "Deposit receipt", status: "open", waitingOn: "Ana", updatedAt: at(-1, 16),
        history: [H("waiting", at(-8), { detail: "Ana", fromStatus: "open", toStatus: "waiting" }),
          H("unblocked", at(-1, 16), { fromStatus: "waiting", toStatus: "open" })] }),
      act({ id: "n3", title: "Fit out the treatment room", updatedAt: at(-1, 17),
        history: [H("created", at(-9)),
          H("rescheduled", at(-1, 17), { detail: dk(6), fromStatus: "open", toStatus: "open" })] }),
      act({ id: "n4", title: "Chase the surveyor" }),
    ],
  }),

  /** O. Nothing due, but meaningful open work exists. §38. */
  O: () => ({ ...EMPTY(),
    projects: [project({ id: "po", title: "Clinic launch" })],
    goals: [goal({ id: "go", title: "Open the clinic" })],
    nextActions: [
      act({ id: "o1", title: "Write the lease summary", projectId: "po" }),
      act({ id: "o2", title: "Shortlist three contractors", projectId: "po" }),
      act({ id: "o3", title: "Read the licensing guidance" }),
    ],
  }),

  /** P. Work with FUTURE due dates only. §37. */
  P: () => ({ ...EMPTY(), nextActions: [
    act({ id: "p1", title: "Submit the Oregon application", dueDate: dk(24) }),
    act({ id: "p2", title: "Renew the passport", dueDate: dk(40) }),
  ] }),

  /** Q. Mixed personal and work commitments on the same day. */
  Q: () => ({ ...EMPTY(),
    projects: [project({ id: "pq", title: "Clinic launch" })],
    events: [event({ id: "q-e", title: "Sports day", date: dk(0), startTime: "13:30", endTime: "15:00" })],
    nextActions: [
      act({ id: "q1", title: "Send the contractor quote", projectId: "pq", dueDate: dk(0) }),
      act({ id: "q2", title: "Buy a birthday present", dueDate: dk(0) }),
      act({ id: "q3", title: "Collect the prescription" }),
      waiting({ id: "q4", title: "Invoice", waitingOn: "the accountant", followUpDate: dk(0) }),
    ],
  }),

  /** R. Recently completed work, and nothing much else. §39. */
  R: () => ({ ...EMPTY(), nextActions: [
    act({ id: "r1", title: "Book the venue", status: "completed", completedAt: at(0, 8), updatedAt: at(0, 8),
      history: [H("created", at(-6)), H("completed", at(0, 8), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "r2", title: "Pay the deposit", status: "completed", completedAt: at(-1, 14), updatedAt: at(-1, 14),
      history: [H("created", at(-6)), H("completed", at(-1, 14), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "r3", title: "Send the thank-you note" }),
  ] }),

  /** S. Empty / new user — literally nothing recorded. §9. */
  S: () => ({ ...EMPTY() }),

  /** T. Noisy store — 100+ records of every kind, generated deterministically. */
  T: () => noisy(),

  /** §57's torture world. Not one of the twenty; the state every red is proved in. */
  TORTURE: () => torture(),
};

/** T. 120 actions, 12 events, 8 projects, 6 goals — deterministic, no randomness. */
function noisy() {
  const s = { ...EMPTY() };
  s.goals = Array.from({ length: 6 }, (_, i) => goal({ id: `ng${i}`, title: `Goal ${i}` }));
  s.projects = Array.from({ length: 8 }, (_, i) =>
    project({ id: `np${i}`, title: `Project ${i}`, goalId: `ng${i % 6}` }));
  const acts = [];
  for (let i = 0; i < 120; i++) {
    const p = `np${i % 8}`;
    const mod = i % 10;
    if (mod === 0) acts.push(act({ id: `na${i}`, title: `Overdue item ${i}`, projectId: p, dueDate: dk(-((i % 5) + 1)) }));
    else if (mod === 1) acts.push(act({ id: `na${i}`, title: `Due today item ${i}`, projectId: p, dueDate: dk(0) }));
    else if (mod === 2) acts.push(waiting({ id: `na${i}`, title: `Waiting item ${i}`, projectId: p,
      waitingOn: `Person ${i % 7}`, waitingSince: at(-(i % 20) - 1),
      followUpDate: i % 20 === 0 ? dk(0) : undefined }));
    else if (mod === 3) acts.push(act({ id: `na${i}`, title: `Future item ${i}`, projectId: p, dueDate: dk((i % 30) + 1) }));
    else if (mod === 4) acts.push(act({ id: `na${i}`, title: `Done item ${i}`, projectId: p, status: "completed",
      completedAt: at(-(i % 6), 12), updatedAt: at(-(i % 6), 12),
      history: [H("completed", at(-(i % 6), 12), { fromStatus: "open", toStatus: "completed" })] }));
    else if (mod === 5) acts.push(deferred(`na${i}`, `Deferred item ${i}`, (i % 3) + 1, dk((i % 4) - 1), { projectId: p }));
    else if (mod === 6) acts.push(act({ id: `na${i}`, title: `Recurring item ${i}`, projectId: p,
      recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [i % 7] } }));
    else acts.push(act({ id: `na${i}`, title: `Open item ${i}`, projectId: p }));
  }
  s.nextActions = acts;
  s.actionDependencies = Array.from({ length: 10 }, (_, i) => ({
    id: `nd${i}`, blockedId: `na${i * 10}`, blockerId: `na${i * 10 + 7}`, createdAt: at(-20),
  }));
  s.events = Array.from({ length: 12 }, (_, i) => event({
    id: `ne${i}`, title: `Meeting ${i}`, date: dk(i % 4),
    startTime: `${String(8 + (i % 9)).padStart(2, "0")}:00`, endTime: `${String(9 + (i % 9)).padStart(2, "0")}:00`,
  }));
  s.notes = Array.from({ length: 20 }, (_, i) => ({
    id: `nn${i}`, title: `Note ${i}`, body: `Note ${i}`, tags: [], createdAt: at(-(i % 10)), updatedAt: at(-(i % 10)),
  }));
  return s;
}

/**
 * §57. One world holding every shape in the brief's list.
 *
 * The ids say what each row is FOR, because the audit reads this world's output
 * far more often than it reads this function.
 */
function torture() {
  const s = { ...EMPTY() };
  s.goals = [
    goal({ id: "g-nopath", title: "Learn to sail" }),               // §17 judgment
    goal({ id: "g-path", title: "Open the clinic" }),               // carried by a project
  ];
  s.projects = [
    project({ id: "p-next", title: "Clinic launch", goalId: "g-path" }),
    project({ id: "p-nonext", title: "Clinic lease", goalId: "g-path" }),
  ];
  s.nextActions = [
    // ---- dated work ------------------------------------------------------
    act({ id: "t-overdue", title: "File the insurance claim", projectId: "p-next", dueDate: dk(-4) }),
    act({ id: "t-duetoday", title: "Send the contractor quote", projectId: "p-next", dueDate: dk(0) }),
    act({ id: "t-timed", title: "Confirm the caterer", dueDate: dk(0), dueTime: "16:00" }),
    act({ id: "t-future", title: "Submit the Oregon application", dueDate: dk(24) }),
    act({ id: "t-undated", title: "Write the lease summary", projectId: "p-next" }),
    // ---- waiting ---------------------------------------------------------
    waiting({ id: "t-wait-due", title: "Transcript", waitingOn: "Maria", followUpDate: dk(0) }),
    waiting({ id: "t-wait-none", title: "Quote", waitingOn: "Priya", waitingSince: at(-21) }),
    // ---- blocking --------------------------------------------------------
    act({ id: "t-blocked", title: "Install the reception desk", projectId: "p-next", dueDate: dk(0) }),
    act({ id: "t-blocker", title: "Get lease approval", projectId: "p-next" }),
    // ---- recurrence ------------------------------------------------------
    act({ id: "t-recurring", title: "Take the medication", dueTime: "08:00",
      recurrence: { frequency: "daily", interval: 1 } }),
    // ---- deferral --------------------------------------------------------
    deferred("t-deferred", "Sort the loft", 1, dk(9)),          // §40 not today
    deferred("t-repeated", "Do the tax return", 3, dk(0)),      // §20 repeated, back today
    // ---- since yesterday -------------------------------------------------
    act({ id: "t-completed", title: "Book the venue", status: "completed", completedAt: at(-1, 15),
      updatedAt: at(-1, 15),
      history: [H("created", at(-9)), H("completed", at(-1, 15), { fromStatus: "open", toStatus: "completed" })] }),
    act({ id: "t-unwaited", title: "Deposit receipt", updatedAt: at(-1, 16),
      history: [H("waiting", at(-8), { detail: "Ana", fromStatus: "open", toStatus: "waiting" }),
        H("unblocked", at(-1, 16), { fromStatus: "waiting", toStatus: "open" })] }),
    act({ id: "t-redirected", title: "Fit out the treatment room", projectId: "p-next", updatedAt: at(-1, 17),
      history: [H("created", at(-9)),
        H("rescheduled", at(-1, 17), { detail: dk(6), fromStatus: "open", toStatus: "open" })] }),
  ];
  s.actionDependencies = [
    { id: "t-d1", blockedId: "t-blocked", blockerId: "t-blocker", createdAt: at(-10) },
  ];
  s.events = [
    event({ id: "t-ev", title: "Advisor meeting", date: dk(0), startTime: "11:00", endTime: "12:00" }),
    event({ id: "t-ev-next", title: "Interview", date: dk(2), startTime: "14:00", endTime: "15:00" }),
  ];
  // §46. A conditional rule, in the user's own words, adopted before today.
  s.constitutionElements = [{
    id: "t-rule", kind: "standard", status: "adopted",
    statement: "I answer messages once a day, not all day.",
    adoptedAt: at(-30, 8), createdAt: at(-40), updatedAt: at(-30, 8),
  }];
  s.captures = [{
    id: "t-cap", text: "waiting on Priya for the quote",
    createdAt: at(-21, 10), processingStatus: "processed", processedAt: at(-21, 10),
    linkedEntityRefs: [{ kind: "action", id: "t-wait-none" }],
  }];
  return s;
}

/** What each world is named for, for the audit table. */
const LABELS = {
  A: "quiet day", B: "one clear next Action", C: "several due Actions", D: "overdue Action",
  E: "waiting follow-up due", F: "waiting, no follow-up", G: "blocked high-value work",
  H: "recurring Action due today", I: "Event-heavy day", J: "Goal with no path",
  K: "Project with no next Action", L: "repeated deferrals", M: "multiple Decision Inbox items",
  N: "yesterday had meaningful changes", O: "nothing due, meaningful open work",
  P: "future due dates only", Q: "mixed personal/work", R: "recently completed work",
  S: "empty / new user", T: "noisy store, 100+ records", TORTURE: "§57 torture world",
};

module.exports = { WORLDS, LABELS, ANCHOR, dk, at, act, goal, project, event, waiting, deferred, H, EMPTY, DOMAINS, torture, noisy };
