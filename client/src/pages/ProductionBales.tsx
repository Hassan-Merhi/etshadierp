import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, Trash2, Package, ScanLine, AlertCircle,
  XCircle, ChevronDown, ChevronRight, AlertTriangle, Printer
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import type { FactoryBaleProduct, Location, FactoryMixBatch } from "@shared/schema";

function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

function generateFinalLabelHtml(labels: Array<{
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
  locationName?: string;
}>) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="page-container">
        <div class="code-label">
          <div class="label-top">
            <div class="logo-section">
              <div class="logo-text">HMD</div>
              <div class="logo-subtitle">INTERNATIONAL GROUP</div>
            </div>
            <div class="info-section">
              <div class="info-row"><span class="info-key">PIECES:</span> <span class="info-val">${formatLabelNum(label.pieces)}</span></div>
              <div class="info-row"><span class="info-key">ARTICLE:</span> <span class="info-val">${label.articleCode}</span></div>
              <div class="info-row"><span class="info-key">APRX WEIGHT:</span> <span class="info-val">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
            </div>
          </div>
          <div class="barcode-area">
            <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Barcode" />
            <div class="barcode-number">${label.referenceNumber}</div>
          </div>
          <div class="article-barcode-area">
            <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
            <div class="article-barcode-number">${label.productName}</div>
          </div>
        </div>
        <div class="name-label">
          <div class="name-label-text">${label.productName}</div>
        </div>
      </div>`;
  }
  return `<html><head><title>Final Labels</title><style>
    @page { size: 76mm 105mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .page-container { width: 76mm; height: 105mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .page-container:last-child { page-break-after: auto; }
    .code-label { width: 76mm; height: 55mm; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; background: #fff; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .logo-section { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-text { font-size: 18pt; font-weight: 900; letter-spacing: 2px; color: #000; line-height: 1; }
    .logo-subtitle { font-size: 5pt; font-weight: 700; letter-spacing: 1px; color: #000; margin-top: 0.5mm; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: auto; }
    .barcode-img { width: 60mm; height: 10mm; object-fit: contain; }
    .barcode-number { font-size: 8pt; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 0.5mm; letter-spacing: 1px; }
    .article-barcode-area { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 50mm; height: 8mm; object-fit: contain; }
    .article-barcode-number { font-size: 7pt; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 0.3mm; letter-spacing: 1px; color: #333; }
    .name-label { width: 76mm; height: 50mm; display: flex; align-items: center; justify-content: center; background: #fff; border-top: 0.3mm solid #ddd; }
    .name-label-text { font-size: 36pt; font-weight: 900; color: #000; text-align: center; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap; }
    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print { .print-note { display: none !important; } }
  </style></head><body><div class="print-note">FINAL LABELS - disable "Headers and Footers" in print settings for cleanest output.</div>${labelsHtml}</body></html>`;
}

export default function ProductionBales() {
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedMixBatchId, setSelectedMixBatchId] = useState<string>("");
  const [scannedBaleIds, setScannedBaleIds] = useState<Set<number>>(new Set());
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: pressingBatches, isLoading: batchesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/pressing-batches"],
  });

  const { data: baleProducts } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: mixBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const activeLocations = locations?.filter((l) => l.active);
  const activeMixBatches = mixBatches?.filter((b) => b.status === "ACTIVE");

  const pendingBatches = pressingBatches?.filter((b: any) => b.pendingCount > 0);
  const expandedBatch = pressingBatches?.find((b: any) => b.id === expandedBatchId);
  const pendingBalesInBatch = expandedBatch?.bales?.filter((b: any) => b.status === "PENDING_PRESSING") || [];
  const scannedCount = scannedBaleIds.size;
  const expectedCount = pendingBalesInBatch.length;
  const missingBales = pendingBalesInBatch.filter((b: any) => !scannedBaleIds.has(b.id));
  const countsMatch = scannedCount === expectedCount && expectedCount > 0;
  const hasScanned = scannedCount > 0;

  const selectedMixBatch = activeMixBatches?.find((b) => b.id.toString() === selectedMixBatchId);
  const mixBatchRemaining = selectedMixBatch
    ? parseFloat(selectedMixBatch.totalWeightKg) - parseFloat(selectedMixBatch.usedKg || "0")
    : 0;

  const totalScannedWeight = pendingBalesInBatch
    .filter((b: any) => scannedBaleIds.has(b.id))
    .reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);

  useEffect(() => {
    if (scanRef.current && expandedBatchId) {
      scanRef.current.focus();
    }
  }, [scannedBaleIds, expandedBatchId]);

  const toggleBatch = (batchId: number) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null);
      setScannedBaleIds(new Set());
      setScanError("");
    } else {
      setExpandedBatchId(batchId);
      setScannedBaleIds(new Set());
      setScanError("");
    }
  };

  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    setScanError("");

    if (!expandedBatchId) {
      setScanError("Please expand a pressing batch first");
      setScanInput("");
      return;
    }

    try {
      const response = await apiRequest("GET", `/api/factory/bales/lookup/${encodeURIComponent(value.trim())}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Bale not found");
      }

      const result = await response.json();
      const bale = result.bale || result;

      if (bale.status !== "PENDING_PRESSING") {
        setScanError(`Bale is not pending (status: ${bale.status})`);
        setScanInput("");
        return;
      }

      if (bale.pressingBatchId !== expandedBatchId) {
        setScanError("This bale does not belong to the selected pressing batch");
        setScanInput("");
        return;
      }

      if (scannedBaleIds.has(bale.id)) {
        setScanError("Bale already scanned");
        setScanInput("");
        return;
      }

      setScannedBaleIds((prev) => {
        const next = new Set(Array.from(prev));
        next.add(bale.id);
        return next;
      });
    } catch (error: any) {
      setScanError(error.message || "Bale not found");
    }

    setScanInput("");
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(scanInput);
    }
  };

  const removeScannedBale = (baleId: number) => {
    setScannedBaleIds((prev) => {
      const next = new Set(prev);
      next.delete(baleId);
      return next;
    });
  };

  const clearScanned = () => {
    setScannedBaleIds(new Set());
    setScanError("");
  };

  const handleValidateClick = () => {
    if (!selectedLocationId) {
      toast({ title: "Error", description: "Please select a warehouse location first", variant: "destructive" });
      return;
    }
    if (!selectedMixBatchId) {
      toast({ title: "Error", description: "Please select a mix batch first", variant: "destructive" });
      return;
    }
    if (scannedBaleIds.size === 0) {
      toast({ title: "Error", description: "Please scan at least one bale", variant: "destructive" });
      return;
    }
    setConfirmDialogOpen(true);
  };

  const selectedLocationName = activeLocations?.find((l) => l.id.toString() === selectedLocationId);

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/factory/finalize", {
        pressingBatchId: expandedBatchId,
        scannedBaleIds: Array.from(scannedBaleIds),
        erpLocationId: parseInt(selectedLocationId),
        mixBatchId: parseInt(selectedMixBatchId),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to finalize bales");
      }

      return await response.json();
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pressing-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });

      const locName = selectedLocationName ? `${selectedLocationName.code} - ${selectedLocationName.name}` : "";

      const finalizedBales = pendingBalesInBatch.filter((b: any) => scannedBaleIds.has(b.id));

      try {
        const labelData = finalizedBales.map((bale: any) => ({
          productionBaleId: bale.id,
          productId: bale.productId,
          articleCode: bale.articleCode || "",
          pieces: 1,
          approxWeightKg: bale.weightKg || "0",
        }));

        const labelResponse = await apiRequest("POST", "/api/bale-label-prints", { bales: labelData });

        if (labelResponse.ok) {
          const { labelPrints } = await labelResponse.json();

          const baleMap = new Map(finalizedBales.map((b: any) => [b.id, b]));
          const labels = labelPrints.map((lp: any) => {
            const bale = baleMap.get(lp.productionBaleId) || {};
            return {
              referenceNumber: lp.referenceNumber,
              articleCode: lp.articleCode || (bale as any).articleCode || "",
              pieces: lp.pieces || 1,
              approxWeightKg: lp.approxWeightKg || (bale as any).weightKg || "0",
              productName: (bale as any).productName || "",
              locationName: locName,
            };
          });

          const printWindow = window.open("", "_blank");
          if (printWindow) {
            printWindow.document.write(generateFinalLabelHtml(labels));
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 500);
          } else {
            toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
          }
        } else {
          toast({ title: "Warning", description: "Finalized but could not generate new labels", variant: "destructive" });
        }
      } catch {
        toast({ title: "Warning", description: "Finalized but label printing failed", variant: "destructive" });
      }

      const count = result.updated || finalizedBales.length;
      const missingCount = result.missingBales?.length || 0;

      if (missingCount > 0) {
        toast({
          title: "Partially Finalized",
          description: `${count} bale(s) finalized. ${missingCount} bale(s) still pending.`,
        });
      } else {
        toast({
          title: "Finalized",
          description: `${count} bale(s) moved to stock with new labels`,
        });
      }

      setScannedBaleIds(new Set());
      setExpandedBatchId(null);
      setSelectedLocationId("");
      setSelectedMixBatchId("");
      setConfirmDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (batchesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" data-testid="text-loading" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finalize / Counting</h1>
          <p className="text-muted-foreground mt-1">Expand a batch, scan bales to verify, then validate</p>
        </div>
        <Badge variant="outline" className="text-sm" data-testid="badge-finalize-mode">
          <CheckCircle className="h-3 w-3 mr-1" />
          FINALIZE MODE
        </Badge>
      </div>

      {(!pendingBatches || pendingBatches.length === 0) && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No pending pressing batches</p>
              <p className="text-sm mt-1">Create pressing batches first, then come back to finalize them</p>
            </div>
          </CardContent>
        </Card>
      )}

      {pendingBatches && pendingBatches.length > 0 && (
        <div className="space-y-3">
          {pendingBatches.map((batch: any) => {
            const isExpanded = expandedBatchId === batch.id;
            const batchBales = batch.bales?.filter((b: any) => b.status === "PENDING_PRESSING") || [];
            const productGroups = new Map<string, number>();
            batchBales.forEach((b: any) => {
              const name = b.productName || "Unknown";
              productGroups.set(name, (productGroups.get(name) || 0) + 1);
            });
            const totalWeight = batchBales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);
            const productSummary = Array.from(productGroups.entries())
              .map(([name, count]) => `${count}x ${name}`)
              .join(", ");

            return (
              <Card key={batch.id}>
                <div
                  className="p-4 cursor-pointer hover-elevate"
                  onClick={() => toggleBatch(batch.id)}
                  data-testid={`batch-card-${batch.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">Batch #{batch.id}</span>
                          <Badge variant="secondary" className="text-xs">
                            {batch.pendingCount} pending
                          </Badge>
                          {batch.finalizedCount > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {batch.finalizedCount} finalized
                            </Badge>
                          )}
                          {batch.status === "PARTIALLY_FINALIZED" && (
                            <Badge variant="outline" className="text-xs">Partial</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">
                          {productSummary} | {formatNumber(totalWeight)} kg | {new Date(batch.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {isExpanded && hasScanned && (
                      <Badge variant={countsMatch ? "default" : "secondary"} className="text-xs">
                        {scannedCount}/{expectedCount} scanned
                      </Badge>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <ScanLine className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Scan bales to verify</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          ref={scanRef}
                          value={scanInput}
                          onChange={(e) => { setScanInput(e.target.value); setScanError(""); }}
                          onKeyDown={handleScanKeyDown}
                          placeholder="Scan bale barcode..."
                          autoFocus
                          data-testid="input-finalize-scan"
                        />
                        {hasScanned && (
                          <Button variant="ghost" size="sm" onClick={clearScanned} data-testid="button-clear-scanned">
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {scanError && (
                        <div className="flex items-center gap-2 text-destructive text-sm mt-2" data-testid="text-scan-error">
                          <AlertCircle className="h-4 w-4" />
                          {scanError}
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10">Verified</TableHead>
                            <TableHead>Ref Number</TableHead>
                            <TableHead>Article Code</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Weight (kg)</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {batchBales.map((bale: any) => {
                            const isScanned = scannedBaleIds.has(bale.id);
                            return (
                              <TableRow
                                key={bale.id}
                                className={isScanned ? "bg-green-50/50 dark:bg-green-950/10" : ""}
                                data-testid={`row-bale-${bale.id}`}
                              >
                                <TableCell>
                                  {isScanned ? (
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-sm">{bale.referenceNumber}</TableCell>
                                <TableCell className="font-mono text-sm text-muted-foreground">{bale.articleCode || "-"}</TableCell>
                                <TableCell>{bale.productName || "-"}</TableCell>
                                <TableCell className="text-right font-mono tabular-nums">
                                  {formatNumber(parseFloat(bale.weightKg || "0"))}
                                </TableCell>
                                <TableCell>
                                  {isScanned && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeScannedBale(bale.id)}
                                      data-testid={`button-remove-scanned-${bale.id}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <p className="text-sm text-muted-foreground mb-1.5">Mix Batch (raw material)</p>
                          <Select value={selectedMixBatchId} onValueChange={setSelectedMixBatchId}>
                            <SelectTrigger data-testid="select-finalize-mix-batch">
                              <SelectValue placeholder="Select Mix Batch..." />
                            </SelectTrigger>
                            <SelectContent>
                              {activeMixBatches && activeMixBatches.length > 0 ? (
                                activeMixBatches.map((mb) => {
                                  const remaining = parseFloat(mb.totalWeightKg) - parseFloat(mb.usedKg || "0");
                                  return (
                                    <SelectItem key={mb.id} value={mb.id.toString()}>
                                      {mb.name || mb.batchCode} ({formatNumber(remaining)} kg left)
                                    </SelectItem>
                                  );
                                })
                              ) : (
                                <SelectItem value="none" disabled>No active mix batches</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          {selectedMixBatch && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Remaining: {formatNumber(mixBatchRemaining)} kg |
                              Will consume: <span className={totalScannedWeight > mixBatchRemaining + 0.001 ? "text-destructive font-medium" : ""}>{formatNumber(totalScannedWeight)} kg</span>
                            </div>
                          )}
                        </div>

                        <div>
                          <p className="text-sm text-muted-foreground mb-1.5">Warehouse Location</p>
                          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                            <SelectTrigger data-testid="select-finalize-location">
                              <SelectValue placeholder="Select Location..." />
                            </SelectTrigger>
                            <SelectContent>
                              {activeLocations?.map((loc) => (
                                <SelectItem key={loc.id} value={loc.id.toString()}>
                                  {loc.code} - {loc.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4 text-sm">
                          <span>
                            Scanned: <span className={`font-bold ${countsMatch ? "text-green-600" : hasScanned ? "text-amber-500" : ""}`} data-testid="text-scanned-count">{scannedCount}</span> / <span data-testid="text-expected-count">{expectedCount}</span>
                          </span>
                          {missingBales.length > 0 && hasScanned && (
                            <span className="text-amber-500 flex items-center gap-1">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {missingBales.length} missing
                            </span>
                          )}
                        </div>

                        <Button
                          onClick={handleValidateClick}
                          disabled={finalizeMutation.isPending || !hasScanned || !selectedLocationId || !selectedMixBatchId}
                          data-testid="button-validate-finalize"
                        >
                          {finalizeMutation.isPending ? (
                            "Finalizing..."
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Validate & Finalize ({scannedCount} bales)
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {countsMatch ? "Confirm Finalization" : "Finalize with Missing Bales?"}
            </DialogTitle>
            <DialogDescription>
              {countsMatch
                ? `All ${scannedCount} bales have been verified. Ready to finalize and print labels.`
                : `${scannedCount} of ${expectedCount} bales scanned. ${missingBales.length} bale(s) are missing.`
              }
            </DialogDescription>
          </DialogHeader>

          {missingBales.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-500 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                Missing Bales:
              </div>
              <div className="max-h-40 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ref Number</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missingBales.map((bale: any) => (
                      <TableRow key={bale.id}>
                        <TableCell className="font-mono text-sm">{bale.referenceNumber}</TableCell>
                        <TableCell className="text-sm">{bale.productName || "-"}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatNumber(parseFloat(bale.weightKg || "0"))} kg</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                These bales will remain pending and can be finalized later.
              </p>
            </div>
          )}

          <div className="text-sm space-y-1">
            <p>Location: <span className="font-medium">{selectedLocationName ? `${selectedLocationName.code} - ${selectedLocationName.name}` : "-"}</span></p>
            <p>Mix Batch: <span className="font-medium">{selectedMixBatch?.name || selectedMixBatch?.batchCode || "-"}</span></p>
            <p>Weight to consume: <span className="font-medium">{formatNumber(totalScannedWeight)} kg</span></p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => finalizeMutation.mutate()}
              disabled={finalizeMutation.isPending}
              data-testid="button-confirm-finalize"
            >
              {finalizeMutation.isPending ? "Finalizing..." : (
                <>
                  <Printer className="h-4 w-4 mr-2" />
                  {countsMatch ? "Finalize & Print Labels" : `Finalize ${scannedCount} Bales & Print`}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
