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
    // Vendored design-handoff bundles. These are third-party build output kept
    // for reference, never imported by the app, and they drown the real
    // findings in noise.
    "Interview Booking UI Redesign-handoff/**",
    "redesign_handoff/**",
  ]),
]);

export default eslintConfig;
