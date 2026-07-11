import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnceOrVerify(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count === 1) return source.replace(oldText, newText);
  if (count === 0 && source.includes(newText)) return source;
  throw new Error(`${label}: expected one source match or already-applied replacement, found ${count}`);
}

const helperPath = "server/netPositionHelper.ts";
let helper = read(helperPath);
helper = replaceOnceOrVerify(
  helper,
  "export interface NetPositionAccount {\n  id: number;",
  "export interface NetPositionAccount {\n  id?: number;",
  "synthetic net-position account id"
);
write(helperPath, helper);

const netPositionPath = "server/routes/stats/statsNetPositionRoutes.ts";
let netPosition = read(netPositionPath);
netPosition = replaceOnceOrVerify(
  netPosition,
  "      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;\n",
  "",
  "duplicate round2 declaration"
);
write(netPositionPath, netPosition);

const brokerPath = "server/routes/factory/suppliers/supplierBrokerRoutes.ts";
let broker = read(brokerPath);
broker = replaceOnceOrVerify(
  broker,
  "      const totalFreight = rows.filter((r) => r.type === \"freight\").reduce((s, r) => s + r.amount, 0);",
  "      const totalFreight = rows.filter((r) => r.type === \"freight\").reduce((s, r) => s + r.amount, 0);\n      const totalCommission = rows.reduce((s, r) => s + (r.commissionAmount || 0), 0);",
  "broker commission total derivation"
);
broker = replaceOnceOrVerify(
  broker,
  "        totalFreight: totalFreight.toFixed(2),\n        totalOtherCharges:",
  "        totalFreight: totalFreight.toFixed(2),\n        totalCommission: totalCommission.toFixed(2),\n        totalOtherCharges:",
  "broker commission total result"
);
write(brokerPath, broker);

const reportsPath = "server/routes/stats/statsReportsRoutes.ts";
let reports = read(reportsPath);
reports = replaceOnceOrVerify(
  reports,
  "      const stockGroup = await storage.getStockGroupById(parseInt(stockGroupId), companyId);",
  "      const stockGroup = await storage.getStockGroupById(parseInt(stockGroupId));",
  "stock group storage signature"
);
write(reportsPath, reports);

console.log("Combo 4E first safe slice applied or already present.");
