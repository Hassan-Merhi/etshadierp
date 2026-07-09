import { fetchSalesData } from "./dataFetchers";
import { InvEntry, ItemRow } from "./types";

// ── Build item registry ───────────────────────────────────────────────────────
export function buildItemRegistry(
  openMap: Map<number, InvEntry>,
  closeMap: Map<number, InvEntry>,
  salesRows: ReturnType<typeof fetchSalesData> extends Promise<infer T> ? T : never,
  dayCount: number
): ItemRow[] {
  const registry = new Map<number, ItemRow>();

  function ensure(id: number, code: string, name: string, group: string, uom: string): ItemRow {
    if (!registry.has(id)) {
      registry.set(id, {
        stockItemId: id, itemCode: code, itemName: name, groupName: group, itemUom: uom,
        openQty: 0, openRate: 0, openValue: 0,
        salesByDate: new Map(),
        closeQty: 0, closeRate: 0, closeValue: 0,
        totalQty: 0, totalSales: 0, totalCost: 0, avgMonthlyQty: 0,
      });
    }
    const row = registry.get(id)!;
    if (!row.itemCode && code) row.itemCode = code;
    if (!row.itemName && name) row.itemName = name;
    if (!row.groupName && group) row.groupName = group;
    return row;
  }

  for (const [id, inv] of openMap) {
    const row = ensure(id, inv.stockItemCode, inv.stockItemName, inv.stockGroupName, inv.stockItemUom);
    row.openQty = inv.quantity; row.openRate = inv.averageRate; row.openValue = inv.totalValue;
  }
  for (const [id, inv] of closeMap) {
    const row = ensure(id, inv.stockItemCode, inv.stockItemName, inv.stockGroupName, inv.stockItemUom);
    row.closeQty = inv.quantity; row.closeRate = inv.averageRate; row.closeValue = inv.totalValue;
    if (!row.openRate && inv.averageRate) row.openRate = inv.averageRate;
  }
  for (const sale of salesRows) {
    const row = ensure(sale.stockItemId, sale.itemCode, sale.itemName, sale.groupName, sale.uom);
    const ex = row.salesByDate.get(sale.saleDate) ?? { qty: 0, totalSales: 0, totalCost: 0 };
    ex.qty += sale.qty; ex.totalSales += sale.totalSales; ex.totalCost += sale.totalCost;
    row.salesByDate.set(sale.saleDate, ex);
  }

  // Compute totals + avgMonthly
  for (const [, row] of registry) {
    for (const ds of row.salesByDate.values()) {
      row.totalQty   += ds.qty;
      row.totalSales += ds.totalSales;
      row.totalCost  += ds.totalCost;
    }
    row.avgMonthlyQty = dayCount > 0 ? (row.totalQty / dayCount) * 30 : 0;
    // If openRate is still 0 but closeRate is set, use closeRate as cost basis
    if (!row.openRate && row.closeRate) row.openRate = row.closeRate;
  }

  // Sort by group, then item name
  return Array.from(registry.values()).sort((a, b) => {
    const gCmp = (a.groupName || "~").localeCompare(b.groupName || "~");
    return gCmp !== 0 ? gCmp : a.itemName.localeCompare(b.itemName);
  });
}
