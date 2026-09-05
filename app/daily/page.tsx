"use client";

/**
 * `/daily` — kept as a redirect, not as a surface (LIFEOS-092 §5, §27).
 *
 * This route used to render a seven-step journaling wizard: a second, older
 * daily review that disagreed with the canonical one about what had happened
 * ("Actions completed · 2" against "3 completed · 1 deferred · 1 rescheduled"),
 * that wrote a `not_started` record the moment you opened it to look, and that
 * could note an open loop but never close one.
 *
 * It stays as a route because bookmarks and old links are real. It redirects
 * rather than 404s, and it renders nothing of its own on the way — the
 * canonical surface is `/today/review`.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DailyRedirectPage() {
  const router = useRouter();
  // `replace`, not `push`: a redirect should not put a dead route in the
  // history stack for Back to land on.
  useEffect(() => { router.replace("/today/review"); }, [router]);
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <p className="text-sm text-zinc-400">
        Taking you to today&apos;s review…{" "}
        <a href="/today/review" data-daily-redirect className="underline underline-offset-4">
          Review today
        </a>
      </p>
    </main>
  );
}
