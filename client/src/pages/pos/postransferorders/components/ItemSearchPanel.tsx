/**
 * ItemSearchPanel — extracted sub-component.
 *
 * Extracted from PosTransferOrders.tsx during the Phase 4 god-file split.
 */
import { useRef, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { fmtQty } from "../utils";
import { usePosText } from "@/i18n/modules/pos";

export // ─── Right-side item search panel (results only — input lives in the bar) ──────
function ItemSearchPanel({
  matches,
  activeIdx,
  locationName,
  onActiveChange,
  onPick,
  onClose,
}: {
  matches: { stockItemId: number; name: string; quantity: string }[];
  activeIdx: number;
  locationName: string;
  onActiveChange: (i: number) => void;
  onPick: (item: { stockItemId: number; name: string }) => void;
  onClose: () => void;
}) {
  const tUi = usePosText();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const active = listRef.current.querySelector("[data-active=true]") as HTMLElement | null;
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b bg-muted/30">
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-tight">{tUi("add.items")}</div>
          <div className="text-xs text-muted-foreground truncate">{locationName}</div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="shrink-0"
          data-testid="button-close-search-panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Items list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="text-center py-10 text-xs text-muted-foreground">{tUi("no.items.found.2")}</div>
        ) : (
          matches.map((item, i) => {
            const qty = parseFloat(item.quantity) || 0;
            const inStock = qty > 0;
            return (
              <button
                key={item.stockItemId}
                type="button"
                data-active={i === activeIdx}
                onClick={() => onPick(item)}
                onMouseEnter={() => onActiveChange(i)}
                className={cn(
                  "w-full text-left px-3 py-2.5 text-sm border-b last:border-b-0 flex items-center justify-between gap-3 transition-none",
                  i === activeIdx ? "bg-accent text-accent-foreground" : "hover-elevate"
                )}
                data-testid={`button-panel-item-${item.stockItemId}`}
              >
                <span className="truncate text-sm">{item.name}</span>
                {inStock ? (
                  <span className="text-xs font-mono shrink-0 tabular-nums font-bold text-green-600 dark:text-green-400">
                    {fmtQty(qty)}
                  </span>
                ) : (
                  <span className="text-xs shrink-0 px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground font-medium">
                    Out
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Editable detail view ─────────────────────────────────────────────────────
