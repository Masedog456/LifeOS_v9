/**
 * The integration OAuth provider seam (LIFEOS-068 §11, §14, §21).
 *
 * ## Calendar does not own OAuth
 *
 * LIFEOS-067 built a `ExternalCalendarProvider` that reads events. This is a
 * different thing entirely: it links an ACCOUNT. Keeping them apart is what
 * lets a future Gmail or Drive integration reuse the same linked Google account
 * and ask for an additional scope, instead of each feature growing its own
 * half-correct copy of an authorization flow.
 *
 *     Integration account linking  (this file)
 *       → authorized provider client
 *         → Calendar provider adapter   (lib/calendar/provider.ts)
 *           → NormalizedExternalEvent
 *             → reconciliation
 *               → LifeEvent
 *
 * ## Least privilege is expressed as data, not as discipline
 *
 * `GOOGLE_CALENDAR_SCOPES` is one read-only scope. `FORBIDDEN_SCOPES` names the
 * ones that must never be requested, and `assertLeastPrivilege` refuses a
 * request containing any of them — so a future edit that quietly adds Gmail
 * fails a test rather than shipping.
 *
 * ## Nothing here fabricates a connection
 *
 * With no client credentials configured, `googleOAuthProvider()` reports
 * `configured: false` and every method refuses. It does not build a plausible
 * accounts.google.com URL for the user to be redirected to and then fail at.
 */

/** What a token exchange or refresh produced. */
export interface ProviderTokens {
  accessToken: string;
  /**
   * Present on first consent; frequently ABSENT on refresh. §13: an absent
   * refresh token in a refresh response means "keep the one you have", never
   * "the user revoked us".
   */
  refreshToken?: string;
  expiresInSeconds?: number;
  /** What was actually granted. May differ from what was asked (§12). */
  grantedScopes: string[];
}

export interface ProviderAccountIdentity {
  /** The provider's stable id for the account. NEVER an email (§9). */
  accountId: string;
  /** Human label for the settings row. Metadata only — never a Person (§26). */
  label?: string;
}

export type ProviderFailure =
  | "not_configured"
  | "exchange_failed"
  | "invalid_grant"
  | "identity_failed"
  | "network";

export class ProviderError extends Error {
  constructor(public readonly failure: ProviderFailure, message?: string) {
    // Never interpolates a code, a token, or a client secret.
    super(message ?? failure);
    this.name = "ProviderError";
  }
}

