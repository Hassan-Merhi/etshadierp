#!/usr/bin/env node
/**
 * Point git at the committed hooks directory (scripts/git-hooks) so the
 * pre-push type-check gate installs automatically on `npm install`.
 *
 * Safe / idempotent:
 *  - No-ops silently outside a git work tree (e.g. CI checkouts, tarball installs).
 *  - Only sets core.hooksPath; never overwrites existing hook files.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = "scripts/git-hooks";

// Temporary Phase 2 diagnostic: npm's prepare hook runs after dev dependencies
// are installed, so CI can ask the repository's exact Prettier version for the
// canonical rendering of the one remaining formatting failure. This branch-only
// probe is removed immediately after the output is captured.
if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
  const prettier = await import("prettier");
  const target = join(repoRoot, "tests/factory-container-lifecycle.test.ts");
  const source = readFileSync(target, "utf8");
  const formatted = await prettier.format(source, {
    filepath: target,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "es5",
    printWidth: 120,
    bracketSpacing: true,
    arrowParens: "always",
    endOfLine: "lf",
  });
  console.log("PHASE2_PRETTIER_BEGIN");
  console.log(formatted);
  console.log("PHASE2_PRETTIER_END");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
}

try {
  // Bail quietly if this is not a git work tree.
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") process.exit(0);
} catch {
  process.exit(0);
}

try {
  git(["config", "core.hooksPath", hooksDir]);
  const hookPath = join(repoRoot, hooksDir, "pre-push");
  if (existsSync(hookPath)) chmodSync(hookPath, 0o755);
  console.log(`git hooks: core.hooksPath -> ${hooksDir} (pre-push type-check gate active)`);
} catch (err) {
  // Never fail an install because hook wiring did not take.
  console.warn(`git hooks: setup skipped (${err?.message ?? err})`);
}
