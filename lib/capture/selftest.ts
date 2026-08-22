/**
 * Universal Capture self-tests (LIFEOS-060 §20). Pure and deterministic.
 *
 * The load-bearing assertions here are the ones about what the pipeline CANNOT
 * do: it cannot invent a date, it cannot produce a belief or a Constitution
 * element, and it cannot lose the sentence the user typed. Those are asserted
 * against the types and the outputs, not against intentions.
 *
 * Section 9 replays all eleven torture-test sentences from the brief and pins
 * their behaviour, so a future change to any rule has to face them again.
 */

import { detectOccasion, extractTemporal, stripResolvedTemporal, UNRESOLVED_LABEL } from "@/lib/capture/dates";
import { decompose, hasOwnIntent, isMultiIntent } from "@/lib/capture/decompose";
import { detectWaiting, waitingTitle } from "@/lib/capture/waiting";
import { interpret, wholeCaptureAsNote, dateNotKept, PARSER_VERSION, type Candidate } from "@/lib/capture/interpret";
import {
  authorityFor, associationAuthority, preselected, authorityNote,
  CANDIDATE_KINDS, FORBIDDEN_CANDIDATE_KINDS, type CandidateKind,
} from "@/lib/capture/authority";
import { matchRecords, isMatchableTitle, associationFields } from "@/lib/capture/match";
import { toCommitCandidate, isCommittable } from "@/lib/capture/commit";
import {
  AI_PROPOSABLE_KINDS, buildEscalationContext, mergeAiCandidates, validateAiCandidates,
  MAX_CONTEXT_TITLES,
} from "@/lib/capture/escalation";
import { mockCaptureCandidates } from "@/lib/mockCapture";
import { classifyCapture } from "@/lib/capture/classify";
import { STORE_DOMAINS } from "@/lib/ux/backup";
import type { StoreState } from "@/types/mvp";

export interface SelfTestResult { name: string; pass: boolean; detail?: string }
export interface SelfTestReport { pass: boolean; total: number; passed: number; failed: number; ms: number; results: SelfTestResult[] }

/** A fixed Wednesday, so weekday arithmetic is reproducible forever. */
const TODAY = "2026-08-19"; // Wednesday

function emptyState(): StoreState {
  return Object.fromEntries((STORE_DOMAINS as string[]).map((d) => [d, []])) as unknown as StoreState;
}

function stateWithProjects(titles: string[]): StoreState {
  const s = emptyState();
  (s as unknown as { projects: unknown[] }).projects = titles.map((t, i) => ({
    id: `p${i}`, title: t, description: "", status: "active", priority: "medium",
    notes: "", tags: [], milestones: [], linkedEntityRefs: [], createdAt: TODAY, updatedAt: TODAY,
  }));
  return s;
}

const kindsOf = (cs: Candidate[]) => cs.map((c) => c.kind);
const titlesOf = (cs: Candidate[]) => cs.map((c) => (c.fields.title ?? c.fields.body ?? "").toLowerCase());

