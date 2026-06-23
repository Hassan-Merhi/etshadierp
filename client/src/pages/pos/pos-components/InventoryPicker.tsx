import { useState, useEffect } from "react";
import { ScanBarcode, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InventoryItem } from "./posTypes";

export interface InventoryPickerProps {
  inventory: InventoryItem[];
  selectItem: (item: InventoryItem) => void;
  itemListRef: React.RefObject<HTMLDivElement>;
  highlightedIndex: number;
  syncTerm?: string;
}

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/[.\-\s]/g, "");
}

export function InventoryPicker({
  inventory,
  selectItem,
  itemListRef,
  highlightedIndex,
  syncTerm,
}: InventoryPickerProps) {
  const [localSearch, setLocalSearch] = useState("");

  useEffect(() => {
    if (syncTerm !== undefined) setLocalSearch(syncTerm);
  }, [syncTerm]);

  const filteredInventory = localSearch
    ? (() => {
        const n = normalize(localSearch);
        return inventory.filter(
          (item) => normalize(item.name).includes(n) || normalize(item.code).includes(n)
        );
      })()
    : inventory;

  return (
    <Card className="w-full lg:w-72 flex flex-col overflow-hidden h-[300px] lg:h-auto">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Items</p>
        <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-2.5 h-9 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all">
          <ScanBarcode className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Scan barcode or search..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            data-testid="input-product-search"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" ref={itemListRef}>
        {filteredInventory.map((item, index) => {
          const isOut = item.stock === 0;
          const isLow = !isOut && item.stock < 10;
          return (
            <button
              key={item.code}
              className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-b border-muted/40 transition-colors duration-100 ${
                index === highlightedIndex
                  ? "bg-primary/10"
                  : "hover:bg-muted/40"
              }`}
              onClick={() => {
                selectItem(item);
                setLocalSearch("");
              }}
              data-testid={`button-select-item-${item.code}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight truncate">{item.name}</p>
                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.code}</p>
              </div>
              <span
                className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  isOut
                    ? "bg-red-500/15 text-red-500"
                    : isLow
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {isOut ? "Out" : isLow ? `${Math.round(item.stock)} Low` : Math.round(item.stock).toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
