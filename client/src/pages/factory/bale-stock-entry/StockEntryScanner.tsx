import { ScanLine, AlertCircle, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FactoryBaleProduct } from "@shared/schema";

interface StockEntryScannerProps {
  scanRef: React.RefObject<HTMLInputElement>;
  scanInput: string;
  onScanInputChange: (val: string) => void;
  onScanKeyDown: (e: React.KeyboardEvent) => void;
  scanError: string;
  showDropdown: boolean;
  filteredProducts: FactoryBaleProduct[];
  onSelectProduct: (product: FactoryBaleProduct) => void;
}

export function StockEntryScanner({
  scanRef,
  scanInput,
  onScanInputChange,
  onScanKeyDown,
  scanError,
  showDropdown,
  filteredProducts,
  onSelectProduct,
}: StockEntryScannerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <ScanLine className="h-4.5 w-4.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
        </div>
        <Input
          ref={scanRef}
          placeholder="Scan article code or type product name..."
          value={scanInput}
          onChange={(e) => onScanInputChange(e.target.value)}
          onKeyDown={onScanKeyDown}
          className="pl-10 h-12 text-base rounded-xl border-2 focus-visible:ring-primary/20 transition-all shadow-sm"
          data-testid="input-scan-product"
        />
        {scanError && (
          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-destructive px-1">
            <AlertCircle className="h-3.5 w-3.5" />
            {scanError}
          </div>
        )}
        {showDropdown && filteredProducts.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-background border rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                className="px-4 py-2.5 cursor-pointer flex items-center justify-between border-b last:border-0 hover:bg-muted/50 transition-colors"
                onClick={() => onSelectProduct(p)}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center font-bold text-primary text-[10px]">
                    {p.grade || "STK"}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{p.articleCode || p.code}</div>
                  </div>
                </div>
                <Plus className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
