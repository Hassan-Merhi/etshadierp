/**
 * DetailDialog — extracted from StockTransferOrder.tsx during the Phase 4 split.
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

export function DetailDialog({
  detailData,
  detailDirection,
  detailLoading,
  detailMonthName,
  detailOpen,
  detailYear,
  formatAmount,
  historyItem,
  historyLocation,
  setDetailOpen,
}: {
  detailData: unknown;
  detailDirection: unknown;
  detailLoading: unknown;
  detailMonthName: unknown;
  detailOpen: unknown;
  detailYear: unknown;
  formatAmount: unknown;
  historyItem: unknown;
  historyLocation: unknown;
  setDetailOpen: unknown;
}) {
  return (
    <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
      <DialogContent className="max-w-2xl flex flex-col" style={{ maxHeight: "75vh" }}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {detailDirection === "in" ? (
              <span className="text-green-700 dark:text-green-400">Stock In</span>
            ) : (
              <span className="text-red-700 dark:text-red-400">Stock Out</span>
            )}
            <span className="text-muted-foreground font-normal">—</span>
            <span>
              {detailMonthName} {detailYear}
            </span>
          </DialogTitle>
          <DialogDescription>
            {historyItem?.name} · {historyLocation?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0 border rounded-md">
          {detailLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            (() => {
              const rows =
                detailDirection === "in" ? (detailData?.inTransactions ?? []) : (detailData?.outTransactions ?? []);

              const typeBadgeClass = (type: string) => {
                if (type === "Sale") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
                if (type.startsWith("Transfer In"))
                  return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
                if (type.startsWith("Transfer Out"))
                  return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
                if (type.startsWith("Adjustment"))
                  return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
                if (type === "Credit Note")
                  return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
                return "bg-muted text-muted-foreground";
              };

              if (!rows.length) {
                return (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    No transactions found for this period.
                  </div>
                );
              }

              const totalQty = rows.reduce((s: number, r: unknown) => s + (r.qty || 0), 0);
              const totalValue = rows.reduce((s: number, r: unknown) => s + (r.value || 0), 0);
              const avgRate = totalQty > 0 ? totalValue / totalQty : 0;

              return (
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-muted border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Type</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Reference</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Rate</th>
                      <th className="text-right px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((tx: unknown, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(tx.type)}`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{tx.date}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tx.reference}</td>
                        <td className="text-right px-3 py-2 tabular-nums font-medium">
                          {(tx.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums text-muted-foreground">
                          {(tx.rate || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="text-right px-3 py-2 tabular-nums">{formatAmount(tx.value || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-muted border-t-2 font-semibold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                        {rows.length} transaction{rows.length !== 1 ? "s" : ""} · Avg rate:{" "}
                        {avgRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums">
                        {totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td />
                      <td className="text-right px-3 py-2 tabular-nums">{formatAmount(totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          )}
        </div>

        <DialogFooter className="flex-shrink-0 pt-2">
          <Button variant="outline" onClick={() => setDetailOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
