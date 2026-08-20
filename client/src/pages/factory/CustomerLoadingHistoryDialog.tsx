import { ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, formatNumber } from "./customerLoadingFormat";
import type { CustomerLoadingProduct, HistoryResponse } from "./customerLoadingTypes";

interface CustomerLoadingHistoryDialogProps {
  product: CustomerLoadingProduct | null;
  onClose: () => void;
  customerName?: string;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  data?: HistoryResponse;
}

export function CustomerLoadingHistoryDialog({
  product,
  onClose,
  customerName,
  isLoading,
  isError,
  error,
  data,
}: CustomerLoadingHistoryDialogProps) {
  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{product?.name} · Loading History</DialogTitle>
          <DialogDescription>{customerName} · source loading sessions for this product</DialogDescription>
        </DialogHeader>
        <div className="overflow-auto p-6">
          {isLoading ? (
            <div className="flex min-h-[180px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : isError ? (
            <div className="text-sm text-destructive">{error?.message}</div>
          ) : data?.history.length ? (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Truck / Driver</th>
                  <th className="px-3 py-2 text-right">Bales</th>
                  <th className="px-3 py-2 text-right">KG</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={`${row.sessionId}-${row.invoiceId}`} className="border-b">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTime(row.lastScanAt || row.completedAt || row.startedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/factory/sales/invoices/${row.invoiceId}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        Invoice #{row.invoiceId}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.truckNo || "—"}</div>
                      <div className="text-xs text-muted-foreground">{row.driverName || ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatNumber(row.balesLoaded)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.kgLoaded, 1)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{row.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No non-cancelled loading history found.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
