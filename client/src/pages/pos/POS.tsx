import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, AlertCircle, Search, Check, Plus, Trash2, Pencil, X, ChevronDown, User, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, getAppDate, invalidateCustomerBalances } from "@/lib/queryClient";
import { useCurrencyContext, type Currency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import * as XLSX from "xlsx";

import { SaleGrid } from "./pos-components/SaleGrid";
import { InventoryPicker } from "./pos-components/InventoryPicker";
import { InvoiceTemplate } from "./pos-components/InvoiceTemplate";
import { POSDialogs } from "./pos-components/POSDialogs";
import { POSHeader } from "./pos-components/POSHeader";
import type { SaleRow, InventoryItem, APIInventoryItem, Location } from "./pos-components/posTypes";

// Server-side invoice PDF send with retry
async function sendInvoicePdfWithRetry(
  voucherId: number,
  locationId: number,
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (n: number) => void } = {}
): Promise<{ ok: true } | { ok: false; message: string }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  let lastMessage = "WhatsApp send failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      const res = await apiRequest("POST", "/api/pos/send-invoice-pdf-backend", { voucherId, locationId });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };
      lastMessage = body.message || `WhatsApp send failed (HTTP ${res.status})`;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, message: lastMessage };
      }
    } catch (e: any) {
      lastMessage = e?.message || "Network error";
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs * attempt));
  }
  return { ok: false, message: lastMessage };
}

// Server-side stock PDF send with retry
async function sendStockPdfWithRetry(
  locationId: number,
  opts: { maxAttempts?: number; delayMs?: number; onAttempt?: (n: number) => void } = {}
): Promise<{ ok: true } | { ok: false; message: string }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  let lastMessage = "WhatsApp send failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.onAttempt?.(attempt);
    try {
      const res = await apiRequest("POST", "/api/pos/send-stock-pdf-backend", { locationId });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };
      lastMessage = body.message || `WhatsApp send failed (HTTP ${res.status})`;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { ok: false, message: lastMessage };
      }
    } catch (e: any) {
      lastMessage = e?.message || "Network error";
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs * attempt));
  }
  return { ok: false, message: lastMessage };
}

