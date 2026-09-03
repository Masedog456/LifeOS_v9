/**
 * Capture → Personal Code (LIFEOS-080 §6).
 *
 * ## The defect this closes
 *
 * LIFEOS-079 wrote, in `lib/capture/interpret.ts`:
 *
 *   > The candidate exists so the sentence reaches Personal Code, not so
 *   > capture can create a rule.
 *
 * The 080 audit traced it end to end and found that it did not reach Personal
 * Code. There was no handoff. Capture recognised the rule, printed *"Conqify
 * will not create this for you"*, offered a checkbox like every other row, took
 * the person's confirmation, hit `case "standard": break;` — and reported
 * *"Saved your capture."* The recognition was thrown away at the last step, and
 * the only route to the rule they had just written was to navigate to Personal
 * Code and type it again.
 *
 * ## What changed, and what did not
 *
 * The refusal is untouched and is the entire point. `standard` is still
 * `never_auto`; `commitCapture` still writes nothing; `FORBIDDEN_CANDIDATE_KINDS`
 * still bars belief and Constitution structurally. Capture gained a
 * DESTINATION, not authority.
 *
 * What crosses is the sentence and the id of the capture it came from. Nothing
 * is created by following the link: the Personal Code field arrives filled in,
 * and the person still presses the button that adopts it. That is the same act
 * they perform when they type a rule themselves, which is why it is allowed to
 * be the same button.
 *
 * ## Why the contract lives here
 *
 * Two files need to agree on it — the composer that writes the link and the page
 * that reads it — and a query-string key duplicated across a component boundary
 * is a rename away from a silently dead handoff.
 */

/** The sentence being handed over. */
export const RULE_PARAM = "rule";

/** The capture it came from, so provenance survives the navigation. */
export const CAPTURE_PARAM = "from";

/** Where Personal Code lives. One route, added by LIFEOS-079 (§33: no new page). */
export const PERSONAL_CODE_PATH = "/personal-code";

/**
 * Longest statement carried in a URL.
 *
 * A rule is a sentence. Anything past this is a paragraph that arrived through
 * a rule-shaped detector, and truncating it in the address bar would hand the
 * person a rule they did not write — so an over-long statement is refused
 * outright and the capture keeps it instead.
 */
export const MAX_HANDOFF_CHARS = 500;

export interface Handoff {
  /** The user's sentence, unchanged. */
  statement: string;
  /** The capture this came from, when there was one. */
  sourceCaptureId?: string;
}

/** The link a `standard` candidate points at. `null` when it cannot be carried. */
export function personalCodeHandoffHref(statement: string, sourceCaptureId?: string): string | null {
  const s = (statement ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_HANDOFF_CHARS) return null;
  const q = new URLSearchParams({ [RULE_PARAM]: s });
  if (sourceCaptureId) q.set(CAPTURE_PARAM, sourceCaptureId);
  return `${PERSONAL_CODE_PATH}?${q.toString()}`;
}

/**
 * Read a handoff off the URL.
 *
 * Takes a getter rather than a `URLSearchParams` so the caller can pass Next's
 * `useSearchParams()` result directly and a test can pass a plain map — this
 * module has no business importing a router.
 *
 * Anything malformed returns `null` and the page opens as it always did. A
 * handoff that cannot be read is a link that does nothing, which is the correct
 * failure: the capture still holds the sentence.
 */
export function readHandoff(get: (key: string) => string | null): Handoff | null {
  const raw = get(RULE_PARAM);
  if (typeof raw !== "string") return null;
  const statement = raw.replace(/\s+/g, " ").trim();
  if (!statement || statement.length > MAX_HANDOFF_CHARS) return null;
  const from = get(CAPTURE_PARAM);
  return {
    statement,
    sourceCaptureId: typeof from === "string" && from.trim() ? from.trim() : undefined,
  };
}

/**
 * Shown on the prefilled field.
 *
 * States the two facts a person needs: where the words came from, and that
 * nothing has happened yet. "Nothing is saved until you add it" is the whole
 * boundary, in the place where it is being exercised.
 */
export const HANDOFF_NOTE =
  "From your capture, in your words. Nothing is saved until you add it.";

/** The control on the capture card. A destination, phrased as one. */
export const HANDOFF_ACTION_LABEL = "Add to my Personal Code";
