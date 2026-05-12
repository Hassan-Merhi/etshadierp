import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation, useParams } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { ArrowLeft, Check, RotateCcw, Ship, Truck, AlertTriangle, CheckCircle, Package, Trash2, Plus, Wrench, DollarSign, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FinalizePreviewBale {
  id: number;
  baleReference: string;
  productName: string;
  weightKg: number;
  locationName: string;
  status: string;
}

interface FinalizePreview {
  baleCount: number;
  totalBalesInOrder: number;
  bales: FinalizePreviewBale[];
}

interface ComparisonItem {
  articleCode: string;
  productName: string;
  loadedQty: number;
  expectedQty: number;
  diff: number;
  totalWeight: number;
  totalPrice: number;
  pricePerBale: string;
  inProforma: boolean;
  status: "LOADED_NOT_IN_PROFORMA" | "MISSING_FROM_LOADED" | "UNDER_LOADED" | "OVER_LOADED" | "MATCH";
}

interface ProformaLine {
  articleCode: string;
  productName: string;
  expectedQty: number;
  pricePerBale: string;
  stockQty: number;
}

interface LoadedGroup {
  articleCode: string;
  productName: string;
  qty: number;
  totalWeight: number;
  totalPrice: number;
  pricePerBale: string;
}

interface VerificationSummary {
  order: any;
  proformaLines: ProformaLine[];
  loadedItems: LoadedGroup[];
  comparison: ComparisonItem[];
  totalLoadedBales: number;
  totalLoadedWeight: number;
  dataSource?: "bale_rows" | "order_lines";
}

interface OrderCharge {
  id: number;
  name: string;
  amount: string;
  chargeType: string;
}

interface OrderDetail {
  id: number;
  customerId: number;
  companyId: number;
  orderDate: string;
  status: string;
  invoiceNumber?: string;
  subtotalBales: string;
  freightAmount: string;
  otherChargesTotal: string;
  grandTotal: string;
  totalQtyBales: number;
  charges: OrderCharge[];
  containerNumber?: string;
  shippingCompany?: string;
  containerNotes?: string;
  destination?: string;
}

/** Strip unnecessary trailing zeros — e.g. 5563.00 → "5563", 15836.28 → "15836.28" */
const fmtNum = (n: number, max = 2) => parseFloat(n.toFixed(max)).toString();

export default function FactoryPendingInvoiceVerify() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  useEscapeToParent("/factory/invoicing?tab=invoices");
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [containerNumber, setContainerNumber] = useState("");
  const [shippingCompany, setShippingCompany] = useState("");
  const [containerNotes, setContainerNotes] = useState("");
  const [destination, setDestination] = useState("");
  const [containerInitialized, setContainerInitialized] = useState(false);

  const [chargeName, setChargeName] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeType, setChargeType] = useState("FREIGHT");
  const [chargeLedgerAccountId, setChargeLedgerAccountId] = useState<string>("");

  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  const [showFinalizePreview, setShowFinalizePreview] = useState(false);
  const [finalizePreview, setFinalizePreview] = useState<FinalizePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showFixBalesDialog, setShowFixBalesDialog] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toLocaleDateString("en-CA"));

  const [showProformaDialog, setShowProformaDialog] = useState(false);
  const [selectedProformaId, setSelectedProformaId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [showRecoverDialog, setShowRecoverDialog] = useState(false);
  const [recoverInput, setRecoverInput] = useState("");
  const [recoverTab, setRecoverTab] = useState<"auto" | "manual">("auto");

  const { data: verification, isLoading: verificationLoading } = useQuery<VerificationSummary>({
    queryKey: ["/api/factory/customer-orders", orderId, "verification"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}/verification-summary`, { credentials: "include" });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Server error ${res.status} on verification-summary`);
      }
      return res.json();
    },
    enabled: !!orderId,
  });

  const { data: orderDetail, isLoading: orderLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/factory/customer-orders", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}`, { credentials: "include" });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `Server error ${res.status} on order detail`);
      }
      return res.json();
    },
    enabled: !!orderId,
  });

  const { data: currentUser } = useQuery<{ role?: string }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });
  const isAdminOrOwner = currentUser?.role === "Admin" || currentUser?.role === "Owner" || currentUser?.role === "Developer";

  const { data: ledgerAccounts = [] } = useQuery<{ id: number; name: string; code: string; accountType: string }[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: true,
  });

  const { data: proformas = [] } = useQuery<{ id: number; name: string; lines: { articleCode: string; pricePerBale: string }[] }[]>({
    queryKey: ["/api/factory/customer-proformas", orderDetail?.customerId],
    queryFn: async () => {
      if (!orderDetail?.customerId) return [];
      const res = await fetch(`/api/factory/customer-proformas?customerId=${orderDetail.customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!orderDetail?.customerId,
  });

  useEffect(() => {
    if (orderDetail && !containerInitialized) {
      setContainerNumber(orderDetail.containerNumber || "");
      setShippingCompany(orderDetail.shippingCompany || "");
      setContainerNotes(orderDetail.containerNotes || "");
      setDestination(orderDetail.destination || "");
      setContainerInitialized(true);
    }
  }, [orderDetail, containerInitialized]);

  const verifyMutation = useMutation({
    mutationFn: async (data: { approved: boolean; notes?: string }) => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/verify`, data);
    },
    onSuccess: () => {
      toast({ title: "Order verified", description: "Now add charges and finalize the invoice" });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const returnToLoadingMutation = useMutation({
    mutationFn: async () => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/return-to-loading`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({ title: "Returned to loading", description: "The order has been returned for further loading" });
      navigate("/factory/invoicing?tab=invoices");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const assignContainerMutation = useMutation({
    mutationFn: async (data: { containerNumber: string; shippingCompany: string; containerNotes: string; destination: string }) => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/assign-container`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      toast({ title: "Container info saved" });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addChargeMutation = useMutation({
    mutationFn: async (data: { name: string; amount: number; chargeType: string; ledgerAccountId?: number }) => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/charges`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      setChargeName("");
      setChargeLedgerAccountId("");
      setChargeAmount("");
      toast({ title: "Charge added" });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeChargeMutation = useMutation({
    mutationFn: async (chargeId: number) => {
      await modeApiRequest("DELETE", `/api/factory/customer-orders/${orderId}/charges/${chargeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      toast({ title: "Charge removed" });
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (txDate?: string) => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/finalize`, { txDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      toast({ title: "Invoice finalized", description: "Invoice has been created successfully" });
      navigate(`/factory/sales/invoices/${orderId}`);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const forceSyncMutation = useMutation({
    mutationFn: async () => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/force-sync-bale-status`);
    },
    onSuccess: () => {
      toast({ title: "Bales fixed", description: "Bale statuses have been set to SOLD" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId, "verification"] });
      setShowFixBalesDialog(false);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const recoverBalesMutation = useMutation({
    mutationFn: async (baleReferences: string[]) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/recover-bales`, { baleReferences });
      return res.json();
    },
    onSuccess: (data: { message: string; linked: number; notFound: string[] }) => {
      toast({
        title: `${data.linked} bale(s) recovered`,
        description: data.notFound.length > 0
          ? `Not found: ${data.notFound.slice(0, 5).join(", ")}${data.notFound.length > 5 ? ` (+${data.notFound.length - 5} more)` : ""}`
          : data.message,
      });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      setShowRecoverDialog(false);
      setRecoverInput("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Recovery failed", description: error.message, variant: "destructive" });
    },
  });

  const autoRecoverMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/auto-recover-bales`, {});
      return res.json();
    },
    onSuccess: (data: { message: string; linked: number; summary: { articleCode: string; linked: number; needed: number }[] }) => {
      toast({
        title: `${data.linked} bale(s) auto-linked`,
        description: data.summary.map(s => `${s.articleCode}: ${s.linked}/${s.needed}`).join(", "),
      });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      setShowRecoverDialog(false);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Auto-recover failed", description: error.message, variant: "destructive" });
    },
  });

  const applyProformaMutation = useMutation({
    mutationFn: async (proformaId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/apply-proforma-prices`, { proformaId });
      return res;
    },
    onSuccess: (data: any) => {
      const repriced = data?.repriced ?? 0;
      toast({ title: "Proforma prices applied", description: `${repriced} bale${repriced !== 1 ? "s" : ""} updated` });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      setShowProformaDialog(false);
      setSelectedProformaId("");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const fetchFinalizePreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/factory/customer-orders/${orderId}/finalize-preview`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch preview");
      const data = await res.json();
      setFinalizePreview(data);
      setShowFinalizePreview(true);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAddCharge = () => {
    if (!chargeAmount || !orderId) return;
    const name = chargeType === "FREIGHT" ? "Freight" : chargeName.trim();
    if (!name) return;
    addChargeMutation.mutate({
      name,
      amount: parseFloat(chargeAmount),
      chargeType,
      ledgerAccountId: chargeLedgerAccountId ? parseInt(chargeLedgerAccountId) : undefined,
    });
  };

  const getComparisonRowClass = (status: ComparisonItem["status"]) => {
    switch (status) {
      case "LOADED_NOT_IN_PROFORMA":
      case "MISSING_FROM_LOADED":
        return "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800";
      case "UNDER_LOADED":
        return "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800";
      case "OVER_LOADED":
        return "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800";
      case "MATCH":
      default:
        return "";
    }
  };

  const getStatusBadge = (status: ComparisonItem["status"]) => {
    switch (status) {
      case "LOADED_NOT_IN_PROFORMA":
        return <Badge variant="destructive" data-testid="badge-loaded-not-in-proforma">Not in Proforma</Badge>;
      case "MISSING_FROM_LOADED":
        return <Badge variant="destructive" data-testid="badge-missing-from-loaded">Missing</Badge>;
      case "UNDER_LOADED":
        return <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800" data-testid="badge-under-loaded">Under Loaded</Badge>;
      case "OVER_LOADED":
        return <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" data-testid="badge-over-loaded">Over Loaded</Badge>;
      case "MATCH":
        return <Badge variant="outline" className="text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" data-testid="badge-match"><CheckCircle className="h-3 w-3 mr-1" />Match</Badge>;
      default:
        return null;
    }
  };

  const isLoading = verificationLoading || orderLoading;
  const charges = orderDetail?.charges || [];
  const orderStatus = verification?.order?.status || orderDetail?.status || "";
  const isPending = orderStatus === "PENDING_VERIFICATION";
  const isVerified = orderStatus === "VERIFIED";
  const isLoadingStatus = orderStatus === "LOADING";

  const totalNotLoadedBales = (verification?.comparison ?? []).reduce((sum, item) => {
    const remaining = item.expectedQty - item.loadedQty;
    return sum + (remaining > 0 ? remaining : 0);
  }, 0);
  const avgWeightPerBale =
    (verification?.totalLoadedBales ?? 0) > 0
      ? (verification?.totalLoadedWeight ?? 0) / (verification?.totalLoadedBales ?? 1)
      : 0;
  const totalNotLoadedWeight = avgWeightPerBale * totalNotLoadedBales;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6">
        <Skeleton className="h-10 w-64 mb-4" />
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 lg:p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/factory/invoicing?tab=invoices")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Verify Order #{orderId}</h1>
            <p className="text-muted-foreground text-sm">Review loaded bales against proforma</p>
          </div>
        </div>
        <div>
          {isLoadingStatus && (
            <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-400" data-testid="badge-order-status">
              Loading
            </Badge>
          )}
          {isPending && (
            <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800" data-testid="badge-order-status">
              Pending Verification
            </Badge>
          )}
          {isVerified && (
            <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800" data-testid="badge-order-status">
              Verified
            </Badge>
          )}
        </div>
      </div>

      {/* Fallback notice — shown only to Developer role when bale records are missing but order lines cover the data */}
      {!verificationLoading && verification?.dataSource === "order_lines" && currentUser?.role === "Developer" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-4" data-testid="panel-order-lines-fallback">
          <div className="flex items-start gap-3">
            <Package className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Bale counts sourced from order summary</p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                Individual bale scan records are unavailable, but per-article totals are intact. All counts and weights shown are accurate.
                If you need individual bale-level detail, use <strong>Recover Bales</strong>.
              </p>
            </div>
          </div>
          {isAdminOrOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRecoverDialog(true)}
              className="border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"
              data-testid="button-recover-bales-from-notice"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Recover Bales
            </Button>
          )}
        </div>
      )}

      {/* Recovery banner — shown when the order has 0 linked bales, no fallback, and the user is admin */}
      {!verificationLoading && (verification?.totalLoadedBales ?? 0) === 0 && verification?.dataSource !== "order_lines" && isAdminOrOwner && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-4" data-testid="panel-zero-bales-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">No bale records found for this order</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Bale scans may have failed while the database columns were missing. If you have the bale reference numbers,
                use <strong>Recover Bales</strong> to re-link them. Otherwise use <strong>Return to Loading</strong> to re-scan.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowRecoverDialog(true)}
            className="border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200"
            data-testid="button-recover-bales"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Recover Bales
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Loaded Bales</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-loaded-bales">
              {verification?.totalLoadedBales ?? 0} bales
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Weight</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-weight">
              {fmtNum(verification?.totalLoadedWeight ?? 0)} kg
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Not Loaded</CardTitle>
            <Package className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-total-not-loaded-bales">
              {totalNotLoadedBales} bales
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Not Loaded Weight</CardTitle>
            <Truck className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-total-not-loaded-weight">
              {fmtNum(totalNotLoadedWeight)} kg
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">Proforma vs Loaded</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Filter:</span>
              {(["OVER_LOADED", "UNDER_LOADED", "MISSING_FROM_LOADED"] as const).map((s) => {
                const labels: Record<string, string> = { OVER_LOADED: "Overloaded", UNDER_LOADED: "Under-loaded", MISSING_FROM_LOADED: "Missing" };
                const colors: Record<string, string> = {
                  OVER_LOADED: "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700",
                  UNDER_LOADED: "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700",
                  MISSING_FROM_LOADED: "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700",
                };
                const activeColors: Record<string, string> = {
                  OVER_LOADED: "bg-green-600 text-white border-green-600",
                  UNDER_LOADED: "bg-yellow-500 text-white border-yellow-500",
                  MISSING_FROM_LOADED: "bg-red-600 text-white border-red-600",
                };
                const active = statusFilter.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter((prev) => {
                        const next = new Set(prev);
                        if (next.has(s)) next.delete(s); else next.add(s);
                        return next;
                      });
                    }}
                    className={`text-xs px-2 py-1 rounded-md border font-medium transition-colors ${active ? activeColors[s] : colors[s]}`}
                    data-testid={`filter-status-${s.toLowerCase()}`}
                  >
                    {labels[s]}
                  </button>
                );
              })}
              {statusFilter.size > 0 && (
                <button
                  onClick={() => setStatusFilter(new Set())}
                  className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground"
                  data-testid="filter-clear"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {(() => {
            const comparisonMap = new Map<string, ComparisonItem>();
            (verification?.comparison || []).forEach((c) => comparisonMap.set(c.articleCode, c));
            const filteredProformaLines = (verification?.proformaLines || []).filter((line) => {
              const cmp = comparisonMap.get(line.articleCode);
              return !cmp || cmp.status !== "MATCH";
            });
            const getProformaRowClass = (articleCode: string) => {
              const cmp = comparisonMap.get(articleCode);
              if (!cmp) return "";
              if (cmp.status === "UNDER_LOADED" || cmp.status === "MISSING_FROM_LOADED")
                return "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800";
              if (cmp.status === "OVER_LOADED")
                return "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800";
              return "";
            };

            const statusSortOrder = (status: string | undefined) => {
              if (status === "OVER_LOADED") return 0;
              if (status === "UNDER_LOADED") return 1;
              return 2; // MISSING_FROM_LOADED or unknown
            };
            const sortedProformaLines = [...filteredProformaLines]
              .sort((a, b) => {
                const sa = comparisonMap.get(a.articleCode)?.status;
                const sb = comparisonMap.get(b.articleCode)?.status;
                return statusSortOrder(sa) - statusSortOrder(sb);
              })
              .filter((line) => {
                if (statusFilter.size === 0) return true;
                const status = comparisonMap.get(line.articleCode)?.status;
                return status ? statusFilter.has(status) : false;
              });

            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-sm mb-3" data-testid="text-proforma-header">Proforma Expected <span className="text-muted-foreground font-normal">(mismatches only)</span></h3>
                  {sortedProformaLines.length > 0 ? (
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Article</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead className="text-right">Loaded</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedProformaLines.map((line, i) => {
                          const cmp = comparisonMap.get(line.articleCode);
                          const loaded = cmp?.loadedQty ?? 0;
                          const remaining = line.expectedQty - loaded;
                          return (
                            <TableRow key={i} className={getProformaRowClass(line.articleCode)} data-testid={`row-proforma-${line.articleCode}`}>
                              <TableCell className="font-mono text-sm" data-testid={`text-proforma-article-${line.articleCode}`}>
                                {line.articleCode}
                              </TableCell>
                              <TableCell className="text-sm">{line.productName}</TableCell>
                              <TableCell className="text-right font-mono">{fmtNum(Number(line.expectedQty))}</TableCell>
                              <TableCell className="text-right font-mono">{loaded}</TableCell>
                              <TableCell className="text-right font-mono">
                                {remaining > 0 ? (
                                  <span className="text-red-600 dark:text-red-400 font-medium">{fmtNum(remaining)}</span>
                                ) : remaining < 0 ? (
                                  <span className="text-green-600 dark:text-green-400 font-medium">+{fmtNum(Math.abs(remaining))}</span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono" data-testid={`text-stock-${line.articleCode}`}>
                                {(line.stockQty ?? 0) > 0 ? (
                                  <button
                                    className="underline underline-offset-2 cursor-pointer hover-elevate rounded px-0.5 text-foreground font-medium"
                                    onClick={() => {
                                      const p = new URLSearchParams({
                                        articleCode: line.articleCode,
                                        productName: line.productName,
                                        back: window.location.pathname + window.location.search,
                                      });
                                      navigate(`/factory/stock-bale-list?${p}`);
                                    }}
                                    data-testid={`button-stock-detail-${line.articleCode}`}
                                  >
                                    {line.stockQty}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell>{cmp ? getStatusBadge(cmp.status) : null}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-proforma-mismatches">All proforma items matched - no mismatches</p>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-sm mb-3" data-testid="text-loaded-header">Loaded Bales</h3>
                  {verification?.loadedItems && verification.loadedItems.length > 0 ? (
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Article</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                          {isAdminOrOwner && <TableHead className="text-right">Price</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {verification.loadedItems.map((group, i) => (
                          <TableRow key={i} data-testid={`row-loaded-${group.articleCode}`}>
                            <TableCell className="font-mono text-sm" data-testid={`text-loaded-article-${group.articleCode}`}>
                              {group.articleCode}
                            </TableCell>
                            <TableCell className="text-sm">{group.productName}</TableCell>
                            <TableCell className="text-right font-mono">{group.qty}</TableCell>
                            <TableCell className="text-right font-mono">{fmtNum(group.totalWeight || 0)}</TableCell>
                            {isAdminOrOwner && <TableCell className="text-right font-mono">{fmtNum(group.totalPrice || 0)}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-loaded">No loaded bales</p>
                  )}
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Ship className="h-5 w-5" />
            Container / Shipping
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Container Number</label>
              <Input
                value={containerNumber}
                onChange={(e) => setContainerNumber(e.target.value)}
                placeholder="e.g. MSCU1234567"
                data-testid="input-container-number"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Shipping Company</label>
              <Input
                value={shippingCompany}
                onChange={(e) => setShippingCompany(e.target.value)}
                placeholder="e.g. MSC, Maersk"
                data-testid="input-shipping-company"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Destination</label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Rotterdam, UK"
                data-testid="input-destination"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Container Notes</label>
            <Textarea
              value={containerNotes}
              onChange={(e) => setContainerNotes(e.target.value)}
              placeholder="Additional notes..."
              data-testid="input-container-notes"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => assignContainerMutation.mutate({ containerNumber, shippingCompany, containerNotes, destination })}
            disabled={assignContainerMutation.isPending}
            data-testid="button-save-container"
          >
            <Ship className="mr-2 h-4 w-4" />
            Save Container Info
          </Button>
        </CardContent>
      </Card>

      {(isPending || isVerified || isLoadingStatus) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">Freight &amp; Charges</CardTitle>
            <p className="text-xs text-muted-foreground">These will be billed to the customer and posted to the selected account</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {charges.length > 0 && (
              <div className="space-y-1">
                {charges.map((charge) => {
                  const acct = ledgerAccounts.find((a) => a.id === charge.ledgerAccountId);
                  return (
                    <div key={charge.id} className="flex items-center justify-between gap-2" data-testid={`row-charge-${charge.id}`}>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium">{charge.name}</span>
                        {acct && <span className="text-xs text-muted-foreground">{acct.name}</span>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="font-mono text-sm" data-testid={`text-charge-amount-${charge.id}`}>{fmtNum(parseFloat(charge.amount))}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeChargeMutation.mutate(charge.id)}
                          disabled={removeChargeMutation.isPending}
                          data-testid={`button-remove-charge-${charge.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground">Add Charge</p>
              <Select value={chargeType} onValueChange={setChargeType}>
                <SelectTrigger data-testid="select-charge-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREIGHT">Freight</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>

              {chargeType === "OTHER" && (
                <Input
                  value={chargeName}
                  onChange={(e) => setChargeName(e.target.value)}
                  placeholder="Charge name..."
                  data-testid="input-charge-name"
                />
              )}

              <Select value={chargeLedgerAccountId} onValueChange={setChargeLedgerAccountId}>
                <SelectTrigger data-testid="select-charge-account">
                  <SelectValue placeholder={chargeType !== "FREIGHT" ? "Select account (required)..." : "Select account (optional)..."} />
                </SelectTrigger>
                <SelectContent>
                  {ledgerAccounts.map((acct) => (
                    <SelectItem key={acct.id} value={String(acct.id)} data-testid={`option-account-${acct.id}`}>
                      {acct.name} <span className="text-muted-foreground text-xs">({acct.code})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chargeType !== "FREIGHT" && !chargeLedgerAccountId && (
                <p className="text-xs text-amber-600 dark:text-amber-400">A ledger account is required so the charge posts to accounting.</p>
              )}

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  placeholder="Amount"
                  data-testid="input-charge-amount"
                />
                <Button
                  variant="outline"
                  onClick={handleAddCharge}
                  disabled={!chargeAmount || (chargeType !== "FREIGHT" && !chargeLedgerAccountId) || addChargeMutation.isPending}
                  data-testid="button-add-charge"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowReturnDialog(true)}
            disabled={returnToLoadingMutation.isPending}
            data-testid="button-return-to-loading"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Return to Loading
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedProformaId("");
              setShowProformaDialog(true);
            }}
            disabled={applyProformaMutation.isPending}
            data-testid="button-apply-proforma-prices"
          >
            <DollarSign className="mr-2 h-4 w-4" />
            Apply Proforma Prices
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {isPending && (
            <Button
              onClick={() => setShowApproveDialog(true)}
              disabled={verifyMutation.isPending}
              data-testid="button-approve-verify"
            >
              <Check className="mr-2 h-4 w-4" />
              Approve & Verify
            </Button>
          )}
          {isVerified && isAdminOrOwner && orderDetail?.invoiceNumber && (
            <Button
              variant="outline"
              onClick={() => setShowFixBalesDialog(true)}
              disabled={forceSyncMutation.isPending}
              data-testid="button-fix-bale-status"
            >
              <Wrench className="mr-2 h-4 w-4" />
              Fix Bale Statuses
            </Button>
          )}
          {isVerified && (
            <Button
              onClick={fetchFinalizePreview}
              disabled={finalizeMutation.isPending || previewLoading}
              data-testid="button-finalize-invoice"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Finalize Invoice
            </Button>
          )}
        </div>
      </div>

      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve & Verify Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will mark the order as VERIFIED. You can add optional notes below.
            </p>
            <Textarea
              value={approveNotes}
              onChange={(e) => setApproveNotes(e.target.value)}
              placeholder="Optional notes..."
              data-testid="input-approve-notes"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setShowApproveDialog(false)} data-testid="button-cancel-approve">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  verifyMutation.mutate({ approved: true, notes: approveNotes || undefined });
                  setShowApproveDialog(false);
                }}
                disabled={verifyMutation.isPending}
                data-testid="button-confirm-approve"
              >
                <Check className="mr-2 h-4 w-4" />
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return to Loading</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will return the order back to the loading stage. Are you sure?
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setShowReturnDialog(false)} data-testid="button-cancel-return">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  returnToLoadingMutation.mutate();
                  setShowReturnDialog(false);
                }}
                disabled={returnToLoadingMutation.isPending}
                data-testid="button-confirm-return"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Confirm Return
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showFinalizePreview} onOpenChange={setShowFinalizePreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finalize Invoice Preview</DialogTitle>
          </DialogHeader>
          {finalizePreview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Bales in order:</span>{" "}
                  <span className="font-semibold" data-testid="text-preview-total">{finalizePreview.totalBalesInOrder}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Will be removed from stock:</span>{" "}
                  <span className="font-semibold" data-testid="text-preview-removable">{finalizePreview.baleCount}</span>
                </div>
              </div>

              {finalizePreview.baleCount > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Weight (kg)</TableHead>
                        <TableHead>Location</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {finalizePreview.bales.slice(0, 50).map((b) => (
                        <TableRow key={b.id} data-testid={`row-preview-bale-${b.id}`}>
                          <TableCell className="font-mono text-sm">{b.baleReference}</TableCell>
                          <TableCell className="text-sm">{b.productName}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmtNum(b.weightKg)}</TableCell>
                          <TableCell className="text-sm">{b.locationName}</TableCell>
                        </TableRow>
                      ))}
                      {finalizePreview.bales.length > 50 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground text-sm">
                            ...and {finalizePreview.bales.length - 50} more bales
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {finalizePreview.baleCount === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-preview-none">
                  No bales are currently in stock for this order. They may have already been marked as SOLD.
                </p>
              )}

              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Invoice Date</label>
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    data-testid="input-invoice-date"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowFinalizePreview(false)} data-testid="button-cancel-finalize">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      setShowFinalizePreview(false);
                      finalizeMutation.mutate(invoiceDate);
                    }}
                    disabled={finalizeMutation.isPending}
                    data-testid="button-confirm-finalize"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirm & Finalize
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showProformaDialog} onOpenChange={setShowProformaDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Proforma Prices</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a proforma to apply its article prices to all matching bales in this order. Only bales with a matching article code will be updated.
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
                      <span className="font-medium">${fmtNum(parseFloat(l.pricePerBale))}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowProformaDialog(false)}
                data-testid="button-cancel-proforma"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (selectedProformaId) applyProformaMutation.mutate(parseInt(selectedProformaId));
                }}
                disabled={!selectedProformaId || applyProformaMutation.isPending}
                data-testid="button-confirm-proforma"
              >
                <DollarSign className="mr-2 h-4 w-4" />
                Apply Prices
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showFixBalesDialog} onOpenChange={setShowFixBalesDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix Bale Statuses</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all bales attached to this order as SOLD, removing them from inventory.
              Use this only if bales were accidentally returned to stock after a previous finalization.
              This does not create invoices or customer balance entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-fix-bales">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceSyncMutation.mutate()}
              data-testid="button-confirm-fix-bales"
            >
              <Wrench className="mr-2 h-4 w-4" />
              Fix Bale Statuses
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showRecoverDialog} onOpenChange={(open) => { setShowRecoverDialog(open); if (!open) setRecoverTab("auto"); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Recover Bales (Admin)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Tab switcher */}
            <div className="flex rounded-md border overflow-hidden text-sm">
              <button
                className={`flex-1 px-3 py-2 font-medium transition-colors ${recoverTab === "auto" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
                onClick={() => setRecoverTab("auto")}
                data-testid="tab-auto-recover"
              >
                Auto-Recover from Stock
              </button>
              <button
                className={`flex-1 px-3 py-2 font-medium transition-colors border-l ${recoverTab === "manual" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
                onClick={() => setRecoverTab("manual")}
                data-testid="tab-manual-recover"
              >
                Manual by Reference
              </button>
            </div>

            {recoverTab === "auto" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Automatically finds bales from stock that match the proforma article codes for this order
                  and links them — up to the expected quantity per article. Bales claimed by other active
                  orders will be skipped.
                </p>
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <strong>Important:</strong> This picks bales by article code in insertion order (oldest first).
                  Verify the results afterwards and use manual recovery if specific bale references are needed.
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowRecoverDialog(false)} data-testid="button-cancel-recover">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => autoRecoverMutation.mutate()}
                    disabled={autoRecoverMutation.isPending}
                    data-testid="button-confirm-auto-recover"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${autoRecoverMutation.isPending ? "animate-spin" : ""}`} />
                    {autoRecoverMutation.isPending ? "Recovering…" : "Auto-Recover from Stock"}
                  </Button>
                </div>
              </>
            )}

            {recoverTab === "manual" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Paste the bale reference numbers that should be linked to this order — one per line.
                  Each reference will be looked up and re-linked here.
                  Bales already linked to another active order will be skipped.
                </p>
                <Textarea
                  value={recoverInput}
                  onChange={(e) => setRecoverInput(e.target.value)}
                  placeholder={"BAL-001\nBAL-002\nBAL-003"}
                  rows={8}
                  className="font-mono text-sm"
                  data-testid="input-recover-bales"
                />
                <p className="text-xs text-muted-foreground">
                  SQL to find available bales:
                  <code className="block mt-1 p-2 bg-muted rounded text-xs whitespace-pre-wrap">
                    {`SELECT reference_number, article_code, status\nFROM factory_bales\nWHERE status IN ('SOLD','RESERVED_FOR_ORDER','IN_STOCK')\nAND NOT EXISTS (\n  SELECT 1 FROM customer_order_bales cob\n  WHERE cob.bale_id = factory_bales.id\n)\nORDER BY updated_at DESC;`}
                  </code>
                </p>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowRecoverDialog(false)} data-testid="button-cancel-recover">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      const refs = recoverInput.split("\n").map((r) => r.trim()).filter(Boolean);
                      if (refs.length === 0) return;
                      recoverBalesMutation.mutate(refs);
                    }}
                    disabled={recoverBalesMutation.isPending || !recoverInput.trim()}
                    data-testid="button-confirm-recover"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${recoverBalesMutation.isPending ? "animate-spin" : ""}`} />
                    {recoverBalesMutation.isPending ? "Recovering…" : `Recover ${recoverInput.split("\n").filter((r) => r.trim()).length} Bale(s)`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
