import { useState, useEffect, Fragment, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, MapPin, Package, Trash2, Check, AlertCircle, ArrowRight, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";

interface LocationData {
  quantity: number;
  rate: number;
  value: number;
}

interface StockItemData {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationData>;
}

interface StockGroupData {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationData>;
  items: StockItemData[];
}

interface LocationSummaryResponse {
  stockGroups: StockGroupData[];
  grandTotals: Record<number, LocationData>;
  asOfDate: string;
}

interface Location {
  id: number;
  name: string;
  code: string;
}

interface OrderItem {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  uom: string;
  sourceLocationId: number;
  sourceLocationName: string;
  quantity: number;
  availableQty: number;
  rate: number;
}

interface QuantityPickerState {
  open: boolean;
  stockItem: StockItemData | null;
  locationId: number;
  locationName: string;
  availableQty: number;
  orderPane: 1 | 2;
}

const STORAGE_KEY = "stockTransferOrder_selectedLocations";

export default function StockTransferOrder() {
  const [_location, navigate] = useLocation();
  const { toast } = useToast();
  
  const [selectedLocationIds, setSelectedLocationIds] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [destinationLocationId, setDestinationLocationId] = useState<number | null>(null);
  
  const [order1Items, setOrder1Items] = useState<OrderItem[]>([]);
  const [order2Items, setOrder2Items] = useState<OrderItem[]>([]);
  
  const [quantityPicker, setQuantityPicker] = useState<QuantityPickerState>({
    open: false,
    stockItem: null,
    locationId: 0,
    locationName: "",
    availableQty: 0,
    orderPane: 1,
  });
  const [pickerQuantity, setPickerQuantity] = useState("");
  
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const quantityInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedLocationIds));
  }, [selectedLocationIds]);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: summaryData, isLoading } = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", { locationIds: selectedLocationIds.join(',') }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedLocationIds.length > 0) {
        params.append('locationIds', selectedLocationIds.join(','));
      }
      const res = await fetch(`/api/location-summary?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch location summary');
      return res.json();
    },
    enabled: selectedLocationIds.length > 0,
  });

  const selectedLocations = selectedLocationIds
    .map(id => locations.find(loc => loc.id === id))
    .filter((loc): loc is Location => loc !== undefined);

  const availableDestinations = locations.filter(
    loc => !selectedLocationIds.includes(loc.id)
  );

  const toggleGroup = (groupId: number) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleLocation = (locationId: number) => {
    setSelectedLocationIds(prev => 
      prev.includes(locationId) 
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const handleCellClick = (
    item: StockItemData,
    locationId: number,
    locationName: string,
    availableQty: number,
    orderPane: 1 | 2
  ) => {
    if (availableQty <= 0) {
      toast({
        title: "No Stock",
        description: `${item.name} has no available stock at ${locationName}`,
        variant: "destructive",
      });
      return;
    }

    setQuantityPicker({
      open: true,
      stockItem: item,
      locationId,
      locationName,
      availableQty,
      orderPane,
    });
    setPickerQuantity("");
    
    setTimeout(() => {
      quantityInputRef.current?.focus();
    }, 100);
  };

  const handleAddToOrder = () => {
    const qty = parseFloat(pickerQuantity);
    
    if (isNaN(qty) || qty <= 0) {
      toast({
        title: "Invalid Quantity",
        description: "Please enter a valid quantity greater than 0",
        variant: "destructive",
      });
      return;
    }

    const { stockItem, locationId, locationName, availableQty, orderPane } = quantityPicker;
    
    if (!stockItem) return;

    const orderItems = orderPane === 1 ? order1Items : order2Items;
    const setOrderItems = orderPane === 1 ? setOrder1Items : setOrder2Items;

    const existingIdx = orderItems.findIndex(
      item => item.stockItemId === stockItem.id && item.sourceLocationId === locationId
    );

    const currentAllocated = existingIdx >= 0 ? orderItems[existingIdx].quantity : 0;
    const totalAfterAdd = currentAllocated + qty;

    if (totalAfterAdd > availableQty) {
      toast({
        title: "Exceeds Available Stock",
        description: `You can only add up to ${formatNumber(availableQty - currentAllocated)} more units. Available: ${formatNumber(availableQty)}, Already in order: ${formatNumber(currentAllocated)}`,
        variant: "destructive",
      });
      return;
    }

    if (existingIdx >= 0) {
      const updated = [...orderItems];
      updated[existingIdx] = {
        ...updated[existingIdx],
        quantity: totalAfterAdd,
      };
      setOrderItems(updated);
    } else {
      const locationData = stockItem.locationData[locationId];
      setOrderItems([
        ...orderItems,
        {
          stockItemId: stockItem.id,
          stockItemName: stockItem.name,
          stockItemCode: stockItem.code,
          uom: stockItem.uom,
          sourceLocationId: locationId,
          sourceLocationName: locationName,
          quantity: qty,
          availableQty,
          rate: locationData?.rate || 0,
        },
      ]);
    }

    setQuantityPicker({ ...quantityPicker, open: false });
    toast({
      title: "Added to Order",
      description: `${formatNumber(qty)} ${stockItem.uom} of ${stockItem.name} added to Order ${orderPane}`,
    });
  };

  const removeFromOrder = (orderPane: 1 | 2, index: number) => {
    if (orderPane === 1) {
      setOrder1Items(order1Items.filter((_, i) => i !== index));
    } else {
      setOrder2Items(order2Items.filter((_, i) => i !== index));
    }
  };

  const validateOrder = (orderItems: OrderItem[]): string[] => {
    const errors: string[] = [];
    
    if (!destinationLocationId) {
      errors.push("Please select a destination location");
    }

    if (orderItems.length === 0) {
      errors.push("Order is empty. Please add items to transfer");
    }

    for (const item of orderItems) {
      if (item.quantity > item.availableQty) {
        errors.push(`${item.stockItemName} from ${item.sourceLocationName}: Requested ${formatNumber(item.quantity)} but only ${formatNumber(item.availableQty)} available`);
      }
      if (item.sourceLocationId === destinationLocationId) {
        errors.push(`${item.stockItemName}: Source and destination cannot be the same location`);
      }
    }

    return errors;
  };

  const handleValidate = (orderPane: 1 | 2) => {
    const orderItems = orderPane === 1 ? order1Items : order2Items;
    const errors = validateOrder(orderItems);
    setValidationErrors(errors);
    
    if (errors.length === 0) {
      toast({
        title: "Validation Passed",
        description: `Order ${orderPane} is ready to process`,
      });
    } else {
      toast({
        title: "Validation Failed",
        description: `Found ${errors.length} issue(s) that need to be fixed`,
        variant: "destructive",
      });
    }
  };

  const processOrderMutation = useMutation({
    mutationFn: async (data: { orderItems: OrderItem[]; destinationLocationId: number }) => {
      const groupedBySource: Record<number, OrderItem[]> = {};
      
      for (const item of data.orderItems) {
        if (!groupedBySource[item.sourceLocationId]) {
          groupedBySource[item.sourceLocationId] = [];
        }
        groupedBySource[item.sourceLocationId].push(item);
      }

      const results = [];
      for (const [sourceId, items] of Object.entries(groupedBySource)) {
        const response = await apiRequest("POST", "/api/stock-transfers", {
          sourceLocationId: parseInt(sourceId),
          destinationLocationId: data.destinationLocationId,
          notes: `Stock Transfer Order - ${items.length} items`,
          items: items.map(item => ({
            stockItemId: item.stockItemId,
            quantity: item.quantity.toString(),
          })),
        });
        results.push(await response.json());
      }
      
      return results;
    },
    onSuccess: (results) => {
      toast({
        title: "Order Processed",
        description: `Successfully created ${results.length} stock transfer voucher(s)`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-by-location"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-summary"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to process order",
        variant: "destructive",
      });
    },
  });

  const handleProcessOrder = async (orderPane: 1 | 2) => {
    const orderItems = orderPane === 1 ? order1Items : order2Items;
    const setOrderItems = orderPane === 1 ? setOrder1Items : setOrder2Items;
    
    const errors = validateOrder(orderItems);
    if (errors.length > 0) {
      setValidationErrors(errors);
      toast({
        title: "Cannot Process",
        description: "Please fix validation errors first",
        variant: "destructive",
      });
      return;
    }

    if (!destinationLocationId) return;

    setIsProcessing(true);
    try {
      await processOrderMutation.mutateAsync({
        orderItems,
        destinationLocationId,
      });
      setOrderItems([]);
      setValidationErrors([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const getOrderTotal = (orderItems: OrderItem[]) => {
    return orderItems.reduce((sum, item) => sum + item.quantity, 0);
  };

  const renderOrderPane = (orderPane: 1 | 2, items: OrderItem[]) => {
    const total = getOrderTotal(items);
    
    return (
      <Card className="flex-1">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Order {orderPane}</CardTitle>
            <Badge variant="secondary">{items.length} items</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Click on quantities in the matrix to add items</p>
            </div>
          ) : (
            <>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div
                      key={`${item.stockItemId}-${item.sourceLocationId}`}
                      className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                      data-testid={`order-${orderPane}-item-${index}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.stockItemName}</p>
                        <p className="text-xs text-muted-foreground">
                          From: {item.sourceLocationName} | {formatNumber(item.quantity)} {item.uom}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFromOrder(orderPane, index)}
                        data-testid={`button-remove-order-${orderPane}-item-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              
              <div className="pt-2 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Qty:</span>
                  <span className="font-mono font-medium">{formatNumber(total)}</span>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleValidate(orderPane)}
                    className="flex-1"
                    data-testid={`button-validate-order-${orderPane}`}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Validate
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleProcessOrder(orderPane)}
                    disabled={isProcessing || !destinationLocationId}
                    className="flex-1"
                    data-testid={`button-process-order-${orderPane}`}
                  >
                    {isProcessing ? "Processing..." : "Process"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-stock-transfer-order">
            Stock Transfer Order
          </h1>
          <p className="text-muted-foreground text-sm">
            Build orders by selecting items from multiple source locations
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Destination:</Label>
            <Select
              value={destinationLocationId?.toString() || ""}
              onValueChange={(v) => setDestinationLocationId(parseInt(v))}
            >
              <SelectTrigger className="w-[200px]" data-testid="select-destination">
                <SelectValue placeholder="Choose destination" />
              </SelectTrigger>
              <SelectContent>
                {availableDestinations.map((loc) => (
                  <SelectItem 
                    key={loc.id} 
                    value={loc.id.toString()}
                    data-testid={`select-destination-option-${loc.id}`}
                  >
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
            <Button 
              variant="outline" 
              onClick={() => setLocationDialogOpen(true)}
              data-testid="button-select-sources"
            >
              <Settings2 className="h-4 w-4 mr-2" />
              Source Locations ({selectedLocations.length})
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Select Source Locations</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {locations.map((loc) => (
                  <div
                    key={loc.id}
                    className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                    onClick={() => toggleLocation(loc.id)}
                    data-testid={`location-checkbox-${loc.id}`}
                  >
                    <Checkbox
                      checked={selectedLocationIds.includes(loc.id)}
                      onCheckedChange={() => toggleLocation(loc.id)}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{loc.name}</p>
                      <p className="text-xs text-muted-foreground">{loc.code}</p>
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setLocationDialogOpen(false)}>Done</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Validation Errors</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {validationErrors.map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <Card className="flex-[2]">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <CardTitle className="text-base">Inventory Matrix</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {selectedLocations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Select source locations to view inventory</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setLocationDialogOpen(true)}
                >
                  Select Locations
                </Button>
              </div>
            ) : isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="min-w-[200px] sticky left-0 bg-background z-20">
                        Item
                      </TableHead>
                      {selectedLocations.map((loc) => (
                        <TableHead
                          key={loc.id}
                          className="text-center min-w-[120px]"
                          colSpan={2}
                        >
                          {loc.name}
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-20"></TableHead>
                      {selectedLocations.map((loc) => (
                        <Fragment key={loc.id}>
                          <TableHead className="text-center text-xs">Order 1</TableHead>
                          <TableHead className="text-center text-xs">Order 2</TableHead>
                        </Fragment>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryData?.stockGroups.map((group) => (
                      <Fragment key={group.id}>
                        <TableRow
                          className="cursor-pointer hover-elevate bg-muted/30"
                          onClick={() => toggleGroup(group.id)}
                          data-testid={`group-row-${group.id}`}
                        >
                          <TableCell className="font-medium sticky left-0 bg-muted/30 z-10">
                            <div className="flex items-center gap-2">
                              {expandedGroups.has(group.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              {group.name}
                              <Badge variant="secondary" className="text-xs">
                                {group.items.length}
                              </Badge>
                            </div>
                          </TableCell>
                          {selectedLocations.map((loc) => {
                            const locData = group.locationData[loc.id];
                            const qty = locData?.quantity || 0;
                            return (
                              <Fragment key={loc.id}>
                                <TableCell className="text-center font-mono text-sm">
                                  {qty > 0 ? formatNumber(qty, 0) : "-"}
                                </TableCell>
                                <TableCell className="text-center font-mono text-sm">
                                  {qty > 0 ? formatNumber(qty, 0) : "-"}
                                </TableCell>
                              </Fragment>
                            );
                          })}
                        </TableRow>

                        {expandedGroups.has(group.id) &&
                          [...group.items]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((item) => (
                              <TableRow key={item.id} data-testid={`item-row-${item.id}`}>
                                <TableCell className="pl-8 sticky left-0 bg-background z-10">
                                  <div>
                                    <p className="text-sm">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">{item.code}</p>
                                  </div>
                                </TableCell>
                                {selectedLocations.map((loc) => {
                                  const locData = item.locationData[loc.id];
                                  const qty = locData?.quantity || 0;
                                  const hasStock = qty > 0;
                                  
                                  return (
                                    <Fragment key={loc.id}>
                                      <TableCell className="p-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className={cn(
                                            "w-full font-mono",
                                            hasStock && "hover:bg-primary/10 cursor-pointer"
                                          )}
                                          disabled={!hasStock}
                                          onClick={() =>
                                            handleCellClick(item, loc.id, loc.name, qty, 1)
                                          }
                                          data-testid={`cell-item-${item.id}-loc-${loc.id}-order-1`}
                                        >
                                          {hasStock ? formatNumber(qty, 0) : "-"}
                                        </Button>
                                      </TableCell>
                                      <TableCell className="p-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className={cn(
                                            "w-full font-mono",
                                            hasStock && "hover:bg-secondary/50 cursor-pointer"
                                          )}
                                          disabled={!hasStock}
                                          onClick={() =>
                                            handleCellClick(item, loc.id, loc.name, qty, 2)
                                          }
                                          data-testid={`cell-item-${item.id}-loc-${loc.id}-order-2`}
                                        >
                                          {hasStock ? formatNumber(qty, 0) : "-"}
                                        </Button>
                                      </TableCell>
                                    </Fragment>
                                  );
                                })}
                              </TableRow>
                            ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 flex flex-col gap-4 min-w-[300px]">
          {destinationLocationId && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-sm">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Sending to:</span>
                  <span className="font-medium">
                    {locations.find(l => l.id === destinationLocationId)?.name}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          
          {renderOrderPane(1, order1Items)}
          {renderOrderPane(2, order2Items)}
        </div>
      </div>

      <Dialog
        open={quantityPicker.open}
        onOpenChange={(open) => setQuantityPicker({ ...quantityPicker, open })}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add to Order {quantityPicker.orderPane}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <p className="font-medium">{quantityPicker.stockItem?.name}</p>
              <p className="text-sm text-muted-foreground">
                From: {quantityPicker.locationName}
              </p>
              <p className="text-sm text-muted-foreground">
                Available: <span className="font-mono">{formatNumber(quantityPicker.availableQty)}</span>{" "}
                {quantityPicker.stockItem?.uom}
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="picker-quantity">Quantity to transfer</Label>
              <Input
                id="picker-quantity"
                ref={quantityInputRef}
                type="number"
                min="0.001"
                step="0.001"
                max={quantityPicker.availableQty}
                value={pickerQuantity}
                onChange={(e) => setPickerQuantity(e.target.value)}
                placeholder="Enter quantity"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddToOrder();
                  }
                }}
                data-testid="input-picker-quantity"
              />
              {parseFloat(pickerQuantity) > quantityPicker.availableQty && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Exceeds available stock
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuantityPicker({ ...quantityPicker, open: false })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddToOrder}
              disabled={
                !pickerQuantity ||
                parseFloat(pickerQuantity) <= 0 ||
                parseFloat(pickerQuantity) > quantityPicker.availableQty
              }
              data-testid="button-confirm-add"
            >
              Add to Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
