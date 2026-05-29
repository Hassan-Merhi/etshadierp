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
import { Eye, Trash2, RotateCcw, Download, FileSpreadsheet, FileText, Package, Container, ChevronRight, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient, keyStartsWith, invalidateCustomerBalances } from "@/lib/queryClient";
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
import { InvoiceSummaryBar } from "@/components/InvoiceSummaryBar";

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
  proformaExpectedBales: string;
  loadedNotInProformaBales: string;
  customerName: string;
  containerNumber?: string | null;
  proformaName?: string | null;
  destination?: string | null;
}

type StatusFilter = "LOADING" | "PENDING" | "VERIFIED" | "FINALIZED" | "ALL";

export default function FactoryInvoices() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { formatDisplayDate } = useDateFormat();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("LOADING");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [expandedCustomers, setExpandedCustomers] = useState<Set<number>>(new Set());

  const toggleCustomer = (customerId: number) => {
    setExpandedCustomers(prev => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const isAdmin = myAccess?.fullAccess === true;
  const hidden: string[] = myAccess?.hiddenCostFields ?? [];
  const hideProformaCol = !isAdmin || hidden.includes("hide_invoicing_proforma_col");
  const hideTotalsUsd = hidden.includes("hide_invoicing_totals_usd");

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const queryParams = new URLSearchParams();
  if (customerFilter !== "all") queryParams.set("customerId", customerFilter);
  const queryString = queryParams.toString();

  const { data: allOrders = [], isLoading, isError } = useQuery<CustomerOrder[]>({
    queryKey: [`/api/factory/customer-orders${queryString ? `?${queryString}` : ""}`, customerFilter],
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
      invalidateCustomerBalances();
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
      invalidateCustomerBalances();
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Cannot Revert", description: error.message, variant: "destructive" });
    },
  });

  const loadingCount  = allOrders.filter(o => o.status === "LOADING").length;
  const pendingCount  = allOrders.filter(o => o.status === "PENDING_VERIFICATION").length;
  const verifiedCount = allOrders.filter(o => o.status === "VERIFIED").length;
  const finalizedCount = allOrders.filter(o => o.status === "FINALIZED").length;

  const filteredOrders =
    statusFilter === "LOADING"  ? allOrders.filter(o => o.status === "LOADING") :
    statusFilter === "PENDING"  ? allOrders.filter(o => o.status === "PENDING_VERIFICATION") :
    statusFilter === "VERIFIED" ? allOrders.filter(o => o.status === "VERIFIED") :
    statusFilter === "FINALIZED" ? allOrders.filter(o => o.status === "FINALIZED") :
    allOrders;

  const statusFilters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "LOADING",  label: "Loading",  count: loadingCount  },
    { key: "PENDING",  label: "Pending",  count: pendingCount  },
    { key: "VERIFIED", label: "Verified", count: verifiedCount },
    { key: "FINALIZED", label: "Finalized", count: finalizedCount },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary">Draft</Badge>;
      case "LOADING":
        return <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-400">Loading</Badge>;
      case "PENDING_VERIFICATION":
        return <Badge variant="outline" className="border-yellow-300 text-yellow-700 dark:border-yellow-600 dark:text-yellow-400">Pending</Badge>;
      case "VERIFIED":
        return <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-600 dark:text-green-400">Verified</Badge>;
      case "FINALIZED":
        return <Badge variant="default">Finalized</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleRowClick = (order: CustomerOrder) => {
    if (order.status === "FINALIZED") {
      navigate(`/factory/sales/invoices/${order.id}`);
    } else {
      navigate(`/factory/sales/pending-invoices/${order.id}/verify`);
    }
  };

  // Per-order remaining: how many bales still needed to meet proforma target
  const getRemainingBales = (order: CustomerOrder): number => {
    const expected = parseFloat(order.proformaExpectedBales || "0");
    if (expected <= 0) return 0;
    return Math.max(0, expected - (order.totalQtyBales || 0));
  };

  // Estimate kg and price for remaining bales using the order's average
  const getEstimatedKg = (order: CustomerOrder, bales: number): number => {
    const loaded = order.totalQtyBales || 0;
    if (loaded <= 0) return 0;
    const avgWeight = parseFloat(order.totalWeightKg || "0") / loaded;
    return bales * avgWeight;
  };

  const getEstimatedPrice = (order: CustomerOrder, bales: number): number => {
    const loaded = order.totalQtyBales || 0;
    if (loaded <= 0) return 0;
    const avgPrice = parseFloat(order.grandTotal || "0") / loaded;
    return bales * avgPrice;
  };

  // Column count for colspan calculations
  const colCount = 9 - (hideProformaCol ? 1 : 0) - (hideTotalsUsd ? 1 : 0);

  const fmtKg = (val: string | number | null | undefined) => {
    const n = parseFloat(String(val ?? "0"));
    if (!n) return <span className="text-muted-foreground/40">—</span>;
    return <>{n.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</>;
  };

  // Group orders by customer, preserving first-appearance order
  const customerGroups = (() => {
    const seen = new Map<number, { customerId: number; customerName: string; orders: CustomerOrder[] }>();
    for (const order of filteredOrders) {
      if (!seen.has(order.customerId)) {
        seen.set(order.customerId, { customerId: order.customerId, customerName: order.customerName, orders: [] });
      }
      seen.get(order.customerId)!.orders.push(order);
    }
    return Array.from(seen.values());
  })();

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-tabs">
            {statusFilters.map((f) => (
              <Button
                key={f.key}
                variant={statusFilter === f.key ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.key)}
                data-testid={`button-filter-${f.key.toLowerCase()}`}
                className="text-xs px-3"
              >
                {f.label} <span className="ml-1 opacity-70">({f.count})</span>
              </Button>
            ))}
            <Button
              variant={statusFilter === "ALL" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setStatusFilter("ALL")}
              data-testid="button-filter-all"
              className="text-xs px-3 text-muted-foreground"
            >
              All ({allOrders.length})
            </Button>
          </div>

          <div className="w-56">
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
      </div>

      {isError && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="error-invoices-load">
          Failed to load data. Please check your connection or try refreshing the page.
        </div>
      )}

      {!isLoading && filteredOrders.length > 0 && (
        <InvoiceSummaryBar
          orders={filteredOrders}
          hideTotalsUsd={hideTotalsUsd}
          getRemainingBales={getRemainingBales}
          getEstimatedKg={getEstimatedKg}
          getEstimatedPrice={getEstimatedPrice}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <Card className="table-responsive">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Loading #</TableHead>
                {!hideProformaCol && <TableHead>Proforma</TableHead>}
                <TableHead>Container</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Bales</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                {!hideTotalsUsd && <TableHead className="text-right">Total</TableHead>}
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerGroups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8" data-testid="text-no-orders">
                    <div className="flex flex-col items-center gap-2">
                      <Package className="h-10 w-10 opacity-40" />
                      <p>No invoices found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customerGroups.map((group) => {
                  const isSingle = group.orders.length === 1;
                  const isExpanded = expandedCustomers.has(group.customerId);

                  const renderOrderRow = (order: CustomerOrder, indented = false) => {
                    const remaining = getRemainingBales(order);
                    const expected = parseFloat(order.proformaExpectedBales || "0");
                    const overloaded = expected > 0 ? Math.max(0, (order.totalQtyBales || 0) - expected) : 0;
                    return (
                      <TableRow
                        key={order.id}
                        className="cursor-pointer"
                        onClick={() => handleRowClick(order)}
                        data-testid={`row-order-${order.id}`}
                      >
                        <TableCell data-testid={`text-customer-name-${order.id}`}>
                          {indented ? (
                            <span className="pl-5 text-muted-foreground/50 text-xs">↳</span>
                          ) : (
                            order.customerName
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground" data-testid={`text-loading-number-${order.id}`}>
                          #{order.id}
                        </TableCell>
                        {!hideProformaCol && (
                          <TableCell className="text-sm text-muted-foreground" data-testid={`text-proforma-${order.id}`}>
                            {order.proformaName || <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm" data-testid={`text-container-${order.id}`}>
                          {order.containerNumber || <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-destination-${order.id}`}>
                          {order.destination || <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-order-date-${order.id}`}>
                          {order.orderDate ? formatDisplayDate(order.orderDate) : "-"}
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-total-bales-${order.id}`}>
                          {order.totalQtyBales ?? "-"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm" data-testid={`text-weight-${order.id}`}>
                          {fmtKg(order.totalWeightKg)}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-remaining-${order.id}`}>
                          {expected <= 0 ? (
                            <span className="text-muted-foreground/40">—</span>
                          ) : remaining > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-medium">{remaining}</span>
                          ) : overloaded > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">+{overloaded}</span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400 font-medium">Done</span>
                          )}
                        </TableCell>
                        {!hideTotalsUsd && (
                          <TableCell className="text-right font-mono font-semibold" data-testid={`text-grand-total-${order.id}`}>
                            ${parseFloat(order.grandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-download-${order.id}`} title="Download Invoice">
                                  <Download className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => window.open(`/api/factory/customer-orders/${order.id}/export/excel`, "_blank")} data-testid={`button-download-excel-${order.id}`}>
                                  <FileSpreadsheet className="h-4 w-4 mr-2" />Excel
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => window.open(`/api/factory/customer-orders/${order.id}/export-pdf`, "_blank")} data-testid={`button-download-pdf-${order.id}`}>
                                  <FileText className="h-4 w-4 mr-2" />PDF
                                </DropdownMenuItem>
                                {isAdmin && (
                                  <DropdownMenuItem onClick={() => window.open(`/api/factory/customer-orders/${order.id}/loading-status-export`, "_blank")} data-testid={`button-download-loading-status-${order.id}`}>
                                    <Container className="h-4 w-4 mr-2" />Loading Status + Bale Refs
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="ghost" size="icon" onClick={() => handleRowClick(order)} data-testid={`button-view-order-${order.id}`}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            {order.status === "FINALIZED" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" disabled={unfinalizeMutation.isPending} data-testid={`button-revert-order-${order.id}`}>
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
                                    <AlertDialogAction onClick={() => unfinalizeMutation.mutate(order.id)} data-testid={`button-confirm-revert-${order.id}`}>Revert to Pending</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {order.status !== "FINALIZED" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" data-testid={`button-delete-order-${order.id}`}>
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
                                    <AlertDialogAction onClick={() => deleteMutation.mutate(order.id)} data-testid={`button-confirm-delete-${order.id}`}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  };

                  if (isSingle) return renderOrderRow(group.orders[0], false);

                  // Multi-loading: summary row + expandable children
                  const totalBales = group.orders.reduce((s, o) => s + (o.totalQtyBales || 0), 0);
                  const totalWeightKg = group.orders.reduce((s, o) => s + parseFloat(o.totalWeightKg || "0"), 0);
                  const totalRemaining = group.orders.reduce((s, o) => s + getRemainingBales(o), 0);
                  const totalOverloaded = group.orders.reduce((s, o) => {
                    const exp = parseFloat(o.proformaExpectedBales || "0");
                    return s + (exp > 0 ? Math.max(0, (o.totalQtyBales || 0) - exp) : 0);
                  }, 0);
                  const totalAmount = group.orders.reduce((s, o) => s + parseFloat(o.grandTotal || "0"), 0);

                  return (
                    <>
                      {/* Group summary row */}
                      <TableRow
                        key={`group-${group.customerId}`}
                        className="cursor-pointer bg-muted/40 font-medium"
                        onClick={() => toggleCustomer(group.customerId)}
                        data-testid={`row-group-${group.customerId}`}
                      >
                        <TableCell data-testid={`text-group-customer-${group.customerId}`}>
                          <div className="flex items-center gap-2">
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            }
                            <span>{group.customerName}</span>
                            <Badge variant="outline" className="text-xs font-normal">
                              {group.orders.length} loadings
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">—</TableCell>
                        {!hideProformaCol && <TableCell />}
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right font-mono">{totalBales}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{fmtKg(totalWeightKg)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {totalRemaining > 0 ? (
                            <span className="text-red-600 dark:text-red-400">{totalRemaining}</span>
                          ) : totalOverloaded > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400">+{totalOverloaded}</span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400">Done</span>
                          )}
                        </TableCell>
                        {!hideTotalsUsd && (
                          <TableCell className="text-right font-mono">
                            ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </TableCell>
                        )}
                        <TableCell />
                      </TableRow>
                      {/* Expanded individual rows */}
                      {isExpanded && group.orders.map(order => renderOrderRow(order, true))}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
