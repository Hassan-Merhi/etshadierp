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

const mergePath = "server/routes/stock/stockMergeRoutes.ts";
let merge = read(mergePath);
merge = replaceOnceOrVerify(
  merge,
  "      const userId: number = req.user?.id ?? req.session.userId;",
  "      const userId = String(req.user?.id ?? req.session.userId ?? \"\");",
  "stock unmerge audit user ID"
);
merge = replaceOnceOrVerify(
  merge,
  "      await logAudit(userId, companyId, \"unmerge_stock_item\", {\n        logId,\n        keptItemId,\n        mergedItemId,\n        mergedItemName,\n      });",
  "      await logAudit({\n        userId,\n        username: req.session?.username || req.user?.username || \"unknown\",\n        companyId,\n        action: \"update\",\n        tableName: \"stock_items\",\n        recordId: mergedItemId,\n        recordIdentifier: mergedItemName,\n        changes: {\n          unmerge: {\n            old: null,\n            new: { logId, keptItemId, mergedItemId, mergedItemName },\n          },\n        },\n      });",
  "stock unmerge audit object"
);
write(mergePath, merge);

const salesPath = "server/routes/vouchers/voucherSalesUpdateRoutes.ts";
let sales = read(salesPath);
sales = replaceOnceOrVerify(
  sales,
  "          profit: profit.toFixed(2),\n        };",
  "          profit: profit.toFixed(2),\n          configuredPrice: null as string | null,\n        };",
  "sales item configured-price type seed"
);
write(salesPath, sales);

console.log("Combo 4D fifth safe slice applied or already present.");
