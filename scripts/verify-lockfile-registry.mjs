#!/usr/bin/env node
/**
 * verify-lockfile-registry.mjs
 *
 * Ensures every package-lock.json in the repository contains no
 * Replit-internal registry URLs. Exits with status 1 if any are found so the
 * build fails before any esbuild/vite step runs.
 *
 * The desktop workspace has its own lockfile and its own `npm ci`, so it needs
 * the same guarantee: package-firewall.replit.local does not resolve outside
 * Replit, and an unresolvable `resolved` host fails the install rather than
 * falling back to the public registry.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const LOCKFILES = ["package-lock.json", "desktop/package-lock.json"];

const BLOCKED_PATTERNS = [
  "package-firewall.replit.local",
  "replit.local/npm",
  // Add other Replit-only registry hostnames here if they ever appear
];

const root = process.cwd();
const checked = [];
let failed = false;

for (const lockfile of LOCKFILES) {
  const lockPath = resolve(root, lockfile);

  if (!existsSync(lockPath)) {
    if (lockfile === "package-lock.json") {
      console.error("❌  package-lock.json not found. Run npm install first.");
      process.exit(1);
    }
    // A workspace lockfile that is not present simply has nothing to check.
    continue;
  }

  const content = readFileSync(lockPath, "utf8");
  checked.push(lockfile);

  for (const pattern of BLOCKED_PATTERNS) {
    if (content.includes(pattern)) {
      console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
      console.error(`   ${lockfile} contains a Replit-internal registry URL:`);
      console.error(`   "${pattern}"`);
      console.error(`\n   Production deployments (e.g. Render) and CI runners cannot reach this host.`);
      console.error(`   Fix: run the following and commit the updated lockfile:`);
      console.error(`     sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' ${lockfile}`);
      console.error(`   Then confirm with: grep -c 'package-firewall.replit.local' ${lockfile}`);
      failed = true;
    }
  }

  // Also warn if any http:// (not https://) npm registry URLs sneak in
  if (content.includes('"http://registry.npmjs.org')) {
    console.error(`\n❌  LOCKFILE SAFETY CHECK FAILED`);
    console.error(`   ${lockfile} contains insecure http://registry.npmjs.org URLs.`);
    console.error(`   All resolved URLs must use https://`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`✅  Lockfile registry check passed — no Replit-internal URLs found in ${checked.join(", ")}.`);
