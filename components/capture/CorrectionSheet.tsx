"use client";

/**
 * "That's not what I meant." (LIFEOS-097)
 *
 * ## One sheet, the fields that record actually has
 *
 * Not a universal editor (§6). `correctableOutcome` decides what a given record
 * can be asked about — a wait gets a person and a follow-up day, an ordinary
 * action gets a due date and, only once it has one, a time. Everything else the
 * user might reasonably want is listed as unsupported with the reason, because
 * §17 says an impossible conversion is said out loud rather than quietly left
 * off the menu.
 *
 * ## Every save is the record page's own setter
 *
 * `updateAction`, `setActionDueDate`, `setActionDueTime`, `updateNote`,
 * `updateEvent`. No Home-specific mutation exists (§41). That is also what
 * keeps a correction out of the deferral history: `setActionDueDate` writes
 * `due_set`, and `deferAction` — the one that writes `deferred` — is not
 * reachable from here at all (§8, §27).
 *
 * ## The sentence stays
 *
 * §3, §4. The raw capture is shown above the fields and is never edited by
 * anything on this sheet. The user said what they said; the system got the
 * interpretation wrong.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  getSnapshot, updateAction, setActionDueDate, setActionDueTime,
  updateNote, updateEvent, useStore,
} from "@/lib/mvpStore";
import { toast } from "@/lib/ux/feedback";
import {
  correctableOutcome, currentValue, outcomeStillStands, asDayKey,
  SOURCE_LEAD, CORRECTION_HEADING,
  type CorrectableField, type CorrectableOutcome,
} from "@/lib/capture/corrections";

/*
 * §34, §46. Save and Cancel are sized for a thumb.
 *
 * The first version used the row-control padding from elsewhere in the product
 * and measured 57×29 on a phone — fine for a chip you tap with a mouse, under
 * the 44px a finger needs. Padding alone got it to 38, which is why the height
 * is stated rather than implied. These two are the ones a correction ends on.
 */
const btn =
  "min-h-[44px] rounded-full border border-black/[.12] px-4 text-[12px] text-zinc-600 hover:bg-black/[.04] dark:border-white/[.15] dark:text-zinc-300 dark:hover:bg-white/[.06]";
const primary =
  "min-h-[44px] rounded-full bg-zinc-900 px-5 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900";
const input =
  "w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-black/30 dark:border-white/12 dark:focus:border-white/30";

