import { Search, ShoppingCart, Trash2, MapPin, User, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { SaleRow, InventoryItem, Location } from "./posTypes";
import { getFilteredInventory } from "../utils/posCalculations";

interface PosMobileLayoutProps {
  // Location / user
  posUser: any;
  activeLocation: Location | null;
  allLocations: Location[];
  posAssignedLocations: Location[];
  posSelectedLocation: Location | null;
  setPosSelectedLocation: (loc: Location) => void;
  setSelectedLocation: (loc: Location) => void;
  // Date
  saleDate: string;
  setSaleDate: (date: string) => void;
  // Payment
  paymentAccountType: string;
  setPaymentAccountType: (type: "bank" | "cash") => void;
  paymentAccountId: string | null;
  setPaymentAccountId: (id: string) => void;
  bankAccounts: any[];
  cashLedgerAccounts: any[];
  // Credit / customer
  isCreditSale: boolean;
  setIsCreditSale: (v: boolean) => void;
  mobileCustomerComboOpen: boolean;
  setMobileCustomerComboOpen: (v: boolean) => void;
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  customerAccounts: any[];
  // Search / inventory
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  mobileSearchInputRef: React.RefObject<HTMLInputElement>;
  inventory: InventoryItem[];
  selectItem: (item: any) => void;
  // Rows / cart
  rows: SaleRow[];
  setRows: React.Dispatch<React.SetStateAction<SaleRow[]>>;
  updateRow: (index: number, field: keyof SaleRow, value: any) => void;
  // Notes
  notes: string;
  setNotes: (v: string) => void;
  // Checkout
  saveMutation: any;
  hasValidItems: boolean;
  handleSaveSale: () => void;
  formatDisplayAmount: (v: number) => string;
  /** Supplier Partner sales support cash/bank settlement like normal ERP POS — no credit option. */
  isSpCompany?: boolean;
}

export function PosMobileLayout({
  posUser,
  activeLocation,
  allLocations,
  posAssignedLocations,
  posSelectedLocation,
  setPosSelectedLocation,
  setSelectedLocation,
  saleDate,
  setSaleDate,
  paymentAccountType,
  setPaymentAccountType,
  paymentAccountId,
  setPaymentAccountId,
  bankAccounts,
  cashLedgerAccounts,
  isCreditSale,
  setIsCreditSale,
  mobileCustomerComboOpen,
  setMobileCustomerComboOpen,
  selectedCustomerId,
  setSelectedCustomerId,
  customerAccounts,
  searchTerm,
  setSearchTerm,
  mobileSearchInputRef,
  inventory,
  selectItem,
  rows,
  setRows,
  updateRow,
  notes,
  setNotes,
  saveMutation,
  hasValidItems,
  handleSaveSale,
  formatDisplayAmount,
  isSpCompany,
}: PosMobileLayoutProps) {
  const filteredInventory = getFilteredInventory(inventory, searchTerm);

  return (
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
          {searchTerm && filteredInventory.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-30 bg-background border border-input rounded-md shadow-lg mt-1 max-h-72 overflow-y-auto">
              {filteredInventory.map((item) => {
                const isOut = item.stock === 0;
                const isLow = !isOut && item.stock < 10;
                return (
                  <button
                    key={item.stockItemId ?? item.code}
                    className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 border-b border-muted/40 last:border-b-0 active:bg-primary/10"
                    onClick={() => {
                      selectItem(item);
                      setSearchTerm("");
                    }}
                    data-testid={`button-mobile-select-item-${item.stockItemId ?? item.code}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-base leading-tight truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{item.code}</p>
                    </div>
                    <span
                      className={`shrink-0 font-bold rounded text-xs px-2 py-1 ${
                        isOut
                          ? "bg-red-500/15 text-red-500"
                          : isLow
                            ? "bg-amber-500/15 text-amber-500"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
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
          {!isSpCompany && (
            <div className="flex items-center gap-2">
              <Switch
                id="mobile-credit-sale"
                checked={isCreditSale}
                onCheckedChange={setIsCreditSale}
                data-testid="toggle-mobile-credit-sale"
              />
              <Label htmlFor="mobile-credit-sale" className="text-sm cursor-pointer">Credit Sale</Label>
            </div>
          )}

          {!isSpCompany && isCreditSale ? (
            <Popover open={mobileCustomerComboOpen} onOpenChange={setMobileCustomerComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 gap-2 font-normal justify-start"
                  data-testid="select-mobile-customer"
                >
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
                            setMobileCustomerComboOpen(false);
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
                    <span className="h-10 flex items-center font-mono font-bold text-base">
                      {formatDisplayAmount(row.amount)}
                    </span>
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
  );
}
