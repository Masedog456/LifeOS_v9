/**
 * A deterministic seven-day dogfood script (LIFEOS-063 §7–§14).
 *
 * ## What this is, and what it is deliberately not
 *
 * This is a FIXTURE, not a feature. It ships no UI, no route, no store domain
 * and no migration. It exists so the question "does the executive loop hold
 * together across a week?" can be asked the same way twice, by a person or by
 * CI, instead of being re-answered from memory each time someone clicks around.
 *
 * It is explicitly NOT telemetry (§6). Nothing here observes a real user,
 * nothing is written to the product, and no code path in the running app reads
 * this file. The evidence it produces is a printed trace and a set of
 * assertions — the two forms §6 allows.
 *
 * ## Why a fixed week
 *
 * Every day below names an absolute date in a fixed week — Monday 2026-03-02
 * through Sunday 2026-03-08. Ordinary life is written in relative words
 * ("tomorrow", "Thursday", "every Tuesday"), and those words only resolve to
 * the same dates twice if the anchor never moves. A replay anchored to the
 * machine's clock would quietly change what it was testing every day, which is
 * the opposite of a regression fixture.
 *
 * 2026 is not a leap year and 2026-03-02 is a Monday. Both matter: the
 * recurrence rules in Day 3 are weekday-based, and February's length is what
 * makes monthly-31 skipping observable.
 *
 * ## The one thing this fixture cannot pin
 *
 * `createdAt`, `completedAt` and `waitingSince` come from the store's own
 * clock, which is the real one. That is a property of the product, not of this
 * script, and it is left alone rather than mocked — a fixture that stubs the
 * clock stops testing the code that reads it. The consequence is stated where
 * it bites (`ALSO_TODAY_NOTE`) instead of being papered over.
 */

import type { DayKey } from "@/lib/reviews/dates";
import type { LocalTime } from "@/lib/time/localtime";
import type { DeferOption } from "@/lib/actions/defer";
import type { CandidateKind } from "@/lib/capture/authority";

/**
 * One thing the user does.
 *
 * `capture` is typing a sentence into the box on `/`. Everything else is a
 * control the product already offers on an action — completing it, deferring
 * it, marking it waiting, closing one occurrence of a recurring source,
 * stopping the recurrence, declaring a dependency, or filing something under a
 * project. Nothing in this list reaches past the UI into the store.
 */
export type DogfoodStep =
  /** Type a sentence and confirm what comes back. */
  | {
      do: "capture";
      text: string;
      /** Candidate indexes the user unticks before confirming. */
      drop?: number[];
      /** Candidates the user re-kinds via the "Or:" row, without retyping. */
      switchTo?: { index: number; kind: CandidateKind }[];
      /** What the user was actually trying to do. Read in the report, not asserted. */
      intent: string;
    }
  | { do: "complete"; match: string }
  | { do: "completeOccurrence"; match: string; on: DayKey }
  | { do: "stopRecurrence"; match: string; from: DayKey }
  | { do: "defer"; match: string; option: DeferOption }
  | { do: "waitOn"; match: string; person: string; followUp?: DayKey }
  | { do: "blocks"; blocker: string; blocked: string }
  | { do: "project"; title: string }
  | { do: "fileUnder"; match: string; project: string };

export interface DogfoodDay {
  day: number;
  date: DayKey;
  /** Wall clock the day is looked at. Drives NOW and event proximity. */
  now: LocalTime;
  label: string;
  /** The brief section this day answers. */
  brief: string;
  /**
   * Start from an empty store rather than carrying the week forward.
   * Day 6 needs this: "seed very little" cannot be tested on top of five days
   * of accumulated life.
   */
  freshStore?: boolean;
  steps: DogfoodStep[];
}

/** Monday of the fixed week. Everything else is stated absolutely. */
export const WEEK_START: DayKey = "2026-03-02";
export const WEEK_END: DayKey = "2026-03-08";

/**
 * What the fixed week cannot see, and why the live-anchor pass exists.
 *
 * Three product behaviours read a stored timestamp rather than the date they
 * are asked about, and all three come out wrong when the scripted week and the
 * machine clock disagree:
 *
 *  - `alsoToday` compares `createdAt` to the day being viewed.
 *  - `waitingDays` measures from `waitingSince`.
 *  - a recurring action's occurrence anchors to `dueDate ?? createdAt`, so a
 *    rule captured "today" produces its first occurrence near the real today,
 *    not near the scripted day.
 *
 * None of that is a defect — each is the product correctly reading a real
 * timestamp. It is a limit of a fixed-date fixture, so `replayDogfood` takes an
 * `anchor` and the live pass runs the same script starting from the real today,
 * where the two clocks agree. Anything that fails under BOTH passes is a
 * product finding; anything that only fails under the fixed week is this note.
 */
