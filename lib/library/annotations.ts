/**
 * Annotations & notes (LIFEOS-028, Feature 5).
 *
 * Deterministic factories for passage annotations (markdown notes attached to a
 * passage). Editing an annotation never touches the source passage text — notes
 * are separate records. Section and document notes are plain markdown strings on
 * those entities (handled by the store); this module owns passage annotations.
 */

import type { Annotation } from "@/types/mvp";
import { safeHref, EXTERNAL_LINK_REL } from "@/lib/security/safe-url";

export function makeAnnotation(passageId: string, text: string, ctx: { id: () => string; now: () => string }): Annotation | null {
  const body = text.trim();
  if (!body) return null;
  const at = ctx.now();
  return { id: ctx.id(), passageId, text: body, createdAt: at, updatedAt: at };
}

/**
 * A very small, safe markdown → HTML renderer (bold, italic, code, links, line
 * breaks). Security (LIFEOS-040, Feature 5): the whole string is HTML-escaped
 * FIRST — including quotes — so no user text can inject an attribute or tag.
 * Link URLs are then routed through the centralized `safeHref` allowlist, so
 * only http(s)/mailto links become anchors; anything else renders as the plain
 * bracket text. This closes the attribute-injection hole a naive
 * `href="$url"` substitution would leave open.
 */
export function renderMarkdownInline(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return esc(md)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
      // `url` is already HTML-escaped; decode &amp; back for parsing only.
      const decoded = url.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const href = safeHref(decoded);
      if (!href) return `[${label}](${url})`; // unsafe/relative → plain text, no anchor
      const safe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return `<a href="${safe}" rel="${EXTERNAL_LINK_REL}" target="_blank">${label}</a>`;
    })
    .replace(/\n/g, "<br/>");
}
