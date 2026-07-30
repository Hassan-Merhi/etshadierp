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

export function auditGodFileBoundaries() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const failures = [];
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
      failures.push(`${boundary.path} contains forbidden route registration pattern: ${pattern}`);
    }

    files.push({
      path: boundary.path,
      owner: boundary.owner,
      lines,
      maxLines: boundary.maxLines,
      matchedPatterns,
    });
  }

  return {
    version: config.version,
    failures,
    files,
    summary: {
      retiredFiles: config.retiredFiles.length,
      boundedFiles: config.boundedFiles.length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditGodFileBoundaries();
  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`God-file boundaries verified for ${report.summary.boundedFiles} active composition files.`);
  }
}
