/**
 * LIFEOS-101 — natural capture language, asserted.
 *
 * Every sentence runs through the REAL `interpret` against a real store, for
 * the reason LIFEOS-095's and LIFEOS-096's suites do: the claim is about what
 * the pipeline does with ordinary wording, and a fixture that called the new
 * regexes directly would be asserting the claim about itself.
 *
 * ## How this file is organised, and why
 *
 * §40 asks for adversarial pairs, and the shape of the file IS the pairing:
 * every recall assertion sits directly beside the negation, historical,
 * uncertainty and reported-speech variants of the same sentence. A rule and its
 * guards drifting apart is the failure mode this sprint could most easily
 * cause, and reading them together is what makes that visible.
 *
 * ## What "safe" means here
 *
 * A guard passes when the sentence produces no CONSEQUENTIAL auto-writable
 * record — no Action, Waiting, Event or Goal at `auto`/`auto_with_undo`. It does
 * not require a Note specifically: an unselected suggestion the person can
 * accept is a fine answer to "maybe I should call the dentist", and demanding a
 * Note would pin behaviour §18 deliberately leaves open.
 */

import type { StoreState } from "@/types/mvp";
import { emptyStoreState } from "@/lib/ux/backup";
import { interpret, type Candidate } from "@/lib/capture/interpret";
import { detectStance, opensWithPastVerb } from "@/lib/capture/stance";
import { detectWaiting } from "@/lib/capture/waiting";

const T = "2026-09-07";
const D = (k: string, h = 9) => `${k}T${String(h).padStart(2, "0")}:00:00.000Z`;

interface Result { name: string; pass: boolean; detail?: string }

function world(): StoreState {
  const s = emptyStoreState();
  s.projects = [{
    id: "p1", title: "Clinic launch", description: "", status: "active", priority: "medium",
    notes: "", milestones: [], relatedDocuments: [], relatedEntities: [],
    createdAt: D("2026-06-01"), updatedAt: D("2026-06-01"),
  }] as StoreState["projects"];
  s.nextActions = [
    { id: "a-dentist", title: "Call the dentist", description: "", status: "open", notes: "",
      linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 1, history: [], projectId: "p1",
      createdAt: D("2026-09-01"), updatedAt: D("2026-09-01") },
    { id: "a-wait", title: "Transcript from Maria", description: "", status: "waiting", notes: "",
      linkedEntityRefs: [], tags: [], estimatedSize: "unspecified", energy: "unspecified",
      order: 2, history: [], projectId: "p1", waitingOn: "Maria", waitingSince: D("2026-09-01"),
      createdAt: D("2026-09-01"), updatedAt: D("2026-09-01") },
  ] as StoreState["nextActions"];
  return s;
}

const AUTO = ["auto", "auto_with_undo"];
const CONSEQUENTIAL = ["action", "waiting", "event", "goal"];

const read = (text: string, s: StoreState = world()): Candidate[] =>
  interpret(text, s, T).candidates ?? [];
const first = (text: string) => read(text)[0];

/** Did the sentence produce a consequential record that writes itself? */
const commits = (text: string): Candidate | undefined =>
  read(text).find((c) => CONSEQUENTIAL.includes(c.kind) && AUTO.includes(c.authority));

const desc = (c?: Candidate) =>
  c ? `${c.kind}/${c.confidence}/${c.authority} "${c.fields.title ?? c.fields.body ?? ""}"` : "(none)";

