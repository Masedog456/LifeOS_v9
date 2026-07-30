/**
 * Built-in commands & providers (LIFEOS-027).
 *
 * The static command set (navigation, creation, actions) plus dynamic providers
 * that read the store/context (continue unfinished work, recent, pinned). These
 * are the defaults registered by `defaultRegistry()`; other modules can register
 * more without touching the palette. "Create" commands only NAVIGATE to the
 * existing canonical creation flow — they never re-implement a creation form or
 * duplicate business logic. "Continue" reuses the LIFEOS-026 projection.
 */

import type { StoreState } from "@/types/mvp";
import type { CommandContext } from "@/lib/command/registry";
import type { CommandItem } from "@/lib/command/types";
import { buildContinueThinking } from "@/lib/memory/continue";
import { RECORD_LABELS, resolveRecord } from "@/lib/command/records";
import { todayKey } from "@/lib/reviews/dates";
import { findReviewByDate, latestCompletedReview, reviewHref } from "@/lib/reviews/review";
import { readInboxMemory } from "@/lib/inbox/memory";

/** Feature 1 — navigate to any major section. */
export const NAV_COMMANDS: CommandItem[] = [
  { id: "nav:today", title: "Open Today", group: "Navigate", kind: "navigate", href: "/today", icon: "◎", keywords: ["home", "daily", "dashboard"] },
  { id: "nav:capture", title: "Open Capture", group: "Navigate", kind: "navigate", href: "/", icon: "✎", keywords: ["note", "thought"] },
  { id: "nav:inbox", title: "Open Belief Inbox", group: "Navigate", kind: "navigate", href: "/inbox", icon: "▤", keywords: ["proposals", "judge"] },
  { id: "nav:library", title: "Open Library", group: "Navigate", kind: "navigate", href: "/library", icon: "▦", keywords: ["sources"] },
  { id: "nav:reading", title: "Open Reading", group: "Navigate", kind: "navigate", href: "/reading", icon: "❧", keywords: ["documents", "books", "read", "library"] },
  { id: "nav:world", title: "Open World Model", group: "Navigate", kind: "navigate", href: "/world", icon: "◍", keywords: ["concepts", "graph"] },
  { id: "nav:constitution", title: "Open Constitution", group: "Navigate", kind: "navigate", href: "/constitution", icon: "§", keywords: ["beliefs"] },
  { id: "nav:compare", title: "Open Compare", group: "Navigate", kind: "navigate", href: "/compare", icon: "⇌" },
  { id: "nav:inquiry", title: "Open Inquiry", group: "Navigate", kind: "navigate", href: "/inquiry", icon: "?", keywords: ["questions"] },
  { id: "nav:threads", title: "Open Threads", group: "Navigate", kind: "navigate", href: "/threads", icon: "≣", keywords: ["megathreads"] },
  { id: "nav:reason", title: "Open Reason", group: "Navigate", kind: "navigate", href: "/reason", icon: "∴" },
  { id: "nav:research", title: "Open Research", group: "Navigate", kind: "navigate", href: "/research", icon: "⚗", keywords: ["investigate"] },
  { id: "nav:dialogue", title: "Open Dialogue", group: "Navigate", kind: "navigate", href: "/dialogue", icon: "❝", keywords: ["socratic", "dialectic", "tensions"] },
  { id: "nav:author", title: "Open Author", group: "Navigate", kind: "navigate", href: "/author", icon: "✍", keywords: ["write", "knowledge project"] },
  { id: "nav:formation", title: "Open Reflect", group: "Navigate", kind: "navigate", href: "/formation", icon: "❋", keywords: ["formation", "practice"] },
  { id: "nav:review", title: "Open Review", group: "Navigate", kind: "navigate", href: "/review", icon: "↻" },
  { id: "nav:decisions", title: "Open Decisions", group: "Navigate", kind: "navigate", href: "/decisions", icon: "⚖", keywords: ["decide"] },
  { id: "nav:orchestrator", title: "Open LifeOS Inbox (Orchestrator)", group: "Navigate", kind: "navigate", href: "/orchestrator", icon: "✦", keywords: ["recommendations"] },
  { id: "nav:memory", title: "Open Living Memory", group: "Navigate", kind: "navigate", href: "/memory", icon: "❂", keywords: ["resurface"] },
  { id: "nav:timeline", title: "Open Insight Timeline", group: "Navigate", kind: "navigate", href: "/timeline", icon: "⇋", keywords: ["evolution", "history"] },
  { id: "nav:themes", title: "Open Themes", group: "Navigate", kind: "navigate", href: "/themes", icon: "☷", keywords: ["recurring"] },
  { id: "nav:health", title: "Open System Health", group: "Navigate", kind: "navigate", href: "/health", icon: "♥", keywords: ["settings", "status", "diagnostics"] },
  { id: "nav:workspaces", title: "Open Workspaces", group: "Navigate", kind: "navigate", href: "/workspaces", icon: "◲", keywords: ["workspace", "project", "session", "switch"] },
  { id: "nav:goals", title: "Open Goals", group: "Navigate", kind: "navigate", href: "/goals", icon: "◎", keywords: ["goal", "objective", "accomplish", "execution"] },
  { id: "nav:projects", title: "Open Projects", group: "Navigate", kind: "navigate", href: "/projects", icon: "▤", keywords: ["project", "work", "execution", "milestone"] },
  { id: "nav:daily", title: "Open Daily Review", group: "Navigate", kind: "navigate", href: "/daily", icon: "☑", keywords: ["review", "reflect", "plan", "daily", "wins", "lessons"] },
  { id: "nav:process", title: "Open capture inbox", group: "Navigate", kind: "navigate", href: "/process", icon: "▤", keywords: ["inbox", "process", "capture", "clarify", "convert", "zero"] },
  { id: "nav:actions", title: "Open action queue", group: "Navigate", kind: "navigate", href: "/actions", icon: "☑", keywords: ["next", "actions", "todo", "tasks", "do", "commitments", "queue"] },
  { id: "action:new", title: "New action", group: "Navigate", kind: "navigate", href: "/actions?new=1", icon: "＋", keywords: ["create", "next action", "task", "todo", "add"] },
  { id: "nav:plan", title: "Open planning board", group: "Navigate", kind: "navigate", href: "/plan", icon: "▤", keywords: ["plan", "board", "horizon", "today", "week", "later", "someday"] },
  { id: "nav:today-plan", title: "Open Today Plan", group: "Navigate", kind: "navigate", href: "/plan/today", icon: "◎", keywords: ["today", "plan", "focus"] },
  { id: "nav:commitments", title: "Open commitment review", group: "Navigate", kind: "navigate", href: "/plan/commitments", icon: "≣", keywords: ["commitments", "review", "overloaded"] },
  { id: "nav:planning-inbox", title: "Open planning inbox", group: "Navigate", kind: "navigate", href: "/plan/inbox", icon: "▦", keywords: ["planning", "inbox", "unplanned", "decide"] },
  { id: "nav:focus", title: "Start focus", group: "Navigate", kind: "navigate", href: "/focus", icon: "◉", keywords: ["focus", "concentrate", "deep work", "session"] },
  { id: "nav:daily-history", title: "Open Review History", group: "Navigate", kind: "navigate", href: "/daily/history", icon: "≡", keywords: ["review", "history", "past", "weekly"] },
  { id: "nav:maintenance", title: "Open Knowledge Health", group: "Navigate", kind: "navigate", href: "/maintenance", icon: "❦", keywords: ["maintenance", "health", "integrity", "orphan", "cleanup", "quality"] },
  { id: "nav:review-queue", title: "Open Review Queue", group: "Navigate", kind: "navigate", href: "/maintenance/review", icon: "▣", keywords: ["maintenance", "review", "queue", "cleanup"] },
  { id: "nav:duplicates", title: "Review Duplicates", group: "Navigate", kind: "navigate", href: "/maintenance/duplicates", icon: "⧉", keywords: ["duplicate", "merge", "same", "duplicates"] },
  { id: "nav:evidence", title: "Review Evidence", group: "Navigate", kind: "navigate", href: "/maintenance/evidence", icon: "❡", keywords: ["evidence", "citations", "uncited", "sources"] },
  { id: "nav:relationships-integrity", title: "Repair Relationships", group: "Navigate", kind: "navigate", href: "/maintenance/relationships", icon: "⌘", keywords: ["relationship", "integrity", "broken", "repair", "dangling"] },
  { id: "nav:citations-integrity", title: "Review Citations", group: "Navigate", kind: "navigate", href: "/maintenance/citations", icon: "❞", keywords: ["citation", "integrity", "broken", "repair"] },
  { id: "nav:archive-review", title: "Archive Candidates", group: "Navigate", kind: "navigate", href: "/maintenance/archive", icon: "⊟", keywords: ["archive", "candidates", "finished", "completed"] },
  { id: "nav:merge-workspace", title: "Merge Records", group: "Navigate", kind: "navigate", href: "/maintenance/merge", icon: "⧈", keywords: ["merge", "records", "consolidate", "duplicate"] },
];

