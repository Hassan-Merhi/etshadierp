/**
 * StockMovementDialog — extracted from StockTransferOrder.tsx during the Phase 4 split.
 *
 * Props are the parent-scope bindings the block referenced; they were
 * discovered from compiler errors rather than guessed.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, ExternalLink } from "lucide-react";
import { PeriodFilter } from "@/components/ui/period-filter";

export function StockMovementDialog({
  formatAmount,
  historyData,
  historyDialogOpen,
  historyItem,
  historyLoading,
  historyLocation,
  historyPeriod,
  matrixRef,
  navigate,
  setDetailDirection,
  setDetailMonth,
  setDetailMonthName,
  setDetailOpen,
  setDetailYear,
  setHistoryDialogOpen,
  setHistoryPeriod,
}: {
  formatAmount: unknown;
  historyData: unknown;
  historyDialogOpen: unknown;
  historyItem: unknown;
  historyLoading: unknown;
  historyLocation: unknown;
  historyPeriod: unknown;
  matrixRef: unknown;
  navigate: unknown;
  setDetailDirection: unknown;
  setDetailMonth: unknown;
  setDetailMonthName: unknown;
  setDetailOpen: unknown;
  setDetailYear: unknown;
  setHistoryDialogOpen: unknown;
  setHistoryPeriod: unknown;
}) {
  return (
    <Dialog
      open={historyDialogOpen}
      onOpenChange={(open) => {
        setHistoryDialogOpen(open);
        if (!open) {
          setTimeout(() => matrixRef.current?.focus(), 50);
        }
      }}
    >
      <DialogContent className="max-w-7xl w-[95vw] flex flex-col" style={{ maxHeight: "90vh" }}>
        <DialogHeader>
          <DialogTitle>Stock Movement — {historyItem?.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 text-sm">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
            {historyLocation?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end flex-shrink-0 pb-1">
          <PeriodFilter value={historyPeriod} onChange={setHistoryPeriod} />
        </div>

        <div className="flex-1 overflow-auto min-h-0 border rounded-md">
          {historyLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !historyData?.monthlyData?.some(
              (m: unknown) => m.inwardQty > 0 || m.outwardQty > 0 || m.openingQty !== 0 || m.closingQty !== 0
            ) ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No stock movement for this period</div>
          ) : (
            <table className="w-full text-sm border-collapse" style={{ minWidth: "700px" }}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted border-b">
                  <th rowSpan={2} className="text-left align-bottom px-3 py-2 border-r font-semibold w-28">
                    Month
                  </th>
                  <th colSpan={3} className="text-center px-2 py-1.5 border-r font-semibold text-muted-foreground">
                    Opening
                  </th>
                  <th
                    colSpan={3}
                    className="text-center px-2 py-1.5 border-r font-semibold text-green-700 dark:text-green-400"
                  >
                    Stock In
                  </th>
                  <th
                    colSpan={3}
                    className="text-center px-2 py-1.5 border-r font-semibold text-red-700 dark:text-red-400"
                  >
                    Stock Out
                  </th>
                  <th colSpan={3} className="text-center px-2 py-1.5 font-semibold text-primary">
                    Closing
                  </th>
                </tr>
                <tr className="bg-muted/70 border-b text-xs">
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium text-muted-foreground border-r">Value</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">
                    Qty
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">
                    Rate
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">
                    Value
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Value</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Value</th>
                </tr>
              </thead>
              <tbody>
                {(historyData?.monthlyData ?? []).map((month: unknown) => {
                  const isActive =
                    month.inwardQty > 0 || month.outwardQty > 0 || month.openingQty !== 0 || month.closingQty !== 0;
                  const fmtQty = (n: number) =>
                    n === 0 ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                  const fmtRate = (n: number) =>
                    n === 0 ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const fmtVal = (n: number) => (n === 0 ? "—" : formatAmount(n));
                  return (
                    <tr
                      key={month.month}
                      className={`border-b transition-colors ${isActive ? "" : "text-muted-foreground/50"}`}
                    >
                      <td className="font-medium px-3 py-2 border-r">{month.monthName}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                        {fmtQty(month.openingQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                        {fmtRate(month.openingRate)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                        {fmtVal(month.openingValue)}
                      </td>
                      <td
                        className={`text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400 font-medium ${month.inwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-green-900 dark:hover:text-green-200" : ""}`}
                        onClick={() => {
                          if (month.inwardQty > 0) {
                            setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                            setDetailMonth(month.month);
                            setDetailMonthName(month.monthName);
                            setDetailDirection("in");
                            setDetailOpen(true);
                          }
                        }}
                        title={month.inwardQty > 0 ? "Click to see individual transactions" : undefined}
                      >
                        {fmtQty(month.inwardQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">
                        {fmtRate(month.inwardRate)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">
                        {fmtVal(month.inwardValue)}
                      </td>
                      <td
                        className={`text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400 font-medium ${month.outwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-red-900 dark:hover:text-red-200" : ""}`}
                        onClick={() => {
                          if (month.outwardQty > 0) {
                            setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                            setDetailMonth(month.month);
                            setDetailMonthName(month.monthName);
                            setDetailDirection("out");
                            setDetailOpen(true);
                          }
                        }}
                        title={month.outwardQty > 0 ? "Click to see individual transactions" : undefined}
                      >
                        {fmtQty(month.outwardQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">
                        {fmtRate(month.outwardRate)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">
                        {fmtVal(month.outwardValue)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums font-semibold text-foreground">
                        {fmtQty(month.closingQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums font-medium">{fmtRate(month.closingRate)}</td>
                      <td className="text-right px-3 py-2 tabular-nums font-medium">{fmtVal(month.closingValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {historyData?.grandTotal && (
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-muted font-bold border-t-2">
                    <td className="px-3 py-2 border-r">Total</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                      {historyData.grandTotal.openingQty === 0
                        ? "—"
                        : historyData.grandTotal.openingQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                      {historyData.grandTotal.openingRate === 0
                        ? "—"
                        : historyData.grandTotal.openingRate.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">
                      {historyData.grandTotal.openingValue === 0
                        ? "—"
                        : formatAmount(historyData.grandTotal.openingValue)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">
                      {historyData.grandTotal.inwardQty === 0
                        ? "—"
                        : historyData.grandTotal.inwardQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">
                      {historyData.grandTotal.inwardRate === 0
                        ? "—"
                        : historyData.grandTotal.inwardRate.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">
                      {historyData.grandTotal.inwardValue === 0
                        ? "—"
                        : formatAmount(historyData.grandTotal.inwardValue)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">
                      {historyData.grandTotal.outwardQty === 0
                        ? "—"
                        : historyData.grandTotal.outwardQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">
                      {historyData.grandTotal.outwardRate === 0
                        ? "—"
                        : historyData.grandTotal.outwardRate.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">
                      {historyData.grandTotal.outwardValue === 0
                        ? "—"
                        : formatAmount(historyData.grandTotal.outwardValue)}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums text-foreground">
                      {historyData.grandTotal.closingQty === 0
                        ? "—"
                        : historyData.grandTotal.closingQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums">
                      {historyData.grandTotal.closingRate === 0
                        ? "—"
                        : historyData.grandTotal.closingRate.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums">
                      {historyData.grandTotal.closingValue === 0
                        ? "—"
                        : formatAmount(historyData.grandTotal.closingValue)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 pt-2">
          <Button variant="outline" onClick={() => setHistoryDialogOpen(false)} data-testid="button-history-close">
            Close
          </Button>
          <Button
            variant="default"
            data-testid="button-history-open-full"
            onClick={() => {
              if (!historyLocation || !historyItem) return;
              navigate(`/locations/${historyLocation.id}/stock-items/${historyItem.id}/history`);
              setHistoryDialogOpen(false);
            }}
          >
            <ExternalLink className="h-4 w-4 mr-1.5" />
            Open full history
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
