import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceExact(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`);
  }
  return source.replace(oldText, newText);
}

function replaceAllCount(source, oldText, newText, expected, label) {
  const count = source.split(oldText).length - 1;
  if (count !== expected) {
    throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  }
  return source.split(oldText).join(newText);
}

function removePropertyFromVoucherEntryValues(source, property, label) {
  let removed = 0;
  const next = source.replace(
    /(insert\(voucherEntries\)\.values\()([\s\S]*?)(\)\s*;)/g,
    (whole, prefix, body, suffix) => {
      const propertyPattern = new RegExp(`^[ \\t]*${property}:\\s*[^\\n]+,\\r?\\n`, "gm");
      const matches = body.match(propertyPattern) ?? [];
      removed += matches.length;
      return prefix + body.replace(propertyPattern, "") + suffix;
    }
  );
  if (removed === 0) {
    throw new Error(`${label}: no ${property} properties removed from voucherEntries inserts`);
  }
  return { source: next, removed };
}

const accountingPath = "server/routes/containers/containerAccountingRoutes.ts";
let accounting = read(accountingPath);
accounting = replaceAllCount(
  accounting,
  "poContainerRow?.containerNumber",
  "container.containerNumber",
  3,
  "containerAccounting poContainerRow"
);
accounting = replaceExact(
  accounting,
  "            // ── Fix the local purchase voucher ────────────────────────────────\n",
  "            const poContainerId = po.containerId;\n" +
    "            const cNum = poContainerId\n" +
    "              ? (containerNumberMap.get(poContainerId) ?? String(poContainerId))\n" +
    "              : String(po.id);\n" +
    "            const isSameCompanyPo = !parentCompanyId || po.companyId === parentCompanyId;\n\n" +
    "            // ── Fix the local purchase voucher ────────────────────────────────\n",
  "containerAccounting loop-scope declarations"
);
accounting = replaceExact(
  accounting,
  "                const isSameCompanyPo = !parentCompanyId || po.companyId === parentCompanyId;\n",
  "",
  "containerAccounting inner isSameCompanyPo"
);
accounting = replaceExact(
  accounting,
  "            // ── Compute container number for this PO (used by parent sync) ──\n" +
    "            const poContainerId = po.containerId;\n" +
    "            const cNum = poContainerId\n" +
    "              ? (containerNumberMap.get(poContainerId) ?? String(poContainerId))\n" +
    "              : String(po.id);\n\n",
  "",
  "containerAccounting late cNum declaration"
);
const accountingRemoval = removePropertyFromVoucherEntryValues(accounting, "companyId", "containerAccounting");
accounting = accountingRemoval.source;
write(accountingPath, accounting);

const readPath = "server/routes/containers/containerFreightReadRoutes.ts";
let freightRead = read(readPath);
freightRead = replaceAllCount(
  freightRead,
  "poLineItems.purchaseOrderId",
  "poLineItems.poId",
  2,
  "containerFreightRead schema field"
);
freightRead = replaceAllCount(
  freightRead,
  "li.purchaseOrderId",
  "li.poId",
  2,
  "containerFreightRead row field"
);
const readRemoval = removePropertyFromVoucherEntryValues(freightRead, "companyId", "containerFreightRead");
freightRead = readRemoval.source;
write(readPath, freightRead);

const writePath = "server/routes/containers/containerFreightWriteRoutes.ts";
let freightWrite = read(writePath);
freightWrite = replaceExact(
  freightWrite,
  "} from \"@shared/schema\";\nimport {\n  eq,",
  "} from \"@shared/schema\";\nimport type { InsertPurchaseOrder } from \"@shared/schema\";\nimport {\n  eq,",
  "containerFreightWrite InsertPurchaseOrder import"
);
freightWrite = replaceAllCount(
  freightWrite,
  ".where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, freightVoucherNum)))",
  ".where(and(eq(vouchers.companyId, existingPO.companyId), eq(vouchers.voucherNumber, freightVoucherNum)))",
  2,
  "containerFreightWrite company scope queries"
);
freightWrite = replaceExact(
  freightWrite,
  "                .values({\n                  companyId,\n                  voucherNumber: freightVoucherNum,",
  "                .values({\n                  companyId: existingPO.companyId,\n                  voucherNumber: freightVoucherNum,",
  "containerFreightWrite freight voucher company"
);
const writeRemoval = removePropertyFromVoucherEntryValues(freightWrite, "companyId", "containerFreightWrite");
freightWrite = writeRemoval.source;
write(writePath, freightWrite);

const factoryPath = "server/routes/factory/factoryContainersRoutes.ts";
let factory = read(factoryPath);
const factoryRemoval = removePropertyFromVoucherEntryValues(factory, "companyId", "factoryContainers");
factory = factoryRemoval.source;
write(factoryPath, factory);

console.log(
  JSON.stringify(
    {
      accountingVoucherEntryCompanyIdsRemoved: accountingRemoval.removed,
      freightReadVoucherEntryCompanyIdsRemoved: readRemoval.removed,
      freightWriteVoucherEntryCompanyIdsRemoved: writeRemoval.removed,
      factoryVoucherEntryCompanyIdsRemoved: factoryRemoval.removed,
    },
    null,
    2
  )
);