/** Feature 6 — Create Anything: each opens the existing canonical creation flow. */
export const CREATE_COMMANDS: CommandItem[] = [
  { id: "create:capture", title: "New capture", group: "Create", kind: "action", action: "quick-capture", icon: "＋", keywords: ["note", "thought", "quick"], shortcut: "⇧⌘K" },
  { id: "create:document", title: "New document", group: "Create", kind: "create", href: "/reading?new=1", icon: "＋", keywords: ["import", "read", "book", "article", "paste"] },
  { id: "create:belief", title: "New belief", group: "Create", kind: "create", href: "/inbox", icon: "＋", keywords: ["constitution", "principle"] },
  { id: "create:concept", title: "New concept", group: "Create", kind: "create", href: "/world?new=1", icon: "＋", keywords: ["world model"] },
  { id: "create:dialogue", title: "New dialogue", group: "Create", kind: "create", href: "/dialogue?new=1", icon: "＋", keywords: ["socratic", "investigate"] },
  { id: "create:research", title: "New research item", group: "Create", kind: "create", href: "/research?new=1", icon: "＋", keywords: ["investigate", "question"] },
  { id: "create:decision", title: "New decision", group: "Create", kind: "create", href: "/decisions?new=1", icon: "＋", keywords: ["decide", "choice"] },
  { id: "create:question", title: "New question", group: "Create", kind: "create", href: "/inquiry?new=1", icon: "＋", keywords: ["inquiry"] },
  { id: "create:synthesis", title: "New synthesis", group: "Create", kind: "create", href: "/dialogue", icon: "＋", keywords: ["dialectic", "integrate"] },
  { id: "create:workspace", title: "New workspace", group: "Create", kind: "create", href: "/workspaces?new=1", icon: "＋", keywords: ["project", "area", "group"] },
  { id: "create:goal", title: "New goal", group: "Create", kind: "create", href: "/goals?new=1", icon: "＋", keywords: ["objective", "accomplish", "execution"] },
  { id: "create:project", title: "New project", group: "Create", kind: "create", href: "/projects?new=1", icon: "＋", keywords: ["work", "execution", "milestone"] },
];

