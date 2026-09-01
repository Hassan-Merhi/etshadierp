#!/usr/bin/env node
/**
 * verify-server-bundle.mjs
 *
 * Reads dist/index.js and fails if any unresolved runtime import of decimal.js
 * remains in the bundle. An unresolved import means Render would crash with
 * ERR_MODULE_NOT_FOUND at startup.
 *
 * Does NOT fail on comments that merely mention "decimal.js".
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const bundlePath = resolve(process.cwd(), "dist", "index.js");
let content;
try {
  content = readFileSync(bundlePath, "utf8");
} catch {
  console.error("❌  dist/index.js not found. Run npm run build first.");
  process.exit(1);
}

const RUNTIME_IMPORT_PATTERNS = [
  /\bimport\s+[^"']*\bfrom\s+["']decimal\.js["']/,
  /\bimport\s*\(\s*["']decimal\.js["']\s*\)/,
  /\brequire\s*\(\s*["']decimal\.js["']\s*\)/,
  /createRequire[^)]*\(\s*["']decimal\.js["']\s*\)/,
];

let failed = false;
for (const pattern of RUNTIME_IMPORT_PATTERNS) {
  if (pattern.test(content)) {
    console.error(`\n❌  SERVER BUNDLE VERIFICATION FAILED`);
    console.error(`   dist/index.js contains an unresolved runtime import of decimal.js.`);
    console.error(`   Matched pattern: ${pattern}`);
    failed = true;
  }
}

if (failed) process.exit(1);

console.log("✅  Server bundle verification passed — no unresolved decimal.js runtime import.");

// Validate the complete production artifact contract as part of every build:
// compiled entrypoint, required Node preload files, dependency declarations,
// and resolution of every external package import left in the server bundle.
await import("./verify-production-artifact.mjs");
