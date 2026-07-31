/**
 * Live-region announcements (LIFEOS-041, Features 27/29).
 *
 * A tiny module-level store two aria-live regions subscribe to (polite +
 * assertive). Toasts, save confirmations, and errors announce through here so
 * screen-reader users are never left guessing. Never announces record contents.
 */
import { useSyncExternalStore } from "react";
import { redactMessage } from "@/lib/security/redaction";

export type Politeness = "polite" | "assertive";
export interface Announcement { id: number; message: string; politeness: Politeness; at: number }

let polite = "";
let assertive = "";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Announce a message (redacted so no secret/content leaks to the a11y tree). */
export function announce(message: string, politeness: Politeness = "polite"): void {
  const safe = redactMessage(message, 200);
  if (politeness === "assertive") assertive = safe; else polite = safe;
  emit();
  // Clear shortly so repeated identical messages re-announce.
  setTimeout(() => { if (politeness === "assertive") assertive = ""; else polite = ""; emit(); }, 1200);
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
function snapshot(): { polite: string; assertive: string } { return CACHE; }
let CACHE = { polite: "", assertive: "" };
function refresh() { CACHE = { polite, assertive }; }
const wrapped = () => { refresh(); return snapshot(); };
const SERVER = { polite: "", assertive: "" };

export function useAnnouncements(): { polite: string; assertive: string } {
  return useSyncExternalStore(subscribe, wrapped, () => SERVER);
}
