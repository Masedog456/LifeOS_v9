/**
 * Session activity tracking bridge (LIFEOS-030, Feature 5).
 *
 * Ergonomic, side-effect-free-if-no-session wrappers the UI calls to feed the
 * ACTIVE session's timeline: opening an entity or document, searching, capturing,
 * editing a belief/decision, reading, using the inspector or command center. Each
 * just builds a candidate event and hands it to `recordSessionActivity`, which
 * no-ops when no session is active and dedupes repeats. Timeline only — nothing
 * here scores, ranks, or calls AI. Kept out of the pure `activity.ts` so that
 * module has zero store dependency.
 */

import { recordSessionActivity } from "@/lib/mvpStore";
import { entityKindLabel } from "@/lib/entities/entity";

export function trackOpenEntity(kind: string, id: string, title?: string): void {
  recordSessionActivity({
    type: "opened_entity",
    entityKind: kind,
    entityId: id,
    label: `Opened ${entityKindLabel(kind).toLowerCase()}${title ? `: ${title}` : ""}`,
    detail: title,
  });
}

export function trackInspect(kind: string, id: string, title?: string): void {
  recordSessionActivity({
    type: "inspector",
    entityKind: kind,
    entityId: id,
    label: `Inspected ${entityKindLabel(kind).toLowerCase()}${title ? `: ${title}` : ""}`,
    detail: title,
  });
}

export function trackOpenDocument(documentId: string, title?: string): void {
  recordSessionActivity({
    type: "opened_document",
    entityKind: "document",
    entityId: documentId,
    label: `Opened document${title ? `: ${title}` : ""}`,
    detail: title,
  });
}

export function trackReading(documentId: string, title?: string): void {
  recordSessionActivity({
    type: "reading",
    entityKind: "document",
    entityId: documentId,
    label: `Read${title ? ` ${title}` : ""}`,
    detail: title,
  });
}

export function trackSearch(query: string): void {
  const q = query.trim();
  if (!q) return;
  recordSessionActivity({ type: "search", label: `Searched “${q}”`, detail: q });
}

export function trackCapture(captureId: string, text?: string): void {
  recordSessionActivity({
    type: "capture_created",
    entityKind: "capture",
    entityId: captureId,
    label: "Captured a thought",
    detail: text,
  });
}

export function trackBeliefEdit(beliefId: string, text?: string): void {
  recordSessionActivity({
    type: "belief_edited",
    entityKind: "belief",
    entityId: beliefId,
    label: "Edited a belief",
    detail: text,
  });
}

export function trackDecisionEdit(decisionId: string, title?: string): void {
  recordSessionActivity({
    type: "decision_edited",
    entityKind: "decision",
    entityId: decisionId,
    label: `Worked on decision${title ? `: ${title}` : ""}`,
    detail: title,
  });
}

export function trackCommand(commandTitle: string): void {
  recordSessionActivity({ type: "command", label: `Ran: ${commandTitle}`, detail: commandTitle });
}
