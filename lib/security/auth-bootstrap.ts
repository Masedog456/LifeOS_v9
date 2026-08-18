/**
 * Auth-bootstrap diagnostics (LIFEOS-055U).
 *
 * Records ONLY booleans and phase names so a production startup failure can be
 * described without ever touching a key, token, email, or any user content.
 * Deliberately tiny: this exists to answer "how far did startup get?", which is
 * exactly the question that was unanswerable when app.conqify.com rendered no
 * sign-in control.
 */

export interface AuthBootstrapPhase {
  supabaseConfigured: boolean;
  bootstrapStarted: boolean;
  listenerRegistered: boolean;
  initialSessionReceived: boolean;
  sessionPresent: boolean;
  /** True when startup ended without ever resolving a session. */
  resolvedByFallback: boolean;
  /** Short, non-identifying failure label (e.g. "getSession_failed"). */
  failure?: string;
}

const phase: AuthBootstrapPhase = {
  supabaseConfigured: false,
  bootstrapStarted: false,
  listenerRegistered: false,
  initialSessionReceived: false,
  sessionPresent: false,
  resolvedByFallback: false,
};

export function markBootstrap(patch: Partial<AuthBootstrapPhase>): void {
  Object.assign(phase, patch);
}

/** A copy of the current phase. Safe to render or log — booleans only. */
export function authBootstrapPhase(): AuthBootstrapPhase {
  return { ...phase };
}

/**
 * Is a phase record free of anything sensitive? Every value must be a boolean,
 * except `failure`, which must be a short opaque label — never a message that
 * could carry a token, an email, or user text.
 */
export function isSafeDiagnostic(p: AuthBootstrapPhase): boolean {
  const { failure, ...flags } = p;
  if (!Object.values(flags).every((v) => typeof v === "boolean")) return false;
  if (failure === undefined) return true;
  return typeof failure === "string" && failure.length <= 40 && /^[a-z0-9_]+$/i.test(failure);
}

/** Reset — test seam only. */
export function resetBootstrapPhase(): void {
  Object.assign(phase, {
    supabaseConfigured: false, bootstrapStarted: false, listenerRegistered: false,
    initialSessionReceived: false, sessionPresent: false, resolvedByFallback: false,
    failure: undefined,
  });
}
