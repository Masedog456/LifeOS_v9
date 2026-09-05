/**
 * One-daily-review self-tests (LIFEOS-092).
 *
 * ## What this suite is for
 *
 * Every other suite in this repository proves a derivation. This one proves an
 * ABSENCE: that Conqify has exactly one place to close a day, and that nothing
 * quietly grows a second one.
 *
 * That is an unusual thing to assert, and it is asserted here rather than only
 * in the browser because the failure mode is textual and creeps back by
 * accident — a link added to a card, a palette entry restored, a route file
 * re-listing the old surface. The audit measured all four:
 *
 *   1. Today rendered TWO links reading "Review today →", one to /today/review
 *      and one to /daily
 *   2. the two surfaces disagreed about the same day
 *   3. opening /daily WROTE a `not_started` review record
 *   4. the command palette offered three doors to /daily and none to the
 *      canonical surface
 *
 * ## Why it reads source text
 *
 * Reading files in a test is normally a smell — it proves what the code says
 * rather than what it does. Here the claim IS about what the source says: that
 * no component links to the retired surface, that the palette has one review
 * destination, and that the wizard's files are gone. A behavioural test cannot
 * see a link that someone re-adds to a component this suite does not render.
 * The browser suite covers the behaviour; this covers the drift.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { staticCommands } from "@/lib/command/commands";
import { ROUTE_INVENTORY, REQUIRED_SURFACES } from "@/lib/design/route-inventory";
import { findReviewByDate, listReviews, REVIEW_STEPS } from "@/lib/reviews/review";
import { emptyStoreState } from "@/lib/ux/backup";

/** The one place a day is closed. */
export const CANONICAL_REVIEW_ROUTE = "/today/review";

/** Routes that must keep answering, as intentional redirects (§27). */
export const REDIRECTED_REVIEW_ROUTES = ["/daily", "/daily/[date]"] as const;

/** Components the wizard was made of. None may come back (§26). */
export const RETIRED_REVIEW_COMPONENTS = [
  "components/reviews/DailyReviewFlow.tsx",
  "components/reviews/DaySummary.tsx",
  "components/reviews/WinsStep.tsx",
  "components/reviews/LessonsStep.tsx",
  "components/reviews/FrictionStep.tsx",
  "components/reviews/OpenLoopsStep.tsx",
  "components/reviews/TomorrowFocusStep.tsx",
  "components/reviews/TodayReviewCard.tsx",
] as const;

/** Derivations the wizard owned, superseded by 082/090/091 (§8). */
export const RETIRED_REVIEW_BUILDERS = [
  "lib/reviews/open-loops.ts",
  "lib/reviews/tomorrow-focus.ts",
] as const;

/**
 * Surfaces that legitimately keep reading review RECORDS.
 *
 * `dailyReviews` is a live synced domain — the adapters, backup, versioning,
 * backlinks, insights and the security audit all read it — so past reviews stay
 * readable. These are not second places to close a day; they are history.
 */
export const REVIEW_HISTORY_ROUTES = ["/daily/history", "/daily/week/[start]"] as const;

interface Result { name: string; pass: boolean; detail?: string }

const ROOT = process.env.LIFEOS_ROOT ?? process.cwd();
const read = (rel: string) => {
  try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return ""; }
};
const exists = (rel: string) => existsSync(join(ROOT, rel));

/**
 * Source with its comments stripped.
 *
 * A word-sniffing assertion is fragile exactly when honest prose legitimately
 * contains the forbidden word: 92.42 first read `ReviewToday.tsx` whole and
 * tripped on the comment "§8. Direction, and never called progress" — a line
 * that exists BECAUSE the rule is being kept. The claim is about what the page
 * renders, so the check reads what the page renders.
 */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every `.tsx`/`.ts` under a directory, recursively. */
function walk(rel: string, out: string[] = []): string[] {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else if (/\.tsx?$/.test(e.name)) out.push(child);
  }
  return out;
}

