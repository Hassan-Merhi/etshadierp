import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidateCustomerBalances } from "@/lib/queryClient";
import type { SaleRow, Location } from "../pos-components/posTypes";

interface UsePosMutationsParams {
  activeLocation: Location | null;
  editVoucherId?: string;
  editVoucher: any;
  /** Supplier Partner companies post through /api/sp/sales with SP-specific accounting. */
  isSpCompany?: boolean;
  clientSaleIdRef: React.MutableRefObject<string>;
  rows: SaleRow[];
  isCreditSale: boolean;
  paymentAccountType: string;
  paymentAccountId: string | null;
  selectedCustomerId: string;
  currentDraftId: number | null;
  notes: string;
  lastSavedFingerprintRef: React.MutableRefObject<string>;
  setSavedSale: (sale: any) => void;
  setSaleJustCompleted: (v: boolean) => void;
  setShowPrintDialog: (v: boolean) => void;
  setCurrentDraftId: (id: number | null) => void;
  setLastAutosaved: (date: Date | null) => void;
  setPendingAutoSend: (val: { voucherId: number; locationId: number } | null) => void;
  setPendingStockSend: (val: boolean) => void;
  setStockWaStatus: (s: "idle" | "sending" | "sent" | "failed" | "not_configured") => void;
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void;
  refetchDrafts: () => void;
}