/** Feature 1 + 8 — common actions and system entry points. */
export const ACTION_COMMANDS: CommandItem[] = [
  { id: "action:quick-capture", title: "Quick capture", group: "Actions", kind: "action", action: "quick-capture", icon: "✎", shortcut: "⇧⌘K", keywords: ["new capture", "note"] },
  { id: "action:shortcuts", title: "Keyboard shortcuts", group: "Actions", kind: "action", action: "shortcut-help", icon: "⌨", shortcut: "?", keywords: ["help", "keys", "hotkeys"] },
  { id: "action:health", title: "System health & settings", group: "Actions", kind: "navigate", href: "/health", icon: "♥", keywords: ["settings", "status"] },
  { id: "action:end-session", title: "End current session", group: "Actions", kind: "action", action: "end-session", icon: "◼", keywords: ["stop", "finish", "session", "workspace"] },
];

/** All static commands, in display priority. */
export function staticCommands(): CommandItem[] {
  return [...NAV_COMMANDS, ...CREATE_COMMANDS, ...ACTION_COMMANDS];
}

/** Feature 7 — Continue Work, consuming the LIFEOS-026 projection engine. */
export function continueProvider(ctx: CommandContext): CommandItem[] {
  const CONTINUE_VERB: Record<string, string> = {
    dialogue: "Continue dialogue", research: "Continue research", tension: "Review tension",
    belief_review: "Review belief", synthesis: "Complete synthesis", decision: "Revisit decision",
  };
  // Continue items are "resume work" links; they carry a prefixed projection id
  // (not a raw record id), so they are intentionally NOT pinnable/recordable —
  // only `href` is exposed. Activation just navigates.
  return buildContinueThinking(ctx.state).slice(0, 12).map((c) => ({
    id: `continue:${c.id}`,
    title: `${CONTINUE_VERB[c.kind] ?? "Continue"}: ${c.title}`,
    subtitle: c.reason,
    group: "Continue",
    kind: "continue" as const,
    href: c.href,
    icon: "▸",
  }));
}

