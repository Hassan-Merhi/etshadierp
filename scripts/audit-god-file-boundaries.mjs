import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config/god-file-boundaries.json");

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function countLines(source) {
  return source.length === 0 ? 0 : source.split(/\r?\n/).length;
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

    sourcePaths.sort();
    for (const relativePath of sourcePaths) {
      const lines = countLines(readText(relativePath));
      const severity =
        lines > config.repositoryScan.hardMaxLines
          ? "failure"
          : lines > config.repositoryScan.softMaxLines
            ? "warning"
            : "ok";

      if (severity === "failure") {
        failures.push(
          `${relativePath} has ${lines} lines; repository hard maximum is ${config.repositoryScan.hardMaxLines}`
        );
      } else if (severity === "warning") {
        warnings.push(
          `${relativePath} has ${lines} lines; consider splitting before it exceeds ${config.repositoryScan.hardMaxLines}`
        );
      }

      scannedFiles.push({ path: relativePath, lines, severity });
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
