import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useBackToParent } from "@/hooks/use-back-to-parent";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Plus, Trash2, Save, Search, Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCurrency } from "@/lib/formatNumber";
import { PageHeader } from "@/components/PageHeader";
import { useCompany } from "@/contexts/CompanyContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface LineItem {
  id?: number;
  stockItemId: number | null;
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal?: string;
}

interface StockItem {
  id: number;
  name: string;
  code: string;
}

interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  containerId: number;
  containerNumber: string;
  currency: string;
  itemsTotal: string;
  freight: string;
  surcharge: string;
  fumigation: string;
  documentCharges: string;
  discount: string;
  otherCharges: string;
  status: string;
  items: LineItem[];
  freightPaidBy?: string;
  freightOwnAccountId?: number | null;
  freightParentAccountId?: number | null;
}

function FreightAccountPicker({ value, onValueChange, accounts }: {
  value: string;
  onValueChange: (value: string) => void;
  accounts: Array<{ id: number; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const selected = accounts.find(a => a.id.toString() === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid="button-freight-account">
          {selected ? selected.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts..." />
          <CommandList>
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {accounts.map(acct => (
                <CommandItem key={acct.id} value={acct.name}
                  onSelect={() => { onValueChange(acct.id.toString()); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === acct.id.toString() ? "opacity-100" : "opacity-0")} />
                  {acct.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function PurchaseOrderEdit() {
  const [, params] = useRoute("/purchase-orders/:id/edit");
  const [, navigate] = useLocation();
  const handleBack = useBackToParent();
  const { toast } = useToast();
  const poId = params?.id ? parseInt(params.id) : null;
  useEscapeToParent("/containers");
  const { selectedCompany } = useCompany();
  const isFactory = selectedCompany?.companyType === "factory" || selectedCompany?.companyType === "factory_v2";

  const [poNumber, setPoNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState("Open");
  const [items, setItems] = useState<LineItem[]>([]);
  const [freight, setFreight] = useState("0");
  const [surcharge, setSurcharge] = useState("0");
  const [fumigation, setFumigation] = useState("0");
  const [documentCharges, setDocumentCharges] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");
  const [freightPaidBy, setFreightPaidBy] = useState<"supplier" | "own" | "parent">("supplier");
  const [freightOwnAccountId, setFreightOwnAccountId] = useState<number | null>(null);
  const [freightParentAccountId, setFreightParentAccountId] = useState<number | null>(null);

  // Sidebar state for item search
  const [showItemSidebar, setShowItemSidebar] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [sidebarTop, setSidebarTop] = useState(0);
  const focusIdRef = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: stockItems } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: po, isLoading, error } = useQuery<PurchaseOrder>({
    queryKey: [`/api/purchase-orders/${poId}`],
    enabled: !!poId,
  });

  const { data: ledgerAccounts } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/ledger-accounts"],
    enabled: isFactory,
  });

  const { data: parentFreightAccounts } = useQuery<Array<{ id: number; name: string; code: string; accountType: string }>>({
    queryKey: ["/api/purchase-orders/parent-freight-accounts"],
  });

  useEffect(() => {
    if (po) {
      setPoNumber(po.poNumber);
      setCurrency(po.currency);
      setStatus(po.status);
      setItems(po.items.map(item => ({
        id: item.id,
        stockItemId: item.stockItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        rate: item.rate,
        lineTotal: item.lineTotal,
      })));
      setFreight(po.freight || "0");
      setSurcharge(po.surcharge || "0");
      setFumigation(po.fumigation || "0");
      setDocumentCharges(po.documentCharges || "0");
      setDiscount(po.discount || "0");
      setOtherCharges(po.otherCharges || "0");
      setFreightPaidBy((po.freightPaidBy as "supplier" | "own" | "parent") || "supplier");
      setFreightOwnAccountId(po.freightOwnAccountId ?? null);
      setFreightParentAccountId(po.freightParentAccountId ?? null);
    }
  }, [po]);

  const updateMutation = useMutation({
    mutationFn: async (data: { 
      poNumber: string; 
      currency: string; 
      status: string; 
      items: LineItem[]; 
      freight: string; 
      surcharge: string;
      fumigation: string;
      documentCharges: string;
      discount: string;
      otherCharges: string;
      freightPaidBy?: string;
      freightOwnAccountId?: number | null;
      freightParentAccountId?: number | null;
    }) => {
      return apiRequest("PATCH", `/api/purchase-orders/${poId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      if (po?.containerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/containers/${po.containerId}`] });
      }
      toast({
        title: "Purchase Order Updated",
        description: "The purchase order has been updated successfully.",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update purchase order",
        variant: "destructive",
      });
    },
  });

  const syncParentJvMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/purchase-orders/${poId}/sync-parent-voucher`, {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      if (po?.containerId) {
        queryClient.invalidateQueries({ queryKey: [`/api/containers/${po.containerId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/containers/${po.containerId}/sync-voucher`] });
      }
      toast({
        title: data?.found ? "Parent JV Synced" : "No Parent JV Found",
        description: data?.message ?? (data?.found ? `Updated to ${data?.intercoTotal}` : "No INTERCO-PARENT voucher exists for this PO"),
        variant: data?.found ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync parent journal voucher",
        variant: "destructive",
      });
    },
  });

  const handleAddItem = useCallback(() => {
    setItems(prev => [...prev, {
      stockItemId: null,
      itemName: "",
      quantity: "1",
      rate: "0",
    }]);
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleItemChange = useCallback((index: number, field: keyof LineItem, value: string | number | null, stockItem?: StockItem) => {
    setItems(prev => {
      const newItems = [...prev];
      const existingItem = newItems[index];
      if (field === "stockItemId") {
        // Normalize value to number for comparison
        const numericId = typeof value === 'string' ? parseInt(value, 10) : value;
        // If stockItem is passed directly, use it; otherwise fallback to lookup
        const foundItem = stockItem || stockItems?.find((si: any) => si.id === numericId);
        if (foundItem) {
          newItems[index] = {
            ...existingItem,
            stockItemId: foundItem.id,
            itemName: foundItem.name,
          };
        } else {
          // Preserve existing itemName if lookup fails (defensive - don't lose data)
          newItems[index] = {
            ...existingItem,
            stockItemId: typeof numericId === 'number' && !isNaN(numericId) ? numericId : existingItem.stockItemId,
            // Keep existing itemName - don't clear it
          };
        }
      } else {
        newItems[index] = {
          ...existingItem,
          [field]: value,
        };
      }
      return newItems;
    });
  }, [stockItems]);

  const lineTotals = useMemo(() => {
    return items.map(item => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      return (qty * rate).toFixed(2);
    });
  }, [items]);

  const itemsTotal = useMemo(() => {
    return lineTotals.reduce((sum, lt) => sum + parseFloat(lt), 0).toFixed(2);
  }, [lineTotals]);

  const chargesTotal = useMemo(() => {
    const freightAmount = parseFloat(freight) || 0;
    const surchargeAmount = parseFloat(surcharge) || 0;
    const fumigationAmount = parseFloat(fumigation) || 0;
    const documentChargesAmount = parseFloat(documentCharges) || 0;
    const discountAmount = parseFloat(discount) || 0;
    const otherChargesAmount = parseFloat(otherCharges) || 0;
    return (freightAmount + surchargeAmount + fumigationAmount + documentChargesAmount - discountAmount + otherChargesAmount).toFixed(2);
  }, [freight, surcharge, fumigation, documentCharges, discount, otherCharges]);

  const grandTotal = useMemo(() => {
    return (parseFloat(itemsTotal) + parseFloat(chargesTotal)).toFixed(2);
  }, [itemsTotal, chargesTotal]);

  const totalQuantity = useMemo(() => {
    return items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
  }, [items]);
  
  const stockItemsList = useMemo(() => (stockItems || []) as StockItem[], [stockItems]);

  const filteredStockItems = useMemo(() => {
    if (!searchTerm.trim()) return stockItemsList.slice(0, 100);
    const term = (searchTerm || "").toLowerCase();
    return stockItemsList
      .filter(si => 
        (si.name || '').toLowerCase().includes(term) || 
        (si.code || '').toLowerCase().includes(term)
      )
      .slice(0, 100);
  }, [stockItemsList, searchTerm]);

  const handleSelectItem = useCallback((stockItem: StockItem) => {
    if (activeRow !== null) {
      handleItemChange(activeRow, "stockItemId", stockItem.id, stockItem);
      setShowItemSidebar(false);
      setSearchTerm("");
      setActiveRow(null);
      // Focus quantity input
      setTimeout(() => {
        const qtyInput = document.querySelector(`[data-testid="input-quantity-${activeRow}"]`) as HTMLInputElement;
        if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
      }, 50);
    }
  }, [activeRow, handleItemChange]);

  const handleSave = () => {
    if (!poNumber.trim()) {
      toast({
        title: "Validation Error",
        description: "PO Number is required",
        variant: "destructive",
      });
      return;
    }

    if (items.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one line item is required",
        variant: "destructive",
      });
      return;
    }

    if (isFactory && freightPaidBy === "own" && parseFloat(freight) > 0 && !freightOwnAccountId) {
      toast({
        title: "Account Required",
        description: "Select an account for the freight payment.",
        variant: "destructive",
      });
      return;
    }

    if (freightPaidBy === "parent" && parseFloat(freight) > 0 && !freightParentAccountId) {
      toast({
        title: "Account Required",
        description: "Select a parent company account for the freight.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      poNumber,
      currency,
      status,
      items: items.map(item => ({
        id: item.id,
        stockItemId: item.stockItemId,
        itemName: item.itemName,
        quantity: item.quantity,
        rate: item.rate,
      })),
      freight,
      surcharge,
      fumigation,
      documentCharges,
      discount,
      otherCharges,
      freightPaidBy,
      freightOwnAccountId: freightPaidBy === "own" ? freightOwnAccountId : null,
      freightParentAccountId: freightPaidBy === "parent" ? freightParentAccountId : null,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !po) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load purchase order. {(error as any)?.message}</p>
            <Button variant="outline" onClick={() => navigate("/daybook")} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Daybook
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-center gap-2 sm:gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <PageHeader title="Edit Purchase Order" />
          <p className="text-muted-foreground">
            {po.supplierName} ({po.supplierCode}) | Container: {po.containerNumber}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 relative" ref={containerRef}>
      <Card className={`flex-1 transition-all ${showItemSidebar ? 'sm:mr-[340px]' : ''}`}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>PO Details</span>
            <Badge variant={po.status === "Closed" ? "secondary" : "default"}>
              {po.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="poNumber">PO Number</Label>
              <Input
                id="poNumber"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                data-testid="input-po-number"
              />
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency" data-testid="select-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="CFA">CFA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Open">Open</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line Items</Label>
              <Button size="sm" variant="outline" onClick={handleAddItem} data-testid="button-add-item">
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </div>
            
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-[40%]">Item</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Line Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id || `new-${index}`} data-testid={`row-item-${index}`}>
                      <TableCell>
                        <input
                          type="text"
                          value={activeRow === index ? searchTerm : (item.itemName || "")}
                          onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setHighlightedIndex(0);
                          }}
                          onFocus={(e) => {
                            focusIdRef.current += 1;
                            setActiveRow(index);
                            setSearchTerm(item.itemName || "");
                            setHighlightedIndex(0);
                            setShowItemSidebar(true);
                            // Calculate sidebar position relative to the row
                            const row = e.currentTarget.closest('tr');
                            const container = containerRef.current;
                            if (row && container) {
                              const rowRect = row.getBoundingClientRect();
                              const containerRect = container.getBoundingClientRect();
                              setSidebarTop(rowRect.top - containerRect.top);
                            }
                          }}
                          onBlur={() => {
                            const focusIdAtBlur = focusIdRef.current;
                            setTimeout(() => {
                              if (focusIdRef.current === focusIdAtBlur) {
                                setActiveRow(null);
                                setSearchTerm("");
                                setShowItemSidebar(false);
                              }
                            }, 200);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowDown") {
                              if (showItemSidebar && filteredStockItems.length > 0) {
                                e.preventDefault();
                                setHighlightedIndex(Math.min(filteredStockItems.length - 1, highlightedIndex + 1));
                              }
                            } else if (e.key === "ArrowUp") {
                              if (showItemSidebar && filteredStockItems.length > 0) {
                                e.preventDefault();
                                setHighlightedIndex(Math.max(0, highlightedIndex - 1));
                              }
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (showItemSidebar && filteredStockItems.length > 0) {
                                handleSelectItem(filteredStockItems[highlightedIndex]);
                              }
                            } else if (e.key === "Tab" && !e.shiftKey) {
                              // Move to next row's item field and reposition sidebar
                              const nextInput = document.querySelector(`[data-testid="input-item-name-${index + 1}"]`) as HTMLInputElement;
                              if (nextInput) {
                                e.preventDefault();
                                nextInput.focus();
                              } else {
                                setShowItemSidebar(false);
                                setSearchTerm("");
                              }
                            }
                          }}
                          placeholder="Type to search..."
                          className="w-full h-9 px-3 rounded-md border bg-background outline-none focus:ring-2 focus:ring-ring"
                          data-testid={`input-item-name-${index}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, "quantity", e.target.value)}
                          className="text-right"
                          data-testid={`input-quantity-${index}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.rate}
                          onChange={(e) => handleItemChange(index, "rate", e.target.value)}
                          className="text-right"
                          data-testid={`input-rate-${index}`}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatCurrency(parseFloat(lineTotals[index] || "0"))}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemoveItem(index)}
                          data-testid={`button-remove-item-${index}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No items. Click "Add Item" to add line items.
                      </TableCell>
                    </TableRow>
                  )}
                  {items.length > 0 && (
                    <TableRow className="bg-muted/50">
                      <TableCell className="text-right font-medium">
                        Total:
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatCurrency(totalQuantity)}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        ${formatCurrency(parseFloat(itemsTotal))}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="space-y-4">
            <Label>Freight & Other Charges</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="freight">Freight</Label>
                <Input
                  id="freight"
                  type="number"
                  step="0.01"
                  value={freight}
                  onChange={(e) => setFreight(e.target.value)}
                  className="text-right"
                  data-testid="input-freight"
                />
                {parseFloat(freight) > 0 && (isFactory || (parentFreightAccounts && parentFreightAccounts.length > 0)) && (
                  <div className="space-y-1.5">
                    <div className="flex gap-1 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant={freightPaidBy === "supplier" ? "default" : "outline"}
                        onClick={() => { setFreightPaidBy("supplier"); setFreightOwnAccountId(null); setFreightParentAccountId(null); }}
                        data-testid="button-freight-by-supplier"
                      >
                        By Supplier
                      </Button>
                      {isFactory && (
                        <Button
                          type="button"
                          size="sm"
                          variant={freightPaidBy === "own" ? "default" : "outline"}
                          onClick={() => { setFreightPaidBy("own"); setFreightParentAccountId(null); }}
                          data-testid="button-freight-by-own"
                        >
                          Own Account
                        </Button>
                      )}
                      {parentFreightAccounts && parentFreightAccounts.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant={freightPaidBy === "parent" ? "default" : "outline"}
                          onClick={() => { setFreightPaidBy("parent"); setFreightOwnAccountId(null); }}
                          data-testid="button-freight-by-parent"
                        >
                          Parent Co.
                        </Button>
                      )}
                    </div>
                    {freightPaidBy === "own" && (
                      <FreightAccountPicker
                        value={freightOwnAccountId?.toString() ?? ""}
                        onValueChange={(v) => setFreightOwnAccountId(v ? parseInt(v) : null)}
                        accounts={ledgerAccounts ?? []}
                      />
                    )}
                    {freightPaidBy === "parent" && (
                      <FreightAccountPicker
                        value={freightParentAccountId?.toString() ?? ""}
                        onValueChange={(v) => setFreightParentAccountId(v ? parseInt(v) : null)}
                        accounts={parentFreightAccounts ?? []}
                      />
                    )}
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="surcharge">Surcharge</Label>
                <Input
                  id="surcharge"
                  type="number"
                  step="0.01"
                  value={surcharge}
                  onChange={(e) => setSurcharge(e.target.value)}
                  className="text-right"
                  data-testid="input-surcharge"
                />
              </div>
              <div>
                <Label htmlFor="fumigation">Fumigation</Label>
                <Input
                  id="fumigation"
                  type="number"
                  step="0.01"
                  value={fumigation}
                  onChange={(e) => setFumigation(e.target.value)}
                  className="text-right"
                  data-testid="input-fumigation"
                />
              </div>
              <div>
                <Label htmlFor="documentCharges">Document Charges</Label>
                <Input
                  id="documentCharges"
                  type="number"
                  step="0.01"
                  value={documentCharges}
                  onChange={(e) => setDocumentCharges(e.target.value)}
                  className="text-right"
                  data-testid="input-document-charges"
                />
              </div>
              <div>
                <Label htmlFor="discount">Discount</Label>
                <Input
                  id="discount"
                  type="number"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="text-right"
                  data-testid="input-discount"
                />
              </div>
              <div>
                <Label htmlFor="otherCharges">Other Charges</Label>
                <Input
                  id="otherCharges"
                  type="number"
                  step="0.01"
                  value={otherCharges}
                  onChange={(e) => setOtherCharges(e.target.value)}
                  className="text-right"
                  data-testid="input-other-charges"
                />
              </div>
            </div>
            
            <div className="bg-muted/50 rounded-md p-4">
              <div className="flex justify-between items-center">
                <span className="font-medium">Grand Total:</span>
                <span className="text-xl font-bold font-mono">${formatCurrency(parseFloat(grandTotal))}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Items (${formatCurrency(parseFloat(itemsTotal))}) + Charges (${formatCurrency(parseFloat(chargesTotal))})
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col-reverse sm:flex-row justify-between gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => syncParentJvMutation.mutate()}
            disabled={syncParentJvMutation.isPending}
            data-testid="button-sync-parent-jv"
          >
            {syncParentJvMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sync PO &amp; Parent JV
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/daybook")} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save">
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Search Items Sidebar */}
      {showItemSidebar && (
        <Card 
          className="w-full sm:w-80 flex-shrink-0 sm:absolute sm:right-0 z-10" 
          style={{ top: `${sidebarTop}px` }}
          ref={sidebarRef}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search Items
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              <div className="p-2 space-y-1">
                {filteredStockItems.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No items found
                  </div>
                ) : (
                  filteredStockItems.map((item, idx) => {
                    const isHighlighted = idx === highlightedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-md hover-elevate active-elevate-2 ${
                          isHighlighted ? "bg-accent" : ""
                        }`}
                        data-testid={`button-suggest-item-${item.id}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectItem(item);
                        }}
                      >
                        <div className="text-sm font-medium">
                          {item.name}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
