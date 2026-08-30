/**
 * Turning a stale-write rejection into something a person can act on
 * (LIFEOS-076 §9, §10).
 *
 * Pure and framework-free on purpose: the wording and the field comparison are
 * the parts most likely to be wrong, and they must be testable from Node
 * without a browser, a store or a network.
 *
 * The vocabulary rule from §6 applies here too — every line is about
 * CONSEQUENCE ("this was not saved", "this is what is saved now"), never about
 * mechanism ("CAS rejected", "version mismatch", "409").
 */

import type { GuardedDomain, StaleConflict } from "@/lib/sync/conflicts-store";
import type { NextAction, Note } from "@/types/mvp";

export interface ConflictField {
  label: string;
  /** What the other device saved — this is what is on the server now. */
  saved: string;
  /** What this device tried to write and the server refused. */
  yours: string;
}

export interface ConflictView {
  /** Plain-language name of the thing in conflict, for a heading. */
  title: string;
  /** What happened, in consequence language. */
  headline: string;
  /** Fields that actually differ. Empty means nothing user-visible changed. */
  fields: ConflictField[];
  /** True when the only difference is bookkeeping — nothing worth a decision. */
  trivial: boolean;
}

const EMPTY = "(empty)";

function text(v: unknown): string {
  if (v === undefined || v === null || v === "") return EMPTY;
  return String(v);
}

const STATUS_WORDS: Record<string, string> = {
  open: "Not started",
  in_progress: "In progress",
  waiting: "Waiting on someone",
  deferred: "Deferred",
  completed: "Done",
  cancelled: "Cancelled",
};

function statusWords(a: Partial<NextAction>): string {
  const s = a.status;
  const label = (s && STATUS_WORDS[s]) || "Unknown";
  // The completion DATE is the fact F-1 destroyed, so it is shown, not implied.
  if (s === "completed" && a.completedAt) return `${label} (${a.completedAt.slice(0, 10)})`;
  return label;
}

/**
 * Only fields a person would recognise as their own work. `updatedAt` is
 * excluded deliberately: it differs in EVERY conflict, so showing it would bury
 * the one line that matters under noise the user cannot act on.
 */
function noteFields(local: Partial<Note>, remote: Partial<Note>): ConflictField[] {
  const out: ConflictField[] = [];
  if ((local.body ?? "") !== (remote.body ?? "")) {
    out.push({ label: "Note", saved: text(remote.body), yours: text(local.body) });
  }
  if ((local.title ?? "") !== (remote.title ?? "")) {
    out.push({ label: "Title", saved: text(remote.title), yours: text(local.title) });
  }
  if ((local.workspaceId ?? "") !== (remote.workspaceId ?? "")) {
    out.push({ label: "Topic", saved: text(remote.workspaceId), yours: text(local.workspaceId) });
  }
  if (!!local.archived !== !!remote.archived) {
    out.push({ label: "Archived", saved: remote.archived ? "yes" : "no", yours: local.archived ? "yes" : "no" });
  }
  return out;
}

function actionFields(local: Partial<NextAction>, remote: Partial<NextAction>): ConflictField[] {
  const out: ConflictField[] = [];
  if (local.status !== remote.status || (local.completedAt ?? "") !== (remote.completedAt ?? "")) {
    out.push({ label: "Status", saved: statusWords(remote), yours: statusWords(local) });
  }
  if ((local.title ?? "") !== (remote.title ?? "")) {
    out.push({ label: "Title", saved: text(remote.title), yours: text(local.title) });
  }
  if ((local.description ?? "") !== (remote.description ?? "")) {
    out.push({ label: "Details", saved: text(remote.description), yours: text(local.description) });
  }
  if ((local.dueDate ?? "") !== (remote.dueDate ?? "")) {
    out.push({ label: "Due", saved: text(remote.dueDate), yours: text(local.dueDate) });
  }
  if ((local.deferredUntil ?? "") !== (remote.deferredUntil ?? "")) {
    out.push({ label: "Start after", saved: text(remote.deferredUntil), yours: text(local.deferredUntil) });
  }
  return out;
}

function nameOf(domain: GuardedDomain, remote: Record<string, unknown>, local: Record<string, unknown>): string {
  const t = (remote.title ?? local.title) as string | undefined;
  if (t) return t;
  if (domain === "notes") {
    const body = String((remote.body ?? local.body ?? "") as string).trim();
    if (body) return body.split("\n")[0].slice(0, 60);
    return "Untitled note";
  }
  return "Untitled action";
}

export function describeConflict(c: StaleConflict): ConflictView {
  const local = (c.local ?? {}) as Record<string, unknown>;
  const remote = (c.remote ?? {}) as Record<string, unknown>;
  const fields = c.domain === "notes"
    ? noteFields(local as Partial<Note>, remote as Partial<Note>)
    : actionFields(local as Partial<NextAction>, remote as Partial<NextAction>);

  return {
    title: nameOf(c.domain, remote, local),
    headline: c.domain === "notes"
      ? "Your change to this note was not saved. It was changed on another device first, and that version is the one you have everywhere. Nothing you wrote has been thrown away — it is below."
      : "Your change to this action was not saved. It was changed on another device first, and that version is the one you have everywhere. What you did is below.",
    fields,
    // A conflict with no visible difference is still a real rejection, but it is
    // not a decision: the two versions say the same thing to the user.
    trivial: fields.length === 0,
  };
}

/** Wording for the three choices §9 requires. Kept here so tests can assert it. */
export const CONFLICT_ACTIONS = {
  keepSaved: "Keep the saved version",
  useMine: "Use my version instead",
  copyMine: "Copy my version",
} as const;

export function conflictSummary(count: number): string {
  if (count <= 0) return "";
  return count === 1
    ? "1 change was not saved because the same thing changed on another device."
    : `${count} changes were not saved because the same things changed on another device.`;
}
