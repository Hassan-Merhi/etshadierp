import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { format } from "date-fns";
import { X, Plus, Loader2 } from "lucide-react";

export default function StockTransferPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(null);
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedItems, setSelectedItems] = useState<Array<any>>([]);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: inventoryItems = [] } = useQuery<any[]>({
    queryKey: ["/api/inventory-by-location", selectedSourceLocation],
    enabled: selectedSourceLocation !== null && selectedSourceLocation !== undefined,
  });

  const { data: transfers = [], isLoading: transfersLoading } = useQuery<any[]>({
    queryKey: ["/api/stock-transfers"],
  });

  const createTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/stock-transfers", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Stock transfer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      setSelectedItems([]);
      setNotes("");
      setSelectedSourceLocation(null);
      setSelectedDestLocation(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddItem = (item: any) => {
    if (!selectedItems.find(i => i.stockItemId === item.stockItemId)) {
      setSelectedItems([...selectedItems, { ...item, transferQuantity: "1" }]);
    }
  };

  const handleRemoveItem = (stockItemId: number) => {
    setSelectedItems(selectedItems.filter(i => i.stockItemId !== stockItemId));
  };

  const handleUpdateQuantity = (stockItemId: number, quantity: string) => {
    setSelectedItems(selectedItems.map(i => 
      i.stockItemId === stockItemId ? { ...i, transferQuantity: quantity } : i
    ));
  };

  const handleSubmit = () => {
    if (!selectedSourceLocation || !selectedDestLocation || selectedItems.length === 0) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    // Validate quantities
    for (const item of selectedItems) {
      const transferQty = parseFloat(item.transferQuantity || "0");
      const availableQty = parseFloat(item.quantity);
      if (transferQty <= 0 || transferQty > availableQty) {
        toast({ 
          title: "Error", 
          description: `Invalid quantity for ${item.stockItemCode}`, 
          variant: "destructive" 
        });
        return;
      }
    }

    createTransferMutation.mutate({
      sourceLocationId: selectedSourceLocation,
      destinationLocationId: selectedDestLocation,
      notes,
      items: selectedItems.map(i => ({
        stockItemId: i.stockItemId,
        quantity: i.transferQuantity,
        rate: i.averageRate,
      })),
    });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfers</h1>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6" data-testid="heading-new-transfer">New Stock Transfer</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label data-testid="label-source-location">From Location</Label>
              <Select value={selectedSourceLocation?.toString() || ""} onValueChange={(v) => setSelectedSourceLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-source-location">
                  <SelectValue placeholder="Select source location" />
                </SelectTrigger>
                <SelectContent>
                  {(locations as any[]).map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-source-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label data-testid="label-dest-location">To Location</Label>
              <Select value={selectedDestLocation?.toString() || ""} onValueChange={(v) => setSelectedDestLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-dest-location">
                  <SelectValue placeholder="Select destination location" />
                </SelectTrigger>
                <SelectContent>
                  {(locations as any[]).map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-dest-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label data-testid="label-notes">Notes</Label>
            <Textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes for this transfer"
              data-testid="input-notes"
            />
          </div>

          {selectedSourceLocation && (
            <div>
              <h3 className="font-semibold mb-2" data-testid="heading-available-items">Available Items</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
                {(inventoryItems as any[]).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No items in this location</p>
                ) : (
                  (inventoryItems as any[]).map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-muted rounded" data-testid={`item-available-${item.stockItemId}`}>
                      <div>
                        <p className="font-medium">{item.stockItemCode}</p>
                        <p className="text-sm text-muted-foreground">{item.stockItemName}</p>
                        <p className="text-sm">Qty: {parseFloat(item.quantity).toFixed(3)}</p>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => handleAddItem(item)}
                        data-testid={`button-add-item-${item.stockItemId}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {selectedItems.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2" data-testid="heading-selected-items">Transfer Items</h3>
              <div className="space-y-2">
                {selectedItems.map((item: any) => (
                  <div key={item.stockItemId} className="flex items-center gap-2 p-2 bg-muted rounded" data-testid={`item-selected-${item.stockItemId}`}>
                    <div className="flex-1">
                      <p className="font-medium">{item.stockItemCode}</p>
                      <p className="text-sm text-muted-foreground">{item.stockItemName}</p>
                    </div>
                    <div className="w-24">
                      <Input 
                        type="number" 
                        step="0.001"
                        value={item.transferQuantity} 
                        onChange={(e) => handleUpdateQuantity(item.stockItemId, e.target.value)}
                        placeholder="Qty"
                        data-testid={`input-quantity-${item.stockItemId}`}
                      />
                      <p className="text-xs text-muted-foreground">Available: {parseFloat(item.quantity).toFixed(3)}</p>
                    </div>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handleRemoveItem(item.stockItemId)}
                      data-testid={`button-remove-item-${item.stockItemId}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button 
            onClick={handleSubmit}
            disabled={createTransferMutation.isPending}
            data-testid="button-create-transfer"
            className="w-full"
          >
            {createTransferMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Transfer
          </Button>
        </div>
      </Card>

      <div>
        <h2 className="text-2xl font-semibold mb-4" data-testid="heading-transfers">Recent Transfers</h2>
        {transfersLoading ? (
          <Card className="p-6 text-center text-muted-foreground">Loading...</Card>
        ) : (transfers as any[]).length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">No transfers yet</Card>
        ) : (
          <div className="space-y-4">
            {(transfers as any[]).map((transfer: any) => (
              <Card key={transfer.id} className="p-4" data-testid={`card-transfer-${transfer.id}`}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">From</p>
                    <p className="font-medium">{(locations as any[]).find((l: any) => l.id === transfer.sourceLocationId)?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">To</p>
                    <p className="font-medium">{(locations as any[]).find((l: any) => l.id === transfer.destinationLocationId)?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium">{format(new Date(transfer.createdAt), "MMM dd, yyyy")}</p>
                  </div>
                  {transfer.notes && (
                    <div>
                      <p className="text-sm text-muted-foreground">Notes</p>
                      <p className="font-medium">{transfer.notes}</p>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