/** Recently-viewed records as commands (Feature 3). */
export function recentProvider(ctx: CommandContext): CommandItem[] {
  return ctx.recent.slice(0, 12).map((r) => ({
    id: `recent:${r.kind}:${r.id}`,
    title: r.title,
    subtitle: RECORD_LABELS[r.kind] ?? r.kind,
    group: "Recent",
    kind: "record" as const,
    recordKind: r.kind,
    recordId: r.id,
    icon: "◷",
  }));
}

/** Pinned/favorite records as commands (Feature 4). */
export function pinnedProvider(ctx: CommandContext): CommandItem[] {
  return ctx.pinned.map((p) => ({
    id: `pinned:${p.kind}:${p.id}`,
    title: p.title,
    subtitle: RECORD_LABELS[p.kind] ?? p.kind,
    group: "Pinned",
    kind: "record" as const,
    recordKind: p.kind,
    recordId: p.id,
    icon: "★",
  }));
}

/** Convenience: the current record href for a record command (recent/pinned/continue). */
export function hrefForRecord(state: StoreState, kind: string, id: string): string | undefined {
  return resolveRecord(state, kind, id)?.href;
}

/**
 * Feature 9 — Switch / Resume goals and projects from the command center. Each
 * navigates to a dashboard where work is resumed. Active goals/projects first
 * (not completed/abandoned), then most-recently-updated. Deterministic.
 */
export function executionProvider(ctx: CommandContext): CommandItem[] {
  const items: CommandItem[] = [];
  const goals = [...(ctx.state.goals ?? [])]
    .filter((g) => g.status !== "completed" && g.status !== "abandoned")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const projects = [...(ctx.state.projects ?? [])]
    .filter((p) => p.status !== "completed" && p.status !== "abandoned")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  for (const g of goals.slice(0, 8)) {
    items.push({ id: `goal:${g.id}`, title: `Switch to goal: ${g.title}`, subtitle: g.description || undefined, group: "Goals", kind: "navigate", href: `/goal/${g.id}`, icon: "◎", keywords: ["goal", "switch", "resume", "execution"] });
  }
  for (const p of projects.slice(0, 8)) {
    items.push({ id: `project:${p.id}`, title: `Resume project: ${p.title}`, subtitle: p.description || undefined, group: "Projects", kind: "navigate", href: `/project/${p.id}`, icon: "▤", keywords: ["project", "resume", "switch", "milestone"] });
  }
  return items;
}

/**
 * LIFEOS-034, Feature 13 — Daily review commands, contextual to today's review
 * status. Start/Continue/Complete/Reopen all navigate to the review page (which
 * owns the buttons — no logic is duplicated here); history and resume-focus are
 * always available. Deterministic.
 */
