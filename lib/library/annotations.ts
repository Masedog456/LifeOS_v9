/**
 * Annotations & notes (LIFEOS-028, Feature 5).
 *
 * Deterministic factories for passage annotations (markdown notes attached to a
 * passage). Editing an annotation never touches the source passage text — notes
 * are separate records. Section and document notes are plain markdown strings on
 * those entities (handled by the store); this module owns passage annotations.
 */

import type { Annotation } from "@/types/mvp";

export function makeAnnotation(passageId: string, text: string, ctx: { id: () => string; now: () => string }): Annotation | null {
  const body = text.trim();
  if (!body) return null;
  const at = ctx.now();
  return { id: ctx.id(), passageId, text: body, createdAt: at, updatedAt: at };
}

/** A very small, safe markdown → HTML renderer (bold, italic, code, links, line breaks). */
export function renderMarkdownInline(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(md)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\n/g, "<br/>");
}
