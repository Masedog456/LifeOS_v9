"use client";

/**
 * Person context (LIFEOS-086 §29).
 *
 * ## What this page is, and what it deliberately is not
 *
 * It answers one question — *what is open with this person?* — from records the
 * user already wrote. It is not a contact card, and there is no roster page
 * behind it: enumerating "people" from string matching would present
 * `waitingOn: "the letting agency"` as a person and would claim a set of
 * relationships Conqify cannot vouch for (§27, §28).
 *
 * There is no avatar, no company, no job title, no relationship label, no
 * score, and no sentiment. The audit found no Person domain at all, so the URL
 * segment IS the name as the user wrote it — which is honest about what the
 * matching is, and is why the identity limitation is stated on the page rather
 * than buried.
 *
 * ## Four sections, and each owns its rows (§29, §36)
 *
 *   OPEN WITH THEM · WAITING ON · PROJECTS AND GOALS · RECENTLY MENTIONED
 *
 * `buildPersonContext` applies the precedence — waiting owns anything whose
 * status is `waiting`, open commitments own the rest, and attention attaches
 * its reason to whichever row owns the record rather than starting a third.
 *
 * Empty sections are omitted (§29), and nothing here writes anything.
 */

import { use, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useStore } from "@/lib/mvpStore";
import { formatDayKey, todayKey } from "@/lib/reviews/dates";
import { nowLocalTime } from "@/lib/time/events";
import { buildTodayIndexes } from "@/lib/today/indexes";
import { resolutionsForAction } from "@/lib/commitment/resolve";
import ResolutionControls from "@/components/commitment/ResolutionControls";
import {
  buildPersonContext, PERSON_HEADINGS, NOTHING_OPEN, MENTION_NOTE,
  IDENTITY_LIMITATION, AMBIGUOUS_NAME,
} from "@/lib/people/context";
import SyncStatus from "@/components/SyncStatus";

const rowClass = "flex items-baseline justify-between gap-3 py-1";
const metaClass = "shrink-0 text-[11px] text-zinc-400";
const linkClass = "min-w-0 flex-1 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-100";