export function reviewProvider(ctx: CommandContext): CommandItem[] {
  const today = todayKey();
  const todays = findReviewByDate(ctx.state, today);
  const status = todays?.status ?? "not_started";
  const items: CommandItem[] = [];

  if (status === "not_started" || !todays) {
    items.push({ id: "review:start", title: "Start daily review", group: "Review", kind: "navigate", href: "/daily", icon: "☑", keywords: ["reflect", "plan", "daily", "review"] });
  } else if (status === "in_progress" || status === "reopened") {
    items.push({ id: "review:continue", title: "Continue daily review", group: "Review", kind: "navigate", href: "/daily", icon: "☑", keywords: ["reflect", "resume", "daily", "review"] });
    items.push({ id: "review:complete", title: "Complete daily review", group: "Review", kind: "navigate", href: `/daily/${today}?step=complete`, icon: "✓", keywords: ["finish", "done", "daily", "review"] });
  } else if (status === "completed") {
    items.push({ id: "review:reopen", title: "Reopen daily review", group: "Review", kind: "navigate", href: `/daily/${today}`, icon: "↺", keywords: ["edit", "reopen", "daily", "review"] });
  }

  items.push({ id: "review:history", title: "Open review history", group: "Review", kind: "navigate", href: "/daily/history", icon: "≡", keywords: ["past", "reviews", "weekly", "history"] });

  const latest = latestCompletedReview(ctx.state);
  if (latest && latest.tomorrowFocus.length > 0) {
    items.push({ id: "review:resume-focus", title: "Resume tomorrow focus", subtitle: `From ${latest.date}`, group: "Review", kind: "navigate", href: reviewHref(latest.date), icon: "▸", keywords: ["focus", "next", "resume", "plan"] });
  }
  return items;
}

/**
 * LIFEOS-035, Feature 16 — Capture-processing commands. Inbox + process-next are
 * always available; per-capture actions appear only when a capture is active
 * (remembered in queue memory). Each navigates to the inbox/processor — no
 * processing logic is duplicated here.
 */
export function inboxProvider(ctx: CommandContext): CommandItem[] {
  const items: CommandItem[] = [];
  const inboxCount = (ctx.state.captures ?? []).filter((c) => (c.processingStatus ?? "inbox") === "inbox").length;
  if (inboxCount > 0) {
    items.push({ id: "inbox:next", title: "Process next capture", subtitle: `${inboxCount} in inbox`, group: "Inbox", kind: "navigate", href: "/process?process=next", icon: "▸", keywords: ["capture", "process", "clarify"] });
    items.push({ id: "inbox:oldest", title: "Process oldest capture", group: "Inbox", kind: "navigate", href: "/process?process=oldest", icon: "▾", keywords: ["capture", "process", "oldest"] });
  }
  items.push({ id: "inbox:archived", title: "Restore archived capture", group: "Inbox", kind: "navigate", href: "/process?view=archived", icon: "↺", keywords: ["archive", "restore", "capture"] });

  const activeId = typeof window !== "undefined" ? readInboxMemory().activeCaptureId : undefined;
  const active = activeId ? (ctx.state.captures ?? []).find((c) => c.id === activeId) : undefined;
  if (active) {
    const href = (a: string) => `/process/${active.id}?action=${a}`;
    items.push(
      { id: "inbox:defer-current", title: "Defer current capture", group: "Inbox", kind: "navigate", href: href("defer"), icon: "⏳", keywords: ["defer", "later", "capture"] },
      { id: "inbox:archive-current", title: "Archive current capture", group: "Inbox", kind: "navigate", href: href("archive"), icon: "▦", keywords: ["archive", "capture"] },
      { id: "inbox:link-current", title: "Link current capture", group: "Inbox", kind: "navigate", href: href("link"), icon: "🔗", keywords: ["link", "connect", "capture"] },
      { id: "inbox:convert-current", title: "Convert current capture", group: "Inbox", kind: "navigate", href: href("convert"), icon: "⤳", keywords: ["convert", "belief", "concept", "capture"] },
    );
  }
  return items;
}

/**
 * LIFEOS-036, Feature 18 — Next-action commands. Queue + start-next are always
 * available; per-context commands (start selected, complete/defer/wait current,
 * create from current capture/milestone) appear only when their context exists.
 * Each navigates into the action queue/detail — no lifecycle logic is duplicated.
 */