export const CLOCK_SENSITIVE_BEHAVIOURS: readonly string[] = [
  "alsoToday (createdAt vs the viewed day)",
  "waitingDays (waitingSince)",
  "recurring occurrence anchor (dueDate ?? createdAt)",
];

// ---------------------------------------------------------------- day 1 ----

const DAY_1: DogfoodDay = {
  day: 1,
  date: "2026-03-02",
  now: "08:40",
  label: "Messy intake",
  brief: "§8 — one sentence carrying five different intents",
  steps: [
    {
      do: "capture",
      intent:
        "Dump everything on my mind at once: an appointment, tonight's work, an errand, a call, and a worry.",
      text:
        "I have class tomorrow at 11, need to finish the deployment tonight, buy dog food, call my advisor, and I'm still unsure whether teaching is the right direction.",
    },
    {
      do: "capture",
      intent: "An errand with a deadline later this week.",
      text: "Return the library books by Thursday",
    },
    {
      do: "capture",
      intent: "A household thing with no date at all.",
      text: "Replace the kitchen tap washer",
    },
  ],
};

// ---------------------------------------------------------------- day 2 ----

const DAY_2: DogfoodDay = {
  day: 2,
  date: "2026-03-03",
  now: "18:15",
  label: "Real-time change",
  brief: "§9 — completion, a miss, a wait, a move, and a reminder request",
  steps: [
    // The user does the one thing the product supports directly: ticks it off.
    { do: "complete", match: "deployment" },
    {
      do: "capture",
      intent:
        "Report the day back in one breath — including two things (rescheduling, a reminder) I have no idea whether Conqify can do.",
      text:
        "I finished deployment. I didn't work out. Marcus still hasn't sent the document. Move the workout forward and remind me I need to email my professor tomorrow.",
    },
  ],
};

// ---------------------------------------------------------------- day 3 ----

const DAY_3: DogfoodDay = {
  day: 3,
  date: "2026-03-04",
  now: "07:05",
  label: "Recurrence",
  brief: "§10 — recurring action, recurring event, one completion, one stop",
  steps: [
    {
      do: "capture",
      intent: "A standing responsibility I do not want to re-enter every week.",
      text: "Take out the recycling every Wednesday at 7",
    },
    {
      do: "capture",
      intent: "A standing meeting that happens whether or not I do anything.",
      text: "Team standup every weekday at 9:15",
    },
    {
      // Daily on purpose. A weekly rule only lands on Today one day in seven,
      // so under the live anchor it would usually prove nothing; a daily one
      // asks to be done on whichever day the replay is actually run.
      do: "capture",
      intent: "The one standing thing I genuinely cannot afford to forget.",
      text: "Take my medication every day at 8",
    },
    {
      do: "capture",
      intent: "A habit I am trying to hold.",
      text: "Go to the gym every Tuesday and Thursday at 6:30",
    },
    // One occurrence closed. The standing source must survive it.
    { do: "completeOccurrence", match: "recycling", on: "2026-03-04" },
    // A standing responsibility that has ended. History must survive that too.
    { do: "stopRecurrence", match: "gym", from: "2026-03-04" },
  ],
};

// ---------------------------------------------------------------- day 4 ----

const DAY_4: DogfoodDay = {
  day: 4,
  date: "2026-03-05",
  now: "09:30",
  label: "Waiting and blocked work",
  brief: "§11 — a project, a dependency, a wait, and a follow-up that has come due",
  steps: [
    { do: "project", title: "Thesis chapter" },
    {
      do: "capture",
      intent: "Two steps on the thesis, in the order they have to happen.",
      // Both dated on purpose. Today only surfaces a blocked action once it has
      // a deadline — a blocked thing with no date is not risk, it is just later
      // — so an undated second step would leave §11's central question ("is
      // blocked work kept out of the way?") untested rather than answered.
      text: "Draft the methods section by Friday. Send the chapter to my advisor by Sunday.",
    },
    { do: "fileUnder", match: "methods section", project: "Thesis chapter" },
    { do: "fileUnder", match: "chapter to my advisor", project: "Thesis chapter" },
    // The second step cannot start until the first is done.
    { do: "blocks", blocker: "methods section", blocked: "chapter to my advisor" },
    // The wait from Day 2 gets a follow-up date that has now arrived.
    { do: "waitOn", match: "document", person: "Marcus", followUp: "2026-03-05" },
    // Pushed to tomorrow, so Day 5 can show whether a deferred thing comes back
    // or quietly disappears.
    { do: "defer", match: "dog food", option: { date: "2026-03-06" } },
  ],
};

