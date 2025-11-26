import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { X, Plus, Trash2, Eye, Edit, Package, ArrowRight } from "lucide-react";

interface StockTransferPageProps {
  posUser?: any;
}

interface TransferItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  availableQty: number;
  rate: string;
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
  
  // Form state
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(
    isPOS && posUser?.assignedLocationId ? posUser.assignedLocationId : null
  );
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [transferDate, setTransferDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [isOptional, setIsOptional] = useState(false);
  const [selectedItems, setSelectedItems] = useState<TransferItem[]>([]);
  
  // Edit mode state
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);
  
  // View dialog state
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingTransfer, setViewingTransfer] = useState<StockTransferVoucher | null>(null);

  // Fetch locations
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  // Fetch inventory for selected source location
  const { data: inventoryItems = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-by-location", selectedSourceLocation],
    enabled: selectedSourceLocation !== null && selectedSourceLocation > 0,
  });

  // Fetch recent transfers (vouchers with type StockTransfer)
  const { data: vouchers = [] } = useQuery<any[]>({
    queryKey: ["/api/vouchers"],
  });

  // Filter to stock transfer vouchers only, for POS filter by location
  const stockTransferVouchers = vouchers.filter((v: any) => {
    if (v.voucherType !== "StockTransfer") return false;
    if (isPOS && posUser?.assignedLocationId) {
      // For POS users, show transfers from their location
      return true; // We'll filter by location in the display
    }
    return true;
  }).slice(0, 20); // Last 20 transfers

  // Set source location from POS user's assigned location
  useEffect(() => {
    if (isPOS && posUser?.assignedLocationId && !selectedSourceLocation) {
      setSelectedSourceLocation(posUser.assignedLocationId);
    }
  }, [isPOS, posUser, selectedSourceLocation]);

  // Create transfer mutation
  const createTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      // First create the voucher
      const sourceLocation = locations.find((l: any) => l.id === selectedSourceLocation);
      const destLocation = locations.find((l: any) => l.id === selectedDestLocation);
      
      const voucherRes = await apiRequest("POST", "/api/vouchers", {
        voucherType: "StockTransfer",
        voucherNumber: `TRANSFER-${Date.now()}`,
        voucherDate: data.transferDate,
        description: `Stock transfer from ${sourceLocation?.name || 'Unknown'} to ${destLocation?.name || 'Unknown'}`,
        totalAmount: data.totalAmount,
        optional: data.optional,
        locationId: selectedSourceLocation,
        locationName: sourceLocation?.name,
      });
      const voucher = await voucherRes.json();

      // Then create the stock transfer
      await apiRequest("POST", "/api/stock-transfers", {
        voucherId: voucher.id,
        destinationLocationId: selectedDestLocation,
        notes: data.notes || "",
        items: data.items.map((item: TransferItem) => ({
          sourceLocationId: selectedSourceLocation,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
        })),
      });

      return voucher;
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

  // Update transfer mutation
  const updateTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      const sourceLocation = locations.find((l: any) => l.id === selectedSourceLocation);
      const destLocation = locations.find((l: any) => l.id === selectedDestLocation);
      
      // Update the voucher
      await apiRequest("PATCH", `/api/vouchers/${editingVoucherId}`, {
        voucherDate: data.transferDate,
        description: `Stock transfer from ${sourceLocation?.name || 'Unknown'} to ${destLocation?.name || 'Unknown'}`,
        totalAmount: data.totalAmount,
        optional: data.optional,
      });
      
      // Update stock transfer
      if (editingTransferId) {
        await apiRequest("PUT", `/api/stock-transfers/${editingTransferId}`, {
          destinationLocationId: selectedDestLocation,
          notes: data.notes || "",
          items: data.items.map((item: TransferItem) => ({
            sourceLocationId: selectedSourceLocation,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            rate: item.rate,
          })),
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Stock transfer updated successfully" });
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
    setTransferDate(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setIsOptional(false);
    setSelectedItems([]);
    setEditingVoucherId(null);
    setEditingTransferId(null);
    // Don't reset source location for POS users
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
        rate: item.averageRate,
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

  const calculateTotal = () => {
    return selectedItems.reduce((sum, item) => {
      return sum + (parseFloat(item.quantity || "0") * parseFloat(item.rate || "0"));
    }, 0);
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

    // Validate quantities
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
      if (transferQty > item.availableQty && !isOptional) {
        toast({ 
          title: "Error", 
          description: `Insufficient stock for ${item.stockItemCode}. Available: ${item.availableQty}`, 
          variant: "destructive" 
        });
        return;
      }
    }

    const data = {
      transferDate,
      notes,
      optional: isOptional,
      totalAmount: calculateTotal().toFixed(2),
      items: selectedItems,
    };

    if (editingVoucherId) {
      updateTransferMutation.mutate(data);
    } else {
      createTransferMutation.mutate(data);
    }
  };

  const handleViewTransfer = async (voucher: any) => {
    try {
      // Fetch stock transfer details
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

  const handleEditTransfer = async (voucher: any) => {
    try {
      // Fetch stock transfer details
      const res = await fetch(`/api/stock-transfers?voucherId=${voucher.id}`);
      if (res.ok) {
        const data = await res.json();
        const transfer = Array.isArray(data) ? data[0] : data;
        
        if (transfer) {
          setEditingVoucherId(voucher.id);
          setEditingTransferId(transfer.id);
          setSelectedSourceLocation(transfer.sourceLocationId);
          setSelectedDestLocation(transfer.destinationLocationId);
          setTransferDate(voucher.voucherDate);
          setNotes(transfer.notes || "");
          setIsOptional(voucher.optional || false);
          
          // Map items
          if (transfer.items) {
            const items: TransferItem[] = transfer.items.map((item: any) => ({
              stockItemId: item.stockItemId,
              stockItemCode: item.stockItemCode || `Item ${item.stockItemId}`,
              stockItemName: item.stockItemName || `Item ${item.stockItemId}`,
              quantity: item.quantity,
              availableQty: 999999, // For editing, we don't restrict
              rate: item.rate,
            }));
            setSelectedItems(items);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch transfer for editing:", error);
      toast({ title: "Error", description: "Failed to load transfer for editing", variant: "destructive" });
    }
  };

  const sourceLocationName = locations.find((l: any) => l.id === selectedSourceLocation)?.name;
  const destLocationName = locations.find((l: any) => l.id === selectedDestLocation)?.name;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfer</h1>
          <p className="text-muted-foreground">
            {isPOS ? `Transfer stock from your location to another` : `Transfer stock between locations`}
          </p>
        </div>
        {editingVoucherId && (
          <Button variant="outline" onClick={resetForm} data-testid="button-cancel-edit">
            Cancel Edit
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{editingVoucherId ? "Edit Transfer" : "New Transfer"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Location Selection */}
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
                        setSelectedItems([]); // Clear items when source changes
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

              {/* Date and Optional */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label data-testid="label-transfer-date">Transfer Date</Label>
                  <Input 
                    type="date" 
                    value={transferDate} 
                    onChange={(e) => setTransferDate(e.target.value)} 
                    data-testid="input-transfer-date" 
                  />
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <Switch
                    id="optional"
                    checked={isOptional}
                    onCheckedChange={setIsOptional}
                    data-testid="switch-optional"
                  />
                  <Label htmlFor="optional" className="cursor-pointer">
                    Draft (Optional - won't affect inventory)
                  </Label>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label data-testid="label-notes">Notes</Label>
                <Textarea 
                  value={notes} 
                  onChange={(e) => setNotes(e.target.value)} 
                  placeholder="Optional notes for this transfer" 
                  data-testid="input-notes" 
                />
              </div>

              {/* Selected Items */}
              {selectedItems.length > 0 && (
                <div className="space-y-2">
                  <Label>Items to Transfer</Label>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right w-32">Quantity</TableHead>
                          {!isPOS && <TableHead className="text-right">Rate</TableHead>}
                          {!isPOS && <TableHead className="text-right">Total</TableHead>}
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
                              <p className="text-xs text-muted-foreground mt-1">
                                Avail: {item.availableQty.toFixed(2)}
                              </p>
                            </TableCell>
                            {!isPOS && (
                              <TableCell className="text-right font-mono">
                                ${parseFloat(item.rate).toFixed(2)}
                              </TableCell>
                            )}
                            {!isPOS && (
                              <TableCell className="text-right font-mono font-semibold">
                                ${(parseFloat(item.quantity || "0") * parseFloat(item.rate)).toFixed(2)}
                              </TableCell>
                            )}
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
                  
                  {!isPOS && (
                    <div className="flex justify-end pt-2">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Total Value</p>
                        <p className="text-xl font-bold">${calculateTotal().toFixed(2)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Button */}
              <Button 
                onClick={handleSubmit} 
                disabled={createTransferMutation.isPending || updateTransferMutation.isPending || selectedItems.length === 0} 
                className="w-full"
                data-testid="button-submit-transfer"
              >
                {(createTransferMutation.isPending || updateTransferMutation.isPending) ? "Processing..." : 
                  editingVoucherId ? "Update Transfer" : "Create Transfer"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Suggestions Panel - Available Items */}
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

      {/* Recent Transfers */}
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
                    {!isPOS && <TableHead className="text-right">Amount</TableHead>}
                    <TableHead>Status</TableHead>
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
                      {!isPOS && (
                        <TableCell className="text-right font-mono">
                          ${parseFloat(voucher.totalAmount || "0").toFixed(2)}
                        </TableCell>
                      )}
                      <TableCell>
                        {voucher.optional ? (
                          <Badge variant="outline">Draft</Badge>
                        ) : (
                          <Badge variant="secondary">Completed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewTransfer(voucher)}
                            data-testid={`button-view-${voucher.id}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditTransfer(voucher)}
                            data-testid={`button-edit-${voucher.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Transfer Dialog */}
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
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  {viewingTransfer.optional ? (
                    <Badge variant="outline">Draft</Badge>
                  ) : (
                    <Badge variant="secondary">Completed</Badge>
                  )}
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
                        {!isPOS && <TableHead className="text-right">Rate</TableHead>}
                        {!isPOS && <TableHead className="text-right">Total</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingTransfer.items.map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{item.stockItemName || `Item ${item.stockItemId}`}</TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(item.quantity).toFixed(2)}
                          </TableCell>
                          {!isPOS && (
                            <TableCell className="text-right font-mono">
                              ${parseFloat(item.rate).toFixed(2)}
                            </TableCell>
                          )}
                          {!isPOS && (
                            <TableCell className="text-right font-mono font-semibold">
                              ${(parseFloat(item.quantity) * parseFloat(item.rate)).toFixed(2)}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {!isPOS && (
                <div className="flex justify-end pt-2 border-t">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="text-xl font-bold">${parseFloat(viewingTransfer.totalAmount).toFixed(2)}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
