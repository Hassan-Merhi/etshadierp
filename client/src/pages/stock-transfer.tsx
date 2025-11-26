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
import { X, Plus } from "lucide-react";

export default function StockTransferPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(null);
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [transferDate, setTransferDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [selectedItems, setSelectedItems] = useState<Array<any>>([]);

  const { data: locations = [] } = useQuery({
    queryKey: ["/api/locations"],
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["/api/inventory-by-location", selectedSourceLocation],
    enabled: selectedSourceLocation !== null && selectedSourceLocation !== undefined,
  });

  const { data: transfers = [] } = useQuery({
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
      setTransferDate(format(new Date(), "yyyy-MM-dd"));
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddItem = (item: any) => {
    if (!selectedItems.find(i => i.stockItemId === item.stockItemId)) {
      setSelectedItems([...selectedItems, { ...item, quantity: 1 }]);
    }
  };

  const handleRemoveItem = (stockItemId: number) => {
    setSelectedItems(selectedItems.filter(i => i.stockItemId !== stockItemId));
  };

  const handleUpdateQuantity = (stockItemId: number, qty: number) => {
    setSelectedItems(selectedItems.map(i => 
      i.stockItemId === stockItemId ? { ...i, quantity: qty } : i
    ));
  };

  const handleSubmit = () => {
    if (!selectedSourceLocation || !selectedDestLocation || selectedItems.length === 0) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    // Validate quantities
    for (const item of selectedItems) {
      const transferQty = parseFloat(item.quantity || "0");
      const availableQty = parseFloat(item.quantity);
      if (transferQty <= 0) {
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
      transferDate,
      notes,
      items: selectedItems.map(i => ({
        stockItemId: i.stockItemId,
        quantity: i.quantity,
        rate: i.averageRate,
      })),
    });
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfers</h1>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6" data-testid="heading-new-transfer">New Transfer</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label data-testid="label-source-location">Source Location</Label>
              <Select value={selectedSourceLocation?.toString() || ""} onValueChange={(v) => setSelectedSourceLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-source-location">
                  <SelectValue placeholder="Select source location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-source-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label data-testid="label-dest-location">Destination Location</Label>
              <Select value={selectedDestLocation?.toString() || ""} onValueChange={(v) => setSelectedDestLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-dest-location">
                  <SelectValue placeholder="Select destination location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-dest-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label data-testid="label-transfer-date">Transfer Date</Label>
            <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} data-testid="input-transfer-date" />
          </div>

          <div>
            <Label data-testid="label-notes">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" data-testid="input-notes" />
          </div>

          {selectedSourceLocation && (
            <div>
              <Label data-testid="label-available-items">Available Items</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-3">
                {inventoryItems.length === 0 ? (
                  <p className="text-gray-500" data-testid="text-no-items">No items in this location</p>
                ) : (
                  inventoryItems.map((item: any) => (
                    <div key={item.id} className="flex justify-between items-center p-2 bg-gray-50 rounded" data-testid={`item-available-${item.stockItemId}`}>
                      <span data-testid={`text-item-code-${item.stockItemId}`}>{item.stockItemCode} - {item.stockItemName} (Qty: {Number(item.quantity).toFixed(2)})</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAddItem(item)}
                        data-testid={`button-add-item-${item.stockItemId}`}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {selectedItems.length > 0 && (
            <div>
              <Label data-testid="label-selected-items">Selected Items for Transfer</Label>
              <div className="space-y-2 border rounded p-3">
                {selectedItems.map((item) => (
                  <div key={item.stockItemId} className="flex justify-between items-center p-2 bg-blue-50 rounded" data-testid={`selected-item-${item.stockItemId}`}>
                    <div className="flex-1">
                      <p className="font-semibold" data-testid={`text-selected-code-${item.stockItemId}`}>{item.stockItemCode}</p>
                      <p className="text-sm text-gray-600" data-testid={`text-item-details-${item.stockItemId}`}>
                        {item.stockItemName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20">
                        <Input 
                          type="number" 
                          min="0.001"
                          step="0.001"
                          value={item.quantity} 
                          onChange={(e) => handleUpdateQuantity(item.stockItemId, parseFloat(e.target.value))}
                          data-testid={`input-quantity-${item.stockItemId}`}
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveItem(item.stockItemId)}
                        data-testid={`button-remove-item-${item.stockItemId}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={createTransferMutation.isPending} className="w-full" data-testid="button-submit-transfer">
            Create Transfer
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6" data-testid="heading-recent-transfers">Recent Transfers</h2>
        <div className="space-y-4">
          {transfers.length === 0 ? (
            <p className="text-gray-500" data-testid="text-no-transfers">No transfers yet</p>
          ) : (
            transfers.map((transfer: any) => (
              <div key={transfer.id} className="border rounded p-4" data-testid={`transfer-card-${transfer.id}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold" data-testid={`text-transfer-id-${transfer.id}`}>Transfer #{transfer.id}</p>
                    <p className="text-sm text-gray-600" data-testid={`text-transfer-date-${transfer.id}`}>{transfer.createdAt ? format(new Date(transfer.createdAt), "MMM dd, yyyy") : 'N/A'}</p>
                  </div>
                </div>
                {transfer.notes && (
                  <p className="text-sm text-gray-600" data-testid={`text-transfer-notes-${transfer.id}`}>{transfer.notes}</p>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
