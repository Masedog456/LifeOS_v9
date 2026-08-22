/**
 * Offline fallback for capture escalation (LIFEOS-060 §13).
 *
 * ## This mock deliberately returns nothing
 *
 * Every other mock in the product invents plausible output so a feature still
 * demonstrates itself offline. That is the wrong move here, and the reason is
 * §13: capture must remain USEFUL without AI, and it already is — the
 * deterministic pass produced candidates before escalation was ever considered.
 *
 * Escalation exists to add what the rules could not find. A mock cannot find it
 * either. Fabricating an extra "action" from a sentence the rules could not
 * place would put a machine's invention in front of the user labelled as a
 * suggestion, offline, with no model involved at all.
 *
 * So: an empty array. The deterministic candidates stand, the user carries on,
 * and nothing false appears. The absence of AI is not an error state and is
 * never announced as one.
 */

/** Always empty. See above — this is the behaviour, not a stub. */
export function mockCaptureCandidates(): unknown[] {
  return [];
}