function Section({ title, id, show, note, children }: {
  title: string; id: string; show: boolean; note?: string; children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <section data-person-section={id} aria-labelledby={`person-h-${id}`} className="rounded-2xl border border-black/[.06] p-4 dark:border-white/[.08]">
      <h2 id={`person-h-${id}`} className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] text-zinc-400">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function PersonPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = use(params);
  const name = decodeURIComponent(raw);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();
  const today = todayKey();
  const [now] = useState(() => nowLocalTime());

  // ONE index pass, shared by the context AND every row's resolution controls
  // (LIFEOS-071 §27) — a button must not rescan the store.
  const ix = useMemo(() => buildTodayIndexes(state, today, now), [state, today, now]);
  const person = useMemo(
    () => (mounted ? buildPersonContext(state, name, ix, today) : null),
    [mounted, state, name, ix, today],
  );

  if (!mounted || !person) {
    return <main className="mx-auto max-w-2xl p-4 text-sm text-zinc-400">Looking…</main>;
  }

  return (
    <main data-person={person.name} className="mx-auto flex max-w-2xl flex-col gap-3 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{person.name}</h1>
          {/* §31, §32. What Conqify records about a person is records — never a
              role, never a closeness, never a sentiment. */}
          <p className="mt-0.5 text-[11px] text-zinc-400">What you have recorded with this name.</p>
        </div>
        <SyncStatus />
      </div>

      {/* §7, §8, §35. Said before anything else, because everything below
          depends on it being read. */}
      {person.longerForms.length > 0 && (
        <p data-person-ambiguous className="rounded-xl border border-amber-500/30 bg-amber-500/[.06] px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-200">
          {AMBIGUOUS_NAME(person.name, person.longerForms)}{" "}
          {person.longerForms.map((f) => (
            <Link key={f} href={`/people/${encodeURIComponent(f)}`} className="underline underline-offset-2">
              Open “{f}”
            </Link>
          ))}
        </p>
      )}

      {person.empty ? (
        <div data-person-empty className="rounded-2xl border border-dashed border-black/[.10] p-6 text-sm dark:border-white/[.12]">
          <p className="text-zinc-700 dark:text-zinc-200">{NOTHING_OPEN(person.name)}</p>
          <p className="mt-1 text-xs text-zinc-500">That is a statement about the records, not about the person.</p>
        </div>
      ) : (
        <>
          {/* §37. Said when nothing is OPEN but something is recorded — a
              mention is not a debt, and §12 forbids reading it as one. */}
          {person.mentionOnly && (
            <p data-person-calm className="text-sm text-zinc-700 dark:text-zinc-200">
              {NOTHING_OPEN(person.name)}
            </p>
          )}

          {/* ---- 1. OPEN WITH THEM (§12) ------------------------------------ */}
          <Section title={PERSON_HEADINGS.open} id="open" show={person.openCommitments.length > 0}>
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {person.openCommitments.map((c) => (
                <li key={c.id} data-person-commitment className="py-1">
                  <div className={rowClass}>
                    <Link href={`/actions/${c.action.id}`} className={linkClass}>{c.action.title}</Link>
                    <span className={metaClass}>
                      {c.dueDate ? `Due ${formatDayKey(c.dueDate)}` : ""}
                    </span>
                  </div>
                  {/* §21, §36. An attention fact about the SAME record, attached
                      rather than starting a third row for it. */}
                  {(c.attention || c.matchedAs) && (
                    <p data-person-attention className="mt-0.5 text-[11px] text-zinc-400">
                      {[c.attention, c.matchedAs ? `This record says “${c.matchedAs}”.` : ""].filter(Boolean).join(" ")}
                    </p>
                  )}
                  <ResolutionControls
                    title={c.action.title}
                    actions={resolutionsForAction(state, c.action.id, { ix, today })}
                  />
                </li>
              ))}
            </ul>
          </Section>

          {/* ---- 2. WAITING ON (§10, §13) ----------------------------------- */}
          <Section title={PERSON_HEADINGS.waiting} id="waiting" show={person.waiting.length > 0}>
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {person.waiting.map((w) => (
                <li key={w.id} data-person-waiting className="py-1">
                  <div className={rowClass}>
                    <Link href={`/actions/${w.action.id}`} className={linkClass}>{w.action.title}</Link>
                    {/* §34. Real temporal facts. A follow-up in the future is
                        stated as its date, never as "due". */}
                    <span className={metaClass} data-followup={w.followUpDue ? "due" : w.followUpDate ? "future" : "none"}>
                      {w.followUpDue
                        ? "Follow up today"
                        : w.followUpDate
                          ? `Follow up ${formatDayKey(w.followUpDate)}`
                          : w.since ? `Waiting since ${formatDayKey(w.since)}` : "Waiting"}
                    </span>
                  </div>
                  {/* §13. Framed as what the user is waiting on, never as a debt
                      the other person owes. */}
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Waiting on {w.waitingOn}{w.since ? ` since ${formatDayKey(w.since)}` : ""}.
                    {w.matchedAs ? ` This record says “${w.matchedAs}”.` : ""}
                  </p>
                  <ResolutionControls
                    title={w.action.title}
                    actions={resolutionsForAction(state, w.action.id, { ix, today })}
                  />
                </li>
              ))}
            </ul>
          </Section>

          {/* ---- 3. PROJECTS AND GOALS (§14, §15) --------------------------- */}
          <Section
            title={PERSON_HEADINGS.links}
            id="links"
            show={person.links.length > 0}
            note="Shown only where the record itself names them."
          >
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {person.links.map((l) => (
                <li key={l.id} data-person-link={l.kind} className={rowClass}>
                  <Link href={l.route} className={linkClass}>{l.title}</Link>
                  <span className={metaClass}>{l.reason}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* ---- 4. RECENTLY MENTIONED (§16, §17) --------------------------- */}
          <Section
            title={PERSON_HEADINGS.mentions}
            id="mentions"
            show={person.mentions.length > 0}
            note={MENTION_NOTE}
          >
            <ul className="flex flex-col divide-y divide-black/[.05] dark:divide-white/[.06]">
              {person.mentions.map((m) => (
                <li key={m.id} data-person-mention className="py-1">
                  <Link href={m.route} className="block text-sm leading-relaxed text-zinc-700 hover:underline dark:text-zinc-200">
                    {m.text.length > 180 ? `${m.text.slice(0, 179).trimEnd()}…` : m.text}
                  </Link>
                  {/* §16, §17. "You wrote" is safe here because the model filters
                      machine prose out of this section entirely — and the verb is
                      "mentioned", not "spoke", because no communication is
                      recorded anywhere in the schema. */}
                  <p className="mt-0.5 text-[11px] text-zinc-400">You wrote this {formatDayKey(m.date)}</p>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      <p data-person-limitation className="px-1 text-[11px] text-zinc-400">{IDENTITY_LIMITATION}</p>
    </main>
  );
}
