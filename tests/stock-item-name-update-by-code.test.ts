import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stock item name updates by code", () => {
  it("keeps the backend update company-scoped and name-only", () => {
    const source = readFileSync("server/routes/stock/groups-items/items.ts", "utf8");
    const start = source.indexOf('app.post("/api/stock-items/update-names-by-code"');
    const end = source.indexOf('\n  app.post("/api/stock-items"', start + 1);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const route = source.slice(start, end);
    expect(route).toContain("eq(stockItems.companyId, companyId)");
    expect(route).toContain("isNull(stockItems.deletedAt)");
    expect(route).toContain(".set({ name: row.newName })");
    expect(route).toContain('tableName: "stock_items"');
    expect(route).not.toContain("sellingPrice:");
    expect(route).not.toContain("openingQty:");
    expect(route).not.toContain("stockGroupId:");
    expect(route).not.toContain("barcode:");
  });

  it("provides a preview-first Excel/CSV UI", () => {
    const source = readFileSync("client/src/components/StockNameUpdateImport.tsx", "utf8");
    expect(source).toContain('"/api/stock-items/update-names-by-code"');
    expect(source).toContain('Required columns: "Code" and "New Name".');
    expect(source).toContain("Current Name");
    expect(source).toContain("Code not found");
    expect(source).toContain("Duplicate code");
    expect(source).toContain("Apply ${changeRows.length} Name Changes");
  });

  it("exposes the rename flow from the Stock Items import dialog", () => {
    const source = readFileSync("client/src/components/CombinedImportDialog.tsx", "utf8");
    expect(source).toContain('import { StockNameUpdateImport } from "@/components/StockNameUpdateImport"');
    expect(source).toContain("<StockNameUpdateImport />");
    expect(source).toContain("Items / Names");
  });
});
