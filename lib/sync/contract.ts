/**
 * What the deployed database can do, and what this client needs (LIFEOS-077).
 *
 * ## The defect this closes
 *
 * F-3 was three defects. The one that mattered most, measured against the
 * shipped product: compatibility could return `canSync: false` and the write
 * would land anyway, with the app reporting "Synced". The module was right and
 * nothing consulted it.
 *
 * The other two: its only production caller fed it the client's own constant as
 * the "remote" version — a number compared with itself — and no code path
 * anywhere read a deployed version, so even correct wiring had nothing to read.
 *
 * This module is the pure half: the client's requirements, a parser that fails
 * closed, and the comparison. It performs no I/O. The probe that reads the
 * server lives in `lib/persistence.ts`, because the decision has to be consumed
 * by the write path or this is just the same mechanism unwired again.
 *
 * ## Coarse contract, precise capabilities
 *
 * `contract` is a generation marker and answers broad questions. It is NOT the
 * write gate: gating asks a narrower question — "can THIS domain use THIS
 * server capability?" — so one missing capability pauses one domain instead of
 * turning into a 46-domain outage.
 */

import type { StoreState } from "@/types/mvp";

/**
 * The contract generation this build speaks.
 *
 * A client constant may say what the client EXPECTS. It may never masquerade as
 * deployed truth — that substitution is exactly what F-3a was.
 */
export const CLIENT_CONTRACT = 2;

/**
 * Which server capability each domain needs, and at what level.
 *
 * Deliberately tiny and central. Domains absent from this map need nothing and
 * are never gated, which is what keeps the blast radius at two rather than
 * forty-six. Numeric literals live here and nowhere else — an adapter that
 * hard-codes a level is how this drifts.
 */
export const DOMAIN_CAPABILITY_REQUIREMENTS: Partial<Record<keyof StoreState, Record<string, number>>> = {
  notes: { guarded_notes: 2 },
  nextActions: { guarded_next_actions: 2 },
};

export interface ServerContract {
  contract: number;
  minClientContract: number;
  capabilities: Record<string, number>;
}

/**
 * Infrastructure-level, deliberately not a product noun.
 *
 *  - `unknown`      nothing has been asked yet
 *  - `checking`     a probe is in flight
 *  - `compatible`   every domain this client writes is supported
 *  - `partially_compatible`  some domains are held back; the rest sync
 *  - `incompatible` this client is globally too old to write
 *  - `unavailable`  the answer could not be established (offline, error,
 *                   malformed). NOT the same as "incompatible": we do not know.
 */
export type CompatibilityState =
  | "unknown" | "checking" | "compatible" | "partially_compatible" | "incompatible" | "unavailable";

export interface CompatibilityVerdict {
  state: CompatibilityState;
  /** Domains whose remote writes must be held. Never includes domains with no requirement. */
  gatedDomains: (keyof StoreState)[];
  /** True when the server declares this whole client too old to write. */
  clientTooOld: boolean;
  server: ServerContract | null;
}

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Parse the RPC payload, failing closed on anything unexpected.
 *
 * This is the D-23 discipline applied to compatibility itself: a response we
 * cannot READ is not evidence of compatibility. Null, missing fields, wrong
 * types, negative or fractional versions, and a non-object capability bag all
 * return null — which the caller must treat as `unavailable`, never as "fine".
 *
 * Unknown EXTRA fields are tolerated on purpose: a newer database may advertise
 * capabilities this client has never heard of, and refusing to parse would make
 * every forward-compatible deployment look like a failure.
 */
export function parseContract(raw: unknown): ServerContract | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const contract = o.contract;
  const minClient = o.min_client_contract ?? o.minClientContract;
  if (!isPositiveInt(contract) || !isPositiveInt(minClient)) return null;

  const caps = o.capabilities;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return null;

  // Every advertised level must itself be a positive integer. One malformed
  // entry poisons the whole payload rather than being silently skipped — a
  // half-read contract is not a contract.
  const capabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(caps as Record<string, unknown>)) {
    if (!isPositiveInt(v)) return null;
    capabilities[k] = v;
  }

  return { contract, minClientContract: minClient, capabilities };
}

/** Domains that declare a requirement — the only ones gating can ever hold. */
export function gateableDomains(): (keyof StoreState)[] {
  return Object.keys(DOMAIN_CAPABILITY_REQUIREMENTS) as (keyof StoreState)[];
}

/**
 * Compare what the server offers with what this client needs.
 *
 * Not equality. A server AHEAD of this client is compatible as long as the
 * capabilities this client actually uses are still offered and the client is
 * not below the declared minimum — without that, neither deployment order is
 * possible, which is the trap the 0045 rollout hit.
 */
export function evaluateContract(server: ServerContract | null): CompatibilityVerdict {
  // Could not be established. Hold only the domains that need a capability;
  // everything else is unaffected by a contract we failed to read.
  if (!server) {
    return { state: "unavailable", gatedDomains: gateableDomains(), clientTooOld: false, server: null };
  }

  // The database has declared this client generation unfit to write at all.
  if (CLIENT_CONTRACT < server.minClientContract) {
    return { state: "incompatible", gatedDomains: gateableDomains(), clientTooOld: true, server };
  }

  const gated: (keyof StoreState)[] = [];
  for (const [domain, needs] of Object.entries(DOMAIN_CAPABILITY_REQUIREMENTS)) {
    for (const [cap, level] of Object.entries(needs ?? {})) {
      const have = server.capabilities[cap];
      // Absent is not zero and not "probably fine": a capability the server
      // does not mention is one it does not claim, so the domain waits.
      if (typeof have !== "number" || have < level) {
        gated.push(domain as keyof StoreState);
        break;
      }
    }
  }

  return {
    state: gated.length === 0 ? "compatible" : "partially_compatible",
    gatedDomains: gated,
    clientTooOld: false,
    server,
  };
}

/**
 * What to tell a person, in consequences.
 *
 * "safe on this device" is a claim about local persistence, so the caller must
 * pass whether the local save actually succeeded — saying it when it did not
 * would be the false reassurance LIFEOS-076 E-2 exists to prevent.
 */
export function compatibilityMessage(state: CompatibilityState, localSaveOk: boolean): string | null {
  if (state === "compatible" || state === "unknown" || state === "checking") return null;
  return localSaveOk
    ? "Conqify is updating. Your changes are safe on this device and will sync when the update finishes."
    : "Conqify is updating, and your latest change hasn’t been saved on this device yet. Try saving again.";
}