export function actionsProvider(ctx: CommandContext): CommandItem[] {
  const items: CommandItem[] = [];
  const actions = ctx.state.nextActions ?? [];
  const incomplete = actions.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  items.push({ id: "action:queue", title: "Open action queue", group: "Actions", kind: "navigate", href: "/actions", icon: "☑", keywords: ["next", "todo", "tasks"] });
  if (incomplete.length > 0) {
    items.push({ id: "action:start-next", title: "Start next action", subtitle: `${incomplete.length} open`, group: "Actions", kind: "navigate", href: "/actions?start=next", icon: "▸", keywords: ["begin", "do", "next"] });
  }
  const inProgress = actions.find((a) => a.status === "in_progress");
  if (inProgress) {
    items.push(
      { id: "action:complete-current", title: "Complete current action", subtitle: inProgress.title, group: "Actions", kind: "navigate", href: `/actions/${inProgress.id}?do=complete`, icon: "✓", keywords: ["done", "finish"] },
      { id: "action:defer-current", title: "Defer current action", group: "Actions", kind: "navigate", href: `/actions/${inProgress.id}?do=defer`, icon: "⏳", keywords: ["later", "postpone"] },
      { id: "action:wait-current", title: "Mark current action waiting", group: "Actions", kind: "navigate", href: `/actions/${inProgress.id}?do=wait`, icon: "◷", keywords: ["blocked", "waiting", "on"] },
    );
  }
  // Resume the most-recently-updated incomplete action.
  const resumeTarget = [...incomplete].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (resumeTarget && resumeTarget.status !== "in_progress") {
    items.push({ id: "action:resume-recent", title: "Resume recent action", subtitle: resumeTarget.title, group: "Actions", kind: "navigate", href: `/actions/${resumeTarget.id}`, icon: "↻", keywords: ["continue", "recent"] });
  }
  // Create from the active capture (queue memory) or milestone context.
  const activeCaptureId = typeof window !== "undefined" ? readInboxMemory().activeCaptureId : undefined;
  if (activeCaptureId && (ctx.state.captures ?? []).some((c) => c.id === activeCaptureId)) {
    items.push({ id: "action:from-capture", title: "Create action from current capture", group: "Actions", kind: "navigate", href: `/actions?fromCapture=${activeCaptureId}`, icon: "⤳", keywords: ["convert", "capture", "action"] });
  }
  return items;
}

/**
 * LIFEOS-037, Feature 17 — Planning & focus commands. Board/Today/commitment/
 * inbox navigation is always available; end-focus + move/remove-current-item
 * appear only when a valid current record/focus exists. Each navigates or ends
 * focus; no planning logic is duplicated here.
 */
export function planningProvider(ctx: CommandContext): CommandItem[] {
  const items: CommandItem[] = [];
  const focus = (ctx.state.focusSessions ?? []).find((f) => !f.endedAt);
  if (focus) {
    items.push({ id: "focus:end", title: "End focus", subtitle: focus.title, group: "Focus", kind: "navigate", href: "/focus?end=1", icon: "◌", keywords: ["stop", "exit", "focus"] });
    items.push({ id: "focus:open", title: "Open current focus", group: "Focus", kind: "navigate", href: "/focus", icon: "◉", keywords: ["focus", "resume"] });
  }
  // Focus the current in-progress action, if any.
  const inProgress = (ctx.state.nextActions ?? []).find((a) => a.status === "in_progress");
  if (inProgress && !focus) {
    items.push({ id: "focus:action", title: "Focus current action", subtitle: inProgress.title, group: "Focus", kind: "navigate", href: `/focus?kind=action&id=${inProgress.id}`, icon: "◉", keywords: ["focus", "action", "current"] });
  }
  return items;
}

/**
 * Feature 11 — Context switching: switch to / resume any workspace from the
 * command center. Each item navigates to a workspace dashboard, where sessions
 * are started/resumed. Active-first, then most-recently-updated; deterministic.
 */
export function workspacesProvider(ctx: CommandContext): CommandItem[] {
  const active = ctx.state.sessions?.find((s) => !s.endedAt);
  const workspaces = [...(ctx.state.workspaces ?? [])]
    .filter((w) => !w.archived)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return workspaces.slice(0, 12).map((w) => {
    const isActive = active?.workspaceId === w.id;
    return {
      id: `workspace:${w.id}`,
      title: `${isActive ? "Resume" : "Switch to"} workspace: ${w.name}`,
      subtitle: isActive ? "Active session" : (w.description || undefined),
      group: "Workspaces",
      kind: "navigate" as const,
      href: `/workspace/${w.id}`,
      icon: isActive ? "●" : "◲",
      keywords: ["workspace", "switch", "resume", "session", "project"],
    };
  });
}
