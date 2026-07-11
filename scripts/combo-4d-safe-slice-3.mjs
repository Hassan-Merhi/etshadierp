import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceOnceOrVerify(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count === 1) return source.replace(oldText, newText);
  if (count === 0 && source.includes(newText)) return source;
  throw new Error(`${label}: expected one source match or an already-applied replacement, found ${count}`);
}

const helpersPath = "server/routes/factory/_helpers.ts";
let helpers = read(helpersPath);
helpers = replaceOnceOrVerify(
  helpers,
  "mixSources.map((s) => s.mixBatchId)",
  "mixSources.map((s: (typeof mixSources)[number]) => s.mixBatchId)",
  "factory helper source callback type"
);
write(helpersPath, helpers);

const balesPath = "server/routes/factory/factoryBalesRoutes.ts";
let bales = read(balesPath);
bales = replaceOnceOrVerify(
  bales,
  "allProducts.map((p) => [p.name.toLowerCase(), p] as const)",
  "allProducts.map((p: ImportedBaleProduct) => [p.name.toLowerCase(), p] as const)",
  "factory bales product-name callback type"
);
bales = replaceOnceOrVerify(
  bales,
  "allProducts.map((p) => [p.articleCode?.toLowerCase(), p] as const)",
  "allProducts.map((p: ImportedBaleProduct) => [p.articleCode?.toLowerCase(), p] as const)",
  "factory bales product-article callback type"
);
bales = replaceOnceOrVerify(
  bales,
  "allCategories.map((c) => [c.name?.toLowerCase(), c] as const)",
  "allCategories.map((c: ImportedBaleCategory) => [c.name?.toLowerCase(), c] as const)",
  "factory bales category callback type"
);
write(balesPath, bales);

const stockPath = "server/routes/factory/factoryStockRoutes.ts";
let stock = read(stockPath);
stock = replaceOnceOrVerify(
  stock,
  "allProducts.map((p) => [p.name.toLowerCase(), p] as const)",
  "allProducts.map((p: ImportedStockProduct) => [p.name.toLowerCase(), p] as const)",
  "factory stock product callback type"
);
write(stockPath, stock);

const groupsPath = "server/routes/stock/stockGroupsItemsRoutes.ts";
let groups = read(groupsPath);
groups = replaceOnceOrVerify(
  groups,
  "      const prices = await storage.getStockItemLocationPrices(stockItemId, req.session.currentCompanyId);",
  "      const companyId = req.session.currentCompanyId;\n      if (!companyId) {\n        return res.status(400).json({ message: \"No company selected\" });\n      }\n\n      const prices = await storage.getStockItemLocationPrices(stockItemId, companyId);",
  "stock item location-price company guard"
);
write(groupsPath, groups);

const locationStoragePath = "server/storage/inventory/locationInventoryStorage.ts";
let locationStorage = read(locationStoragePath);
locationStorage = replaceOnceOrVerify(
  locationStorage,
  "export async function createLocation(location: schema.InsertLocation): Promise<schema.Location> {",
  "export async function createLocation(\n  location: schema.InsertLocation & { code: string }\n): Promise<schema.Location> {",
  "createLocation required code type"
);
locationStorage = replaceOnceOrVerify(
  locationStorage,
  "      si.barcode,",
  "      NULL::text            AS barcode,",
  "include-zero inventory barcode placeholder"
);
locationStorage = replaceOnceOrVerify(
  locationStorage,
  "      stockItemUnit: schema.stockItems.unit,\n      barcode: schema.stockItems.barcode,",
  "      stockItemUnit: schema.stockItems.uom,\n      barcode: sql<string | null>`NULL::text`,",
  "inventory storage unit and barcode aliases"
);
write(locationStoragePath, locationStorage);

const journalPath = "server/routes/vouchers/voucherJournalRoutes.ts";
let journal = read(journalPath);
journal = replaceOnceOrVerify(
  journal,
  "    debitAmount: string;\n    creditAmount: string;",
  "    debitAmount: string | null;\n    creditAmount: string | null;",
  "journal order-charge nullable amounts"
);
journal = replaceOnceOrVerify(
  journal,
  "      try {\n        await logAudit({\n          userId: req.session.userId!,",
  "      try {\n        const auditEntries = await snapshotVoucherEntries(result.entries);\n        await logAudit({\n          userId: req.session.userId!,",
  "journal audit entry snapshot"
);
journal = replaceOnceOrVerify(
  journal,
  "          changes: buildVoucherChangesForCreate(result.voucher, result.entries),",
  "          changes: buildVoucherChangesForCreate(result.voucher, auditEntries),",
  "journal audit create changes"
);
write(journalPath, journal);

console.log("Combo 4D third safe slice applied or already present.");
