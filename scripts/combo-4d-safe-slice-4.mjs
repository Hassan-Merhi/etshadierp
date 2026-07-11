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

function replaceCountOrVerify(source, oldText, newText, expected, label) {
  const count = source.split(oldText).length - 1;
  if (count === expected) return source.split(oldText).join(newText);
  if (count === 0 && source.includes(newText)) return source;
  throw new Error(`${label}: expected ${expected} source matches or an already-applied replacement, found ${count}`);
}

const salesPath = "server/routes/vouchers/voucherSalesUpdateRoutes.ts";
let sales = read(salesPath);
sales = replaceCountOrVerify(
  sales,
  "              const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;\n              const quantity = parseFloat(item.quantity);",
  "              const sourceLocId = item.sourceLocationId ?? transfer.sourceLocationId;\n              const destinationLocId = transfer.destinationLocationId;\n              if (sourceLocId == null || destinationLocId == null) {\n                throw new Error(\"Stock transfer is missing source or destination location\");\n              }\n              const quantity = parseFloat(item.quantity);",
  2,
  "voucher sales transfer location guards"
);
sales = replaceCountOrVerify(
  sales,
  "                  transfer.destinationLocationId,",
  "                  destinationLocId,",
  4,
  "voucher sales destination location narrowing"
);
sales = replaceOnceOrVerify(
  sales,
  "      const updated = await storage.getVoucherById(id);\n      const newEntries = await storage.getVoucherEntriesByVoucher(id);",
  "      const updated = await storage.getVoucherById(id);\n      if (!updated) {\n        return res.status(404).json({ message: \"Voucher not found after update\" });\n      }\n      const newEntries = await storage.getVoucherEntriesByVoucher(id);",
  "voucher sales updated voucher guard"
);
write(salesPath, sales);

const transferPath = "server/routes/vouchers/voucherTransferRoutes.ts";
let transfer = read(transferPath);
transfer = replaceOnceOrVerify(
  transfer,
  "      const updated = await db.transaction(async (tx) => {",
  "      const { updatedVoucher: updated, transferItemsData: updatedTransferItemsData } = await db.transaction(async (tx) => {",
  "voucher transfer transaction result"
);
transfer = replaceOnceOrVerify(
  transfer,
  "        const oldSourceLocationId = transferVoucher.sourceLocationId;\n        const oldDestinationLocationId = transferVoucher.destinationLocationId;\n\n        for (const oldItem of oldTransferItems) {",
  "        const oldSourceLocationId = transferVoucher.sourceLocationId;\n        const oldDestinationLocationId = transferVoucher.destinationLocationId;\n        if (oldSourceLocationId == null || oldDestinationLocationId == null) {\n          throw new Error(\"Existing stock transfer is missing source or destination location\");\n        }\n\n        for (const oldItem of oldTransferItems) {",
  "voucher transfer old location guard"
);
transfer = replaceOnceOrVerify(
  transfer,
  "        return updatedVoucher;\n      });",
  "        return { updatedVoucher, transferItemsData };\n      });",
  "voucher transfer transaction return"
);
transfer = replaceOnceOrVerify(
  transfer,
  "          transferItemsData.map((it) => ({",
  "          updatedTransferItemsData.map((it) => ({",
  "voucher transfer audit item scope"
);
write(transferPath, transfer);

console.log("Combo 4D fourth safe slice applied or already present.");
