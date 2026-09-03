"use client";

/**
 * Personal Code (LIFEOS-079).
 *
 * One page that answers *"what standards have I chosen for myself?"* over two
 * existing domains. It stores nothing: every record shown is a Constitution
 * standard or a Protocol that already existed, and every action here calls the
 * store function that already owned that record.
 *
 * What it deliberately does not render: a score, a compliance rate, a streak, a
 * violation, a percentage, or any ordering of one rule above another.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  useStore, saveRule, retireRule, pauseRule, resumeRule,
} from "@/lib/mvpStore";
import {
  PERSONAL_CODE_LABEL, PROTOCOL_HISTORY_LIMITATION, RULE_STATE_LABEL,
  allRules, groupRulesByState, ruleContexts, type CodeRule,
} from "@/lib/code/personal-code";
import { findDuplicates, duplicateNotice, type DuplicateMatch } from "@/lib/code/duplicates";
import { findTensions, TENSION_LINE } from "@/lib/code/conflicts";
import SyncStatus from "@/components/SyncStatus";
import { requestConfirm } from "@/components/ux/ConfirmDialog";
import { toast } from "@/lib/ux/feedback";

/** The shape, in the user's terms. The domain name never reaches the screen. */
const SHAPE_LABEL: Record<CodeRule["shape"], string> = {
  unconditional: "Always",
  conditional: "When…",
};

