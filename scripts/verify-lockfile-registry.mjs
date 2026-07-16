#!/usr/bin/env node
/**
 * verify-lockfile-registry.mjs
 *
 * Ensures package-lock.json contains no Replit-internal registry URLs.
 * Exits with status 1 if any are found so the build fails before any
 * esbuild/vite step runs.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

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
  // Add other Replit-only registry hostnames here if they ever appear
];

let failed = false;
for (const pattern of BLOCKED_PATTERNS) {
  if (content.includes(pattern)) {
    console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
    console.error(`   package-lock.json contains a Replit-internal registry URL:`);
    console.error(`   "${pattern}"`);
    console.error(`\n   Production deployments (e.g. Render) cannot reach this host.`);
    console.error(`   Fix: run the following and commit the updated lockfile:`);
    console.error(`     sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json`);
    console.error(`   Then confirm with: grep -c 'package-firewall.replit.local' package-lock.json`);
    failed = true;
  }
}

// Also warn if any http:// (not https://) npm registry URLs sneak in
if (content.includes('"http://registry.npmjs.org')) {
  console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
  console.error(`   package-lock.json contains insecure http://registry.npmjs.org URLs.`);
  console.error(`   All resolved URLs must use https://`);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("✅  Lockfile registry check passed — no Replit-internal URLs found.");
