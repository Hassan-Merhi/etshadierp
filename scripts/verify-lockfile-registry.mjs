#!/usr/bin/env node
/**
 * verify-lockfile-registry.mjs
 *
 * Ensures every package-lock.json in the repository contains no
 * Replit-internal registry URLs. Exits with status 1 if any are found so the
 * build fails before any esbuild/vite step runs.
 *
 * Every workspace with its own lockfile gets its own `npm ci`, so each one
 * needs the same guarantee: package-firewall.replit.local does not resolve
 * outside Replit, and an unresolvable `resolved` host fails the install rather
 * than falling back to the public registry.
 *
 * Lockfiles are discovered rather than listed, so a new workspace is covered
 * the day it is added. Discovery uses fs.globSync instead of `git ls-files`
 * because CI jobs unpack a source tarball and have no git repository to query,
 * and the returned paths stay relative to the working directory so no path is
 * ever assembled from a directory entry.
 */
import { globSync, readFileSync } from "fs";

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

const BLOCKED_PATTERNS = [
  "package-firewall.replit.local",
  "replit.local/npm",
  // Add other Replit-only registry hostnames here if they ever appear
];

// fs.globSync hands `exclude` either a path string or a Dirent depending on the
// Node release, so read the final segment from whichever shape arrives.
function basenameOf(entry) {
  return typeof entry === "string" ? entry.split(/[\\/]/).pop() : entry.name;
}

const lockfiles = globSync("**/package-lock.json", {
  exclude: (entry) => SKIP_DIRECTORIES.has(basenameOf(entry)),
})
  .map((lockfile) => lockfile.split("\\").join("/"))
  .sort();

if (!lockfiles.includes("package-lock.json")) {
  console.error("❌  package-lock.json not found. Run npm install first.");
  process.exit(1);
}

let failed = false;

for (const lockfile of lockfiles) {
  const content = readFileSync(lockfile, "utf8");

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

console.log(
  `✅  Lockfile registry check passed — no Replit-internal URLs found in ${lockfiles.length} lockfile(s): ${lockfiles.join(", ")}.`
);
