import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Package, Tag, Clock, User, Scale, Hash, MapPin, Layers, Container, Truck, FlaskConical, Box, CheckCircle2, AlertCircle, XCircle, ArchiveX, Ship, FileText, User2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import type { BaleProduct, BaleLabelPrint } from "@shared/schema";

type LookupTab = "article" | "reference";

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

export default function BarcodeLookup() {
  const [activeTab, setActiveTab] = useState<LookupTab>("article");
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  // Admin dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showChangeProductDialog, setShowChangeProductDialog] = useState(false);
  const [changeProductSearch, setChangeProductSearch] = useState("");
  const [selectedNewProductId, setSelectedNewProductId] = useState<number | null>(null);

  const [articleResult, setArticleResult] = useState<{
    product: BaleProduct | null;
    labelPrints: BaleLabelPrint[];
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
  } | null>(null);

  const articleLookup = useMutation({
    mutationFn: async (code: string) => {
      const response = await modeApiRequest("GET", `/api/lookup/article/${encodeURIComponent(code)}`);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setActiveTab("reference");
      setSearchValue(ref);
      setTimeout(() => referenceLookup.mutate(ref), 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    if (!searchValue.trim()) return;
    if (activeTab === "article") {
      articleLookup.mutate(searchValue.trim());
    } else {
      referenceLookup.mutate(searchValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleTabChange = (tab: LookupTab) => {
    setActiveTab(tab);
    setSearchValue("");
    setArticleResult(null);
    setReferenceResult(null);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleString();
  };

  const formatDateOnly = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString();
  };

  const isLoading = articleLookup.isPending || referenceLookup.isPending;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <Button
          variant={activeTab === "article" ? "default" : "ghost"}
          onClick={() => handleTabChange("article")}
          data-testid="tab-lookup-article"
        >
          <Tag className="h-4 w-4 mr-2" />
          Search by ARTICLE
        </Button>
        <Button
          variant={activeTab === "reference" ? "default" : "ghost"}
          onClick={() => handleTabChange("reference")}
          data-testid="tab-lookup-reference"
        >
          <Hash className="h-4 w-4 mr-2" />
          Search by REFERENCE
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={activeTab === "article" ? "Enter article code (e.g. HMD01000)" : "Enter reference number (e.g. REF0000001)"}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="input-lookup-search"
        />
        <Button
          onClick={handleSearch}
          disabled={isLoading || !searchValue.trim()}
          data-testid="button-lookup-search"
        >
          <Search className="h-4 w-4 mr-2" />
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {/* ── ARTICLE LOOKUP ── */}
      {activeTab === "article" && articleResult && (
        <div className="space-y-4">
          {articleResult.product ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Package className="h-5 w-5" />
                  Product Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Article Code" value={<span className="font-mono" data-testid="text-article-code">{(articleResult.product as any).articleCode || (articleResult.product as any).code}</span>} />
                  <InfoRow label="Product Name" value={<span data-testid="text-product-name">{(articleResult.product as any).name}</span>} />
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={(articleResult.product as any).active ? "default" : "secondary"} data-testid="badge-product-status">
                      {(articleResult.product as any).active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {(articleResult.product as any).description && (
                    <div className="col-span-2">
                      <InfoRow label="Description" value={(articleResult.product as any).description} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No product found for article code "{searchValue}"</p>
              </CardContent>
            </Card>
          )}

          {articleResult.labelPrints.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <Clock className="h-5 w-5" />
                  Label Print History ({articleResult.labelPrints.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Pieces</TableHead>
                      <TableHead>Weight (kg)</TableHead>
                      <TableHead>Printed At</TableHead>
                      <TableHead>Scanned At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {articleResult.labelPrints.map((lp) => (
                      <TableRow key={lp.id} data-testid={`row-label-print-${lp.id}`}>
                        <TableCell className="font-mono font-medium">{lp.referenceNumber}</TableCell>
                        <TableCell>{lp.pieces}</TableCell>
                        <TableCell>{lp.approxWeightKg}</TableCell>
                        <TableCell>{formatDate(lp.printedAt as any)}</TableCell>
                        <TableCell>{lp.scannedAt ? formatDate(lp.scannedAt as any) : <Badge variant="outline">Not scanned</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : articleResult.product ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No labels printed yet for this article code</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* ── REFERENCE LOOKUP ── */}
      {activeTab === "reference" && referenceResult && (
        <div className="space-y-4">
          {referenceResult.labelPrint ? (
            <>
              {/* Merged: Bale Reference Details (Label Print + Bale Details) */}
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Hash className="h-5 w-5" />
                      Bale Reference Details
                      {referenceResult.baleInfo && <BaleStatusBadge status={referenceResult.baleInfo.status} />}
                    </CardTitle>
                    {isAdmin && (
                      <div className="flex items-center gap-2 flex-wrap">
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
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Identity section */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <InfoRow
                      label="Reference Number"
                      value={<span className="font-mono text-lg" data-testid="text-reference-number">{referenceResult.labelPrint.referenceNumber}</span>}
                    />
                    <InfoRow label="Article Code" value={<span data-testid="text-ref-article-code">{referenceResult.labelPrint.articleCode}</span>} />
                    {referenceResult.baleInfo?.baleCode && (
                      <InfoRow label="Bale Code" value={<span className="font-mono">{referenceResult.baleInfo.baleCode}</span>} />
                    )}
                    {referenceResult.baleInfo?.productName && (
                      <InfoRow label="Product Name" value={<span className="font-semibold" data-testid="text-bale-product-name">{referenceResult.baleInfo.productName}</span>} />
                    )}
                    <InfoRow label="Pieces" value={<span data-testid="text-ref-pieces">{referenceResult.labelPrint.pieces}</span>} />
                    <InfoRow label="Approx Weight" value={<span data-testid="text-ref-weight">{referenceResult.labelPrint.approxWeightKg} KGS</span>} />
                    {referenceResult.baleInfo && (
                      <InfoRow label="Actual Weight" value={`${parseFloat(referenceResult.baleInfo.weightKg).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KG`} />
                    )}
                    {referenceResult.baleInfo?.grade && (
                      <InfoRow label="Grade" value={referenceResult.baleInfo.grade} />
                    )}
                    {referenceResult.baleInfo?.totalCost && (
                      <InfoRow label="Cost / Bale" value={parseFloat(referenceResult.baleInfo.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                    )}
                  </div>

                  <Separator />

                  {/* Print / Scan section */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Printed At</p>
                      <p className="font-medium" data-testid="text-ref-printed-at">{formatDate(referenceResult.labelPrint.printedAt as any) ?? "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Printed By</p>
                      <p className="font-medium" data-testid="text-ref-printed-by">{(referenceResult.labelPrint as any).printedByName || referenceResult.labelPrint.printedByUserId || "Unknown"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Scanned At</p>
                      <p className="font-medium" data-testid="text-ref-scanned-at">
                        {referenceResult.labelPrint.scannedAt
                          ? formatDate(referenceResult.labelPrint.scannedAt as any)
                          : <Badge variant="outline">Not scanned yet</Badge>}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Scanned By</p>
                      <p className="font-medium" data-testid="text-ref-scanned-by">
                        {(referenceResult.labelPrint as any).scannedByName || referenceResult.labelPrint.scannedByUserId || "N/A"}
                      </p>
                      {!referenceResult.labelPrint.scannedAt && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          disabled={markScanned.isPending}
                          onClick={() => markScanned.mutate(referenceResult.labelPrint!.referenceNumber)}
                          data-testid="button-mark-scanned"
                        >
                          {markScanned.isPending ? "Scanning..." : "Mark as Scanned"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Production / Stock section */}
                  {referenceResult.baleInfo && (referenceResult.baleInfo.workerName || referenceResult.baleInfo.pressedAt || referenceResult.baleInfo.finalizedAt || referenceResult.baleInfo.stockEntryDate || referenceResult.locationInfo) && (
                    <>
                      <Separator />
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {referenceResult.baleInfo.workerName && (
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Worker</p>
                            <p className="font-medium" data-testid="text-bale-worker">{referenceResult.baleInfo.workerName}</p>
                          </div>
                        )}
                        {referenceResult.baleInfo.pressedAt && (
                          <InfoRow label="Pressed At" value={formatDate(referenceResult.baleInfo.pressedAt)} />
                        )}
                        {referenceResult.baleInfo.finalizedAt && (
                          <InfoRow label="Finalized At" value={formatDate(referenceResult.baleInfo.finalizedAt)} />
                        )}
                        {referenceResult.baleInfo.stockEntryDate && (
                          <InfoRow label="Stock Entry Date" value={formatDateOnly(referenceResult.baleInfo.stockEntryDate)} />
                        )}
                        {referenceResult.locationInfo && (
                          <div className="col-span-2 md:col-span-3">
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                              <MapPin className="h-3.5 w-3.5" /> Current Location
                            </p>
                            <p className="font-medium text-base" data-testid="text-bale-location">
                              {referenceResult.locationInfo.name}
                              {(referenceResult.locationInfo.city || referenceResult.locationInfo.state) && (
                                <span className="text-muted-foreground font-normal text-sm ml-2">
                                  ({[referenceResult.locationInfo.city, referenceResult.locationInfo.state].filter(Boolean).join(", ")})
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Loaded onto outbound container / customer order */}
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
                  <Card data-testid="card-loaded-on-order">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 flex-wrap">
                        <Ship className="h-5 w-5" />
                        Loaded onto Outbound Container
                        <Badge variant={statusColors[o.status] ?? "outline"}>{o.status.replace("_", " ")}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {o.containerNumber && (
                          <div className="col-span-2 md:col-span-1">
                            <p className="text-sm text-muted-foreground flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Container No.</p>
                            <p className="font-mono font-semibold text-base" data-testid="text-loaded-container">{o.containerNumber}</p>
                          </div>
                        )}
                        {o.customerName && (
                          <InfoRow label="Customer" value={<span className="flex items-center gap-1"><User2 className="h-3.5 w-3.5 text-muted-foreground" />{o.customerName}</span>} />
                        )}
                        {o.invoiceNumber && (
                          <InfoRow label="Invoice No." value={<span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-mono">{o.invoiceNumber}</span></span>} />
                        )}
                        <InfoRow label="Order Date" value={formatDateOnly(o.orderDate)} />
                        {o.shippingCompany && (
                          <InfoRow label="Shipping Company" value={o.shippingCompany} />
                        )}
                        <InfoRow label="Total Bales in Order" value={o.totalQtyBales.toLocaleString()} />
                        <InfoRow label="This Bale — Price Used" value={parseFloat(o.priceUsed).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                        <InfoRow label="This Bale — Weight" value={`${parseFloat(o.baleWeight).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KG`} />
                        {o.loadingStartedAt && (
                          <InfoRow label="Loading Started" value={formatDate(o.loadingStartedAt)} />
                        )}
                        {o.loadingFinalizedAt && (
                          <InfoRow label="Loading Finalized" value={formatDate(o.loadingFinalizedAt)} />
                        )}
                        {o.containerNotes && (
                          <div className="col-span-2 md:col-span-3">
                            <InfoRow label="Notes" value={o.containerNotes} />
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Source Containers */}
              {referenceResult.containers_used && referenceResult.containers_used.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Container className="h-5 w-5" />
                      Source Container{referenceResult.containers_used.length > 1 ? "s" : ""}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {referenceResult.containers_used.map((c, i) => (
                        <div key={c.id} className={`rounded-md border p-3 ${i > 0 ? "mt-3" : ""}`} data-testid={`card-container-${c.id}`}>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div className="col-span-2 md:col-span-1">
                              <p className="text-sm text-muted-foreground flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Container No.</p>
                              <p className="font-mono font-semibold text-base" data-testid={`text-container-number-${c.id}`}>{c.containerNumber}</p>
                            </div>
                            {c.supplierName && (
                              <InfoRow label="Supplier" value={c.supplierName} />
                            )}
                            {c.origin && (
                              <InfoRow label="Origin" value={c.origin} />
                            )}
                            {c.arrivalDate && (
                              <InfoRow label="Arrival Date" value={formatDateOnly(c.arrivalDate)} />
                            )}
                            <div>
                              <p className="text-sm text-muted-foreground">Status</p>
                              <Badge variant="outline">{c.status}</Badge>
                            </div>
                            {c.weightKgUsed && (
                              <InfoRow label="KG Used from This Container" value={`${parseFloat(c.weightKgUsed).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KG`} />
                            )}
                            {c.ratePerKg && (
                              <InfoRow label="Rate / KG" value={`${c.currencyCode} ${parseFloat(c.ratePerKg).toFixed(4)}`} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Mix Batch */}
              {referenceResult.mixBatch && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <FlaskConical className="h-5 w-5" />
                      Mix Batch
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <InfoRow label="Batch Code" value={<span className="font-mono">{referenceResult.mixBatch.batchCode}</span>} />
                      {referenceResult.mixBatch.batchNumber && (
                        <InfoRow label="Batch Number" value={referenceResult.mixBatch.batchNumber} />
                      )}
                      {referenceResult.mixBatch.name && (
                        <InfoRow label="Name" value={referenceResult.mixBatch.name} />
                      )}
                      {referenceResult.mixBatch.batchDate && (
                        <InfoRow label="Batch Date" value={formatDateOnly(referenceResult.mixBatch.batchDate)} />
                      )}
                      <InfoRow label="Total Weight" value={`${parseFloat(referenceResult.mixBatch.totalWeightKg).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} KG`} />
                      <InfoRow label="Cost / KG" value={parseFloat(referenceResult.mixBatch.costPerKg).toFixed(4)} />
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant="outline">{referenceResult.mixBatch.status}</Badge>
                      </div>
                      {referenceResult.mixBatch.operatorUser && (
                        <InfoRow label="Operator" value={referenceResult.mixBatch.operatorUser} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Pressing Batch */}
              {referenceResult.pressingBatch && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Layers className="h-5 w-5" />
                      Pressing Batch
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <InfoRow label="Batch ID" value={<span className="font-mono">#{referenceResult.pressingBatch.id}</span>} />
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant="outline">{referenceResult.pressingBatch.status}</Badge>
                      </div>
                      <InfoRow label="Expected Bale Count" value={referenceResult.pressingBatch.expectedCount} />
                      {referenceResult.pressingBatch.finalizedAt && (
                        <InfoRow label="Finalized At" value={formatDate(referenceResult.pressingBatch.finalizedAt)} />
                      )}
                      {referenceResult.pressingBatch.notes && (
                        <div className="col-span-2 md:col-span-3">
                          <InfoRow label="Notes" value={referenceResult.pressingBatch.notes} />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Linked Product */}
              {referenceResult.product && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      <Package className="h-5 w-5" />
                      Linked Product
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <InfoRow label="Article Code" value={(referenceResult.product as any).articleCode || (referenceResult.product as any).code} />
                      <InfoRow label="Product Name" value={(referenceResult.product as any).name} />
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge variant={(referenceResult.product as any).active ? "default" : "secondary"}>
                          {(referenceResult.product as any).active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-center text-muted-foreground">No record found for reference "{searchValue}"</p>
              </CardContent>
            </Card>
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
    </div>
  );
}