export function runCaptureLanguageSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  // =====================================================================
  // FIX C — commitment framing (§5, §6)
  // =====================================================================
  //
  // Every one of these was a Note before LIFEOS-101, and the title assertion
  // matters as much as the kind: §27 says the errand is the verb phrase, not the
  // framing, and it comes from the rule that already knew that.
  for (const [text, title, why] of [
    ["Remind me to call the dentist Friday", "call the dentist", "§5's headline case"],
    ["Don't let me forget to submit the application", "submit the application", "the negative framing that is a positive request"],
    ["Make sure I send Maria the form", "send Maria the form", "self-directed assurance"],
    ["I've got to call the dentist", "call the dentist", "the spoken register of 'I have to'"],
    ["I gotta email Marcus tomorrow", "email Marcus", "the same, contracted further"],
    ["Remember to call the dentist", "call the dentist", "the rule this extends — unchanged"],
  ] as const) {
    const c = first(text);
    ok(`101.1 §5 ${why}`,
      c?.kind === "action" && c.fields.title === title, `${desc(c)} — wanted action "${title}"`);
  }

  // §15. The date is handed to the existing temporal parser, not re-parsed.
  {
    const c = first("Remind me to call the dentist Friday");
    ok("101.2 §15 the reminder's date comes from the existing parser",
      c?.fields.dueDate === "2026-09-11", `dueDate=${c?.fields.dueDate}`);
    const t = first("I gotta email Marcus tomorrow");
    ok("101.3 §15 …and so does a contracted obligation's",
      t?.fields.dueDate === "2026-09-08", `dueDate=${t?.fields.dueDate}`);
  }

  // ---- §5's distinction: REMIND ME TO + action vs REMIND ME THAT + fact ----
  for (const [text, why] of [
    ["Remind me that my passport expires Friday", "§5's own counter-example"],
    ["Remind me that my passport expires in March", "the same without a resolvable day"],
    ["Remind me that Marcus is out of town", "a fact about a person"],
    ["Don't let me forget that the lease expires Friday", "the 'that' form of the negative framing"],
  ] as const) {
    ok(`101.4 §5 a fact is not an errand — ${why}`,
      !commits(text), desc(commits(text)));
  }

  // ---- §19 negation: every new opener, negated ----------------------------
  for (const [text, why] of [
    ["Don't remind me to call the dentist", "the reminder rule, refused"],
    ["I don't need to call Marcus", "the obligation rule, refused"],
    ["I don't have to call Marcus", "the same, other auxiliary"],
    ["I never said I wanted to quit teaching", "a reported non-statement"],
    ["I'm not applying to law school", "a declined intention"],
  ] as const) {
    ok(`101.5 §19 no commitment from a negation — ${why}`,
      !commits(text), desc(commits(text)));
  }

  // ---- §20 historical: every new opener, in the past ----------------------
  for (const [text, why] of [
    ["I needed to call the dentist last year", "'needed', not 'need'"],
    ["I had to call the dentist last week", "'had', not 'have'"],
    ["I got to meet him yesterday", "bare 'got to' is past, not obligation"],
    ["I got to see the clinic finally", "the same, no date"],
    ["Last year I wanted to move to Oregon", "a past want"],
  ] as const) {
    ok(`101.6 §20 no commitment from the past — ${why}`,
      !commits(text), desc(commits(text)));
  }

  // ---- §18 uncertainty and §21 reported speech ---------------------------
  for (const [text, why] of [
    ["Maybe I need to call Marcus", "hedged obligation"],
    ["Maybe I should call the dentist", "hedged intention"],
    ["Probably need to talk to my advisor", "hedged, no subject"],
    ["Maria said I need to call the dentist", "someone else's account of an obligation"],
    ["Maria said to call the dentist", "someone else's instruction"],
    ["My advisor thinks I should apply to Oregon", "someone else's opinion"],
  ] as const) {
    ok(`101.7 §18, §21 uncertainty and reported speech do not commit — ${why}`,
      !commits(text), desc(commits(text)));
  }

  // ---- the two false positives this sprint introduced and then fixed ------
  //
  // Both were found by the guard corpus while the fixes were being written, and
  // both are pinned here so they cannot come back.
  {
    const c = first("I've got to admit that was hard");
    ok("101.8 a non-errand remainder does not make the new opener an Action",
      c?.kind !== "action", desc(c));
    ok("101.9 …and 'I have to admit that was hard' is a KNOWN pre-existing gap, not a regression",
      first("I have to admit that was hard")?.kind === "action",
      `if this fails the gap was fixed elsewhere and 101.8's asymmetry can go: ${desc(first("I have to admit that was hard"))}`);

    const k = first("Remind me to be kinder to myself");
    ok("101.10 §29 a disposition asked for as a reminder is not an errand",
      k?.kind !== "action", desc(k));
    ok("101.11 …the same list still guards the rule it came from",
      first("I should be more patient")?.kind !== "action", desc(first("I should be more patient")));

    ok("101.12 §8 nobody waits on themselves",
      detectWaiting("I never sent Marcus the lease") === null
      && first("I never sent Marcus the lease")?.kind !== "waiting",
      desc(first("I never sent Marcus the lease")));
    ok("101.13 …and an ordinary wait is untouched",
      first("Maria still hasn't sent the transcript")?.fields.waitingOn === "Maria",
      desc(first("Maria still hasn't sent the transcript")));
  }

  // ---- §8 someone else's action is not the user's errand -----------------
  ok("101.14 §8 'Make sure Maria sends the form' is not a self-commitment",
    !commits("Make sure Maria sends the form"), desc(commits("Make sure Maria sends the form")));

  // =====================================================================
  // FIX A — a standing commitment needs a standing stance
  // =====================================================================
  for (const [text, why] of [
    ["When I was applying to college I called Maria every week", "the measured case"],
    ["When I was in school I ran every morning", "the same frame, different verb"],
    ["Back when I was training I went to the gym every Tuesday", "'back when'"],
    ["While I was interning I emailed my mentor every Friday", "'while'"],
  ] as const) {
    const c = commits(text);
    ok(`101.15 §20 a past narrative is not a recurring commitment — ${why}`,
      !c || !c.fields.recurrence, desc(c));
  }
  for (const [text, why] of [
    ["Run every Monday", "the plain recurring errand"],
    ["Call Mom every Sunday", "with an object"],
    ["Pay rent on the first of every month", "monthly"],
  ] as const) {
    const c = first(text);
    ok(`101.16 §16 an asserted recurring errand is unchanged — ${why}`,
      c?.kind === "action" && !!c.fields.recurrence, desc(c));
  }
  ok("101.17 a recurring EVENT is still an event, not caught by the stance guard",
    first("Staff meeting every Tuesday at 10")?.kind === "event",
    desc(first("Staff meeting every Tuesday at 10")));

  // =====================================================================
  // FIX B — "never" before a past-tense verb is a report, not a rule
  // =====================================================================
  for (const [text, why] of [
    ["Never got around to emailing Marcus", "the measured case"],
    ["I never needed to call the dentist", "'needed'"],
    ["I never sent Marcus the lease", "'sent'"],
  ] as const) {
    ok(`101.18 §11 a report of something undone is not a rule — ${why}`,
      first(text)?.kind !== "standard", desc(first(text)));
  }
  // The half that must NOT change: "never" is genuinely normative language, and
  // trimming the marker list rather than fixing the stance would have lost these.
  for (const [text, why] of [
    ["I never say no to my kids", "present habitual"],
    ["I never check email before nine", "present habitual with a time"],
    ["Never lie to make myself look better", "imperative, no subject"],
    ["I should never reply when I'm angry", "explicitly normative"],
  ] as const) {
    ok(`101.19 §12 a standing rule with 'never' is unchanged — ${why}`,
      first(text)?.kind === "standard", desc(first(text)));
  }
  // The tense test itself, since two modules now depend on it.
  ok("101.20 the past-tense test moved, and still answers the same way",
    ["got", "sent", "needed", "called", "tried"].every((w) => opensWithPastVerb(w))
    && ["need", "feed", "speed", "say", "check"].every((w) => !opensWithPastVerb(w)));
  ok("101.21 the past time-frame is a past stance",
    detectStance("When I was applying to college I called Maria every week").stance === "past"
    && detectStance("When Marcus replies I will send the lease").stance === "asserted");

  // =====================================================================
  // FIX D — mixed intent survives the new openers (§23, §24)
  // =====================================================================
  for (const [text, kinds, why] of [
    ["Email Marcus tomorrow and remember the lease expires Friday", "action,note", "an errand and a fact"],
    ["Dinner with Ana Friday and remind me to buy flowers", "event,action", "an event and an errand"],
    ["Remind me to call Marcus tomorrow and remember that the lease expires Friday", "action,note", "both new openers at once"],
  ] as const) {
    const cs = read(text);
    ok(`101.22 §24 a new opener does not swallow the rest of the sentence — ${why}`,
      cs.map((c) => c.kind).join(",") === kinds, cs.map(desc).join(" | "));
  }
  // The merge-back guard the cut depends on. Widening where we CUT is only safe
  // while a fragment that cannot stand alone still rejoins.
  for (const [text, why] of [
    ["Buy milk and bread", "a conjoined object, not two errands"],
    ["Move the sofa and the chair to the garage", "the same, longer"],
  ] as const) {
    ok(`101.23 §24 an ordinary conjunction is still one thing — ${why}`,
      read(text).length === 1, `${read(text).length} candidates`);
  }

  // =====================================================================
  // §28 raw source, §25 the rest of the pipeline
  // =====================================================================
  {
    const texts = [
      "Remind me to call the dentist Friday", "I gotta email Marcus tomorrow",
      "Don't let me forget to submit the application", "Make sure I send Maria the form",
      "When I was applying to college I called Maria every week",
      "Never got around to emailing Marcus",
    ];
    ok("101.24 §28 interpretation never rewrites the raw capture",
      texts.every((t) => interpret(t, world(), T).raw === t));
    /**
     * §25. A newly recognised errand still reaches record association.
     *
     * Two wrong versions of this assertion were written before the right one,
     * and both are worth recording because each was wrong in a different way.
     *
     * The first asserted `association !== null`. `NO_MATCH` is an object, so
     * that is true of every candidate the pipeline has ever produced — a
     * decoration that could not fail. tsc rejected it too: `MatchResult` has
     * `strength` and `options`, no `kind`.
     *
     * The second asserted that "Remind me to call the dentist Friday" matches
     * the stored Action "Call the dentist". It failed, and the failure was the
     * assertion's: `matchRecords` scans PROJECTS, GOALS and WORKSPACES. It is
     * the context association, not a duplicate detector for actions — the exact
     * string "Call the dentist" matches nothing either, framing or no framing.
     *
     * So this asserts what §25 actually asks: the new opener does not bypass
     * the association, and a sentence naming a project still finds it.
     */
    const named = first("Remind me to draft the Clinic launch brochure Friday");
    ok("101.25 §25 a newly recognised Action still reaches context association",
      named?.association?.strength === "strong"
      && (named?.association?.options ?? []).some((o) => o.id === "p1"),
      `strength=${named?.association?.strength} options=${JSON.stringify((named?.association?.options ?? []).map((o) => o.id))}`);
    // The control: association is doing work, not matching everything.
    ok("101.26 …and a sentence naming no project finds none",
      first("Remind me to book the venue Friday")?.association?.strength === "none",
      `strength=${first("Remind me to book the venue Friday")?.association?.strength}`);
    // §26's actual duplicate protection, for the path that has one.
    ok("101.27 §26 waiting duplicate protection is unaffected by the new rules",
      !!detectWaiting("Still waiting on Maria for the transcript"),
      "the open wait must still be found so 089 can offer it");
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
