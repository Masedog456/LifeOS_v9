"use client";

import { useEffect } from "react";
import { initPersistence } from "@/lib/persistence";
import { replaceState } from "@/lib/mvpStore";
import { setAuthUnavailable } from "@/lib/authStore";
import { markBootstrap } from "@/lib/security/auth-bootstrap";

/**
 * Runs once client-side after local hydration: sets up the auth listener and
 * enables remote sync only for a durable email-verified session (migrating
 * local data up on first sign-in). A no-op (local-only mode) when Supabase is
 * unconfigured or the user is signed out.
 */
export default function PersistenceBootstrap() {
  useEffect(() => {
    // Never `void` this: a rejection here used to vanish, leaving the header in
    // a permanent loading state with no sign-in control and no explanation.
    initPersistence(replaceState).catch(() => {
      markBootstrap({ resolvedByFallback: true, failure: "bootstrap_rejected" });
      setAuthUnavailable("Couldn't finish starting up. You can still sign in.");
    });
  }, []);
  return null;
}
