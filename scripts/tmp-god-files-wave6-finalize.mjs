#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text.endsWith("\n") ? text : `${text}\n`);
const lines = (rel) => read(rel).split("\n").length - 1;

const godPath = "config/god-file-boundaries.json";
const god = JSON.parse(read(godPath));
const priorVersion = Number(god.version) || 0;
const finalVersion = Math.max(31, priorVersion + 1);
const soft = Number(god.repositoryScan.softMaxLines);
const wave6Targets = [
  "client/src/pages/BaleProducts.tsx",
  "client/src/pages/ContainerDetail.tsx",
  "client/src/pages/factory/FactoryStockAllocationV5.tsx",
];
for (const rel of wave6Targets) {
  if (lines(rel) > soft) throw new Error(`${rel} still exceeds ${soft}: ${lines(rel)}`);
}
const nextGrandfathered = {};
for (const [rel, cap] of Object.entries(god.repositoryScan.grandfathered)) {
  if (!fs.existsSync(path.join(root, rel))) continue;
  if (lines(rel) > soft) nextGrandfathered[rel] = cap;
}
const remaining = Object.keys(nextGrandfathered);
if (remaining.length !== 2 || !remaining.includes("server/chatService.ts") || !remaining.includes("server/index.ts")) {
  throw new Error(`Expected only chatService.ts and server/index.ts after Wave 6; got ${remaining.join(", ")}`);
}
const excess = remaining.reduce((sum, rel) => sum + Math.max(0, lines(rel) - soft), 0);
god.version = finalVersion;
god.description = `Version ${finalVersion} reconciles the cumulative God Files branch with current main and completes cumulative Wave 6 by retiring BaleProducts.tsx, ContainerDetail.tsx, and FactoryStockAllocationV5.tsx through focused typed model and presentation extraction. ${god.description}`;
god.repositoryScan.grandfathered = nextGrandfathered;
write(godPath, JSON.stringify(god, null, 2));

let test = read("tests/god-file-boundaries.test.ts");
test = test.replace(/expect\(report\.version\)\.toBe\(\d+\);/, `expect(report.version).toBe(${finalVersion});`);
test = test.replace(/expect\(report\.summary\.grandfatheredFiles\)\.toBeLessThanOrEqual\(\d+\);/, `expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual(${remaining.length});`);
test = test.replace(/expect\(report\.summary\.grandfatheredExcessLines\)\.toBeLessThanOrEqual\(\d+\);/, `expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual(${excess});`);
write("tests/god-file-boundaries.test.ts", test);

let splitDoc = read("docs/god-file-split-program.md");
splitDoc = splitDoc.replace(/\*\*Backlog: [\d,]+ files, [\d,]+ lines over the limit\*\*/, `**Backlog: ${remaining.length.toLocaleString("en-US")} files, ${excess.toLocaleString("en-US")} lines over the limit**`);
write("docs/god-file-split-program.md", splitDoc);

const typePath = "config/type-escape-boundaries.json";
const typeConfig = JSON.parse(read(typePath));
const priorCeiling = Number(typeConfig.totals?.typeEscapeCeiling ?? Number.MAX_SAFE_INTEGER);
const audit = spawnSync(process.execPath, ["scripts/audit-type-escapes.mjs", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (!audit.stdout) throw new Error(`Type-escape audit produced no JSON: ${audit.stderr}`);
const report = JSON.parse(audit.stdout);
const measured = Number(report.summary.typeEscapeTotal);
if (measured > priorCeiling) throw new Error(`Wave 6 would raise type escapes ${priorCeiling} -> ${measured}`);
const counts = new Map(report.files.map((file) => [file.path, file]));
const wave6Generated = [
  "client/src/pages/baleproducts/useBaleProductsModel.tsx",
  "client/src/pages/containerdetail/useContainerDetailModel.tsx",
  "client/src/pages/factory/factorystockallocationv5/useFactoryStockAllocationV5Model.tsx",
];
for (const rel of wave6Generated) {
  const file = counts.get(rel);
  if (file && file.total > 0) typeConfig.scan.baseline[rel] = [file.explicitAny, file.asAny, file.suppressions];
  else delete typeConfig.scan.baseline[rel];
}
for (const rel of Object.keys(typeConfig.scan.baseline)) if (!fs.existsSync(path.join(root, rel))) delete typeConfig.scan.baseline[rel];
typeConfig.totals = { ...(typeConfig.totals ?? {}), typeEscapeCeiling: measured };
write(typePath, JSON.stringify(typeConfig, null, 2));

let quality = read("docs/system-quality-program.md");
quality = quality.replace(/God-file backlog \| [\d,]+ files, [\d,]+ excess lines/, `God-file backlog | ${remaining.length.toLocaleString("en-US")} files, ${excess.toLocaleString("en-US")} excess lines`);
quality = quality.replace(/Type escapes \(AST\) \| [\d,]+ total/, `Type escapes (AST) | ${measured.toLocaleString("en-US")} total`);
write("docs/system-quality-program.md", quality);

console.log(`WAVE6_RATCHETS version=${finalVersion} files=${remaining.length} excess=${excess} typeEscapes=${measured}`);