// ---------------------------------------------------------------- day 5 ----

const DAY_5: DogfoodDay = {
  day: 5,
  date: "2026-03-06",
  now: "11:20",
  label: "Dense day",
  brief: "§12 — a full day, asked one question: what should I do next?",
  steps: [
    { do: "project", title: "House move" },
    { do: "project", title: "Fitness" },
    {
      do: "capture",
      intent: "Three unrelated obligations that all landed today.",
      text:
        "Pick up the prescription today, book the removal van, and pay the council tax by Monday.",
    },
    {
      do: "capture",
      intent: "An appointment this afternoon and one this evening.",
      text: "Physio appointment today at 2",
    },
    {
      do: "capture",
      intent: "Dinner, which is not a task.",
      text: "Dinner with Sam tonight at 7:30",
    },
    { do: "fileUnder", match: "removal van", project: "House move" },
    {
      do: "capture",
      intent: "Something I am waiting on from a second person.",
      text: "Still waiting on Priya for the quote",
    },
    // EXPECTED TO FAIL, and kept for that reason.
    //
    // "Replace the kitchen tap washer" was typed on Day 1 and did not become an
    // action, so on Day 5 there is nothing to defer. The failure is the finding:
    // it shows what a missed classification costs four days later, rather than
    // on the day it happened. If capture improves, this step starts succeeding
    // and the assertion covering it fails — which is the point.
    { do: "defer", match: "kitchen tap", option: { date: "2026-03-09" } },
  ],
};

// ---------------------------------------------------------------- day 6 ----

const DAY_6: DogfoodDay = {
  day: 6,
  date: "2026-03-07",
  now: "10:00",
  label: "Quiet day",
  brief: "§13 — almost nothing recorded; does Today invent work?",
  freshStore: true,
  steps: [
    {
      do: "capture",
      intent: "One passing thought on a Saturday. Nothing else.",
      text: "The garden needs looking at some time",
    },
  ],
};

// ---------------------------------------------------------------- day 7 ----

const DAY_7: DogfoodDay = {
  day: 7,
  date: "2026-03-08",
  now: "19:00",
  label: "Review the week",
  brief: "§14 — six questions asked of the surfaces that already exist",
  steps: [],
};

/**
 * The six questions Day 7 asks. Answered against the CURRENT surfaces only —
 * §14 forbids building autobiographical memory in this sprint, so the point is
 * to find out precisely which of these the product can already answer.
 */
export const WEEK_QUESTIONS: readonly string[] = [
  "What did I complete?",
  "What remains open?",
  "What am I waiting on?",
  "What happened this week?",
  "What did I defer?",
  "What changed in my projects?",
];

export const SCENARIO: readonly DogfoodDay[] = [DAY_1, DAY_2, DAY_3, DAY_4, DAY_5, DAY_6, DAY_7];

/**
 * The eight capture shapes §19 asks to be measured, isolated from the week.
 *
 * Kept separate from `SCENARIO` on purpose: the week measures whether the loop
 * holds, and these measure one sentence at a time against a clean store, so a
 * failure points at the parser rather than at five days of accumulated state.
 */
export interface CaptureProbe {
  id: string;
  label: string;
  text: string;
}

export const CAPTURE_PROBES: readonly CaptureProbe[] = [
  { id: "A", label: "one obligation", text: "Email the landlord about the boiler" },
  { id: "B", label: "one appointment", text: "Dentist Thursday at 2:30" },
  { id: "C", label: "one recurring item", text: "Water the plants every Sunday" },
  { id: "D", label: "one waiting item", text: "Marcus owes me the signed lease" },
  {
    id: "E",
    label: "mixed four-intent sentence",
    text: "Book the MOT, call the vet tomorrow, pick up the parcel, and chase Priya about the quote",
  },
  { id: "F", label: "reflection", text: "I've been feeling stretched thin since the move" },
  { id: "G", label: "ambiguous input", text: "the thing with the car" },
  { id: "H", label: "unknown time phrase", text: "Sort out the insurance sometime in the autumn" },
];
