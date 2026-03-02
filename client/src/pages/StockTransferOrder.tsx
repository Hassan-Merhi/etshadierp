import { useState, useEffect, Fragment, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
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
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
import { ChevronDown, ChevronRight, MapPin, Package, Trash2, Check, AlertCircle, ArrowRight, Settings2, CalendarIcon, FileDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { utils, writeFile } from "@/lib/excelHelper";
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
  
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  
  const [quantityPicker, setQuantityPicker] = useState<QuantityPickerState>({
    open: false,
    stockItem: null,
    locationId: 0,
    locationName: "",
    availableQty: 0,
  });
  const [pickerQuantity, setPickerQuantity] = useState("");
  
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transferDate, setTransferDate] = useState<Date>(new Date());
  const [isOptional, setIsOptional] = useState(false);
  
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const matrixRef = useRef<HTMLDivElement>(null);
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const prevDialogOpen = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedLocationIds));
  }, [selectedLocationIds]);

  useEffect(() => {
    if (prevDialogOpen.current && !quantityPicker.open) {
      requestAnimationFrame(() => {
        matrixRef.current?.focus({ preventScroll: true });
      });
    }
    prevDialogOpen.current = quantityPicker.open;
  }, [quantityPicker.open]);

  useEffect(() => {
    if (focusedCell === null) return;
    const el = matrixRef.current?.querySelector('[data-focused="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedCell]);

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

  const availableDestinations = locations;

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

  const sortOrderItems = (items: OrderItem[]): OrderItem[] => {
    return [...items].sort((a, b) => a.sourceLocationName.localeCompare(b.sourceLocationName));
  };

  const flatItems = summaryData?.stockGroups.flatMap((group) => 
    expandedGroups.has(group.id) 
      ? [...group.items].sort((a, b) => a.name.localeCompare(b.name))
      : []
  ) || [];

  const openQuantityPicker = useCallback((
    item: StockItemData,
    locationId: number,
    locationName: string,
    availableQty: number
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
    });
    setPickerQuantity("");
    
    setTimeout(() => {
      quantityInputRef.current?.focus();
    }, 100);
  }, [toast]);

  const handleMatrixKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (quantityPicker.open) return;
    if (flatItems.length === 0 || selectedLocations.length === 0) return;

    const { key } = e;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) return;

    e.preventDefault();

    setFocusedCell((current) => {
      const maxRow = flatItems.length - 1;
      const maxCol = selectedLocations.length - 1;

      if (current === null) {
        return { row: 0, col: 0 };
      }

      let { row, col } = current;

      switch (key) {
        case 'ArrowUp':
          row = Math.max(0, row - 1);
          break;
        case 'ArrowDown':
          row = Math.min(maxRow, row + 1);
          break;
        case 'ArrowLeft':
          col = Math.max(0, col - 1);
          break;
        case 'ArrowRight':
          col = Math.min(maxCol, col + 1);
          break;
        case ' ':
          const item = flatItems[row];
          const loc = selectedLocations[col];
          if (item && loc) {
            const locData = item.locationData[loc.id];
            const qty = locData?.quantity || 0;
            if (qty > 0) {
              openQuantityPicker(item, loc.id, loc.name, qty);
            }
          }
          return current;
      }

      return { row, col };
    });
  }, [flatItems, selectedLocations, quantityPicker.open, openQuantityPicker]);

  const handleCellClick = (
    item: StockItemData,
    locationId: number,
    locationName: string,
    availableQty: number
  ) => {
    openQuantityPicker(item, locationId, locationName, availableQty);
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

    const { stockItem, locationId, locationName, availableQty } = quantityPicker;
    
    if (!stockItem) return;

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

    let updatedItems: OrderItem[];
    if (existingIdx >= 0) {
      updatedItems = [...orderItems];
      updatedItems[existingIdx] = {
        ...updatedItems[existingIdx],
        quantity: totalAfterAdd,
      };
    } else {
      const locationData = stockItem.locationData[locationId];
      updatedItems = [
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
      ];
    }

    setOrderItems(sortOrderItems(updatedItems));
    setQuantityPicker({ ...quantityPicker, open: false });
    toast({
      title: "Added to Order",
      description: `${formatNumber(qty)} ${stockItem.uom} of ${stockItem.name} added`,
    });
  };

  const removeFromOrder = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const validateOrder = (): string[] => {
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

  const handleValidate = () => {
    const errors = validateOrder();
    setValidationErrors(errors);
    
    if (errors.length === 0) {
      toast({
        title: "Validation Passed",
        description: "Order is ready to process",
      });
    } else {
      toast({
        title: "Validation Failed",
        description: `Found ${errors.length} issue(s) that need to be fixed`,
        variant: "destructive",
      });
    }
  };

  const handleExportOrder = (detailed: boolean) => {
    if (orderItems.length === 0) {
      toast({
        title: "No data to export",
        description: "Add items to the order before exporting.",
        variant: "destructive",
      });
      return;
    }
    
    const destLocation = locations.find(l => l.id === destinationLocationId);
    const exportDate = format(transferDate, "yyyy-MM-dd");
    
    if (detailed) {
      const exportData = orderItems.map((item) => ({
        "Date": exportDate,
        "Source Location": item.sourceLocationName,
        "Destination Location": destLocation?.name || "",
        "Stock Item Code": item.stockItemCode,
        "Stock Item Name": item.stockItemName,
        "UOM": item.uom,
        "Quantity": item.quantity,
        "Available Qty": item.availableQty,
        "Rate": item.rate.toFixed(2),
        "Amount": (item.quantity * item.rate).toFixed(2),
      }));
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Transfer Order Detailed");
      const fileName = `Stock_Transfer_Order_Detailed_${exportDate}.xlsx`;
      writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${orderItems.length} items.`,
      });
    } else {
      const totalAmount = orderItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
      const exportData = [{
        "Date": exportDate,
        "Destination Location": destLocation?.name || "",
        "Total Items": orderItems.length,
        "Total Quantity": totalBales,
        "Total Amount": totalAmount.toFixed(2),
        "Optional": isOptional ? "Yes" : "No",
      }];
      
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Transfer Order Summary");
      const fileName = `Stock_Transfer_Order_Summary_${exportDate}.xlsx`;
      writeFile(workbook, fileName);
      
      toast({
        title: "Export successful",
        description: `Downloaded ${fileName}.`,
      });
    }
  };

  const processOrderMutation = useMutation({
    mutationFn: async (data: { orderItems: OrderItem[]; destinationLocationId: number; voucherDate: string; optional: boolean }) => {
      const response = await apiRequest("POST", "/api/stock-transfers", {
        destinationLocationId: data.destinationLocationId,
        notes: `Stock Transfer Order - ${data.orderItems.length} items`,
        voucherDate: data.voucherDate,
        optional: data.optional,
        items: data.orderItems.map(item => ({
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity.toString(),
        })),
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Processed",
        description: "Successfully created stock transfer voucher",
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

  const handleProcessOrder = async () => {
    const errors = validateOrder();
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
        voucherDate: format(transferDate, "yyyy-MM-dd"),
        optional: isOptional,
      });
      setOrderItems([]);
      setValidationErrors([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const totalBales = orderItems.reduce((sum, item) => sum + item.quantity, 0);

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
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Destination:</Label>
            <Select
              value={destinationLocationId?.toString() || ""}
              onValueChange={(v) => setDestinationLocationId(parseInt(v))}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-destination">
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
          
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full sm:w-[140px] justify-start text-left font-normal",
                  !transferDate && "text-muted-foreground"
                )}
                data-testid="button-select-date"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {transferDate ? format(transferDate, "MMM dd, yyyy") : "Pick date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={transferDate}
                onSelect={(date) => date && setTransferDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          
          <div className="flex items-center gap-2">
            <Switch
              id="optional-mode"
              checked={isOptional}
              onCheckedChange={setIsOptional}
              data-testid="switch-optional"
            />
            <Label htmlFor="optional-mode" className="text-sm cursor-pointer">
              Optional
            </Label>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={orderItems.length === 0}
                data-testid="button-export-order"
              >
                <FileDown className="h-4 w-4 mr-1" />
                Export
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportOrder(false)} data-testid="export-order-summary">
                Summary Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOrder(true)} data-testid="export-order-detailed">
                Detailed Export
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <div className="flex flex-col lg:flex-row gap-4">
        <Card className="lg:flex-[3]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                <CardTitle className="text-base">Inventory Matrix</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground">Click to focus, then use arrow keys + spacebar</p>
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
              <div 
                ref={matrixRef}
                tabIndex={0}
                onKeyDown={handleMatrixKeyDown}
                className="overflow-auto max-h-[500px] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md border"
              >
                <table className="w-full caption-bottom text-sm border-collapse">
                  <thead className="[&_tr]:border-b">
                    <tr className="border-b">
                      <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px] sticky top-0 left-0 bg-muted z-50 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                        Item
                      </th>
                      {selectedLocations.map((loc) => (
                        <th
                          key={loc.id}
                          className="h-12 px-4 text-center align-middle font-medium text-muted-foreground min-w-[100px] sticky top-0 bg-muted z-40"
                        >
                          {loc.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0">
                    {summaryData?.stockGroups.map((group) => (
                      <Fragment key={group.id}>
                        <tr
                          className="border-b transition-colors cursor-pointer hover-elevate bg-muted/50"
                          onClick={() => toggleGroup(group.id)}
                          data-testid={`group-row-${group.id}`}
                        >
                          <td className="p-4 align-middle font-medium sticky left-0 bg-muted/50 z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
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
                          </td>
                          {selectedLocations.map((loc) => {
                            const locData = group.locationData[loc.id];
                            const qty = locData?.quantity || 0;
                            return (
                              <td key={loc.id} className="p-4 align-middle text-center font-mono text-sm">
                                {qty > 0 ? formatNumber(qty, 0) : "-"}
                              </td>
                            );
                          })}
                        </tr>

                        {expandedGroups.has(group.id) &&
                          [...group.items]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((item) => {
                              const flatRowIndex = flatItems.findIndex(fi => fi.id === item.id);
                              return (
                              <tr key={item.id} data-testid={`item-row-${item.id}`} className="border-b transition-colors hover:bg-muted/50 bg-background">
                                <td className="p-4 align-middle pl-8 sticky left-0 bg-background z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                                  <p className="text-sm">{item.name}</p>
                                </td>
                                {selectedLocations.map((loc, colIndex) => {
                                  const locData = item.locationData[loc.id];
                                  const qty = locData?.quantity || 0;
                                  const hasStock = qty > 0;
                                  const isFocused = focusedCell?.row === flatRowIndex && focusedCell?.col === colIndex;
                                  
                                  return (
                                    <td key={loc.id} className="p-1 align-middle" data-focused={isFocused ? "true" : undefined}>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className={cn(
                                          "w-full font-mono",
                                          hasStock && "hover:bg-primary/10 cursor-pointer",
                                          isFocused && "ring-2 ring-primary ring-offset-1"
                                        )}
                                        disabled={!hasStock}
                                        onClick={() => {
                                          setFocusedCell({ row: flatRowIndex, col: colIndex });
                                          handleCellClick(item, loc.id, loc.name, qty);
                                        }}
                                        data-testid={`cell-item-${item.id}-loc-${loc.id}`}
                                      >
                                        {hasStock ? formatNumber(qty, 0) : "-"}
                                      </Button>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                            })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex-1 flex flex-col gap-4 lg:min-w-[300px]">
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
          
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Transfer Order</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{orderItems.length} items</Badge>
                  <Badge variant="default" className="font-mono">
                    {formatNumber(totalBales, 0)} bales
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Click on quantities or use arrow keys + spacebar</p>
                </div>
              ) : (
                <>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {orderItems.map((item, index) => (
                        <div
                          key={`${item.stockItemId}-${item.sourceLocationId}`}
                          className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                          data-testid={`order-item-${index}`}
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
                            onClick={() => removeFromOrder(index)}
                            data-testid={`button-remove-order-item-${index}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  
                  <div className="pt-2 border-t space-y-3">
                    <div className="flex justify-between text-sm font-medium">
                      <span>Total Bales:</span>
                      <span className="font-mono text-lg">{formatNumber(totalBales, 0)}</span>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleValidate}
                        className="flex-1"
                        data-testid="button-validate-order"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Validate
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleProcessOrder}
                        disabled={isProcessing || !destinationLocationId}
                        className="flex-1"
                        data-testid="button-process-order"
                      >
                        {isProcessing ? "Processing..." : "Process"}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={quantityPicker.open}
        onOpenChange={(open) => setQuantityPicker({ ...quantityPicker, open })}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add to Order</DialogTitle>
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