export default function POS({ posUser, editVoucherId }: { posUser?: any; editVoucherId?: string } = {}) {
  const { selectedLocation, setSelectedLocation } = useLocationContext();
  const { selectedCompany } = useCompany();
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedCurrency, exchangeRate: dailyExchangeRate, displayCurrency, formatAmountRaw } = useCurrencyContext();

  const [posSelectedLocation, setPosSelectedLocation] = useState<Location | null>(null);
  const [rows, setRows] = useState<SaleRow[]>([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [paymentAccountType, setPaymentAccountType] = useState<"bank" | "cash" | "credit">("cash");
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(null);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [notes, setNotes] = useState("");
  const [saleDate, setSaleDate] = useState(getAppDate());
  const [searchTerm, setSearchTerm] = useState("");
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [zeroStockAlert, setZeroStockAlert] = useState(false);
  const [zeroStockItem, setZeroStockItem] = useState("");
  const [savedSale, setSavedSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [showDraftDialog, setShowDraftDialog] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null);
  const [customerComboOpen, setCustomerComboOpen] = useState(false);
  const [saleJustCompleted, setSaleJustCompleted] = useState(false);
  const [showStockPrompt, setShowStockPrompt] = useState(false);
  const [invoiceWaStatus, setInvoiceWaStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [stockWaStatus, setStockWaStatus] = useState<"idle" | "sending" | "sent" | "failed" | "not_configured">("idle");
  const [sendingInvoiceWhatsApp, setSendingInvoiceWhatsApp] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [lastAutosaved, setLastAutosaved] = useState<Date | null>(null);
  const [pendingAutoSend, setPendingAutoSend] = useState<{
    voucherId: number;
    locationId: number;
  } | null>(null);
  const [pendingStockSend, setPendingStockSend] = useState(false);

  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});
  const itemListRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement | null>(null);
  const stockPrintRef = useRef<HTMLDivElement>(null);
  const clearActiveRowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientSaleIdRef = useRef<string>(crypto.randomUUID());
  const lastSavedFingerprintRef = useRef<string>("");
  const autoSaveInProgressRef = useRef(false);
  const autoSaveStateRef = useRef({
    activeLocation: null as any,
    rows: [] as any[],
    notes: "",
    isCreditSale: false,
    paymentAccountType: "",
    paymentAccountId: null as string | null,
    selectedCustomerId: null as string | null,
    currentDraftId: null as number | null,
    saveDraftIsPending: false,
  });

  const [mobileTab, setMobileTab] = useState<"items" | "cart">("items");
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: !!posUser,
  });

  const activeLocation = posUser ? posSelectedLocation : selectedLocation;

  const {
    data: apiInventory = [],
    isLoading: inventoryLoading,
    error: inventoryError,
  } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
  });

  const inventory = useMemo(
    () =>
      (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
        code: (item.stockItemCode || "").trim(),
        name: (item.stockItemName || "Unknown Item").trim(),
        stock: parseFloat(item.quantity),
        price: parseFloat(item.lastSellingPrice || item.averageRate),
        configuredPrice: parseFloat(item.lastSellingPrice || "0"),
        stockItemId: item.stockItemId,
      })),
    [apiInventory]
  );

  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!activeLocation,
  });

  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: !!activeLocation,
  });

  const cashLedgerAccounts = useMemo(
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Cash"),
    [allLedgerAccounts]
  );
  const customerAccounts = useMemo(
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Asset"),
    [allLedgerAccounts]
  );

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts?locationId=${activeLocation.id}`] : [],
    enabled: !!activeLocation,
  });

  const { data: currentShift } = useQuery<any>({
    queryKey: posUser && activeLocation ? ["/api/pos/shifts/current", { locationId: activeLocation.id }] : [],
    enabled: !!posUser && !!activeLocation,
    refetchInterval: 60_000,
  });

  const { data: authUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const { data: lastSoldPrices = {} } = useQuery<Record<number, string>>({
    queryKey: activeLocation ? [`/api/pos/last-sold-prices`, { locationId: activeLocation.id }] : [],
    queryFn: async () => {
      if (!activeLocation) return {};
      const res = await fetch(`/api/pos/last-sold-prices?locationId=${activeLocation.id}`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!activeLocation,
    staleTime: 60_000,
  });

  const { data: posCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/customers"],
    enabled: isCreditSale,
  });

  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  // Stock inventory — prefetch when invoice or stock dialog is open
  const printLocationId = activeLocation?.id ?? (editVoucher as any)?.locationId ?? null;
  const { data: stockInventory = [], isLoading: stockInventoryLoading } = useQuery<any[]>({
    queryKey: printLocationId ? [`/api/locations/${printLocationId}/inventory`] : [],
    enabled: (showPrintDialog || showStockPrompt) && !!printLocationId,
  });

  const activeCurrency: Currency = displayCurrency ? selectedCurrency : "USD";
  const exchangeRate = dailyExchangeRate;
  const selectedCustomer =
    isCreditSale && selectedCustomerId ? posCustomers.find((c: any) => String(c.id) === selectedCustomerId) : null;

  // Keep autoSaveStateRef in sync
  autoSaveStateRef.current.activeLocation = activeLocation;
  autoSaveStateRef.current.rows = rows;
  autoSaveStateRef.current.notes = notes;
  autoSaveStateRef.current.isCreditSale = isCreditSale;
  autoSaveStateRef.current.paymentAccountType = paymentAccountType;
  autoSaveStateRef.current.paymentAccountId = paymentAccountId;
  autoSaveStateRef.current.selectedCustomerId = selectedCustomerId;
  autoSaveStateRef.current.currentDraftId = currentDraftId;

  // Auto-select first POS location
  useEffect(() => {
    if (posUser && posAssignedLocations.length > 0 && !posSelectedLocation) {
      setPosSelectedLocation(posAssignedLocations[0]);
    }
  }, [posUser, posAssignedLocations, posSelectedLocation]);

  // Set default cash account for POS users from location mapping
  useEffect(() => {
    if (editVoucherId) return;
    const locCashId = (posSelectedLocation as any)?.cashAccountId;
    if (posUser && locCashId) {
      setPaymentAccountType("cash");
      setPaymentAccountId(String(locCashId));
    }
  }, [posUser, posSelectedLocation, editVoucherId]);

  // Auto-attach to today's draft
  useEffect(() => {
    if (currentDraftId !== null) return;
    if (!Array.isArray(drafts) || drafts.length === 0) return;
    const todayUTC = new Date().toISOString().slice(0, 10);
    const todayDraft = drafts.find((d: any) => {
      const rawDate = d.updatedAt || d.createdAt;
      if (!rawDate) return false;
      const dateObj = new Date(rawDate);
      if (isNaN(dateObj.getTime())) return false;
      return dateObj.toISOString().slice(0, 10) === todayUTC;
    });
    if (todayDraft) setCurrentDraftId(todayDraft.id);
  }, [drafts]);

  // Set location from edit voucher
  useEffect(() => {
    if (editVoucher && editVoucher.locationId && !selectedLocation && allLocations.length > 0) {
      const voucherLocation = allLocations.find((loc) => loc.id === editVoucher.locationId);
      if (voucherLocation) setSelectedLocation(voucherLocation);
    }
  }, [editVoucher, allLocations, selectedLocation, setSelectedLocation]);

  // Populate form when editing an existing voucher (ISSUE 10)
  useEffect(() => {
    if (!editVoucher || !Array.isArray(editVoucher.salesItems) || editVoucher.salesItems.length === 0) return;

    const newRows: SaleRow[] = editVoucher.salesItems.map((item: any, index: number) => ({
      id: String(index + 1),
      itemName: item.stockItemName || "",
      stockItemCode: item.stockItemCode || "",
      stockItemId: item.stockItemId,
      salesItemId: item.id,
      quantity: parseFloat(item.quantity),
      rate: parseFloat(item.sellingPrice),
      rateUSD: parseFloat(item.sellingPrice),
      amount: parseFloat(item.totalSales),
      configuredPrice: parseFloat(item.configuredPrice || "0") || undefined,
    }));
    newRows.push({ id: String(newRows.length + 1), itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 });
    setRows(newRows);

    if (editVoucher.description) setNotes(editVoucher.description);
    if (editVoucher.voucherDate) setSaleDate(editVoucher.voucherDate);

    if (editVoucher.entries && editVoucher.entries.length > 0) {
      const debitEntry = editVoucher.entries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
      if (debitEntry) {
        if (debitEntry.bankAccountId) {
          setPaymentAccountType("bank");
          setPaymentAccountId(String(debitEntry.bankAccountId));
          setIsCreditSale(false);
        } else if (debitEntry.ledgerAccountId) {
          const ledgerAccount = allLedgerAccounts.find((acc: any) => acc.id === debitEntry.ledgerAccountId);
          if (ledgerAccount) {
            if (ledgerAccount.accountType === "Cash") {
              setPaymentAccountType("cash");
              setPaymentAccountId(String(debitEntry.ledgerAccountId));
              setIsCreditSale(false);
            } else {
              setPaymentAccountType("credit");
              setPaymentAccountId(String(debitEntry.ledgerAccountId));
              setIsCreditSale(true);
              setSelectedCustomerId(String(debitEntry.ledgerAccountId));
            }
          } else {
            const isCreditSaleEntry = debitEntry.narration?.includes("Credit Sale");
            if (isCreditSaleEntry) {
              setPaymentAccountType("credit");
              setIsCreditSale(true);
              setSelectedCustomerId(String(debitEntry.ledgerAccountId));
            } else {
              setPaymentAccountType("cash");
              setIsCreditSale(false);
            }
            setPaymentAccountId(String(debitEntry.ledgerAccountId));
          }
        }
      }
    }
  }, [editVoucher, allLedgerAccounts]);

  // Deferred WhatsApp invoice auto-send after sale saved
  useEffect(() => {
    if (!pendingAutoSend) return;
    const data = pendingAutoSend;
    setPendingAutoSend(null);
    const doSend = async () => {
      setSendingInvoiceWhatsApp(true);
      setInvoiceWaStatus("sending");
      try {
        const result = await sendInvoicePdfWithRetry(data.voucherId, data.locationId, {
          onAttempt: (n) => {
            if (n > 1) toast({ title: "Retrying…", description: `WhatsApp invoice send attempt ${n}/3.` });
          },
        });
        if (!result.ok) {
          setInvoiceWaStatus("failed");
          toast({ title: "WhatsApp", description: result.message, variant: "destructive" });
        } else {
          setInvoiceWaStatus("sent");
        }
      } catch (e: any) {
        setInvoiceWaStatus("failed");
        toast({ title: "WhatsApp", description: e.message || "Could not send invoice.", variant: "destructive" });
      } finally {
        setSendingInvoiceWhatsApp(false);
      }
    };
    doSend();
  }, [pendingAutoSend]);

  // Deferred WhatsApp stock auto-send after sale saved
  useEffect(() => {
    if (!pendingStockSend || !activeLocation?.id) return;
    setPendingStockSend(false);
    setStockWaStatus("sending");
    const doSend = async () => {
      try {
        const result = await sendStockPdfWithRetry(activeLocation.id, {
          onAttempt: (n) => {
            if (n > 1) toast({ title: "Retrying…", description: `WhatsApp stock send attempt ${n}/3.` });
          },
        });
        if (!result.ok) throw new Error(result.message);
        setStockWaStatus("sent");
        toast({ title: "Stock sent", description: "Stock report sent to WhatsApp group." });
      } catch (e: any) {
        setStockWaStatus("failed");
        toast({
          title: "Stock send failed",
          description: e.message || "Could not send stock report.",
          variant: "destructive",
        });
      }
    };
    doSend();
  }, [pendingStockSend]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + (row.amount || 0), 0), [rows]);
  const totalQty = useMemo(() => rows.reduce((sum, row) => sum + (row.quantity || 0), 0), [rows]);
  const hasValidItems = useMemo(() => rows.some((row) => row.stockItemId && row.quantity > 0), [rows]);

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
      } else {
        const res = await apiRequest("POST", "/api/pos/sales", saleData);
        return res.json();
      }
    },
    onSuccess: async (data: any) => {
      clientSaleIdRef.current = crypto.randomUUID();
      setSavedSale(data);
      if (!editVoucherId) setSaleJustCompleted(true);

      const locationId = activeLocation?.id || data.location?.id || (editVoucher as any)?.locationId;
      if (locationId) queryClient.invalidateQueries({ queryKey: [`/api/locations/${locationId}/inventory`] });
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

  // Keep saveDraftIsPending in sync
  autoSaveStateRef.current.saveDraftIsPending = saveDraftMutation.isPending;

  // Autosave every 7 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const s = autoSaveStateRef.current;
      if (!s.activeLocation) return;
      if (autoSaveInProgressRef.current || s.saveDraftIsPending) return;
      const validItems = s.rows.filter((r: any) => r.stockItemId && r.quantity > 0 && r.rate > 0);
      if (validItems.length === 0) return;
      const fingerprint = JSON.stringify({
        items: validItems.map((r: any) => ({ id: r.stockItemId, qty: r.quantity, rate: r.rate })),
        notes: s.notes,
        isCreditSale: s.isCreditSale,
        paymentAccountType: s.paymentAccountType,
        paymentAccountId: s.paymentAccountId,
        selectedCustomerId: s.selectedCustomerId,
      });
      if (fingerprint === lastSavedFingerprintRef.current) return;
      autoSaveInProgressRef.current = true;
      try {
        const draftData = {
          locationId: s.activeLocation.id,
          paymentAccountType: s.isCreditSale ? "credit" : s.paymentAccountType,
          paymentAccountId: s.isCreditSale
            ? s.selectedCustomerId
              ? parseInt(s.selectedCustomerId)
              : null
            : s.paymentAccountId
              ? parseInt(s.paymentAccountId)
              : null,
          isCreditSale: s.isCreditSale,
          notes: s.notes,
          items: validItems.map((row: any) => ({
            stockItemId: row.stockItemId,
            quantity: row.quantity.toString(),
            rate: row.rate.toString(),
            amount: row.amount.toString(),
          })),
        };
        let data;
        if (s.currentDraftId) {
          const res = await apiRequest("PATCH", `/api/pos/drafts/${s.currentDraftId}`, draftData);
          data = await res.json();
        } else {
          const res = await apiRequest("POST", "/api/pos/drafts", draftData);
          data = await res.json();
        }
        if (data?.id) setCurrentDraftId(data.id);
        lastSavedFingerprintRef.current = fingerprint;
        setLastAutosaved(new Date());
        refetchDrafts();
      } catch {
        // Silent autosave failures
      } finally {
        autoSaveInProgressRef.current = false;
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []); // Empty deps — reads from autoSaveStateRef

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

  // ISSUE 5: Real stock WhatsApp send
  const handleSendWhatsAppReport = async () => {
    if (!activeLocation?.id) {
      toast({ title: "No location", description: "No active location selected.", variant: "destructive" });
      return;
    }
    setSendingWhatsApp(true);
    setStockWaStatus("sending");
    try {
      const result = await sendStockPdfWithRetry(activeLocation.id, {
        onAttempt: (n) => {
          if (n > 1) toast({ title: "Retrying…", description: `WhatsApp stock send attempt ${n}/3.` });
        },
      });
      if (!result.ok) throw new Error(result.message);
      setStockWaStatus("sent");
      toast({ title: "Sent", description: "Stock report sent to WhatsApp group." });
    } catch (e: any) {
      setStockWaStatus("failed");
      toast({ title: "Failed to send", description: e.message || "WhatsApp send failed.", variant: "destructive" });
    } finally {
      setSendingWhatsApp(false);
    }
  };

  // ISSUE 4: Real invoice WhatsApp send
  const handleSendInvoiceWhatsApp = async () => {
    const vId = savedSale?.voucher?.id;
    const locId = activeLocation?.id;
    if (!vId || !locId) {
      toast({ title: "Not ready", description: "No saved invoice to send.", variant: "destructive" });
      return;
    }
    setSendingInvoiceWhatsApp(true);
    setInvoiceWaStatus("sending");
    try {
      const result = await sendInvoicePdfWithRetry(vId, locId, {
        onAttempt: (n) => {
          if (n > 1) toast({ title: "Retrying…", description: `WhatsApp invoice send attempt ${n}/3.` });
        },
      });
      if (!result.ok) {
        setInvoiceWaStatus("failed");
        toast({ title: "Failed to send", description: result.message, variant: "destructive" });
      } else {
        setInvoiceWaStatus("sent");
        toast({ title: "Sent", description: "Invoice sent to WhatsApp group." });
      }
    } catch (e: any) {
      setInvoiceWaStatus("failed");
      toast({ title: "Error", description: e.message || "Could not reach the server.", variant: "destructive" });
    } finally {
      setSendingInvoiceWhatsApp(false);
    }
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

  const columns = [
    { key: "itemName", label: "Item", width: "flex-1" },
    { key: "quantity", label: "Qty", width: "w-20" },
    { key: "rate", label: "Rate", width: "w-24" },
    { key: "amount", label: "Amt", width: "w-28" },
    { key: "plBale", label: "P/L", width: "w-20" },
    { key: "totalPL", label: "T.P/L", width: "w-20" },
    { key: "delete", label: "", width: "w-12" },
  ];

  const normalize = (s: string) => (s || "").toLowerCase().replace(/[.\-\s]/g, "");

  const getFilteredInventory = () => {
    if (!searchTerm) return inventory;
    const searchNorm = normalize(searchTerm);
    return inventory.filter(
      (item) => normalize(item.name).includes(searchNorm) || normalize(item.code).includes(searchNorm)
    );
  };

  // ISSUE 9: Real keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    const maxCol = columns.length - 4; // Exclude plBale, totalPL, delete
    const isItemNameField = columns[colIndex]?.key === "itemName";
    const filteredItems = getFilteredInventory();

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
            toast({
              title: "Invalid item",
              description: "Please select an item from the list.",
              variant: "destructive",
            });
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
            toast({
              title: "Invalid item",
              description: "Please select an item from the list.",
              variant: "destructive",
            });
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
            toast({
              title: "Invalid item",
              description: "Please select an item from the list.",
              variant: "destructive",
            });
            return;
          }
          e.preventDefault();
          if (columns[colIndex]?.key === "quantity") {
            setSelectedCell({ row: rowIndex, col: colIndex + 1 });
            focusCell(rowIndex, colIndex + 1);
          } else if (columns[colIndex]?.key === "rate") {
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
        if (inputVal === "" && (columns[colIndex]?.key === "quantity" || columns[colIndex]?.key === "rate")) {
          e.preventDefault();
          setSelectedCell({ row: rowIndex, col: colIndex - 1 });
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      }
    }
  };

  const formatDisplayAmount = (v: number) =>
    activeCurrency === "CFA" ? `CFA ${Math.round(v).toLocaleString()}` : `$ ${v.toLocaleString()}`;
  const validItemCount = rows.filter((r) => r.amount > 0).length;

  if (posUser && posLocationsLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-muted-foreground text-sm">Loading location...</p>
      </div>
    );
  }

  if (posUser && !posLocationsLoading && posAssignedLocations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-2">
        <p className="font-semibold">No location assigned</p>
        <p className="text-muted-foreground text-sm">Contact your administrator to be assigned to a location.</p>
      </div>
    );
  }

  if (!activeLocation && !posUser && !editVoucherId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
        <h1 className="text-3xl font-bold">Point of Sale</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
          {allLocations.map((loc) => (
            <Card key={loc.id} className="p-6 cursor-pointer hover-elevate" onClick={() => setSelectedLocation(loc)}>
              <h3 className="text-lg font-bold">{loc.name}</h3>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative">
      <POSHeader
        posUser={posUser}
        editVoucherId={editVoucherId}
        activeLocation={activeLocation}
        showPosImport={!posUser || companySettings?.posExcelImportEnabled}
        onExportInventory={handleExportInventory}
        onImportClick={() => navigate("/pos-import")}
        onShowStockReport={() => setShowStockPrompt(true)}
        navigate={navigate}
        saveMutation={saveMutation}
        hasValidItems={hasValidItems}
        handleSaveSale={handleSaveSale}
        lastAutosaved={lastAutosaved}
        drafts={drafts}
        onOpenDraftDialog={() => setShowDraftDialog(true)}
        onUpdateDraft={() => saveDraftMutation.mutate(undefined)}
        onSummaryExport={handleSummaryExport}
        onDetailedExport={handleDetailedExport}
      />

      {/* Inline checkout strip — desktop only */}
      {activeLocation && (
        <div className="hidden lg:flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/10">
          {/* Location — admin: full select; POS user: name badge or select if multiple */}
          {!posUser ? (
            <Select
              value={activeLocation?.id?.toString()}
              onValueChange={(val) => {
                const loc = allLocations.find((l) => l.id.toString() === val);
                if (loc) setSelectedLocation(loc);
              }}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-admin-location">
                <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                {allLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : posAssignedLocations.length > 1 ? (
            <Select
              value={posSelectedLocation?.id?.toString()}
              onValueChange={(val) => {
                const loc = posAssignedLocations.find((l) => l.id.toString() === val);
                if (loc) setPosSelectedLocation(loc);
              }}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-pos-location-strip">
                <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                {posAssignedLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-muted/30 text-sm">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">{activeLocation.name}</span>
            </div>
          )}

          <input
            type="date"
            value={saleDate}
            onChange={posUser ? undefined : (e) => setSaleDate(e.target.value)}
            readOnly={!!posUser}
            className={`h-9 px-3 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring ${posUser ? "opacity-60 cursor-not-allowed" : ""}`}
            data-testid="input-sale-date"
          />

          {!isCreditSale && (
            <>
              <Select
                value={paymentAccountType}
                onValueChange={posUser ? undefined : (v: "bank" | "cash") => setPaymentAccountType(v)}
                disabled={!!posUser}
              >
                <SelectTrigger className="w-24" data-testid="select-account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={paymentAccountId || ""}
                onValueChange={posUser ? undefined : setPaymentAccountId}
                disabled={!!posUser}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-payment-account">
                  <SelectValue placeholder={paymentAccountType === "bank" ? "Select Bank" : "Select Cash"} />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccountType === "bank"
                    ? (Array.isArray(bankAccounts) ? bankAccounts : []).map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name} ({acc.code})
                        </SelectItem>
                      ))
                    : cashLedgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="credit-sale-strip"
              checked={isCreditSale}
              onCheckedChange={setIsCreditSale}
              data-testid="toggle-credit-sale"
            />
            <Label htmlFor="credit-sale-strip" className="text-sm cursor-pointer">
              Credit
            </Label>
          </div>

          {isCreditSale && (
            <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 font-normal" data-testid="select-customer">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate max-w-[140px]">
                    {selectedCustomerId
                      ? customerAccounts.find((a: any) => String(a.id) === selectedCustomerId)?.name || "Customer"
                      : "Select customer…"}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search customer…" data-testid="input-customer-search" />
                  <CommandList>
                    <CommandEmpty>No customer found.</CommandEmpty>
                    <CommandGroup>
                      {customerAccounts.map((acc: any) => (
                        <CommandItem
                          key={acc.id}
                          value={acc.name}
                          onSelect={() => {
                            setSelectedCustomerId(String(acc.id));
                            setCustomerComboOpen(false);
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 shrink-0 ${selectedCustomerId === String(acc.id) ? "opacity-100" : "opacity-0"}`}
                          />
                          {acc.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* ── Desktop layout ── */}
      <div className="hidden lg:flex flex-1 overflow-hidden p-4">
        <div className="flex flex-row gap-4 h-full w-full">
          <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
            <div>
              <SaleGrid
                rows={rows}
                columns={columns}
                selectedCell={selectedCell}
                setSelectedCell={setSelectedCell}
                updateRow={updateRow}
                handleDeleteRow={(i) => setRows(rows.filter((_, idx) => idx !== i))}
                handleKeyDown={handleKeyDown}
                setActiveRow={setActiveRow}
                setSearchTerm={setSearchTerm}
                setHighlightedIndex={setHighlightedIndex}
                getStockWarning={() => null}
                formatDisplayAmount={formatDisplayAmount}
                activeCurrency={activeCurrency}
                exchangeRate={exchangeRate}
                inputRefs={inputRefs}
                clearActiveRowTimerRef={clearActiveRowTimerRef}
                focusCell={focusCell}
                toast={toast}
              />
            </div>
            <div className="mt-2 px-1 pb-2">
              <Textarea
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none h-12 min-h-[48px] text-sm"
                data-testid="input-notes"
              />
            </div>
          </div>
          <InventoryPicker
            inventory={inventory}
            selectItem={selectItem}
            itemListRef={itemListRef}
            highlightedIndex={highlightedIndex}
            syncTerm={searchTerm}
          />
        </div>
      </div>

      {/* ── Mobile layout — single unified scroll view ── */}
      <div className="flex lg:hidden flex-1 flex-col overflow-y-auto">

        {/* Sticky search bar with live dropdown */}
        <div className="sticky top-0 z-20 bg-background px-4 pt-3 pb-2 border-b shadow-sm">
          <div className="relative">
            <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 h-11 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
              <Search className="h-5 w-5 text-muted-foreground shrink-0" />
              <input
                className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-base"
                placeholder="Search or scan item…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                ref={mobileSearchInputRef}
                data-testid="input-mobile-product-search"
              />
              {searchTerm && (
                <button
                  className="text-muted-foreground text-xl leading-none px-1"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            {/* Dropdown results */}
            {searchTerm && getFilteredInventory().length > 0 && (
              <div className="absolute top-full left-0 right-0 z-30 bg-background border border-input rounded-md shadow-lg mt-1 max-h-72 overflow-y-auto">
                {getFilteredInventory().map((item) => {
                  const isOut = item.stock === 0;
                  const isLow = !isOut && item.stock < 10;
                  return (
                    <button
                      key={item.code}
                      className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 border-b border-muted/40 last:border-b-0 active:bg-primary/10"
                      onClick={() => {
                        selectItem(item);
                        setSearchTerm("");
                      }}
                      data-testid={`button-mobile-select-item-${item.code}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-base leading-tight truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{item.code}</p>
                      </div>
                      <span className={`shrink-0 font-bold rounded text-xs px-2 py-1 ${
                        isOut
                          ? "bg-red-500/15 text-red-500"
                          : isLow
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {isOut ? "Out" : isLow ? `${Math.round(item.stock)} Low` : Math.round(item.stock).toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sale settings */}
        <div className="px-4 pt-3 pb-2 border-b space-y-3 bg-muted/10">
          {/* Location + date row */}
          <div className="flex items-center gap-2 flex-wrap">
            {!posUser ? (
              <Select
                value={activeLocation?.id?.toString()}
                onValueChange={(val) => {
                  const loc = allLocations.find((l) => l.id.toString() === val);
                  if (loc) setSelectedLocation(loc);
                }}
              >
                <SelectTrigger className="flex-1 min-w-0" data-testid="select-mobile-location">
                  <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  {allLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : posAssignedLocations.length > 1 ? (
              <Select
                value={posSelectedLocation?.id?.toString()}
                onValueChange={(val) => {
                  const loc = posAssignedLocations.find((l) => l.id.toString() === val);
                  if (loc) setPosSelectedLocation(loc);
                }}
              >
                <SelectTrigger className="flex-1 min-w-0" data-testid="select-mobile-pos-location">
                  <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                  {posAssignedLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-muted/30 text-sm flex-1">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium">{activeLocation?.name}</span>
              </div>
            )}
            <input
              type="date"
              value={saleDate}
              onChange={posUser ? undefined : (e) => setSaleDate(e.target.value)}
              readOnly={!!posUser}
              className={`h-9 px-3 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring ${posUser ? "opacity-60 cursor-not-allowed" : ""}`}
              data-testid="input-mobile-sale-date"
            />
          </div>

          {/* Credit toggle + customer/payment */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch
                id="mobile-credit-sale"
                checked={isCreditSale}
                onCheckedChange={setIsCreditSale}
                data-testid="toggle-mobile-credit-sale"
              />
              <Label htmlFor="mobile-credit-sale" className="text-sm cursor-pointer">Credit Sale</Label>
            </div>

            {isCreditSale ? (
              <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 gap-2 font-normal justify-start" data-testid="select-mobile-customer">
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {selectedCustomerId
                        ? customerAccounts.find((a: any) => String(a.id) === selectedCustomerId)?.name || "Customer"
                        : "Select customer…"}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 ml-auto shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Search customer…" />
                    <CommandList>
                      <CommandEmpty>No customer found.</CommandEmpty>
                      <CommandGroup>
                        {customerAccounts.map((acc: any) => (
                          <CommandItem
                            key={acc.id}
                            value={acc.name}
                            onSelect={() => {
                              setSelectedCustomerId(String(acc.id));
                              setCustomerComboOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 shrink-0 ${selectedCustomerId === String(acc.id) ? "opacity-100" : "opacity-0"}`} />
                            {acc.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <Select
                  value={paymentAccountType}
                  onValueChange={posUser ? undefined : (v: "bank" | "cash") => setPaymentAccountType(v)}
                  disabled={!!posUser}
                >
                  <SelectTrigger className="w-24" data-testid="select-mobile-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={paymentAccountId || ""}
                  onValueChange={posUser ? undefined : setPaymentAccountId}
                  disabled={!!posUser}
                >
                  <SelectTrigger className="flex-1 min-w-0" data-testid="select-mobile-payment-account">
                    <SelectValue placeholder={paymentAccountType === "bank" ? "Select Bank" : "Select Cash"} />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentAccountType === "bank"
                      ? (Array.isArray(bankAccounts) ? bankAccounts : []).map((acc: any) => (
                          <SelectItem key={acc.id} value={String(acc.id)}>{acc.name} ({acc.code})</SelectItem>
                        ))
                      : cashLedgerAccounts.map((acc: any) => (
                          <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Cart items */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          {rows.filter((r) => r.stockItemId && r.quantity > 0).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 opacity-30" />
              <p className="text-sm">Search above to add items</p>
            </div>
          ) : (
            rows.filter((r) => r.stockItemId).map((row) => {
              const actualIdx = rows.indexOf(row);
              if (!row.stockItemId) return null;
              return (
                <Card key={row.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight truncate">{row.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.stockItemCode}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRows(rows.filter((_, i) => i !== actualIdx))}
                      className="shrink-0 text-destructive"
                      data-testid={`button-mobile-delete-${actualIdx}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex-1 flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Qty</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={row.quantity || ""}
                        onChange={(e) => updateRow(actualIdx, "quantity", e.target.value)}
                        className="w-full h-10 text-center border border-input rounded-md bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                        data-testid={`input-mobile-qty-${actualIdx}`}
                      />
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Rate</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={row.rate || ""}
                        onChange={(e) => updateRow(actualIdx, "rate", e.target.value)}
                        className="w-full h-10 text-center border border-input rounded-md bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                        data-testid={`input-mobile-rate-${actualIdx}`}
                      />
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</span>
                      <span className="h-10 flex items-center font-mono font-bold text-base">{formatDisplayAmount(row.amount)}</span>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>

        {/* Notes */}
        <div className="px-4 pb-2">
          <Textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="resize-none h-12 min-h-[48px] text-sm"
            data-testid="input-mobile-notes"
          />
        </div>

        {/* Total + checkout — pinned to bottom of scroll */}
        {(() => {
          const validRows = rows.filter((r) => r.amount > 0);
          const total = validRows.reduce((s, r) => s + r.amount, 0);
          const qty = validRows.reduce((s, r) => s + r.quantity, 0);
          return (
            <div className="px-4 pb-6 pt-2 mt-auto border-t bg-background space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {validRows.length} items · Qty {qty.toFixed(0)}
                </span>
                <span className="font-mono font-bold text-2xl">{formatDisplayAmount(total)}</span>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={handleSaveSale}
                disabled={saveMutation?.isPending || !hasValidItems}
                data-testid="button-mobile-checkout"
              >
                {saveMutation?.isPending ? "Saving…" : "Checkout"}
              </Button>
            </div>
          );
        })()}
      </div>

      <POSDialogs
        zeroStockAlert={zeroStockAlert}
        setZeroStockAlert={setZeroStockAlert}
        zeroStockItem={zeroStockItem}
        showDraftDialog={showDraftDialog}
        setShowDraftDialog={setShowDraftDialog}
        drafts={drafts}
        handleLoadDraft={handleLoadDraft}
        deleteDraftMutation={deleteDraftMutation}
        showPrintDialog={showPrintDialog}
        setShowPrintDialog={setShowPrintDialog}
        editVoucherId={editVoucherId}
        handleNewSale={handleNewSale}
        navigate={navigate}
        activeLocation={activeLocation}
        invoiceWaStatus={invoiceWaStatus}
        handleSendInvoiceWhatsApp={handleSendInvoiceWhatsApp}
        sendingInvoiceWhatsApp={sendingInvoiceWhatsApp}
        stockWaStatus={stockWaStatus}
        handleSendStockWhatsApp={handleSendWhatsAppReport}
        sendingWhatsApp={sendingWhatsApp}
        handlePrint={handlePrint}
        isCreditSale={isCreditSale}
        showStockPrompt={showStockPrompt}
        setShowStockPrompt={setShowStockPrompt}
        stockInventoryLoading={stockInventoryLoading}
        handleStockPrint={handleStockPrint}
        handleSendWhatsAppReport={handleSendWhatsAppReport}
        stockInventory={(stockInventory as any[]).map((item: any) => ({
          stockItemName: item.stockItemName,
          stockItemCode: item.stockItemCode,
          stock: parseFloat(item.quantity),
        }))}
        stockPrintRef={stockPrintRef}
      />

      <InvoiceTemplate
        printRef={printRef}
        savedSale={savedSale}
        printUserName={posUser?.fullName || authUser?.fullName || "User"}
        selectedCompany={selectedCompany}
        exchangeRate={exchangeRate}
        fmtPrint={(v) => String(v)}
        fmtPrintCurrency={(v) => String(v)}
      />
    </div>
  );
}