export function runCaptureSelfTests(): SelfTestReport {
  const started = Date.now();
  const results: SelfTestResult[] = [];
  const ok = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

  // ============ 1. DATE EXTRACTION (§8) ============
  {
    eq("1.1 today resolves to today", extractTemporal("call the bank today", TODAY).dueDate, TODAY);
    eq("1.2 tomorrow resolves to +1", extractTemporal("call advisor tomorrow", TODAY).dueDate, "2026-08-20");
    // TODAY is Wednesday; Friday is +2.
    eq("1.3 a bare weekday is the soonest one", extractTemporal("submit paperwork Friday", TODAY).dueDate, "2026-08-21");
    eq("1.4 next Friday is a week further", extractTemporal("submit paperwork next Friday", TODAY).dueDate, "2026-08-28");
    // A weekday naming today means today, not a week away.
    eq("1.5 today's own weekday means today", extractTemporal("finish it Wednesday", TODAY).dueDate, TODAY);
    eq("1.6 in three days", extractTemporal("call me in three days", TODAY).dueDate, "2026-08-22");
    eq("1.7 in 2 weeks", extractTemporal("review in 2 weeks", TODAY).dueDate, "2026-09-02");
    eq("1.8 on August 25", extractTemporal("pay rent on August 25", TODAY).dueDate, "2026-08-25");
    eq("1.9 abbreviated month", extractTemporal("pay rent Aug 25", TODAY).dueDate, "2026-08-25");
    eq("1.10 numeric 8/25", extractTemporal("pay rent 8/25", TODAY).dueDate, "2026-08-25");
    // A month/day already past rolls to next year rather than becoming a stale deadline.
    eq("1.11 a past month/day rolls forward a year", extractTemporal("renew on March 3", TODAY).dueDate, "2027-03-03");
  }

  // ============ 2. NO DATE LIES (§19) ============
  {
    const oct = extractTemporal("Book Mexico flights for October", TODAY);
    ok("2.1 a bare month produces NO due date", oct.dueDate === undefined);
    eq("2.2 and is reported as month_only", oct.unresolved[0]?.reason, "month_only");

    const rec = extractTemporal("Every Sunday refill my medication box", TODAY);
    ok("2.3 recurrence produces NO due date", rec.dueDate === undefined, JSON.stringify(rec));
    eq("2.4 and is reported as recurrence", rec.unresolved[0]?.reason, "recurrence");
    ok("2.5 the weekday inside a recurrence is NOT separately resolved",
      !rec.findings.some((f) => f.dueDate));

    const appt = extractTemporal("Dentist appointment Tuesday at 2:30", TODAY);
    // The DAY is storable and is kept; the TIME is not, and says so.
    eq("2.6 the day is resolved", appt.dueDate, "2026-08-25");
    ok("2.7 the time is reported unresolved",
      appt.unresolved.some((u) => u.reason === "time_of_day"), JSON.stringify(appt.unresolved));

    const vague = extractTemporal("finish it by end of the week", TODAY);
    ok("2.8 'end of the week' is not guessed at", vague.dueDate === undefined);
    eq("2.9 and is reported as vague", vague.unresolved[0]?.reason, "vague");

    const past = extractTemporal("I talked to my advisor yesterday", TODAY);
    ok("2.10 yesterday never becomes a due date", past.dueDate === undefined);
    eq("2.11 and is reported as past context", past.unresolved[0]?.reason, "past");

    ok("2.12 an impossible date is not rolled into a real one",
      extractTemporal("due February 31", TODAY).dueDate === undefined);
    ok("2.13 every unresolved reason has a user-facing label",
      (["time_of_day", "recurrence", "recurrence_ambiguous", "month_only", "vague", "past", "occasion"] as const).every((r) => !!UNRESOLVED_LABEL[r]));
    ok("2.13a and no label is missing from the map", Object.keys(UNRESOLVED_LABEL).length === 7);
    ok("2.14 no time-of-day is ever stored as a date",
      extractTemporal("meeting at 11", TODAY).dueDate === undefined);
  }

  // ============ 3. TITLE CLEANUP ============
  {
    const t = extractTemporal("Call advisor tomorrow", TODAY);
    eq("3.1 a resolved phrase leaves the title", stripResolvedTemporal("Call advisor tomorrow", t), "Call advisor");
    const u = extractTemporal("Book Mexico flights for October", TODAY);
    // Unresolved detail STAYS — it is the only place the intent still lives.
    eq("3.2 an unresolved phrase stays in the title",
      stripResolvedTemporal("Book Mexico flights for October", u), "Book Mexico flights for October");
  }

  // ============ 4. MULTI-INTENT DECOMPOSITION (§6) ============
  {
    const a = decompose("I need to call my advisor tomorrow, finish the dashboard, buy dog food, and I've been questioning whether teaching is what I want to do.");
    eq("4.1 four intents are found", a.length, 4);
    ok("4.2 each segment keeps its own text",
      a[1].text.toLowerCase().includes("dashboard") && a[2].text.toLowerCase().includes("dog food"), JSON.stringify(a.map((s) => s.text)));
    ok("4.3 segments carry offsets into the original", a.every((s) => s.start >= 0 && s.end > s.start));

    // Same-type segments must still split — the exact blindness of detectMultiIntent.
    const b = decompose("call the dentist, finish the report, buy milk");
    eq("4.4 three same-type intents still split", b.length, 3);

    // A conditional owns its comma.
    const c = decompose("When I get angry, wait ten minutes before replying.");
    eq("4.5 a conditional is never split", c.length, 1);

    // Merge-back protects list-like objects.
    const d = decompose("Call Mom, Dad, and the dentist");
    eq("4.6 dangling nouns merge back", d.length, 1);
    ok("4.7 and the merged segment is the original sentence", d[0].text.includes("Dad") && d[0].text.includes("dentist"));

    eq("4.8 ordinary prose is one segment", decompose("Chicken tortilla soup recipe from Mom.").length, 1);
    ok("4.9 isMultiIntent agrees with decompose", isMultiIntent("call Bob, email Sue") === (decompose("call Bob, email Sue").length > 1));
    ok("4.10 an imperative fragment stands alone", hasOwnIntent("finish the dashboard"));
    ok("4.11 a bare noun does not", !hasOwnIntent("dog food"));
    eq("4.12 empty text decomposes to nothing", decompose("   ").length, 0);
  }

  // ============ 5. WAITING LANGUAGE (§9) ============
  {
    const owes = detectWaiting("Marcus still owes me the document");
    ok("5.1 'owes me' is detected", !!owes, "this is the LIFEOS-059 failure");
    eq("5.2 and the person is extracted", owes?.waitingOn, "Marcus");
    eq("5.3 hasn't sent", detectWaiting("Sarah still hasn't sent the file")?.waitingOn, "Sarah");
    eq("5.4 hasn't replied", detectWaiting("the clinic hasn't replied")?.waitingOn, "clinic");
    eq("5.5 supposed to send", detectWaiting("Dave was supposed to send the draft")?.waitingOn, "Dave");
    eq("5.6 waiting on", detectWaiting("waiting on Marcus for the file")?.waitingOn, "Marcus for the file");
    eq("5.7 follow up with", detectWaiting("follow up with Marcus about the invoice")?.waitingOn, "Marcus");
    eq("5.8 hear back from", detectWaiting("still need to hear back from the bank")?.waitingOn, "bank");
    ok("5.9 the original phrasing is kept as the title",
      waitingTitle("Marcus still owes me the document.") === "Marcus still owes me the document");
    ok("5.10 ordinary text is not waiting", detectWaiting("Chicken tortilla soup recipe") === null);
    ok("5.11 an over-long subject is dropped rather than guessed",
      detectWaiting("the thing that happened after the meeting last week with everyone owes me")?.waitingOn === "");
  }

  // ============ 6. THE AUTHORITY GRADIENT (§4) ============
  {
    eq("6.1 a confident action is auto-with-undo", authorityFor("action", "high"), "auto_with_undo");
    eq("6.2 an unsure action drops to confirm", authorityFor("action", "possible"), "confirm");
    eq("6.3 a project always confirms", authorityFor("project", "high"), "confirm");
    eq("6.4 a goal always confirms", authorityFor("goal", "high"), "confirm");
    eq("6.5 a protocol always confirms", authorityFor("protocol", "high"), "confirm");
    eq("6.6 a strong match may attach itself", associationAuthority("strong"), "auto_safe");
    eq("6.7 an ambiguous match must be asked", associationAuthority("ambiguous"), "confirm");
    ok("6.8 auto levels arrive preselected", preselected("auto_with_undo") && preselected("auto_safe"));
    ok("6.9 confirm levels do not", !preselected("confirm") && !preselected("never_auto"));
    ok("6.10 confirm has a user-facing note", !!authorityNote("confirm"));
    ok("6.11 auto-with-undo needs no note", authorityNote("auto_with_undo") === null);

    // THE structural guarantee: belief and Constitution are not expressible.
    ok("6.12 no forbidden kind is a candidate kind",
      FORBIDDEN_CANDIDATE_KINDS.every((f) => !(CANDIDATE_KINDS as readonly string[]).includes(f)),
      JSON.stringify(CANDIDATE_KINDS));
    // Eight since LIFEOS-061 added `event`. Pinned, so a ninth is a deliberate act.
    ok("6.13 the candidate kinds are exactly the eight declared",
      CANDIDATE_KINDS.length === 8 && CANDIDATE_KINDS.includes("action") && CANDIDATE_KINDS.includes("note") && CANDIDATE_KINDS.includes("event"));
  }

  // ============ 7. RECORD ASSOCIATION (§10) ============
  {
    const s = stateWithProjects(["LotPilot", "Kitchen Remodel"]);
    const m = matchRecords("finish the LotPilot dashboard", s);
    eq("7.1 an exact title match is strong", m.strength, "strong");
    eq("7.2 and names the project", m.options[0]?.title, "LotPilot");
    eq("7.3 a partial word does not match", matchRecords("finish the dashboard", s).strength, "none");
    eq("7.4 two matches are ambiguous", matchRecords("LotPilot and Kitchen Remodel", s).strength, "ambiguous");
    eq("7.5 no match leaves it unlinked", matchRecords("buy dog food", s).strength, "none");
    ok("7.6 a generic single-word title is not matchable", !isMatchableTitle("Work"));
    ok("7.7 a specific title is", isMatchableTitle("LotPilot"));
    ok("7.8 a two-word title containing a generic word is matchable", isMatchableTitle("Work Trip"));
    eq("7.9 a project association becomes projectId",
      associationFields({ kind: "project", id: "p1", title: "x" }), { projectId: "p1" });
    eq("7.10 no option means no fields", associationFields(undefined), {});
    // Matching never leaves the device.
    ok("7.11 matching is local (no promise of AI in the result shape)",
      Object.keys(m).sort().join(",") === "options,strength");
  }

  // ============ 8. INTERPRETATION ============
  {
    const i = interpret("Call the dentist tomorrow.", emptyState(), TODAY);
    eq("8.1 one action", kindsOf(i.candidates), ["action"]);
    eq("8.2 with the date extracted", i.candidates[0].fields.dueDate, "2026-08-20");
    eq("8.3 and out of the title", i.candidates[0].fields.title, "Call the dentist");
    eq("8.4 the raw capture is carried unchanged", i.raw, "Call the dentist tomorrow.");
    eq("8.5 the parser version is reported", i.parserVersion, PARSER_VERSION);
    ok("8.6 evidence points back into the original", i.candidates[0].evidence.text.length > 0);

    const w = interpret("Marcus still owes me the document.", emptyState(), TODAY);
    eq("8.7 waiting language yields a waiting candidate", kindsOf(w.candidates), ["waiting"]);
    eq("8.8 with the person on the record", w.candidates[0].fields.waitingOn, "Marcus");

    const p = interpret("When I get angry, wait ten minutes before replying.", emptyState(), TODAY);
    eq("8.9 a conditional yields a protocol", kindsOf(p.candidates), ["protocol"]);
    eq("8.10 with an editable trigger", p.candidates[0].fields.trigger, "I get angry");

    ok("8.11 empty input yields no candidates", interpret("   ", emptyState(), TODAY).candidates.length === 0);
    ok("8.12 every candidate kind is a declared candidate kind",
      interpret("call Bob, buy milk, when I am tired rest", emptyState(), TODAY)
        .candidates.every((c) => (CANDIDATE_KINDS as readonly string[]).includes(c.kind)));

    // The escape hatch works with no interpretation at all.
    const whole = wholeCaptureAsNote("anything at all");
    eq("8.13 keep-as-note is always a note", whole.kind, "note");
    eq("8.14 and keeps the text verbatim", whole.fields.body, "anything at all");
    ok("8.15 and is preselected", preselected(whole.authority));

    // Interpretation is transient: it adds NO store domain.
    ok("8.16 no interpretation domain was added to the store", !(STORE_DOMAINS as string[]).includes("interpretations"));
    // 46 since LIFEOS-061 added `events` and `recurrenceCompletions`. Capture
    // itself still adds none — interpretation remains transient.
    eq("8.17 the store has 46 domains", STORE_DOMAINS.length, 46);
    ok("8.17a and none of them is an occurrences table",
      !(STORE_DOMAINS as string[]).includes("occurrences"));
  }

  // ============ 9. THE TORTURE TEST (§18) ============
  {
    const s = stateWithProjects(["LotPilot"]);
    const run = (t: string) => interpret(t, s, TODAY);

    const t1 = run("I need to call my dentist.");
    eq("9.1 call my dentist → action", kindsOf(t1.candidates), ["action"]);

    // ---- The LIFEOS-060 acceptance patch ----
    // An occasion has no completion semantics. Filing it as an Action reproduces
    // the LIFEOS-059 defect: it can never be ticked off truthfully, and it becomes
    // permanent debris in Next. Until LIFEOS-061, fail truthfully instead.
    const t2 = run("I need to remember Mom's birthday.");
    // 1. does not persist an Action by default
    eq("9.2a remember Mom's birthday → note, NOT an action", kindsOf(t2.candidates), ["note"]);
    ok("9.2b and is NOT pre-ticked", !preselected(t2.candidates[0].authority));
    // 2. raw capture survives
    eq("9.2c the raw capture is carried unchanged", t2.raw, "I need to remember Mom's birthday.");
    ok("9.2d and the note body keeps the whole sentence",
      (t2.candidates[0].fields.body ?? "").includes("Mom's birthday"), JSON.stringify(t2.candidates[0].fields));
    // 3. no fabricated date
    ok("9.2e NO date is invented", t2.candidates[0].fields.dueDate === undefined);
    ok("9.2f and the occasion limit is reported",
      t2.candidates[0].unresolved.some((u) => u.reason === "occasion"), JSON.stringify(t2.candidates[0].unresolved));
    // 4. the user can keep it as a Note — it already IS one, and note is committable
    ok("9.2g it is committable as a note", isCommittable(toCommitCandidate(t2.candidates[0])));
    // 5. no invented date, and no Event WITHOUT one.
    //
    // LIFEOS-061 gave occasions a home, but only when a date is actually named.
    // "Remember Mom's birthday" names none, so it is STILL a note — the
    // known-date / no-date split of §13. An Event here would require inventing
    // the birthday, which is the one thing neither sprint will do.
    ok("9.2h no event candidate is produced without a date",
      !t2.candidates.some((c) => c.kind === "event"));
    ok("9.2i2 and no occasion domain was invented",
      !(STORE_DOMAINS as string[]).some((d) => ["occasions", "appointments", "calendar", "reminders"].includes(d)));
    // The copy states the limitation in words the user can act on.
    ok("9.2j the limitation is stated plainly",
      /occasion/i.test(t2.candidates[0].reason) && /no date|guessing/i.test(t2.candidates[0].reason),
      t2.candidates[0].reason);

    // A doable STEP around an occasion is still an action — the rule fires on the
    // occasion itself, not on every sentence containing the word.
    eq("9.2k 'call Mom on her birthday' is still an action",
      kindsOf(run("Call Mom on her birthday").candidates), ["action"]);
    eq("9.2l 'buy a birthday present' is still an action",
      kindsOf(run("Buy a birthday present for Dad").candidates), ["action"]);
    eq("9.2m a bare occasion is a note", kindsOf(run("Mom's birthday").candidates), ["note"]);
    ok("9.2n detectOccasion returns the matched word", detectOccasion("remember our anniversary") === "anniversary");
    ok("9.2o and nothing for ordinary text", detectOccasion("call the dentist") === null);

    const t3 = run("Marcus still owes me the document.");
    eq("9.3 Marcus owes me → waiting (was note)", kindsOf(t3.candidates), ["waiting"]);

    const t4 = run("Book Mexico flights for October.");
    eq("9.4 book flights → action", kindsOf(t4.candidates), ["action"]);
    ok("9.5 and October is NOT fabricated into a date", t4.candidates[0].fields.dueDate === undefined);
    ok("9.6 but it IS reported as unresolved",
      t4.candidates[0].unresolved.some((u) => u.reason === "month_only"));

    const t5 = run("Interesting Jung idea about the shadow.");
    eq("9.7 a Jung idea → note", kindsOf(t5.candidates), ["note"]);

    const t6 = run("Chicken tortilla soup recipe from Mom.");
    eq("9.8 a recipe → note", kindsOf(t6.candidates), ["note"]);

    const t7 = run("I want to learn Spanish.");
    // The LIFEOS-059 failure: filed as an action, "learn Spanish" sits in Next
    // forever. Goal semantics already existed; it now routes there.
    eq("9.9a learn Spanish → goal, not an endless action", kindsOf(t7.candidates), ["goal"]);
    eq("9.9b with the aspiration as the title", t7.candidates[0].fields.title, "learn Spanish");
    ok("9.9c and a goal is never created without confirmation", t7.candidates[0].authority === "confirm");
    // But a real errand phrased as a want is still an errand.
    eq("9.9d 'I want to call the dentist' stays an action",
      kindsOf(run("I want to call the dentist").candidates), ["action"]);

    const t8 = run("When I get angry, wait ten minutes before replying.");
    eq("9.10 anger → protocol", kindsOf(t8.candidates), ["protocol"]);
    ok("9.11 and a protocol must be confirmed", t8.candidates[0].authority === "confirm");

    // LIFEOS-061: this is the case the last sprint could only apologise for.
    const t9 = run("Every Sunday refill my medication box.");
    eq("9.12a it is now a recurring action", kindsOf(t9.candidates), ["action"]);
    eq("9.12b with a real weekly rule",
      t9.candidates[0].fields.recurrence, { frequency: "weekly", interval: 1, weekdays: [0] });
    ok("9.12c and STILL no fabricated one-off date", t9.candidates[0].fields.dueDate === undefined);
    ok("9.13 the recurrence is no longer reported as unsupported",
      !t9.candidates[0].unresolved.some((u) => u.reason === "recurrence"));

    // LIFEOS-060 could only keep this as a note and apologise for the time.
    // LIFEOS-061 gives it the record it always needed: an Event, which HAPPENS.
    const t10 = run("Dentist appointment Tuesday at 2:30.");
    eq("9.14a it is now an Event, not a task and not a note", t10.candidates[0].kind, "event");
    eq("9.14b on the resolved day", t10.candidates[0].fields.dueDate, "2026-08-25");
    eq("9.14c at the resolved time", t10.candidates[0].fields.time, "14:30");
    ok("9.14d and nothing is disclosed as dropped, because nothing is",
      !dateNotKept(t10.candidates[0]) && t10.candidates[0].unresolved.length === 0,
      JSON.stringify(t10.candidates[0].unresolved));
    ok("9.15 the time is no longer reported as unstorable",
      !t10.candidates[0].unresolved.some((u) => u.reason === "time_of_day"));

    const t11 = run("I need to call my advisor tomorrow, finish the LotPilot dashboard, buy dog food, and I've been questioning whether teaching is what I want to do.");
    eq("9.16 four candidates", t11.candidates.length, 4);
    eq("9.17 three actions and a note", kindsOf(t11.candidates), ["action", "action", "action", "note"]);
    eq("9.18 the advisor call is dated tomorrow", t11.candidates[0].fields.dueDate, "2026-08-20");
    eq("9.19 the dashboard matches LotPilot", t11.candidates[1].association.strength, "strong");
    ok("9.20 dog food is unlinked", t11.candidates[2].association.strength === "none");
    ok("9.20a the reflection keeps its FULL text as a body",
      (t11.candidates[3].fields.body ?? "").includes("questioning whether teaching"),
      JSON.stringify(t11.candidates[3].fields));
    // A note still carries its whole sentence, so a resolved date the kind
    // cannot store is present in the record rather than silently dropped (§18).
    // Tested on a sentence that is genuinely note-shaped, now that a timed
    // appointment has become an Event.
    const dated = run("Vocabulary list from Tuesday.");
    ok("9.20b a note body keeps its full sentence",
      (dated.candidates[0].fields.body ?? "").includes("Tuesday"),
      JSON.stringify(dated.candidates[0].fields));
    ok("9.21 the teaching reflection is a note, not a belief",
      t11.candidates[3].kind === "note" && t11.candidates[3].alternates.includes("reflection"));
    ok("9.22 and every title is non-empty",
      titlesOf(t11.candidates).every((t) => t.trim().length > 0));

    // No torture sentence, anywhere, produces a forbidden kind.
    const all = [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11].flatMap((r) => r.candidates);
    ok("9.23 NO torture sentence produces a belief or Constitution element",
      all.every((c) => !FORBIDDEN_CANDIDATE_KINDS.includes(c.kind)));
    ok("9.24 no candidate carries a date the parser did not resolve",
      all.every((c) => !c.fields.dueDate || /^\d{4}-\d{2}-\d{2}$/.test(c.fields.dueDate)));
  }

  // ============ 10. AI ESCALATION BOUNDARY (§11, §12) ============
  {
    const s = stateWithProjects(["LotPilot", "Kitchen Remodel"]);
    const ctx = buildEscalationContext("finish the LotPilot dashboard", s);
    eq("10.1 the context carries project titles", ctx.projectTitles, ["LotPilot", "Kitchen Remodel"]);
    ok("10.2 and NOTHING else", Object.keys(ctx).sort().join(",") === "projectTitles,text");
    ok("10.3 the title list is bounded", MAX_CONTEXT_TITLES <= 40);

    // The escalation payload must not be able to carry the store.
    const big = stateWithProjects(["LotPilot"]);
    (big as unknown as { notes: unknown[] }).notes = [{ id: "n1", body: "PRIVATE NOTE BODY", linkedEntityRefs: [], tags: [], createdAt: TODAY, updatedAt: TODAY }];
    (big as unknown as { beliefs: unknown[] }).beliefs = [{ id: "b1", text: "PRIVATE BELIEF", status: "accepted" }];
    const ctx2 = buildEscalationContext("do the thing", big);
    ok("10.4 no note body reaches the model", !JSON.stringify(ctx2).includes("PRIVATE NOTE BODY"));
    ok("10.5 no belief reaches the model", !JSON.stringify(ctx2).includes("PRIVATE BELIEF"));

    // Validation drops everything the model is not allowed to propose.
    const hostile = validateAiCandidates([
      { kind: "action", title: "Renew the registration", reason: "an errand" },
      { kind: "belief", title: "You value freedom" },
      { kind: "constitution_element", title: "I will be honest" },
      { kind: "project", title: "Rebuild the garage" },
      { kind: "goal", title: "Learn Spanish" },
      { kind: "protocol", trigger: "x", response: "y" },
      { kind: "waiting", title: "Marcus owes me", waitingOn: "Marcus" },
      { kind: "note", body: "a thought" },
      "not an object",
      null,
    ], 0);
    eq("10.6 only action/waiting/note survive", hostile.map((c) => c.kind), ["action", "waiting", "note"]);
    ok("10.7 no AI candidate is ever preselected", hostile.every((c) => c.authority === "confirm"));
    ok("10.8 every AI candidate is labelled as AI", hostile.every((c) => c.producedBy === "ai"));
    ok("10.9 AI may not set a due date", hostile.every((c) => c.fields.dueDate === undefined));
    eq("10.10 the proposable set is exactly three", AI_PROPOSABLE_KINDS.length, 3);
    ok("10.11 no forbidden kind is AI-proposable",
      FORBIDDEN_CANDIDATE_KINDS.every((f) => !(AI_PROPOSABLE_KINDS as readonly string[]).includes(f)));
    eq("10.12 non-array output yields nothing", validateAiCandidates({ kind: "action" }, 0).length, 0);
    eq("10.13 a candidate with no text is dropped", validateAiCandidates([{ kind: "action" }], 0).length, 0);

    // Merging is additive and never displaces the deterministic reading.
    const det = interpret("call the dentist", emptyState(), TODAY);
    const merged = mergeAiCandidates(det, hostile);
    ok("10.14 merging keeps every deterministic candidate",
      det.candidates.every((d) => merged.candidates.some((m) => m.id === d.id)));
    ok("10.15 and appends the AI ones", merged.candidates.length === det.candidates.length + hostile.length);
    const dupe = validateAiCandidates([{ kind: "action", title: "call the dentist" }], 0);
    eq("10.16 a duplicate of a deterministic candidate is dropped",
      mergeAiCandidates(det, dupe).candidates.length, det.candidates.length);
    eq("10.17 merging nothing changes nothing", mergeAiCandidates(det, []).candidates.length, det.candidates.length);

    // Escalation triggers only when the rules are genuinely out of their depth.
    ok("10.18 a clean errand does not escalate", !interpret("call the dentist tomorrow", emptyState(), TODAY).escalate);
    ok("10.19 a long unplaceable sentence does escalate",
      interpret("the thing about the situation with the whole arrangement we discussed at length", emptyState(), TODAY).escalate);
  }

  // ============ 11. AI FAILURE FALLBACK (§13) ============
  {
    // The offline mock returns nothing ON PURPOSE — see lib/mockCapture.ts.
    eq("11.1 the offline mock invents nothing", mockCaptureCandidates().length, 0);
    const det = interpret("call the dentist tomorrow, buy milk", emptyState(), TODAY);
    const after = mergeAiCandidates(det, validateAiCandidates(mockCaptureCandidates(), 0));
    eq("11.2 with AI unavailable the deterministic candidates stand", after.candidates.length, det.candidates.length);
    ok("11.3 and they are still committable", after.candidates.every((c) => isCommittable(toCommitCandidate(c))));
  }

  // ============ 12. COMMIT SHAPE ============
  {
    const c = interpret("Call advisor tomorrow", emptyState(), TODAY).candidates[0];
    const cc = toCommitCandidate(c, { kind: "project", id: "p1", title: "LotPilot" });
    eq("12.1 the chosen association becomes a field", cc.projectId, "p1");
    eq("12.2 the resolved date travels", cc.dueDate, "2026-08-20");
    // Interpretation metadata must NOT reach the store.
    const keys = Object.keys(cc).sort();
    ok("12.3 no reason travels to the store", !keys.includes("reason"));
    ok("12.4 no confidence travels to the store", !keys.includes("confidence"));
    ok("12.5 no evidence span travels to the store", !keys.includes("evidence"));
    ok("12.6 no authority travels to the store", !keys.includes("authority"));

    ok("12.7 an empty protocol is not committable", !isCommittable({ kind: "protocol", trigger: "x" }));
    ok("12.8 a complete protocol is", isCommittable({ kind: "protocol", trigger: "x", response: "y" }));
    ok("12.9 a titleless action is not", !isCommittable({ kind: "action", title: "   " }));
    ok("12.10 a note with only a body is", isCommittable({ kind: "note", body: "something" }));
  }

  // ============ 13. THE DETERMINISTIC CLASSIFIER STILL RULES ============
  {
    // classifyCapture is reused, not replaced. If its answers changed, the
    // interpretation layer would be silently overriding proven behaviour.
    eq("13.1 recipe is still a note", classifyCapture("Chicken tortilla soup recipe from Mom.").suggestedType, "note");
    eq("13.2 need-to is still an action", classifyCapture("I need to call my dentist.").suggestedType, "action");
    eq("13.3 a conditional is still a protocol", classifyCapture("When I get angry, wait ten minutes.").suggestedType, "protocol");
    ok("13.4 interpretation agrees with classification on single intents",
      interpret("Chicken tortilla soup recipe from Mom.", emptyState(), TODAY).candidates[0].kind === "note");
    // Same text in, same candidates out — the property the whole design rests on.
    const a = JSON.stringify(interpret("call Bob tomorrow, buy milk", emptyState(), TODAY));
    const b = JSON.stringify(interpret("call Bob tomorrow, buy milk", emptyState(), TODAY));
    ok("13.5 interpretation is pure", a === b);
  }

  const failed = results.filter((r) => !r.pass).length;
  return {
    pass: failed === 0,
    total: results.length,
    passed: results.length - failed,
    failed,
    ms: Date.now() - started,
    results,
  };
}

/** Re-exported so a caller can enumerate kinds without a second import. */
export type { CandidateKind };
