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
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = "scripts/git-hooks";

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
