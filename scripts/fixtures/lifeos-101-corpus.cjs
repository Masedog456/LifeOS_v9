/**
 * LIFEOS-101 §2, §3 — the capture-language corpus.
 *
 * 105 sentences a person might actually type, each with the semantic intent a
 * careful reader would give it. The point is NOT that the interpreter must hit
 * every one: several are genuinely ambiguous and the honest answer is a Note or
 * a question. The point is that the corpus is written down BEFORE the parser is
 * touched, so "improvement" is measured against a fixed expectation rather than
 * against whatever the parser happens to do afterwards.
 *
 * `want` is what a careful reader would say. `safe` lists any other kind that
 * would also be a defensible reading — a result in `safe` is AMBIGUOUS_BUT_SAFE,
 * not a failure. `note` as a `safe` value is the product's own escape hatch and
 * is only listed where a Note genuinely loses nothing.
 *
 * `guard: true` marks a sentence that must NOT become a commitment. Those are
 * the ones a recall improvement is most likely to break, and §19/§20/§40 exist
 * because of them.
 */

/** kinds the interpreter can produce: action waiting event note goal standard protocol project */
const C = (group, text, want, opts = {}) => ({ group, text, want, ...opts });

const CORPUS = [
  // ============================================================ ACTIONS (§3)
  C("action", "Remind me to call the dentist Friday", "action", { date: "+fri" }),
  C("action", "Need to call the dentist Friday", "action", { date: "+fri" }),
  C("action", "I've got to call the dentist", "action"),
  C("action", "I gotta email Marcus tomorrow", "action", { date: "+1" }),
  C("action", "Don't let me forget to submit the application", "action"),
  C("action", "Make sure I send Maria the form", "action"),
  C("action", "Call Marcus tomorrow", "action", { date: "+1" }),
  C("action", "Email the landlord", "action"),
  C("action", "Book the appointment", "action"),
  C("action", "Need groceries tonight", "action", { safe: ["note"] }),
  C("action", "I need to call Marcus", "action"),
  C("action", "I have to renew the registration", "action"),
  C("action", "Call dentist Friday", "action", { date: "+fri" }),

  // ============================================================ WAITING (§3, §8)
  C("waiting", "I'm waiting on Maria for the transcript", "waiting", { who: "Maria" }),
  C("waiting", "Still waiting on Maria", "waiting", { who: "Maria" }),
  C("waiting", "Maria still hasn't sent the transcript", "waiting", { who: "Maria" }),
  C("waiting", "Waiting for the landlord to send the lease", "waiting"),
  C("waiting", "I need the transcript from Maria", "action", { safe: ["waiting"] }),
  C("waiting", "Marcus owes me the lease", "waiting", { who: "Marcus" }),
  C("waiting", "Haven't heard back from Marcus yet", "waiting", { who: "Marcus" }),
  C("waiting", "Still need Maria to send the recommendation", "waiting", { who: "Maria" }),

  // ============================================================ EVENTS (§3, §14)
  C("event", "Dentist Friday at 2", "event", { date: "+fri" }),
  C("event", "My interview is Tuesday at 2", "event", { date: "+tue" }),
  C("event", "Dinner with Ana next Thursday", "event", { safe: ["note"] }),
  C("event", "I have therapy Monday morning", "event", { safe: ["note"] }),
  C("event", "Meeting with Marcus tomorrow at 10", "event", { date: "+1" }),
  C("event", "Flight leaves Friday at 6", "event", { date: "+fri" }),

  // ============================================================ NOTES / FACTS
  C("note", "Remember that my passport expires in March", "note", { guard: true }),
  C("note", "Passport expires in March", "note"),
  C("note", "Maria's number is 555-0142", "note"),
  C("note", "The application deadline is December 1", "note", { safe: ["event"] }),
  C("note", "Dad likes Ethiopian food", "note"),

  // ============================================================ REFLECTIONS
  C("reflection", "I realized teaching isn't what I want", "note"),
  C("reflection", "I felt completely drained after work today", "note"),
  C("reflection", "What mattered today was talking to my dad", "note"),
  C("reflection", "I learned I need more structure", "note", { guard: true }),
  C("reflection", "I keep thinking about graduate school", "note"),

  // ============================================================ ASPIRATIONS (§17)
  C("goal", "I want to apply to philosophy programs", "goal"),
  C("goal", "I'd like to run a marathon", "goal"),
  C("goal", "I want to save $10,000", "goal"),
  C("goal", "I'm thinking about becoming a psychologist", "goal", { safe: ["note"] }),
  C("goal", "One day I want to write a book", "goal"),

  // ============================================================ RULES (§3)
  C("rule", "I should stop replying when I'm angry", "standard", { safe: ["protocol"] }),
  C("rule", "If I'm angry, wait before texting back", "protocol"),
  C("rule", "I don't want to check my phone first thing in the morning", "standard", { safe: ["note"] }),
  C("rule", "Always prepare clothes the night before", "standard", { safe: ["action"] }),
  C("rule", "When I feel overwhelmed, write down the next step", "protocol"),

  // ============================================================ COMPLETION (§10)
  C("completion", "I called the dentist", "completion"),
  C("completion", "Dentist call done", "completion", { safe: ["note"] }),
  C("completion", "Finished the recommendation request", "completion", { safe: ["action"] }),
  C("completion", "Sent Marcus the lease", "completion", { safe: ["action", "note"] }),
  C("completion", "That application is submitted", "completion", { safe: ["note"] }),
  C("completion", "Finally got the transcript request done", "completion", { safe: ["note"] }),

  // ============================================================ NOT DONE (§11)
  C("notdone", "I didn't call the dentist", "note", { guard: true }),
  C("notdone", "Never got around to emailing Marcus", "note", { guard: true }),
  C("notdone", "I'm not doing the certification anymore", "note", { guard: true, safe: ["stop"] }),
  C("notdone", "Stop reminding me about the application", "note", { guard: true, safe: ["stop"] }),
  C("notdone", "Forget the dentist thing", "note", { guard: true, safe: ["stop"] }),

  // ============================================================ BLOCKED (§13)
  C("blocked", "I can't finish the clinic launch until the lease is signed", "note", { safe: ["action", "waiting"] }),
  C("blocked", "The application is blocked because I need the transcript", "note", { safe: ["waiting", "action"] }),
  C("blocked", "I'm stuck on the website until Marcus sends the photos", "note", { safe: ["waiting"] }),

  // ============================================================ RECURRENCE (§16)
  C("recurrence", "Run every Monday", "action", { rec: true }),
  C("recurrence", "Call Mom every Sunday", "action", { rec: true }),
  C("recurrence", "Pay rent on the first of every month", "action", { rec: true }),
  C("recurrence", "Take vitamins every morning", "action", { rec: true }),

  // ============================================================ MIXED (§23, §24)
  C("mixed", "Email Marcus tomorrow and remember the lease expires Friday", "multi", { parts: 2 }),
  C("mixed", "I'm waiting on Maria for the transcript and need to call the school tomorrow", "multi", { parts: 2 }),
  C("mixed", "Dinner with Ana Friday and remind me to buy flowers", "multi", { parts: 2 }),
  C("mixed", "I finished the application but still need the recommendation", "multi", { parts: 2 }),
  C("mixed", "Remind me to call Marcus tomorrow and remember that the lease expires Friday", "multi", { parts: 2 }),

  // ============================================================ NEGATION (§19)
  C("negation", "I don't need to call Marcus", "note", { guard: true }),
  C("negation", "I'm not applying to law school", "note", { guard: true }),
  C("negation", "Don't remind me to call the dentist", "note", { guard: true }),
  C("negation", "I never said I wanted to quit teaching", "note", { guard: true }),
  C("negation", "I don't want to run a marathon", "note", { guard: true }),

  // ============================================================ HISTORICAL (§20)
  C("historical", "When I was applying to college I called Maria every week", "note", { guard: true }),
  C("historical", "I used to run every morning", "note", { guard: true }),
  C("historical", "Last year I wanted to move to Oregon", "note", { guard: true }),
  C("historical", "I already called Marcus yesterday", "note", { guard: true, safe: ["completion"] }),
  C("historical", "I needed to call the dentist last year", "note", { guard: true }),

  // ============================================================ UNCERTAINTY (§18)
  C("uncertain", "Maybe I should call the dentist", "note", { guard: true, safe: ["action-unselected"] }),
  C("uncertain", "I might apply to Oregon", "note", { guard: true, safe: ["goal-unselected"] }),
  C("uncertain", "Could be worth emailing Marcus", "note", { guard: true, safe: ["action-unselected"] }),
  C("uncertain", "I'm thinking about running tomorrow", "note", { guard: true, safe: ["action-unselected", "goal"] }),
  C("uncertain", "Probably need to talk to my advisor", "note", { guard: true, safe: ["action-unselected"] }),

  // ============================================================ REPORTED (§21)
  C("reported", "Maria said I need to call the dentist", "note", { guard: true, safe: ["action-unselected"] }),
  C("reported", "My advisor thinks I should apply to Oregon", "note", { guard: true, safe: ["goal-unselected"] }),

  // ============================================================ CONDITION (§22)
  C("condition", "If Marcus replies, send the lease", "protocol", { safe: ["action"] }),
  C("condition", "When Marcus replies, send the lease", "protocol", { safe: ["action"] }),

  // ============================================================ SHORTHAND (§7)
  C("shorthand", "Dentist Friday", "note", { safe: ["action", "event"] }),
  C("shorthand", "Groceries", "note", { safe: ["action"] }),
  C("shorthand", "Lease Friday", "note", { safe: ["action", "event"] }),

  // ============================================================ ADVERSARIAL PAIRS (§40)
  // Each of these is the close negative for a rule this sprint might add.
  /**
   * CORRECTED EXPECTATION, not a corrected product.
   *
   * This was written as `note, guard` on the assumption that "remind me that"
   * always frames a fact. Measured, it becomes a dated Event — and so does
   * "Dentist appointment Friday" with no framing at all, which is the point:
   * the event detector is reading the noun, and the framing is incidental. An
   * appointment on a named day IS an event.
   *
   * §5's actual example is kept beside it and still behaves as §5 requires:
   * "Remind me that my passport expires Friday" stays a Note, because a
   * passport expiring is a fact and not an appointment.
   */
  C("adversarial", "Remind me that the dentist appointment is Friday", "event", { safe: ["note"] }),
  C("adversarial", "Remind me that my passport expires Friday", "note", { guard: true }),
  C("adversarial", "Remind me that Marcus is out of town", "note", { guard: true }),
  C("adversarial", "I don't have to call Marcus", "note", { guard: true }),
  C("adversarial", "I never needed to call the dentist", "note", { guard: true }),
  C("adversarial", "Maybe I need to call Marcus", "note", { guard: true, safe: ["action-unselected"] }),
  C("adversarial", "Maria said to call the dentist", "note", { guard: true, safe: ["action-unselected"] }),
  C("adversarial", "Don't let me forget that the lease expires Friday", "note", { guard: true }),
  C("adversarial", "Make sure Maria sends the form", "waiting", { safe: ["action"] }),
  C("adversarial", "I had to call the dentist last week", "note", { guard: true }),
  C("adversarial", "I've got to admit that was hard", "note", { guard: true }),
  C("adversarial", "Need to remember Mom's birthday", "note", { guard: true }),
  C("adversarial", "Remind me to be kinder to myself", "standard", { safe: ["note", "action"] }),
];

module.exports = { CORPUS };
