/**
 * Development-surface lockdown (LIFEOS-040, Feature 29).
 *
 * Every /dev/* self-test route lives under this server-component layout. In a
 * production build these surfaces are NOT reachable: we call notFound() unless
 * LIFEOS_ENABLE_DEV_ROUTES=1 is deliberately set.
 *
 * Note what that flag actually does, because the wording here used to overstate
 * it (LIFEOS-050C): it is honored **in production too**. It is an escape hatch
 * for running the regression harness against a production build, not a
 * non-production-only switch, and setting it on a deployment testers can reach
 * will expose /dev there. Leave it unset everywhere else. Outside production
 * (next dev), /dev is always available and the flag is irrelevant.
 */

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === "production";
  const deliberatelyEnabled = process.env.LIFEOS_ENABLE_DEV_ROUTES === "1";
  if (isProd && !deliberatelyEnabled) notFound();
  return <>{children}</>;
}
