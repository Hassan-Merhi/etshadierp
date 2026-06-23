import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { MapPin, AlertCircle, Search, Check, Plus, Trash2, Pencil, X, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, getAppDate } from "@/lib/queryClient";
import { useCurrencyContext, type Currency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { SaleGrid } from "./pos-components/SaleGrid";
import { InventoryPicker } from "./pos-components/InventoryPicker";
import { InvoiceTemplate } from "./pos-components/InvoiceTemplate";
import { POSDialogs } from "./pos-components/POSDialogs";
import { POSHeader } from "./pos-components/POSHeader";
import type { SaleRow, InventoryItem, APIInventoryItem, Location } from "./pos-components/posTypes";

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

  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});
  const itemListRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement | null>(null);
  const stockPrintRef = useRef<HTMLDivElement>(null);
  const clearActiveRowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mobileItemSearchOpen, setMobileItemSearchOpen] = useState(false);
  const [mobileItemSearchTerm, setMobileItemSearchTerm] = useState("");
  const [mobileItemSearchTarget, setMobileItemSearchTarget] = useState<number | null>(null);
  const [mobileRowEditOpen, setMobileRowEditOpen] = useState(false);
  const [mobileRowEditIndex, setMobileRowEditIndex] = useState<number | null>(null);
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

  const { data: apiInventory = [], isLoading: inventoryLoading, error: inventoryError } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
  });

  const inventory = useMemo(() => (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
    code: (item.stockItemCode || "").trim(),
    name: (item.stockItemName || "Unknown Item").trim(),
    stock: parseFloat(item.quantity),
    price: parseFloat(item.lastSellingPrice || item.averageRate),
    configuredPrice: parseFloat(item.lastSellingPrice || "0"),
    stockItemId: item.stockItemId,
  })), [apiInventory]);

  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!activeLocation,
  });

  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: !!activeLocation,
  });

  const cashLedgerAccounts = useMemo(() => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Cash"), [allLedgerAccounts]);
  const customerAccounts = useMemo(() => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Asset"), [allLedgerAccounts]);

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts?locationId=${activeLocation.id}`] : [],
    enabled: !!activeLocation,
  });

  const { data: currentShift } = useQuery<any>({
    queryKey: posUser && activeLocation ? ["/api/pos/shifts/current", { locationId: activeLocation.id }] : [],
    enabled: !!posUser && !!activeLocation,
  });

  const { data: authUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const { data: lastSoldPrices = {} } = useQuery<Record<number, string>>({
    queryKey: activeLocation ? [`/api/pos/last-sold-prices`, { locationId: activeLocation.id }] : [],
    enabled: !!activeLocation,
  });

  const { data: posCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/customers"],
    enabled: isCreditSale,
  });

  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  const activeCurrency: Currency = displayCurrency ? selectedCurrency : "USD";
  const exchangeRate = dailyExchangeRate;
  const selectedCustomer = isCreditSale && selectedCustomerId ? posCustomers.find((c: any) => String(c.id) === selectedCustomerId) : null;

  useEffect(() => {
    if (posUser && posAssignedLocations.length > 0 && !posSelectedLocation) {
      setPosSelectedLocation(posAssignedLocations[0]);
    }
  }, [posUser, posAssignedLocations, posSelectedLocation]);

  useEffect(() => {
    if (editVoucherId) return;
    const locCashId = (posSelectedLocation as any)?.cashAccountId;
    if (posUser && locCashId) {
      setPaymentAccountType("cash");
      setPaymentAccountId(String(locCashId));
    }
  }, [posUser, posSelectedLocation, editVoucherId]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + (row.amount || 0), 0), [rows]);
  const totalQty = useMemo(() => rows.reduce((sum, row) => sum + (row.quantity || 0), 0), [rows]);
  const hasValidItems = useMemo(() => rows.some((row) => row.stockItemId && row.quantity > 0), [rows]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const endpoint = editVoucherId ? `/api/pos/sale/${editVoucherId}` : "/api/pos/sale";
      const method = editVoucherId ? "PATCH" : "POST";
      const res = await apiRequest(method, endpoint, data);
      return res.json();
    },
    onSuccess: (data) => {
      setSavedSale(data);
      setShowPrintDialog(true);
      setSaleJustCompleted(true);
      if (!editVoucherId) queryClient.invalidateQueries({ queryKey: ["/api/pos/drafts"] });
    },
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/pos/drafts/${id}`),
    onSuccess: () => refetchDrafts(),
  });

  const handleSaveSale = () => {
    const validRows = rows.filter((r) => r.stockItemId && r.quantity > 0);
    saveMutation.mutate({
      locationId: activeLocation.id,
      items: validRows,
      paymentAccountType,
      paymentAccountId: isCreditSale ? selectedCustomerId : paymentAccountId,
      isCreditSale,
      description: notes,
      voucherDate: saleDate,
    });
  };

  const handleNewSale = () => {
    setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, rateUSD: 0, amount: 0 }]);
    setNotes("");
    setSavedSale(null);
    setShowPrintDialog(false);
    setSaleJustCompleted(false);
  };

  const selectItem = (item: any, targetRowOverride?: number) => {
    const targetRow = targetRowOverride ?? activeRow ?? rows.findIndex(r => !r.itemName);
    const newRows = [...rows];
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
      newRows[index].amount = (newRows[index].quantity || 0) * (newRows[index].rate || 0);
    }
    setRows(newRows);
  };

  const focusCell = (row: number, col: number) => {
    inputRefs.current[`${row}-${col}`]?.focus();
    inputRefs.current[`${row}-${col}`]?.select();
  };

  const handlePrint = useReactToPrint({ contentRef: printRef });

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
          {allLocations.map(loc => (
            <Card key={loc.id} className="p-6 cursor-pointer hover-elevate" onClick={() => setSelectedLocation(loc)}>
              <h3 className="text-lg font-bold">{loc.name}</h3>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const formatDisplayAmount = (v: number) => activeCurrency === "CFA" ? `CFA ${Math.round(v).toLocaleString()}` : `$ ${v.toLocaleString()}`;
  const validItemCount = rows.filter(r => r.amount > 0).length;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative pb-20 md:pb-0">
      <POSHeader
        posUser={posUser} editVoucherId={editVoucherId} activeLocation={activeLocation}
        posAssignedLocations={posAssignedLocations} posSelectedLocation={posSelectedLocation} setPosSelectedLocation={setPosSelectedLocation}
        allLocations={allLocations} setSelectedLocation={setSelectedLocation}
        hasOpenShift={!posUser || (!!currentShift && currentShift.status === "open")}
        currentShift={currentShift} showPosImport={!posUser || companySettings?.posExcelImportEnabled}
        onExportInventory={() => {}} onImportClick={() => {}} onShowStockReport={() => setShowStockPrompt(true)} navigate={navigate}
        saveMutation={saveMutation} hasValidItems={hasValidItems} handleSaveSale={handleSaveSale}
      />

      {/* Inline checkout strip */}
      {activeLocation && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b bg-muted/10">
          {/* Location — admin only (POS users have location selector in header) */}
          {!posUser && (
            <Select
              value={activeLocation?.id?.toString()}
              onValueChange={(val) => {
                const loc = allLocations.find(l => l.id.toString() === val);
                if (loc) setSelectedLocation(loc);
              }}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-admin-location">
                <MapPin className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                {allLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Date */}
          <input
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-sale-date"
          />

          {/* Payment type + account (only when not credit sale) */}
          {!isCreditSale && (
            <>
              <Select value={paymentAccountType} onValueChange={(v: "bank" | "cash") => setPaymentAccountType(v)}>
                <SelectTrigger className="w-24" data-testid="select-account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>

              <Select value={paymentAccountId || ""} onValueChange={setPaymentAccountId}>
                <SelectTrigger className="w-[180px]" data-testid="select-payment-account">
                  <SelectValue placeholder={paymentAccountType === "bank" ? "Select Bank" : "Select Cash"} />
                </SelectTrigger>
                <SelectContent>
                  {paymentAccountType === "bank"
                    ? (Array.isArray(bankAccounts) ? bankAccounts : []).map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>{acc.name} ({acc.code})</SelectItem>
                      ))
                    : cashLedgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
            </>
          )}

          {/* Credit sale toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="credit-sale-strip"
              checked={isCreditSale}
              onCheckedChange={setIsCreditSale}
              data-testid="toggle-credit-sale"
            />
            <Label htmlFor="credit-sale-strip" className="text-sm cursor-pointer">Credit</Label>
          </div>

          {/* Customer picker when credit */}
          {isCreditSale && (
            <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 font-normal" data-testid="select-customer">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate max-w-[140px]">
                    {selectedCustomerId
                      ? (customerAccounts.find((a: any) => String(a.id) === selectedCustomerId)?.name || "Customer")
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
                          onSelect={() => { setSelectedCustomerId(String(acc.id)); setCustomerComboOpen(false); }}
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
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden p-4">
        <div className="flex flex-col lg:flex-row gap-4 h-full">
          {/* Left: sale grid + footer totals */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <SaleGrid
              rows={rows} columns={[
                { key: "itemName", label: "Item", width: "flex-1" },
                { key: "quantity", label: "Qty", width: "w-20" },
                { key: "rate", label: "Rate", width: "w-24" },
                { key: "amount", label: "Amt", width: "w-28" },
                { key: "plBale", label: "P/L", width: "w-20" },
                { key: "totalPL", label: "T.P/L", width: "w-20" },
                { key: "delete", label: "", width: "w-12" }
              ]}
              selectedCell={selectedCell} setSelectedCell={setSelectedCell}
              updateRow={updateRow} handleDeleteRow={(i) => setRows(rows.filter((_, idx) => idx !== i))}
              handleKeyDown={(e, r, c) => {}} setActiveRow={setActiveRow} setSearchTerm={setSearchTerm} setHighlightedIndex={setHighlightedIndex}
              getStockWarning={() => null} formatDisplayAmount={formatDisplayAmount}
              activeCurrency={activeCurrency} exchangeRate={exchangeRate} inputRefs={inputRefs} clearActiveRowTimerRef={clearActiveRowTimerRef}
              focusCell={focusCell} toast={toast}
            />

            {/* Footer: totals row */}
            <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
              <span className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{validItemCount}</span> Items&nbsp;&nbsp;
                Qty <span className="font-semibold text-foreground font-mono">{totalQty.toFixed(2)}</span>
              </span>
              <span className="text-sm ml-auto font-semibold">
                Total&nbsp;
                <span className="font-mono text-primary text-base">{formatDisplayAmount(total)}</span>
              </span>
            </div>

            {/* Notes */}
            <Textarea
              placeholder="Sale notes (optional)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none mt-2 h-14 min-h-[56px] text-sm"
              data-testid="input-notes"
            />
          </div>

          {/* Inventory picker: always on the right */}
          <InventoryPicker
            searchTerm={searchTerm} setSearchTerm={setSearchTerm}
            getFilteredInventory={() => inventory.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()))}
            selectItem={selectItem} itemListRef={itemListRef} highlightedIndex={highlightedIndex}
          />
        </div>
      </div>

      <POSDialogs
        zeroStockAlert={zeroStockAlert} setZeroStockAlert={setZeroStockAlert} zeroStockItem={zeroStockItem}
        showDraftDialog={showDraftDialog} setShowDraftDialog={setShowDraftDialog} drafts={drafts}
        handleLoadDraft={(id) => {}} deleteDraftMutation={deleteDraftMutation}
        showPrintDialog={showPrintDialog} setShowPrintDialog={setShowPrintDialog} editVoucherId={editVoucherId}
        handleNewSale={handleNewSale} navigate={navigate} activeLocation={activeLocation}
        invoiceWaStatus={invoiceWaStatus} handleSendInvoiceWhatsApp={() => {}} sendingInvoiceWhatsApp={sendingInvoiceWhatsApp}
        stockWaStatus={stockWaStatus} handleSendStockWhatsApp={() => {}} sendingWhatsApp={sendingWhatsApp}
        handlePrint={handlePrint} isCreditSale={isCreditSale} showStockPrompt={showStockPrompt} setShowStockPrompt={setShowStockPrompt}
        stockInventoryLoading={false} handleStockPrint={() => {}} handleSendWhatsAppReport={() => {}}
        stockInventory={[]} stockPrintRef={stockPrintRef}
      />

      <InvoiceTemplate
        printRef={printRef} savedSale={savedSale} printUserName={posUser?.fullName || authUser?.fullName || "User"}
        selectedCompany={selectedCompany} exchangeRate={exchangeRate} fmtPrint={(v) => String(v)} fmtPrintCurrency={(v) => String(v)}
      />
    </div>
  );
}
