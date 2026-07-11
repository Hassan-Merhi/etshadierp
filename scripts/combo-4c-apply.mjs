import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function removeVoucherEntryCompanyIds(source) {
  let removed = 0;
  const next = source.replace(
    /(insert\(voucherEntries\)\.values\()([\s\S]*?)(\)\s*;)/g,
    (_whole, prefix, body, suffix) => {
      const cleaned = body.replace(/^[ \t]*companyId:\s*[^\n]+,\r?\n/gm, () => {
        removed += 1;
        return "";
      });
      return prefix + cleaned + suffix;
    }
  );
  return { source: next, removed };
}

function assertAbsent(source, pattern, label) {
  if (source.includes(pattern)) {
    throw new Error(`${label}: forbidden pattern remains: ${pattern}`);
  }
}

function assertPresent(source, pattern, label) {
  if (!source.includes(pattern)) {
    throw new Error(`${label}: expected pattern is missing: ${pattern}`);
  }
}

const accountingPath = "server/routes/containers/containerAccountingRoutes.ts";
let accounting = read(accountingPath);
accounting = accounting
  .replaceAll("poContainerRow?.containerNumber", "container.containerNumber")
  .replaceAll("poContainerRow.containerNumber", "container.containerNumber");

const lateContainerNumberBlock =
  "            // ── Compute container number for this PO (used by parent sync) ──\n" +
  "            const poContainerId = po.containerId;\n" +
  "            const cNum = poContainerId\n" +
  "              ? (containerNumberMap.get(poContainerId) ?? String(poContainerId))\n" +
  "              : String(po.id);\n\n";
accounting = accounting.replace(lateContainerNumberBlock, "");

const localVoucherMarker = "            // ── Fix the local purchase voucher ────────────────────────────────\n";
const loopDeclarations =
  "            const poContainerId = po.containerId;\n" +
  "            const cNum = poContainerId\n" +
  "              ? (containerNumberMap.get(poContainerId) ?? String(poContainerId))\n" +
  "              : String(po.id);\n" +
  "            const isSameCompanyPo = !parentCompanyId || po.companyId === parentCompanyId;\n\n";
if (!accounting.includes(loopDeclarations)) {
  if (!accounting.includes(localVoucherMarker)) {
    throw new Error("containerAccounting: local voucher marker not found");
  }
  accounting = accounting.replace(localVoucherMarker, loopDeclarations + localVoucherMarker);
}
accounting = accounting.replace(
  "                const isSameCompanyPo = !parentCompanyId || po.companyId === parentCompanyId;\n",
  ""
);
const accountingRemoval = removeVoucherEntryCompanyIds(accounting);
accounting = accountingRemoval.source;
assertAbsent(accounting, "poContainerRow", "containerAccounting");
assertPresent(accounting, loopDeclarations.trimEnd(), "containerAccounting loop declarations");
write(accountingPath, accounting);

const readPath = "server/routes/containers/containerFreightReadRoutes.ts";
let freightRead = read(readPath)
  .replaceAll("poLineItems.purchaseOrderId", "poLineItems.poId")
  .replaceAll("li.purchaseOrderId", "li.poId");
const readRemoval = removeVoucherEntryCompanyIds(freightRead);
freightRead = readRemoval.source;
assertAbsent(freightRead, "purchaseOrderId", "containerFreightRead");
write(readPath, freightRead);

const writePath = "server/routes/containers/containerFreightWriteRoutes.ts";
let freightWrite = read(writePath);
if (!freightWrite.includes('import type { InsertPurchaseOrder } from "@shared/schema";')) {
  const importMarker = '} from "@shared/schema";\nimport {\n  eq,';
  if (!freightWrite.includes(importMarker)) {
    throw new Error("containerFreightWrite: shared-schema import marker not found");
  }
  freightWrite = freightWrite.replace(
    importMarker,
    '} from "@shared/schema";\nimport type { InsertPurchaseOrder } from "@shared/schema";\nimport {\n  eq,'
  );
}
freightWrite = freightWrite.replaceAll(
  ".where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))",
  ".where(and(eq(vouchers.companyId, existingPO.companyId), eq(vouchers.voucherNumber, freightVoucherNum)))"
);
freightWrite = freightWrite.replace(
  "                .values({\n                  companyId,\n                  voucherNumber: freightVoucherNum,",
  "                .values({\n                  companyId: existingPO.companyId,\n                  voucherNumber: freightVoucherNum,"
);
const writeRemoval = removeVoucherEntryCompanyIds(freightWrite);
freightWrite = writeRemoval.source;
assertPresent(
  freightWrite,
  'import type { InsertPurchaseOrder } from "@shared/schema";',
  "containerFreightWrite type import"
);
assertAbsent(
  freightWrite,
  ".where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))",
  "containerFreightWrite company scope"
);
write(writePath, freightWrite);

const factoryPath = "server/routes/factory/factoryContainersRoutes.ts";
let factory = read(factoryPath);
const factoryRemoval = removeVoucherEntryCompanyIds(factory);
factory = factoryRemoval.source;
write(factoryPath, factory);

const totalRemoved =
  accountingRemoval.removed + readRemoval.removed + writeRemoval.removed + factoryRemoval.removed;

console.log(
  JSON.stringify(
    {
      accountingVoucherEntryCompanyIdsRemoved: accountingRemoval.removed,
      freightReadVoucherEntryCompanyIdsRemoved: readRemoval.removed,
      freightWriteVoucherEntryCompanyIdsRemoved: writeRemoval.removed,
      factoryVoucherEntryCompanyIdsRemoved: factoryRemoval.removed,
      totalRemoved,
    },
    null,
    2
  )
);
