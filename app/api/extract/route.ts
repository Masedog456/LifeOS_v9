/**
 * Extraction seam (LIFEOS-006). NOT an AI route — no model is called here.
 *
 *   POST { mode: "url", url }  -> { text, title, needsText } | { needsText, note }
 *   POST { mode: "pdf", ... }  -> { needsText, note }   (seam; auto-extraction TBD)
 *
 * URL extraction is dependency-free: fetch the page and reduce its HTML to
 * readable text. Anything it can't handle degrades to needsText so the
 * adapter falls back to a manual paste.
 *
 * ## Access (PR 1 hardening)
 *
 * This route makes the server fetch a URL chosen by the caller, so it is an
 * SSRF and open-proxy surface regardless of cost. It therefore:
 *
 *  - requires a signed-in user (`requireUser`), unlike the cost-linked policy
 *    of `/api/ai`. With Supabase unconfigured it answers 503 and the client
 *    falls back to "paste the text";
 *  - rate-limits per user (EXTRACT_RATE_LIMIT a minute, per instance);
 *  - caps the request body and URL length before parsing;
 *  - fetches only through `safeFetchText`, which checks every address at
 *    connection time (DNS rebinding / TOCTOU safe), follows redirects by hand
 *    with re-validation, and bounds time and response size.
 */

import { NextResponse } from "next/server";
import { requireUser, rateLimit } from "@/lib/security/api-auth";
import { SafeFetchError, validateOutboundUrl } from "@/lib/security/safe-fetch";
import { extractUrl, NOTE_BY_CODE, MAX_REQUEST_BYTES, EXTRACT_RATE_LIMIT } from "@/lib/ingestion/extract-server";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Read at most MAX_REQUEST_BYTES of the body; null if it is larger. */
async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "Import from a link is unavailable right now." : "Sign in to import from a link." },
      { status: auth.status },
    );
  }
  const limit = rateLimit(`extract:${auth.userId}`, Date.now(), EXTRACT_RATE_LIMIT);
  if (limit.limited) {
    return NextResponse.json(
      { error: "Too many imports. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = await readBoundedBody(request);
  if (raw === null) return NextResponse.json({ error: "request too large" }, { status: 413 });

  let mode = "";
  let url = "";
  try {
    const body = JSON.parse(raw) as { mode?: unknown; url?: unknown };
    mode = typeof body.mode === "string" ? body.mode : "";
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (mode === "url") {
    if (!url) return NextResponse.json({ needsText: true, note: "No URL provided." });
    // Refuse obviously bad input before any network activity.
    try {
      validateOutboundUrl(url);
    } catch (e) {
      const note = e instanceof SafeFetchError ? NOTE_BY_CODE[e.code] : undefined;
      return NextResponse.json({ needsText: true, note: note ?? "That URL isn't fetchable — paste the article text instead." });
    }
    return NextResponse.json(await extractUrl(url));
  }
  if (mode === "pdf") {
    // Seam: automatic PDF extraction is not enabled (no fragile dependency).
    return NextResponse.json({
      needsText: true,
      note: "Automatic PDF extraction isn't enabled yet — paste the text in the reader.",
    });
  }
  return NextResponse.json({ error: "invalid mode" }, { status: 400 });
}
