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
 * Lockfiles are discovered by walking the tree rather than from a fixed list,
 * so a new workspace is covered the day it is added. The walk is used instead
 * of `git ls-files` because CI jobs unpack a source tarball and have no git
 * repository to query.
 */
import { readFileSync, readdirSync } from "fs";
import { join, relative, resolve, sep } from "path";

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

const root = process.cwd();

function findLockfiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...findLockfiles(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name === "package-lock.json") {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

const lockfiles = findLockfiles(root)
  .map((absolute) => relative(root, absolute).split(sep).join("/"))
  .sort();

if (!lockfiles.includes("package-lock.json")) {
  console.error("❌  package-lock.json not found. Run npm install first.");
  process.exit(1);
}

let failed = false;

for (const lockfile of lockfiles) {
  const content = readFileSync(resolve(root, lockfile), "utf8");

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
