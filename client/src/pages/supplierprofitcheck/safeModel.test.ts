import { describe, expect, it } from "vitest";
import type { AnalysisRow } from "./types";
import { deriveProfitCheckState, uniqueAnalysisRows } from "./safeModel";

function row(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    stockItemId: 1,
    code: "MJS4110",
    name: "MJS MEN SHIRT AFRICA - (40 KG)",
    stockGroupId: 10,
    stockGroupName: "Supplier",
    currentStock: 20,
    salesQty: 142,
    avgSellingPrice: 200,
    groupSellingPrice: null,
    poPrice: 100,
    poPriceSource: "selected_supplier_po",
    inventoryAvgCost: 75,
    nCost: 100,
    configPrice: 150,
    offloadingCost: 75,
    profitPercent: 0,
    status: "gaining",
    proformaQty: 6,
    proformaBarcode: "MJS4110",
    ...overrides,
  };
}

function derive(overrides: Partial<Parameters<typeof deriveProfitCheckState>[0]> = {}) {
  return deriveProfitCheckState({
    rows: [row()],
    importedRows: [],
    qtyMap: { 1: "12" },
    manualPoPrices: {},
    manualAvgPrices: {},
    sellPriceSource: "avg",
    freight: "120",
    duties: "0",
    otherCharges: "0",
    surcharge: "0",
    search: "",
    activeStatuses: [],
    ...overrides,
  });
}

describe("Supplier Profit Check safe calculations", () => {
  it("collapses duplicate stock-item rows instead of multiplying totals", () => {
    const result = derive({ rows: [row({ proformaQty: 6 }), row({ proformaQty: 6 })] });

    expect(result.computedRows).toHaveLength(1);
    expect(result.computedRows[0].proformaQty).toBe(12);
    expect(result.totalBales).toBe(12);
    expect(result.extraCostPerBale).toBe(10);
    expect(result.computedRows[0].landingCost).toBe(110);
    expect(result.computedRows[0].costProfit).toBe(90);
    expect(result.summary.totalQty).toBe(12);
    expect(result.summary.totalLandingCost).toBe(1320);
    expect(result.summary.totalEstSales).toBe(2400);
    expect(result.summary.totalCostProfit).toBe(1080);
  });

  it("uses the live edited quantity instead of the original proforma quantity", () => {
    const result = derive({ rows: [row({ proformaQty: 700 })], qtyMap: { 1: "706" }, freight: "706" });

    expect(result.totalBales).toBe(706);
    expect(result.summary.totalQty).toBe(706);
    expect(result.extraCostPerBale).toBe(1);
  });

  it("uses manual Dubai and sell prices consistently for status and profit", () => {
    const result = derive({
      rows: [row({ poPrice: null, poPriceSource: "missing", avgSellingPrice: null })],
      qtyMap: { 1: "2" },
      manualPoPrices: { 1: "80" },
      manualAvgPrices: { 1: "100" },
      freight: "20",
    });

    expect(result.computedRows[0].poPriceSource).toBe("override");
    expect(result.computedRows[0].landingCost).toBe(90);
    expect(result.computedRows[0].costProfit).toBe(10);
    expect(result.computedRows[0].costProfitPct).toBe(10);
    expect(result.computedRows[0].computedStatus).toBe("gaining");
    expect(result.summary.missingPoCount).toBe(0);
    expect(result.summary.totalCostProfit).toBe(20);
  });

  it("keeps imported rows unique when the base result already contains the item", () => {
    const result = uniqueAnalysisRows([row()], [row({ name: "Imported duplicate" })]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("MJS MEN SHIRT AFRICA - (40 KG)");
  });
});