export interface AuthorizationUrlInput {
  state: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * What a linkable provider must supply.
 *
 * Note what is missing: anything that could sign a user in. This interface
 * cannot create a session, cannot mint a Conqify token, and cannot touch
 * `auth.identities`. §2's separation is structural here.
 */
export interface IntegrationOAuthProvider {
  readonly id: string;
  readonly label: string;
  /** False when client credentials are absent. Callers must not redirect. */
  readonly configured: boolean;
  buildAuthorizationUrl(input: AuthorizationUrlInput): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ProviderTokens>;
  refreshAccessToken(refreshToken: string): Promise<ProviderTokens>;
  /** Best effort. A failure must not block local credential deletion (§15). */
  revoke(token: string): Promise<boolean>;
  getAccountIdentity(accessToken: string): Promise<ProviderAccountIdentity>;
}

// ------------------------------------------------------------------ scopes --

/** The ONLY scope the calendar foundation needs. Read-only (§14). */
export const GOOGLE_CALENDAR_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

/**
 * Scopes that must never be requested by this sprint's flow.
 *
 * Write access, mail, contacts and drive are all out of scope for a calendar
 * READ integration, and each is a category of the user's life this product has
 * no business holding a token for.
 */
export const FORBIDDEN_SCOPE_PATTERNS: readonly RegExp[] = [
  /gmail/i, /\/auth\/contacts/i, /people/i, /drive/i,
  // Calendar WRITE. `calendar.readonly` must not match, so the patterns are
  // anchored to the scopes that actually grant mutation.
  /\/auth\/calendar$/i, /calendar\.events(?!\.readonly)/i, /calendar\.acls/i,
];

export function assertLeastPrivilege(scopes: readonly string[]): void {
  for (const s of scopes) {
    for (const bad of FORBIDDEN_SCOPE_PATTERNS) {
      if (bad.test(s)) throw new ProviderError("not_configured", `refusing to request the scope "${s}"`);
    }
  }
}

/**
 * Reconcile what we asked for against what we got (§12).
 *
 * The provider decides. A user can uncheck a permission on Google's consent
 * screen, and the token that comes back grants less than we requested — so the
 * granted set is what gets persisted, and a missing REQUIRED scope fails the
 * connection rather than producing an integration that will 403 later with no
 * explanation.
 */
export function reconcileScopes(requested: readonly string[], granted: readonly string[], required: readonly string[]): {
  granted: string[];
  missingRequired: string[];
  extra: string[];
} {
  const g = [...new Set(granted.map((s) => s.trim()).filter(Boolean))];
  const missingRequired = required.filter((r) => !g.includes(r));
  const extra = g.filter((s) => !requested.includes(s));
  return { granted: g, missingRequired, extra };
}

// ------------------------------------------------------------------ google --

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Read client credentials from server-only configuration, or `null`. */
export function googleConfigFromEnv(env: Record<string, string | undefined>): GoogleOAuthConfig | null {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * The Google provider.
 *
 * Written in full because the flow's correctness is what this sprint is for —
 * but it is unreachable without credentials, and with `config === null` every
 * method refuses rather than pretending.
 */
export function googleOAuthProvider(config: GoogleOAuthConfig | null): IntegrationOAuthProvider {
  const refuse = (): never => {
    throw new ProviderError("not_configured", "Google is not configured for this deployment");
  };

  return {
    id: "google",
    label: "Google",
    configured: !!config,

    buildAuthorizationUrl(input) {
      if (!config) return refuse();
      assertLeastPrivilege(input.scopes);
      const u = new URL(GOOGLE_AUTH_URL);
      u.searchParams.set("client_id", config.clientId);
      u.searchParams.set("redirect_uri", input.redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", input.scopes.join(" "));
      u.searchParams.set("state", input.state);
      u.searchParams.set("code_challenge", input.codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
      // `offline` is what asks for a refresh token at all; `consent` forces the
      // screen so a re-link actually returns one. Without these, a reconnect
      // would silently produce an integration that dies at the first refresh.
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent");
      u.searchParams.set("include_granted_scopes", "true");
      return u.toString();
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      if (!config) return refuse();
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code, code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      });
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new ProviderError("exchange_failed");
      const j = await res.json() as Record<string, unknown>;
      const accessToken = typeof j.access_token === "string" ? j.access_token : "";
      if (!accessToken) throw new ProviderError("exchange_failed");
      return {
        accessToken,
        refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
        expiresInSeconds: typeof j.expires_in === "number" ? j.expires_in : undefined,
        grantedScopes: typeof j.scope === "string" ? j.scope.split(/\s+/).filter(Boolean) : [],
      };
    },

    async refreshAccessToken(refreshToken) {
      if (!config) return refuse();
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        // `invalid_grant` is the specific, meaningful one: the user revoked us,
        // or the token expired. It is the only response that should ever mark
        // an integration as needing attention.
        if (j.error === "invalid_grant") throw new ProviderError("invalid_grant");
        throw new ProviderError("exchange_failed");
      }
      const accessToken = typeof j.access_token === "string" ? j.access_token : "";
      if (!accessToken) throw new ProviderError("exchange_failed");
      return {
        accessToken,
        // Usually absent. The caller preserves what it already has.
        refreshToken: typeof j.refresh_token === "string" ? j.refresh_token : undefined,
        expiresInSeconds: typeof j.expires_in === "number" ? j.expires_in : undefined,
        grantedScopes: typeof j.scope === "string" ? j.scope.split(/\s+/).filter(Boolean) : [],
      };
    },

    async revoke(token) {
      if (!config) return refuse();
      try {
        const res = await fetch(GOOGLE_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
        return res.ok;
      } catch {
        // Best effort by design: §15 says a failed revocation must never leave
        // the local credential in place, so the caller deletes regardless.
        return false;
      }
    },

    async getAccountIdentity(accessToken) {
      if (!config) return refuse();
      const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new ProviderError("identity_failed");
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      // `sub` is Google's stable account id. The email is a LABEL only — §9 is
      // explicit that identity must never be keyed by an address, because
      // addresses change and the same person would become two accounts.
      const accountId = typeof j.sub === "string" ? j.sub : "";
      if (!accountId) throw new ProviderError("identity_failed");
      return { accountId, label: typeof j.email === "string" ? j.email : undefined };
    },
  };
}

/** The provider this build gets. Unconfigured, and it says so. */
export function resolveGoogleProvider(env: Record<string, string | undefined> = process.env): IntegrationOAuthProvider {
  return googleOAuthProvider(googleConfigFromEnv(env));
}