export default function PersonalCodePage() {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const state = useStore();

  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [dupes, setDupes] = useState<DuplicateMatch[] | null>(null);

  const rules = useMemo(() => allRules(state), [state]);
  const groups = useMemo(() => groupRulesByState(rules), [rules]);
  const tensions = useMemo(() => findTensions(state), [state]);
  const anyConditional = rules.some((r) => r.shape === "conditional");

  if (!mounted) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10"><p className="text-sm text-zinc-400">Loading…</p></main>;
  }

  const attempt = () => {
    const text = statement.trim();
    if (!text) return;
    // §9. Check BEFORE writing. A duplicate found afterwards is a cleanup task;
    // found before, it is a choice.
    const found = findDuplicates(state, text);
    if (found.length > 0 && dupes === null) { setDupes(found); return; }
    commit();
  };

  const commit = () => {
    const text = statement.trim();
    if (!text) return;
    const saved = saveRule({ statement: text, note: note.trim() || undefined });
    if (!saved) return;
    setStatement(""); setNote(""); setDupes(null);
    toast({
      kind: "success",
      message: saved.shape === "conditional" ? "Saved as a when/then rule." : "Saved to your Personal Code.",
    });
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{PERSONAL_CODE_LABEL}</h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-500">
          How you want to act, in your own words. Conqify remembers what you chose — it does not
          grade you on it.
        </p>
        <div className="mt-1.5"><SyncStatus /></div>
      </header>

      {/* §30 — one field, and a rule is saved. No questionnaire. */}
      <section className="mb-8 rounded-xl border border-black/10 p-4 dark:border-white/12">
        <label htmlFor="rule-statement" className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Write a rule for yourself
        </label>
        <input
          id="rule-statement" data-rule-input value={statement}
          onChange={(e) => { setStatement(e.target.value); setDupes(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") attempt(); }}
          placeholder="Don’t send messages while angry"
          className="mt-1.5 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20"
        />
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Why this matters to you (optional)" aria-label="Why this matters"
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-xs outline-none focus:border-zinc-500 dark:border-white/12 dark:bg-black/20"
        />
        <p className="mt-2 text-[11px] text-zinc-400">
          Write it as “Always…”, “Don’t…”, or “When X, do Y”. Conqify keeps your wording.
        </p>

        {/* §9 — the duplicate question, with both sides shown and no merge offered. */}
        {dupes && dupes.length > 0 && (
          <div className="mt-3 rounded-lg border border-black/10 p-3 dark:border-white/12" data-duplicate-notice>
            <p className="text-xs font-medium">{duplicateNotice(dupes[0])}</p>
            <ul className="mt-1.5 space-y-1">
              {dupes.slice(0, 3).map((d) => (
                <li key={d.existing.id} className="text-xs text-zinc-500">· {d.existing.statement}</li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" data-dupe-keep onClick={() => { setStatement(""); setNote(""); setDupes(null); }}
                className="rounded-full border border-black/10 px-3 py-1 text-xs dark:border-white/12">Use the one I have</button>
              <button type="button" data-dupe-save onClick={commit}
                className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Save this as well</button>
            </div>
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button type="button" data-rule-save onClick={attempt} disabled={!statement.trim()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
            Save rule
          </button>
        </div>
      </section>

      {/* §10 — both sides, no winner. */}
      {tensions.length > 0 && (
        <section className="mb-8 rounded-xl border border-black/10 p-4 dark:border-white/12" data-rule-tensions={tensions.length}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Worth knowing</h2>
          <ul className="mt-2 space-y-3">
            {tensions.slice(0, 3).map((t) => (
              <li key={`${t.toward.id}:${t.away.id}`}>
                <p className="text-sm">{t.toward.statement}</p>
                <p className="text-sm">{t.away.statement}</p>
                <p className="mt-1 text-[11px] text-zinc-400">{TENSION_LINE}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 px-6 py-12 text-center dark:border-white/15">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Nothing here yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            A rule is how you want to behave when it is hard to. Write one above — you can change it
            or let it go later, and Conqify will keep the record either way.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.state} data-rule-group={g.state}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{g.label}</h2>
              <ul className="space-y-2">
                {g.rules.map((r) => (
                  <li key={r.id} data-rule-card={r.id}
                    className="rounded-xl border border-black/10 p-3 dark:border-white/12">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm">{r.statement}</p>
                      <span className="shrink-0 rounded-full bg-black/[.05] px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[.06] dark:text-zinc-300">
                        {SHAPE_LABEL[r.shape]}
                      </span>
                    </div>
                    {r.note && <p className="mt-1 text-xs text-zinc-500">{r.note}</p>}
                    {ruleContexts(r).length > 0 && (
                      <p className="mt-1 text-[10px] text-zinc-400" data-rule-contexts>
                        {ruleContexts(r).join(" · ")}
                      </p>
                    )}
                    {/* §13 — provenance shown only where it tells the reader something. */}
                    {r.fromAiText && (
                      <p className="mt-1 text-[10px] text-zinc-400" data-rule-ai>Wording came from an AI suggestion you kept.</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                      {r.state === "active" && r.shape === "conditional" && (
                        <button type="button" data-rule-pause={r.id} onClick={() => pauseRule(r.id)}
                          className="text-zinc-500 underline underline-offset-2">Pause</button>
                      )}
                      {r.state !== "active" && (
                        <button type="button" data-rule-resume={r.id} onClick={() => resumeRule(r.id)}
                          className="text-zinc-500 underline underline-offset-2">Make active</button>
                      )}
                      {r.state !== "retired" && (
                        <button type="button" data-rule-retire={r.id}
                          onClick={() => requestConfirm({
                            // Retiring is NOT a delete, and the dialog says so:
                            // `undoable`, no children lost, and the verb is the
                            // real one (§27).
                            impact: {
                              name: r.statement,
                              typeLabel: "Rule",
                              children: [],
                              linkedNote: "It leaves your active code and stays in your record. Nothing is deleted.",
                              undoable: true,
                              severity: "normal",
                              verb: "Retire",
                            },
                            onConfirm: () => { retireRule(r.id); toast({ kind: "success", message: "Retired. It stays in your record." }); },
                          })}
                          className="text-zinc-500 underline underline-offset-2">Retire</button>
                      )}
                      <Link
                        href={r.recordKind === "protocol" ? `/protocols?protocol=${r.id}` : `/constitution?element=${r.id}`}
                        className="text-zinc-400 underline underline-offset-2">Open</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* §4 of the approval — the limitation, said where it applies. */}
      {anyConditional && (
        <p className="mt-8 text-[11px] text-zinc-400" data-rule-limitation>{PROTOCOL_HISTORY_LIMITATION}</p>
      )}

      {/* The lifecycle asymmetry, stated rather than papered over. */}
      {groups.some((g) => g.state === "draft") && (
        <p className="mt-2 text-[11px] text-zinc-400">
          {RULE_STATE_LABEL.draft}: written, but not yet part of your code.
        </p>
      )}
    </main>
  );
}
