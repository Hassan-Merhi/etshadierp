import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
import { useLocation, Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Wallet, Printer, AlertCircle, Search, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SaleRow {
  id: string;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
  stockItemId?: number;
}

interface InventoryItem {
  barcode: string;
  name: string;
  stock: number;
  price: number;
}

interface APIInventoryItem {
  inventoryId: number;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemBarcode: string | null;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
}

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
}

export default function POS({ posUser }: { posUser?: any } = {}) {
  const { selectedLocation } = useLocationContext();
  const [, navigate] = useLocation();

  // For POS users, fetch their assigned location
  const { data: posLocation } = useQuery<Location>({
    queryKey: posUser?.assignedLocationId ? [`/api/locations/${posUser.assignedLocationId}`] : [],
    enabled: !!posUser?.assignedLocationId,
  });

  // Use either the selected location (for Admin/Owner/Manager) or POS user's assigned location
  const activeLocation = posUser ? posLocation : selectedLocation;

  // Redirect to Location Inventory if no location is available (only for non-POS users)
  if (!activeLocation && !posUser) {
    return <Redirect to="/location-inventory" />;
  }

  // Show loading state while fetching POS user's location
  if (posUser && !posLocation) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading location...</p>
      </div>
    );
  }

  // Fetch inventory for the active location
  const { data: apiInventory = [], isLoading: inventoryLoading } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
  });

  // Transform API inventory to POS format with stockItemId
  const inventory: (InventoryItem & { stockItemId: number })[] = apiInventory.map((item) => ({
    barcode: item.stockItemBarcode || item.stockItemCode,
    name: item.stockItemName,
    stock: parseFloat(item.quantity),
    price: parseFloat(item.averageRate),
    stockItemId: item.stockItemId,
  }));

  // Fetch bank accounts for cash account selector
  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const [rows, setRows] = useState<SaleRow[]>([
    { id: "1", itemName: "", quantity: 0, rate: 0, amount: 0 },
  ]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [cashAccount, setCashAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [zeroStockAlert, setZeroStockAlert] = useState(false);
  const [zeroStockItem, setZeroStockItem] = useState("");
  const [savedSale, setSavedSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});
  const itemListRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-select first bank account when loaded
  useEffect(() => {
    if (bankAccounts.length > 0 && !cashAccount) {
      setCashAccount(String(bankAccounts[0].id));
    }
  }, [bankAccounts, cashAccount]);

  const columns = [
    { key: "itemName", label: "Item Name", width: "flex-1" },
    { key: "quantity", label: "Qty", width: "w-24" },
    { key: "rate", label: "Rate", width: "w-32" },
    { key: "amount", label: "Amount", width: "w-32" },
  ];

  const getFilteredInventory = () => {
    if (!searchTerm) return inventory;
    return inventory.filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.barcode.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const selectItem = (item: InventoryItem & { stockItemId: number }) => {
    if (item.stock === 0) {
      setZeroStockItem(item.name);
      setZeroStockAlert(true);
      return;
    }

    if (activeRow === null) return;

    const newRows = [...rows];
    newRows[activeRow] = {
      ...newRows[activeRow],
      itemName: item.name,
      rate: item.price,
      quantity: newRows[activeRow].quantity || 1,
      stockItemId: item.stockItemId,
    };
    newRows[activeRow].amount = (newRows[activeRow].quantity || 1) * item.price;
    
    setRows(newRows);
    setSearchTerm("");
    setHighlightedIndex(0);

    // Add new row if last row is being edited
    if (activeRow === rows.length - 1) {
      setRows([
        ...newRows,
        {
          id: String(rows.length + 1),
          itemName: "",
          quantity: 0,
          rate: 0,
          amount: 0,
        },
      ]);
    }

    // Move to quantity field
    setTimeout(() => {
      focusCell(activeRow, 1);
      setActiveRow(null);
    }, 0);
  };

  const updateRow = (index: number, field: keyof SaleRow, value: string | number) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    
    // Auto-calculate amount
    if (field === "quantity" || field === "rate") {
      const qty = field === "quantity" ? Number(value) : newRows[index].quantity;
      const rate = field === "rate" ? Number(value) : newRows[index].rate;
      newRows[index].amount = qty * rate;
    }
    
    // Update search term when typing in item name
    if (field === "itemName") {
      setSearchTerm(String(value));
      setHighlightedIndex(0);
    }
    
    setRows(newRows);

    // Add new row if last row is being edited
    if (index === rows.length - 1 && value !== "" && field !== "itemName") {
      setRows([
        ...newRows,
        {
          id: String(rows.length + 1),
          itemName: "",
          quantity: 0,
          rate: 0,
          amount: 0,
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowIndex: number, colIndex: number) => {
    const maxCol = columns.length - 1;
    const maxRow = rows.length - 1;
    const isItemNameField = columns[colIndex].key === "itemName";
    const filteredItems = getFilteredInventory();

    // Special handling for item name field with filtered items
    if (isItemNameField && activeRow === rowIndex && filteredItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && highlightedIndex > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[highlightedIndex]) {
          selectItem(filteredItems[highlightedIndex]);
        }
        return;
      }
    }

    switch (e.key) {
      case "ArrowUp":
        if (!isItemNameField || filteredItems.length === 0) {
          e.preventDefault();
          if (rowIndex > 0) {
            setSelectedCell({ row: rowIndex - 1, col: colIndex });
            focusCell(rowIndex - 1, colIndex);
          }
        }
        break;
      case "ArrowDown":
        if (!isItemNameField || filteredItems.length === 0) {
          e.preventDefault();
          if (rowIndex < maxRow) {
            setSelectedCell({ row: rowIndex + 1, col: colIndex });
            focusCell(rowIndex + 1, colIndex);
          }
        }
        break;
      case "Enter":
        if (!isItemNameField || filteredItems.length === 0) {
          e.preventDefault();
          if (rowIndex < maxRow) {
            setSelectedCell({ row: rowIndex + 1, col: colIndex });
            focusCell(rowIndex + 1, colIndex);
          }
        }
        break;
      case "ArrowLeft":
        if ((e.currentTarget as HTMLInputElement).selectionStart === 0 && colIndex > 0) {
          e.preventDefault();
          setSelectedCell({ row: rowIndex, col: colIndex - 1 });
          focusCell(rowIndex, colIndex - 1);
        }
        break;
      case "ArrowRight":
      case "Tab":
        if (!e.shiftKey && (e.currentTarget as HTMLInputElement).selectionStart === (e.currentTarget as HTMLInputElement).value.length && colIndex < maxCol) {
          e.preventDefault();
          setSelectedCell({ row: rowIndex, col: colIndex + 1 });
          focusCell(rowIndex, colIndex + 1);
        }
        break;
    }
  };

  const focusCell = (rowIndex: number, colIndex: number) => {
    const key = `${rowIndex}-${colIndex}`;
    setTimeout(() => {
      inputRefs.current[key]?.focus();
      inputRefs.current[key]?.select();
    }, 0);
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (itemListRef.current && activeRow !== null) {
      const highlightedElement = itemListRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [highlightedIndex, activeRow]);

  // Save sale mutation
  const saveMutation = useMutation({
    mutationFn: async (saleData: any) => {
      return await apiRequest("POST", "/api/pos/sales", saleData);
    },
    onSuccess: (data) => {
      setSavedSale(data);
      toast({
        title: "Sale Saved",
        description: `Sale ${data.voucherNumber} has been saved successfully.`,
      });
      
      // Clear the form
      setRows([{ id: "1", itemName: "", quantity: 0, rate: 0, amount: 0 }]);
      setNotes("");
      
      // Invalidate inventory query to refresh stock levels
      queryClient.invalidateQueries({ queryKey: [`/api/locations/${activeLocation?.id}/inventory`] });
      
      // Auto-show print dialog
      setShowPrintDialog(true);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save sale",
        variant: "destructive",
      });
    },
  });

  const handleSaveSale = () => {
    // Validate
    if (!activeLocation) {
      toast({
        title: "Error",
        description: "Please select a location",
        variant: "destructive",
      });
      return;
    }

    if (!cashAccount) {
      toast({
        title: "Error",
        description: "Please select a cash account",
        variant: "destructive",
      });
      return;
    }

    const validItems = rows.filter(r => r.stockItemId && r.quantity > 0 && r.rate > 0);
    if (validItems.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one item to the sale",
        variant: "destructive",
      });
      return;
    }

    // Prepare sale data
    const saleData = {
      locationId: activeLocation.id,
      cashAccountId: parseInt(cashAccount),
      notes,
      items: validItems.map(row => ({
        stockItemId: row.stockItemId,
        quantity: row.quantity.toString(),
        rate: row.rate.toString(),
      })),
    };

    saveMutation.mutate(saleData);
  };

  // Print handler
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: savedSale ? `Invoice-${savedSale.voucherNumber}` : "Invoice",
    onAfterPrint: () => setShowPrintDialog(false),
  });

  const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
  const filteredItems = getFilteredInventory();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Point of Sale</h1>
        <div className="flex gap-2">
          <Button 
            onClick={handleSaveSale}
            disabled={saveMutation.isPending}
            className="gap-2"
            data-testid="button-complete-sale"
          >
            {saveMutation.isPending ? "Saving..." : "Save & Print"}
            {!saveMutation.isPending && <Check className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          {posUser ? (
            <div className="px-3 py-1.5">
              <span className="font-medium">{activeLocation?.name}</span>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => navigate("/location-inventory")}
              className="gap-2"
              data-testid="button-change-location"
            >
              <span className="font-medium">{activeLocation?.name}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground">Change</span>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <Select value={cashAccount} onValueChange={setCashAccount}>
            <SelectTrigger className="w-56" data-testid="select-cash-account">
              <SelectValue placeholder="Select cash account" />
            </SelectTrigger>
            <SelectContent>
              {bankAccounts.map((acc: any) => (
                <SelectItem key={acc.id} value={String(acc.id)}>
                  {acc.accountName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 flex items-center gap-2">
          <Textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="resize-none h-9"
            data-testid="input-notes"
          />
        </div>
      </div>

      <div className="flex gap-4">
        {/* Main Spreadsheet Area */}
        <Card className="flex-1 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-full">
              {/* Header */}
              <div className="flex bg-muted/50 border-b sticky top-0 z-10">
                <div className="w-12 flex items-center justify-center border-r h-10 font-medium text-xs">
                  #
                </div>
                {columns.map((col) => (
                  <div
                    key={col.key}
                    className={`${col.width} flex items-center px-3 border-r h-10 font-medium text-sm`}
                  >
                    {col.label}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div className="max-h-[calc(100vh-24rem)] overflow-y-auto">
                {rows.map((row, rowIndex) => (
                  <div key={row.id} className="flex border-b hover-elevate">
                    <div className="w-12 flex items-center justify-center border-r h-10 text-xs text-muted-foreground">
                      {rowIndex + 1}
                    </div>
                    {columns.map((col, colIndex) => (
                      <div
                        key={col.key}
                        className={`${col.width} border-r h-10 ${
                          col.key === "amount" ? "bg-muted/30" : ""
                        }`}
                      >
                        <input
                          ref={(el) => {
                            if (el) inputRefs.current[`${rowIndex}-${colIndex}`] = el;
                          }}
                          type={col.key === "quantity" || col.key === "rate" ? "number" : "text"}
                          value={
                            col.key === "amount"
                              ? row.amount.toFixed(2)
                              : row[col.key as keyof SaleRow]
                          }
                          onChange={(e) => {
                            if (col.key !== "amount") {
                              updateRow(rowIndex, col.key as keyof SaleRow, e.target.value);
                            }
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIndex, colIndex)}
                          onFocus={() => {
                            setSelectedCell({ row: rowIndex, col: colIndex });
                            if (col.key === "itemName") {
                              setActiveRow(rowIndex);
                              setSearchTerm(row.itemName);
                              setHighlightedIndex(0);
                            }
                          }}
                          onBlur={() => {
                            if (col.key === "itemName") {
                              setTimeout(() => {
                                setActiveRow(null);
                              }, 200);
                            }
                          }}
                          readOnly={col.key === "amount"}
                          className={`w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 ${
                            col.key === "quantity" || col.key === "rate" || col.key === "amount"
                              ? "font-mono text-right"
                              : ""
                          } ${col.key === "amount" ? "cursor-not-allowed" : ""}`}
                          placeholder={
                            col.key === "itemName"
                              ? "Type to search..."
                              : ""
                          }
                          data-testid={`input-${col.key}-${rowIndex}`}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Total Section */}
          <div className="border-t bg-muted/20 p-4">
            <div className="flex justify-end items-center gap-8 max-w-md ml-auto">
              <div className="text-sm text-muted-foreground">Total Items:</div>
              <div className="text-sm font-mono font-medium">
                {rows.filter((r) => r.amount > 0).length}
              </div>
              <div className="text-lg font-semibold">Grand Total:</div>
              <div className="text-2xl font-bold font-mono" data-testid="text-grand-total">
                ${total.toFixed(2)}
              </div>
            </div>
          </div>
        </Card>

        {/* Right Panel - Item Search */}
        <Card className="w-96 flex flex-col">
          <div className="p-4 border-b">
            <h3 className="text-sm font-semibold mb-3">Search Items</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or barcode..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setHighlightedIndex(0);
                }}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2" ref={itemListRef}>
            <div className="space-y-1">
              {filteredItems.map((item, idx) => (
                <button
                  key={item.barcode}
                  onClick={() => selectItem(item)}
                  className={`w-full text-left px-3 py-3 rounded-md hover-elevate active-elevate-2 ${
                    item.stock === 0 ? "opacity-60" : ""
                  } ${idx === highlightedIndex && activeRow !== null ? "bg-accent" : ""}`}
                  data-testid={`item-${idx}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium mb-1">{item.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {item.barcode}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="text-sm font-mono font-semibold">
                        ${item.price}
                      </div>
                      <div className={`text-xs font-medium px-2 py-0.5 rounded ${
                        item.stock === 0 
                          ? "bg-destructive/10 text-destructive" 
                          : item.stock < 10
                          ? "bg-chart-3/10 text-chart-3"
                          : "bg-chart-2/10 text-chart-2"
                      }`}>
                        {item.stock === 0 ? "Out" : `${item.stock}`}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Zero Stock Alert Dialog */}
      <AlertDialog open={zeroStockAlert} onOpenChange={setZeroStockAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Out of Stock
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">{zeroStockItem}</span> cannot be added because it has 0 stock available.
              Please check inventory or select a different item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => setZeroStockAlert(false)} data-testid="button-close-alert">
              OK
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print Dialog */}
      <AlertDialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Print Invoice</AlertDialogTitle>
            <AlertDialogDescription>
              Sale has been saved successfully. Would you like to print the invoice?
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {/* Hidden Print Template */}
          <div className="hidden">
            <div ref={printRef} className="p-8 bg-white text-black">
              <div className="text-center mb-6">
                <h1 className="text-3xl font-bold mb-2">SALES INVOICE</h1>
                <p className="text-sm text-gray-600">Invoice #{savedSale?.voucherNumber}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div>
                  <p className="font-semibold mb-1">Location:</p>
                  <p>{savedSale?.location?.name}</p>
                  <p>{savedSale?.location?.city}, {savedSale?.location?.state}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold mb-1">Date:</p>
                  <p>{savedSale?.saleDate}</p>
                </div>
              </div>

              <table className="w-full mb-6 border-collapse">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">Item</th>
                    <th className="text-right py-2">Qty</th>
                    <th className="text-right py-2">Rate</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {savedSale?.items.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b">
                      <td className="py-2">{idx + 1}</td>
                      <td className="py-2">{item.stockItemName}</td>
                      <td className="text-right py-2">{item.quantity}</td>
                      <td className="text-right py-2">${parseFloat(item.rate).toFixed(2)}</td>
                      <td className="text-right py-2">${item.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end mb-6">
                <div className="w-64">
                  <div className="flex justify-between py-2 text-lg font-bold border-t-2 border-black">
                    <span>TOTAL:</span>
                    <span>${savedSale?.grandTotal}</span>
                  </div>
                </div>
              </div>

              {savedSale?.voucher?.description && (
                <div className="mb-6">
                  <p className="font-semibold mb-1">Notes:</p>
                  <p className="text-sm">{savedSale.voucher.description}</p>
                </div>
              )}

              <div className="text-center text-sm text-gray-600 mt-8 pt-4 border-t">
                <p>Thank you for your business!</p>
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setShowPrintDialog(false)} data-testid="button-cancel-print">
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-2" data-testid="button-print-invoice">
              <Printer className="h-4 w-4" />
              Print Invoice
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
