import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle, Trash2, Printer, Package, ScanLine, AlertCircle, Search, XCircle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    .product-short { font-size: 7pt; font-weight: 900; text-transform: uppercase; margin-top: 0.3mm; color: #000; white-space: nowrap; }
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
  const [selectedPressingBatchId, setSelectedPressingBatchId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedMixBatchId, setSelectedMixBatchId] = useState<string>("");
  const [scannedBales, setScannedBales] = useState<any[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
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
  const selectedBatchData = pressingBatches?.find((b: any) => b.id?.toString() === selectedPressingBatchId);

  const selectedMixBatch = activeMixBatches?.find((b) => b.id.toString() === selectedMixBatchId);
  const mixBatchRemaining = selectedMixBatch
    ? parseFloat(selectedMixBatch.totalWeightKg) - parseFloat(selectedMixBatch.usedKg || "0")
    : 0;

  const expectedCount = selectedBatchData?.pendingCount || 0;
  const scannedCount = scannedBales.length;
  const countsMatch = scannedCount === expectedCount && expectedCount > 0;

  useEffect(() => {
    if (scanRef.current) {
      scanRef.current.focus();
    }
  }, [scannedBales]);

  const handleScan = async (value: string) => {
    if (!value.trim()) return;
    setScanError("");

    if (!selectedPressingBatchId) {
      setScanError("Please select a pressing batch first");
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

      if (bale.pressingBatchId?.toString() !== selectedPressingBatchId) {
        setScanError("This bale does not belong to the selected pressing batch");
        setScanInput("");
        return;
      }

      if (scannedBales.some((b: any) => b.id === bale.id)) {
        setScanError("Bale already scanned");
        setScanInput("");
        return;
      }

      const product = result.product || baleProducts?.find((p) => p.id === bale.productId);

      setScannedBales((prev) => [...prev, {
        ...bale,
        productName: product?.name || bale.baleCode || "",
        articleCode: product?.articleCode || bale.referenceNumber || "",
      }]);
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
    setScannedBales((prev) => prev.filter((b: any) => b.id !== baleId));
  };

  const clearScanned = () => {
    setScannedBales([]);
    setScanError("");
  };

  const selectedLocationName = activeLocations?.find((l) => l.id.toString() === selectedLocationId);

  const totalScannedWeight = scannedBales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!countsMatch) {
        throw new Error(`Count mismatch: expected ${expectedCount}, scanned ${scannedCount}`);
      }
      if (!selectedLocationId) {
        throw new Error("Please select a warehouse location");
      }
      if (!selectedMixBatchId) {
        throw new Error("Please select a mix batch for raw material consumption");
      }

      const response = await apiRequest("POST", "/api/factory/finalize", {
        pressingBatchId: parseInt(selectedPressingBatchId),
        scannedBaleIds: scannedBales.map((b: any) => b.id),
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

      const labels = scannedBales.map((bale: any) => ({
        referenceNumber: bale.referenceNumber || bale.baleCode,
        articleCode: bale.articleCode || "",
        pieces: 1,
        approxWeightKg: bale.weightKg || "0",
        productName: bale.productName || "",
        locationName: locName,
      }));

      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(generateFinalLabelHtml(labels));
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
      } else {
        toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
      }

      const count = result.updated || result.length || scannedBales.length;
      toast({
        title: "Finalized",
        description: `${count} bale(s) moved to stock and labels printed`,
      });

      setScannedBales([]);
      setSelectedPressingBatchId("");
      setSelectedMixBatchId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finalize / Counting</h1>
          <p className="text-muted-foreground mt-1">Scan pending bales, verify counts, assign to warehouse</p>
        </div>
        <Badge variant="outline" className="text-sm" data-testid="badge-finalize-mode">
          <CheckCircle className="h-3 w-3 mr-1" />
          FINALIZE MODE
        </Badge>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Select Pressing Batch</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Select value={selectedPressingBatchId} onValueChange={(val) => {
                  setSelectedPressingBatchId(val);
                  setScannedBales([]);
                  setScanError("");
                }}>
                  <SelectTrigger data-testid="select-pressing-batch">
                    <SelectValue placeholder="Select a pending pressing batch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {batchesLoading ? (
                      <SelectItem value="loading" disabled>Loading...</SelectItem>
                    ) : pendingBatches && pendingBatches.length > 0 ? (
                      pendingBatches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id.toString()}>
                          Batch #{b.id} - {b.productName || "Unknown"} ({b.pendingCount} pending)
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No pending batches</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selectedPressingBatchId && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <ScanLine className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">Scan Bales</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Input
                    ref={scanRef}
                    value={scanInput}
                    onChange={(e) => {
                      setScanInput(e.target.value);
                      setScanError("");
                    }}
                    onKeyDown={handleScanKeyDown}
                    placeholder="Scan bale barcode..."
                    autoFocus
                    data-testid="input-finalize-scan"
                  />
                  {scanError && (
                    <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-scan-error">
                      <AlertCircle className="h-4 w-4" />
                      {scanError}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {scannedBales.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-lg">
                    Scanned Bales ({scannedCount} / {expectedCount})
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={clearScanned} data-testid="button-clear-scanned">
                    <XCircle className="h-4 w-4 mr-1" />
                    Clear All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scannedBales.map((bale: any, idx: number) => (
                      <TableRow key={bale.id} data-testid={`row-scanned-bale-${bale.id}`}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-sm">{bale.referenceNumber || bale.baleCode}</TableCell>
                        <TableCell>{bale.productName || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(parseFloat(bale.weightKg || "0"))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeScannedBale(bale.id)}
                            data-testid={`button-remove-scanned-${bale.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {!selectedPressingBatchId && !batchesLoading && (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-lg font-medium">Select a pressing batch to begin counting</p>
                  <p className="text-sm mt-1">Pending batches from the pressing floor will appear in the dropdown above</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="w-72 shrink-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Count Validation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Expected</p>
                <p className="text-3xl font-bold font-mono" data-testid="text-expected-count">
                  {expectedCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Scanned</p>
                <p className={`text-3xl font-bold font-mono ${countsMatch ? "text-green-600" : scannedCount > 0 ? "text-amber-500" : ""}`} data-testid="text-scanned-count">
                  {scannedCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Remaining</p>
                <p className="text-xl font-bold font-mono" data-testid="text-remaining-count">
                  {Math.max(0, expectedCount - scannedCount)}
                </p>
              </div>

              {countsMatch && (
                <div className="flex items-center gap-2 text-green-600 text-sm p-2 rounded-md bg-green-50 dark:bg-green-950/20" data-testid="text-count-match">
                  <CheckCircle className="h-4 w-4" />
                  <span>Counts match! Ready to confirm.</span>
                </div>
              )}

              {scannedCount > 0 && scannedCount > expectedCount && (
                <div className="flex items-center gap-2 text-destructive text-sm p-2 rounded-md bg-destructive/10" data-testid="text-count-mismatch">
                  <AlertCircle className="h-4 w-4" />
                  <span>Too many scanned! Expected {expectedCount}.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedPressingBatchId && selectedBatchData && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Batch Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Product</p>
                  <p className="font-medium" data-testid="text-batch-product">
                    {selectedBatchData.productName || "Unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-sm" data-testid="text-batch-created">
                    {new Date(selectedBatchData.createdAt).toLocaleString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Finalize</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1.5">Mix Batch (raw material)</p>
                <Select value={selectedMixBatchId} onValueChange={setSelectedMixBatchId}>
                  <SelectTrigger data-testid="select-finalize-mix-batch">
                    <SelectValue placeholder="Select Mix Batch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMixBatches && activeMixBatches.length > 0 ? (
                      activeMixBatches.map((batch) => {
                        const remaining = parseFloat(batch.totalWeightKg) - parseFloat(batch.usedKg || "0");
                        return (
                          <SelectItem key={batch.id} value={batch.id.toString()}>
                            {batch.name || batch.batchCode} ({formatNumber(remaining)} kg remaining)
                          </SelectItem>
                        );
                      })
                    ) : (
                      <SelectItem value="none" disabled>No active mix batches</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {selectedMixBatch && (
                  <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                    <p>Remaining: <span className="font-medium">{formatNumber(mixBatchRemaining)} kg</span></p>
                    <p>Will consume: <span className={`font-medium ${totalScannedWeight > mixBatchRemaining + 0.001 ? "text-destructive" : ""}`}>{formatNumber(totalScannedWeight)} kg</span></p>
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

              <Button
                className="w-full"
                size="lg"
                onClick={() => finalizeMutation.mutate()}
                disabled={
                  finalizeMutation.isPending ||
                  !countsMatch ||
                  !selectedLocationId ||
                  !selectedMixBatchId ||
                  scannedBales.length === 0
                }
                data-testid="button-confirm-finalize"
              >
                {finalizeMutation.isPending ? (
                  "Finalizing..."
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirm + Print Final Labels
                  </>
                )}
              </Button>

              {!countsMatch && scannedCount > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Scan all {expectedCount} bales to enable confirm
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
