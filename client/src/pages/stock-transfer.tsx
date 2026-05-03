import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatNumber } from "@/lib/formatNumber";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import { X, Plus, Package, ArrowRight, Eye, Trash2, Upload, Search, AlertCircle, FileDown, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { utils, writeFile } from "@/lib/excelHelper";
import { Link } from "wouter";

interface StockTransferPageProps {
  posUser?: any;
}

interface TransferEntry {
  stockItemId: number;
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
  }>;
}

export default function StockTransferPage({ posUser }: StockTransferPageProps) {
  const { toast } = useToast();
  const [_location, navigate] = useLocation();
  const isPOS = !!posUser;
  
  const posSourceLocation = isPOS ? posUser?.assignedLocationId : null;
  
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(posSourceLocation);
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<TransferEntry[]>([
    { stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0 }
  ]);
  
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingTransfer, setViewingTransfer] = useState<StockTransferVoucher | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const itemListRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<{ [key: number]: HTMLInputElement }>({});

  const [zeroStockAlert, setZeroStockAlert] = useState(false);
  const [zeroStockItem, setZeroStockItem] = useState("");

  const [negativeStockWarning, setNegativeStockWarning] = useState(false);
  const [negativeStockItems, setNegativeStockItems] = useState<Array<{ name: string; available: number; requested: number }>>([]);

  useEffect(() => {
    if (isPOS && posUser?.assignedLocationId) {
      setSelectedSourceLocation(posUser.assignedLocationId);
    }
  }, [isPOS, posUser?.assignedLocationId]);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: stockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
  });

  const activeSourceLocation = isPOS ? (posUser?.assignedLocationId || selectedSourceLocation) : selectedSourceLocation;

  const { data: inventoryItems = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory-by-location", activeSourceLocation],
    queryFn: async () => {
      if (!activeSourceLocation || activeSourceLocation <= 0) return [];
      const res = await fetch(`/api/inventory-by-location/${activeSourceLocation}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to fetch inventory");
      }
      return res.json();
    },
    enabled: activeSourceLocation !== null && activeSourceLocation > 0,
  });

  const { data: vouchers = [] } = useQuery<any[]>({
    queryKey: ["/api/vouchers"],
  });

  // All stock transfer vouchers for export
  const allStockTransferVouchers = vouchers
    .filter((v: any) => v.voucherType === "Stock Transfer" || v.voucherType === "StockTransfer");
  
  // Limited list for UI display (last 20)
  const stockTransferVouchers = allStockTransferVouchers.slice(0, 20);

  const createTransferMutation = useMutation({
    mutationFn: async (data: { notes: string; items: TransferEntry[] }) => {
      const response = await apiRequest("POST", "/api/stock-transfers", {
        sourceLocationId: activeSourceLocation,
        destinationLocationId: selectedDestLocation,
        notes: data.notes || "",
        items: (Array.isArray(data.items) ? data.items : []).map((item) => ({
          stockItemId: item.stockItemId,
          quantity: item.quantity,
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
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = async () => {
    setSelectedDestLocation(null);
    setNotes("");
    setEntries([{ stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0 }]);
    setSearchTerm("");
    setActiveRowIndex(null);
    if (!isPOS) {
      setSelectedSourceLocation(null);
    }
  };

  const getAvailableQty = (stockItemId: number): number => {
    const invItem = inventoryItems.find(i => i.stockItemId === stockItemId);
    return invItem ? parseFloat(invItem.quantity) : 0;
  };

  const handleItemChange = async (index: number, stockItemId: number, stockItemName: string) => {
    const availableQty = getAvailableQty(stockItemId);
    
    if (stockItemId > 0 && availableQty === 0) {
      setZeroStockItem(stockItemName);
      setZeroStockAlert(true);
      return;
    }
    
    const newEntries = [...entries];
    newEntries[index] = {
      ...newEntries[index],
      stockItemId,
      stockItemName,
      availableQty,
    };
    setEntries(newEntries);
    setActiveRowIndex(null);
    setSearchTerm("");
    
    setTimeout(() => {
      const qtyInput = document.querySelector(`[data-testid="input-quantity-${index}"]`) as HTMLInputElement;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 50);
  };

  const handleQuantityChange = async (index: number, quantity: string) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], quantity };
    setEntries(newEntries);
  };

  const handleItemNameChange = async (index: number, value: string) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], stockItemName: value, stockItemId: 0, availableQty: 0 };
    setEntries(newEntries);
    setSearchTerm(value);
    setHighlightedIndex(0);
  };

  const handleItemInputFocus = async (index: number) => {
    setActiveRowIndex(index);
    setSearchTerm(entries[index].stockItemName || "");
    setHighlightedIndex(0);
  };

  const handleItemInputBlur = async () => {
    setTimeout(() => {
      setActiveRowIndex(null);
    }, 200);
  };

  const addNewRow = async () => {
    setEntries([...entries, { stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0 }]);
  };

  const removeRow = async (index: number) => {
    if (entries.length > 1) {
      setEntries(entries.filter((_, i) => i !== index));
    }
  };

  const getFilteredInventory = () => {
    if (!searchTerm.trim()) {
      return inventoryItems.map(inv => {
        const stockItem = stockItems.find((si: any) => si.id === inv.stockItemId);
        return {
          stockItemId: inv.stockItemId,
          name: inv.stockItemName || stockItem?.name || "",
          code: inv.stockItemCode || stockItem?.code || "",
          stock: parseFloat(inv.quantity),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    
    const term = searchTerm.toLowerCase();
    return inventoryItems
      .filter(inv => {
        const name = inv.stockItemName?.toLowerCase() || "";
        const code = inv.stockItemCode?.toLowerCase() || "";
        return name.includes(term) || code.includes(term);
      })
      .map(inv => {
        const stockItem = stockItems.find((si: any) => si.id === inv.stockItemId);
        return {
          stockItemId: inv.stockItemId,
          name: inv.stockItemName || stockItem?.name || "",
          code: inv.stockItemCode || stockItem?.code || "",
          stock: parseFloat(inv.quantity),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const selectItem = async (item: { stockItemId: number; name: string; code: string; stock: number }) => {
    if (activeRowIndex === null) return;
    
    if (item.stock === 0) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }
    
    handleItemChange(activeRowIndex, item.stockItemId, item.name);
  };

  const handleItemKeyDown = async (e: React.KeyboardEvent, index: number) => {
    const filteredItems = getFilteredInventory();
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[highlightedIndex]) {
        selectItem(filteredItems[highlightedIndex]);
      }
    } else if (e.key === "Tab" && !e.shiftKey && entries[index].stockItemId > 0) {
      const qtyInput = document.querySelector(`[data-testid="input-quantity-${index}"]`) as HTMLInputElement;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }
  };

  useEffect(() => {
    if (itemListRef.current && activeRowIndex !== null) {
      const highlightedElement = itemListRef.current.children[0]?.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [highlightedIndex, activeRowIndex]);

  const validateAndSubmit = async (skipWarning = false) => {
    if (!activeSourceLocation || !selectedDestLocation) {
      toast({ title: "Error", description: "Please select source and destination locations", variant: "destructive" });
      return;
    }

    if (activeSourceLocation === selectedDestLocation) {
      toast({ title: "Error", description: "Source and destination must be different", variant: "destructive" });
      return;
    }

    const validEntries = entries.filter(e => e.stockItemId > 0 && parseFloat(e.quantity || "0") > 0);
    
    if (validEntries.length === 0) {
      toast({ title: "Error", description: "Please add at least one item with quantity", variant: "destructive" });
      return;
    }

    const itemsWithNegativeStock: Array<{ name: string; available: number; requested: number }> = [];
    
    for (const entry of validEntries) {
      const transferQty = parseFloat(entry.quantity || "0");
      
      if (entry.availableQty === 0) {
        toast({ 
          title: "Error", 
          description: `${entry.stockItemName} has 0 stock available and cannot be transferred.`, 
          variant: "destructive" 
        });
        return;
      }
      
      if (transferQty > entry.availableQty) {
        itemsWithNegativeStock.push({
          name: entry.stockItemName,
          available: entry.availableQty,
          requested: transferQty,
        });
      }
    }

    if (itemsWithNegativeStock.length > 0 && !skipWarning) {
      setNegativeStockItems(itemsWithNegativeStock);
      setNegativeStockWarning(true);
      return;
    }

    createTransferMutation.mutate({
      notes,
      items: validEntries,
    });
  };

  const handleSubmit = async () => {
    validateAndSubmit(false);
  };

  const handleProceedWithNegative = async () => {
    setNegativeStockWarning(false);
    validateAndSubmit(true);
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

  const handleExportToExcel = async () => {
    if (allStockTransferVouchers.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no stock transfers to export.",
        variant: "destructive",
      });
      return;
    }

    const exportData = allStockTransferVouchers.map((voucher: any) => ({
      "Voucher Number": voucher.voucherNumber,
      "Date": format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
      "Description": voucher.description || "",
      "Total Amount": voucher.totalAmount,
    }));

    const worksheet = utils.json_to_sheet(exportData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Stock Transfers");

    const fileName = `Stock_Transfers_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);

    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${allStockTransferVouchers.length} records.`,
    });
  };
  
  const [isExportingDetailed, setIsExportingDetailed] = useState(false);
  
  const handleExportDetailedToExcel = async () => {
    if (allStockTransferVouchers.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no stock transfers to export.",
        variant: "destructive",
      });
      return;
    }
    
    setIsExportingDetailed(true);
    
    try {
      const detailedData: Array<{
        "Voucher Number": string;
        "Date": string;
        "Description": string;
        "Source Location": string;
        "Destination Location": string;
        "Item Code": string;
        "Item Name": string;
        "Quantity": string;
      }> = [];
      
      // Fetch details for each voucher
      for (const voucher of allStockTransferVouchers) {
        try {
          const res = await fetch(`/api/stock-transfers?voucherId=${voucher.id}`);
          if (res.ok) {
            const data = await res.json();
            const transfer = Array.isArray(data) ? data[0] : data;
            
            const sourceLocation = locations.find((l: any) => l.id === transfer?.sourceLocationId);
            const destLocation = locations.find((l: any) => l.id === transfer?.destinationLocationId);
            
            if (transfer?.items && transfer.items.length > 0) {
              for (const item of transfer.items) {
                detailedData.push({
                  "Voucher Number": voucher.voucherNumber,
                  "Date": format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
                  "Description": voucher.description || "",
                  "Source Location": item.sourceLocationName || sourceLocation?.name || "Unknown",
                  "Destination Location": destLocation?.name || "Unknown",
                  "Item Code": item.stockItemCode || "",
                  "Item Name": item.stockItemName || `Item ${item.stockItemId}`,
                  "Quantity": formatNumber(parseFloat(item.quantity || "0"), 0),
                });
              }
            } else {
              detailedData.push({
                "Voucher Number": voucher.voucherNumber,
                "Date": format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
                "Description": voucher.description || "",
                "Source Location": sourceLocation?.name || "Unknown",
                "Destination Location": destLocation?.name || "Unknown",
                "Item Code": "",
                "Item Name": "",
                "Quantity": "",
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching transfer ${voucher.id}:`, error);
        }
      }
      
      if (detailedData.length === 0) {
        toast({
          title: "No data to export",
          description: "Could not fetch transfer details.",
          variant: "destructive",
        });
        return;
      }
      
      const worksheet = utils.json_to_sheet(detailedData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Transfers Detailed");
      
      // Auto-size columns
      const colWidths = [
        { wch: 15 }, // Voucher Number
        { wch: 12 }, // Date
        { wch: 30 }, // Description
        { wch: 20 }, // Source Location
        { wch: 20 }, // Destination Location
        { wch: 15 }, // Item Code
        { wch: 30 }, // Item Name
        { wch: 12 }, // Quantity
      ];
      worksheet["!cols"] = colWidths;

      const fileName = `Stock_Transfers_Detailed_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      await writeFile(workbook, fileName);

      toast({
        title: "Export successful",
        description: `Downloaded ${fileName} with ${detailedData.length} items from ${allStockTransferVouchers.length} transfers.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "An error occurred while exporting.",
        variant: "destructive",
      });
    } finally {
      setIsExportingDetailed(false);
    }
  };

  const sourceLocationName = locations.find((l: any) => l.id === activeSourceLocation)?.name;
  const filteredItems = getFilteredInventory();

  const calculateTotal = () => {
    return entries.reduce((sum, entry) => {
      const qty = parseFloat(entry.quantity || "0");
      return sum + (isNaN(qty) ? 0 : qty);
    }, 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="heading-stock-transfer">Stock Transfer</h1>
          <p className="text-muted-foreground">
            {isPOS ? `Transfer stock from your location to another` : `Transfer stock between locations`}
          </p>
        </div>
        <Link href="/stock-transfer-import">
          <Button variant="outline" data-testid="button-import-from-excel">
            <Upload className="h-4 w-4 mr-2" />
            Import from Excel
          </Button>
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <Card className="flex-1">
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
                      setEntries([{ stockItemId: 0, stockItemName: "", quantity: "", availableQty: 0 }]);
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
                      .filter((loc: any) => loc.id !== activeSourceLocation)
                      .map((loc: any) => (
                        <SelectItem key={loc.id} value={loc.id.toString()}>
                          {loc.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {activeSourceLocation && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Items to Transfer</Label>
                  {inventoryLoading && <Skeleton className="h-4 w-24" />}
                </div>
                
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50%]">Item Name (type to search)</TableHead>
                        <TableHead className="text-right w-32">Quantity</TableHead>
                        <TableHead className="text-right w-32">Available</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry, index) => (
                        <TableRow key={index} data-testid={`transfer-entry-row-${index}`}>
                          <TableCell>
                            <Input
                              ref={(el) => {
                                if (el) inputRefs.current[index] = el;
                              }}
                              type="text"
                              value={entry.stockItemName}
                              onChange={(e) => handleItemNameChange(index, e.target.value)}
                              onFocus={() => handleItemInputFocus(index)}
                              onBlur={handleItemInputBlur}
                              onKeyDown={(e) => handleItemKeyDown(e, index)}
                              placeholder="Type to search..."
                              className="w-full"
                              data-testid={`input-item-${index}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={entry.quantity}
                              onChange={(e) => handleQuantityChange(index, e.target.value)}
                              className="w-24 text-right ml-auto"
                              placeholder="0"
                              data-testid={`input-quantity-${index}`}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {entry.stockItemId > 0 ? formatNumber(entry.availableQty, 0) : "-"}
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
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between">
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
                  <div className="text-sm text-muted-foreground">
                    Total Qty: <span className="font-mono font-medium">{formatNumber(calculateTotal())}</span>
                  </div>
                </div>
              </div>
            )}

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
              disabled={createTransferMutation.isPending || !activeSourceLocation || !selectedDestLocation} 
              className="w-full"
              data-testid="button-submit-transfer"
            >
              {createTransferMutation.isPending ? "Processing..." : "Create Transfer"}
            </Button>
          </CardContent>
        </Card>

        {activeSourceLocation && (
          <Card className="w-full lg:w-80 flex flex-col sticky top-4 max-h-[calc(100vh-12rem)] self-start">
            <div className="p-4 border-b">
              <h3 className="text-sm font-semibold mb-3">Search Items</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or code..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setHighlightedIndex(0);
                  }}
                  className="pl-9"
                  data-testid="input-sidebar-search"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2" ref={itemListRef}>
              <div className="space-y-1">
                {filteredItems.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {inventoryLoading ? "Loading..." : "No items found"}
                  </div>
                ) : (
                  filteredItems.map((item, idx) => (
                    <button
                      key={item.stockItemId}
                      onClick={() => selectItem(item)}
                      className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                        item.stock === 0 ? "opacity-60" : ""
                      } ${idx === highlightedIndex && activeRowIndex !== null ? "bg-accent" : ""}`}
                      data-testid={`sidebar-item-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium mb-1 truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {item.code}
                          </div>
                        </div>
                        <div className="flex items-center">
                          <div className={`text-xs font-medium px-2 py-0.5 rounded ${
                            item.stock === 0 
                              ? "bg-destructive/10 text-destructive" 
                              : item.stock < 10
                              ? "bg-chart-3/10 text-chart-3"
                              : "bg-chart-2/10 text-chart-2"
                          }`}>
                            {item.stock === 0 ? "Out" : `${item.stock.toFixed(0)}`}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Recent Transfers</CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={allStockTransferVouchers.length === 0 || isExportingDetailed}
                data-testid="button-export-transfers-excel"
              >
                <FileDown className="h-4 w-4 mr-2" />
                {isExportingDetailed ? "Exporting..." : "Export"}
                <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportToExcel} data-testid="export-simple">
                Summary Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportDetailedToExcel} data-testid="export-detailed">
                Detailed Export (with items)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent>
          {stockTransferVouchers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No transfers yet</p>
            </div>
          ) : (
            <div className="table-responsive">
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

      <AlertDialog open={zeroStockAlert} onOpenChange={setZeroStockAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Out of Stock
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{zeroStockItem}</span> has 0 stock available and cannot be added to the transfer.
              Please select a different item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => setZeroStockAlert(false)} data-testid="button-close-zero-stock-alert">
              OK
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={negativeStockWarning} onOpenChange={setNegativeStockWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-chart-3" />
              Insufficient Stock Warning
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>The following items will go into negative stock after this transfer:</p>
                <div className="border rounded-md p-3 bg-muted/50">
                  {negativeStockItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm py-1">
                      <span className="font-medium">{item.name}</span>
                      <span className="text-destructive font-mono">
                        Available: {formatNumber(item.available, 0)} / Requested: {formatNumber(item.requested, 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-sm">Do you want to proceed anyway?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-negative-stock">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleProceedWithNegative}
              className="bg-chart-3 hover:bg-chart-3/90"
              data-testid="button-proceed-negative-stock"
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                      {(Array.isArray(viewingTransfer.items) ? viewingTransfer.items : []).map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{item.stockItemName || `Item ${item.stockItemId}`}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(parseFloat(item.quantity || "0"), 0)}
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
