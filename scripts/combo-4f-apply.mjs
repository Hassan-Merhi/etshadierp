import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceExact(source, oldText, newText, expectedCount, label) {
  const count = source.split(oldText).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} matches, found ${count}`);
  }
  return source.split(oldText).join(newText);
}

const fiscalPath = "server/routes/fiscalTransferRoutes.ts";
let fiscal = read(fiscalPath);

fiscal = replaceExact(
  fiscal,
  "            customerName: voucher.customerName ?? null,",
  "            // The voucher schema has no persisted customer-name field in this query.\n            customerName: null,",
  1,
  "fiscal customer name response"
);

const revisionTypeBlock = `      type RevisionResponseItem = Omit<\n        (typeof allRevWithItems)[number]["items"][number],\n        "id" | "revisionId"\n      > & {\n        id?: number;\n        revisionId?: number;\n      };\n      type RevisionResponse = Omit<(typeof allRevWithItems)[number], "items"> & {\n        items: RevisionResponseItem[];\n        _mergedCount?: number;\n      };\n      let finalRevisions: RevisionResponse[] = [...nonOptionalRevs];`;

fiscal = replaceExact(
  fiscal,
  "      let finalRevisions = [...nonOptionalRevs];",
  revisionTypeBlock,
  2,
  "fiscal revision response typing"
);

fiscal = replaceExact(
  fiscal,
  "          createdAt: last.createdAt,",
  "          revisionDate: last.revisionDate,",
  1,
  "fiscal merged revision date"
);

fiscal = replaceExact(
  fiscal,
  "stockItems.unit",
  "stockItems.uom",
  1,
  "fiscal stock item uom"
);

write(fiscalPath, fiscal);

const exportPath = "server/services/spSalesFormExport.ts";
let exportSource = read(exportPath);

exportSource = replaceExact(
  exportSource,
  "  const v = cell.value as Record<string, unknown>;",
  "  const v = cell.value as unknown as Record<string, unknown>;",
  1,
  "ExcelJS formula object narrowing"
);

exportSource = replaceExact(
  exportSource,
  "  const salesRows = (salesRes as any).rows ?? (salesRes as any[]);\n  const openingRows = (openingRes as any).rows ?? (openingRes as any[]);",
  "  const salesRows = salesRes.rows;\n  const openingRows = openingRes.rows;",
  1,
  "SP export query result rows"
);

exportSource = replaceExact(
  exportSource,
  "      avgCostCell.value = { formula: `H${r}/E${r}`, result: r2(stock.avgCost) };",
  "      avgCostCell.value = { formula: `H${r}/E${r}`, result: r2(stock.avgCost) } as ExcelJS.CellFormulaValue;",
  1,
  "SP export average-cost formula"
);

exportSource = replaceExact(
  exportSource,
  "        profitCell.value = {\n          formula: `IF(${qC}${rowNum}=0,0,${pC}${rowNum}-$F${rowNum}${deductionPart})`,\n          result: r2(netProfitPB),\n        };",
  "        profitCell.value = {\n          formula: `IF(${qC}${rowNum}=0,0,${pC}${rowNum}-$F${rowNum}${deductionPart})`,\n          result: r2(netProfitPB),\n        } as ExcelJS.CellFormulaValue;",
  1,
  "SP export profit formula"
);

write(exportPath, exportSource);

for (const tempPath of ["scripts/combo-4f-apply.mjs", ".github/workflows/combo4f-apply.yml"]) {
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
}

console.log("Combo 4F safe structural patch applied; temporary bootstrap files removed.");
