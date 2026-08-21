#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text.endsWith("\n") ? text : `${text}\n`);

const config = JSON.parse(read("config/god-file-boundaries.json"));
const soft = config.repositoryScan.softMaxLines;
const remaining = Object.keys(config.repositoryScan.grandfathered);
const excess = remaining.reduce((sum, rel) => {
  // Match scripts/audit-god-file-boundaries.mjs exactly: split on newline and
  // retain the trailing empty entry when the file ends with a newline.
  const lines = read(rel).split("\n").length;
  return sum + Math.max(0, lines - soft);
}, 0);

let test = read("tests/god-file-boundaries.test.ts");
test = test.replace(
  /expect\(report\.summary\.grandfatheredExcessLines\)\.toBeLessThanOrEqual\(\d+\);/,
  `expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual(${excess});`
);
write("tests/god-file-boundaries.test.ts", test);

let splitDoc = read("docs/god-file-split-program.md");
splitDoc = splitDoc.replace(
  /\*\*Backlog: [\d,]+ files, [\d,]+ lines over the limit\*\*/,
  `**Backlog: ${remaining.length.toLocaleString()} files, ${excess.toLocaleString()} lines over the limit**`
);
write("docs/god-file-split-program.md", splitDoc);

let quality = read("docs/system-quality-program.md");
quality = quality.replace(
  /God-file backlog \| [\d,]+ files, [\d,]+ excess lines/,
  `God-file backlog | ${remaining.length.toLocaleString()} files, ${excess.toLocaleString()} excess lines`
);
write("docs/system-quality-program.md", quality);

console.log(`WAVE5_AUTHORITATIVE_BACKLOG files=${remaining.length} excess=${excess}`);
