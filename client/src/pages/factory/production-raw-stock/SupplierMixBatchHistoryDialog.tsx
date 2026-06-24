import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Layers, Trash2 } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SupplierMixBatchHistoryDialogProps {
  supplierId: number | null;
  supplierName: string;
  open: boolean;
  onClose: () => void;
}

interface MixBatchHistoryRow {
  batchId: number;
  batchCode: string;
  batchName: string | null;
  batchDate: string | null;
  batchStatus: string;
  deletedAt: string | null;
  batchCreatedAt: string;
  sourceId: number;
  weightKg: string;
  costPerKg: string;
  totalCost: string;
  sourceCreatedAt: string;
}

export function SupplierMixBatchHistoryDialog({
  supplierId,
  supplierName,
  open,
  onClose,
}: SupplierMixBatchHistoryDialogProps) {
  const { data: history = [], isLoading } = useQuery<MixBatchHistoryRow[]>({
    queryKey: ["/api/factory/suppliers", supplierId, "mix-batch-history"],
    enabled: open && supplierId !== null,
  });

  const totalKg = history.reduce((s, r) => s + parseFloat(r.weightKg || "0"), 0);
  const deletedCount = history.filter((r) => r.deletedAt).length;
  const activeCount = history.filter((r) => !r.deletedAt).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Mix Batch History — {supplierName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{history.length}</span> total entries
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="font-medium text-foreground">{activeCount}</span> active
          </span>
          {deletedCount > 0 && (
            <>
              <span className="text-border">|</span>
              <span className="text-destructive">
                <span className="font-medium">{deletedCount}</span> deleted
              </span>
            </>
          )}
          <span className="text-border">|</span>
          <span>
            Total: <span className="font-medium text-foreground">{formatNumber(totalKg)} kg</span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
              No mix batch history found for this supplier.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-3">Batch</TableHead>
                  <TableHead className="py-3">Date</TableHead>
                  <TableHead className="text-right py-3">Weight (kg)</TableHead>
                  <TableHead className="text-right py-3">Cost/kg</TableHead>
                  <TableHead className="py-3">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => {
                  const isDeleted = !!row.deletedAt;
                  return (
                    <TableRow
                      key={row.sourceId}
                      className={isDeleted ? "opacity-50" : ""}
                      data-testid={`row-mix-batch-history-${row.sourceId}`}
                    >
                      <TableCell className="py-2.5">
                        <div className="flex flex-col">
                          <span className="font-medium text-sm font-mono">{row.batchCode}</span>
                          {row.batchName && (
                            <span className="text-[11px] text-muted-foreground">{row.batchName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm text-muted-foreground">
                        <div className="flex flex-col">
                          {row.batchDate
                            ? format(new Date(row.batchDate), "dd MMM yyyy")
                            : format(new Date(row.batchCreatedAt), "dd MMM yyyy")}
                          <span className="text-[10px] opacity-70">
                            Added {format(new Date(row.sourceCreatedAt), "dd MMM yyyy, HH:mm")}
                          </span>
                          {isDeleted && (
                            <span className="text-[10px] text-destructive">
                              Deleted {format(new Date(row.deletedAt!), "dd MMM yyyy, HH:mm")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5">
                        {formatNumber(parseFloat(row.weightKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm py-2.5 text-muted-foreground">
                        ${parseFloat(row.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell className="py-2.5">
                        {isDeleted ? (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <Trash2 className="h-2.5 w-2.5" />
                            Deleted
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                          >
                            {row.batchStatus}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
