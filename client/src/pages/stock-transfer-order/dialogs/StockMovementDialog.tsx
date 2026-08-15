import type { Dispatch, RefObject, SetStateAction } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PeriodFilter, type PeriodFilterValue } from "@/components/ui/period-filter";
import { Skeleton } from "@/components/ui/skeleton";
import type { Location, StockItemData } from "../../stocktransferorder/types";

type MonthlyMovement = {
  month: number;
  monthName: string;
  openingQty: number;
  openingRate: number;
  openingValue: number;
  inwardQty: number;
  inwardRate: number;
  inwardValue: number;
  outwardQty: number;
  outwardRate: number;
  outwardValue: number;
  closingQty: number;
  closingRate: number;
  closingValue: number;
};

type MovementTotals = Omit<MonthlyMovement, "month" | "monthName">;

type StockMovementData = {
  monthlyData?: MonthlyMovement[];
  grandTotal?: MovementTotals;
};

type StockMovementDialogProps = {
  formatAmount: (amount: number) => string;
  historyData: StockMovementData | undefined;
  historyDialogOpen: boolean;
  historyItem: StockItemData | null;
  historyLoading: boolean;
  historyLocation: Location | null;
  historyPeriod: PeriodFilterValue;
  matrixRef: RefObject<HTMLDivElement>;
  navigate: (path: string) => void;
  setDetailDirection: Dispatch<SetStateAction<"in" | "out">>;
  setDetailMonth: Dispatch<SetStateAction<number>>;
  setDetailMonthName: Dispatch<SetStateAction<string>>;
  setDetailOpen: Dispatch<SetStateAction<boolean>>;
  setDetailYear: Dispatch<SetStateAction<number>>;
  setHistoryDialogOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryPeriod: Dispatch<SetStateAction<PeriodFilterValue>>;
};

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
}: StockMovementDialogProps) {
  const monthlyData = historyData?.monthlyData ?? [];
  const hasMovement = monthlyData.some(
    (month) =>
      month.inwardQty > 0 ||
      month.outwardQty > 0 ||
      month.openingQty !== 0 ||
      month.closingQty !== 0
  );
  const formatQty = (value: number) =>
    value === 0
      ? "—"
      : value.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });
  const formatRate = (value: number) =>
    value === 0
      ? "—"
      : value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  const formatValue = (value: number) => (value === 0 ? "—" : formatAmount(value));

  return (
    <Dialog
      open={historyDialogOpen}
      onOpenChange={(open) => {
        setHistoryDialogOpen(open);
        if (!open) setTimeout(() => matrixRef.current?.focus(), 50);
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
              {[1, 2, 3, 4].map((value) => (
                <Skeleton key={value} className="h-9 w-full" />
              ))}
            </div>
          ) : !hasMovement ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No stock movement for this period
            </div>
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
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-green-700 dark:text-green-400">Value</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium border-r text-red-700 dark:text-red-400">Value</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Qty</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Rate</th>
                  <th className="text-right px-3 py-1.5 font-medium text-primary">Value</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((month) => {
                  const active =
                    month.inwardQty > 0 ||
                    month.outwardQty > 0 ||
                    month.openingQty !== 0 ||
                    month.closingQty !== 0;
                  return (
                    <tr
                      key={month.month}
                      className={`border-b transition-colors ${active ? "" : "text-muted-foreground/50"}`}
                    >
                      <td className="font-medium px-3 py-2 border-r">{month.monthName}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatQty(month.openingQty)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatRate(month.openingRate)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatValue(month.openingValue)}</td>
                      <td
                        className={`text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400 font-medium ${month.inwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-green-900 dark:hover:text-green-200" : ""}`}
                        onClick={() => {
                          if (month.inwardQty <= 0) return;
                          setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                          setDetailMonth(month.month);
                          setDetailMonthName(month.monthName);
                          setDetailDirection("in");
                          setDetailOpen(true);
                        }}
                        title={month.inwardQty > 0 ? "Click to see individual transactions" : undefined}
                      >
                        {formatQty(month.inwardQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{formatRate(month.inwardRate)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{formatValue(month.inwardValue)}</td>
                      <td
                        className={`text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400 font-medium ${month.outwardQty > 0 ? "cursor-pointer underline underline-offset-2 decoration-dotted hover:text-red-900 dark:hover:text-red-200" : ""}`}
                        onClick={() => {
                          if (month.outwardQty <= 0) return;
                          setDetailYear(parseInt(historyPeriod.fromDate.slice(0, 4)));
                          setDetailMonth(month.month);
                          setDetailMonthName(month.monthName);
                          setDetailDirection("out");
                          setDetailOpen(true);
                        }}
                        title={month.outwardQty > 0 ? "Click to see individual transactions" : undefined}
                      >
                        {formatQty(month.outwardQty)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{formatRate(month.outwardRate)}</td>
                      <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{formatValue(month.outwardValue)}</td>
                      <td className="text-right px-3 py-2 tabular-nums font-semibold text-foreground">{formatQty(month.closingQty)}</td>
                      <td className="text-right px-3 py-2 tabular-nums font-medium">{formatRate(month.closingRate)}</td>
                      <td className="text-right px-3 py-2 tabular-nums font-medium">{formatValue(month.closingValue)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {historyData?.grandTotal && (
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-muted font-bold border-t-2">
                    <td className="px-3 py-2 border-r">Total</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatQty(historyData.grandTotal.openingQty)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatRate(historyData.grandTotal.openingRate)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-muted-foreground">{formatValue(historyData.grandTotal.openingValue)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{formatQty(historyData.grandTotal.inwardQty)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{formatRate(historyData.grandTotal.inwardRate)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-green-700 dark:text-green-400">{formatValue(historyData.grandTotal.inwardValue)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{formatQty(historyData.grandTotal.outwardQty)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{formatRate(historyData.grandTotal.outwardRate)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-r text-red-700 dark:text-red-400">{formatValue(historyData.grandTotal.outwardValue)}</td>
                    <td className="text-right px-3 py-2 tabular-nums text-foreground">{formatQty(historyData.grandTotal.closingQty)}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{formatRate(historyData.grandTotal.closingRate)}</td>
                    <td className="text-right px-3 py-2 tabular-nums">{formatValue(historyData.grandTotal.closingValue)}</td>
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
