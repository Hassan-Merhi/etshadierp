import type { SaleRow, InventoryItem, Location } from "../pos-components/posTypes";

interface PosCheckoutParams {
  rows: SaleRow[];
  isCreditSale: boolean;
  paymentAccountType: string;
  paymentAccountId: string | null;
  selectedCustomerId: string;
  notes: string;
  saleDate: string;
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
  setInvoiceWaStatus: React.Dispatch<React.SetStateAction<"idle" | "sending" | "sent" | "failed">>;
  lastSavedFingerprintRef: React.MutableRefObject<string>;
  clientSaleIdRef: React.MutableRefObject<string>;
  activeCurrency: string;
  exchangeRate: number | null;
  dailyExchangeRate: number | null;
  activeLocation: Location | null;
  editVoucherId?: string;
  editVoucher: any;
  inventory: InventoryItem[];
  currentShift: any;
  posUser: any;
  saveMutation: any;
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void;
  focusCell: (row: number, col: number) => void;
}

/**
 * Sale lifecycle actions: validating + saving a sale, starting a new sale,
 * and loading a saved draft back into the grid.
 * Extracted from usePosHandlers.ts (Phase 18 structural split) — logic unchanged.
 */
export function usePosCheckout({
  rows,
  isCreditSale,
  paymentAccountType,
  paymentAccountId,
  selectedCustomerId,
  notes,
  saleDate,
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
  lastSavedFingerprintRef,
  clientSaleIdRef,
  activeCurrency,
  exchangeRate,
  dailyExchangeRate,
  activeLocation,
  editVoucherId,
  editVoucher,
  inventory,
  currentShift,
  posUser,
  saveMutation,
  toast,
  focusCell,
}: PosCheckoutParams) {
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

  return { handleSaveSale, handleNewSale, handleLoadDraft };
}
