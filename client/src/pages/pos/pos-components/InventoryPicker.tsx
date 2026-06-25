import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InventoryItem } from "./posTypes";

export interface InventoryPickerProps {
  inventory: InventoryItem[];
  selectItem: (item: InventoryItem) => void;
  itemListRef: React.RefObject<HTMLDivElement>;
  highlightedIndex: number;
  syncTerm?: string;
  mobile?: boolean;
}

// Keep spaces so "GS HAND" doesn't bleed into adjacent words.
// Only strip dots and dashes (common in codes like BL.K.001).
function normalizeName(s: string) {
  return (s || "").toLowerCase().replace(/[.\-]/g, "");
}

// For codes, strip everything (spaces + dots + dashes) so "BL K 001" and "BL.K.001" both match "blk001".
function normalizeCode(s: string) {
  return (s || "").toLowerCase().replace(/[.\-\s]/g, "");
}

function matches(item: InventoryItem, raw: string): boolean {
  const term = raw.toLowerCase().replace(/[.\-]/g, "").trim();
  if (!term) return true;
  const termNoSpace = term.replace(/\s/g, "");
  // Name: search with spaces kept (prevents cross-word false positives)
  if (normalizeName(item.name).includes(term)) return true;
  // Code: strip spaces for compact entry (e.g. "blk001" or "BL.K.001")
  if (normalizeCode(item.code).includes(termNoSpace)) return true;
  return false;
}

export function InventoryPicker({
  inventory,
  selectItem,
  itemListRef,
  highlightedIndex,
  syncTerm,
  mobile = false,
}: InventoryPickerProps) {
  const [localSearch, setLocalSearch] = useState("");

  useEffect(() => {
    if (syncTerm !== undefined) setLocalSearch(syncTerm);
  }, [syncTerm]);

  const filteredInventory = localSearch ? inventory.filter((item) => matches(item, localSearch)) : inventory;

  return (
    <Card className={`flex flex-col overflow-hidden ${mobile ? "flex-1 rounded-none border-0 shadow-none" : "w-full lg:w-96 h-[300px] lg:h-auto shrink-0"}`}>
      {/* Header */}
      <div className={`shrink-0 ${mobile ? "px-4 pt-4 pb-3" : "px-3 pt-3 pb-2"}`}>
        <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">Items</p>
        <div className={`flex items-center gap-2 rounded-md border border-input bg-muted/30 px-2.5 focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all ${mobile ? "h-11" : "h-9"}`}>
          <Search className={`text-muted-foreground shrink-0 ${mobile ? "h-5 w-5" : "h-4 w-4"}`} />
          <input
            className={`flex-1 bg-transparent outline-none placeholder:text-muted-foreground ${mobile ? "text-base" : "text-sm"}`}
            placeholder="Scan barcode or search..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            data-testid="input-product-search"
          />
          {localSearch && (
            <button
              className="text-muted-foreground"
              onClick={() => setLocalSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
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
              className={`w-full text-left flex items-center justify-between gap-2 border-b border-muted/40 transition-colors duration-100 ${
                mobile ? "px-4 py-3 active:bg-primary/10" : "px-3 py-1.5"
              } ${index === highlightedIndex ? "bg-primary/10" : "hover:bg-muted/40"}`}
              onClick={() => {
                selectItem(item);
                setLocalSearch("");
              }}
              data-testid={`button-select-item-${item.code}`}
            >
              <div className="min-w-0">
                <p className={`font-semibold leading-tight truncate ${mobile ? "text-base" : "text-sm"}`}>{item.name}</p>
                <p className={`text-muted-foreground font-mono ${mobile ? "text-xs mt-0.5" : "text-[11px]"}`}>{item.code}</p>
              </div>
              <span
                className={`shrink-0 font-bold rounded ${
                  mobile ? "text-xs px-2 py-1" : "text-[10px] px-1.5 py-0.5"
                } ${
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
