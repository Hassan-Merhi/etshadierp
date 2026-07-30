#!/usr/bin/env node
/**
 * Production prebuild safety boundary.
 *
 * 1. Rejects Replit-internal or insecure npm registry URLs.
 * 2. Rejects unresolved relative source imports and imports of retired route modules.
 *
 * This runs from package.json prebuild before Vite or esbuild starts.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { auditRelativeImports } from "./audit-relative-imports.mjs";

const lockPath = resolve(process.cwd(), "package-lock.json");
let content;
try {
  content = readFileSync(lockPath, "utf8");
} catch {
  console.error("❌  package-lock.json not found. Run npm install first.");
  process.exit(1);
}

const BLOCKED_PATTERNS = [
  "package-firewall.replit.local",
  "replit.local/npm",
  // Add other environment-only registry hostnames here if they ever appear.
];

let failed = false;
for (const pattern of BLOCKED_PATTERNS) {
  if (content.includes(pattern)) {
    console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
    console.error(`   package-lock.json contains an environment-internal registry URL:`);
    console.error(`   "${pattern}"`);
    console.error(`\n   Production deployments cannot reach this host.`);
    console.error(`   Replace it with https://registry.npmjs.org/ and commit the updated lockfile.`);
    failed = true;
  }
}

if (content.includes('"http://registry.npmjs.org')) {
  console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
  console.error(`   package-lock.json contains insecure http://registry.npmjs.org URLs.`);
  console.error(`   All resolved URLs must use https://`);
  failed = true;
}

if (failed) process.exit(1);
console.log("✅  Lockfile registry check passed — no internal or insecure registry URLs found.");

const importReport = auditRelativeImports();
if (importReport.failures.length > 0) {
  console.error("\n❌  PRODUCTION IMPORT BOUNDARY FAILED");
  for (const failure of importReport.failures) console.error(`   - ${failure}`);
  process.exit(1);
}

console.log(
  `✅  Relative imports verified across ${importReport.scannedFiles} source files (${importReport.checkedImports} relative imports).`,
);
