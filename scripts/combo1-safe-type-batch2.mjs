import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const strictAuditType = "Record<string, { old: any; new: any }>";
const partialAuditType = "Record<string, { old?: any; new?: any }>";

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

let strictCount = 0;
let partialCount = 0;
const auditFiles = [];
for (const path of walk("server")) {
  const source = readFileSync(path, "utf8");
  const oldCount = source.split(strictAuditType).length - 1;
  const newCount = source.split(partialAuditType).length - 1;
  strictCount += oldCount;
  partialCount += newCount;
  if (oldCount > 0) auditFiles.push({ path, source, oldCount });
}

if (strictCount === 13) {
  for (const { path, source } of auditFiles) {
    writeFileSync(path, source.split(strictAuditType).join(partialAuditType));
  }
} else if (strictCount !== 0 || partialCount < 13) {
  throw new Error(`Expected 13 strict audit annotations or an already-applied batch; found strict=${strictCount}, partial=${partialCount}`);
}

const supplierPath = "server/routes/supplierProformaRoutes.ts";
let supplierSource = readFileSync(supplierPath, "utf8");
const emptyNameOld = 'supplier?.name || ""';
const emptyNameNew = 'supplier?.legalName || ""';
const fallbackOld = "supplier?.legalName || supplier?.name ||";
const fallbackNew = "supplier?.legalName ||";
const emptyOldCount = supplierSource.split(emptyNameOld).length - 1;
const fallbackOldCount = supplierSource.split(fallbackOld).length - 1;

if (emptyOldCount === 2 && fallbackOldCount === 1) {
  supplierSource = supplierSource.split(emptyNameOld).join(emptyNameNew);
  supplierSource = supplierSource.replace(fallbackOld, fallbackNew);
  writeFileSync(supplierPath, supplierSource);
} else if (emptyOldCount !== 0 || fallbackOldCount !== 0) {
  throw new Error(`Expected supplier name patterns 2/1 or already applied; found ${emptyOldCount}/${fallbackOldCount}`);
}

console.log(`Combo 1 safe type batch 2 applied: audit annotations=${strictCount || 13}, supplier references=3.`);
