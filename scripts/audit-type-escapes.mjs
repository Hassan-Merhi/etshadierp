#!/usr/bin/env node
/**
 * audit-type-escapes.mjs
 *
 * A one-way ratchet on type escapes, the same shape as
 * scripts/audit-god-file-boundaries.mjs: every file's current count is frozen
 * in config/type-escape-boundaries.json, counts may fall freely, and any
 * increase fails.
 *
 * Why the counts come from the AST rather than a grep
 * ---------------------------------------------------
 * `grep -c ": any"` over this repository reports thousands of matches that are
 * not type escapes at all — the word appears in comments ("accepts any of the
 * three"), in string literals, and in JSX text. A baseline built from those
 * numbers would fail the moment someone reworded a comment, and would let a
 * real `any` slip in behind a deleted one. So the audit parses each file and
 * counts `AnyKeyword` nodes, which exist only in type positions.
 *
 * Two kinds are counted separately because they are different problems:
 *
 *   - `: any` (and `any[]`, `Promise<any>`, `Record<string, any>`) — a declared
 *     type that says nothing. Usually fixable locally.
 *   - `as any` — an assertion that overrides a type the compiler *had*. Higher
 *     risk: each one discards a guarantee that already existed, and the fix is
 *     rarely local.
 *
 * The audit also reports a reverse index of `(x as any).rows`, the specific
 * pattern that throws away a Drizzle query's result type. Those are the
 * highest-value targets because they are mechanical and high-count.
 *
 * Usage:
 *   npm run audit:type-escapes
 *   node scripts/audit-type-escapes.mjs --json
 *   UPDATE_TYPE_ESCAPE_BASELINE=1 node scripts/audit-type-escapes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config/type-escape-boundaries.json");

/** Directives that switch the compiler off for a line. */
const SUPPRESSION_PATTERN = /@ts-(ignore|expect-error)\b/g;

function normalizeRelativePath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function collectSourceFiles(root, scanConfig, output) {
  const absoluteRoot = path.join(projectRoot, root);
  if (!fs.existsSync(absoluteRoot)) return;

  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && scanConfig.excludeDirectories.includes(entry.name)) continue;

    const absolutePath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(normalizeRelativePath(absolutePath), scanConfig, output);
      continue;
    }

    const relativePath = normalizeRelativePath(absolutePath);
    if (!scanConfig.extensions.includes(path.extname(entry.name))) continue;
    if (scanConfig.excludeFiles.includes(relativePath)) continue;
    // Tests are held to the same rule as source, but declaration files are
    // often vendored shims where `any` is the accurate description.
    if (relativePath.endsWith(".d.ts")) continue;
    output.push(relativePath);
  }
}

/**
 * Counts type escapes in one file.
 *
 * `as any` is detected by walking up from the AnyKeyword to its parent: an
 * AsExpression whose type is that keyword. Everything else in a type position
 * is an explicit annotation. The two are disjoint, so explicitAny + asAny is
 * the total number of AnyKeyword nodes and nothing is counted twice.
 */
export function countFileEscapes(relativePath, source) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  let explicitAny = 0;
  let asAny = 0;
  let drizzleRowCasts = 0;

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent;
      if (parent && ts.isAsExpression(parent) && parent.type === node) {
        asAny += 1;
        // `(result as any).rows` — the Drizzle result cast. The AsExpression is
        // wrapped in parentheses, so the property access is the grandparent.
        const outer = ts.isParenthesizedExpression(parent.parent) ? parent.parent.parent : parent.parent;
        if (outer && ts.isPropertyAccessExpression(outer) && outer.name.text === "rows") {
          drizzleRowCasts += 1;
        }
      } else {
        explicitAny += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const suppressions = (source.match(SUPPRESSION_PATTERN) ?? []).length;

  return { explicitAny, asAny, suppressions, drizzleRowCasts };
}

function totalOf(counts) {
  return counts.explicitAny + counts.asAny + counts.suppressions;
}

