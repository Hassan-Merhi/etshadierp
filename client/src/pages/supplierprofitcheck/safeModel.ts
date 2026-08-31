import type { AnalysisRow, ComputedRow } from "./types";
import type { SellPriceSource } from "./useSupplierProfitCheckModel";

interface ProfitCheckDerivedInput {
  rows: AnalysisRow[];
  importedRows: AnalysisRow[];
  qtyMap: Record<number, string>;
  manualPoPrices: Record<number, string>;
  manualAvgPrices: Record<number, string>;
  sellPriceSource: SellPriceSource;
  freight: string;
  duties: string;
  otherCharges: string;
  surcharge: string;
  search: string;
  activeStatuses: string[];
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function effectivePoPrice(row: AnalysisRow, manualPoPrices: Record<number, string>): number | null {
  return positiveNumber(manualPoPrices[row.stockItemId]) ?? row.poPrice;
}

export function effectiveSellPrice(
  row: AnalysisRow,
  manualAvgPrices: Record<number, string>,
  sellPriceSource: SellPriceSource
): number | null {
  if (sellPriceSource === "location_group") return row.groupSellingPrice;
  return positiveNumber(manualAvgPrices[row.stockItemId]) ?? row.avgSellingPrice;
}

/**
 * Merge base and imported analysis rows behind a stockItemId uniqueness boundary.
 * The server already aggregates persisted duplicate lines; this client-side guard
 * prevents a future API regression from multiplying totals or React row keys.
 */
export function uniqueAnalysisRows(rows: AnalysisRow[], importedRows: AnalysisRow[]): AnalysisRow[] {
  const byId = new Map<number, AnalysisRow>();

  const merge = (row: AnalysisRow, sumProformaQty: boolean) => {
    const existing = byId.get(row.stockItemId);
    if (!existing) {
      byId.set(row.stockItemId, { ...row });
      return;
    }
    if (sumProformaQty) {
      const existingQty = existing.proformaQty;
      const incomingQty = row.proformaQty;
      existing.proformaQty =
        existingQty == null && incomingQty == null
          ? null
          : Math.max(0, existingQty ?? 0) + Math.max(0, incomingQty ?? 0);
    }
  };

  for (const row of rows) merge(row, true);
  for (const row of importedRows) merge(row, false);
  return [...byId.values()];
}

export function deriveProfitCheckState({
  rows,
  importedRows,
  qtyMap,
  manualPoPrices,
  manualAvgPrices,
  sellPriceSource,
  freight,
  duties,
  otherCharges,
  surcharge,
  search,
  activeStatuses,
}: ProfitCheckDerivedInput) {
  const totalBales = Object.values(qtyMap).reduce((sum, value) => sum + nonNegativeNumber(value), 0);
  const totalExtraCharges =
    nonNegativeNumber(freight) +
    nonNegativeNumber(duties) +
    nonNegativeNumber(otherCharges) +
    nonNegativeNumber(surcharge);
  const extraCostPerBale = totalBales > 0 ? totalExtraCharges / totalBales : 0;

  const computedRows: ComputedRow[] = uniqueAnalysisRows(rows, importedRows).map((row) => {
    const poPrice = effectivePoPrice(row, manualPoPrices);
    const sellPrice = effectiveSellPrice(row, manualAvgPrices, sellPriceSource);
    const landingCost = poPrice != null ? poPrice + extraCostPerBale : null;
    const costProfit = sellPrice != null && landingCost != null ? sellPrice - landingCost : null;
    const costProfitPct =
      costProfit != null && sellPrice != null && sellPrice > 0 ? (costProfit / sellPrice) * 100 : null;
    const computedStatus =
      sellPrice == null || poPrice == null
        ? "no_sales_data"
        : costProfit! > 0
          ? "gaining"
          : costProfit! < 0
            ? "losing"
            : "break_even";
    const hasManualPo = positiveNumber(manualPoPrices[row.stockItemId]) != null;

    return {
      ...row,
      poPriceSource: hasManualPo ? "override" : row.poPriceSource,
      landingCost,
      costProfit,
      costProfitPct,
      computedStatus,
      hassanProfit: row.configPrice - row.inventoryAvgCost,
    };
  });

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = computedRows.filter((row) => {
    if (
      normalizedSearch &&
      !row.code.toLowerCase().includes(normalizedSearch) &&
      !row.name.toLowerCase().includes(normalizedSearch)
    ) {
      return false;
    }
    if (activeStatuses.length > 0) {
      const matchesStatus = activeStatuses.includes(row.computedStatus);
      const matchesMissingPo = activeStatuses.includes("missing_po") && row.poPriceSource === "missing";
      if (!matchesStatus && !matchesMissingPo) return false;
    }
    return true;
  });

  const itemsWithQty = computedRows.filter((row) => nonNegativeNumber(qtyMap[row.stockItemId]) > 0);
  const totalQty = itemsWithQty.reduce((sum, row) => sum + nonNegativeNumber(qtyMap[row.stockItemId]), 0);
  const totalLandingCost = itemsWithQty.reduce(
    (sum, row) => (row.landingCost != null ? sum + nonNegativeNumber(qtyMap[row.stockItemId]) * row.landingCost : sum),
    0
  );
  const totalEstSales = itemsWithQty.reduce((sum, row) => {
    const sell = effectiveSellPrice(row, manualAvgPrices, sellPriceSource);
    return sell != null ? sum + nonNegativeNumber(qtyMap[row.stockItemId]) * sell : sum;
  }, 0);
  const totalCostProfit = itemsWithQty.reduce(
    (sum, row) => (row.costProfit != null ? sum + nonNegativeNumber(qtyMap[row.stockItemId]) * row.costProfit : sum),
    0
  );

  const summary = {
    totalItems: computedRows.length,
    selectedCount: itemsWithQty.length,
    totalQty,
    totalLandingCost,
    totalEstSales,
    totalCostProfit,
    costProfitPct: totalEstSales > 0 ? (totalCostProfit / totalEstSales) * 100 : null,
    losingCount: computedRows.filter((row) => row.computedStatus === "losing").length,
    noDataCount: computedRows.filter((row) => row.computedStatus === "no_sales_data").length,
    missingPoCount: computedRows.filter((row) => row.poPriceSource === "missing").length,
    noGroupPriceCount:
      sellPriceSource === "location_group" ? computedRows.filter((row) => row.groupSellingPrice == null).length : 0,
  };

  return {
    computedRows,
    filteredRows,
    summary,
    totalBales,
    totalExtraCharges,
    extraCostPerBale,
    itemsWithQty,
  };
}
