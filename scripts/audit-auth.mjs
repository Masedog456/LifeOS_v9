#!/usr/bin/env node
/**
 * Closed-beta account-creation audit (LIFEOS-050C).
 *
 * The closed beta has exactly one intended way in: the founder pre-creates a
 * user in Supabase, and that user requests a magic link. Nothing in the app may
 * create an account.
 *
 * This is a STATIC audit rather than a unit test on purpose. The failure it
 * guards against is not "the current call is wrong" — that is covered by the
 * security self-tests — it is "somebody later adds a second way in." A mocked
 * client test cannot see a new `signUp()` in a file it doesn't import; a source
 * sweep can.
 *
 * Fails when:
 *   1. any `signInWithOtp` call site omits `shouldCreateUser: false`
 *      (Supabase defaults it to TRUE — omission silently permits signup), or
 *   2. any account-creating auth API appears in shipped app/lib/components code.
 *
 * Founder-run scripts under scripts/ are exempt: they require the service-role
 * key, never reach a browser, and are how disposable test users get made.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = ["app", "lib", "components"];
const EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

/** Every shipped source file, recursively. */
function sources(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) sources(p, out);
    else if (EXT.test(e)) out.push(p);
  }
  return out;
}

/**
 * Strip comments and string literals before matching.
 *
 * This is load-bearing, not tidiness. The first version of this audit matched
 * raw source, so the doc comment in `authStore.ts` explaining the rule — which
 * necessarily contains the words `shouldCreateUser: false` — satisfied the
 * check on its own. Deleting the actual option still passed. An audit that
 * cannot fail is worse than no audit, because it is believed.
 */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ") // line comments, keeping http:// intact
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
    .replace(/'(?:\\.|[^\\'])*'/g, "''")
    .replace(/"(?:\\.|[^\\"])*"/g, '""');
}

/**
 * Account-creating auth APIs that must never appear in shipped code. `signUp` is
 * self-service registration; `admin.createUser` requires the service-role key,
 * which must never be in a client bundle in the first place.
 */
const FORBIDDEN = [
  { re: /\.signUp\s*\(/, what: "auth.signUp() — self-service registration" },
  { re: /admin\s*\.\s*createUser\s*\(/, what: "auth.admin.createUser() — needs the service-role key" },
  { re: /signInWithOAuth\s*\(/, what: "signInWithOAuth() — creates accounts on first sign-in" },
  { re: /signInAnonymously\s*\(/, what: "signInAnonymously() — creates a durable anonymous user" },
];

const problems = [];
let otpCallSites = 0;

for (const dir of SHIPPED) {
  for (const file of sources(join(root, dir))) {
    const body = code(readFileSync(file, "utf8"));
    const rel = relative(root, file);

    for (const { re, what } of FORBIDDEN) {
      if (re.test(body)) problems.push(`${rel}: ${what}`);
    }

    if (!/signInWithOtp\s*\(/.test(body)) continue;
    otpCallSites++;
    // The option must be present and explicitly false. `shouldCreateUser: true`
    // or a bare omission both mean "anyone may register".
    if (!/shouldCreateUser\s*:\s*false/.test(body)) {
      problems.push(`${rel}: signInWithOtp() without \`shouldCreateUser: false\` — unknown emails would self-register`);
    }
  }
}

if (otpCallSites === 0) {
  problems.push("no signInWithOtp() call site found — the sign-in path moved; re-verify this audit still checks the real one");
}

if (problems.length) {
  console.error("Auth audit FAILED — closed beta is not closed:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("\nThe beta admits users ONLY by founder pre-creation in Supabase.");
  process.exit(1);
}

console.log(`Auth audit: ${otpCallSites} sign-in call site(s), all passing shouldCreateUser: false.`);
console.log("Auth audit: no signUp / admin.createUser / OAuth / anonymous path in shipped code.");
console.log("Auth audit PASS — no in-app account creation.");
