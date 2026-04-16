import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation, useRoute } from "wouter";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { FileDown, FileSpreadsheet, ArrowLeft, Trash2, ClipboardCheck, CheckCircle, RefreshCw, Container } from "lucide-react";
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

interface OrderLine {
  articleCode: string;
  baleName: string;
  qty: number;
  weightPerBale: number;
  totalWeight: number;
  pricePerBale: number;
  totalPrice: number;
}

interface OrderBale {
  baleReference: string;
  locationId: number;
  weight: number;
  articleCode: string;
  baleName: string;
  priceUsed: number;
}

interface OrderCharge {
  id: number;
  name: string;
  amount: string;
  chargeType: string;
  ledgerAccountId?: number;
}

interface OrderDetail {
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
  customerName: string;
  customerCode: string;
  containerNumber?: string | null;
  shippingCompany?: string | null;
  lines: OrderLine[];
  bales: OrderBale[];
  charges: OrderCharge[];
}

export default function FactoryInvoiceDetail() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  useEscapeBack(() => navigate("/factory/invoicing?tab=invoices"));
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, params] = useRoute("/factory/sales/invoices/:id");

  const orderId = params?.id ? parseInt(params.id) : null;

  const { data: order, isLoading } = useQuery<OrderDetail>({
    queryKey: [`/api/factory/customer-orders/${orderId}`],
    enabled: !!orderId,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary" data-testid="badge-status-draft">Draft</Badge>;
      case "LOADING":
        return <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" data-testid="badge-status-loading">Loading</Badge>;
      case "PENDING_VERIFICATION":
        return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800" data-testid="badge-status-pending">Pending Verification</Badge>;
      case "VERIFIED":
        return <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" data-testid="badge-status-verified">Verified</Badge>;
      case "FINALIZED":
        return <Badge variant="default" data-testid="badge-status-finalized">Finalized</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive" data-testid="badge-status-cancelled">Cancelled</Badge>;
      default:
        return <Badge variant="secondary" data-testid="badge-status-unknown">{status}</Badge>;
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/customer-orders/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Invoice deleted successfully." });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      navigate("/factory/invoicing?tab=invoices");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const repriceMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/reprice`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to reprice");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.repriced === 0) {
        toast({ title: "Prices already current", description: "All bale prices already match the current catalogue — no changes needed." });
      } else {
        toast({ title: "Prices updated", description: `Updated ${data.repriced} bale(s) to current catalogue prices.` });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleExportExcel = () => {
    if (!orderId) return;
    window.open(`/api/factory/customer-orders/${orderId}/export-excel`, "_blank");
  };

  const handleExportPdf = () => {
    if (!orderId) return;
    if (!navigator.onLine) { window.print(); return; }
    window.open(`/api/factory/customer-orders/${orderId}/export-pdf`, "_blank");
  };

  const handleExportLoadingStatus = () => {
    if (!orderId) return;
    const a = document.createElement("a");
    a.href = `/api/factory/customer-orders/${orderId}/loading-status-export`;
    a.download = "";
    a.click();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <p className="text-muted-foreground" data-testid="text-not-found">Invoice not found</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/factory/invoicing?tab=invoices")}
          data-testid="button-back-to-list"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  const sortedLines = [...(order.lines || [])].sort((a, b) =>
    (a.baleName || "").localeCompare(b.baleName || "")
  );

  const freightCharges = (order.charges || []).filter((c) => c.chargeType === "FREIGHT");
  const otherCharges = (order.charges || []).filter((c) => c.chargeType !== "FREIGHT");

  const subtotal = parseFloat(order.subtotalBales || "0");
  const totalCharges = parseFloat(order.freightAmount || "0") + parseFloat(order.otherChargesTotal || "0");
  const grandTotal = parseFloat(order.grandTotal || "0");
  const totalBalesQty = sortedLines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const totalWeightKg = sortedLines.reduce((sum, line) => sum + (Number(line.totalWeight) || 0), 0);

  const isPendingVerification = order.status === "PENDING_VERIFICATION";
  const isVerifiedStatus = order.status === "VERIFIED";
  const isLoadingStatus = order.status === "LOADING";

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/invoicing?tab=invoices")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-invoice-number">
              {order.invoiceNumber || `Order #${order.id}`}
            </h1>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-order-date">
            {order.orderDate ? formatDisplayDate(order.orderDate) : "-"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Customer</p>
            <p className="font-semibold text-lg" data-testid="text-customer-name">
              {order.customerName || "-"}
            </p>
          </div>
          {order.containerNumber && (
            <div>
              <p className="text-sm text-muted-foreground">Container No.</p>
              <p className="font-semibold font-mono" data-testid="text-container-number">
                {order.containerNumber}
              </p>
            </div>
          )}
          {order.shippingCompany && (
            <div>
              <p className="text-sm text-muted-foreground">Shipping</p>
              <p className="font-semibold" data-testid="text-shipping-company">
                {order.shippingCompany}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.status === "DRAFT" && (
            <Button
              variant="outline"
              onClick={() => navigate(`/factory/sales/new?orderId=${order.id}`)}
              data-testid="button-continue-editing"
            >
              Continue Editing
            </Button>
          )}
          {(isPendingVerification || isVerifiedStatus || isLoadingStatus) && (
            <Button
              variant="outline"
              onClick={() => navigate(`/factory/sales/pending-invoices/${order.id}/verify`)}
              data-testid="button-go-to-verify"
            >
              {isPendingVerification ? (
                <>
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  View Verification
                </>
              ) : isVerifiedStatus ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Charges &amp; Finalize
                </>
              ) : (
                <>
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  View Loading
                </>
              )}
            </Button>
          )}
          {(order.status === "VERIFIED" || order.status === "FINALIZED") && (
            <Button
              variant="outline"
              onClick={() => repriceMutation.mutate()}
              disabled={repriceMutation.isPending}
              data-testid="button-apply-prices"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${repriceMutation.isPending ? "animate-spin" : ""}`} />
              Apply Current Prices
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleExportExcel}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Download Excel
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPdf}
            data-testid="button-export-pdf"
          >
            <FileDown className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleExportLoadingStatus}
            data-testid="button-export-loading-status"
          >
            <Container className="mr-2 h-4 w-4" />
            Loading Status
          </Button>
          {order.status !== "FINALIZED" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="text-destructive"
                  data-testid="button-delete-invoice"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Invoice</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete order {order.invoiceNumber || `#${order.id}`} for {order.customerName}.
                    Any bales assigned to this order will be returned to stock. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate(order.id)}
                    data-testid="button-confirm-delete"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto mb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>Article Code</TableHead>
              <TableHead>Bale Name</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Weight/Bale</TableHead>
              <TableHead className="text-right">Total Weight</TableHead>
              <TableHead className="text-right">Price/Bale</TableHead>
              <TableHead className="text-right">Total Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-6" data-testid="text-no-lines">
                  No order lines
                </TableCell>
              </TableRow>
            ) : (
              sortedLines.map((line, idx) => (
                <TableRow key={`${line.articleCode ?? ""}-${idx}`} data-testid={`row-line-${idx}`}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-mono text-sm" data-testid={`text-article-code-${idx}`}>
                    {line.articleCode}
                  </TableCell>
                  <TableCell data-testid={`text-bale-name-${idx}`}>
                    {line.baleName}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-qty-${idx}`}>
                    {line.qty}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-weight-per-bale-${idx}`}>
                    {Number(line.weightPerBale || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-total-weight-${idx}`}>
                    {Number(line.totalWeight || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-price-per-bale-${idx}`}>
                    {Number(line.pricePerBale || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold" data-testid={`text-total-price-${idx}`}>
                    {Number(line.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {(freightCharges.length > 0 || otherCharges.length > 0) && (
        <Card className="p-4 mb-6">
          <h3 className="font-semibold mb-3" data-testid="text-charges-header">Freight &amp; Charges</h3>
          <div className="space-y-2">
            {freightCharges.map((charge, idx) => (
              <div key={`freight-${charge.name ?? idx}`} className="flex items-center justify-between gap-2" data-testid={`row-freight-charge-${idx}`}>
                <span className="text-sm">{charge.name}</span>
                <span className="font-mono text-sm" data-testid={`text-freight-amount-${idx}`}>
                  {Number(charge.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
            {otherCharges.map((charge, idx) => (
              <div key={`other-${charge.name ?? idx}`} className="flex items-center justify-between gap-2" data-testid={`row-other-charge-${idx}`}>
                <span className="text-sm">{charge.name}</span>
                <span className="font-mono text-sm" data-testid={`text-other-amount-${idx}`}>
                  {Number(charge.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Subtotal (Bales)</span>
            <span className="font-mono" data-testid="text-subtotal">{subtotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Total Charges</span>
            <span className="font-mono" data-testid="text-total-charges">{totalCharges.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="border-t pt-2 flex items-center justify-between gap-2">
            <span className="font-semibold">Grand Total</span>
            <span className="font-mono font-bold text-lg" data-testid="text-grand-total">{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>Total Bales Qty</span>
            <span data-testid="text-total-bales-qty">{totalBalesQty}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>Total Weight</span>
            <span className="font-mono" data-testid="text-total-weight-kg">
              {totalWeightKg.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
