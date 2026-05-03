import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation, useRoute } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { FileDown, FileSpreadsheet, ArrowLeft, Trash2, ClipboardCheck, CheckCircle, RefreshCw, Container, Pencil, RotateCcw, Hammer, ChevronDown, GitCompare, DollarSign, ScanLine, ArrowLeftRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { queryClient, keyStartsWith, invalidateCustomerBalances } from "@/lib/queryClient";
import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  id: number;
  baleId: number;
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
  destination?: string | null;
  lines: OrderLine[];
  bales: OrderBale[];
  charges: OrderCharge[];
}

export default function FactoryInvoiceDetail() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  const [editingArticleCode, setEditingArticleCode] = useState<string | null>(null);
  const [editingChargeLedger, setEditingChargeLedger] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [baleRefArticle, setBaleRefArticle] = useState<{ code: string; name: string } | null>(null);
  const [exchangeBale, setExchangeBale] = useState<{ orderBaleId: number; reference: string } | null>(null);
  const [newRefInput, setNewRefInput] = useState("");
  const [removeBaleState, setRemoveBaleState] = useState<{ orderBaleId: number; reference: string } | null>(null);
  const [showProformaDialog, setShowProformaDialog] = useState(false);
  const [selectedProformaId, setSelectedProformaId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEscapeToParent("/factory/invoicing?tab=invoices");
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, params] = useRoute("/factory/sales/invoices/:id");

  const orderId = params?.id ? parseInt(params.id) : null;

  const { data: order, isLoading } = useQuery<OrderDetail>({
    queryKey: [`/api/factory/customer-orders/${orderId}`],
    enabled: !!orderId,
  });

  const { data: ledgerAccounts = [] } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const updateChargeLedgerMutation = useMutation({
    mutationFn: async ({ chargeId, ledgerAccountId }: { chargeId: number; ledgerAccountId: number | null }) => {
      const res = await modeApiRequest("PATCH", `/api/factory/customer-orders/${orderId}/charges/${chargeId}`, { ledgerAccountId });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to update charge");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
      setEditingChargeLedger(null);
      toast({ title: "Ledger account updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: myAccess } = useQuery<{ hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });

  const { data: proformas = [] } = useQuery<{ id: number; name: string; lines: { articleCode: string; pricePerBale: string }[] }[]>({
    queryKey: ["/api/factory/customer-proformas", order?.customerId],
    queryFn: async () => {
      if (!order?.customerId) return [];
      const res = await fetch(`/api/factory/customer-proformas?customerId=${order.customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!order?.customerId,
  });
  const hideExportSelling = (myAccess?.hiddenCostFields ?? []).includes("hide_export_selling_price");
  const isAdmin = myAccess?.fullAccess === true;

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
      invalidateCustomerBalances(order?.customerId ?? undefined);
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

  const repriceArticleMutation = useMutation({
    mutationFn: async ({ articleCode, pricePerBale }: { articleCode: string; pricePerBale: number }) => {
      const res = await modeApiRequest("PATCH", `/api/factory/customer-orders/${orderId}/bales/reprice-article`, {
        articleCode,
        pricePerBale,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update price");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Price updated", description: "All bales for this article have been repriced and totals recalculated." });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
      setEditingArticleCode(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setEditingArticleCode(null);
    },
  });

  const unfinalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/unfinalize`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to revert invoice");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reverted to Draft", description: "Invoice has been reverted. You can now edit prices." });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      invalidateCustomerBalances(order?.customerId ?? undefined);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Cannot revert", description: error.message, variant: "destructive" });
    },
  });

  const repriceProductionMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/reprice-production`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to apply production prices");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.repriced === 0) {
        toast({ title: "Already at production prices", description: "All bale prices already match the current production prices — no changes needed." });
      } else {
        toast({ title: "Production prices applied", description: `Updated ${data.repriced} bale(s) to production prices.` });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const applyProformaMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/apply-proforma-prices`, { proformaId });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to apply proforma prices");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      const repriced = data?.repriced ?? 0;
      if (repriced === 0) {
        toast({ title: "No changes", description: "All bale prices already match the selected proforma — no updates needed." });
      } else {
        toast({ title: "Proforma prices applied", description: `Updated ${repriced} bale(s).` });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
      setShowProformaDialog(false);
      setSelectedProformaId("");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const exchangeMutation = useMutation({
    mutationFn: async ({ orderBaleId, newBaleReference }: { orderBaleId: number; newBaleReference: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/bales/exchange`, { orderBaleId, newBaleReference });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to exchange bale");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bale exchanged", description: `Replaced successfully.` });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
      setExchangeBale(null);
      setNewRefInput("");
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeBaleMutation = useMutation({
    mutationFn: async (orderBaleId: number) => {
      const res = await modeApiRequest("DELETE", `/api/factory/customer-orders/${orderId}/bales/${orderBaleId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to remove bale");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bale removed", description: "Bale returned to stock." });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/customer-orders/${orderId}`] });
      setRemoveBaleState(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = (articleCode: string, currentPrice: number) => {
    setEditingArticleCode(articleCode);
    setEditValue(String(currentPrice));
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const commitEdit = (articleCode: string) => {
    const price = parseFloat(editValue);
    if (isNaN(price) || price < 0) {
      toast({ title: "Invalid price", description: "Please enter a valid number.", variant: "destructive" });
      setEditingArticleCode(null);
      return;
    }
    repriceArticleMutation.mutate({ articleCode, pricePerBale: price });
  };

  const cancelEdit = () => {
    setEditingArticleCode(null);
    setEditValue("");
  };

  const handleExportExcel = () => {
    if (!orderId) return;
    window.open(`/api/factory/customer-orders/${orderId}/export-excel`, "_blank");
  };

  const handleExportPdf = () => {
    if (!orderId) return;
    const a = document.createElement("a");
    a.href = `/api/factory/customer-orders/${orderId}/export-pdf`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
  const isFinalized = order.status === "FINALIZED";

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
          {order.destination && (
            <div>
              <p className="text-sm text-muted-foreground">Destination</p>
              <p className="font-semibold" data-testid="text-destination">
                {order.destination}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Primary context action */}
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
                <><ClipboardCheck className="mr-2 h-4 w-4" />View Verification</>
              ) : isVerifiedStatus ? (
                <><CheckCircle className="mr-2 h-4 w-4" />Charges &amp; Finalize</>
              ) : (
                <><ClipboardCheck className="mr-2 h-4 w-4" />View Loading</>
              )}
            </Button>
          )}
          {isFinalized && (
            <Button
              onClick={() => navigate(`/factory/invoices/${order.id}/loading-scan`)}
              data-testid="button-scan-loading"
            >
              <ScanLine className="mr-2 h-4 w-4" />
              Scan Loading
            </Button>
          )}

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-actions-menu">
                Actions
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {isAdmin && (isLoadingStatus || isFinalized) && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">View</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigate(`/factory/sales/pending-invoices/${order.id}/verify`)}
                    data-testid="button-proforma-vs-loaded"
                  >
                    <GitCompare className="h-4 w-4" />
                    Proforma vs Loaded
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {isAdmin && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Pricing</DropdownMenuLabel>
                  {order.status !== "CANCELLED" && (
                    <DropdownMenuItem
                      onClick={() => repriceProductionMutation.mutate()}
                      disabled={repriceProductionMutation.isPending}
                      data-testid="button-apply-production-prices"
                    >
                      <Hammer className={`h-4 w-4 ${repriceProductionMutation.isPending ? "animate-spin" : ""}`} />
                      Apply Production Prices
                    </DropdownMenuItem>
                  )}
                  {(isVerifiedStatus || isFinalized) && (
                    <DropdownMenuItem
                      onClick={() => repriceMutation.mutate()}
                      disabled={repriceMutation.isPending}
                      data-testid="button-apply-prices"
                    >
                      <RefreshCw className={`h-4 w-4 ${repriceMutation.isPending ? "animate-spin" : ""}`} />
                      Apply Selling Prices
                    </DropdownMenuItem>
                  )}
                  {order.status !== "CANCELLED" && (
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedProformaId("");
                        setShowProformaDialog(true);
                      }}
                      disabled={applyProformaMutation.isPending}
                      data-testid="button-apply-proforma-prices"
                    >
                      <DollarSign className="h-4 w-4" />
                      Apply Proforma Prices
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Export</DropdownMenuLabel>
              <DropdownMenuItem onClick={handleExportExcel} data-testid="button-export-excel">
                <FileSpreadsheet className="h-4 w-4" />
                Download Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf} data-testid="button-export-pdf">
                <FileDown className="h-4 w-4" />
                Download PDF
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={handleExportLoadingStatus} data-testid="button-export-loading-status">
                  <Container className="h-4 w-4" />
                  Loading Status
                </DropdownMenuItem>
              )}

              {isAdmin && (isFinalized || order.status !== "FINALIZED") && order.status !== "CANCELLED" && (
                <DropdownMenuSeparator />
              )}
              {isAdmin && isFinalized && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setRevertDialogOpen(true)}
                  data-testid="button-unfinalize"
                >
                  <RotateCcw className="h-4 w-4" />
                  Revert to Draft
                </DropdownMenuItem>
              )}
              {order.status !== "FINALIZED" && order.status !== "CANCELLED" && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteDialogOpen(true)}
                  data-testid="button-delete-invoice"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Invoice
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Controlled dialogs outside dropdown */}
        <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revert invoice to Draft?</AlertDialogTitle>
              <AlertDialogDescription>
                This will un-finalize {order.invoiceNumber || `Order #${order.id}`} and return it to Draft status.
                The invoice number will be cleared and bales will be returned to "Reserved" state.
                Any recorded payments must be reversed first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-unfinalize">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => unfinalizeMutation.mutate()}
                disabled={unfinalizeMutation.isPending}
                data-testid="button-confirm-unfinalize"
              >
                {unfinalizeMutation.isPending ? "Reverting…" : "Revert to Draft"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
              {isAdmin && (
                <TableHead className={`text-right${hideExportSelling ? " print:hidden" : ""}`}>
                  Price/Bale
                  {(isVerifiedStatus || order.status === "FINALIZED") && (
                    <Pencil className="inline ml-1 h-3 w-3 text-muted-foreground" />
                  )}
                </TableHead>
              )}
              {isAdmin && (
                <TableHead className={`text-right${hideExportSelling ? " print:hidden" : ""}`}>Total Price</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 8 : 6} className="text-center text-muted-foreground py-6" data-testid="text-no-lines">
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
                    <button
                      className="text-left hover-elevate rounded-md px-1 -mx-1 py-0.5 font-medium underline-offset-2 hover:underline"
                      onClick={() => setBaleRefArticle({ code: line.articleCode, name: line.baleName })}
                      data-testid={`button-bale-refs-${idx}`}
                      title="Click to see all reference numbers"
                    >
                      {line.baleName}
                    </button>
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
                  {isAdmin && (
                    <TableCell className={`text-right font-mono${hideExportSelling ? " print:hidden" : ""}`} data-testid={`text-price-per-bale-${idx}`}>
                      {(isVerifiedStatus || order.status === "FINALIZED") ? (
                        editingArticleCode === line.articleCode ? (
                          <Input
                            ref={inputRef}
                            type="number"
                            min="0"
                            step="any"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(line.articleCode);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            onBlur={() => commitEdit(line.articleCode)}
                            className="h-7 w-28 text-right font-mono p-1 ml-auto"
                            disabled={repriceArticleMutation.isPending}
                            data-testid={`input-price-${idx}`}
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(line.articleCode, line.pricePerBale)}
                            className="group flex items-center justify-end gap-1 w-full hover-elevate rounded-md px-1 py-0.5"
                            data-testid={`button-edit-price-${idx}`}
                            title="Click to edit price"
                          >
                            <span>{Number(line.pricePerBale || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                            <Pencil className="h-3 w-3 text-muted-foreground invisible group-hover:visible" />
                          </button>
                        )
                      ) : (
                        Number(line.pricePerBale || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
                      )}
                    </TableCell>
                  )}
                  {isAdmin && (
                    <TableCell className={`text-right font-mono font-semibold${hideExportSelling ? " print:hidden" : ""}`} data-testid={`text-total-price-${idx}`}>
                      {Number(line.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {isAdmin && (freightCharges.length > 0 || otherCharges.length > 0) && (
        <Card className={`p-4 mb-6${hideExportSelling ? " print:hidden" : ""}`}>
          <h3 className="font-semibold mb-3" data-testid="text-charges-header">Freight &amp; Charges</h3>
          <div className="space-y-3">
            {[...freightCharges, ...otherCharges].map((charge, idx) => {
              const linkedAccount = ledgerAccounts.find(a => a.id === charge.ledgerAccountId);
              const isEditing = editingChargeLedger === charge.id;
              return (
                <div key={charge.id} className="space-y-1" data-testid={`row-charge-${idx}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{charge.name}</span>
                    <span className="font-mono text-sm">
                      {Number(charge.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-2 print:hidden">
                      <Select
                        value={String(charge.ledgerAccountId ?? "")}
                        onValueChange={(val) => updateChargeLedgerMutation.mutate({ chargeId: charge.id, ledgerAccountId: val ? parseInt(val) : null })}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-charge-ledger-${charge.id}`}>
                          <SelectValue placeholder="Select ledger account..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ledgerAccounts.map(acc => (
                            <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" onClick={() => setEditingChargeLedger(null)} data-testid={`button-cancel-charge-ledger-${charge.id}`}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 print:hidden">
                      {linkedAccount ? (
                        <Badge variant="secondary" className="text-xs">{linkedAccount.name}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">No ledger account</span>
                      )}
                      <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setEditingChargeLedger(charge.id)} data-testid={`button-edit-charge-ledger-${charge.id}`}>
                        <Pencil className="h-3 w-3 mr-1" />Link
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="space-y-2">
          {isAdmin && (
            <>
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
            </>
          )}
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

      <Dialog open={showProformaDialog} onOpenChange={setShowProformaDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Proforma Prices</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a proforma to apply its article prices to all matching bales in this order.
            </p>
            {proformas.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No proformas found for this customer.</p>
            ) : (
              <Select value={selectedProformaId} onValueChange={setSelectedProformaId}>
                <SelectTrigger data-testid="select-proforma">
                  <SelectValue placeholder="Select a proforma..." />
                </SelectTrigger>
                <SelectContent>
                  {proformas.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)} data-testid={`option-proforma-${p.id}`}>
                      {p.name} ({p.lines.length} line{p.lines.length !== 1 ? "s" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedProformaId && (() => {
              const pf = proformas.find(p => String(p.id) === selectedProformaId);
              if (!pf || pf.lines.length === 0) return null;
              return (
                <div className="rounded-md border p-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Price lines in this proforma:</p>
                  {pf.lines.map((l, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{l.articleCode}</span>
                      <span className="font-medium">${parseFloat(l.pricePerBale).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setShowProformaDialog(false)} data-testid="button-cancel-proforma">
                Cancel
              </Button>
              <Button
                onClick={() => { if (selectedProformaId) applyProformaMutation.mutate(parseInt(selectedProformaId)); }}
                disabled={!selectedProformaId || applyProformaMutation.isPending}
                data-testid="button-confirm-proforma"
              >
                <DollarSign className="mr-2 h-4 w-4" />
                {applyProformaMutation.isPending ? "Applying…" : "Apply Prices"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bale References Dialog */}
      <Dialog open={baleRefArticle !== null} onOpenChange={(open) => { if (!open) setBaleRefArticle(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {baleRefArticle?.name}
              <span className="ml-2 font-mono text-sm text-muted-foreground">({baleRefArticle?.code})</span>
            </DialogTitle>
          </DialogHeader>
          {baleRefArticle && (() => {
            const balesForArticle = (order?.bales ?? [])
              .filter((b) => b.articleCode === baleRefArticle.code)
              .sort((a, b) => a.baleReference.localeCompare(b.baleReference));
            const canExchange = isAdmin && isFinalized;
            return balesForArticle.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No bale references found for this item.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {balesForArticle.length} bale{balesForArticle.length !== 1 ? "s" : ""} loaded
                  {canExchange && <span className="ml-1">— hover a chip to remove <Trash2 className="inline h-3 w-3" /> or exchange <ArrowLeftRight className="inline h-3 w-3" /></span>}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {balesForArticle.map((b) => (
                    <div
                      key={b.id}
                      className="group relative rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-sm text-center"
                      data-testid={`bale-ref-${b.baleReference}`}
                    >
                      {b.baleReference}
                      {canExchange && (
                        <>
                          <button
                            className="absolute -top-1.5 -left-1.5 opacity-0 group-hover:opacity-100 bg-background border rounded-full p-0.5 hover-elevate transition-opacity"
                            onClick={() => setRemoveBaleState({ orderBaleId: b.id, reference: b.baleReference })}
                            data-testid={`button-remove-bale-${b.id}`}
                            title="Remove this bale and return to stock"
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </button>
                          <button
                            className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 bg-background border rounded-full p-0.5 hover-elevate transition-opacity"
                            onClick={() => { setExchangeBale({ orderBaleId: b.id, reference: b.baleReference }); setNewRefInput(""); }}
                            data-testid={`button-exchange-bale-${b.id}`}
                            title="Exchange this bale for another"
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Remove Bale Confirm Dialog */}
      <AlertDialog open={removeBaleState !== null} onOpenChange={(open) => { if (!open) setRemoveBaleState(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove bale from invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Bale <span className="font-mono font-medium">{removeBaleState?.reference}</span> will be removed from this invoice and returned to stock. The invoice totals will update automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-bale">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeBaleState && removeBaleMutation.mutate(removeBaleState.orderBaleId)}
              disabled={removeBaleMutation.isPending}
              data-testid="button-confirm-remove-bale"
              className="bg-destructive text-destructive-foreground"
            >
              {removeBaleMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exchange Bale Dialog */}
      <Dialog open={exchangeBale !== null} onOpenChange={(open) => { if (!open) { setExchangeBale(null); setNewRefInput(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Exchange Bale
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Removing: </span>
              <span className="font-mono font-medium">{exchangeBale?.reference}</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Replacement bale reference</label>
              <Input
                placeholder="e.g. REF12345"
                value={newRefInput}
                onChange={(e) => setNewRefInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newRefInput.trim() && exchangeBale) {
                    exchangeMutation.mutate({ orderBaleId: exchangeBale.orderBaleId, newBaleReference: newRefInput.trim() });
                  }
                }}
                data-testid="input-exchange-bale-ref"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">The replacement bale must be in stock. Price is preserved.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => { setExchangeBale(null); setNewRefInput(""); }} data-testid="button-cancel-exchange">
                Cancel
              </Button>
              <Button
                onClick={() => { if (exchangeBale && newRefInput.trim()) exchangeMutation.mutate({ orderBaleId: exchangeBale.orderBaleId, newBaleReference: newRefInput.trim() }); }}
                disabled={!newRefInput.trim() || exchangeMutation.isPending}
                data-testid="button-confirm-exchange"
              >
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                {exchangeMutation.isPending ? "Exchanging…" : "Exchange"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
