#!/usr/bin/env node
/**
 * audit-script-inventory.mjs
 *
 * Keeps `scripts/` honest about which of its verifiers are gates and which are
 * decoration.
 *
 * Every `verify-*.mjs` and `audit-*.mjs` falls into one of three buckets:
 *
 *   wired    — invoked by a workflow, package.json, or CircleCI. A real gate.
 *   chained  — invoked by another script or referenced by a test. Runs, but
 *              only because something else runs it.
 *   orphan   — nothing invokes it.
 *
 * Two rules are enforced:
 *
 *   1. **A wired script must pass.** A gate that cannot pass is either broken
 *      or lying, and either way CI is not checking what its name claims.
 *   2. **The orphan count may only fall.** An orphan that also fails is the
 *      worst case — it looks like coverage and provides none. Sixteen of those
 *      were deleted when this audit was written: each asserted literal source
 *      text that the god-file split had legitimately moved, so they had been
 *      failing silently for as long as nobody ran them.
 *
 * Rule 1 is skipped for scripts that need a build artifact, a database, or the
 * network — those legitimately fail on a bare checkout and are listed in
 * config/script-inventory.json with the reason.
 *
 * Usage:
 *   npm run audit:scripts
 *   node scripts/audit-script-inventory.mjs --json
 *   node scripts/audit-script-inventory.mjs --list
 *   UPDATE_SCRIPT_INVENTORY=1 node scripts/audit-script-inventory.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config/script-inventory.json");

/** This audit is wired too; running itself would recurse until the timeout. */
const SELF = "audit-script-inventory.mjs";

function listScripts() {
  return fs
    .readdirSync(path.join(projectRoot, "scripts"))
    .filter((name) => /^(verify|audit)-.*\.mjs$/.test(name))
    .sort();
}

/** Files that could plausibly invoke a script, excluding the scripts themselves. */
function collectInvokers() {
  const roots = [".github/workflows", ".circleci", "scripts", "tests"];
  const invokers = new Map();
  const add = (relativePath) => {
    const absolute = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const entry of fs.readdirSync(absolute)) add(path.join(relativePath, entry));
      return;
    }
    try {
      invokers.set(relativePath.split(path.sep).join("/"), fs.readFileSync(absolute, "utf8"));
    } catch {
      /* unreadable files cannot invoke anything */
    }
  };
  roots.forEach(add);
  add("package.json");
  return invokers;
}

/**
 * The arguments package.json actually invokes a script with.
 *
 * Several scripts are report-style: run bare they print findings and exit
 * non-zero, but the npm script passes `--json` and they exit clean. Running
 * them without those arguments measures an invocation nobody uses, and reports
 * a gate as broken when it is not.
 */
function invocationArgs(script, invokers) {
  const pkg = invokers.get("package.json");
  if (!pkg) return [];
  const match = pkg.match(new RegExp(`node scripts/${script.replace(/\./g, "\\.")}([^"]*)"`));
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean);
}

function classify(script, invokers) {
  const gates = [];
  const chains = [];
  for (const [file, text] of invokers) {
    if (file === `scripts/${script}`) continue;
    if (!text.includes(script)) continue;
    if (file.startsWith(".github/") || file.startsWith(".circleci") || file === "package.json") gates.push(file);
    else chains.push(file);
  }
  if (gates.length) return { bucket: "wired", invokedBy: gates };
  if (chains.length) return { bucket: "chained", invokedBy: chains };
  return { bucket: "orphan", invokedBy: [] };
}

export function auditScriptInventory({ run = true } = {}) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const environmentDependent = new Set(Object.keys(config.environmentDependent ?? {}));
  const knownFailing = new Set(Object.keys(config.knownFailing ?? {}));
  const invokers = collectInvokers();
  const failures = [];
  const scripts = [];

  for (const script of listScripts()) {
    const { bucket, invokedBy } = classify(script, invokers);
    let passes = null;
    if (run && bucket === "wired" && script !== SELF && !environmentDependent.has(script)) {
      const result = spawnSync(process.execPath, [path.join("scripts", script), ...invocationArgs(script, invokers)], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 120000,
        // Report-style scripts print thousands of findings. The default 1MB
        // buffer overflows, spawnSync kills the child with SIGTERM, and the
        // gate gets reported as broken when it exited cleanly.
        maxBuffer: 64 * 1024 * 1024,
      });
      passes = result.status === 0;
      if (!passes && !knownFailing.has(script)) {
        const detail = `${result.stderr || result.stdout || ""}`.trim().split("\n").slice(0, 3).join(" / ");
        failures.push(
          `scripts/${script} is wired into ${invokedBy.join(", ")} but exits non-zero: ${detail || "no output"}`
        );
      }
    }
    scripts.push({ script, bucket, invokedBy, passes });
  }

  // A gate on the known-failing list that starts passing should come off it,
  // or the list quietly becomes permission to stay broken.
  const recovered = scripts.filter((entry) => knownFailing.has(entry.script) && entry.passes === true);
  for (const entry of recovered) {
    failures.push(
      `scripts/${entry.script} now passes but is still listed in knownFailing. Remove the entry — ` +
        `the list may only shrink.`
    );
  }

  const orphans = scripts.filter((entry) => entry.bucket === "orphan");
  const ceiling = config.orphanCeiling;
  if (ceiling !== undefined && orphans.length > ceiling) {
    failures.push(
      `${orphans.length} verify/audit scripts are invoked by nothing; the ceiling is ${ceiling}. ` +
        `Wire it up, or delete it — a script nobody runs cannot be a check.`
    );
  }

  return {
    version: config.version,
    failures,
    scripts,
    recovered,
    summary: {
      total: scripts.length,
      wired: scripts.filter((entry) => entry.bucket === "wired").length,
      chained: scripts.filter((entry) => entry.bucket === "chained").length,
      orphan: orphans.length,
      orphanCeiling: ceiling ?? null,
      environmentDependent: environmentDependent.size,
      knownFailing: knownFailing.size,
      recovered: recovered.length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditScriptInventory();

  if (process.env.UPDATE_SCRIPT_INVENTORY === "1") {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.orphanCeiling = report.summary.orphan;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Orphan ceiling set to ${report.summary.orphan}.`);
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  if (process.argv.includes("--list")) {
    for (const bucket of ["wired", "chained", "orphan"]) {
      const entries = report.scripts.filter((entry) => entry.bucket === bucket);
      console.log(`\n${bucket} (${entries.length})`);
      for (const entry of entries) console.log(`  ${entry.script}`);
    }
    console.log("");
  }

  const { summary } = report;
  console.log(
    `Scripts: ${summary.total} — ${summary.wired} wired, ${summary.chained} chained, ` +
      `${summary.orphan} orphaned (ceiling ${summary.orphanCeiling}).`
  );

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  }
}
