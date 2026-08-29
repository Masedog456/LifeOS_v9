/**
 * How to say when a device last confirmed a sync (LIFEOS-076 §11).
 *
 * Pure and injectable-clock so it can be asserted without freezing time. Two
 * rules the audit made necessary:
 *
 *  - A missing or unusable timestamp yields `null`, and the caller shows just
 *    "Synced". §6 is explicit that an unavailable time is omitted, never
 *    invented from app-startup or render time — the previous behaviour minted a
 *    timestamp on any transition into "synced", including the adoption path
 *    where nothing had been pushed.
 *  - A time in the future is not a clock we can reason about, so it is treated
 *    as unusable rather than rendered as "in 3 hours".
 */

/** Round numbers people actually say, rather than "just now" for 59 seconds. */
export function formatLastSync(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const delta = now - t;
  // Tolerate a minute of clock skew between the device and the server stamp;
  // beyond that the value is not trustworthy enough to display.
  if (delta < -60_000) return null;
  const secs = Math.max(0, Math.floor(delta / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
