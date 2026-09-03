"use client";
/** Personal Code (LIFEOS-079) — a view over Constitution standards and Protocols. */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PersonalCodePage from "@/components/code/PersonalCodePage";
import { readHandoff } from "@/lib/code/handoff";

/**
 * The route owns the query string; the page owns the rules (LIFEOS-080 §6).
 *
 * A rule handed over from Capture arrives as `?rule=…&from=…`. Reading it here
 * keeps `PersonalCodePage` a pure function of props and store, and keeps the URL
 * contract in `lib/code/handoff.ts` where both ends can see it.
 */
function PersonalCodeRoute() {
  const params = useSearchParams();
  return <PersonalCodePage handoff={readHandoff((k) => params.get(k))} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10" />}>
      <PersonalCodeRoute />
    </Suspense>
  );
}
