import { Edit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getVoucherTypeBadge } from "@/lib/voucherTypeBadge";
import { Voucher, ViewVoucherEntry } from "./types";

interface VoucherDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedVoucher: Voucher | null;
  viewEntriesLoading: boolean;
  viewVoucherEntries: ViewVoucherEntry[];
  isStockTransferVoucher: boolean;
  voucherRevisions: any[];
  revisionsLoading: boolean;
  formatAmount: (amt: any) => string;
  formatDisplayDate: (date: any) => string;
  formatDisplayTime: (date: string) => string;
  cashAccountBalance: string;
  entryBalances: Record<number, string>;
  purchaseOrderData: any;
  poSupplierBalance: string | null;
  selectedDialogRow: number | null;
  setSelectedDialogRow: (n: number | null) => void;
  viewProfitFilter: "all" | "gain" | "loss" | "even";
  setViewProfitFilter: (v: "all" | "gain" | "loss" | "even") => void;
  user: any;
  handleEdit: (v: Voucher) => void;
  canEdit: (v: Voucher) => boolean;
  navigate: (path: string) => void;
}

export function VoucherDetailsDialog({
  open,
  onOpenChange,
  selectedVoucher,
  viewEntriesLoading,
  viewVoucherEntries,
  isStockTransferVoucher,
  voucherRevisions,
  revisionsLoading,
  formatAmount,
  formatDisplayDate,
  formatDisplayTime,
  entryBalances,
  selectedDialogRow,
  setSelectedDialogRow,
  viewProfitFilter,
  setViewProfitFilter,
  user,
  handleEdit,
  canEdit,
}: VoucherDetailsDialogProps) {
  if (!selectedVoucher) return null;

  const isPOSUser = !user || user?.role === "POS";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>Voucher Details</DialogTitle>
            <Badge {...getVoucherTypeBadge(selectedVoucher.voucherType)}>{selectedVoucher.voucherType}</Badge>
          </div>
          <DialogDescription>
            {selectedVoucher.voucherNumber} — {formatDisplayDate(selectedVoucher.voucherDate)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Description</span>
              <p className="text-sm leading-relaxed">{selectedVoucher.description || "No description provided."}</p>
            </div>
            <div className="space-y-1 md:text-right">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Created At</span>
              <p className="text-sm font-mono">
                {formatDisplayDate(selectedVoucher.createdAt)} {formatDisplayTime(selectedVoucher.createdAt)}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                Entries
                {viewEntriesLoading && <Skeleton className="h-4 w-4 rounded-full" />}
              </h3>
              {(selectedVoucher.voucherType === "Sales" || selectedVoucher.voucherType === "POS") && !isPOSUser && (
                <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
                  {(["all", "gain", "loss", "even"] as const).map((filter) => (
                    <Button
                      key={filter}
                      variant={viewProfitFilter === filter ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs px-2.5 capitalize"
                      onClick={() => setViewProfitFilter(filter)}
                    >
                      {filter}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {viewEntriesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                {selectedVoucher.voucherType === "Sales" || selectedVoucher.voucherType === "POS" ? (
                  (() => {
                    const salesItems = viewVoucherEntries.filter((e) => e.isStockItem || e.stockItemId);
                    const ledgerEntries = viewVoucherEntries.filter((e) => !e.isStockItem && !e.stockItemId);
                    const filteredItems = salesItems.filter((e) => {
                      if (viewProfitFilter === "all") return true;
                      const profit = parseFloat(e.profit || "0");
                      if (viewProfitFilter === "gain") return profit > 0.01;
                      if (viewProfitFilter === "loss") return profit < -0.01;
                      return Math.abs(profit) <= 0.01;
                    });

                    return (
                      <div className="space-y-6">
                        <Table>
                          <TableHeader className="sticky top-0 z-30 bg-background">
                            <TableRow>
                              <TableHead>Item</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              {!isPOSUser && <TableHead className="text-right">Rate</TableHead>}
                              {!isPOSUser && <TableHead className="text-right">Total</TableHead>}
                              {!isPOSUser && <TableHead className="text-right">Profit</TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredItems.map((entry, idx) => {
                              const isSelected = selectedDialogRow === idx;
                              const profit = parseFloat(entry.profit || "0");
                              const pColor =
                                profit > 0.01
                                  ? "text-emerald-600"
                                  : profit < -0.01
                                    ? "text-destructive"
                                    : "text-muted-foreground";
                              return (
                                <TableRow
                                  key={entry.id}
                                  data-dialog-row={idx}
                                  className={isSelected ? "bg-accent/40" : ""}
                                  onClick={() => setSelectedDialogRow(idx)}
                                >
                                  <TableCell className="font-medium">
                                    {entry.stockItemName || entry.accountName}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.quantity || "0")}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <TableCell className="text-right font-mono">{formatAmount(entry.rate)}</TableCell>
                                  )}
                                  {!isPOSUser && (
                                    <TableCell className="text-right font-mono">
                                      {formatAmount(entry.totalAmount)}
                                    </TableCell>
                                  )}
                                  {!isPOSUser && (
                                    <TableCell className={`text-right font-mono font-medium ${pColor}`}>
                                      {formatAmount(profit)}
                                    </TableCell>
                                  )}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>

                        {ledgerEntries.length > 0 && (
                          <div className="border-t">
                            <Table>
                              <TableHeader className="sticky top-0 z-30 bg-background">
                                <TableRow>
                                  <TableHead>Account</TableHead>
                                  {!isPOSUser && (
                                    <>
                                      <TableHead className="text-right">Debit</TableHead>
                                      <TableHead className="text-right">Credit</TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {ledgerEntries.map((entry) => (
                                  <TableRow key={entry.id}>
                                    <TableCell>
                                      <div className="font-medium">{entry.accountName}</div>
                                    </TableCell>
                                    {!isPOSUser && (
                                      <>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.debitAmount) > 0 ? formatAmount(entry.debitAmount) : "-"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.creditAmount) > 0 ? formatAmount(entry.creditAmount) : "-"}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          {selectedVoucher.voucherType === "Consumption" ||
                          selectedVoucher.voucherType === "Production" ||
                          selectedVoucher.voucherType === "Mixed" ||
                          selectedVoucher.voucherType === "Stock Transfer" ||
                          selectedVoucher.voucherType === "StockTransfer" ? (
                            <>
                              <TableHead>Item Name</TableHead>
                              {selectedVoucher.voucherType === "Mixed" && <TableHead>Type</TableHead>}
                              <TableHead className="text-right">Qty</TableHead>
                              {user && user?.role !== "POS" && (
                                <>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead className="text-right">Total Amount</TableHead>
                                </>
                              )}
                            </>
                          ) : selectedVoucher.voucherType === "Payment" ||
                            selectedVoucher.voucherType === "Receipt" ||
                            selectedVoucher.voucherType === "Journal" ? (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </>
                          ) : (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">Debit</TableHead>
                              <TableHead className="text-right">Credit</TableHead>
                              <TableHead>Narration</TableHead>
                            </>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          if (
                            selectedVoucher.voucherType === "Consumption" ||
                            selectedVoucher.voucherType === "Production" ||
                            selectedVoucher.voucherType === "Mixed" ||
                            selectedVoucher.voucherType === "Stock Transfer" ||
                            selectedVoucher.voucherType === "StockTransfer"
                          ) {
                            return viewVoucherEntries.map((entry) => {
                              const qty = parseFloat(entry.quantity || "0");
                              const rate = entry.rate != null ? parseFloat(entry.rate) : 0;
                              const totalAmount =
                                entry.totalAmount != null ? parseFloat(entry.totalAmount) : qty * rate;
                              return (
                                <TableRow key={entry.id}>
                                  <TableCell>
                                    <div className="font-medium">{entry.stockItemName || entry.accountName}</div>
                                  </TableCell>
                                  {selectedVoucher.voucherType === "Mixed" && (
                                    <TableCell>
                                      <Badge variant={entry.adjustmentType === "Production" ? "default" : "secondary"}>
                                        {entry.adjustmentType || (qty > 0 ? "Production" : "Consumption")}
                                      </Badge>
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right font-mono">
                                    {Math.round(Math.abs(qty)).toLocaleString()}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <>
                                      <TableCell className="text-right font-mono">{formatAmount(rate)}</TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(totalAmount)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              );
                            });
                          }

                          const displayEntries =
                            selectedVoucher.voucherType === "Payment" ||
                            selectedVoucher.voucherType === "Receipt" ||
                            selectedVoucher.voucherType === "Journal"
                              ? viewVoucherEntries.filter((entry) => {
                                  if (selectedVoucher.voucherType === "Payment")
                                    return parseFloat(entry.debitAmount || "0") > 0;
                                  if (selectedVoucher.voucherType === "Receipt")
                                    return parseFloat(entry.creditAmount || "0") > 0;
                                  return true;
                                })
                              : viewVoucherEntries;

                          return displayEntries.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <div className="font-medium">{entry.accountName}</div>
                                {(selectedVoucher.voucherType === "Payment" ||
                                  selectedVoucher.voucherType === "Receipt" ||
                                  selectedVoucher.voucherType === "Journal") && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    Balance: {formatAmount(entryBalances[entry.id] ?? "0")}
                                  </div>
                                )}
                              </TableCell>
                              {selectedVoucher.voucherType === "Payment" ||
                              selectedVoucher.voucherType === "Receipt" ||
                              selectedVoucher.voucherType === "Journal" ? (
                                <TableCell className="text-right font-mono">
                                  {formatAmount(
                                    Math.max(
                                      parseFloat(entry.debitAmount || "0"),
                                      parseFloat(entry.creditAmount || "0")
                                    )
                                  )}
                                </TableCell>
                              ) : (
                                <>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.debitAmount) > 0 ? formatAmount(entry.debitAmount) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.creditAmount) > 0 ? formatAmount(entry.creditAmount) : "-"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {entry.narration || "-"}
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ));
                        })()}
                        {selectedVoucher.voucherType !== "Mixed" && (
                          <TableRow className="font-bold bg-muted/50">
                            {selectedVoucher.voucherType === "Consumption" ||
                            selectedVoucher.voucherType === "Production" ||
                            selectedVoucher.voucherType === "Stock Transfer" ||
                            selectedVoucher.voucherType === "StockTransfer" ? (
                              <>
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right font-mono">
                                  {viewVoucherEntries
                                    .reduce((sum, e) => sum + Math.abs(parseFloat(e.quantity || "0")), 0)
                                    .toFixed(3)
                                    .replace(/\.?0+$/, "")}
                                </TableCell>
                                {user && user?.role !== "POS" && (
                                  <>
                                    <TableCell></TableCell>
                                    <TableCell className="text-right font-mono">
                                      {formatAmount(
                                        viewVoucherEntries.reduce((sum, e) => {
                                          if (e.totalAmount != null) return sum + Math.abs(parseFloat(e.totalAmount));
                                          const qty = Math.abs(parseFloat(e.quantity || "0"));
                                          const rate = e.rate != null ? parseFloat(e.rate) : 0;
                                          return sum + qty * rate;
                                        }, 0)
                                      )}
                                    </TableCell>
                                  </>
                                )}
                              </>
                            ) : selectedVoucher.voucherType === "Payment" ||
                              selectedVoucher.voucherType === "Receipt" ||
                              selectedVoucher.voucherType === "Journal" ? (
                              <>
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(
                                    Math.max(
                                      viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0),
                                      viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0)
                                    )
                                  )}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(
                                    viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0)
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(
                                    viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0)
                                  )}
                                </TableCell>
                                <TableCell></TableCell>
                              </>
                            )}
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {selectedVoucher.voucherType === "Mixed" && (
                      <div className="flex items-center justify-between px-4 py-3 border-t font-bold">
                        <div className="flex items-center gap-4">
                          <span>Total</span>
                          <span className="font-mono text-sm text-muted-foreground">
                            {viewVoucherEntries
                              .reduce((sum, e) => sum + Math.abs(parseFloat(e.quantity || "0")), 0)
                              .toFixed(3)
                              .replace(/\.?0+$/, "")}{" "}
                            units
                          </span>
                        </div>
                        {user && user?.role !== "POS" && (
                          <span className="font-mono">
                            {(() => {
                              const prodTotal = viewVoucherEntries
                                .filter(
                                  (e) =>
                                    e.adjustmentType === "Production" ||
                                    (e.adjustmentType == null && parseFloat(e.quantity || "0") > 0)
                                )
                                .reduce((sum, e) => sum + Math.abs(parseFloat(e.totalAmount || "0")), 0);
                              const consTotal = viewVoucherEntries
                                .filter(
                                  (e) =>
                                    e.adjustmentType === "Consumption" ||
                                    (e.adjustmentType == null && parseFloat(e.quantity || "0") < 0)
                                )
                                .reduce((sum, e) => sum + Math.abs(parseFloat(e.totalAmount || "0")), 0);
                              return formatAmount(prodTotal - consTotal);
                            })()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isStockTransferVoucher && (revisionsLoading || voucherRevisions.length > 0) && (
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Revision History</h3>
                {revisionsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
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
                                          className={`py-1.5 text-right font-mono text-sm font-semibold ${delta > 0 ? "text-green-600 dark:text-green-400" : delta < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
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
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-view-dialog">
            Close
          </Button>
          {canEdit(selectedVoucher) && (
            <Button
              onClick={() => {
                onOpenChange(false);
                handleEdit(selectedVoucher);
              }}
              data-testid="button-edit-from-view-dialog"
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