export function auditTypeEscapes() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const scanConfig = config.scan;
  const baseline = scanConfig.baseline ?? {};
  const bucket = scanConfig.ratchetBucket ?? 1;

  const failures = [];
  const warnings = [];
  const files = [];

  const sourcePaths = [];
  for (const root of scanConfig.roots) {
    collectSourceFiles(root, scanConfig, sourcePaths);
  }
  sourcePaths.sort();

  for (const relativePath of sourcePaths) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    const counts = countFileEscapes(relativePath, source);
    const total = totalOf(counts);
    const frozen = baseline[relativePath];
    const cap = frozen === undefined ? 0 : frozen[0] + frozen[1] + frozen[2];

    let severity = "clean";
    if (total > cap) {
      severity = "failure";
      failures.push(
        frozen === undefined
          ? `${relativePath} introduces ${total} type escape(s); new files must not add any. Type the value, or record a baseline entry in config/type-escape-boundaries.json with a comment saying why it is unavoidable.`
          : `${relativePath} has ${total} type escapes; its frozen baseline is ${cap}. Escapes may be removed but never added — type the new code instead of widening the baseline.`
      );
    } else if (frozen !== undefined) {
      severity = total === cap ? "baselined" : "improved";
      if (total <= cap - bucket) {
        warnings.push(
          `${relativePath} is down to ${total} type escapes from a baseline of ${cap}; lower the baseline in the same change to lock in the gain`
        );
      }
    }

    if (frozen !== undefined || total > 0) {
      files.push({ path: relativePath, ...counts, total, cap, severity });
    }
  }

  // Baseline entries whose file has been deleted or renamed. Reported, not
  // fatal: a stale entry is harmless to correctness but makes the ceiling
  // overstate the real backlog, so it should still be cleaned up.
  const scanned = new Set(sourcePaths);
  const staleBaselineEntries = Object.keys(baseline).filter((entry) => !scanned.has(entry));
  for (const entry of staleBaselineEntries) {
    warnings.push(`${entry} has a baseline entry but no longer exists; remove it`);
  }

  const measuredTotal = files.reduce((sum, file) => sum + file.total, 0);
  const ceiling = config.totals?.typeEscapeCeiling;
  if (ceiling !== undefined && measuredTotal > ceiling) {
    failures.push(
      `Repository type-escape total is ${measuredTotal}; the ceiling is ${ceiling}. This number may only fall.`
    );
  }

  return {
    version: config.version,
    failures,
    warnings,
    files,
    staleBaselineEntries,
    summary: {
      scannedFiles: sourcePaths.length,
      filesWithEscapes: files.filter((file) => file.total > 0).length,
      explicitAny: files.reduce((sum, file) => sum + file.explicitAny, 0),
      asAny: files.reduce((sum, file) => sum + file.asAny, 0),
      suppressions: files.reduce((sum, file) => sum + file.suppressions, 0),
      drizzleRowCasts: files.reduce((sum, file) => sum + file.drizzleRowCasts, 0),
      // The backlog as a single number, asserted as a falling ceiling.
      typeEscapeTotal: measuredTotal,
      ceiling: ceiling ?? null,
      improvedFiles: files.filter((file) => file.severity === "improved").length,
      failedFiles: files.filter((file) => file.severity === "failure").length,
    },
  };
}

/** Rebuilds the baseline from the current tree. Used to seed it, not to fix a red build. */
function writeBaseline(report) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const baseline = {};
  for (const file of report.files) {
    if (file.total === 0) continue;
    baseline[file.path] = [file.explicitAny, file.asAny, file.suppressions];
  }
  config.scan.baseline = baseline;
  config.totals = { ...(config.totals ?? {}), typeEscapeCeiling: report.summary.typeEscapeTotal };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return Object.keys(baseline).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditTypeEscapes();

  if (process.env.UPDATE_TYPE_ESCAPE_BASELINE === "1") {
    const entries = writeBaseline(report);
    console.log(
      `Baseline rewritten: ${entries} files, ${report.summary.typeEscapeTotal} type escapes ` +
        `(${report.summary.explicitAny} \`: any\`, ${report.summary.asAny} \`as any\`, ${report.summary.suppressions} suppressions).`
    );
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  // Warnings are the drawdown signal and there can be many, so print a capped
  // sample rather than burying the failures under them.
  const WARNING_SAMPLE = 15;
  for (const warning of report.warnings.slice(0, WARNING_SAMPLE)) console.warn(`WARNING: ${warning}`);
  if (report.warnings.length > WARNING_SAMPLE) {
    console.warn(`WARNING: ...and ${report.warnings.length - WARNING_SAMPLE} more baselines with headroom to lower.`);
  }

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  } else {
    const { summary } = report;
    console.log(
      `Type escapes verified across ${summary.scannedFiles} files: ${summary.typeEscapeTotal} total ` +
        `(${summary.explicitAny} \`: any\`, ${summary.asAny} \`as any\`, ${summary.suppressions} suppressions) ` +
        `in ${summary.filesWithEscapes} files, ceiling ${summary.ceiling}.`
    );
    if (summary.drizzleRowCasts > 0) {
      console.log(
        `${summary.drizzleRowCasts} of the \`as any\` casts discard a Drizzle result type ((x as any).rows) — ` +
          `see Phase 1b in docs/system-quality-program.md.`
      );
    }
  }
}
