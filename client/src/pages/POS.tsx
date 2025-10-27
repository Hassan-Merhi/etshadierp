import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MapPin, Wallet, Printer, AlertCircle, Search } from "lucide-react";
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
}

interface InventoryItem {
  barcode: string;
  name: string;
  stock: number;
  price: number;
}

//todo: remove mock functionality
const mockLocations = [
  { value: "main", label: "Main Warehouse" },
  { value: "east", label: "East Branch" },
  { value: "west", label: "West Coast Hub" },
];

const mockCashAccounts = [
  { value: "cash1", label: "Cash Account - Main" },
  { value: "cash2", label: "Cash Account - Branch" },
  { value: "bank1", label: "Bank Account - ABC" },
];

//todo: remove mock functionality
const mockInventory: InventoryItem[] = [
  { barcode: "BAL001", name: "Premium Cotton Bales", stock: 45, price: 450 },
  { barcode: "BAL002", name: "Denim Mix Bales", stock: 32, price: 380 },
  { barcode: "BAL003", name: "Designer Labels Mix", stock: 0, price: 650 },
  { barcode: "BAL004", name: "Summer Collection", stock: 28, price: 420 },
  { barcode: "BAL005", name: "Winter Apparel Mix", stock: 22, price: 520 },
  { barcode: "BAL006", name: "Kids Clothing Bales", stock: 40, price: 350 },
  { barcode: "BAL007", name: "Premium Denim Bales", stock: 15, price: 480 },
  { barcode: "BAL008", name: "Cotton Casual Mix", stock: 0, price: 390 },
  { barcode: "BAL009", name: "Vintage Apparel Mix", stock: 18, price: 550 },
  { barcode: "BAL010", name: "Sports Wear Bales", stock: 25, price: 420 },
];

export default function POS() {
  const [rows, setRows] = useState<SaleRow[]>([
    { id: "1", itemName: "", quantity: 0, rate: 0, amount: 0 },
  ]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [location, setLocation] = useState("main");
  const [cashAccount, setCashAccount] = useState("cash1");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [zeroStockAlert, setZeroStockAlert] = useState(false);
  const [zeroStockItem, setZeroStockItem] = useState("");
  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});
  const itemListRef = useRef<HTMLDivElement>(null);

  const columns = [
    { key: "itemName", label: "Item Name", width: "flex-1" },
    { key: "quantity", label: "Qty", width: "w-24" },
    { key: "rate", label: "Rate", width: "w-32" },
    { key: "amount", label: "Amount", width: "w-32" },
  ];

  const getFilteredInventory = () => {
    if (!searchTerm) return mockInventory;
    return mockInventory.filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.barcode.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const selectItem = (item: InventoryItem) => {
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

  const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
  const filteredItems = getFilteredInventory();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Point of Sale</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" data-testid="button-print">
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button data-testid="button-complete-sale">Complete Sale</Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger className="w-48" data-testid="select-location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mockLocations.map((loc) => (
                <SelectItem key={loc.value} value={loc.value}>
                  {loc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <Select value={cashAccount} onValueChange={setCashAccount}>
            <SelectTrigger className="w-56" data-testid="select-cash-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mockCashAccounts.map((acc) => (
                <SelectItem key={acc.value} value={acc.value}>
                  {acc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
    </div>
  );
}
