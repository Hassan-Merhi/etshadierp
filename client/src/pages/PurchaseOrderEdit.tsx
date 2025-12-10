import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Plus, Trash2, Save, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

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

const LineItemRow = memo(function LineItemRow({
  item,
  index,
  stockItems,
  onItemChange,
  onRemove,
  lineTotal,
}: {
  item: LineItem;
  index: number;
  stockItems: StockItem[];
  onItemChange: (index: number, field: keyof LineItem, value: string | number | null, stockItem?: StockItem) => void;
  onRemove: (index: number) => void;
  lineTotal: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  
  const filteredStockItems = useMemo(() => {
    if (!searchValue) return stockItems.slice(0, 50);
    const search = searchValue.toLowerCase();
    return stockItems
      .filter(si => (si.name || '').toLowerCase().includes(search) || (si.code || '').toLowerCase().includes(search))
      .slice(0, 50);
  }, [stockItems, searchValue]);

  return (
    <TableRow data-testid={`row-item-${index}`}>
      <TableCell>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
              data-testid={`select-item-${index}`}
            >
              <span className="truncate">{item.itemName || "Select item..."}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput 
                placeholder="Search items..." 
                value={searchValue}
                onValueChange={setSearchValue}
              />
              <CommandList>
                <CommandEmpty>No items found.</CommandEmpty>
                <CommandGroup>
                  {filteredStockItems.map((si) => (
                    <CommandItem
                      key={si.id}
                      value={si.id.toString()}
                      onSelect={() => {
                        onItemChange(index, "stockItemId", si.id, si);
                        setOpen(false);
                        setSearchValue("");
                      }}
                    >
                      {si.name}{si.code ? ` (${si.code})` : ''}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={item.quantity}
          onChange={(e) => onItemChange(index, "quantity", e.target.value)}
          className="text-right"
          data-testid={`input-quantity-${index}`}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.01"
          value={item.rate}
          onChange={(e) => onItemChange(index, "rate", e.target.value)}
          className="text-right"
          data-testid={`input-rate-${index}`}
        />
      </TableCell>
      <TableCell className="text-right font-mono">
        ${lineTotal}
      </TableCell>
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onRemove(index)}
          data-testid={`button-remove-item-${index}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
});

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
}

export default function PurchaseOrderEdit() {
  const [, params] = useRoute("/purchase-orders/:id/edit");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const poId = params?.id ? parseInt(params.id) : null;

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

  const { data: stockItems } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: po, isLoading, error } = useQuery<PurchaseOrder>({
    queryKey: [`/api/purchase-orders/${poId}`],
    enabled: !!poId,
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
    }) => {
      return apiRequest("PATCH", `/api/purchase-orders/${poId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      toast({
        title: "Purchase Order Updated",
        description: "The purchase order has been updated successfully.",
      });
      navigate("/daybook");
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update purchase order",
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
  
  const stockItemsList = useMemo(() => (stockItems || []) as StockItem[], [stockItems]);

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

    updateMutation.mutate({
      poNumber,
      currency,
      status,
      items: items.map(item => ({
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
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/daybook")} data-testid="button-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Edit Purchase Order</h1>
          <p className="text-muted-foreground">
            {po.supplierName} ({po.supplierCode}) | Container: {po.containerNumber}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>PO Details</span>
            <Badge variant={po.status === "Closed" ? "secondary" : "default"}>
              {po.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
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
                  <SelectItem value="CDF">CDF</SelectItem>
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
            
            <div className="border rounded-md">
              <Table>
                <TableHeader>
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
                    <LineItemRow
                      key={item.id || `new-${index}`}
                      item={item}
                      index={index}
                      stockItems={stockItemsList}
                      onItemChange={handleItemChange}
                      onRemove={handleRemoveItem}
                      lineTotal={lineTotals[index] || "0.00"}
                    />
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
                      <TableCell colSpan={3} className="text-right font-medium">
                        Items Total:
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        ${itemsTotal}
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
            <div className="grid grid-cols-3 gap-4">
              <div>
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
                <span className="text-xl font-bold font-mono">${grandTotal}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Items (${itemsTotal}) + Charges (${chargesTotal})
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
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
        </CardFooter>
      </Card>
    </div>
  );
}
