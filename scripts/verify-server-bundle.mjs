#!/usr/bin/env node
/**
 * Verifies both production server bundles.
 *
 * The main web server and isolated export worker must exist, and neither may
 * contain an unresolved runtime import of decimal.js.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const bundlePaths = [
  resolve(process.cwd(), "dist", "index.js"),
  resolve(process.cwd(), "dist", "full-export-worker.js"),
];

const RUNTIME_IMPORT_PATTERNS = [
  /\bimport\s+[^"']*\bfrom\s+["']decimal\.js["']/,
  /\bimport\s*\(\s*["']decimal\.js["']\s*\)/,
  /\brequire\s*\(\s*["']decimal\.js["']\s*\)/,
  /createRequire[^)]*\(\s*["']decimal\.js["']\s*\)/,
];

let failed = false;

for (const bundlePath of bundlePaths) {
  let content;
  try {
    content = readFileSync(bundlePath, "utf8");
  } catch {
    console.error(`❌  ${bundlePath} not found. Run npm run build first.`);
    failed = true;
    continue;
  }

  for (const pattern of RUNTIME_IMPORT_PATTERNS) {
    if (!pattern.test(content)) continue;
    console.error(`\n❌  SERVER BUNDLE VERIFICATION FAILED`);
    console.error(`   ${bundlePath} contains an unresolved runtime import of decimal.js.`);
    console.error(`   Matched pattern: ${pattern}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✅  Server and export-worker bundles verified — no unresolved decimal.js runtime import.");
