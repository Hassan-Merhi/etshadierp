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

// Patterns that indicate a RUNTIME (non-bundled) import of decimal.js.
// We look for import/require statements — NOT comments or strings inside code.
// A bundled decimal.js will not emit any of these at the top level.
const RUNTIME_IMPORT_PATTERNS = [
  // ESM static import  — import Decimal from "decimal.js" / import("decimal.js")
  /\bimport\s+[^"']*\bfrom\s+["']decimal\.js["']/,
  /\bimport\s*\(\s*["']decimal\.js["']\s*\)/,
  // CJS require
  /\brequire\s*\(\s*["']decimal\.js["']\s*\)/,
  // Dynamic import via createRequire
  /createRequire[^)]*\(\s*["']decimal\.js["']\s*\)/,
];

let failed = false;
for (const pattern of RUNTIME_IMPORT_PATTERNS) {
  if (pattern.test(content)) {
    console.error(`\n❌  SERVER BUNDLE VERIFICATION FAILED`);
    console.error(`   dist/index.js contains an unresolved runtime import of decimal.js.`);
    console.error(`   Matched pattern: ${pattern}`);
    console.error(`\n   This means decimal.js was NOT bundled into dist/index.js.`);
    console.error(`   At runtime on Render, Node.js would throw ERR_MODULE_NOT_FOUND`);
    console.error(`   because node_modules/decimal.js is installed from a Replit-internal`);
    console.error(`   registry URL that Render cannot reach.`);
    console.error(`\n   Fix: inspect scripts/build-server.mjs and ensure the bundle-decimal-js`);
    console.error(`   esbuild plugin is active and the resolved path is correct.`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("✅  Server bundle verification passed — no unresolved decimal.js runtime import.");
