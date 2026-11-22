/**
 * Server-side article extraction used by `/api/extract` (moved out of the
 * route in PR 1 so Next.js route files export only handlers, and so the
 * harness can drive it directly). Fetching goes only through `safeFetchText`.
 */

import { safeFetchText, SafeFetchError, SAFE_FETCH_DEFAULTS } from "@/lib/security/safe-fetch";

export const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = SAFE_FETCH_DEFAULTS.maxBytes; // ~3MB of HTML, after decompression
export const MAX_TEXT = 100_000;
const MIN_ARTICLE_CHARS = 200;
/** Request body cap. A URL request is tiny; anything larger is refused unread. */
export const MAX_REQUEST_BYTES = 8_192;
/** Per-user extractions a minute (per server instance). */
export const EXTRACT_RATE_LIMIT = 20;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
}

export function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : undefined;
}

/** Reduce an HTML document to readable body text — no dependency. */
export function htmlToText(html: string): string {
  const withoutHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // Turn block boundaries into newlines so paragraphs survive.
  const blocked = withoutHead
    .replace(/<\/(p|div|section|article|h[1-6]|li|br|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = decodeEntities(blocked.replace(/<[^>]+>/g, " "));
  return text
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()
    .slice(0, MAX_TEXT);
}

type ExtractResult = { text?: string; title?: string; needsText: boolean; note?: string };

export const NOTE_BY_CODE: Partial<Record<SafeFetchError["code"], string>> = {
  invalid_url: "That isn't a valid web address — paste the article text instead.",
  blocked_scheme: "Only http and https links can be fetched — paste the text instead.",
  blocked_credentials: "Links containing a username or password can't be fetched — paste the text instead.",
  blocked_port: "That link uses a port that can't be fetched — paste the text instead.",
  blocked_address: "That URL isn't fetchable — paste the article text instead.",
  too_many_redirects: "That page redirected too many times — paste the text instead.",
  timeout: "The page took too long to respond — paste the text instead.",
  too_large: "That page is too large to import — paste the text instead.",
};

export async function extractUrl(rawUrl: string): Promise<ExtractResult> {
  try {
    const res = await safeFetchText(rawUrl, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (res.status < 200 || res.status >= 300) {
      return { needsText: true, note: `Page returned ${res.status} — paste the text instead.` };
    }
    if (!/text\/html|application\/xhtml/i.test(res.contentType)) {
      return { needsText: true, note: "That link isn't an HTML article — paste the text instead." };
    }
    const text = htmlToText(res.body);
    if (text.length < MIN_ARTICLE_CHARS) {
      return {
        needsText: true,
        note: "Couldn't read enough text (the page may be JavaScript-rendered) — paste it instead.",
      };
    }
    return { text, title: extractTitle(res.body), needsText: false };
  } catch (e) {
    const note = e instanceof SafeFetchError ? NOTE_BY_CODE[e.code] : undefined;
    return { needsText: true, note: note ?? "Couldn't fetch the page — paste the article text instead." };
  }
}