export default function CorrectionSheet({
  source, outcome, onClose,
}: {
  /** §4. The sentence that produced this record, verbatim. */
  source: string;
  outcome: CorrectableOutcome;
  onClose: () => void;
}) {
  const state = useStore();
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(outcome.fields.map((f) => [f.field, f.value ?? ""])),
  );
  /** §32. What changed underneath us since the sheet opened. */
  const [conflict, setConflict] = useState<string | null>(null);

  /**
   * The Projects and Goals that exist. A correction picks from what is there —
   * §10 is explicit that a replacement is never inferred, and creating one from
   * this sheet would be capture by another name.
   */
  const projects = useMemo(
    () => (state.projects ?? []).filter((p) => p.status === "active"),
    [state.projects],
  );
  const goals = useMemo(
    () => (state.goals ?? []).filter((g) => g.status === "active"),
    [state.goals],
  );

  const set = (f: CorrectableField, v: string) => setDraft((d) => ({ ...d, [f]: v }));
  const has = (f: CorrectableField) => outcome.fields.some((x) => x.field === f);
  const shown = (f: CorrectableField) => outcome.fields.find((x) => x.field === f);

  function save() {
    /**
     * §32. Revalidate against the store as it is NOW, not as it was rendered.
     *
     * Two questions, in order: does the record still exist, and has any field
     * this sheet is about to write moved since it opened. Either way the answer
     * is to show the current state rather than overwrite it.
     */
    const fresh = getSnapshot();
    if (!outcomeStillStands(fresh, outcome)) {
      setConflict("This record was removed somewhere else. Nothing was changed.");
      return;
    }
    const moved = outcome.fields.filter((f) => {
      const was = f.value ?? "";
      const now = currentValue(fresh, outcome, f.field) ?? "";
      return was !== now && (draft[f.field] ?? "") !== now;
    });
    if (moved.length > 0) {
      setConflict(
        `${moved.map((m) => m.label).join(" and ")} changed somewhere else since you opened this. Nothing was changed — close and try again.`,
      );
      return;
    }

    const changed: string[] = [];
    const pick = (f: CorrectableField) => (draft[f] ?? "").trim();
    const was = (f: CorrectableField) => (shown(f)?.value ?? "").trim();

    if (outcome.kind === "action") {
      // One `updateAction` for every field it owns, so a correction is one
      // `edited` history entry rather than three (§26).
      const patch: Parameters<typeof updateAction>[1] = {};
      if (has("title") && pick("title") && pick("title") !== was("title")) {
        patch.title = pick("title"); changed.push("title");
      }
      if (has("waitingOn") && pick("waitingOn") !== was("waitingOn")) {
        patch.waitingOn = pick("waitingOn") || undefined; changed.push("waiting on");
      }
      if (has("project") && pick("project") !== was("project")) {
        patch.projectId = projects.find((p) => p.title === pick("project"))?.id;
        changed.push("project");
      }
      if (has("goal") && pick("goal") !== was("goal")) {
        patch.goalId = goals.find((g) => g.title === pick("goal"))?.id;
        changed.push("goal");
      }
      if (Object.keys(patch).length > 0) updateAction(outcome.id, patch);

      if (has("dueDate") && pick("dueDate") !== was("dueDate")) {
        // `setActionDueDate`, never `deferAction`. A correction is not a
        // decision to put something off (§8, §27).
        setActionDueDate(outcome.id, asDayKey(pick("dueDate")));
        changed.push("date");
      }
      if (has("dueTime") && pick("dueTime") !== was("dueTime")) {
        setActionDueTime(outcome.id, pick("dueTime") || undefined);
        changed.push("time");
      }
    } else if (outcome.kind === "note") {
      if (pick("title") !== was("title")) {
        // A note's body is the record (LIFEOS-096 §12), so that is what moves.
        updateNote(outcome.id, { body: pick("title") });
        changed.push("note");
      }
    } else if (outcome.kind === "event") {
      const patch: { title?: string; date?: string; startTime?: string } = {};
      if (pick("title") !== was("title")) { patch.title = pick("title"); changed.push("title"); }
      if (pick("dueDate") !== was("dueDate")) { patch.date = pick("dueDate"); changed.push("date"); }
      if (pick("dueTime") !== was("dueTime")) { patch.startTime = pick("dueTime"); changed.push("time"); }
      if (Object.keys(patch).length > 0) updateEvent(outcome.id, patch);
    }

    toast({
      kind: changed.length > 0 ? "success" : "info",
      message: changed.length > 0 ? `Fixed the ${changed.join(", ")}.` : "Nothing to change.",
    });
    onClose();
  }

  return (
    <div data-correction-sheet={outcome.id}
      className="mt-2 rounded-2xl border border-black/[.10] bg-white/60 p-3 dark:border-white/[.14] dark:bg-white/[.04]">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{CORRECTION_HEADING}</h3>

      {/* §4. The sentence, above the record, never editable. */}
      <p className="mt-1 text-[11px] text-zinc-500" data-correction-source>
        <span className="text-zinc-400">{SOURCE_LEAD}: </span>&ldquo;{source}&rdquo;
      </p>

      <div className="mt-2.5 flex flex-col gap-2">
        {has("title") && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{shown("title")!.label}</span>
            <input value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)}
              data-correction-field="title" aria-label="Title" className={input} />
          </label>
        )}

        {has("waitingOn") && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Waiting on</span>
            <input value={draft.waitingOn ?? ""} onChange={(e) => set("waitingOn", e.target.value)}
              data-correction-field="waitingOn" aria-label="Waiting on" className={input} />
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          {has("dueDate") && (
            <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{shown("dueDate")!.label}</span>
              <input type="date" value={draft.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)}
                data-correction-field="dueDate" aria-label="Date" className={input} />
            </label>
          )}
          {has("dueTime") && (
            <label className="flex min-w-[7rem] flex-1 flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Time</span>
              <input type="time" value={draft.dueTime ?? ""} onChange={(e) => set("dueTime", e.target.value)}
                data-correction-field="dueTime" aria-label="Time" className={input} />
            </label>
          )}
        </div>

        {/* §10, §11. Pick from what exists, or none. Never inferred, never created. */}
        {has("project") && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Project</span>
            <select value={draft.project ?? ""} onChange={(e) => set("project", e.target.value)}
              data-correction-field="project" aria-label="Project" className={input}>
              <option value="">No Project</option>
              {projects.map((p) => <option key={p.id} value={p.title}>{p.title}</option>)}
            </select>
          </label>
        )}
        {has("goal") && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Goal</span>
            <select value={draft.goal ?? ""} onChange={(e) => set("goal", e.target.value)}
              data-correction-field="goal" aria-label="Goal" className={input}>
              <option value="">No Goal</option>
              {goals.map((g) => <option key={g.id} value={g.title}>{g.title}</option>)}
            </select>
          </label>
        )}
      </div>

      {/*
        §17, §18. What this sheet cannot do, and why.

        Listed rather than omitted: a person looking for "make this a Note"
        deserves to learn that it would cost the record's history, not to
        conclude the option is hidden somewhere they have not looked.
      */}
      {outcome.unsupported.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1">
          {outcome.unsupported.map((u) => (
            <li key={u.id} data-correction-unsupported={u.id} className="text-[11px] text-zinc-400">
              <span className="text-zinc-500">{u.label}:</span> {u.reason}
            </li>
          ))}
        </ul>
      )}

      {conflict && (
        <p data-correction-conflict className="mt-2 text-[11px] text-amber-600 dark:text-amber-500">{conflict}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" data-correction-save onClick={save} className={primary}>Save</button>
        <button type="button" data-correction-cancel onClick={onClose} className={btn}>Cancel</button>
        <Link href={hrefFor(outcome)} className="text-[11px] text-zinc-400 underline underline-offset-2">
          Open the record →
        </Link>
      </div>
    </div>
  );
}

function hrefFor(o: CorrectableOutcome): string {
  switch (o.kind) {
    case "action": return `/actions/${o.id}`;
    case "note": return `/notes?note=${o.id}`;
    case "event": return `/calendar?event=${o.id}`;
    default: return "/";
  }
}

/** Whether a sheet can be opened for this ref at all, for the caller's button. */
export function canCorrect(ref: { kind: string; id: string }): boolean {
  return correctableOutcome(getSnapshot(), ref as Parameters<typeof correctableOutcome>[1],
    { createdByCapture: false }) !== null;
}
