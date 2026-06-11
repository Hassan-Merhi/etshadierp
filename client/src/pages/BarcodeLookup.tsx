import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Package, Clock, User, Hash, Layers, Container, Truck, FlaskConical, CheckCircle2, AlertCircle, XCircle, ArchiveX, Ship, FileText, User2, Trash2, Pencil, ArchiveRestore, Undo2, AlertTriangle, History, ArrowLeftRight, ScanLine, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useAdminOverride } from "@/hooks/use-admin-override";
import type { BaleProduct, BaleLabelPrint } from "@shared/schema";

function BaleStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    IN_STOCK:         { label: "In Stock",         variant: "default",     icon: CheckCircle2 },
    SOLD:             { label: "Sold",              variant: "secondary",   icon: ArchiveX },
    FINALIZED:        { label: "Finalized",         variant: "secondary",   icon: CheckCircle2 },
    DISPATCHED:       { label: "Dispatched",        variant: "secondary",   icon: XCircle },
    DELETED:          { label: "Deleted",           variant: "destructive", icon: XCircle },
    REMOVED:          { label: "Deleted",           variant: "destructive", icon: XCircle },
    PENDING_PRESSING: { label: "Pending Pressing",  variant: "outline",     icon: AlertCircle },
  };
  const info = map[status] || { label: status, variant: "outline" as const, icon: AlertCircle };
  const Icon = info.icon;
  return (
    <Badge variant={info.variant} className="gap-1" data-testid="badge-bale-status">
      <Icon className="h-3 w-3" />
      {info.label}
    </Badge>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-medium ${mono ? "font-mono" : ""}`}>{value ?? <span className="text-muted-foreground">N/A</span>}</p>
    </div>
  );
}

type SearchMode = "reference" | "article";

export default function BarcodeLookup() {
  const [searchMode, setSearchMode] = useState<SearchMode>("reference");
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [articleResult, setArticleResult] = useState<{
    product: BaleProduct | null;
    labelPrints: BaleLabelPrint[];
  } | null>(null);

  const { wrapAdminAction, AdminDialog } = useAdminOverride();

  // Admin dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showChangeProductDialog, setShowChangeProductDialog] = useState(false);
  const [changeProductSearch, setChangeProductSearch] = useState("");
  const [selectedNewProductId, setSelectedNewProductId] = useState<number | null>(null);
  const [showReturnToStockDialog, setShowReturnToStockDialog] = useState(false);
  const [showSwapDialog, setShowSwapDialog] = useState(false);
  const [swapRef, setSwapRef] = useState("");
  const [swapPreview, setSwapPreview] = useState<{
    referenceNumber: string;
    productName: string | null;
    weightKg: string;
    status: string;
    articleCode: string | null;
  } | null>(null);

  const [referenceResult, setReferenceResult] = useState<{
    labelPrint: BaleLabelPrint | null;
    product: BaleProduct | null;
    baleInfo: {
      id: number;
      baleCode: string;
      status: string;
      weightKg: string;
      costPerKg: string;
      totalCost: string;
      grade: string | null;
      stockEntryDate: string | null;
      pressedAt: string | null;
      finalizedAt: string | null;
      workerName: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      deletedAt: string | null;
    } | null;
    locationInfo: { id: number; name: string; city: string | null; state: string | null } | null;
    pressingBatch: {
      id: number;
      status: string;
      expectedCount: number;
      finalizedAt: string | null;
      notes: string | null;
    } | null;
    mixBatch: {
      id: number;
      batchCode: string;
      batchNumber: string | null;
      name: string | null;
      batchDate: string | null;
      totalWeightKg: string;
      costPerKg: string;
      status: string;
      operatorUser: string | null;
    } | null;
    containers_used: Array<{
      id: number;
      containerNumber: string;
      origin: string | null;
      arrivalDate: string | null;
      status: string;
      supplierName: string | null;
      weightKgUsed: string | null;
      currencyCode: string;
      ratePerKg: string | null;
    }>;
    loadedOnOrder: {
      orderId: number;
      invoiceNumber: string | null;
      orderDate: string;
      status: string;
      containerNumber: string | null;
      shippingCompany: string | null;
      containerNotes: string | null;
      loadingStartedAt: string | null;
      loadingFinalizedAt: string | null;
      grandTotal: string;
      totalQtyBales: number;
      customerName: string | null;
      priceUsed: string;
      baleWeight: string;
    } | null;
    auditHistory: Array<{
      id: number;
      action: string;
      username: string;
      changes: Record<string, { old: any; new: any }> | null;
      createdAt: string;
    }>;
  } | null>(null);

  const referenceLookup = useMutation({
    mutationFn: async (refNum: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/reference/${encodeURIComponent(refNum)}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Lookup failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setReferenceResult(data);
      setArticleResult(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Not Found", description: error.message, variant: "destructive" });
      setReferenceResult(null);
    },
  });

  const articleLookup = useMutation({
    mutationFn: async (articleCode: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/article/${encodeURIComponent(articleCode)}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Lookup failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setArticleResult(data);
      setReferenceResult(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Not Found", description: error.message, variant: "destructive" });
      setArticleResult(null);
    },
  });

  const markScanned = useMutation({
    mutationFn: async (refNum: string) => {
      const response = await modeApiRequest("POST", `/api/lookup/reference/${encodeURIComponent(refNum)}/scan`, {});
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to mark as scanned");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setReferenceResult((prev) =>
        prev ? { ...prev, labelPrint: { ...prev.labelPrint!, scannedAt: data.scannedAt, scannedByUserId: data.scannedByUserId, scannedByName: data.scannedByName } } : prev
      );
      toast({ title: "Scanned", description: "Label marked as scanned" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Fetch current user role for admin actions
  const { data: currentUser } = useQuery<{ role: string }>({
    queryKey: ["/api/auth/me"],
  });

  const isAdmin = currentUser?.role === "Admin" || currentUser?.role === "Owner" || currentUser?.role === "Developer";

  // Fetch all bale products for the change-product dialog
  const { data: baleProductsList } = useQuery<BaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
    enabled: showChangeProductDialog,
  });

  const filteredBaleProducts = (baleProductsList || []).filter((p) => {
    if (!changeProductSearch.trim()) return true;
    const s = changeProductSearch.toLowerCase();
    return p.name.toLowerCase().includes(s) || (p.articleCode || "").toLowerCase().includes(s) || p.code.toLowerCase().includes(s);
  });

  const deleteBaleMutation = useMutation({
    mutationFn: async (refNum: string) => {
      const response = await modeApiRequest("DELETE", `/api/lookup/reference/${encodeURIComponent(refNum)}/delete-everywhere`, {});
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to delete bale");
      }
      return response.json();
    },
    onSuccess: () => {
      setShowDeleteDialog(false);
      setReferenceResult(null);
      setSearchValue("");
      toast({ title: "Deleted", description: "Bale has been deleted from all linked records." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const changeProductMutation = useMutation({
    mutationFn: async ({ refNum, newProductId }: { refNum: string; newProductId: number }) => {
      const response = await modeApiRequest("PATCH", `/api/lookup/reference/${encodeURIComponent(refNum)}/change-product`, { newProductId });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to change product");
      }
      return response.json();
    },
    onSuccess: (_data, { refNum }) => {
      setShowChangeProductDialog(false);
      setSelectedNewProductId(null);
      setChangeProductSearch("");
      referenceLookup.mutate(refNum);
      toast({ title: "Updated", description: "Bale product changed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Simple restore for DELETED/REMOVED bales (just a status patch)
  const restoreDeletedMutation = useMutation({
    mutationFn: async (baleId: number) => {
      const response = await modeApiRequest("PATCH", `/api/factory/bales/${baleId}/status`, { status: "IN_STOCK" });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to return bale to stock");
      }
      return response.json();
    },
    onSuccess: (_data, _baleId) => {
      if (referenceResult?.labelPrint?.referenceNumber) {
        referenceLookup.mutate(referenceResult.labelPrint.referenceNumber);
      }
      toast({ title: "Returned to Stock", description: "Bale status set back to In Stock." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Order info for the return-to-stock confirmation dialog
  const returnableBaleId = (() => {
    const s = referenceResult?.baleInfo?.status;
    return (s === "RESERVED_FOR_ORDER" || s === "RESERVED" || s === "SOLD") && showReturnToStockDialog
      ? referenceResult?.baleInfo?.id
      : null;
  })();

  const { data: returnToStockOrderInfo, isLoading: orderInfoLoading } = useQuery<any>({
    queryKey: ["/api/factory/bales", returnableBaleId, "order-info"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", `/api/factory/bales/${returnableBaleId}/order-info`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!returnableBaleId,
  });

  // Full return-to-stock for RESERVED_FOR_ORDER/RESERVED/SOLD (removes from order, cascades invoice)
  const returnToStockMutation = useMutation({
    mutationFn: async (baleId: number) => {
      const response = await modeApiRequest("POST", `/api/factory/bales/${baleId}/return-to-stock`, {});
      if (!response.ok) {
        const err = await response.json();
        throw Object.assign(new Error(err.message || "Failed to return bale to stock"), { isLastBale: err.isLastBale });
      }
      return response.json();
    },
    onSuccess: (data) => {
      setShowReturnToStockDialog(false);
      if (referenceResult?.labelPrint?.referenceNumber) {
        referenceLookup.mutate(referenceResult.labelPrint.referenceNumber);
      }
      const invoiceMsg = data.invoiceNumber
        ? ` Invoice ${data.invoiceNumber} updated to $${parseFloat(data.newGrandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      toast({ title: "Bale returned to stock", description: `Bale removed from order.${invoiceMsg}` });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Preview lookup for the replacement bale in the swap dialog
  const swapPreviewMutation = useMutation({
    mutationFn: async (ref: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/reference/${encodeURIComponent(ref.trim())}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Bale not found");
      }
      return response.json();
    },
    onSuccess: (data) => {
      const b = data?.baleInfo;
      if (!b) throw new Error("Bale not found");
      setSwapPreview({
        referenceNumber: data.labelPrint?.referenceNumber || swapRef.trim(),
        productName: b.productName ?? null,
        weightKg: b.weightKg,
        status: b.status,
        articleCode: data.labelPrint?.articleCode ?? null,
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      setSwapPreview(null);
      toast({ title: "Lookup Failed", description: error.message, variant: "destructive" });
    },
  });

  // Perform the actual swap
  const swapMutation = useMutation({
    mutationFn: async ({ currentBaleRef, replacementBaleRef }: { currentBaleRef: string; replacementBaleRef: string }) => {
      const response = await modeApiRequest("POST", "/api/factory/bales/swap", { currentBaleRef, replacementBaleRef });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Swap failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setShowSwapDialog(false);
      setSwapRef("");
      setSwapPreview(null);
      // Re-run the lookup for the current bale to refresh its state (now IN_STOCK)
      if (referenceResult?.labelPrint?.referenceNumber) {
        referenceLookup.mutate(referenceResult.labelPrint.referenceNumber);
      }
      const invoiceMsg = data.invoiceNumber
        ? ` Invoice ${data.invoiceNumber} updated to $${parseFloat(data.newGrandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      toast({ title: "Bale swapped", description: `${data.replacedRef} → ${data.replacementRef} in the order.${invoiceMsg}` });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Swap Failed", description: error.message, variant: "destructive" });
    },
  });

  // Auto-detect mode from input value
  useEffect(() => {
    const v = searchValue.trim().toUpperCase();
    if (v.startsWith("REF")) {
      setSearchMode("reference");
    } else if (v.length > 0) {
      setSearchMode("article");
    }
  }, [searchValue]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setSearchValue(ref);
      setTimeout(() => referenceLookup.mutate(ref), 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    if (!searchValue.trim()) return;
    if (searchMode === "article") {
      articleLookup.mutate(searchValue.trim());
    } else {
      referenceLookup.mutate(searchValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleString();
  };

  const formatDateOnly = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString();
  };

  const smartNum = (val: string | number) => {
    const n = parseFloat(String(val));
    if (isNaN(n)) return String(val);
    if (n % 1 === 0) return n.toLocaleString();
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const isLoading = referenceLookup.isPending || articleLookup.isPending;

  return (
    <div className="space-y-4 p-4">

      {/* ── Header + Search ── */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-blue-500/30 to-blue-600/10 border border-blue-500/25 shrink-0">
            <ScanLine className="h-4.5 w-4.5 text-blue-500" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Bale Lookup</h1>
            <p className="text-xs text-muted-foreground leading-tight">Search by reference number or article code</p>
          </div>
        </div>
        <div className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Scan or type a reference (REF…) or article code…"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-9 pr-24"
                autoFocus
                data-testid="input-lookup-search"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground hover-elevate"
                onClick={() => setSearchMode(searchMode === "reference" ? "article" : "reference")}
                data-testid="button-toggle-search-mode"
                title="Click to switch between Ref # and Article Code mode"
              >
                {searchMode === "reference" ? "Ref #" : "Article"}
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <Button
              onClick={handleSearch}
              disabled={isLoading || !searchValue.trim()}
              data-testid="button-lookup-search"
            >
              <Search className="h-4 w-4 mr-1.5" />
              {isLoading ? "Searching…" : "Search"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Mode auto-detects: inputs starting with <span className="font-mono font-medium">REF</span> search by reference number, everything else by article code. Click the badge to override.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {/* ── ARTICLE LOOKUP ── */}
      {articleResult && (
        <div className="space-y-4">
          {articleResult.product ? (
            <div className="rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/20 flex-wrap">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-bold text-base">{(articleResult.product as any).name}</span>
                  <Badge variant={(articleResult.product as any).active ? "default" : "secondary"} className="text-xs">
                    {(articleResult.product as any).active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide mr-1.5">Article Code</span>
                    <span className="font-mono font-semibold">{(articleResult.product as any).articleCode || (articleResult.product as any).code}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wide mr-1.5">References</span>
                    <span className="font-semibold font-mono">{articleResult.labelPrints.length.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {articleResult.labelPrints.length > 0 ? (
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-muted border-b-2 border-border/60">
                    <TableRow>
                      <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference No.</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Approx. Weight (KG)</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Printed At</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scanned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articleResult.labelPrints.map((lp) => {
                      const baleStatus = (lp as any).baleStatus as string | null;
                      const isDeleted = baleStatus === "DELETED" || baleStatus === "REMOVED";
                      return (
                      <TableRow
                        key={lp.id}
                        className="cursor-pointer hover-elevate"
                        data-testid={`row-label-${lp.id}`}
                        onClick={() => {
                          setSearchMode("reference");
                          setSearchValue(lp.referenceNumber);
                          referenceLookup.mutate(lp.referenceNumber);
                        }}
                      >
                        <TableCell className={`font-mono font-medium ${isDeleted ? "text-muted-foreground line-through" : ""}`}>{lp.referenceNumber}</TableCell>
                        <TableCell className="font-mono">{smartNum(lp.approxWeightKg)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {lp.printedAt ? new Date(lp.printedAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          {baleStatus ? (
                            <BaleStatusBadge status={baleStatus} />
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {lp.scannedAt ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Scanned
                            </Badge>
                          ) : (
                            <Badge variant="outline">Not Scanned</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      );})}
                    </TableBody>
                  </Table>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No bale references found for this article code.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
              No product found for article code "<span className="font-mono">{searchValue}</span>"
            </div>
          )}
        </div>
      )}

      {/* ── REFERENCE LOOKUP ── */}
      {referenceResult && (
        <div className="space-y-4">
          {referenceResult.labelPrint ? (
            <>
              {/* ── Bale Reference Details ── */}
              <div className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/20 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-bold">Bale Reference Details</span>
                    {referenceResult.baleInfo && <BaleStatusBadge status={referenceResult.baleInfo.status} />}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {(referenceResult.baleInfo?.status === "DELETED" || referenceResult.baleInfo?.status === "REMOVED") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={restoreDeletedMutation.isPending}
                          onClick={() => referenceResult.baleInfo && restoreDeletedMutation.mutate(referenceResult.baleInfo.id)}
                          data-testid="button-restore-deleted"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5 mr-1" />
                          {restoreDeletedMutation.isPending ? "Restoring…" : "Restore to Stock"}
                          </Button>
                        )}
                        {(referenceResult.baleInfo?.status === "RESERVED_FOR_ORDER" || referenceResult.baleInfo?.status === "RESERVED" || referenceResult.baleInfo?.status === "SOLD") && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSwapRef("");
                                setSwapPreview(null);
                                setShowSwapDialog(true);
                              }}
                              data-testid="button-swap-bale"
                            >
                              <ArrowLeftRight className="h-3.5 w-3.5 mr-1 text-amber-500" />
                              Swap Bale
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowReturnToStockDialog(true)}
                              data-testid="button-return-to-stock"
                            >
                              <Undo2 className="h-3.5 w-3.5 mr-1 text-blue-500" />
                              Return to Stock
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedNewProductId(null);
                            setChangeProductSearch("");
                            setShowChangeProductDialog(true);
                          }}
                          data-testid="button-change-product"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Change Product
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setShowDeleteDialog(true)}
                          data-testid="button-delete-bale-everywhere"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Delete Bale
                        </Button>
                      </div>
                    )}
                  </div>
                <div className="px-4 py-4 space-y-4">
                  {/* Row 1: Key fields */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Reference Number</p>
                      <p className="font-mono text-lg font-bold" data-testid="text-reference-number">{referenceResult.labelPrint.referenceNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Article Code</p>
                      <p className="font-mono font-semibold" data-testid="text-ref-article-code">{referenceResult.labelPrint.articleCode || "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1" data-testid="text-ref-printed-at">
                        <Clock className="h-3 w-3" />
                        {formatDateOnly(referenceResult.labelPrint.printedAt as any) ?? "N/A"}
                      </p>
                    </div>
                    {referenceResult.baleInfo?.productName && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Product Name</p>
                        <p className="font-semibold" data-testid="text-bale-product-name">{referenceResult.baleInfo.productName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1" data-testid="text-ref-printed-by">
                          <User className="h-3 w-3" />
                          {(referenceResult.labelPrint as any).printedByName || referenceResult.labelPrint.printedByUserId || "Unknown"}
                        </p>
                      </div>
                    )}
                    {referenceResult.baleInfo?.workerName && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Worker</p>
                        <p className="font-semibold flex items-center gap-1" data-testid="text-bale-worker-name">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          {referenceResult.baleInfo.workerName}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Row 2: Weight + Grade + Scan button */}
                  <div className="flex items-center gap-6 flex-wrap">
                    {referenceResult.baleInfo && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Actual Weight</p>
                        <p className="font-bold font-mono text-base">{smartNum(referenceResult.baleInfo.weightKg)} KG</p>
                      </div>
                    )}
                    {referenceResult.baleInfo?.grade && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Grade</p>
                        <p className="font-semibold">{referenceResult.baleInfo.grade}</p>
                      </div>
                    )}
                    {referenceResult.labelPrint.scannedAt ? (
                      <div className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Scanned {formatDateOnly(referenceResult.labelPrint.scannedAt as any)}
                      </div>
                    ) : (
                      <div className="ml-auto">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markScanned.isPending}
                          onClick={() => markScanned.mutate(referenceResult.labelPrint!.referenceNumber)}
                          data-testid="button-mark-scanned"
                        >
                          {markScanned.isPending ? "Scanning..." : "Mark as Scanned"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Row 3: Audit dates */}
                  {referenceResult.baleInfo && (
                    <div className="flex items-start gap-6 flex-wrap pt-3 border-t">
                      {(referenceResult.baleInfo.finalizedAt || referenceResult.baleInfo.stockEntryDate) && (
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-0.5">
                            <History className="h-3 w-3" /> Date Produced
                          </p>
                          <p className="text-sm font-medium">
                            {referenceResult.baleInfo.finalizedAt
                              ? formatDateOnly(referenceResult.baleInfo.finalizedAt)
                              : formatDateOnly(referenceResult.baleInfo.stockEntryDate!)}
                          </p>
                        </div>
                      )}
                      {referenceResult.baleInfo.createdAt && (
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-0.5">
                            <Clock className="h-3 w-3" /> Record Created
                          </p>
                          <p className="text-sm font-medium">{formatDate(referenceResult.baleInfo.createdAt)}</p>
                        </div>
                      )}
                      {referenceResult.baleInfo.updatedAt && referenceResult.baleInfo.updatedAt !== referenceResult.baleInfo.createdAt && (
                        <div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-0.5">
                            <Pencil className="h-3 w-3" /> Last Modified
                          </p>
                          <p className="text-sm font-medium">{formatDate(referenceResult.baleInfo.updatedAt)}</p>
                        </div>
                      )}
                      {(referenceResult.baleInfo.deletedAt || referenceResult.baleInfo.status === "DELETED") && (() => {
                        const deleteEntry = referenceResult.auditHistory?.find((e: any) => e.action === "delete");
                        return (
                          <div>
                            <p className="text-xs text-destructive flex items-center gap-1 mb-0.5">
                              <Trash2 className="h-3 w-3" /> Deleted
                            </p>
                            <p className="text-sm font-medium text-destructive">
                              {referenceResult.baleInfo.deletedAt
                                ? formatDate(referenceResult.baleInfo.deletedAt)
                                : formatDate(deleteEntry?.createdAt) ?? "—"}
                            </p>
                            {deleteEntry?.username && (
                              <p className="text-xs text-muted-foreground mt-0.5">by {deleteEntry.username}</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Change Log ── */}
              {referenceResult.auditHistory && referenceResult.auditHistory.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Change Log</span>
                  </div>
                  <div className="px-4 divide-y">
                    {referenceResult.auditHistory.map((entry) => {
                      const changedFields = entry.changes ? Object.keys(entry.changes) : [];
                      const actionLabel =
                        entry.action === "create" ? "Created" :
                        entry.action === "delete" ? "Deleted" :
                        entry.action === "restore" ? "Restored" : "Updated";
                      return (
                        <div key={entry.id} className="flex items-start gap-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                variant={entry.action === "delete" ? "destructive" : entry.action === "create" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {actionLabel}
                              </Badge>
                              <span className="text-sm font-medium flex items-center gap-1">
                                <User className="h-3 w-3 text-muted-foreground" />
                                {entry.username}
                              </span>
                              <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                            </div>
                            {changedFields.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                Changed: {changedFields.join(", ")}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Loaded onto Outbound Container ── */}
              {referenceResult.loadedOnOrder && (() => {
                const o = referenceResult.loadedOnOrder!;
                const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
                  FINALIZED: "default",
                  VERIFIED: "default",
                  PENDING_VERIFICATION: "secondary",
                  LOADING: "secondary",
                  DRAFT: "outline",
                  CANCELLED: "destructive",
                };
                return (
                  <div className="rounded-xl border overflow-hidden" data-testid="card-loaded-on-order">
                    <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20 flex-wrap">
                      <Ship className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm">Loaded onto Outbound Container</span>
                      <Badge variant={statusColors[o.status] ?? "outline"} className="text-xs">{o.status.replace("_", " ")}</Badge>
                    </div>
                    <div className="px-4 py-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {o.containerNumber && (
                          <div className="col-span-2 md:col-span-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1"><Truck className="h-3 w-3" /> Container No.</p>
                            <p className="font-mono font-bold text-base" data-testid="text-loaded-container">{o.containerNumber}</p>
                          </div>
                        )}
                        {o.customerName && (
                          <InfoRow label="Customer" value={<span className="flex items-center gap-1"><User2 className="h-3.5 w-3.5 text-muted-foreground" />{o.customerName}</span>} />
                        )}
                        {o.invoiceNumber && (
                          <InfoRow label="Invoice No." value={<span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-mono font-semibold">{o.invoiceNumber}</span></span>} />
                        )}
                        <InfoRow label="Order Date" value={formatDateOnly(o.orderDate)} />
                        {o.shippingCompany && <InfoRow label="Shipping Company" value={o.shippingCompany} />}
                        <InfoRow label="Total Bales in Order" value={o.totalQtyBales.toLocaleString()} />
                        <InfoRow label="This Bale — Weight" value={`${smartNum(o.baleWeight)} KG`} />
                        {o.loadingStartedAt && <InfoRow label="Loading Started" value={formatDate(o.loadingStartedAt)} />}
                        {o.loadingFinalizedAt && <InfoRow label="Loading Finalized" value={formatDate(o.loadingFinalizedAt)} />}
                        {o.scannedBy && <InfoRow label="Scanned by" value={<span className="flex items-center gap-1"><User2 className="h-3.5 w-3.5 text-muted-foreground" />{o.scannedBy}</span>} />}
                        {o.containerNotes && (
                          <div className="col-span-2 md:col-span-3">
                            <InfoRow label="Notes" value={o.containerNotes} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Source Containers ── */}
              {referenceResult.containers_used && referenceResult.containers_used.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
                    <Container className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Source Container{referenceResult.containers_used.length > 1 ? "s" : ""}</span>
                  </div>
                  <div className="px-4 py-4 space-y-3">
                    {referenceResult.containers_used.map((c) => (
                      <div key={c.id} className="rounded-lg border p-3" data-testid={`card-container-${c.id}`}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="col-span-2 md:col-span-1">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1"><Truck className="h-3 w-3" /> Container No.</p>
                            <p className="font-mono font-bold text-base" data-testid={`text-container-number-${c.id}`}>{c.containerNumber}</p>
                          </div>
                          {c.supplierName && <InfoRow label="Supplier" value={c.supplierName} />}
                          {c.origin && <InfoRow label="Origin" value={c.origin} />}
                          {c.arrivalDate && <InfoRow label="Arrival Date" value={formatDateOnly(c.arrivalDate)} />}
                          <div>
                            <p className="text-sm text-muted-foreground">Status</p>
                            <Badge variant="outline" className="text-xs">{c.status}</Badge>
                          </div>
                          {c.weightKgUsed && <InfoRow label="KG Used" value={`${smartNum(c.weightKgUsed)} KG`} />}
                          {isAdmin && c.ratePerKg && <InfoRow label="Rate / KG" value={`${c.currencyCode} ${smartNum(c.ratePerKg)}`} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Mix Batch ── */}
              {referenceResult.mixBatch && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
                    <FlaskConical className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Mix Batch</span>
                  </div>
                  <div className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <InfoRow label="Batch Code" value={<span className="font-mono font-semibold">{referenceResult.mixBatch.batchCode}</span>} />
                      {referenceResult.mixBatch.batchNumber && <InfoRow label="Batch Number" value={referenceResult.mixBatch.batchNumber} />}
                      {referenceResult.mixBatch.name && <InfoRow label="Name" value={referenceResult.mixBatch.name} />}
                      {referenceResult.mixBatch.batchDate && <InfoRow label="Batch Date" value={formatDateOnly(referenceResult.mixBatch.batchDate)} />}
                      <InfoRow label="Total Weight" value={`${smartNum(referenceResult.mixBatch.totalWeightKg)} KG`} />
                      {isAdmin && <InfoRow label="Cost / KG" value={smartNum(referenceResult.mixBatch.costPerKg)} />}
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant="outline" className="text-xs">{referenceResult.mixBatch.status}</Badge>
                      </div>
                      {referenceResult.mixBatch.operatorUser && <InfoRow label="Operator" value={referenceResult.mixBatch.operatorUser} />}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Pressing Batch ── */}
              {referenceResult.pressingBatch && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Pressing Batch</span>
                  </div>
                  <div className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <InfoRow label="Batch ID" value={<span className="font-mono font-semibold">#{referenceResult.pressingBatch.id}</span>} />
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant="outline" className="text-xs">{referenceResult.pressingBatch.status}</Badge>
                      </div>
                      <InfoRow label="Expected Bale Count" value={referenceResult.pressingBatch.expectedCount} />
                      {referenceResult.pressingBatch.finalizedAt && <InfoRow label="Finalized At" value={formatDate(referenceResult.pressingBatch.finalizedAt)} />}
                      {referenceResult.pressingBatch.notes && (
                        <div className="col-span-2 md:col-span-3">
                          <InfoRow label="Notes" value={referenceResult.pressingBatch.notes} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Linked Product ── */}
              {referenceResult.product && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">Linked Product</span>
                  </div>
                  <div className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <InfoRow label="Article Code" value={<span className="font-mono font-semibold">{(referenceResult.product as any).articleCode || (referenceResult.product as any).code}</span>} />
                      <InfoRow label="Product Name" value={(referenceResult.product as any).name} />
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant={(referenceResult.product as any).active ? "default" : "secondary"} className="text-xs">
                          {(referenceResult.product as any).active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border p-8 text-center text-muted-foreground">
              <Hash className="h-10 w-10 mx-auto mb-3 opacity-25" />
              <p className="text-sm">No record found for reference "<span className="font-mono">{searchValue}</span>"</p>
            </div>
          )}
        </div>
      )}

      {/* Delete Bale Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bale Everywhere</DialogTitle>
            <DialogDescription>
              This will permanently soft-delete the factory bale record for{" "}
              <span className="font-mono font-semibold">{referenceResult?.labelPrint?.referenceNumber}</span>.
              The label print history will remain for audit purposes.
              This action cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={deleteBaleMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBaleMutation.isPending}
              onClick={() => {
                if (referenceResult?.labelPrint?.referenceNumber) {
                  deleteBaleMutation.mutate(referenceResult.labelPrint.referenceNumber);
                }
              }}
              data-testid="button-confirm-delete-bale"
            >
              {deleteBaleMutation.isPending ? "Deleting..." : "Yes, Delete Bale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Product Dialog */}
      <Dialog open={showChangeProductDialog} onOpenChange={(open) => {
        setShowChangeProductDialog(open);
        if (!open) { setSelectedNewProductId(null); setChangeProductSearch(""); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Linked Bale Product</DialogTitle>
            <DialogDescription>
              Select a new product to link to reference{" "}
              <span className="font-mono font-semibold">{referenceResult?.labelPrint?.referenceNumber}</span>.
              This will update the article code, bale code and product name on the bale record and label print.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Search by name or article code..."
              value={changeProductSearch}
              onChange={(e) => setChangeProductSearch(e.target.value)}
              data-testid="input-change-product-search"
            />
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {filteredBaleProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No products found</p>
              ) : (
                filteredBaleProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm hover-elevate ${selectedNewProductId === p.id ? "bg-muted font-semibold" : ""}`}
                    onClick={() => setSelectedNewProductId(p.id)}
                    data-testid={`item-product-${p.id}`}
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.articleCode && (
                      <span className="ml-2 text-muted-foreground font-mono text-xs">{p.articleCode}</span>
                    )}
                    <span className="ml-2 text-muted-foreground font-mono text-xs">{p.code}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowChangeProductDialog(false)} disabled={changeProductMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!selectedNewProductId || changeProductMutation.isPending}
              onClick={() => {
                if (referenceResult?.labelPrint?.referenceNumber && selectedNewProductId) {
                  changeProductMutation.mutate({
                    refNum: referenceResult.labelPrint.referenceNumber,
                    newProductId: selectedNewProductId,
                  });
                }
              }}
              data-testid="button-confirm-change-product"
            >
              {changeProductMutation.isPending ? "Saving..." : "Confirm Change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Swap Bale Dialog */}
      <Dialog open={showSwapDialog} onOpenChange={(open) => {
        if (!open) { setShowSwapDialog(false); setSwapRef(""); setSwapPreview(null); }
      }}>
        <DialogContent className="max-w-md" data-testid="dialog-swap-bale">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-amber-500" />
              Swap Bale
            </DialogTitle>
            <DialogDescription>
              Replace <span className="font-mono font-semibold">{referenceResult?.labelPrint?.referenceNumber}</span> with another in-stock bale. The current bale returns to stock; the replacement takes its place in the order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Replacement ref input + lookup */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Replacement Bale Reference</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. REF200012"
                  value={swapRef}
                  onChange={(e) => { setSwapRef(e.target.value); setSwapPreview(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && swapRef.trim()) swapPreviewMutation.mutate(swapRef); }}
                  data-testid="input-swap-ref"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!swapRef.trim() || swapPreviewMutation.isPending}
                  onClick={() => swapPreviewMutation.mutate(swapRef)}
                  data-testid="button-lookup-swap-ref"
                >
                  {swapPreviewMutation.isPending ? "Looking…" : "Look Up"}
                </Button>
              </div>
            </div>

            {/* Preview of replacement bale */}
            {swapPreview && (
              <div className="rounded-md border p-3 space-y-2 text-sm">
                <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Replacement Bale</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div>
                    <p className="text-xs text-muted-foreground">Reference</p>
                    <p className="font-mono font-semibold">{swapPreview.referenceNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p>{swapPreview.status === "IN_STOCK" ? (
                      <span className="text-green-600 dark:text-green-400 font-medium">In Stock</span>
                    ) : (
                      <span className="text-destructive font-medium">{swapPreview.status}</span>
                    )}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Product</p>
                    <p>{swapPreview.productName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Weight</p>
                    <p>{swapPreview.weightKg} KG</p>
                  </div>
                  {swapPreview.articleCode && (
                    <div>
                      <p className="text-xs text-muted-foreground">Article Code</p>
                      <p className="font-mono">{swapPreview.articleCode}</p>
                    </div>
                  )}
                </div>
                {swapPreview.status !== "IN_STOCK" && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <p>This bale is not IN_STOCK. Only in-stock bales can be used as replacements.</p>
                  </div>
                )}
              </div>
            )}

            {/* Info note */}
            <p className="text-xs text-muted-foreground">
              The price used in the order remains unchanged. Order totals will be recalculated based on the replacement bale's weight.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setShowSwapDialog(false); setSwapRef(""); setSwapPreview(null); }}
              data-testid="button-cancel-swap"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !swapPreview ||
                swapPreview.status !== "IN_STOCK" ||
                swapMutation.isPending
              }
              onClick={() => {
                if (!referenceResult?.labelPrint?.referenceNumber || !swapPreview) return;
                swapMutation.mutate({
                  currentBaleRef: referenceResult.labelPrint.referenceNumber,
                  replacementBaleRef: swapPreview.referenceNumber,
                });
              }}
              data-testid="button-confirm-swap"
            >
              {swapMutation.isPending ? "Swapping…" : "Confirm Swap"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return to Stock Dialog */}
      <Dialog open={showReturnToStockDialog} onOpenChange={(open) => { if (!open) setShowReturnToStockDialog(false); }}>
        <DialogContent className="max-w-md" data-testid="dialog-return-to-stock">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-blue-500" />
              Return Bale to Stock
            </DialogTitle>
            <DialogDescription>
              Bale <span className="font-mono font-semibold">{referenceResult?.labelPrint?.referenceNumber}</span>
              {referenceResult?.baleInfo?.productName ? ` — ${referenceResult.baleInfo.productName}` : ""}
              {referenceResult?.baleInfo?.weightKg ? ` (${referenceResult.baleInfo.weightKg} kg)` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {orderInfoLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading order details...</div>
            ) : returnToStockOrderInfo ? (
              <>
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order status</span>
                    <Badge variant="secondary" className="text-xs">{returnToStockOrderInfo.status}</Badge>
                  </div>
                  {returnToStockOrderInfo.invoiceNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Invoice</span>
                      <span className="font-mono font-semibold">{returnToStockOrderInfo.invoiceNumber}</span>
                    </div>
                  )}
                  {returnToStockOrderInfo.customerName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer</span>
                      <span>{returnToStockOrderInfo.customerName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current total</span>
                    <span className="font-mono">${parseFloat(returnToStockOrderInfo.grandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bales in order</span>
                    <span>{returnToStockOrderInfo.totalBalesInOrder}</span>
                  </div>
                </div>

                {returnToStockOrderInfo.totalBalesInOrder <= 1 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>This is the last bale in the order. You must cancel the entire order instead.</p>
                  </div>
                )}

                {returnToStockOrderInfo.status === "FINALIZED" && returnToStockOrderInfo.totalBalesInOrder > 1 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>
                      This order is <strong>finalized</strong>. Removing this bale will reduce invoice <strong>{returnToStockOrderInfo.invoiceNumber}</strong> and update the customer's balance. Admin authorisation required.
                    </p>
                  </div>
                )}

                {!["FINALIZED"].includes(returnToStockOrderInfo.status) && returnToStockOrderInfo.totalBalesInOrder > 1 && (
                  <p className="text-sm text-muted-foreground">
                    The bale will be removed from this order and returned to stock. Order totals will be recalculated.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No order linked to this bale — it will simply be returned to stock.</p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowReturnToStockDialog(false)} data-testid="button-cancel-return-to-stock">
              Cancel
            </Button>
            <Button
              disabled={
                returnToStockMutation.isPending ||
                orderInfoLoading ||
                (returnToStockOrderInfo?.totalBalesInOrder <= 1)
              }
              onClick={() => {
                if (!referenceResult?.baleInfo?.id) return;
                const baleId = referenceResult.baleInfo.id;
                const isFinalized = returnToStockOrderInfo?.status === "FINALIZED";
                const doIt = () => returnToStockMutation.mutate(baleId);
                if (isFinalized) {
                  wrapAdminAction(doIt, "Return Bale to Stock (Finalized Order)");
                } else {
                  doIt();
                }
              }}
              data-testid="button-confirm-return-to-stock"
            >
              {returnToStockMutation.isPending ? "Processing..." : "Return to Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {AdminDialog}
    </div>
  );
}
