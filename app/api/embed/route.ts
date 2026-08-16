/**
 * Embedding route (LIFEOS-015, Phases 2/9/10).
 *
 * POST { texts: string[] } -> { provider, model, dimensions, source, vectors }
 * GET -> embedding provider health.
 *
 * Provider-independent: if EMBEDDING_API_KEY + EMBEDDING_PROVIDER_URL are set,
 * it calls that OpenAI-compatible /embeddings endpoint; otherwise it returns
 * deterministic LOCAL vectors so the whole indexing flow works with no
 * configuration. Credentials are server-only and NEVER sent to the browser;
 * source text is NEVER logged.
 */

import { NextResponse } from "next/server";
import { LOCAL_DIMENSIONS, LOCAL_MODEL, LOCAL_PROVIDER, localEmbed } from "@/lib/embeddings/local";
import { guardCostBearingRoute, rateLimit } from "@/lib/security/api-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TEXTS = 128;
const MAX_CHARS = 8_000;
const REQUEST_TIMEOUT_MS = 25_000;

interface ProviderConfig {
  url: string;
  key: string;
  model: string;
  dimensions: number;
}

function providerConfig(): ProviderConfig | null {
  const url = process.env.EMBEDDING_PROVIDER_URL;
  const key = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (!url || !key || !model) return null;
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS) || 1536;
  return { url, key, model, dimensions };
}

export async function GET() {
  const cfg = providerConfig();
  if (cfg) {
    return NextResponse.json({
      configured: true,
      provider: "http",
      model: cfg.model,
      dimensions: cfg.dimensions,
    });
  }
  return NextResponse.json({
    configured: false,
    provider: LOCAL_PROVIDER,
    model: LOCAL_MODEL,
    dimensions: LOCAL_DIMENSIONS,
  });
}

async function callProvider(cfg: ProviderConfig, texts: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`embed_${res.status}`);
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vectors = (data.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== texts.length) throw new Error("embed_count_mismatch");
    return vectors;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  // Same cost boundary as /api/ai: a configured embedding provider is billable.
  const guard = await guardCostBearingRoute(request, [process.env.EMBEDDING_API_KEY]);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 503 ? "Embedding is unavailable right now." : "Sign in to use this feature." },
      { status: guard.status },
    );
  }
  if (guard.userId) {
    const rl = rateLimit(guard.userId);
    if (rl.limited) {
      return NextResponse.json({ error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } });
    }
  }

  let texts: string[];
  try {
    const body = (await request.json()) as { texts?: unknown };
    texts = Array.isArray(body.texts)
      ? body.texts
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.slice(0, MAX_CHARS))
          .slice(0, MAX_TEXTS)
      : [];
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (texts.length === 0) return NextResponse.json({ error: "no texts" }, { status: 400 });

  const cfg = providerConfig();
  if (cfg) {
    try {
      const vectors = await callProvider(cfg, texts);
      return NextResponse.json({
        provider: "http",
        model: cfg.model,
        dimensions: cfg.dimensions,
        source: "provider",
        vectors,
      });
    } catch (e) {
      // Degrade to local rather than failing the whole indexing run.
      const reason = e instanceof Error ? e.message : "unknown";
      console.error(`[embed] provider failed: ${reason}; serving local`);
    }
  }

  return NextResponse.json({
    provider: LOCAL_PROVIDER,
    model: LOCAL_MODEL,
    dimensions: LOCAL_DIMENSIONS,
    source: "local",
    vectors: texts.map(localEmbed),
  });
}
