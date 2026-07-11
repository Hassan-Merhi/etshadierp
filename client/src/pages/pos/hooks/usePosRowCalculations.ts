import type { SaleRow, InventoryItem } from "../pos-components/posTypes";

interface PosRowCalculationsParams {
  rows: SaleRow[];
  activeRow: number | null;
  setRows: React.Dispatch<React.SetStateAction<SaleRow[]>>;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setZeroStockItem: React.Dispatch<React.SetStateAction<string>>;
  setZeroStockAlert: React.Dispatch<React.SetStateAction<boolean>>;
  lastSoldPrices: Record<number, string>;
  activeCurrency: string;
  exchangeRate: number | null;
  authUser: any;
  posUser: any;
  focusCell: (row: number, col: number) => void;
}

/**
 * Row-level item selection and cell-edit calculations for the POS grid.
 * Extracted from usePosHandlers.ts (Phase 18 structural split) — logic unchanged.
 */
export function usePosRowCalculations({
  rows,
  activeRow,
  setRows,
  setSearchTerm,
  setZeroStockItem,
  setZeroStockAlert,
  lastSoldPrices,
  activeCurrency,
  exchangeRate,
  authUser,
  posUser,
  focusCell,
}: PosRowCalculationsParams) {
  const selectItem = (item: any, targetRowOverride?: number) => {
    const canSellZeroStock = posUser?.canSellNegativeStock || authUser?.canSellNegativeStock;
    if (item.stock === 0 && !canSellZeroStock) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }
    let targetRow = targetRowOverride ?? activeRow ?? rows.findIndex((r) => !r.itemName);
    const newRows = [...rows];
    // If no empty row found, append one
    if (targetRow === -1 || targetRow == null) {
      targetRow = newRows.length;
      newRows.push({ id: Date.now().toString(), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 });
    }
    const rateUSD = lastSoldPrices[item.stockItemId] ? parseFloat(lastSoldPrices[item.stockItemId]) : item.price;
    const displayRate = activeCurrency === "CFA" ? Math.round(rateUSD * (exchangeRate ?? 0)) : rateUSD;

    newRows[targetRow] = {
      ...newRows[targetRow],
      itemName: item.name,
      stockItemCode: item.code,
      stockItemId: item.stockItemId,
      rate: displayRate,
      rateUSD,
      quantity: 1,
      amount: displayRate,
      configuredPrice: item.configuredPrice,
    };

    if (targetRow === rows.length - 1) {
      newRows.push({ id: Date.now().toString(), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 });
    }
    setRows(newRows);
    setSearchTerm("");
    setTimeout(() => focusCell(targetRow, 1), 0);
  };

  const updateRow = (index: number, field: keyof SaleRow, value: any) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    if (field === "quantity" || field === "rate") {
      const numValue = value === "" ? 0 : parseFloat(String(value)) || 0;
      newRows[index][field] = numValue as any;
      if (field === "rate") {
        newRows[index].rateUSD = activeCurrency === "CFA" && exchangeRate ? numValue / exchangeRate : numValue;
      }
      newRows[index].amount = (newRows[index].quantity || 0) * (newRows[index].rate || 0);
    }
    setRows(newRows);
  };

  return { selectItem, updateRow };
}
