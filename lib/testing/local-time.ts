/**
 * Test-fixture time helpers (PR 2).
 *
 * LifeOS files everything by the user's LOCAL day (`todayKey`, `dayKeyFromIso`
 * in lib/reviews/dates.ts). Fixtures that wrote "9 a.m. on the 25th" as
 * `2026-08-25T09:00:00.000Z` only meant that in time zones near UTC: in
 * Los Angeles 06:00Z is the evening before, in Auckland 12:00Z is already the
 * next morning, and the suites failed there while the app was right. These
 * helpers build the timestamp a real device would have stored for a local wall
 * time, so a fixture means the same day in every zone.
 *
 * Use them for fixtures that mean "this time on this local day". Keep explicit
 * `Z` timestamps for tests that are ABOUT UTC/local boundaries.
 */

/** The ISO instant (UTC, `…Z`) of local wall time `hour:minute` on `day` (YYYY-MM-DD). */
export function localIso(day: string, hour = 0, minute = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`localIso: bad day key ${day}`);
  return new Date(y, m - 1, d, hour, minute, 0, 0).toISOString();
}
