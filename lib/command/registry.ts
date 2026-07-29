/**
 * Command registry (LIFEOS-027).
 *
 * An EXTENSIBLE registry so future modules can contribute commands without
 * rewriting the palette: register a static list or a provider function, then
 * `build(ctx)` merges them all, in registration order, de-duplicated by id
 * (first registration wins — a later provider can never clobber a built-in).
 * Deterministic: the same context always yields the same ordered list.
 */

import type { StoreState } from "@/types/mvp";
import type { CommandItem, PinnedItem, RecentItem } from "@/lib/command/types";
import {
  continueProvider, pinnedProvider, recentProvider, staticCommands, workspacesProvider, executionProvider, reviewProvider, inboxProvider, actionsProvider, planningProvider,
} from "@/lib/command/commands";

/** Everything a provider may read to produce commands. Read-only. */
export interface CommandContext {
  state: StoreState;
  recent: RecentItem[];
  pinned: PinnedItem[];
}

export type CommandProvider = (ctx: CommandContext) => CommandItem[];

export class CommandRegistry {
  private providers: CommandProvider[] = [];

  /** Register a provider function (evaluated lazily at build time). */
  register(provider: CommandProvider): this {
    this.providers.push(provider);
    return this;
  }

  /** Register a fixed list of commands (convenience over `register`). */
  registerStatic(items: CommandItem[]): this {
    this.providers.push(() => items);
    return this;
  }

  /** Merge every provider's output, de-duplicating by id (first wins). */
  build(ctx: CommandContext): CommandItem[] {
    const seen = new Set<string>();
    const out: CommandItem[] = [];
    for (const provider of this.providers) {
      for (const item of provider(ctx)) {
        if (seen.has(item.id)) continue; // duplicate prevention
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }
}

/**
 * The default registry: pinned first (fast access to favorites), then recent,
 * then continue-work, then the static navigation / create / action commands.
 * The order sets the default (empty-query) palette listing.
 */
export function defaultRegistry(): CommandRegistry {
  return new CommandRegistry()
    .register(pinnedProvider)
    .register(recentProvider)
    .register(workspacesProvider)
    .register(executionProvider)
    .register(reviewProvider)
    .register(inboxProvider)
    .register(actionsProvider)
    .register(planningProvider)
    .register(continueProvider)
    .registerStatic(staticCommands());
}

/** Build the default command list for a context in one call. */
export function buildCommands(ctx: CommandContext): CommandItem[] {
  return defaultRegistry().build(ctx);
}

/** Convenience context builder for callers that only have the store. */
export function makeContext(state: StoreState, recent: RecentItem[], pinned: PinnedItem[]): CommandContext {
  return { state, recent, pinned };
}
