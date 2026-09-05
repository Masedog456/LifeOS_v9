"use client";

/**
 * The context a capture may already belong to (LIFEOS-089 §25, §26).
 *
 * ## Compact, not an organizer form
 *
 * §26 is explicit: this must not become a fifteen-field filing screen. One
 * line per suggestion, each independently accept/reject, each saying WHY in the
 * record's own words (§20). No percentages, no "AI thinks" (§21).
 *
 * ## What is a link and what is only context
 *
 *   Project / Goal   a link, and it is written only if the user leaves it on
 *   Existing Action  a HANDOFF — this may already exist. Nothing is written,
 *                    nothing is completed, and the row is a way to go look (§27)
 *   Person           a text reference under LIFEOS-086 rules. Never a link,
 *                    never an identity, never merged (§14, §36)
 *
 * ## The acceptance gradient
 *
 *   exact       the record's whole title is in the capture → arrives ON
 *   possible    a shared distinctive word → arrives OFF, because the evidence
 *               is weaker and §5 puts every link in the confirm tier
 *   ambiguous   nothing is preselected, ever (§24)
 */

import Link from "next/link";
import type { CaptureContextSuggestion } from "@/lib/capture/context";
import { CONTEXT_HEADING, EXISTING_RECORD_LEAD, CHOOSE_ONE } from "@/lib/capture/context";

/** What the user has accepted for one candidate. `undefined` means rejected. */
export interface ContextChoice {
  projectId?: string;
  goalId?: string;
}

/** A suggestion arrives already accepted only when the evidence is exact (§5). */
export function defaultChoice(rows: CaptureContextSuggestion[]): ContextChoice {
  const p = rows.find((r) => r.contextType === "project" && r.strength === "exact");
  const g = rows.find((r) => r.contextType === "goal" && r.strength === "exact");
  return {
    ...(p ? { projectId: p.contextId } : {}),
    ...(g && !p ? { goalId: g.contextId } : {}),
  };
}

const KIND_WORD: Record<CaptureContextSuggestion["contextType"], string> = {
  project: "Project",
  goal: "Goal",
  action: "Existing item",
  person: "Person",
};

function Chip({ on, label, onClick, describe }: {
  on: boolean; label: string; onClick: () => void; describe: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={describe}
      data-context-chip={on ? "on" : "off"}
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        on
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border border-black/[.12] text-zinc-600 dark:border-white/[.15] dark:text-zinc-300"
      }`}
    >
      {/* §48. The chip says on/off in words as well as in colour. */}
      {on ? `✓ ${label}` : label}
    </button>
  );
}

export default function CaptureContext({
  rows, choice, onChange,
}: {
  rows: CaptureContextSuggestion[];
  choice: ContextChoice;
  onChange: (next: ContextChoice) => void;
}) {
  if (rows.length === 0) return null;

  const isOn = (s: CaptureContextSuggestion) =>
    (s.contextType === "project" && choice.projectId === s.contextId)
    || (s.contextType === "goal" && choice.goalId === s.contextId);

  /**
   * Toggling a Project clears any Goal and vice versa.
   *
   * §12/§13: a Project already carries its Goal, so holding both would write a
   * second link saying the same thing. Goal-only stays available for the case
   * where no Project matched at all.
   */
  const pick = (type: "project" | "goal", id: string) => {
    if (type === "project") {
      onChange(choice.projectId === id ? {} : { projectId: id });
    } else {
      onChange(choice.goalId === id ? {} : { goalId: id });
    }
  };

  return (
    <div data-capture-context className="mt-2 rounded-xl border border-black/[.06] px-2.5 py-2 dark:border-white/[.08]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{CONTEXT_HEADING}</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {rows.map((s, i) => (
          <li key={`${s.contextType}:${s.contextId}:${i}`} data-context-row={s.contextType} data-context-strength={s.strength}>
            {/* ---- an existing record this may already be (§18, §27) ------ */}
            {s.contextType === "action" && s.strength !== "ambiguous" && (
              <div data-context-existing>
                <p className="text-[11px] text-zinc-500">
                  {EXISTING_RECORD_LEAD}{" "}
                  <Link href={`/actions/${s.contextId}`} className="underline underline-offset-2">{s.label}</Link>
                </p>
                <p className="text-[11px] text-zinc-400">{s.reason} Nothing has been changed.</p>
              </div>
            )}

            {/* ---- a person, which is context and never a link (§14) ------ */}
            {s.contextType === "person" && (
              <div data-context-person={s.label}>
                <p className="text-[11px] text-zinc-500">
                  <span className="text-zinc-400">{KIND_WORD.person} · </span>
                  <Link href={`/people/${encodeURIComponent(s.label)}`} className="underline underline-offset-2">{s.label}</Link>
                </p>
                <p className="text-[11px] text-zinc-400">{s.reason}</p>
                {s.ambiguousAlternatives.length > 0 && (
                  <p data-context-person-ambiguous className="text-[11px] text-zinc-400">
                    Conqify also has “{s.ambiguousAlternatives[0].label}”. It cannot tell whether that is the same {s.label}.
                  </p>
                )}
              </div>
            )}

            {/* ---- a link the user may accept or reject (§25) ------------- */}
            {(s.contextType === "project" || s.contextType === "goal") && s.strength !== "ambiguous" && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[11px] text-zinc-400">{KIND_WORD[s.contextType]}</span>
                <Chip
                  on={isOn(s)}
                  label={s.label}
                  describe={`${isOn(s) ? "Remove" : "Add"} ${KIND_WORD[s.contextType].toLowerCase()} context: ${s.label}`}
                  onClick={() => pick(s.contextType as "project" | "goal", s.contextId)}
                />
                <span className="text-[11px] text-zinc-400">{s.reason}</span>
                {/* §13. Inherited, stated as fact — not a second link. */}
                {s.inheritedGoal && (
                  <span data-context-inherited={s.inheritedGoal.label} className="text-[11px] text-zinc-400">
                    Supports Goal <strong className="font-medium">{s.inheritedGoal.label}</strong>.
                  </span>
                )}
              </div>
            )}

            {/* ---- several match, so the user chooses (§24) --------------- */}
            {s.strength === "ambiguous" && (
              <div data-context-ambiguous={s.contextType}>
                <p className="text-[11px] text-zinc-500">{s.reason}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {s.ambiguousAlternatives.map((alt) => (
                    s.contextType === "action" ? (
                      <Link key={alt.contextId} href={`/actions/${alt.contextId}`}
                        data-context-alt
                        className="rounded-full border border-black/[.12] px-2 py-0.5 text-[11px] underline-offset-2 hover:underline dark:border-white/[.15]">
                        {alt.label}
                      </Link>
                    ) : (
                      <Chip
                        key={alt.contextId}
                        on={
                          (s.contextType === "project" && choice.projectId === alt.contextId)
                          || (s.contextType === "goal" && choice.goalId === alt.contextId)
                        }
                        label={alt.label}
                        describe={`Use ${KIND_WORD[s.contextType].toLowerCase()} context: ${alt.label}`}
                        onClick={() => pick(s.contextType as "project" | "goal", alt.contextId)}
                      />
                    )
                  ))}
                </div>
                {s.contextType !== "action" && (
                  <p data-context-choose className="mt-0.5 text-[11px] text-zinc-400">{CHOOSE_ONE}</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
