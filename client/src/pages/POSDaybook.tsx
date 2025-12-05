import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, DollarSign, Package, Eye, Lock, Pencil, Save, X, Plus, Trash2, ArrowRight } from "lucide-react";
import { format, startOfDay, endOfDay, isValid, parseISO } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  locationId: number;
  locationName?: string;
  createdAt: string;
}

interface SalesItem {
  id: number;
  stockItemId: number;
  stockItemName?: string;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
}

interface VoucherWithItems extends Voucher {
  salesItems?: SalesItem[];
}

interface InventoryItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  averageRate: string;
  lastSellingPrice: string | null;
}

export default function POSDaybook() {
  const { formatDisplayDate } = useDateFormat();
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherWithItems | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedItems, setEditedItems] = useState<SalesItem[]>([]);
  const [editedNotes, setEditedNotes] = useState("");
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [_location, navigate] = useLocation();
  const { toast } = useToast();

  // Check for date and voucherId in URL query parameters (from stock item voucher history)
  const urlParams = new URLSearchParams(window.location.search);
  const voucherIdParam = urlParams.get('voucherId');
  const dateParam = urlParams.get('date');

  // Get date range - use URL param if provided and valid, otherwise default to today
  let targetDate = new Date();
  if (dateParam) {
    const parsedDate = parseISO(dateParam);
    if (isValid(parsedDate)) {
      targetDate = parsedDate;
    }
  }
  const startDate = format(startOfDay(targetDate), "yyyy-MM-dd");
  const endDate = format(endOfDay(targetDate), "yyyy-MM-dd");

  // Fetch user permissions
  const { data: currentUser, isLoading: isLoadingUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // Only allow editing if explicitly permitted - defaults to false for safety
  const canEditDaybook = currentUser?.canEditDaybook === true;
  
  // Check if user can see profit/cost (Admin or Owner only)
  const canSeeProfitCost = currentUser?.role === "Admin" || currentUser?.role === "Owner";

  // Fetch today's sales vouchers (only fetch after user is loaded)
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers", { startDate, endDate }],
    enabled: !isLoadingUser, // Only fetch vouchers after user data is loaded
  });

  // Filter to show Sales and StockTransfer vouchers from the user's assigned location
  // Exception: When voucherId is provided (from history), bypass location filter for Admin/Owner
  const bypassLocationFilter = voucherIdParam && (currentUser?.role === "Admin" || currentUser?.role === "Owner");
  
  const filteredVouchers = vouchers.filter((v) => {
    // Must be a Sales or Stock Transfer voucher
    if (v.voucherType !== "Sales" && v.voucherType !== "Stock Transfer" && v.voucherType !== "StockTransfer") return false;
    
    // Bypass location filter when viewing specific historical voucher
    if (bypassLocationFilter) return true;
    
    // If user has an assigned location (POS users), only show transactions from that location
    if (currentUser?.assignedLocationId !== undefined && currentUser?.assignedLocationId !== null) {
      return v.locationId === currentUser.assignedLocationId;
    }
    
    // Non-POS users see all transactions
    return true;
  });
  
  // Backward compatibility alias
  const salesVouchers = filteredVouchers;

  // Fetch voucher details when viewing
  const { data: voucherDetails, isLoading: detailsLoading } = useQuery<VoucherWithItems>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}`] : [],
    enabled: !!selectedVoucher,
  });

  // Fetch inventory for the location when in edit mode
  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: selectedVoucher?.locationId ? [`/api/locations/${selectedVoucher.locationId}/inventory`] : [],
    enabled: !!selectedVoucher?.locationId && isEditMode,
  });

  // Populate editedItems when voucher details load (deep clone to avoid mutating cached data)
  useEffect(() => {
    if (voucherDetails?.salesItems && isEditMode) {
      setEditedItems(JSON.parse(JSON.stringify(voucherDetails.salesItems)));
      setEditedNotes(voucherDetails.description || "");
    }
  }, [voucherDetails, isEditMode]);

  // Auto-select voucher from URL parameter
  useEffect(() => {
    if (voucherIdParam && vouchers.length > 0 && !selectedVoucher) {
      const voucherId = parseInt(voucherIdParam);
      const voucherToSelect = vouchers.find(v => v.id === voucherId);
      
      // Clear the voucherId parameter from URL
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete('voucherId');
      const newSearch = newParams.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);

      if (voucherToSelect) {
        setSelectedVoucher(voucherToSelect);
      } else {
        // Voucher not found - show feedback
        toast({
          variant: "destructive",
          title: "Voucher not found",
          description: "The requested sales transaction could not be found for this date.",
        });
      }
    }
  }, [voucherIdParam, vouchers, selectedVoucher, toast]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVoucher) throw new Error("No voucher selected");

      const items = editedItems.map(item => {
        const payload: any = {
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        };
        
        // Only include ID for existing items (positive IDs), not new items (negative IDs)
        if (item.id > 0) {
          payload.id = item.id;
        }
        
        return payload;
      });

      return await apiRequest("PUT", `/api/vouchers/${selectedVoucher.id}/sales`, {
        description: editedNotes,
        items,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Transaction updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/vouchers/${selectedVoucher?.id}`] });
      setIsEditMode(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    if (voucherDetails?.salesItems) {
      // Deep clone to avoid mutating cached query data
      setEditedItems(JSON.parse(JSON.stringify(voucherDetails.salesItems)));
      setEditedNotes(voucherDetails.description || "");
      setIsEditMode(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    setEditedItems([]);
    setEditedNotes("");
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  const handleItemChange = (index: number, field: keyof SalesItem, value: string) => {
    const newItems = [...editedItems];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Recalculate totals
    const qty = parseFloat(newItems[index].quantity) || 0;
    const price = parseFloat(newItems[index].sellingPrice) || 0;
    const cost = parseFloat(newItems[index].costPrice) || 0;
    
    newItems[index].totalSales = (qty * price).toFixed(2);
    newItems[index].totalCost = (qty * cost).toFixed(2);
    newItems[index].profit = (qty * (price - cost)).toFixed(2);
    
    setEditedItems(newItems);
  };

  const handleAddItem = (item: InventoryItem) => {
    // Create new sales item with current inventory cost and default price
    const newItem: SalesItem = {
      id: -Date.now(), // Temporary negative ID for new items
      stockItemId: item.stockItemId,
      stockItemName: item.stockItemName,
      quantity: "1",
      sellingPrice: item.lastSellingPrice || item.averageRate,
      costPrice: item.averageRate, // Use current cost for new items
      totalSales: item.lastSellingPrice || item.averageRate,
      totalCost: item.averageRate,
      profit: ((parseFloat(item.lastSellingPrice || item.averageRate) - parseFloat(item.averageRate)) * 1).toFixed(2),
    };
    
    setEditedItems([...editedItems, newItem]);
    setAddItemOpen(false);
    setItemSearch("");
  };

  const handleRemoveItem = (index: number) => {
    const newItems = editedItems.filter((_, i) => i !== index);
    setEditedItems(newItems);
  };

  // Separate sales from transfers for accurate metrics
  const salesOnlyVouchers = salesVouchers.filter(v => v.voucherType === "Sales");
  const transferVouchers = salesVouchers.filter(v => v.voucherType !== "Sales");
  
  const totalSales = salesOnlyVouchers.reduce((sum, v) => sum + parseFloat(v.totalAmount), 0);
  const salesTransactionCount = salesOnlyVouchers.length;
  const transferCount = transferVouchers.length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            POS Daybook
          </h1>
          <p className="text-muted-foreground mt-1">
            Sales transactions - {formatDisplayDate(targetDate)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Sales Count
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-transaction-count">
                {salesTransactionCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Sales
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-sales">
                ${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Average Sale
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-avg-transaction">
                ${salesTransactionCount > 0 
                  ? (totalSales / salesTransactionCount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "0.00"
                }
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Transfers Out
            </CardTitle>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-transfer-count">
                {transferCount}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingUser || isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : salesVouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No transactions today</p>
              <p className="text-sm mt-1">Sales and transfers will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesVouchers.map((voucher) => (
                    <TableRow
                      key={voucher.id}
                      data-testid={`row-voucher-${voucher.id}`}
                    >
                      <TableCell className="font-mono text-sm">
                        {format(new Date(voucher.createdAt), "hh:mm a")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={voucher.voucherType === "Sales" ? "default" : "outline"}>
                          {voucher.voucherType === "Sales" ? "Sale" : "Transfer Out"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">
                        {voucher.voucherNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {voucher.locationName || `Location ${voucher.locationId}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ${parseFloat(voucher.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm">
                        {voucher.description || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedVoucher(voucher as VoucherWithItems)}
                          data-testid={`button-view-${voucher.id}`}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
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

      {/* Transaction Details Dialog */}
      <Dialog open={!!selectedVoucher} onOpenChange={() => setSelectedVoucher(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Transaction Details - {selectedVoucher?.voucherNumber}
            </DialogTitle>
            <div className="flex items-center gap-4 pt-2 text-sm text-muted-foreground">
              <span>{selectedVoucher && `${formatDisplayDate(new Date(selectedVoucher.createdAt))} at ${format(new Date(selectedVoucher.createdAt), "hh:mm a")}`}</span>
              <span>•</span>
              <span>{selectedVoucher?.locationName || `Location ${selectedVoucher?.locationId}`}</span>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {detailsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : isEditMode ? (
              <div className="space-y-4">
                <div className="border-b pb-4">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Notes</p>
                  <Textarea
                    value={editedNotes}
                    onChange={(e) => setEditedNotes(e.target.value)}
                    placeholder="Add notes..."
                    className="min-h-[60px]"
                    data-testid="input-notes"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-muted-foreground">Items Sold</p>
                    <Popover open={addItemOpen} onOpenChange={setAddItemOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="button-add-item"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Item
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-0" align="end">
                        <Command>
                          <CommandInput
                            placeholder="Search items..."
                            value={itemSearch}
                            onValueChange={setItemSearch}
                            data-testid="input-item-search"
                          />
                          <CommandList>
                            <CommandEmpty>No items found.</CommandEmpty>
                            <CommandGroup>
                              {inventory
                                .filter(item => 
                                  (item.stockItemName || "").toLowerCase().includes(itemSearch.toLowerCase()) ||
                                  (item.stockItemCode || "").toLowerCase().includes(itemSearch.toLowerCase())
                                )
                                .map((item) => (
                                  <CommandItem
                                    key={item.stockItemId}
                                    value={item.stockItemName || ""}
                                    onSelect={() => handleAddItem(item)}
                                    data-testid={`item-${item.stockItemId}`}
                                  >
                                    <div className="flex justify-between w-full">
                                      <div>
                                        <div className="font-medium">{item.stockItemName || "Unknown Item"}</div>
                                        <div className="text-xs text-muted-foreground">{item.stockItemCode || ""}</div>
                                      </div>
                                      <div className="text-sm font-mono">
                                        ${parseFloat(item.lastSellingPrice || item.averageRate).toFixed(2)}
                                      </div>
                                    </div>
                                  </CommandItem>
                                ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Cost</TableHead>}
                        <TableHead className="text-right">Total</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Profit</TableHead>}
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editedItems.map((item, idx) => {
                        const profit = parseFloat(item.profit || "0");
                        const isPositiveProfit = profit >= 0;
                        
                        return (
                          <TableRow key={item.id || idx}>
                            <TableCell className="font-medium">
                              {item.stockItemName || `Item ${item.stockItemId}`}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                className="text-right font-mono w-24"
                                data-testid={`input-quantity-${idx}`}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={item.sellingPrice}
                                onChange={(e) => handleItemChange(idx, "sellingPrice", e.target.value)}
                                className="text-right font-mono w-24"
                                data-testid={`input-price-${idx}`}
                              />
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                ${parseFloat(item.costPrice || "0").toFixed(2)}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-mono font-semibold">
                              ${parseFloat(item.totalSales).toFixed(2)}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono font-semibold ${isPositiveProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                ${profit.toFixed(2)}
                              </TableCell>
                            )}
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveItem(idx)}
                                data-testid={`button-remove-${idx}`}
                                className="h-8 w-8"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="border-t pt-4 flex justify-between">
                  {canSeeProfitCost && (
                    <div className="space-y-1">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Cost: </span>
                        <span className="font-mono font-semibold">
                          ${editedItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Profit: </span>
                        <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                          ${editedItems.reduce((sum, item) => sum + parseFloat(item.profit || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Sales: </span>
                    <span className="font-mono font-semibold">
                      ${editedItems.reduce((sum, item) => sum + parseFloat(item.totalSales), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : voucherDetails?.salesItems && voucherDetails.salesItems.length > 0 ? (
              <div className="space-y-4">
                {voucherDetails?.description && (
                  <div className="border-b pb-4">
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="text-sm mt-1">{voucherDetails.description}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Items Sold</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Cost</TableHead>}
                        <TableHead className="text-right">Total</TableHead>
                        {canSeeProfitCost && <TableHead className="text-right">Profit</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherDetails.salesItems.map((item: any, idx: number) => {
                        const profit = parseFloat(item.profit || "0");
                        const isPositiveProfit = profit >= 0;
                        
                        return (
                          <TableRow key={item.id || idx}>
                            <TableCell className="font-medium">
                              {item.stockItemName || `Item ${item.stockItemId}`}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {parseFloat(item.quantity).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${parseFloat(item.sellingPrice).toFixed(2)}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                ${parseFloat(item.costPrice || "0").toFixed(2)}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-mono font-semibold">
                              ${parseFloat(item.totalSales).toFixed(2)}
                            </TableCell>
                            {canSeeProfitCost && (
                              <TableCell className={`text-right font-mono font-semibold ${isPositiveProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                ${profit.toFixed(2)}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="border-t pt-4 flex justify-between">
                  {canSeeProfitCost && (
                    <div className="space-y-1">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Cost: </span>
                        <span className="font-mono font-semibold">
                          ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalCost || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Total Profit: </span>
                        <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                          ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.profit || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Sales: </span>
                    <span className="font-mono font-semibold">
                      ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalSales), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No items found for this transaction
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            {isEditMode ? (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleCancelEdit}
                  disabled={saveMutation.isPending}
                  data-testid="button-cancel-edit"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  data-testid="button-save"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSelectedVoucher(null)} data-testid="button-close">
                  Close
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          onClick={handleEdit}
                          disabled={!canEditDaybook}
                          className={!canEditDaybook ? "opacity-50 cursor-not-allowed" : ""}
                          data-testid="button-edit-transaction"
                        >
                          {!canEditDaybook && <Lock className="h-4 w-4 mr-2" />}
                          {canEditDaybook && <Pencil className="h-4 w-4 mr-2" />}
                          Edit Transaction
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {!canEditDaybook && (
                      <TooltipContent>
                        <p>You don't have permission to edit daybook transactions</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