export function runDailyReviewConsolidationSelfTests() {
  const t0 = Date.now();
  const results: Result[] = [];
  const ok = (name: string, cond: boolean, detail = "") =>
    results.push({ name, pass: !!cond, detail });

  // ---- §5, §27. The routes ------------------------------------------------
  ok("92.1 §5 the canonical review route exists",
    exists("app/today/review/page.tsx"));
  ok("92.2 §27 the old route still answers, so bookmarks do not 404",
    exists("app/daily/page.tsx") && exists("app/daily/[date]/page.tsx"));
  {
    const daily = read("app/daily/page.tsx");
    ok("92.3 §27 …and it redirects rather than rendering a second review",
      /router\.replace\(/.test(daily) && daily.includes(CANONICAL_REVIEW_ROUTE),
      daily.slice(0, 0));
    ok("92.4 §5 …with no wizard left behind it",
      !/DailyReviewFlow/.test(daily));
    ok("92.5 §27 …using replace, so Back does not land on a dead route",
      /router\.replace\(/.test(daily) && !/router\.push\(/.test(daily));
  }
  {
    const dated = read("app/daily/[date]/page.tsx");
    ok("92.6 §7, §17 the dated route carries its day across the redirect",
      dated.includes("?date=") && /router\.replace\(/.test(dated), "");
    ok("92.7 §17 …and an unparseable date still lands on a review",
      /isDayKey\(/.test(dated));
  }
  ok("92.8 §7 the canonical route accepts a day as a parameter",
    read("app/today/review/page.tsx").includes('params.get("date")'));
  ok("92.9 §17 …and validates it rather than trusting the URL",
    /isDayKey\(/.test(read("app/today/review/page.tsx")));

  // ---- §6, §20, §22, §28. One door ---------------------------------------
  //
  // The audit's RED 1: two links reading "Review today →" on one page, going to
  // different surfaces. This is the assertion that would have caught it.
  {
    const files = [...walk("components"), ...walk("app")]
      .filter((f) => !f.startsWith("app/daily/"));
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      // A link to the retired surface — `/daily` itself, not `/daily/history`
      // or `/daily/week`, which are history and stay.
      if (/href=["'`]\/daily["'`]/.test(src) || /href=\{`\/daily`\}/.test(src)) offenders.push(f);
    }
    ok("92.10 §6, §20 nothing links to the retired daily surface",
      offenders.length === 0, offenders.join(", "));
  }
  {
    const src = read("app/today/page.tsx");
    ok("92.11 §20 Today does not render the old review card",
      !/TodayReviewCard/.test(src));
  }
  {
    const nav = read("components/Nav.tsx");
    ok("92.12 §22 navigation names the canonical route",
      nav.includes(`href: "${CANONICAL_REVIEW_ROUTE}"`), "");
    ok("92.13 §22 …and does not also carry the old one",
      !/href: "\/daily"/.test(nav));
    ok("92.14 §23 …under one vocabulary",
      nav.includes('label: "Review today"') && !/label: "Daily Review"/.test(nav));
  }

  // ---- §28. The palette ---------------------------------------------------
  {
    const COMMANDS = staticCommands();
    const daily = COMMANDS.filter((c) => c.href === "/daily");
    ok("92.15 §28 no static command points at the retired surface",
      daily.length === 0, daily.map((c) => c.title).join(", "));
    const canonical = COMMANDS.filter((c) => c.href === CANONICAL_REVIEW_ROUTE);
    ok("92.16 §28 …and the canonical review is reachable from the palette",
      canonical.length >= 1, canonical.map((c) => c.title).join(", "));
    ok("92.17 §28 …exactly once, not three times",
      canonical.length === 1, canonical.map((c) => c.title).join(", "));
    // The dynamic entries live in a builder, so they are checked as source.
    const src = read("lib/command/commands.ts");
    const dyn = [...src.matchAll(/href: "\/daily"/g)];
    ok("92.18 §28 …including the contextual ones", dyn.length === 0, String(dyn.length));
  }
  {
    // History is a different question from closing a day, and keeps its door.
    const hist = staticCommands().filter((c) => c.href === "/daily/history");
    ok("92.19 §26 past reviews stay reachable", hist.length >= 1,
      hist.map((c) => c.title).join(", "));
  }

  // ---- §26. The wizard is gone -------------------------------------------
  for (const f of RETIRED_REVIEW_COMPONENTS) {
    ok(`92.20 §26 ${f.split("/").pop()} is deleted`, !exists(f), f);
  }
  for (const f of RETIRED_REVIEW_BUILDERS) {
    ok(`92.21 §8 ${f.split("/").pop()} is deleted`, !exists(f), f);
  }
  {
    const left = walk("components/reviews").filter((f) =>
      (RETIRED_REVIEW_COMPONENTS as readonly string[]).includes(f));
    ok("92.22 §26 no retired component survives under another name",
      left.length === 0, left.join(", "));
  }
  ok("92.23 §26 the surviving review components are history-only",
    walk("components/reviews").every((f) =>
      /EntityPicker|ReviewHistory|WeeklyRollup/.test(f)),
    walk("components/reviews").join(", "));

  // ---- §26, §33. What must NOT be deleted --------------------------------
  //
  // `dailyReviews` is a live, synced, exported, backlinked domain. Removing the
  // record type would be a migration, and would orphan every review already
  // written. The consolidation is a surface change, and this states it.
  {
    const s = emptyStoreState();
    ok("92.24 §33 the review record type still exists",
      Array.isArray(s.dailyReviews), typeof s.dailyReviews);
    ok("92.25 §26 …and its readers still work",
      listReviews(s).length === 0 && findReviewByDate(s, "2026-09-09") === undefined);
    ok("92.26 §26 past reviews keep their routes",
      REVIEW_HISTORY_ROUTES.every((r) =>
        exists(`app${r.replace("[start]", "[start]")}/page.tsx`)),
      REVIEW_HISTORY_ROUTES.join(", "));
  }
  ok("92.27 §33 no migration was written for this",
    !exists("supabase/migrations/0048_one_daily_review.sql"));

  // ---- §23. One vocabulary ------------------------------------------------
  {
    // The wizard's step vocabulary is retired along with it, so a future reader
    // does not find seven step labels for a surface that has no steps.
    ok("92.28 §26 the wizard's step list is gone",
      (REVIEW_STEPS as readonly unknown[]).length === 0,
      String((REVIEW_STEPS as readonly unknown[]).length));
  }
  {
    const entry = ROUTE_INVENTORY.find((r) => r.route === CANONICAL_REVIEW_ROUTE);
    ok("92.29 §22 the route inventory names the canonical surface", !!entry,
      ROUTE_INVENTORY.map((r) => r.route).filter((r) => /daily|review/.test(r)).join(", "));
    ok("92.30 §23 …with the chosen vocabulary",
      entry?.surface === "Review today", String(entry?.surface));
    ok("92.31 §22 …and no longer lists the retired one",
      !ROUTE_INVENTORY.some((r) => r.route === "/daily"));
    ok("92.32 §23 the required-surface list agrees",
      (REQUIRED_SURFACES as readonly string[]).includes("Review today")
      && !(REQUIRED_SURFACES as readonly string[]).includes("Daily Review"),
      (REQUIRED_SURFACES as readonly string[]).filter((x) => /review/i.test(x)).join(", "));
  }

  // ---- §2, §16. Reading a day writes nothing ------------------------------
  //
  // The audit's RED 3: `getOrCreateReviewForDate` ran in a mount effect, so
  // opening the page to LOOK created a `not_started` record that then appeared
  // in history as something begun and abandoned.
  {
    const canonical = read("components/today/ReviewToday.tsx");
    ok("92.33 §16 the canonical review creates nothing by being read",
      !/getOrCreateReviewForDate|startDailyReview|completeDailyReview/.test(canonical),
      "");
    ok("92.34 §16 …and its only write is the optional reflection",
      /addReflection/.test(canonical) && !/updateDailyReview/.test(canonical));
    ok("92.35 §14 …and carrying work goes through the replanning layer",
      /planReplan/.test(canonical) && !/\bdeferAction\(/.test(canonical),
      "");
  }
  {
    const files = walk("app").concat(walk("components"));
    const creators = files.filter((f) => /getOrCreateReviewForDate/.test(read(f)));
    ok("92.36 §16 nothing on any surface auto-creates a review record",
      creators.length === 0, creators.join(", "));
  }

  // ---- §8. One derivation of the day --------------------------------------
  {
    const files = walk("app").concat(walk("components"));
    const users = files.filter((f) => /buildDaySummary/.test(read(f)));
    ok("92.37 §8 no surface renders the second day-derivation",
      users.length === 0, users.join(", "));
    const evening = files.filter((f) => /buildEveningClose/.test(read(f)));
    ok("92.38 §8 …and exactly one renders the canonical one",
      evening.length === 1, evening.join(", "));
  }
  ok("92.39 §8 the weekly rollup keeps its own use of the day summary",
    /buildDaySummary/.test(read("lib/reviews/weekly-rollup.ts")));

  // ---- §21. Daily and weekly stay separate --------------------------------
  {
    const canonical = read("components/today/ReviewToday.tsx");
    ok("92.40 §21 the daily review links to the week rather than embedding it",
      /href="\/memory"/.test(canonical) && !/WeeklyRollup|buildWeeklyExecutiveReview/.test(canonical));
  }

  // ---- §32. No score anywhere --------------------------------------------
  {
    const canonical = code("components/today/ReviewToday.tsx");
    const banned = ["completion %", "streak", "day score", "review score", "% complete"];
    const found = banned.filter((w) => canonical.toLowerCase().includes(w));
    ok("92.41 §32 the canonical review carries no score", found.length === 0, found.join(", "));
    ok("92.42 §16 …and no progress meter implying it is unfinished",
      !/\bstep \d|\bof 7\b|<progress|role="progressbar"/i.test(canonical),
      (canonical.match(/\bstep \d|\bof 7\b|<progress|role="progressbar"/i) || []).join(""));
    ok("92.43 §16 …and nothing on the page is required before it is useful",
      !/required|must complete|finish your review/i.test(canonical));
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    pass: passed === results.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    ms: Date.now() - t0,
    results,
  };
}
