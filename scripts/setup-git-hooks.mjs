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
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = "scripts/git-hooks";

// Temporary CI-only diagnostic: ask the exact installed Prettier to print the
// unified diff for the two files the formatting gate reports. This is removed
// immediately after the runner exposes the canonical formatting changes.
if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
  const prettier = await import("prettier");
  const targets = ["client/src/pages/factory/FactoryWorkerDetail.tsx", "server/apiPaginationBridge.mjs"];
  const scratch = mkdtempSync(join(tmpdir(), "erp-prettier-diagnostic-"));

  try {
    for (const target of targets) {
      const source = readFileSync(join(repoRoot, target), "utf8");
      const config = (await prettier.resolveConfig(join(repoRoot, target))) ?? {};
      const formatted = await prettier.format(source, { ...config, filepath: join(repoRoot, target) });
      if (formatted === source) continue;

      const formattedPath = join(scratch, target.replaceAll("/", "__"));
      writeFileSync(formattedPath, formatted, "utf8");
      try {
        execFileSync("diff", ["-u", target, formattedPath], {
          cwd: repoRoot,
          stdio: ["ignore", "inherit", "inherit"],
        });
      } catch {
        // diff exits 1 when files differ; the printed unified diff is the diagnostic output.
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.exit(0);
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