export function usePosMutations({
  activeLocation,
  editVoucherId,
  editVoucher,
  isSpCompany,
  clientSaleIdRef,
  rows,
  isCreditSale,
  paymentAccountType,
  paymentAccountId,
  selectedCustomerId,
  currentDraftId,
  notes,
  lastSavedFingerprintRef,
  setSavedSale,
  setSaleJustCompleted,
  setShowPrintDialog,
  setCurrentDraftId,
  setLastAutosaved,
  setPendingAutoSend,
  setPendingStockSend,
  setStockWaStatus,
  toast,
  refetchDrafts,
}: UsePosMutationsParams) {
  // ISSUE 1 + 2: Fixed endpoints and payload
  const saveMutation = useMutation({
    mutationFn: async (saleData: any) => {
      if (editVoucherId) {
        const updateData = {
          description: saleData.notes,
          locationId: saleData.locationId,
          paymentAccountType: saleData.paymentAccountType,
          paymentAccountId: saleData.paymentAccountId,
          isCreditSale: saleData.isCreditSale,
          voucherDate: saleData.voucherDate,
          currency: saleData.currency,
          items: saleData.items.map((item: any) => ({
            id: item.salesItemId,
            stockItemId: item.stockItemId,
            quantity: String(item.quantity),
            sellingPrice: String(item.rate),
          })),
        };
        const res = await apiRequest("PUT", `/api/vouchers/${editVoucherId}/sales`, updateData);
        return res.json();
      }

      if (isSpCompany) {
        // Supplier Partner sale — posts through the SP-specific endpoint so the
        // voucher stays exactly Dr Bank/Cash / Cr Supplier Cash Payable (no
        // Sales/COGS/Stock/Cost-Clearing lines); see server/routes/spRoutes.ts.
        // paymentAccountType/paymentAccountId are resolved server-side against
        // bank accounts or Cash-type ledger accounts, same as normal ERP POS.
        const spBody = {
          saleDate: saleData.voucherDate,
          customerName: (saleData.notes || "").trim() || "Walk-in Customer",
          paymentAccountType: saleData.paymentAccountType,
          paymentAccountId: saleData.paymentAccountId,
          notes: saleData.notes || undefined,
          saleLines: saleData.items.map((item: any) => ({
            stockItemId: item.stockItemId,
            qtySold: String(item.quantity),
            salePricePerUnit: String(item.rate),
          })),
        };
        const res = await apiRequest("POST", "/api/sp/sales", spBody);
        const raw = await res.json();

        // Normalize into the same shape the normal-POS response has so the
        // shared print/toast/onSuccess logic below needs no SP-specific branching.
        const grandTotal = parseFloat(raw.totalSalePriceUsd || "0");
        const voucherNumber = `SP-SALE-${raw.id}`;
        return {
          voucher: { id: raw.voucherId, voucherNumber, customerId: undefined },
          location: activeLocation,
          items: (raw.lines || []).map((l: any) => ({
            stockItemId: l.stockItemId,
            stockItemName: l.description || l.articleCode,
            stockItemCode: l.articleCode,
            quantity: l.qtySold,
            // InvoiceTemplate reads rate/rateUSD (not sellingPrice) for per-unit
            // price and profit math — keep all three in sync so print/invoice
            // totals don't resolve to NaN for SP sales.
            rate: l.salePricePerUnit,
            rateUSD: l.salePricePerUnit,
            sellingPrice: l.salePricePerUnit,
            configuredPrice: l.salePricePerUnit,
            amount: l.saleTotal,
          })),
          grandTotal: grandTotal.toFixed(2),
          voucherNumber,
          saleDate: raw.saleDate,
          isCreditSale: false,
          customer: { id: null, code: null, name: raw.customerName },
        };
      }

      const res = await apiRequest("POST", "/api/pos/sales", saleData);
      return res.json();
    },
    onSuccess: async (data: any) => {
      clientSaleIdRef.current = crypto.randomUUID();
      setSavedSale(data);
      if (!editVoucherId) setSaleJustCompleted(true);

      const locationId = activeLocation?.id || data.location?.id || (editVoucher as any)?.locationId;
      if (isSpCompany) {
        queryClient.invalidateQueries({ queryKey: ["/api/sp/stock"] });
      } else if (locationId) {
        queryClient.invalidateQueries({ queryKey: [`/api/locations/${locationId}/inventory`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      if (editVoucherId) queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${editVoucherId}`] });
      invalidateCustomerBalances(data?.voucher?.customerId ?? undefined);

      toast({
        title: editVoucherId ? "Sale Updated" : "Sale Saved",
        description: `Sale ${data.voucher?.voucherNumber} has been ${editVoucherId ? "updated" : "saved"} successfully.`,
      });
      setShowPrintDialog(true);

      if (!editVoucherId) {
        const waGroupId = (activeLocation as any)?.whatsappGroupChatId || (data.location as any)?.whatsappGroupChatId;
        if (waGroupId && data.voucher?.id) {
          setPendingAutoSend({ voucherId: data.voucher.id, locationId: activeLocation?.id || data.location?.id });
          setStockWaStatus("sending");
          setTimeout(() => setPendingStockSend(true), 3000);
        } else {
          setStockWaStatus("not_configured");
        }
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${editVoucherId ? "update" : "save"} sale`,
        variant: "destructive",
      });
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/pos/drafts/${id}`),
    onSuccess: () => {
      toast({ title: "Draft Deleted", description: "Draft has been deleted successfully" });
      refetchDrafts();
    },
  });

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!activeLocation) throw new Error("No location selected");
      const validItems = rows.filter((r) => r.stockItemId && r.quantity > 0 && r.rate > 0);
      if (validItems.length === 0) throw new Error("No items to save");
      const draftData = {
        locationId: activeLocation.id,
        paymentAccountType: isCreditSale ? "credit" : paymentAccountType,
        paymentAccountId: isCreditSale
          ? selectedCustomerId
            ? parseInt(selectedCustomerId)
            : null
          : paymentAccountId
            ? parseInt(paymentAccountId)
            : null,
        isCreditSale,
        notes,
        items: validItems.map((row) => ({
          stockItemId: row.stockItemId,
          quantity: row.quantity.toString(),
          rate: row.rate.toString(),
          amount: row.amount.toString(),
        })),
      };
      if (currentDraftId) {
        const res = await apiRequest("PATCH", `/api/pos/drafts/${currentDraftId}`, draftData);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/pos/drafts", draftData);
        return res.json();
      }
    },
    onSuccess: (data: any) => {
      setCurrentDraftId(data.id);
      setLastAutosaved(new Date());
      const validItems = rows.filter((r) => r.stockItemId && r.quantity > 0 && r.rate > 0);
      lastSavedFingerprintRef.current = JSON.stringify({
        items: validItems.map((r) => ({ id: r.stockItemId, qty: r.quantity, rate: r.rate })),
        notes,
        isCreditSale,
        paymentAccountType,
        paymentAccountId,
        selectedCustomerId,
      });
      toast({ title: "Draft Saved", description: "Your transaction has been saved as a draft" });
      refetchDrafts();
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to save draft", variant: "destructive" });
    },
  });

  return { saveMutation, deleteDraftMutation, saveDraftMutation };
}
