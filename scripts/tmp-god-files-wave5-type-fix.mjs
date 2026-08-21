#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const configPath = path.join(root, "config/type-escape-boundaries.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const ceiling = Number(config.totals?.typeEscapeCeiling ?? Number.MAX_SAFE_INTEGER);

const audit = spawnSync(process.execPath, ["scripts/audit-type-escapes.mjs", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (!audit.stdout) throw new Error(`Type-escape audit produced no JSON: ${audit.stderr}`);
const report = JSON.parse(audit.stdout);
const measured = Number(report.summary.typeEscapeTotal);
if (measured > ceiling) {
  throw new Error(`Wave 5 would raise the live type-escape ceiling ${ceiling} -> ${measured}`);
}

const movedHookPaths = [
  "client/src/pages/factory/factoryinvoicedetail/useFactoryInvoiceDetailModel.tsx",
  "client/src/pages/factory/baleshistory/useBalesHistoryModel.tsx",
  "client/src/pages/factory/factorypendinginvoiceverify/useFactoryPendingInvoiceVerifyModel.tsx",
];
const counts = new Map(report.files.map((file) => [file.path, file]));
for (const rel of movedHookPaths) {
  const file = counts.get(rel);
  if (file && file.total > 0) {
    config.scan.baseline[rel] = [file.explicitAny, file.asAny, file.suppressions];
    console.log(`WAVE5_TYPE_BASELINE ${rel}=${file.total}`);
  } else {
    delete config.scan.baseline[rel];
    console.log(`WAVE5_TYPE_BASELINE ${rel}=0`);
  }
}
config.totals = { ...(config.totals ?? {}), typeEscapeCeiling: measured };
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`WAVE5_TYPE_CEILING total=${measured}`);

const lintFix = spawnSync(process.execPath, ["scripts/tmp-god-files-wave5-lint-fix.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (lintFix.status !== 0) throw new Error(`Wave 5 lint cleanup failed with status ${lintFix.status}`);
