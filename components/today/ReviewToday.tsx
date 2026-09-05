"use client";

/**
 * Review today — the day closed from evidence, not from a form (LIFEOS-091).
 *
 * ## Why this is not the `/daily` wizard
 *
 * `/daily` is a seven-step flow that asks for wins, lessons, friction, open
 * loops and tomorrow's focus, and saves a `DailyReview` record. That is
 * journaling, it is optional, and it stays exactly where it is. But it cannot be
 * the default way to find out what happened today, because it requires the user
 * to type the answer to a question the store can already answer.
 *
 * ## What LIFEOS-091 changed here
 *
 * The page used to render `buildDailyExecutiveView` in six sections and printed
 * every completion twice — once under "Completed today" and again under
 * "Changed today", because `COMPLETION_KINDS` is a subset of `CHANGE_KINDS`. It
 * also showed six of the twelve changes LIFEOS-081 can prove for the same day,
 * had no Goal movement, no carry-forward, and spoke in weeks ("in this period",
 * "not a complete record of your week") on a page about one day.
 *
 * It now renders `buildEveningClose` in §5's five sections — DONE, CHANGED,
 * STILL OPEN, IN YOUR OWN WORDS, TOMORROW — each omitted when empty, with the
 * two tomorrow concepts kept structurally apart (§14) and carry-forward
 * requiring an explicit press (§16).
 *
 * ## What it refuses to say
 *
 *   "Your day is complete"  — evening is a time, not a verdict (§22)
 *   "You did nothing today" — a quiet day is a fact about records (§24)
 *   "Great job"             — this is a memory surface, not an evaluation (§36)
 *   "You attended X"        — nothing records attendance
 *   any narrative at all    — facts are summarized; prose is never generated (§22)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, addReflection } from "@/lib/mvpStore";
import { buildTodayIndexes } from "@/lib/today/indexes";
import {
  buildEveningClose, deferralLine, movementLine, eveningHeading, previousDay,
  EVENING_CHANGE_LABEL,
  QUIET_DAY, MEMORY_PROMPT, MEMORY_PROMPT_HINT, CARRY_FORWARD_NOTE,
  TOMORROW_SCHEDULED_HEADING, CARRY_FORWARD_HEADING,
  type CarryCandidate,
} from "@/lib/today/evening";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import { planReplan, applyReplan } from "@/lib/planning/replan";
import { storeReplanOps } from "@/components/planning/replanOps";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import { formatLocalTime } from "@/lib/time/localtime";
import { formatDayKey, todayKey, addDays } from "@/lib/reviews/dates";
import { toast } from "@/lib/ux/feedback";

const metaClass = "shrink-0 text-[11px] text-zinc-500";
const rowClass = "flex items-baseline justify-between gap-3 py-1";
const chip =
  "rounded-full border border-black/[.12] px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";

function Block({ title, show, children, id }: {
  title: string; show: boolean; children: React.ReactNode; id: string;
}) {
  if (!show) return null;
  return (
    <section data-review-section={id} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

export default function ReviewToday({ initialDate }: { initialDate?: string } = {}) {
  const state = useStore();
  const today = todayKey();
  /**
   * The day under review. Existing date keys, not a new window.
   *
   * LIFEOS-092 §7, §17: it starts from `?date=` when there is one, so a past day
   * has an address. That was the single thing the old `/daily/[date]` route did
   * better than this one, and it is the reason `/daily/[date]` can redirect here
   * without losing anything.
   */
  const [date, setDate] = useState(initialDate ?? today);
  const ix = useMemo(() => buildTodayIndexes(state, date), [state, date]);
  const c = useMemo(
    () => buildEveningClose(state, ix, { date, today }),
    [state, ix, date, today],
  );

  /** §20. Optional. Empty is a complete answer. */
  const [memory, setMemory] = useState("");
  const [saved, setSaved] = useState(false);

  /**
   * §16, §17, and LIFEOS-090 §33. The user presses; LIFEOS-090 decides.
   *
   * This called `deferAction` directly at first, and the browser proved what
   * that costs: carrying "Reply from Marcus" set `status: "deferred"` while
   * `waitingOn: "Marcus"` stayed on the record — the wait orphaned, the person
   * still owed a reply, and the record gone from every surface that asks what
   * you are waiting on. That is 090's RED 1 exactly, reintroduced on a new
   * surface by a second mutation path, which is the thing 090 §33 warned about.
   *
   * `planReplan` already knows a wait cannot be pushed and already offers the
   * honest alternative: keep waiting, follow up tomorrow. So the button asks it
   * rather than deciding for itself, and reports what actually happened.
   */
  function carry(f: CarryCandidate) {
    // `today`, not `date`: a carry taken while reading Friday's review still
    // lands on the day after TODAY. Passing the reviewed day would schedule
    // work into a day that has already gone.
    const plan = planReplan(state, [f.item.entity.id], { kind: "defer", option: "tomorrow" }, ix, today);
    if (plan.proposals.length > 0) {
      const outcome = applyReplan(plan.proposals, storeReplanOps);
      toast({ kind: outcome.applied > 0 ? "success" : "info", message: outcome.message });
      return;
    }
    // §19 of 090: an exception carries its own way forward, and the user takes
    // it explicitly. Here the press IS that explicit act — but on the honest
    // operation, and the message says which one it was.
    const ex = plan.exceptions[0];
    if (ex?.instead) {
      const outcome = applyReplan([ex.instead], storeReplanOps);
      toast({ kind: "info", message: `${ex.note} ${outcome.message}` });
      return;
    }
    toast({ kind: "info", message: ex?.note ?? `${f.item.title} can't move to a day.` });
  }

  function remember() {
    const text = memory.trim();
    if (!text) return;
    // §21. The existing reflection path, with the prompt kept as the prompt so
    // provenance survives: this is the user's answer to a question, not a
    // "daily diary" record type invented for this surface.
    addReflection({ prompt: MEMORY_PROMPT, response: text, context: date });
    setMemory("");
    setSaved(true);
    toast({ kind: "success", message: "Saved to your reflections." });
  }

  /**
   * §18. Where a carry actually lands.
   *
   * `planReplan(…, { option: "tomorrow" })` resolves against the CURRENT day,
   * not the reviewed one — correctly, since you cannot schedule work into a day
   * that has already passed. So the label follows the behaviour rather than the
   * page you happen to be reading.
   */
  const carryTarget = addDays(today, 1);
  const carryLabel = c.isToday ? "Carry to tomorrow" : `Carry to ${formatDayKey(carryTarget)}`;

  const hasDone = c.completed.length > 0 || c.waitingResolved.length > 0 || c.movedForward.length > 0;
  const hasChanged = c.changed.length > 0 || c.deferred.length > 0
    || c.rescheduled.length > 0 || c.changedDirection.length > 0;
  const hasOpen = c.stillOpen.length > 0 || c.waitingOpen.length > 0;
  const hasTomorrow = c.tomorrowScheduled.length > 0 || c.carryForward.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <header>
        {/* "Review" — a thing you can do, not a state the day is in (§22). */}
        {/* §37. `Review {heading.toLowerCase()}` printed "Review friday, sep 4":
            lowercasing a formatted date to make one word fit broke every other
            word. The two cases are just different sentences. */}
        <h1 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {c.isToday ? "Review today" : `Review ${eveningHeading(c)}`}
        </h1>
        <p className="mt-0.5 text-[11px] text-zinc-500">{formatDayKey(c.date)}</p>

        {/* §23. Counts. Never an evaluation, and absent when there is nothing
            to count — a line of zeroes is an appraisal wearing arithmetic. */}
        {c.quiet ? (
          <p data-review-quiet className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{QUIET_DAY}</p>
        ) : c.calmSummary ? (
          <p data-review-summary className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{c.calmSummary}</p>
        ) : null}

        {/* §26. Existing date keys, one day at a time. No rolling window. */}
        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" data-review-prev onClick={() => setDate(previousDay(date))} className={chip}>
            ← {formatDayKey(previousDay(date), { weekday: "long" })}
          </button>
          {date < today && (
            <button type="button" data-review-next onClick={() => setDate(addDays(date, 1))} className={chip}>
              {addDays(date, 1) === today ? "Today" : formatDayKey(addDays(date, 1), { weekday: "long" })} →
            </button>
          )}
        </div>
      </header>

      {/* ---- 1. DONE (§6, §7, §12, §28) ----------------------------------- */}
      <Block title="Done" id="done" show={hasDone}>
        {c.movedForward.length > 0 && (
          <>
            <h3 className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Moved forward</h3>
          <ul data-review-moved className="mb-3 flex flex-col gap-0.5">
            {c.movedForward.map((m) => (
              <li key={m.goal.id} data-review-movement={m.goal.id} className={rowClass}>
                <Link href={`/goal/${m.goal.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {m.goal.title}
                </Link>
                {/* §28. A count of records. No momentum, no percentage. */}
                <span className={metaClass}>{movementLine(m)}</span>
              </li>
            ))}
          </ul>
          </>
        )}
        {c.completed.length + c.waitingResolved.length > 0 && c.movedForward.length > 0 && (
          <h3 className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Completed</h3>
        )}
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {c.completed.map((e) => (
            <li key={`${e.recordRef.id}:${e.kind}`} data-review-completed className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>
                {e.kind === "recurring_completion" ? "Done for the day" : "Completed"}
              </span>
            </li>
          ))}
          {/* §6, §12. A wait that ended is something that finished, not a
              "change" — and the person it was on is part of the fact. */}
          {c.waitingResolved.map((e) => (
            <li key={`resolved:${e.entity.id}`} data-review-waiting-resolved className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>
                {e.detail ? `Stopped waiting on ${e.detail}` : "Stopped waiting"}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {/* ---- 2. CHANGED (§8, §9, §10) ------------------------------------- */}
      <Block title="Changed" id="changed" show={hasChanged}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {/* §9. Deferred and rescheduled are never pooled under "postponed". */}
          {c.deferred.map((d) => (
            <li key={`def:${d.change.entity.id}`} data-review-deferred className="py-1">
              <div className={rowClass}>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{d.change.title}</span>
                <span className={metaClass}>Deferred</span>
              </div>
              {/* §10. Inline, factual, and only once the count supports it —
                  never a warning wall. */}
              {d.repeated && (
                <p data-review-repeated className="text-[11px] text-zinc-500">{deferralLine(d)}</p>
              )}
            </li>
          ))}
          {c.rescheduled.map((e) => (
            <li key={`res:${e.entity.id}`} data-review-rescheduled className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>Date changed{e.detail ? ` · ${e.detail}` : ""}</span>
            </li>
          ))}
          {/* §8. Direction, and never called progress. The arrow appears only
              when the history actually recorded both ends of the transition. */}
          {c.changedDirection.map((e) => (
            <li key={`dir:${e.id}`} data-review-direction={e.kind} className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>
                {EVENING_CHANGE_LABEL[e.kind] ?? e.kind}
                {e.from && e.to ? ` · ${e.from} → ${e.to}` : ""}
              </span>
            </li>
          ))}
          {c.changed.map((e) => (
            <li key={`chg:${e.id}`} data-review-changed={e.kind} className={rowClass}>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{e.title}</span>
              <span className={metaClass}>
                {EVENING_CHANGE_LABEL[e.kind] ?? e.kind}{e.detail ? ` · ${e.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {/* ---- 3. STILL OPEN (§11, §12, §13, §17) --------------------------- */}
      <Block title="Still open" id="still-open" show={hasOpen}>
        <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
          {c.stillOpen.map((a) => (
            <li key={a.id} data-review-open={a.kind} className="py-1">
              <div className={rowClass}>
                <Link href={`/actions/${a.entity.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {a.title}
                </Link>
                {/* §13. The blocker is named by the shortlist's own sentence. */}
                <span className={metaClass}>{a.explanation}</span>
              </div>
              {/* §17. The same resolver every other surface uses. No
                  closure-specific mutations were invented for this page. */}
              {a.entity.kind === "action" && (
                <ResolutionControls title={a.title}
                  actions={resolutionsForAction(state, a.entity.id, { today: date, ix })} />
              )}
            </li>
          ))}
          {/* §12. Still waiting, structurally apart from the waits that ended. */}
          {c.waitingOpen.map((w) => (
            <li key={`wait:${w.action.id}`} data-review-waiting className="py-1">
              <div className={rowClass}>
                <Link href={`/actions/${w.action.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                  {w.action.title}
                </Link>
                <span className={metaClass}>
                  {w.waitingOn ? `Waiting on ${w.waitingOn}` : "Waiting"}
                  {/* §12. The recorded follow-up date, and nothing about what
                      the other person owes anyone. */}
                  {w.followUpDate ? ` · follow up ${formatDayKey(w.followUpDate)}` : ""}
                </span>
              </div>
              <ResolutionControls title={w.action.title}
                actions={resolutionsForAction(state, w.action.id, { today: date, ix })} />
            </li>
          ))}
        </ul>
        {c.waitingMore > 0 && (
          <p data-review-waiting-more className="mt-1 text-[11px] text-zinc-500">
            {c.waitingMore} more {c.waitingMore === 1 ? "wait is" : "waits are"} open.{" "}
            <Link href="/actions" className="underline-offset-4 hover:underline">See all</Link>
          </p>
        )}
      </Block>

      {/* ---- 4. IN YOUR OWN WORDS (§19, §20, §21) ------------------------- */}
      <Block title="In your own words" id="reflections"
        show={c.reflections.length > 0 || c.isToday}>
        {c.reflections.length > 0 && (
          <ul className="mb-2 flex flex-col gap-1.5">
            {c.reflections.map((r) => (
              <li key={`${r.entity.kind}:${r.entity.id}`} data-review-words
                className="text-sm text-zinc-700 dark:text-zinc-200">
                “{r.title}”
              </li>
            ))}
          </ul>
        )}
        {/* §20. One optional prompt. A sentence or nothing — and no nagging if
            it stays empty, which is why there is no "incomplete" state here. */}
        {c.isToday && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="evening-memory" className="text-[11px] text-zinc-500">
              {MEMORY_PROMPT} <span className="text-zinc-400">{MEMORY_PROMPT_HINT}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="evening-memory"
                data-review-memory-input
                value={memory}
                onChange={(e) => { setMemory(e.target.value); setSaved(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); remember(); } }}
                placeholder="Optional"
                className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/12"
              />
              <button type="button" data-review-memory-save disabled={!memory.trim()} onClick={remember}
                className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
                Save
              </button>
            </div>
            {saved && (
              <p data-review-memory-saved className="text-[11px] text-zinc-500">
                Saved with your reflections.
              </p>
            )}
          </div>
        )}
      </Block>

      {/* ---- 5. TOMORROW (§14, §15, §16, §18) ---------------------------- */}
      {/*
        §18. Reviewing Friday, the section said "Tomorrow · Carry to tomorrow" —
        and the press moved the work to the day after TODAY, not the day after
        Friday. The action was right and the word was wrong, which is the same
        defect as a button announcing a mutation it did not make. On a past day
        the section is named for what it actually is, and the button names the
        day it actually targets.
      */}
      <Block title={c.isToday ? "Tomorrow" : "Carry forward"} id="tomorrow" show={hasTomorrow}>
        {/* §14, §18. Two lists, never merged: what already has a place, and
            what the review is only proposing. */}
        {c.tomorrowScheduled.length > 0 && (
          <>
            <h3 className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              {TOMORROW_SCHEDULED_HEADING}
            </h3>
            <ul data-review-scheduled className="mb-3 flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {c.tomorrowScheduled.map((t) => (
                <li key={`${t.kind}:${t.id}`} data-review-tomorrow={t.kind} className={rowClass}>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{t.title}</span>
                  <span className={metaClass}>
                    {[t.time ? formatLocalTime(t.time) : undefined, t.detail].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {c.carryForward.length > 0 && (
          <>
            <h3 className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
              {c.isToday ? CARRY_FORWARD_HEADING : `Possible carry-forward to ${formatDayKey(carryTarget)}`}
            </h3>
            <ul data-review-carry className="flex flex-col gap-1">
              {c.carryForward.map((f) => (
                <li key={f.item.id} data-review-carry-item={f.item.reason} className="py-1">
                  <div className={rowClass}>
                    <Link href={`/actions/${f.item.entity.id}`}
                      className="min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100">
                      {f.item.title}
                    </Link>
                    {/* §41. Still open above already gave this item's reason;
                        printing it again here is one fact rendered twice. */}
                    {!f.echoesStillOpen && <span className={metaClass}>{f.item.explanation}</span>}
                  </div>
                  {/* §16. A proposal. Nothing has moved, and nothing will until
                      this is pressed. */}
                  <button type="button" data-review-carry-confirm={f.item.entity.id}
                    onClick={() => carry(f)} className={chip}>
                    {carryLabel}
                  </button>
                </li>
              ))}
            </ul>
            <p data-review-carry-note className="mt-1.5 text-[11px] text-zinc-500">{CARRY_FORWARD_NOTE}</p>
          </>
        )}
      </Block>

      <footer className="flex flex-col gap-2 text-[11px] text-zinc-500">
        {/* §24. A day surface says what it covers in a day's words. The old
            line said "not a complete record of your week" on this page. */}
        <p data-review-coverage>
          This reflects what was recorded in Conqify. It is not a complete record of your day.
        </p>
        {/* §21. The week is a secondary link, and the only one — "add a fuller
            reflection" pointed at the wizard, which now redirects back to this
            page, so the link was a loop. */}
        <p className="mt-1">
          <Link href="/memory" data-review-week className="underline-offset-4 hover:underline">Review this week →</Link>
          {" · "}
          <Link href="/daily/history" data-review-history className="underline-offset-4 hover:underline">Past reviews →</Link>
        </p>
      </footer>
    </div>
  );
}
