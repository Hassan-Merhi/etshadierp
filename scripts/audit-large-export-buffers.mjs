#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_ROOT = path.join(ROOT, "server");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

const patterns = [
  { id: "excel-write-buffer", regex: /\.xlsx\.writeBuffer\s*\(/g, severity: "high" },
  { id: "buffer-concat", regex: /Buffer\.concat\s*\(/g, severity: "high" },
  { id: "pdf-buffer-array", regex: /chunks\s*:\s*Buffer\[\]|const\s+chunks\s*=\s*\[\]/g, severity: "medium" },
  { id: "response-buffer-end", regex: /res\.end\s*\(\s*(?:await\s+)?[^\n;]*(?:writeBuffer|Buffer)/g, severity: "high" },
  { id: "archive-buffering", regex: /archiver\s*\([^)]*\)[\s\S]{0,500}Buffer\.concat/g, severity: "high" },
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

const files = await walk(SERVER_ROOT);
const findings = [];

for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of source.matchAll(pattern.regex)) {
      findings.push({
        severity: pattern.severity,
        pattern: pattern.id,
        file: path.relative(ROOT, file).replaceAll(path.sep, "/"),
        line: lineNumberAt(source, match.index ?? 0),
        excerpt: match[0].replace(/\s+/g, " ").slice(0, 180),
      });
    }
  }
}

findings.sort((a, b) => {
  const weight = { high: 0, medium: 1, low: 2 };
  return weight[a.severity] - weight[b.severity] || a.file.localeCompare(b.file) || a.line - b.line;
});

const summary = findings.reduce((acc, finding) => {
  acc[finding.pattern] = (acc[finding.pattern] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), total: findings.length, summary, findings }, null, 2));

if (process.env.EXPORT_BUFFER_AUDIT_FAIL === "1" && findings.some((finding) => finding.severity === "high")) {
  process.exitCode = 1;
}
