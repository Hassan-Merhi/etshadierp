import { useReactToPrint } from "react-to-print";
import * as XLSX from "xlsx";
import type { SaleRow, InventoryItem, APIInventoryItem, Location } from "../pos-components/posTypes";
import { POS_COLUMNS, getFilteredInventory } from "../utils/posCalculations";

interface PosHandlersParams {
  // State values
  rows: SaleRow[];
  isCreditSale: boolean;
  paymentAccountType: string;
  paymentAccountId: string | null;
  selectedCustomerId: string;
  currentDraftId: number | null;
  notes: string;
  saleDate: string;
  activeRow: number | null;
  highlightedIndex: number;
  // Setters
  setRows: React.Dispatch<React.SetStateAction<SaleRow[]>>;
  setSelectedCell: React.Dispatch<React.SetStateAction<{ row: number; col: number }>>;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  setPaymentAccountType: React.Dispatch<React.SetStateAction<"bank" | "cash" | "credit">>;
  setPaymentAccountId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsCreditSale: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedCustomerId: React.Dispatch<React.SetStateAction<string>>;
  setCurrentDraftId: React.Dispatch<React.SetStateAction<number | null>>;
  setShowDraftDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPrintDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setSavedSale: (sale: any) => void;
  setSaleJustCompleted: React.Dispatch<React.SetStateAction<boolean>>;
  setLastAutosaved: React.Dispatch<React.SetStateAction<Date | null>>;
  setMobileTab: React.Dispatch<React.SetStateAction<"items" | "cart">>;
  setPendingStockSend: React.Dispatch<React.SetStateAction<boolean>>;
  setStockWaStatus: React.Dispatch<
    React.SetStateAction<"idle" | "sending" | "sent" | "failed" | "not_configured">
  >;
  setInvoiceWaStatus: React.Dispatch<
    React.SetStateAction<"idle" | "sending" | "sent" | "failed">
  >;
  setZeroStockItem: React.Dispatch<React.SetStateAction<string>>;
  setZeroStockAlert: React.Dispatch<React.SetStateAction<boolean>>;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number>>;
  lastSavedFingerprintRef: React.MutableRefObject<string>;
  // Refs
  inputRefs: React.MutableRefObject<{ [key: string]: HTMLInputElement }>;
  printRef: React.MutableRefObject<HTMLDivElement | null>;
  stockPrintRef: React.MutableRefObject<HTMLDivElement>;
  clientSaleIdRef: React.MutableRefObject<string>;
  // Query results
  activeCurrency: string;
  exchangeRate: number;
  dailyExchangeRate: number;
  activeLocation: Location | null;
  editVoucherId?: string;
  editVoucher: any;
  inventory: InventoryItem[];
  apiInventory: APIInventoryItem[];
  lastSoldPrices: Record<number, string>;
  currentShift: any;
  authUser: any;
  posUser: any;
  // Mutations
  saveMutation: any;
  // Misc
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void;
}

