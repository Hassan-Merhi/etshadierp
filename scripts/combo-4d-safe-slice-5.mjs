import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

const mergePath = "server/routes/stock/stockMergeRoutes.ts";
let merge = read(mergePath);
merge = merge.replace(
  /const userId:\s*number\s*=\s*req\.user\?\.id\s*\?\?\s*req\.session\.userId;/,
  'const userId = String(req.user?.id ?? req.session.userId ?? "");'
);
merge = merge.replace(
  /await logAudit\(userId, companyId, "unmerge_stock_item", \{\s*logId,\s*keptItemId,\s*mergedItemId,\s*mergedItemName,\s*\}\);/,
  `await logAudit({
        userId,
        username: req.session?.username || req.user?.username || "unknown",
        companyId,
        action: "update",
        tableName: "stock_items",
        recordId: mergedItemId,
        recordIdentifier: mergedItemName,
        changes: {
          unmerge: {
            old: null,
            new: { logId, keptItemId, mergedItemId, mergedItemName },
          },
        },
      });`
);
if (!merge.includes('const userId = String(req.user?.id ?? req.session.userId ?? "");')) {
  throw new Error("stock unmerge audit user ID replacement missing");
}
if (!merge.includes('tableName: "stock_items"')) {
  throw new Error("stock unmerge audit object replacement missing");
}
write(mergePath, merge);

const salesPath = "server/routes/vouchers/voucherSalesUpdateRoutes.ts";
let sales = read(salesPath);
if (!sales.includes("configuredPrice: null as string | null,")) {
  sales = sales.replace(
    /(const salesItemsData = items\.map\([\s\S]*?totalCost: totalCost\.toFixed\(2\),\s*profit: profit\.toFixed\(2\),)(\s*\};\s*\}\);)/,
    `$1
          configuredPrice: null as string | null,$2`
  );
}
if (!sales.includes("configuredPrice: null as string | null,")) {
  throw new Error("sales item configured-price type seed replacement missing");
}
write(salesPath, sales);

console.log("Combo 4D fifth safe slice applied or already present.");
