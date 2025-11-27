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
import { ArrowLeft, Loader2, Plus, Trash2, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";

interface LineItem {
  id?: number;
  stockItemId: number | null;
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal?: string;
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
    }
  }, [po]);

  const updateMutation = useMutation({
    mutationFn: async (data: { poNumber: string; currency: string; status: string; items: LineItem[] }) => {
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

  const handleAddItem = () => {
    setItems([...items, {
      stockItemId: null,
      itemName: "",
      quantity: "1",
      rate: "0",
    }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof LineItem, value: string | number | null) => {
    const newItems = [...items];
    if (field === "stockItemId" && value) {
      const stockItem = stockItems?.find(si => si.id === value);
      if (stockItem) {
        newItems[index] = {
          ...newItems[index],
          stockItemId: value as number,
          itemName: stockItem.name,
        };
      }
    } else {
      (newItems[index] as any)[field] = value;
    }
    setItems(newItems);
  };

  const calculateLineTotal = (item: LineItem) => {
    const qty = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    return (qty * rate).toFixed(2);
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      return sum + parseFloat(calculateLineTotal(item));
    }, 0).toFixed(2);
  };

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
                    <TableRow key={index} data-testid={`row-item-${index}`}>
                      <TableCell>
                        <Select
                          value={item.stockItemId?.toString() || ""}
                          onValueChange={(v) => handleItemChange(index, "stockItemId", v ? parseInt(v) : null)}
                        >
                          <SelectTrigger data-testid={`select-item-${index}`}>
                            <SelectValue placeholder="Select item">
                              {item.itemName || "Select item"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {stockItems?.map((si) => (
                              <SelectItem key={si.id} value={si.id.toString()}>
                                {si.name} ({si.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                        ${calculateLineTotal(item)}
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
                      <TableCell colSpan={3} className="text-right font-medium">
                        Total:
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        ${calculateTotal()}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
