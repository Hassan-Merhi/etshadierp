/**
 * Stock-transfer revision history block of the voucher details dialog.
 *
 * Split out of VoucherDetailsDialog.tsx unchanged: same loading/error/empty
 * states, same retry affordance, same zero-delta filtering and the same
 * merged POS-adjustment badge.
 */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function deltaClass(delta: number): string {
  if (delta > 0) return "text-green-600 dark:text-green-400";
  if (delta < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

export function VoucherRevisionHistory({
  voucherRevisions,
  revisionsLoading,
  revisionsError,
  revisionsErrorMessage,
  retryVoucherRevisions,
}: {
  voucherRevisions: any[];
  revisionsLoading: boolean;
  revisionsError: boolean;
  revisionsErrorMessage?: string;
  retryVoucherRevisions: () => void;
}) {
  return (
    <div className="space-y-4" data-testid="stock-transfer-revision-history">
      <h3 className="font-semibold text-lg">Revision History</h3>
      {revisionsLoading ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm text-muted-foreground">Loading revision history…</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : revisionsError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <p className="text-sm font-medium">Could not load revision history</p>
          {revisionsErrorMessage && <p className="text-xs text-muted-foreground">{revisionsErrorMessage}</p>}
          <Button type="button" variant="outline" size="sm" onClick={retryVoucherRevisions}>
            Retry
          </Button>
        </div>
      ) : voucherRevisions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No revisions recorded for this transfer</p>
        </div>
      ) : (
        <div className="space-y-3">
          {voucherRevisions.map((rev) => (
            <div key={rev.id} className="border rounded-md p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Rev #{rev.revisionNumber}</span>
                  {rev.optional && (
                    <Badge variant="outline" className="text-xs">
                      POS Adjustment{rev._mergedCount > 1 ? ` (${rev._mergedCount} submissions)` : ""}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {rev.createdAt ? new Date(rev.createdAt).toLocaleString() : ""}
                </span>
              </div>
              {rev.note && <p className="text-sm text-muted-foreground">{rev.note}</p>}
              {rev.items && rev.items.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs py-2">Item</TableHead>
                        <TableHead className="text-right text-xs py-2">Was</TableHead>
                        <TableHead className="text-right text-xs py-2">Now</TableHead>
                        <TableHead className="text-right text-xs py-2">Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rev.items
                        .filter((item: any) => parseFloat(item.delta ?? "0") !== 0)
                        .map((item: any, idx: number) => {
                          const delta = parseFloat(item.delta ?? "0");
                          return (
                            <TableRow key={idx}>
                              <TableCell className="py-1.5 text-sm">{item.stockItemName}</TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm text-muted-foreground">
                                {parseFloat(item.originalQuantity)}
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-mono text-sm font-semibold">
                                {parseFloat(item.newQuantity)}
                              </TableCell>
                              <TableCell
                                className={`py-1.5 text-right font-mono text-sm font-semibold ${deltaClass(delta)}`}
                              >
                                {delta > 0 ? "+" : ""}
                                {delta}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
