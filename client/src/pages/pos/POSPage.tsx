import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { cn } from "@/lib/utils";
import { MapPin, Search, Trash2, Printer, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient, getAppDate } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import { formatNumber } from "@/lib/formatNumber";

import POSOriginal from "./POS";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
}

interface SpMovement {
  id: number;
  articleCode: string;
  description: string | null;
  stockItemId: number | null;
  locationId: number | null;
  qtyRemaining: string;
  finalUnitCostUsd: string;
}

interface SpStockItem {
  articleCode: string;
  name: string;
  stockItemId: number | null;
  availableQty: number;
  suggestedPrice: number;
}

interface CartRow {
  id: string;
  articleCode: string;
  name: string;
  stockItemId: number | null;
  quantity: number;
  rate: number;
  amount: number;
  availableQty: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtPrint(n: number, prefix = "") {
  const fixed = Math.abs(n).toFixed(2);
  const parts = fixed.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = parts.join(".");
  return prefix ? prefix + "\u00A0" + num : num;
}

function newBlankRow(): CartRow {
  return {
    id: `sp-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    articleCode: "",
    name: "",
    stockItemId: null,
    quantity: 1,
    rate: 0,
    amount: 0,
    availableQty: 0,
  };
}

// ── SP POS component ───────────────────────────────────────────────────────────

function SpPOS() {
  const { selectedLocation, setSelectedLocation } = useLocationContext();
  const { toast } = useToast();

  // Locations
  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // SP stock (all, filter by location)
  const { data: spStock = [], isLoading: stockLoading } = useQuery<SpMovement[]>({
    queryKey: ["/api/sp/stock"],
    enabled: !!selectedLocation,
  });

  // Bank accounts
  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!selectedLocation,
  });

  // ── Derived: stock items at active location ─────────────────────────────────
  const stockAtLocation = selectedLocation
    ? (Array.isArray(spStock) ? spStock : []).filter(
        (m) => m.locationId === selectedLocation.id
      )
    : [];

  // Group by articleCode → sum qtyRemaining
  const stockItems: SpStockItem[] = (() => {
    const map = new Map<string, SpStockItem>();
    for (const m of stockAtLocation) {
      const qty = parseFloat(m.qtyRemaining) || 0;
      if (qty <= 0) continue;
      if (map.has(m.articleCode)) {
        const existing = map.get(m.articleCode)!;
        existing.availableQty += qty;
      } else {
        map.set(m.articleCode, {
          articleCode: m.articleCode,
          name: m.description || m.articleCode,
          stockItemId: m.stockItemId,
          availableQty: qty,
          suggestedPrice: parseFloat(m.finalUnitCostUsd) || 0,
        });
      }
    }
    return Array.from(map.values());
  })();

  // ── Cart state ──────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<CartRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [saleDate, setSaleDate] = useState(getAppDate());
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [savedSale, setSavedSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [printTime, setPrintTime] = useState("");

  const printRef = useRef<HTMLDivElement>(null);

  // Auto-select first bank account
  useEffect(() => {
    if (bankAccounts.length > 0 && !bankAccountId) {
      setBankAccountId(String(bankAccounts[0].id));
    }
  }, [bankAccounts, bankAccountId]);

  // Set print time when dialog opens
  useEffect(() => {
    if (showPrintDialog) {
      setPrintTime(
        new Date().toLocaleString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    }
  }, [showPrintDialog]);

  // Print handler
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `SP_Sale_${selectedLocation?.name?.replace(/\s+/g, "_") ?? "POS"}_${saleDate}`,
    onAfterPrint: () => setShowPrintDialog(false),
  });

  // ── Filtered items list ─────────────────────────────────────────────────────
  const filteredItems = searchTerm
    ? stockItems.filter((item) => {
        const q = searchTerm.toLowerCase().replace(/[\s.\-]/g, "");
        return (
          item.name.toLowerCase().replace(/[\s.\-]/g, "").includes(q) ||
          item.articleCode.toLowerCase().replace(/[\s.\-]/g, "").includes(q)
        );
      })
    : stockItems;

  // ── Cart helpers ────────────────────────────────────────────────────────────
  const addToCart = (item: SpStockItem) => {
    setRows((prev) => {
      const existing = prev.findIndex((r) => r.articleCode === item.articleCode);
      if (existing >= 0) {
        const updated = [...prev];
        const r = updated[existing];
        const newQty = r.quantity + 1;
        updated[existing] = { ...r, quantity: newQty, amount: newQty * r.rate };
        return updated;
      }
      return [
        ...prev,
        {
          id: `sp-row-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          articleCode: item.articleCode,
          name: item.name,
          stockItemId: item.stockItemId,
          quantity: 1,
          rate: item.suggestedPrice,
          amount: item.suggestedPrice,
          availableQty: item.availableQty,
        },
      ];
    });
  };

  const updateRowField = (idx: number, field: "quantity" | "rate", raw: string) => {
    const val = parseFloat(raw) || 0;
    setRows((prev) => {
      const updated = [...prev];
      const r = { ...updated[idx], [field]: val };
      r.amount = r.quantity * r.rate;
      updated[idx] = r;
      return updated;
    });
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetCart = () => {
    setRows([]);
    setSearchTerm("");
    setNotes("");
    setIsCreditSale(false);
    setCustomerName("");
    setSaleDate(getAppDate());
  };

  // ── Checkout mutation ───────────────────────────────────────────────────────
  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const validRows = rows.filter((r) => r.articleCode && r.quantity > 0 && r.rate > 0);
      if (validRows.length === 0) throw new Error("Add at least one item to the sale.");
      if (isCreditSale && !customerName.trim()) throw new Error("Customer name is required for credit sales.");

      const body = {
        saleDate,
        customerName: isCreditSale ? customerName.trim() : "Walk-in Customer",
        bankAccountId: !isCreditSale && bankAccountId ? parseInt(bankAccountId) : undefined,
        notes: notes || undefined,
        saleLines: validRows.map((r) => ({
          articleCode: r.articleCode,
          stockItemId: r.stockItemId ?? undefined,
          qtySold: String(r.quantity),
          salePricePerUnit: String(r.rate),
        })),
      };

      const res = await apiRequest("POST", "/api/sp/sales", body);
      return await res.json();
    },
    onSuccess: (data) => {
      setSavedSale(data);
      setShowPrintDialog(true);
      queryClient.invalidateQueries({ queryKey: ["/api/sp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sp/sales"] });
    },
    onError: (e: any) => {
      toast({ title: "Checkout failed", description: e.message, variant: "destructive" });
    },
  });

  // ── Grand total ─────────────────────────────────────────────────────────────
  const grandTotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const hasItems = rows.some((r) => r.quantity > 0 && r.rate > 0);

  // ── No location selected ────────────────────────────────────────────────────
  if (!selectedLocation) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 md:gap-6 p-4 md:p-8">
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl font-semibold mb-2">Point of Sale</h1>
          <p className="text-sm md:text-base text-muted-foreground">Select a location to begin</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 w-full max-w-4xl">
          {(Array.isArray(allLocations) ? allLocations : []).map((loc) => (
            <Card
              key={loc.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedLocation(loc as any)}
              data-testid={`card-location-${loc.id}`}
            >
              <div className="p-4 md:p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-lg">{loc.name}</h3>
                    <p className="text-sm text-muted-foreground">{loc.code}</p>
                  </div>
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
                {loc.city && (
                  <p className="text-sm text-muted-foreground mb-2">{loc.city}</p>
                )}
                <Button
                  className="w-full gap-2 mt-4"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLocation(loc as any);
                  }}
                  data-testid={`button-use-location-${loc.id}`}
                >
                  Use Location
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Main POS layout ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-4 pb-2">
        <PageHeader title="Point of Sale">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1" data-testid="badge-active-location">
              <MapPin className="h-3 w-3" />
              {selectedLocation.name}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedLocation(null as any)}
              data-testid="button-change-location"
            >
              Change Location
            </Button>
          </div>
        </PageHeader>
      </div>

      <div className="flex flex-1 overflow-hidden gap-0">
        {/* ── Left: Item catalog ──────────────────────────────────────────── */}
        <div className="flex flex-col w-72 flex-shrink-0 border-r overflow-hidden">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
                data-testid="input-item-search"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {stockLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Loading stock…</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {stockItems.length === 0
                  ? "No stock available at this location."
                  : "No items match your search."}
              </div>
            ) : (
              filteredItems.map((item) => {
                const inCart = rows.find((r) => r.articleCode === item.articleCode);
                return (
                  <button
                    key={item.articleCode}
                    type="button"
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b hover-elevate transition-colors",
                      inCart && "bg-primary/5"
                    )}
                    onClick={() => addToCart(item)}
                    data-testid={`button-add-item-${item.articleCode}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.articleCode}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">
                          Qty: {formatNumber(item.availableQty)}
                        </p>
                        {inCart && (
                          <Check className="h-3.5 w-3.5 text-primary ml-auto mt-0.5" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Center: Cart ────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <p className="text-sm">No items in cart.</p>
                <p className="text-xs">Click an item on the left to add it.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left pb-2 font-medium">Item</th>
                    <th className="text-right pb-2 font-medium w-20">Qty</th>
                    <th className="text-right pb-2 font-medium w-28">Rate (USD)</th>
                    <th className="text-right pb-2 font-medium w-24">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const stockItem = stockItems.find((s) => s.articleCode === row.articleCode);
                    const overQty = stockItem && row.quantity > stockItem.availableQty;
                    return (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-2">
                          <p className="font-medium">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.articleCode}</p>
                          {overQty && (
                            <p className="text-xs text-destructive">
                              Available: {formatNumber(stockItem!.availableQty)}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-1">
                          <Input
                            type="number"
                            min={0}
                            value={row.quantity === 0 ? "" : row.quantity}
                            onChange={(e) => updateRowField(idx, "quantity", e.target.value)}
                            className={cn(
                              "text-right w-20 ml-auto",
                              overQty && "border-destructive"
                            )}
                            data-testid={`input-qty-${idx}`}
                          />
                        </td>
                        <td className="py-2 px-1">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.rate === 0 ? "" : row.rate}
                            onChange={(e) => updateRowField(idx, "rate", e.target.value)}
                            className="text-right w-28 ml-auto"
                            data-testid={`input-rate-${idx}`}
                          />
                        </td>
                        <td className="py-2 pl-2 text-right font-medium tabular-nums">
                          ${formatNumber(row.amount)}
                        </td>
                        <td className="py-2 pl-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRow(idx)}
                            data-testid={`button-remove-row-${idx}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right: Checkout panel ────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-l flex flex-col overflow-y-auto">
          <div className="p-4 space-y-4 flex-1">
            {/* Date */}
            <div>
              <Label htmlFor="sp-sale-date" className="text-xs text-muted-foreground mb-1 block">
                Sale Date
              </Label>
              <DatePickerInput
                value={saleDate}
                onChange={(v) => setSaleDate(v || getAppDate())}
                data-testid="input-sale-date"
              />
            </div>

            {/* Credit sale toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="sp-credit-toggle" className="text-sm cursor-pointer">
                Credit Sale
              </Label>
              <Switch
                id="sp-credit-toggle"
                checked={isCreditSale}
                onCheckedChange={(v) => {
                  setIsCreditSale(v);
                  if (!v) setCustomerName("");
                }}
                data-testid="switch-credit-sale"
              />
            </div>

            {/* Customer name (credit only) */}
            {isCreditSale && (
              <div>
                <Label htmlFor="sp-customer-name" className="text-xs text-muted-foreground mb-1 block">
                  Customer Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="sp-customer-name"
                  placeholder="Customer name…"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  data-testid="input-customer-name"
                />
              </div>
            )}

            {/* Bank account (non-credit only) */}
            {!isCreditSale && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Payment Account
                </Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger data-testid="select-bank-account">
                    <SelectValue placeholder="Select account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Array.isArray(bankAccounts) ? bankAccounts : []).map((ba: any) => (
                      <SelectItem key={ba.id} value={String(ba.id)}>
                        {ba.accountName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Notes */}
            <div>
              <Label htmlFor="sp-notes" className="text-xs text-muted-foreground mb-1 block">
                Notes
              </Label>
              <Textarea
                id="sp-notes"
                placeholder="Optional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none text-sm"
                rows={2}
                data-testid="textarea-notes"
              />
            </div>

            {/* Grand total */}
            <div className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Grand Total</span>
                <span className="text-xl font-semibold tabular-nums" data-testid="text-grand-total">
                  ${formatNumber(grandTotal)}
                </span>
              </div>
              {rows.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {rows.length} line{rows.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-4 border-t space-y-2 flex-shrink-0">
            <Button
              className="w-full"
              disabled={!hasItems || checkoutMutation.isPending}
              onClick={() => checkoutMutation.mutate()}
              data-testid="button-checkout"
            >
              {checkoutMutation.isPending ? "Saving…" : "Save Sale"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={resetCart}
              disabled={checkoutMutation.isPending}
              data-testid="button-clear-cart"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* ── Print Dialog ──────────────────────────────────────────────────────── */}
      <AlertDialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Sale Saved</AlertDialogTitle>
            <AlertDialogDescription>
              Your sale has been recorded. Print a receipt?
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Hidden print content */}
          <div className="hidden">
            <div ref={printRef} className="p-6 font-mono text-sm" style={{ fontFamily: "monospace" }}>
              <div className="text-center mb-4">
                <p className="font-bold text-lg">{selectedLocation.name}</p>
                <p className="text-xs">Point of Sale Receipt</p>
                <p className="text-xs">{printTime}</p>
                {(isCreditSale || savedSale?.customerName) && (
                  <p className="text-xs mt-1">
                    Customer: {savedSale?.customerName || customerName}
                  </p>
                )}
              </div>
              <hr className="border-dashed my-2" />
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left">Item</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.quantity > 0 && r.rate > 0)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="pr-2">
                          <div>{r.name}</div>
                          <div className="text-[10px] opacity-70">{r.articleCode}</div>
                        </td>
                        <td className="text-right">{formatNumber(r.quantity)}</td>
                        <td className="text-right">{fmtPrint(r.rate, "$")}</td>
                        <td className="text-right">{fmtPrint(r.amount, "$")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <hr className="border-dashed my-2" />
              <div className="flex justify-between font-bold">
                <span>TOTAL</span>
                <span>{fmtPrint(grandTotal, "$")}</span>
              </div>
              {notes && (
                <p className="text-xs mt-2 opacity-70">Notes: {notes}</p>
              )}
              <hr className="border-dashed my-2" />
              <p className="text-center text-xs opacity-60">Thank you!</p>
            </div>
          </div>

          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowPrintDialog(false);
                resetCart();
              }}
              data-testid="button-skip-print"
            >
              Skip
            </Button>
            <Button
              onClick={() => {
                handlePrint();
                resetCart();
              }}
              data-testid="button-print-receipt"
            >
              <Printer className="h-4 w-4 mr-2" />
              Print Receipt
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Router entry: delegates to SpPOS or original POS ──────────────────────────

export default function POSPage() {
  return <POSOriginal />;
}
