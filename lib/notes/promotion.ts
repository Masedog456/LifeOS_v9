/**
 * Note promotion (LIFEOS-052).
 *
 * A Note may LATER become something more formal — but it never has to. The
 * single most important behavior in this module is the one it does not perform:
 * nothing here promotes automatically, on a schedule, or by inference.
 *
 * A PURE planner, deliberately the same shape as `lib/inbox/conversion.ts`: it
 * describes the available promotions and builds a preview. The store performs
 * creation by reusing the existing canonical creators, so promotion adds no
 * second way to make a concept, a question, or a practice.
 *
 * ## Why the list is short
 *
 * Only promotions that reuse an existing creator are offered. "Every possible
 * conversion" would re-create the eleven-destination front door one layer down,
 * which is the problem this sprint exists to fix.
 *
 * "Question" was requested in the brief conditionally — "if such target currently
 * exists" — and it does not. `Inquiry` is the OUTPUT of a dialectical analysis
 * run (`saveInquiry` persists a completed one); there is no simple
 * question-creator to reuse, and inventing one to satisfy a menu entry would add
 * exactly the parallel implementation this module exists to avoid. `Inquiry` is
 * likewise absent from `convertCapture`'s targets, so there is no precedent for
 * it either.
 *
 * Next action is deliberately NOT in this list. The Capture → NextAction route
 * already exists (`/actions?fromCapture=`, `inheritFromCapture`,
 * `createActionFromCapture`) and project memory (candidate H) is explicit that a
 * second route to the same record is how two subtly different behaviors get
 * born. The Notes UI links to that existing flow instead.
 */

import type { Note, StoreState } from "@/types/mvp";
import { noteDisplayTitle } from "@/lib/notes/notes";

export type NotePromotionKey = "concept" | "practice" | "project_note";

export interface NotePromotion {
  key: NotePromotionKey;
  label: string;
  /** The entity kind the created record resolves to (for links/inspector). */
  entityKind: string;
  /** When set, the user must pick a target project first. */
  needsContext?: "project";
  description: string;
}

/**
 * The promotions a Note supports. Each maps onto a creator that already exists
 * and is already tested; none introduces a new record type.
 */
export const NOTE_PROMOTIONS: NotePromotion[] = [
  { key: "concept", label: "Knowledge", entityKind: "concept", description: "Name it as a concept in your world model." },
  { key: "practice", label: "Practice", entityKind: "practice", description: "Make it a recurring practice." },
  { key: "project_note", label: "Project note", entityKind: "project", needsContext: "project", description: "Append it as a note on a project." },
];

export function findPromotion(key: NotePromotionKey): NotePromotion | undefined {
  return NOTE_PROMOTIONS.find((p) => p.key === key);
}

export interface PromotionField { label: string; value: string }

export interface NotePromotionPreview {
  promotionKey: NotePromotionKey;
  promotionLabel: string;
  entityKind: string;
  needsContext?: "project";
  /** The fields that will be copied onto the new record. */
  copiedFields: PromotionField[];
  /** The note that will be linked from the new record. */
  sourceNoteId: string;
  /** Human description of what happens to the note itself. */
  remainsOnOriginal: string;
}

/**
 * Build a deterministic promotion preview. Never mutates, never creates.
 *
 * The note is ALWAYS preserved. Promotion is additive — it produces a new record
 * that links back, and leaves the note exactly where it was. A user who promotes
 * a note to a Question still has the note, because the informal version is often
 * the useful one.
 */
export function previewPromotion(
  state: StoreState,
  note: Note,
  key: NotePromotionKey,
  contextId?: string,
): NotePromotionPreview | null {
  const promotion = findPromotion(key);
  if (!promotion) return null;
  if (promotion.needsContext === "project" && !contextId) {
    // Still previewable — the UI shows what will happen before a project is picked.
    void state;
  }
  const title = noteDisplayTitle(note);
  const body = (note.body ?? "").trim();
  const fields: PromotionField[] = [];

  switch (key) {
    case "concept": fields.push({ label: "Name", value: title }, { label: "Definition", value: body }); break;
    case "practice": fields.push({ label: "Practice", value: title }, { label: "Detail", value: body }); break;
    case "project_note": fields.push({ label: "Note", value: body || title }); break;
  }

  return {
    promotionKey: key,
    promotionLabel: promotion.label,
    entityKind: promotion.entityKind,
    needsContext: promotion.needsContext,
    copiedFields: fields,
    sourceNoteId: note.id,
    remainsOnOriginal: "Your note stays exactly as it is. The new record links back to it.",
  };
}
