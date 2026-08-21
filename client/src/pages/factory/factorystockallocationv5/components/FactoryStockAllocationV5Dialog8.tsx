import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import type { useFactoryStockAllocationV5Model } from "../useFactoryStockAllocationV5Model";

type Model = ReturnType<typeof useFactoryStockAllocationV5Model>;
export function FactoryStockAllocationV5Dialog8({ model }: { model: Model }) {
  const {
    exportDialogOpen,
    setExportDialogOpen,
    exportIncludePositive,
    setExportIncludePositive,
    exportIncludeNegative,
    setExportIncludeNegative,
    exportIncludeZero,
    setExportIncludeZero,
    rows,
    handleExportExcel,
  } = model;
  return (
    <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-4 w-4 text-muted-foreground" />
            Export Stock Allocation
          </DialogTitle>
          <DialogDescription>Choose which rows to include in the Excel export.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <p className="text-xs text-muted-foreground">
            The export includes Article Code, Product Name, Stock Available, Expected to Load, Total Loaded, and
            Available Balance — with colour-coded balance cells.
          </p>

          <div className="rounded-md border divide-y">
            <label
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
              data-testid="checkbox-export-positive"
            >
              <Checkbox checked={exportIncludePositive} onCheckedChange={(v) => setExportIncludePositive(!!v)} />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Positive balance</span>
                <span className="text-xs text-muted-foreground">More stock than required</span>
              </div>
              <span className="ml-auto text-xs font-mono text-green-700 dark:text-green-400">
                {rows.filter((r) => r.freeToPromise > 0).length} rows
              </span>
            </label>

            <label
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
              data-testid="checkbox-export-negative"
            >
              <Checkbox checked={exportIncludeNegative} onCheckedChange={(v) => setExportIncludeNegative(!!v)} />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-destructive">Negative balance (shortages)</span>
                <span className="text-xs text-muted-foreground">Stock is below what is needed</span>
              </div>
              <span className="ml-auto text-xs font-mono text-destructive">
                {rows.filter((r) => r.freeToPromise < 0).length} rows
              </span>
            </label>

            <label
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
              data-testid="checkbox-export-zero"
            >
              <Checkbox checked={exportIncludeZero} onCheckedChange={(v) => setExportIncludeZero(!!v)} />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-muted-foreground">Zero balance</span>
                <span className="text-xs text-muted-foreground">Exactly meets requirements</span>
              </div>
              <span className="ml-auto text-xs font-mono text-muted-foreground">
                {rows.filter((r) => r.freeToPromise === 0).length} rows
              </span>
            </label>
          </div>

          {/* Preview count */}
          <div className="text-xs text-center text-muted-foreground">
            {(() => {
              const count = rows.filter(
                (r) =>
                  (r.freeToPromise > 0 && exportIncludePositive) ||
                  (r.freeToPromise < 0 && exportIncludeNegative) ||
                  (r.freeToPromise === 0 && exportIncludeZero)
              ).length;
              return count > 0 ? (
                <span>
                  <span className="font-semibold text-foreground">{count}</span> rows will be exported
                </span>
              ) : (
                <span className="text-destructive font-medium">Select at least one filter above</span>
              );
            })()}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setExportDialogOpen(false)} data-testid="button-export-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleExportExcel}
            disabled={!exportIncludePositive && !exportIncludeNegative && !exportIncludeZero}
            data-testid="button-export-confirm"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Download Excel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
