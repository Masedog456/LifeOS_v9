/**
 * Development-surface lockdown (LIFEOS-040, Feature 29).
 *
 * Every /dev/* self-test route lives under this server-component layout. In a
 * production build these surfaces are NOT reachable: we call notFound() unless a
 * deliberate, non-production flag (LIFEOS_ENABLE_DEV_ROUTES=1) is set — which
 * only the test/regression harness sets, never a normal production deployment.
 * Outside production (next dev), /dev is always available.
 */

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  const isProd = process.env.NODE_ENV === "production";
  const deliberatelyEnabled = process.env.LIFEOS_ENABLE_DEV_ROUTES === "1";
  if (isProd && !deliberatelyEnabled) notFound();
  return <>{children}</>;
}
