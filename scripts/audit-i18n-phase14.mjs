import fs from "node:fs";
import path from "node:path";

const roots = ["client/src", "server", "shared"];
const extensions = new Set([".ts", ".tsx"]);
const ignored = new Set(["node_modules", "dist", "coverage"]);
const findings = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) inspect(full);
  }
}

function inspect(file) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/data-no-translate|data-business-value|data-stock-name|data-account-code/.test(line)) return;
    const jsxText = line.match(/>([A-Z][A-Za-z][^<{]{2,80})</g) ?? [];
    const uiAttrs = line.match(/(?:title|placeholder|aria-label)="([A-Z][^"]{2,80})"/g) ?? [];
    for (const value of [...jsxText, ...uiAttrs]) {
      findings.push(`${file}:${index + 1}: ${value.trim()}`);
    }
  });
}

for (const root of roots) walk(root);

const baselinePath = "config/i18n-phase14-baseline.json";
const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : { maxFindings: findings.length };

console.log(`Phase 14 i18n audit: ${findings.length} candidate literals`);
if (findings.length > baseline.maxFindings) {
  console.error(`Untranslated-text candidates increased above baseline ${baseline.maxFindings}.`);
  console.error(findings.slice(0, 50).join("\n"));
  process.exit(1);
}
