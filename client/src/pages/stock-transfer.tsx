import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { X, Plus, Package, ArrowRight, Eye, Upload } from "lucide-react";
import { Link } from "wouter";
import { StockItemAutocomplete } from "@/components/StockItemAutocomplete";

interface StockTransferPageProps {
  posUser?: any;
}

interface TransferEntry {
  stockItemId: number;
  stockItemName: string;
  quantity: string;
  availableQty: number;
  sourceLocationId: number;
}

interface InventoryItem {
  id: number;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
}

interface StockTransferVoucher {
  id: number;
  voucherNumber: string;
  voucherDate: string;
  description: string;
  totalAmount: string;
  optional: boolean;
  createdAt: string;
  sourceLocationName?: string;
  destinationLocationName?: string;
  items?: Array<{
    stockItemId: number;
    stockItemName?: string;
    quantity: string;
    sourceLocationId?: number;
  }>;
}

export default function StockTransferPage({ posUser }: StockTransferPageProps) {
  const { toast } = useToast();
  const [_location, navigate] = useLocation();
  const isPOS = !!posUser;
  
  // For POS users, always use their assigned location as source
  const posSourceLocation = isPOS ? posUser?.assignedLocationId : null;
  
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<TransferEntry[]>([
    { stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0, sourceLocationId: posSourceLocation || 0 }
  ]);
  
  // Cache for inventory by location (for non-POS users)
  const [inventoryCache, setInventoryCache] = useState<Record<number, InventoryItem[]>>({});
  
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingTransfer, setViewingTransfer] = useState<StockTransferVoucher | null>(null);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: stockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
  });

  // For POS users, load their assigned location's inventory
  const { data: posInventory = [], isLoading: posInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-by-location", posSourceLocation],
    queryFn: async () => {
      if (!posSourceLocation) return [];
      const res = await fetch(`/api/inventory-by-location/${posSourceLocation}`);
      if (!res.ok) throw new Error("Failed to fetch inventory");
      return res.json();
    },
    enabled: isPOS && posSourceLocation !== null && posSourceLocation > 0,
  });

  // Fetch inventory for a specific location (for non-POS)
  const fetchInventoryForLocation = useCallback(async (locationId: number): Promise<InventoryItem[]> => {
    if (inventoryCache[locationId]) {
      return inventoryCache[locationId];
    }
    try {
      const res = await fetch(`/api/inventory-by-location/${locationId}`);
      if (!res.ok) throw new Error("Failed to fetch inventory");
      const data = await res.json();
      setInventoryCache(prev => ({ ...prev, [locationId]: data }));
      return data;
    } catch (error) {
      console.error("Failed to fetch inventory:", error);
      return [];
    }
  }, [inventoryCache]);

  const { data: vouchers = [] } = useQuery<any[]>({
    queryKey: ["/api/vouchers"],
  });

  const stockTransferVouchers = vouchers
    .filter((v: any) => v.voucherType === "Stock Transfer" || v.voucherType === "StockTransfer")
    .slice(0, 20);

  const createTransferMutation = useMutation({
    mutationFn: async (data: { notes: string; items: TransferEntry[] }) => {
      const response = await apiRequest("POST", "/api/stock-transfers", {
        destinationLocationId: selectedDestLocation,
        notes: data.notes || "",
        items: data.items.map((item) => ({
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sourceLocationId: item.sourceLocationId,
        })),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Stock transfer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      setInventoryCache({});
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedDestLocation(null);
    setNotes("");
    setEntries([{ stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0, sourceLocationId: posSourceLocation || 0 }]);
  };

  const getAvailableQtyForLocation = (stockItemId: number, locationId: number): number => {
    if (isPOS) {
      const invItem = posInventory.find(i => i.stockItemId === stockItemId);
      return invItem ? parseFloat(invItem.quantity) : 0;
    }
    const locationInventory = inventoryCache[locationId] || [];
    const invItem = locationInventory.find(i => i.stockItemId === stockItemId);
    return invItem ? parseFloat(invItem.quantity) : 0;
  };

  const handleSourceLocationChange = async (index: number, locationId: number) => {
    const newEntries = [...entries];
    newEntries[index] = {
      ...newEntries[index],
      sourceLocationId: locationId,
      stockItemId: 0,
      stockItemName: "",
      availableQty: 0,
    };
    setEntries(newEntries);
    
    // Pre-fetch inventory for the new location
    if (!isPOS && locationId > 0) {
      await fetchInventoryForLocation(locationId);
    }
  };

  const handleItemChange = async (index: number, stockItemId: number, stockItemName: string) => {
    const entry = entries[index];
    const locationId = entry.sourceLocationId;
    
    // Ensure we have inventory for this location
    if (!isPOS && locationId > 0 && !inventoryCache[locationId]) {
      await fetchInventoryForLocation(locationId);
    }
    
    const availableQty = getAvailableQtyForLocation(stockItemId, locationId);
    
    const newEntries = [...entries];
    newEntries[index] = {
      ...newEntries[index],
      stockItemId,
      stockItemName,
      availableQty,
    };
    setEntries(newEntries);
  };

  const handleQuantityChange = (index: number, quantity: string) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], quantity };
    setEntries(newEntries);
  };

  const addNewRow = () => {
    // For POS, use the assigned location; for non-POS, use 0 (must select)
    const defaultLocationId = isPOS ? posSourceLocation || 0 : 0;
    setEntries([...entries, { stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0, sourceLocationId: defaultLocationId }]);
  };

  const removeRow = (index: number) => {
    if (entries.length > 1) {
      setEntries(entries.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = () => {
    if (!selectedDestLocation) {
      toast({ title: "Error", description: "Please select a destination location", variant: "destructive" });
      return;
    }

    // Filter to only valid entries with stockItemId > 0 and quantity > 0
    const validEntries = entries.filter(e => e.stockItemId > 0 && parseFloat(e.quantity || "0") > 0 && e.sourceLocationId > 0);
    
    if (validEntries.length === 0) {
      toast({ title: "Error", description: "Please add at least one item with source location and quantity", variant: "destructive" });
      return;
    }

    // Check that no item's source location matches the destination
    for (const entry of validEntries) {
      if (entry.sourceLocationId === selectedDestLocation) {
        toast({ title: "Error", description: `Source and destination cannot be the same for ${entry.stockItemName}`, variant: "destructive" });
        return;
      }
    }

    for (const entry of validEntries) {
      const transferQty = parseFloat(entry.quantity || "0");
      if (transferQty > entry.availableQty) {
        toast({ 
          title: "Error", 
          description: `Insufficient stock for ${entry.stockItemName}. Available: ${entry.availableQty}`, 
          variant: "destructive" 
        });
        return;
      }
    }

    createTransferMutation.mutate({ notes, items: validEntries });
  };

  const handleViewTransfer = async (voucher: any) => {
    try {
      const res = await fetch(`/api/stock-transfers?voucherId=${voucher.id}`);
      if (res.ok) {
        const data = await res.json();
        const transfer = Array.isArray(data) ? data[0] : data;
        
        const sourceLocation = locations.find((l: any) => l.id === transfer?.sourceLocationId);
        const destLocation = locations.find((l: any) => l.id === transfer?.destinationLocationId);
        
        setViewingTransfer({
          ...voucher,
          sourceLocationName: sourceLocation?.name || 'Multiple Sources',
          destinationLocationName: destLocation?.name || 'Unknown',
          items: transfer?.items || [],
        });
        setViewDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to fetch transfer details:", error);
    }
  };

  const sourceLocationName = isPOS ? locations.find((l: any) => l.id === posSourceLocation)?.name : null;

  // Get available stock items for a specific source location
  const getAvailableStockItemsForLocation = (locationId: number) => {
    if (isPOS) {
      return stockItems.filter((item: any) => {
        const invItem = posInventory.find(i => i.stockItemId === item.id);
        return invItem && parseFloat(invItem.quantity) > 0;
      });
    }
    const locationInventory = inventoryCache[locationId] || [];
    return stockItems.filter((item: any) => {
      const invItem = locationInventory.find(i => i.stockItemId === item.id);
      return invItem && parseFloat(invItem.quantity) > 0;
    });
  };

  // Check if we can show items table (POS always can, non-POS needs at least one entry with source location)
  const canShowItemsTable = isPOS || entries.some(e => e.sourceLocationId > 0) || true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfer</h1>
          <p className="text-muted-foreground">
            {isPOS ? `Transfer stock from your location to another` : `Transfer stock from multiple locations to a destination`}
          </p>
        </div>
        <Link href="/stock-transfer-import">
          <Button variant="outline" data-testid="button-import-from-excel">
            <Upload className="h-4 w-4 mr-2" />
            Import from Excel
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Transfer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* For POS users, show their fixed source location */}
          {isPOS && (
            <div className="space-y-2">
              <Label data-testid="label-source-location">Source Location</Label>
              <div className="p-3 bg-muted rounded-md">
                <span className="font-medium">{sourceLocationName || "Your Location"}</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label data-testid="label-dest-location">Destination Location</Label>
            <Select 
              value={selectedDestLocation?.toString() || ""} 
              onValueChange={(v) => setSelectedDestLocation(parseInt(v))}
            >
              <SelectTrigger data-testid="select-dest-location">
                <SelectValue placeholder="Select destination location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc: any) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items to Transfer</Label>
              {isPOS && posInventoryLoading && <Skeleton className="h-4 w-24" />}
            </div>
            
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!isPOS && <TableHead className="w-[180px]">Source Location</TableHead>}
                    <TableHead className={isPOS ? "w-[50%]" : "w-[35%]"}>Item Name</TableHead>
                    <TableHead className="text-right w-24">Quantity</TableHead>
                    <TableHead className="text-right w-24">Available</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry, index) => {
                    const availableItems = entry.sourceLocationId > 0 
                      ? getAvailableStockItemsForLocation(entry.sourceLocationId)
                      : stockItems;
                    
                    return (
                      <TableRow key={index} data-testid={`transfer-entry-row-${index}`}>
                        {!isPOS && (
                          <TableCell>
                            <Select 
                              value={entry.sourceLocationId > 0 ? entry.sourceLocationId.toString() : ""} 
                              onValueChange={(v) => handleSourceLocationChange(index, parseInt(v))}
                            >
                              <SelectTrigger data-testid={`select-source-location-${index}`} className="h-9">
                                <SelectValue placeholder="Select source" />
                              </SelectTrigger>
                              <SelectContent>
                                {locations
                                  .filter((loc: any) => loc.id !== selectedDestLocation)
                                  .map((loc: any) => (
                                    <SelectItem key={loc.id} value={loc.id.toString()}>
                                      {loc.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        )}
                        <TableCell>
                          <StockItemAutocomplete
                            value={entry.stockItemId > 0 ? { id: entry.stockItemId, name: entry.stockItemName } : null}
                            onChange={(id, name) => handleItemChange(index, id, name)}
                            stockItems={availableItems.map((item: any) => ({
                              id: item.id,
                              name: item.name,
                              code: item.code,
                            }))}
                            placeholder={!isPOS && entry.sourceLocationId === 0 ? "Select source first..." : "Type item name..."}
                            testId={`input-item-${index}`}
                            disabled={!isPOS && entry.sourceLocationId === 0}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={entry.quantity}
                            onChange={(e) => handleQuantityChange(index, e.target.value)}
                            className="w-20 text-right ml-auto"
                            placeholder="0"
                            data-testid={`input-quantity-${index}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {entry.stockItemId > 0 ? entry.availableQty.toFixed(2) : "-"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRow(index)}
                            disabled={entries.length === 1}
                            data-testid={`button-remove-row-${index}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addNewRow}
              className="mt-2"
              data-testid="button-add-row"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>

          <div className="space-y-2">
            <Label data-testid="label-notes">Notes</Label>
            <Textarea 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
              placeholder="Optional notes for this transfer" 
              data-testid="input-notes" 
            />
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={createTransferMutation.isPending || !selectedDestLocation} 
            className="w-full"
            data-testid="button-submit-transfer"
          >
            {createTransferMutation.isPending ? "Processing..." : "Create Transfer"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Transfers</CardTitle>
        </CardHeader>
        <CardContent>
          {stockTransferVouchers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No transfers yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockTransferVouchers.map((voucher: any) => (
                    <TableRow key={voucher.id} data-testid={`transfer-row-${voucher.id}`}>
                      <TableCell className="font-mono">
                        {format(parseISO(voucher.voucherDate), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell className="font-mono">{voucher.voucherNumber}</TableCell>
                      <TableCell className="max-w-xs truncate">{voucher.description || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewTransfer(voucher)}
                          data-testid={`button-view-${voucher.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transfer Details - {viewingTransfer?.voucherNumber}</DialogTitle>
          </DialogHeader>
          {viewingTransfer && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {format(parseISO(viewingTransfer.voucherDate), "MMM dd, yyyy")}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 py-2">
                <Badge variant="outline">{viewingTransfer.sourceLocationName}</Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline">{viewingTransfer.destinationLocationName}</Badge>
              </div>

              {viewingTransfer.items && viewingTransfer.items.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Items Transferred</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingTransfer.items.map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{item.stockItemName || `Item ${item.stockItemId}`}</TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(item.quantity).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
