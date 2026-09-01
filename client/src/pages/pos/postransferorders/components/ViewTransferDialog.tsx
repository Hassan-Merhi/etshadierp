/**
 * ViewTransferDialog — extracted sub-component.
 *
 * Extracted from PosTransferOrders.tsx during the Phase 4 god-file split.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Lock, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { TransferDetail } from "../types";
import { fmtQty, formatDate, formatDateTime } from "../utils";

type RevisionStatus = "pending" | "approved" | "rejected" | "cancelled" | "superseded";

function revisionStatus(revision: { status?: RevisionStatus; optional: boolean }): RevisionStatus {
  return revision.status ?? (revision.optional ? "pending" : "approved");
}

function RevisionStatusBadge({ status }: { status: RevisionStatus }) {
  if (status === "approved") {
    return (
      <Badge variant="default" className="text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Approved
      </Badge>
    );
  }
  if (status === "pending")
    return (
      <Badge variant="outline" className="text-xs">
        Pending Admin Review
      </Badge>
    );
  if (status === "rejected" || status === "cancelled") {
    return (
      <Badge variant="destructive" className="text-xs">
        <XCircle className="h-3 w-3 mr-1" /> {status === "rejected" ? "Rejected" : "Cancelled"}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      <AlertTriangle className="h-3 w-3 mr-1" /> Superseded
    </Badge>
  );
}

export // ─── View-only dialog ─────────────────────────────────────────────────────────
function ViewTransferDialog({
  voucherId,
  open,
  onClose,
}: {
  voucherId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: detail, isLoading } = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!voucherId && open,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.voucherNumber ?? "Transfer Order"}
            {detail?.inventoryApplied && (
              <Badge variant="secondary" className="gap-1 text-xs font-normal">
                <Lock className="h-3 w-3" />
                Applied
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${formatDate(detail.voucherDate)} · ${detail.sourceLocationName} → ${detail.destinationLocationName}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-xs py-2">#</TableHead>
                    <TableHead className="text-xs py-2">Item</TableHead>
                    <TableHead className="text-right text-xs py-2">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground py-2">{idx + 1}</TableCell>
                      <TableCell className="text-sm font-medium py-2">{item.stockItemName}</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2">{fmtQty(item.quantity)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/20 font-semibold">
                    <TableCell />
                    <TableCell className="text-xs py-2">Total</TableCell>
                    <TableCell className="text-right font-mono text-sm py-2">
                      {fmtQty(detail.items.reduce((s, i) => s + parseFloat(i.quantity), 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {(detail.revisions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Revision History
                  </span>
                </div>
                {detail.revisions.map((rev) => {
                  const revLocName = rev.sourceLocationName ?? rev.items[0]?.sourceLocationName ?? null;
                  const status = revisionStatus(rev);
                  return (
                    <Card key={rev.id}>
                      <CardContent className="pt-3 pb-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Revision #{rev.revisionNumber}</span>
                            <span className="text-xs text-muted-foreground">
                              · <span className="font-medium text-foreground">{revLocName || "Unknown"}</span>
                              {" → "}
                              <span className="font-medium text-foreground">
                                {rev.destinationLocationName || detail.destinationLocationName}
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                          </div>
                          <RevisionStatusBadge status={status} />
                        </div>
                        {rev.note && <p className="text-xs text-muted-foreground italic">{rev.note}</p>}
                        {rev.rejectionReason && (
                          <p className="text-xs text-destructive">Reason: {rev.rejectionReason}</p>
                        )}
                        <div className="rounded-md border overflow-hidden">
                          <div className="grid grid-cols-[1fr_auto_auto_auto] bg-muted/30 border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-x-4">
                            <span>Item</span>
                            <span className="text-right">Was</span>
                            <span className="text-right">Now</span>
                            <span className="text-right">Change</span>
                          </div>
                          {rev.items
                            .filter((ri) => parseFloat(ri.delta) !== 0)
                            .map((ri, i) => {
                              const delta = parseFloat(ri.delta);
                              return (
                                <div
                                  key={i}
                                  className="grid grid-cols-[1fr_auto_auto_auto] items-center px-3 py-2 text-xs gap-x-4 bg-card border-b last:border-b-0"
                                >
                                  <span className="font-medium">{ri.stockItemName}</span>
                                  <span className="font-mono text-right text-muted-foreground">
                                    {fmtQty(ri.originalQuantity)}
                                  </span>
                                  <span className="font-mono font-semibold text-right">{fmtQty(ri.newQuantity)}</span>
                                  <span
                                    className={cn(
                                      "font-mono font-semibold text-right",
                                      delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive"
                                    )}
                                  >
                                    {delta > 0 ? "+" : ""}
                                    {fmtQty(ri.delta)}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive py-4">Failed to load order.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main list view ───────────────────────────────────────────────────────────
