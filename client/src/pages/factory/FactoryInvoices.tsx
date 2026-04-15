import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation } from "wouter";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Eye, Trash2, RotateCcw, Download } from "lucide-react";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

interface CustomerOrder {
  id: number;
  companyId: number;
  customerId: number;
  orderDate: string;
  status: string;
  invoiceNumber?: string;
  subtotalBales: string;
  freightAmount: string;
  otherChargesTotal: string;
  grandTotal: string;
  totalQtyBales: number;
  totalWeightKg: string;
  customerName: string;
}

export default function FactoryInvoices() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { formatDisplayDate } = useDateFormat();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");

  const { data: customers = [], isLoading: customersLoading, isError: customersError } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const queryParams = new URLSearchParams();
  if (customerFilter !== "all") queryParams.set("customerId", customerFilter);
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  const queryString = queryParams.toString();

  const { data: orders = [], isLoading: ordersLoading, isError: ordersError } = useQuery<CustomerOrder[]>({
    queryKey: [`/api/factory/customer-orders?${queryString}`, statusFilter, customerFilter],
  });

  const deleteMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/customer-orders/${orderId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Invoice deleted successfully." });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const unfinalizeMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/unfinalize`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to revert invoice");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reverted to Pending", description: "Invoice has been reverted. You can now edit and re-finalize it." });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Cannot Revert", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary" data-testid={`badge-status-draft`}>Draft</Badge>;
      case "LOADING":
        return <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-400" data-testid={`badge-status-loading`}>Loading</Badge>;
      case "PENDING_VERIFICATION":
        return <Badge variant="outline" className="border-yellow-300 text-yellow-700 dark:border-yellow-600 dark:text-yellow-400" data-testid={`badge-status-pending`}>Pending Verification</Badge>;
      case "VERIFIED":
        return <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-600 dark:text-green-400" data-testid={`badge-status-verified`}>Verified</Badge>;
      case "FINALIZED":
        return <Badge variant="default" data-testid={`badge-status-finalized`}>Finalized</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" data-testid={`badge-status-cancelled`}>Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const isLoading = ordersLoading || customersLoading;

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">Customer Invoices</h1>
          <p className="text-muted-foreground text-sm sm:text-base">View and manage customer orders and invoices</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="w-48">
          <label className="text-sm font-medium mb-1 block">Status</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-status-filter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="LOADING">Loading</SelectItem>
              <SelectItem value="PENDING_VERIFICATION">Pending Verification</SelectItem>
              <SelectItem value="VERIFIED">Verified</SelectItem>
              <SelectItem value="FINALIZED">Finalized</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-56">
          <label className="text-sm font-medium mb-1 block">Customer</label>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger data-testid="select-customer-filter">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-customer-option-${c.id}`}>
                  {c.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(customersError || ordersError) && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="error-invoices-load">
          Failed to load data. Please check your connection or try refreshing the page.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Bales</TableHead>
                <TableHead className="text-right">Total Weight (kg)</TableHead>
                <TableHead className="text-right">Grand Total</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8" data-testid="text-no-orders">
                    No invoices found
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/factory/sales/invoices/${order.id}`)}
                    data-testid={`row-order-${order.id}`}
                  >
                    <TableCell className="font-mono" data-testid={`text-invoice-number-${order.id}`}>
                      {order.invoiceNumber || `Draft #${order.id}`}
                    </TableCell>
                    <TableCell data-testid={`text-customer-name-${order.id}`}>
                      {order.customerName}
                    </TableCell>
                    <TableCell className="font-mono text-sm" data-testid={`text-order-date-${order.id}`}>
                      {order.orderDate ? formatDisplayDate(order.orderDate) : "-"}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(order.status)}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-total-bales-${order.id}`}>
                      {order.totalQtyBales ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-total-weight-${order.id}`}>
                      {parseFloat(order.totalWeightKg || "0") > 0
                        ? parseFloat(order.totalWeightKg).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold" data-testid={`text-grand-total-${order.id}`}>
                      ${parseFloat(order.grandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => window.open(`/api/factory/customer-orders/${order.id}/export-pdf`, "_blank")}
                          data-testid={`button-download-pdf-${order.id}`}
                          title="Download Invoice PDF"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/factory/sales/invoices/${order.id}`)}
                          data-testid={`button-view-order-${order.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        {order.status === "FINALIZED" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={unfinalizeMutation.isPending}
                                data-testid={`button-revert-order-${order.id}`}
                              >
                                <RotateCcw className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revert to Pending</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will revert invoice {order.invoiceNumber} for {order.customerName} back to Pending Verification status.
                                  The invoice number will be voided, all bales will return to stock, and the customer balance entry will be removed.
                                  This cannot be done if any payment has been recorded against this invoice.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid={`button-cancel-revert-${order.id}`}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => unfinalizeMutation.mutate(order.id)}
                                  data-testid={`button-confirm-revert-${order.id}`}
                                >
                                  Revert to Pending
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {order.status !== "FINALIZED" && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-testid={`button-delete-order-${order.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete invoice {order.invoiceNumber || `#${order.id}`} for {order.customerName}. 
                                  Any bales assigned to this order will be returned to stock. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid={`button-cancel-delete-${order.id}`}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(order.id)}
                                  data-testid={`button-confirm-delete-${order.id}`}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
