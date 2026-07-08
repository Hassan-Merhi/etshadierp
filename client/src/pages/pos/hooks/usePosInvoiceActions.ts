import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";
import type { SaleRow, APIInventoryItem, Location } from "../pos-components/posTypes";

interface PosInvoiceActionsParams {
  rows: SaleRow[];
  printRef: React.MutableRefObject<HTMLDivElement | null>;
  stockPrintRef: React.MutableRefObject<HTMLDivElement>;
  activeLocation: Location | null;
  apiInventory: APIInventoryItem[];
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void;
}

/**
 * Print + spreadsheet-export actions (invoice print, stock print, inventory
 * export, sale summary/detailed export).
 * Extracted from usePosHandlers.ts (Phase 18 structural split) — logic unchanged.
 */
export function usePosInvoiceActions({
  rows,
  printRef,
  stockPrintRef,
  activeLocation,
  apiInventory,
  toast,
}: PosInvoiceActionsParams) {
  const handlePrint = useReactToPrint({ contentRef: printRef });

  // ISSUE 6: Real stock print handler
  const handleStockPrint = useReactToPrint({
    contentRef: stockPrintRef,
    documentTitle: `STK_${(activeLocation?.name || "Location").replace(/\s+/g, "_")}_${new Date().toLocaleDateString("en-CA")}`,
  });

  // ISSUE 8: Export inventory as Excel
  const handleExportInventory = () => {
    if (!activeLocation) {
      toast({ title: "No location", description: "Select a location first.", variant: "destructive" });
      return;
    }
    const exportData = (Array.isArray(apiInventory) ? apiInventory : []).map((item: any) => ({
      Code: item.stockItemCode || "",
      "Item Name": item.stockItemName || "",
      UOM: item.stockItemUom || "",
      "Stock Qty": parseFloat(item.quantity),
      "Avg Rate (USD)": parseFloat(item.averageRate),
      "Total Value (USD)": parseFloat(item.totalValue),
      Group: item.stockGroupName || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    const fileName = `Inventory_${activeLocation.name.replace(/\s+/g, "_")}_${new Date().toLocaleDateString("en-CA")}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    toast({ title: "Export successful", description: `Downloaded ${fileName}` });
  };

  const handleSummaryExport = () => {
    const validRows = rows.filter((r) => r.stockItemId && r.quantity > 0);
    if (validRows.length === 0) {
      toast({ title: "Nothing to export", description: "Add items first.", variant: "destructive" });
      return;
    }
    const data = validRows.map((r, i) => ({
      "#": i + 1,
      Item: r.itemName,
      Qty: r.quantity,
      Rate: r.rate,
      Amount: r.amount,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
    XLSX.writeFile(wb, `POS_Summary_${new Date().toLocaleDateString("en-CA")}.xlsx`);
    toast({ title: "Summary exported" });
  };

  const handleDetailedExport = () => {
    const validRows = rows.filter((r) => r.stockItemId && r.quantity > 0);
    if (validRows.length === 0) {
      toast({ title: "Nothing to export", description: "Add items first.", variant: "destructive" });
      return;
    }
    const data = validRows.map((r, i) => {
      const cfgUSD = r.configuredPrice ?? 0;
      const plBale = r.rateUSD - cfgUSD;
      return {
        "#": i + 1,
        Code: r.stockItemCode || "",
        Item: r.itemName,
        Qty: r.quantity,
        "Rate (USD)": r.rateUSD,
        Amount: r.amount,
        "P/L per unit": cfgUSD > 0 ? plBale : "",
        "Total P/L": cfgUSD > 0 ? plBale * r.quantity : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detailed");
    XLSX.writeFile(wb, `POS_Detailed_${new Date().toLocaleDateString("en-CA")}.xlsx`);
    toast({ title: "Detailed export downloaded" });
  };

  return { handlePrint, handleStockPrint, handleExportInventory, handleSummaryExport, handleDetailedExport };
}
