#!/usr/bin/env node
/**
 * Secret & configuration scan (LIFEOS-040, Feature 25).
 *
 * Scans tracked source for committed secrets and client-bundle leaks:
 *  - service-role keys / private keys / JWTs in source
 *  - a service-role key referenced anywhere client code could bundle it
 *  - NEXT_PUBLIC_* that carries a non-public-looking secret
 *  - committed .env files with real values
 * Exits 1 on any finding. Allowlists .env.example and this script itself.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "out", "dist", "coverage"]);
const IGNORE_FILES = new Set(["scan-secrets.mjs", ".env.example", "package-lock.json"]);

const FINDINGS = [];
// `scripts/` holds Node-only dev/release tooling that Next never bundles into the
// browser, so *referencing* the service-role env var there (e.g. the LIFEOS-047A
// live validator) is correct and safe — it is the one legitimate place for it.
// The rule targets CLIENT-bundleable code (app/components/lib); real secret VALUES
// are still caught everywhere by the JWT / private-key rules below.
const SERVER_ONLY = /^scripts[\\/]/;
/**
 * The `server-only` marker (LIFEOS-BILLING §7).
 *
 * A module whose top has `import "server-only"` CANNOT reach a client bundle:
 * Next's bundler raises a build error at the first client import, at any depth.
 * That is a stronger guarantee than the directory rule above, because the
 * compiler enforces it rather than a convention somebody has to keep — so this
 * exception tracks the marker, not the path.
 *
 * It exists because the Stripe webhook needs a privileged connection for a
 * reason no policy can remove: it arrives from Stripe's servers carrying no
 * user session, and it must write the one table the user is forbidden to
 * write. `lib/billing/admin.ts` carries the marker; `scripts/audit-billing.mjs`
 * asserts that it still does and that nothing reachable from a page imports it;
 * `npm run build` fails if either stops being true.
 *
 * Real secret VALUES are still caught everywhere by the JWT / private-key rules
 * below — this waives only the "names the variable" rule.
 */
const SERVER_ONLY_MARKER = /^\s*import\s+["']server-only["']\s*;?\s*$/m;
const RULES = [
  { name: "service-role key usage in client", re: /SUPABASE_SERVICE_ROLE|service_role_key|serviceRoleKey/, only: /\.(ts|tsx|js|jsx|mjs)$/, skip: SERVER_ONLY, allowServerOnly: true },
  { name: "private key block", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: "hardcoded JWT", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "openai-style key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "anthropic key", re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { name: "aws access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(root, full);
    if (IGNORE_DIRS.has(entry)) continue;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { walk(full); continue; }
    if (IGNORE_FILES.has(entry)) continue;
    if (st.size > 2_000_000) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|json|sql|md|env.*)$/.test(entry) && !entry.startsWith(".env")) continue;
    // Flag committed .env files with actual assignments (not .env.example).
    if (/^\.env($|\.)/.test(entry) && entry !== ".env.example") {
      const body = safeRead(full);
      if (/=\S+/.test(body)) FINDINGS.push({ file: rel, rule: "committed .env with values" });
    }
    const body = safeRead(full);
    if (!body) continue;
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(entry)) continue;
      if (rule.skip && rule.skip.test(rel)) continue;
      if (rule.allowServerOnly && SERVER_ONLY_MARKER.test(body)) continue;
      if (rule.re.test(body)) FINDINGS.push({ file: rel, rule: rule.name });
    }
    // NEXT_PUBLIC_ carrying a service-role-looking value.
    const m = body.match(/NEXT_PUBLIC_[A-Z0-9_]*\s*=\s*["']?(eyJ[A-Za-z0-9_.-]{30,})/);
    if (m && /service_role/.test(Buffer.from((m[1].split(".")[1] || ""), "base64").toString("utf8"))) {
      FINDINGS.push({ file: rel, rule: "NEXT_PUBLIC var holds a service_role key" });
    }
  }
}
function safeRead(f) { try { return readFileSync(f, "utf8"); } catch { return ""; } }

walk(root);

if (FINDINGS.length) {
  console.error("Secret scan FAILED:");
  for (const f of FINDINGS) console.error(`  ✗ ${f.file}: ${f.rule}`);
  process.exit(1);
}
console.log("Secret scan PASS — no committed secrets or client-bundle key leaks found.");
