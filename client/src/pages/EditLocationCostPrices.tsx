import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface LocationItem {
  id: number;
  code: string;
  name: string;
  quantity: number;
  currentRate: number;
}

interface Location {
  id: number;
  name: string;
  code: string;
}

export default function EditLocationCostPrices() {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [editingRates, setEditingRates] = useState<Record<number, string>>({});
  const { toast } = useToast();

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery<LocationItem[]>({
    queryKey: ["/api/inventory-location-items", selectedLocationId],
    queryFn: async () => {
      const res = await fetch(
        `/api/inventory-location-items?locationId=${selectedLocationId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch items");
      return res.json();
    },
    enabled: !!selectedLocationId,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { itemId: number; costPrice: string }) => {
      if (!selectedLocationId) throw new Error("Location not selected");
      const res = await apiRequest(
        "PATCH",
        `/api/inventory/${selectedLocationId}/item/${payload.itemId}/cost-price`,
        { costPrice: payload.costPrice }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ description: "Cost price updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-location-items", selectedLocationId] });
      setEditingRates({});
    },
    onError: (error: any) => {
      toast({ description: error.message, variant: "destructive" });
    },
  });

  const handleSaveRate = (itemId: number) => {
    const newRate = editingRates[itemId];
    if (!newRate || isNaN(parseFloat(newRate))) {
      toast({ description: "Please enter a valid price", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ itemId, costPrice: newRate });
  };

  const handleBarcodeSubmit = () => {
    if (!barcodeInput) return;
    const item = items.find(i => i.code === barcodeInput);
    if (item) {
      setEditingRates(prev => ({ ...prev, [item.id]: item.currentRate.toString() }));
    } else {
      toast({ description: "Item not found", variant: "destructive" });
    }
    setBarcodeInput("");
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Edit Location Cost Prices</h1>
        <p className="text-sm text-muted-foreground">
          Update cost prices per location using item barcodes
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
              <SelectTrigger id="location" data-testid="select-location">
                <SelectValue placeholder="Choose a location..." />
              </SelectTrigger>
              <SelectContent>
                {locations.map(loc => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedLocationId && (
            <div className="space-y-2">
              <Label htmlFor="barcode">Item Barcode/Code (Optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="barcode"
                  placeholder="Scan or enter item code..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSubmit()}
                  autoFocus
                  data-testid="input-barcode"
                />
                <Button
                  variant="outline"
                  onClick={handleBarcodeSubmit}
                  data-testid="button-search-barcode"
                >
                  Search
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedLocationId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Items at {locations.find(l => l.id.toString() === selectedLocationId)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {itemsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">No items found at this location</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-md border hover:bg-muted/50"
                    data-testid={`row-item-${item.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Code: {item.code} | Qty: {item.quantity}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Input
                        type="number"
                        placeholder="Cost price"
                        value={editingRates[item.id] ?? item.currentRate}
                        onChange={(e) =>
                          setEditingRates(prev => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        step="0.01"
                        className="w-32"
                        data-testid={`input-price-${item.id}`}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveRate(item.id)}
                        disabled={updateMutation.isPending}
                        data-testid={`button-save-${item.id}`}
                      >
                        {updateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
