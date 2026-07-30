/**
 * Maintenance preferences (LIFEOS-038, Feature 17).
 *
 * UI/decision memory only — review filters, sort, dashboard layout, dismissed
 * review-item ids, and a fast mirror of ignored duplicate ids. Stored in
 * `prefs.maintenance` (LIFEOS-025) and mirrored to `user_prefs` when signed in,
 * so it follows the user across devices. The durable maintenance record
 * (events, duplicate decisions) lives in the store, not here.
 */

import { readPrefs, writePrefs, type Prefs } from "@/lib/prefs";

export type MaintenancePrefs = NonNullable<Prefs["maintenance"]>;

export function readMaintenancePrefs(): MaintenancePrefs {
  return readPrefs().maintenance ?? {};
}

export function writeMaintenancePrefs(patch: Partial<MaintenancePrefs>): void {
  const current = readMaintenancePrefs();
  writePrefs({ maintenance: { ...current, ...patch } });
}

/** Review-queue item ids the user hid. */
export function dismissedItems(): string[] {
  return readMaintenancePrefs().dismissed ?? [];
}

/** Hide a derived review item (no durable record). Union — never duplicates. */
export function dismissItem(id: string): void {
  const set = new Set(dismissedItems());
  set.add(id);
  writeMaintenancePrefs({ dismissed: [...set] });
}

/** Un-hide a previously dismissed item. */
export function undismissItem(id: string): void {
  writeMaintenancePrefs({ dismissed: dismissedItems().filter((x) => x !== id) });
}

/** Mirror an ignored duplicate id for fast suppression (source of truth is the record). */
export function rememberIgnoredDuplicate(id: string): void {
  const set = new Set(readMaintenancePrefs().ignoredDuplicateIds ?? []);
  set.add(id);
  writeMaintenancePrefs({ ignoredDuplicateIds: [...set] });
}
