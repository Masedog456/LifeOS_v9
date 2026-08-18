/**
 * Review cadence (LIFEOS-017, Phase 7).
 *
 * Deterministic, invitational surfacing across five horizons — Today, This
 * Week, This Month, This Year, Life. Each item carries an explicit reason and
 * a gentle framing. Nothing is a notification; nothing is urgent; nothing is
 * a streak. The same state always yields the same review. Pure and offline.
 */

import type { StoreState } from "@/types/mvp";

export type CadencePeriod = "today" | "week" | "month" | "year" | "life";

export interface CadenceItem {
  id: string;
  section: string;
  title: string;
  /** Why this is worth your attention now — always shown, always gentle. */
  invitation: string;
  href?: string;
}

export interface CadenceReview {
  period: CadencePeriod;
  windowDays: number | null;
  items: CadenceItem[];
}

const WINDOW: Record<CadencePeriod, number | null> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
  life: null,
};

export const CADENCE_LABEL: Record<CadencePeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  life: "Life",
};

function daysSince(iso?: string): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}
function snippet(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** Build the cadence review for one horizon. Capped per section for calm. */
export function buildCadenceReview(state: StoreState, period: CadencePeriod): CadenceReview {
  const win = WINDOW[period];
  const inWindow = (iso?: string) => win === null || daysSince(iso) <= win;
  const items: CadenceItem[] = [];

  // Important changes: beliefs revised within the window.
  for (const b of state.beliefs
    .filter((b) => b.status === "revised" && inWindow(b.updatedAt))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 3)) {
    items.push({
      id: `chg:${b.id}`,
      section: "What changed",
      title: snippet(b.text),
      invitation: `You revised this ${new Date(b.updatedAt).toLocaleDateString()}. Does the new wording still feel true?`,
      href: "/beliefs",
    });
  }

  // Unfinished thinking: reflections whose follow-ups were never revisited.
  for (const s of state.formationSessions
    .filter((s) => s.followUpReflections.length > 0 && inWindow(s.createdAt))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 3)) {
    items.push({
      id: `unf:${s.id}`,
      section: "Unfinished thinking",
      title: snippet(s.followUpReflections[0]),
      invitation: `You left this to return to, from “${snippet(s.title, 40)}”. Want to sit with it?`,
      href: `/formation/${s.id}`,
    });
  }

  // Stale decisions: decided, no outcome review, and settled long enough to judge.
  for (const d of state.decisions
    .filter((d) => d.finalChoice && d.outcomeReviews.length === 0 && daysSince(d.updatedAt) >= 14)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 3)) {
    items.push({
      id: `dec:${d.id}`,
      section: "Decisions worth a look back",
      title: snippet(d.title, 60),
      invitation: `Decided ${new Date(d.updatedAt).toLocaleDateString()} with no outcome review yet. How did it actually go?`,
      href: `/decisions/${d.id}`,
    });
  }

  // Aging inquiries: open/unresolved and untouched for a while.
  for (const iq of state.inquiries
    .filter((i) => (i.status === "open" || i.status === "unresolved") && daysSince(i.updatedAt) >= 14)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 3)) {
    items.push({
      id: `inq:${iq.id}`,
      section: "Questions still open",
      title: snippet(iq.question),
      invitation: `Untouched since ${new Date(iq.updatedAt).toLocaleDateString()}. It's fine to leave it — or to look again.`,
      href: `/inquiry/${iq.id}`,
    });
  }

  // Beliefs not revisited recently — only meaningful at longer horizons.
  if (period !== "today" && period !== "week") {
    for (const b of state.beliefs
      .filter((b) => b.status !== "rejected" && b.status !== "questioned" && daysSince(b.updatedAt) >= 60)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
      .slice(0, 3)) {
      const d = Math.floor(daysSince(b.updatedAt));
      items.push({
        id: `old:${b.id}`,
        section: "Beliefs you haven't revisited",
        title: snippet(b.text),
        invitation: `You haven't returned to this in ${d} days. Still yours, as written?`,
        href: "/beliefs",
      });
    }
  }

  // Threads growing quickly.
  for (const t of state.megathreads
    .filter((t) => t.status === "active" && t.members.length >= 4 && inWindow(t.updatedAt))
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 2)) {
    items.push({
      id: `thr:${t.id}`,
      section: "Threads gathering weight",
      title: snippet(t.title, 60),
      invitation: `${t.members.length} pieces now feed this. What is it becoming for you?`,
      href: `/threads/${t.id}`,
    });
  }

  return { period, windowDays: win, items };
}
