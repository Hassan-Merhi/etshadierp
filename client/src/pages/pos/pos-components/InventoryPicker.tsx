import { Search, Badge, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InventoryItem } from "./posTypes";

export interface InventoryPickerProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  getFilteredInventory: () => InventoryItem[];
  selectItem: (item: InventoryItem) => void;
  itemListRef: React.RefObject<HTMLDivElement>;
  highlightedIndex: number;
}

export function InventoryPicker({
  searchTerm,
  setSearchTerm,
  getFilteredInventory,
  selectItem,
  itemListRef,
  highlightedIndex,
}: InventoryPickerProps) {
  const filteredInventory = getFilteredInventory();

  return (
    <Card className="w-full lg:w-80 flex flex-col overflow-hidden h-[300px] lg:h-auto">
      <div className="p-3 border-b bg-muted/20">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            className="pl-8 h-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-product-search"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" ref={itemListRef}>
        <div className="grid grid-cols-1 divide-y divide-muted/50">
          {filteredInventory.map((item, index) => (
            <button
              key={item.code}
              className={`w-full text-left px-3 py-2.5 transition-all duration-150 flex flex-col gap-1 active-elevate-2 ${
                index === highlightedIndex ? "bg-accent/50" : "hover:bg-accent/20"
              }`}
              onClick={() => selectItem(item)}
              data-testid={`button-select-item-${item.code}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-tight">
                  {item.name}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {item.code}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold">
                    $ {item.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  {item.stock < 10 && item.stock > 0 && (
                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                  )}
                </div>
                <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${
                  item.stock === 0 
                    ? "border-red-400/40 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                    : item.stock < 10 
                      ? "border-amber-400/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                      : "border-emerald-400/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                }`}>
                  {item.stock === 0 ? "Out" : Math.round(item.stock)}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
