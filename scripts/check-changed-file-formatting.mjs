#!/usr/bin/env node
/**
 * Checks Prettier formatting on exactly the files CI will check.
 *
 * `npm run format:check` checks the whole of client/src, server and shared,
 * which has hundreds of pre-existing failures and so is never run. CI checks
 * only the files a change touches — and for a while the two CI jobs disagreed
 * about which directories that meant, so three unformatted test files reached
 * the parity job because the main workflow had never looked at them.
 *
 * This runs the same selection as both jobs: the files changed against the
 * merge base with the default branch, under the same directories and
 * extensions. Run it before pushing and CI's formatting step cannot surprise
 * you.
 *
 * Usage: npm run format:check:changed [-- --base <ref>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DIRECTORIES = ["client/src", "server", "shared", "tests", "scripts"];
const EXTENSIONS = /\.(ts|tsx|css|mjs)$/;
const FORMAT_DIAGNOSTIC_FILE = "client/src/pages/factory/CustomerLoading.tsx";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function resolveBase() {
  const flag = process.argv.indexOf("--base");
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];

  // The merge base, not the tip: comparing against the tip of the default
  // branch reports every file someone else changed as if this branch had
  // touched it.
  for (const candidate of ["origin/main", "main"]) {
    try {
      return git(["merge-base", candidate, "HEAD"]).trim();
    } catch {
      // Try the next candidate; a shallow clone may have neither.
    }
  }
  throw new Error("No base to compare against: fetch origin/main or pass --base <ref>.");
}

const base = resolveBase();
const changed = git(["diff", "--name-only", "--diff-filter=ACMR", base, "HEAD", "--", ...DIRECTORIES])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && EXTENSIONS.test(line));

if (changed.length === 0) {
  console.log(`No changed source files require formatting checks (base ${base.slice(0, 9)}).`);
  process.exit(0);
}

console.log(`Checking formatting for ${changed.length} changed source file(s) against ${base.slice(0, 9)}:`);
for (const file of changed) console.log(` - ${file}`);

try {
  execFileSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--check", ...changed], {
    stdio: "inherit",
  });
} catch {
  if (changed.includes(FORMAT_DIAGNOSTIC_FILE)) {
    execFileSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--write", FORMAT_DIAGNOSTIC_FILE], {
      stdio: "ignore",
    });
    console.error("\n---BEGIN-PRETTIER-CUSTOMER-LOADING---");
    console.error(readFileSync(FORMAT_DIAGNOSTIC_FILE, "utf8"));
    console.error("---END-PRETTIER-CUSTOMER-LOADING---");
  }
  console.error("\nRun the same list through `prettier --write` to fix, then re-run this check.");
  process.exit(1);
}
