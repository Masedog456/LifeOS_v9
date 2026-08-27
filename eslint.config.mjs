import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored pdf.js worker copied from node_modules at build time.
    "public/**",
    // Hand-run diagnostic harnesses (browser smokes, failure injection). They
    // are CommonJS on purpose — they patch `Module._resolveFilename` to resolve
    // the app's `@/` aliases against a throwaway tsc build, which an ESM loader
    // cannot do — so the repo-wide ban on `require()` does not apply to them.
    // They are never imported by the app and never shipped.
    "scripts/**/*.cjs",
  ]),
]);

export default eslintConfig;
