import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config/god-file-boundaries.json");

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function countLines(source) {
  if (source.length === 0) return 0;
  const lines = source.split(/\r?\n/);
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

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
    output.push(relativePath);
  }
}

export function auditGodFileBoundaries() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const failures = [];
  const warnings = [];
  const files = [];

  for (const retiredPath of config.retiredFiles) {
    if (fs.existsSync(path.join(projectRoot, retiredPath))) {
      failures.push(`${retiredPath} must remain deleted`);
    }
  }

  for (const boundary of config.boundedFiles) {
    const absolutePath = path.join(projectRoot, boundary.path);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`${boundary.path} is missing`);
      continue;
    }

    const source = readText(boundary.path);
    const lines = countLines(source);
    const matchedPatterns = boundary.forbidPatterns.filter((pattern) => source.includes(pattern));

    if (lines > boundary.maxLines) {
      failures.push(`${boundary.path} has ${lines} lines; maximum is ${boundary.maxLines}`);
    }
    for (const pattern of matchedPatterns) {
      failures.push(`${boundary.path} contains forbidden architecture pattern: ${pattern}`);
    }

    files.push({
      path: boundary.path,
      owner: boundary.owner,
      lines,
      maxLines: boundary.maxLines,
      matchedPatterns,
    });
  }

  const scannedFiles = [];
  if (config.repositoryScan) {
    const sourcePaths = [];
    for (const root of config.repositoryScan.roots) {
      collectSourceFiles(root, config.repositoryScan, sourcePaths);
    }

    // Files already over the limit when the ratchet was introduced are frozen
    // at their recorded size rather than exempted. They may shrink freely, but
    // any growth fails - so the backlog can only get smaller while the split
    // program runs.
    const grandfathered = config.repositoryScan.grandfathered ?? {};
    const bucket = config.repositoryScan.ratchetBucketLines ?? 25;

    sourcePaths.sort();
    for (const relativePath of sourcePaths) {
      const lines = countLines(readText(relativePath));
      const isGrandfathered = Object.prototype.hasOwnProperty.call(grandfathered, relativePath);
      const cap = isGrandfathered ? grandfathered[relativePath] : config.repositoryScan.softMaxLines;

      let severity = "ok";
      if (lines > cap) {
        severity = "failure";
        failures.push(
          isGrandfathered
            ? `${relativePath} has ${lines} lines; its frozen baseline is ${cap}. Oversized files may shrink but never grow - split it instead of extending it.`
            : `${relativePath} has ${lines} lines; the repository maximum is ${cap}. Split it, or record a baseline entry in config/god-file-boundaries.json if the size is genuinely unavoidable.`
        );
      } else if (isGrandfathered) {
        severity = "grandfathered";
        // Baselines are rounded up to a whole bucket, so every file starts just
        // under its cap. Only nudge once a full bucket has actually been
        // recovered, otherwise the rounding itself would warn on every file.
        if (lines <= cap - bucket) {
          warnings.push(
            `${relativePath} is now ${lines} lines, at least one bucket below its frozen baseline of ${cap}; lower the baseline to lock in the gain`
          );
        }
      }

      scannedFiles.push({ path: relativePath, lines, cap, severity });
    }
  }

  return {
    version: config.version,
    failures,
    warnings,
    files,
    scannedFiles,
    summary: {
      retiredFiles: config.retiredFiles.length,
      boundedFiles: config.boundedFiles.length,
      scannedFiles: scannedFiles.length,
      warningFiles: scannedFiles.filter((file) => file.severity === "warning").length,
      failedScanFiles: scannedFiles.filter((file) => file.severity === "failure").length,
      grandfatheredFiles: scannedFiles.filter((file) => file.severity === "grandfathered").length,
      // Lines carried above the repository limit by grandfathered files. This is
      // the split program's backlog expressed as a single number, and it should
      // fall monotonically.
      grandfatheredExcessLines: scannedFiles
        .filter((file) => file.severity === "grandfathered")
        .reduce(
          (total, file) => total + Math.max(0, file.lines - config.repositoryScan.softMaxLines),
          0
        ),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditGodFileBoundaries();
  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `God-file boundaries verified for ${report.summary.boundedFiles} explicit files and ${report.summary.scannedFiles} repository source files.`
    );
  }
}
