import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, DollarSign, Package, Eye, Lock } from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  locationId: number;
  locationName?: string;
  createdAt: string;
}

interface SalesItem {
  id: number;
  stockItemId: number;
  stockItemName?: string;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
}

interface VoucherWithItems extends Voucher {
  salesItems?: SalesItem[];
}

export default function POSDaybook() {
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherWithItems | null>(null);
  const [, navigate] = useLocation();

  // Get today's date range
  const today = new Date();
  const startDate = format(startOfDay(today), "yyyy-MM-dd");
  const endDate = format(endOfDay(today), "yyyy-MM-dd");

  // Fetch user permissions
  const { data: currentUser, isLoading: isLoadingUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // Only allow editing if explicitly permitted - defaults to false for safety
  const canEditDaybook = currentUser?.canEditDaybook === true;

  // Fetch today's sales vouchers
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers", { startDate, endDate }],
  });

  // Filter to show only Sales vouchers
  const salesVouchers = vouchers.filter((v) => v.voucherType === "Sales");

  // Fetch voucher details when viewing
  const { data: voucherDetails, isLoading: detailsLoading } = useQuery<VoucherWithItems>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}`] : [],
    enabled: !!selectedVoucher,
  });

  const totalSales = salesVouchers.reduce((sum, v) => sum + parseFloat(v.totalAmount), 0);
  const transactionCount = salesVouchers.length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            POS Daybook
          </h1>
          <p className="text-muted-foreground mt-1">
            Today's sales transactions - {format(today, "MMMM dd, yyyy")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Today's Transactions
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-transaction-count">
                {transactionCount}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Sales
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-sales">
                ${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Average Transaction
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-avg-transaction">
                ${transactionCount > 0 
                  ? (totalSales / transactionCount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "0.00"
                }
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : salesVouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No sales today</p>
              <p className="text-sm mt-1">Sales transactions will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesVouchers.map((voucher) => (
                    <TableRow
                      key={voucher.id}
                      data-testid={`row-voucher-${voucher.id}`}
                    >
                      <TableCell className="font-mono text-sm">
                        {format(new Date(voucher.createdAt), "hh:mm a")}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">
                        {voucher.voucherNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {voucher.locationName || `Location ${voucher.locationId}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        ${parseFloat(voucher.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm">
                        {voucher.description || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedVoucher(voucher as VoucherWithItems)}
                          data-testid={`button-view-${voucher.id}`}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Details Dialog */}
      <Dialog open={!!selectedVoucher} onOpenChange={() => setSelectedVoucher(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Transaction Details - {selectedVoucher?.voucherNumber}
            </DialogTitle>
            <div className="flex items-center gap-4 pt-2 text-sm text-muted-foreground">
              <span>{selectedVoucher && format(new Date(selectedVoucher.createdAt), "MMM dd, yyyy 'at' hh:mm a")}</span>
              <span>•</span>
              <span>{selectedVoucher?.locationName || `Location ${selectedVoucher?.locationId}`}</span>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {detailsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : voucherDetails?.salesItems && voucherDetails.salesItems.length > 0 ? (
              <div className="space-y-4">
                {voucherDetails?.description && (
                  <div className="border-b pb-4">
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="text-sm mt-1">{voucherDetails.description}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Items Sold</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherDetails.salesItems.map((item: any, idx: number) => (
                        <TableRow key={item.id || idx}>
                          <TableCell className="font-medium">
                            {item.stockItemName || `Item ${item.stockItemId}`}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(item.quantity).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${parseFloat(item.sellingPrice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${parseFloat(item.totalSales).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="border-t pt-4 flex justify-end gap-8">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Sales: </span>
                    <span className="font-mono font-semibold">
                      ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalSales), 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Cost: </span>
                    <span className="font-mono font-semibold">
                      ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalCost), 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Total Profit: </span>
                    <span className="font-mono font-semibold text-green-600 dark:text-green-500">
                      ${voucherDetails.salesItems.reduce((sum: number, item: any) => sum + parseFloat(item.profit), 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No items found for this transaction
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setSelectedVoucher(null)} data-testid="button-close">
              Close
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      onClick={() => {
                        if (canEditDaybook) {
                          setSelectedVoucher(null);
                          navigate(`/vouchers/${selectedVoucher?.id}/edit`);
                        }
                      }}
                      disabled={!canEditDaybook}
                      className={!canEditDaybook ? "opacity-50 cursor-not-allowed" : ""}
                      data-testid="button-edit-transaction"
                    >
                      {!canEditDaybook && <Lock className="h-4 w-4 mr-2" />}
                      Edit Transaction
                    </Button>
                  </div>
                </TooltipTrigger>
                {!canEditDaybook && (
                  <TooltipContent>
                    <p>You don't have permission to edit daybook transactions</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
