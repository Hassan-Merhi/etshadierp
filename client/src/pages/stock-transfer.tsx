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
import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { X, Plus, Package, ArrowRight, Eye, Edit } from "lucide-react";

interface StockTransferPageProps {
  posUser?: any;
}

interface TransferItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  availableQty: number;
}

interface InventoryItem {
  id: number;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  averageRate: string;
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
    rate: string;
  }>;
}

export default function StockTransferPage({ posUser }: StockTransferPageProps) {
  const { toast } = useToast();
  const [_location, navigate] = useLocation();
  const isPOS = !!posUser;
  
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(
    isPOS && posUser?.assignedLocationId ? posUser.assignedLocationId : null
  );
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedItems, setSelectedItems] = useState<TransferItem[]>([]);
  
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingTransfer, setViewingTransfer] = useState<StockTransferVoucher | null>(null);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: inventoryItems = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-by-location", selectedSourceLocation],
    queryFn: async () => {
      if (!selectedSourceLocation || selectedSourceLocation <= 0) return [];
      const res = await fetch(`/api/inventory-by-location/${selectedSourceLocation}`);
      if (!res.ok) throw new Error("Failed to fetch inventory");
      return res.json();
    },
    enabled: selectedSourceLocation !== null && selectedSourceLocation > 0,
  });

  const { data: vouchers = [] } = useQuery<any[]>({
    queryKey: ["/api/vouchers"],
  });

  const stockTransferVouchers = vouchers
    .filter((v: any) => v.voucherType === "Stock Transfer" || v.voucherType === "StockTransfer")
    .slice(0, 20);

  useEffect(() => {
    if (isPOS && posUser?.assignedLocationId && !selectedSourceLocation) {
      setSelectedSourceLocation(posUser.assignedLocationId);
    }
  }, [isPOS, posUser, selectedSourceLocation]);

  const createTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/stock-transfers", {
        sourceLocationId: selectedSourceLocation,
        destinationLocationId: selectedDestLocation,
        notes: data.notes || "",
        items: data.items.map((item: TransferItem) => ({
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          // Rate is looked up server-side from inventory - not sent by client
        })),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Stock transfer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      resetForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedDestLocation(null);
    setNotes("");
    setSelectedItems([]);
    if (!isPOS) {
      setSelectedSourceLocation(null);
    }
  };

  const handleAddItem = (item: InventoryItem) => {
    if (!selectedItems.find(i => i.stockItemId === item.stockItemId)) {
      setSelectedItems([...selectedItems, {
        stockItemId: item.stockItemId,
        stockItemCode: item.stockItemCode,
        stockItemName: item.stockItemName,
        quantity: "1",
        availableQty: parseFloat(item.quantity),
      }]);
    }
  };

  const handleRemoveItem = (stockItemId: number) => {
    setSelectedItems(selectedItems.filter(i => i.stockItemId !== stockItemId));
  };

  const handleUpdateQuantity = (stockItemId: number, qty: string) => {
    setSelectedItems(selectedItems.map(i => 
      i.stockItemId === stockItemId ? { ...i, quantity: qty } : i
    ));
  };

  const handleSubmit = () => {
    if (!selectedSourceLocation || !selectedDestLocation || selectedItems.length === 0) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    if (selectedSourceLocation === selectedDestLocation) {
      toast({ title: "Error", description: "Source and destination must be different", variant: "destructive" });
      return;
    }

    for (const item of selectedItems) {
      const transferQty = parseFloat(item.quantity || "0");
      if (transferQty <= 0) {
        toast({ 
          title: "Error", 
          description: `Invalid quantity for ${item.stockItemCode}`, 
          variant: "destructive" 
        });
        return;
      }
      if (transferQty > item.availableQty) {
        toast({ 
          title: "Error", 
          description: `Insufficient stock for ${item.stockItemCode}. Available: ${item.availableQty}`, 
          variant: "destructive" 
        });
        return;
      }
    }

    createTransferMutation.mutate({
      notes,
      items: selectedItems,
    });
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
          sourceLocationName: sourceLocation?.name || 'Unknown',
          destinationLocationName: destLocation?.name || 'Unknown',
          items: transfer?.items || [],
        });
        setViewDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to fetch transfer details:", error);
    }
  };

  const sourceLocationName = locations.find((l: any) => l.id === selectedSourceLocation)?.name;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfer</h1>
          <p className="text-muted-foreground">
            {isPOS ? `Transfer stock from your location to another` : `Transfer stock between locations`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>New Transfer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label data-testid="label-source-location">Source Location</Label>
                  {isPOS ? (
                    <div className="p-3 bg-muted rounded-md">
                      <span className="font-medium">{sourceLocationName || "Your Location"}</span>
                    </div>
                  ) : (
                    <Select 
                      value={selectedSourceLocation?.toString() || ""} 
                      onValueChange={(v) => {
                        setSelectedSourceLocation(parseInt(v));
                        setSelectedItems([]);
                      }}
                    >
                      <SelectTrigger data-testid="select-source-location">
                        <SelectValue placeholder="Select source location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc: any) => (
                          <SelectItem key={loc.id} value={loc.id.toString()}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

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
                      {locations
                        .filter((loc: any) => loc.id !== selectedSourceLocation)
                        .map((loc: any) => (
                          <SelectItem key={loc.id} value={loc.id.toString()}>
                            {loc.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
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

              {selectedItems.length > 0 && (
                <div className="space-y-2">
                  <Label>Items to Transfer</Label>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right w-32">Quantity</TableHead>
                          <TableHead className="text-right">Available</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedItems.map((item) => (
                          <TableRow key={item.stockItemId} data-testid={`selected-item-${item.stockItemId}`}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{item.stockItemCode}</p>
                                <p className="text-sm text-muted-foreground">{item.stockItemName}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={item.quantity}
                                onChange={(e) => handleUpdateQuantity(item.stockItemId, e.target.value)}
                                className="w-24 text-right"
                                data-testid={`input-quantity-${item.stockItemId}`}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {item.availableQty.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleRemoveItem(item.stockItemId)}
                                data-testid={`button-remove-item-${item.stockItemId}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <Button 
                onClick={handleSubmit} 
                disabled={createTransferMutation.isPending || selectedItems.length === 0} 
                className="w-full"
                data-testid="button-submit-transfer"
              >
                {createTransferMutation.isPending ? "Processing..." : "Create Transfer"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Available Items</CardTitle>
              {sourceLocationName && (
                <p className="text-sm text-muted-foreground">From: {sourceLocationName}</p>
              )}
            </CardHeader>
            <CardContent>
              {!selectedSourceLocation ? (
                <p className="text-muted-foreground text-sm">Select a source location to see available items</p>
              ) : inventoryLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : inventoryItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No items in this location</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {inventoryItems
                    .filter(item => !selectedItems.find(s => s.stockItemId === item.stockItemId))
                    .map((item) => (
                      <button
                        key={item.stockItemId}
                        className="w-full p-3 text-left border rounded-lg hover-elevate transition-colors"
                        onClick={() => handleAddItem(item)}
                        data-testid={`button-add-item-${item.stockItemId}`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium">{item.stockItemCode}</p>
                            <p className="text-sm text-muted-foreground">{item.stockItemName}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono">{parseFloat(item.quantity).toFixed(2)}</p>
                            <Plus className="h-4 w-4 ml-auto text-primary" />
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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