export function usePosHandlers({
  rows,
  isCreditSale,
  paymentAccountType,
  paymentAccountId,
  selectedCustomerId,
  currentDraftId,
  notes,
  saleDate,
  activeRow,
  highlightedIndex,
  setRows,
  setSelectedCell,
  setNotes,
  setPaymentAccountType,
  setPaymentAccountId,
  setIsCreditSale,
  setSelectedCustomerId,
  setCurrentDraftId,
  setShowDraftDialog,
  setShowPrintDialog,
  setSavedSale,
  setSaleJustCompleted,
  setLastAutosaved,
  setMobileTab,
  setPendingStockSend,
  setStockWaStatus,
  setInvoiceWaStatus,
  setZeroStockItem,
  setZeroStockAlert,
  setSearchTerm,
  setHighlightedIndex,
  lastSavedFingerprintRef,
  inputRefs,
  printRef,
  stockPrintRef,
  clientSaleIdRef,
  activeCurrency,
  exchangeRate,
  dailyExchangeRate,
  activeLocation,
  editVoucherId,
  editVoucher,
  inventory,
  apiInventory,
  lastSoldPrices,
  currentShift,
  authUser,
  posUser,
  saveMutation,
  toast,
}: PosHandlersParams) {
  const focusCell = (row: number, col: number) => {
    inputRefs.current[`${row}-${col}`]?.focus();
    inputRefs.current[`${row}-${col}`]?.select();
  };

  const handlePrint = useReactToPrint({ contentRef: printRef });

  // ISSUE 6: Real stock print handler
  const handleStockPrint = useReactToPrint({
    contentRef: stockPrintRef,
    documentTitle: `STK_${(activeLocation?.name || "Location").replace(/\s+/g, "_")}_${new Date().toLocaleDateString("en-CA")}`,
  });

  // ISSUE 3: Full payload with shiftId, clientSaleId, currency, exchangeRate, correct rate conversion
  const handleSaveSale = () => {
    if (!activeLocation && !editVoucherId) {
      toast({ title: "Error", description: "Please select a location", variant: "destructive" });
      return;
    }
    if (!isCreditSale && !paymentAccountId) {
      toast({ title: "Error", description: "Please select a payment account", variant: "destructive" });
      return;
    }
    if (isCreditSale && !selectedCustomerId) {
      toast({ title: "Error", description: "Please select a customer for credit sale", variant: "destructive" });
      return;
    }
    if (activeCurrency === "CFA" && !exchangeRate) {
      toast({
        title: "Error",
        description: "Please enter an exchange rate for this transaction.",
        variant: "destructive",
      });
      return;
    }
    const invalidRow = rows.find((r) => r.itemName?.trim() && !r.stockItemId);
    if (invalidRow) {
      const invalidIdx = rows.indexOf(invalidRow);
      toast({
        title: "Invalid item",
        description: `"${invalidRow.itemName}" is not valid. Please select an item from the list.`,
        variant: "destructive",
      });
      setSelectedCell({ row: invalidIdx, col: 0 });
      focusCell(invalidIdx, 0);
      return;
    }
    const validItems = rows.filter((r) => r.stockItemId && r.quantity > 0 && r.rate > 0);
    if (validItems.length === 0) {
      toast({ title: "Error", description: "Please add at least one item to the sale", variant: "destructive" });
      return;
    }

    const saleData = {
      locationId: activeLocation?.id || (editVoucher as any)?.locationId,
      shiftId: posUser && currentShift ? currentShift.id : undefined,
      clientSaleId: !editVoucherId ? clientSaleIdRef.current : undefined,
      paymentAccountType: isCreditSale ? "credit" : paymentAccountType,
      paymentAccountId: isCreditSale ? parseInt(selectedCustomerId) : parseInt(paymentAccountId!),
      isCreditSale,
      notes,
      voucherDate: saleDate,
      currency: activeCurrency === "CFA" ? "CFA" : "USD",
      exchangeRate: exchangeRate ? exchangeRate.toString() : undefined,
      items: validItems.map((row) => {
        const rateInUSD =
          activeCurrency === "CFA" && dailyExchangeRate
            ? parseFloat(row.rate.toString()) / dailyExchangeRate
            : row.rateUSD;
        return {
          stockItemId: row.stockItemId,
          salesItemId: row.salesItemId,
          quantity: row.quantity.toString(),
          rate: rateInUSD.toFixed(6),
        };
      }),
    };

    saveMutation.mutate(saleData);
  };

  const handleNewSale = () => {
    setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
    setNotes("");
    setSavedSale(null);
    setShowPrintDialog(false);
    setSaleJustCompleted(false);
    setCurrentDraftId(null);
    setStockWaStatus("idle");
    setInvoiceWaStatus("idle");
    setPendingStockSend(false);
    lastSavedFingerprintRef.current = "";
    setLastAutosaved(null);
    setMobileTab("items");
  };

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
    const displayRate = activeCurrency === "CFA" ? Math.round(rateUSD * exchangeRate) : rateUSD;

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

  // ISSUE 7: Real draft loading
  const handleLoadDraft = async (draftId: number) => {
    try {
      const res = await fetch(`/api/pos/drafts/${draftId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load draft");
      const draft = await res.json();

      if (draft.paymentAccountType) setPaymentAccountType(draft.paymentAccountType);
      if (draft.paymentAccountId) setPaymentAccountId(String(draft.paymentAccountId));
      setIsCreditSale(draft.isCreditSale || false);
      if (draft.isCreditSale && draft.paymentAccountId) {
        setSelectedCustomerId(String(draft.paymentAccountId));
      }
      setNotes(draft.notes || "");

      const draftRows = (Array.isArray(draft.items) ? draft.items : []).map((item: any, index: number) => {
        const rate = parseFloat(item.rate);
        const inventoryItem = inventory.find((i) => i.stockItemId === item.stockItemId);
        return {
          id: String(index + 1),
          itemName: item.stockItemName,
          stockItemCode: item.stockItemCode || "",
          stockItemId: item.stockItemId,
          quantity: parseFloat(item.quantity),
          rate,
          rateUSD: rate,
          amount: parseFloat(item.amount),
          configuredPrice: inventoryItem?.configuredPrice,
        };
      });
      draftRows.push({ id: String(draftRows.length + 1), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 });
      setRows(draftRows);
      setCurrentDraftId(draftId);
      setShowDraftDialog(false);
      toast({ title: "Draft Loaded", description: "Transaction has been loaded from draft" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to load draft", variant: "destructive" });
    }
  };

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

  // ISSUE 9: Real keyboard navigation — returns a handler bound to current searchTerm
  const makeHandleKeyDown =
    (searchTerm: string) =>
    (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
      const maxCol = POS_COLUMNS.length - 4; // Exclude plBale, totalPL, delete
      const isItemNameField = POS_COLUMNS[colIndex]?.key === "itemName";
      const filteredItems = getFilteredInventory(inventory, searchTerm);

      if (isItemNameField && filteredItems.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
          return;
        }
        if (e.key === "ArrowUp" && highlightedIndex > 0) {
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (filteredItems[highlightedIndex]) selectItem(filteredItems[highlightedIndex], rowIndex);
          return;
        }
      }

      const currentRow = rows[rowIndex];
      const hasUnselectedItem = isItemNameField && currentRow?.itemName?.trim() && !currentRow?.stockItemId;

      switch (e.key) {
        case "ArrowUp":
          if (!isItemNameField || filteredItems.length === 0) {
            if (hasUnselectedItem) {
              e.preventDefault();
              toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
              return;
            }
            e.preventDefault();
            if (rowIndex > 0) {
              setSelectedCell({ row: rowIndex - 1, col: colIndex });
              focusCell(rowIndex - 1, colIndex);
            }
          }
          break;
        case "ArrowDown":
          if (!isItemNameField || filteredItems.length === 0) {
            if (hasUnselectedItem) {
              e.preventDefault();
              toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
              return;
            }
            e.preventDefault();
            if (rowIndex < rows.length - 1) {
              setSelectedCell({ row: rowIndex + 1, col: colIndex });
              focusCell(rowIndex + 1, colIndex);
            }
          }
          break;
        case "Enter":
          if (!isItemNameField || filteredItems.length === 0) {
            if (hasUnselectedItem) {
              e.preventDefault();
              toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
              return;
            }
            e.preventDefault();
            if (POS_COLUMNS[colIndex]?.key === "quantity") {
              setSelectedCell({ row: rowIndex, col: colIndex + 1 });
              focusCell(rowIndex, colIndex + 1);
            } else if (POS_COLUMNS[colIndex]?.key === "rate") {
              if (!rows[rowIndex + 1]) {
                setRows((prev) => [
                  ...prev,
                  { id: String(Date.now()), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 },
                ]);
                setTimeout(() => focusCell(rows.length, 0), 50);
              } else {
                setSelectedCell({ row: rowIndex + 1, col: 0 });
                focusCell(rowIndex + 1, 0);
              }
            } else if (rowIndex < rows.length - 1) {
              setSelectedCell({ row: rowIndex + 1, col: colIndex });
              focusCell(rowIndex + 1, colIndex);
            }
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (colIndex > 0) {
            setSelectedCell({ row: rowIndex, col: colIndex - 1 });
            focusCell(rowIndex, colIndex - 1);
          }
          break;
        case "ArrowRight":
          if (hasUnselectedItem) {
            e.preventDefault();
            toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
            return;
          }
          e.preventDefault();
          if (colIndex < maxCol) {
            setSelectedCell({ row: rowIndex, col: colIndex + 1 });
            focusCell(rowIndex, colIndex + 1);
          }
          break;
        case "Tab":
          if (isItemNameField && activeRow === rowIndex && filteredItems.length > 0 && !e.shiftKey) {
            e.preventDefault();
            if (filteredItems[highlightedIndex]) selectItem(filteredItems[highlightedIndex]);
            return;
          }
          if (hasUnselectedItem) {
            e.preventDefault();
            toast({ title: "Invalid item", description: "Please select an item from the list.", variant: "destructive" });
            return;
          }
          if (!e.shiftKey && colIndex < maxCol) {
            e.preventDefault();
            setSelectedCell({ row: rowIndex, col: colIndex + 1 });
            focusCell(rowIndex, colIndex + 1);
          }
          break;
        case "Backspace": {
          const inputVal = (e.target as HTMLInputElement).value;
          if (
            inputVal === "" &&
            (POS_COLUMNS[colIndex]?.key === "quantity" || POS_COLUMNS[colIndex]?.key === "rate")
          ) {
            e.preventDefault();
            setSelectedCell({ row: rowIndex, col: colIndex - 1 });
            focusCell(rowIndex, colIndex - 1);
          }
          break;
        }
      }
    };

  return {
    focusCell,
    handlePrint,
    handleStockPrint,
    handleSaveSale,
    handleNewSale,
    selectItem,
    updateRow,
    handleLoadDraft,
    handleExportInventory,
    handleSummaryExport,
    handleDetailedExport,
    makeHandleKeyDown,
  };
}
