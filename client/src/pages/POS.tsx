import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MapPin, Wallet, Printer } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SaleRow {
  id: string;
  barcode: string;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
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

export default function POS() {
  const [rows, setRows] = useState<SaleRow[]>([
    { id: "1", barcode: "", itemName: "", quantity: 0, rate: 0, amount: 0 },
  ]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({
    row: 0,
    col: 0,
  });
  const [location, setLocation] = useState("main");
  const [cashAccount, setCashAccount] = useState("cash1");
  const inputRefs = useRef<{ [key: string]: HTMLInputElement }>({});

  const columns = [
    { key: "barcode", label: "Barcode", width: "w-40" },
    { key: "itemName", label: "Item Name", width: "flex-1" },
    { key: "quantity", label: "Qty", width: "w-24" },
    { key: "rate", label: "Rate", width: "w-32" },
    { key: "amount", label: "Amount", width: "w-32" },
  ];

  const updateRow = (index: number, field: keyof SaleRow, value: string | number) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    
    // Auto-calculate amount
    if (field === "quantity" || field === "rate") {
      const qty = field === "quantity" ? Number(value) : newRows[index].quantity;
      const rate = field === "rate" ? Number(value) : newRows[index].rate;
      newRows[index].amount = qty * rate;
    }
    
    setRows(newRows);

    // Add new row if last row is being edited
    if (index === rows.length - 1 && value !== "") {
      setRows([
        ...newRows,
        {
          id: String(rows.length + 1),
          barcode: "",
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

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (rowIndex > 0) {
          setSelectedCell({ row: rowIndex - 1, col: colIndex });
          focusCell(rowIndex - 1, colIndex);
        }
        break;
      case "ArrowDown":
      case "Enter":
        e.preventDefault();
        if (rowIndex < maxRow) {
          setSelectedCell({ row: rowIndex + 1, col: colIndex });
          focusCell(rowIndex + 1, colIndex);
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

  const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);

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

      <Card className="overflow-hidden">
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
                        onFocus={() => setSelectedCell({ row: rowIndex, col: colIndex })}
                        readOnly={col.key === "amount"}
                        className={`w-full h-full px-3 bg-transparent outline-none focus:bg-accent/20 ${
                          col.key === "quantity" || col.key === "rate" || col.key === "amount"
                            ? "font-mono text-right"
                            : ""
                        } ${col.key === "amount" ? "cursor-not-allowed" : ""}`}
                        placeholder={
                          col.key === "barcode"
                            ? "Scan or type..."
                            : col.key === "itemName"
                            ? "Item description..."
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
    </div>
  );
}
