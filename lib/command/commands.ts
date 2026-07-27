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
