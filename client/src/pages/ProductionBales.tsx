import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle, Trash2, Printer, Package, ScanLine, AlertCircle, Search, XCircle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import type { BaleProduct, Location } from "@shared/schema";

function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

function generateFullLabelHtml(label: {
  barcodeValue: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
  locationName?: string;
}) {
  return `
    <div class="label">
      <div class="label-content">
        <div class="label-top">
          <div class="logo-section">
            <div class="logo-text">HMD</div>
            <div class="logo-subtitle">INTERNATIONAL GROUP</div>
          </div>
          <div class="info-section">
            <div class="info-row"><span class="info-label">PIECES:</span> <span class="info-value">${formatLabelNum(label.pieces)}</span></div>
            <div class="info-row"><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
            <div class="info-row"><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
            ${label.locationName ? `<div class="info-row"><span class="info-label">LOCATION:</span> <span class="info-value">${label.locationName}</span></div>` : ''}
          </div>
        </div>
        <div class="barcode-section">
          <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.barcodeValue)}" alt="Bale Barcode" />
          <div class="product-name-text">${label.productName}</div>
        </div>
      </div>
    </div>`;
}

function generateFinalLabelHtml(labels: Array<{
  barcodeValue: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
  locationName?: string;
}>, dualLabel: boolean) {
  let labelsHtml = '';
  for (const label of labels) {
    const fullLabel = generateFullLabelHtml(label);
    if (dualLabel) {
      labelsHtml += `
        <div class="page-container">
          ${fullLabel}
          <div class="label name-label">
            <div class="name-label-content">
              <img class="name-barcode-img" src="/api/barcode/${encodeURIComponent(label.barcodeValue)}" alt="Bale Barcode" />
              <div class="name-label-text">${label.productName}</div>
            </div>
          </div>
        </div>`;
    } else {
      labelsHtml += `<div class="single-page">${fullLabel}</div>`;
    }
  }
  const pageSize = dualLabel ? 'size: 3in 3.94in;' : 'size: 3in 1.97in;';
  return `<html><head><title>Final Labels</title><style>
    @page { ${pageSize} margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .page-container { width: 3in; height: 3.94in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .page-container:last-child { page-break-after: auto; }
    .single-page { width: 3in; height: 1.97in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .single-page:last-child { page-break-after: auto; }
    .label { width: 3in; height: 1.97in; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; background-image: url('/hmd-label-bg.jpeg'); background-repeat: no-repeat; background-position: center; background-size: contain; }
    .label::before { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,0.80); }
    .label-content { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
    .name-label { justify-content: center; align-items: center; }
    .name-label-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: 1mm; }
    .name-barcode-img { width: 60mm; height: 12mm; object-fit: contain; }
    .name-label-text { font-size: 16pt; font-weight: 900; color: #000; text-align: center; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; max-width: 100%; display: block; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1mm; }
    .logo-section { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-text { font-size: 28pt; font-weight: 900; letter-spacing: 3px; color: #000; line-height: 1; }
    .logo-subtitle { font-size: 6pt; font-weight: 700; letter-spacing: 1.5px; color: #000; margin-top: 0.5mm; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .barcode-section { text-align: center; margin-top: 1mm; }
    .barcode-img { width: 65mm; height: 14mm; object-fit: contain; }
    .product-name-text { font-size: 10pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; color: #000; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print { .print-note { display: none !important; } header, .print-header, .page-header { display: none !important; } body { margin: 0; } }
  </style></head><body><div class="print-note">FINAL STOCK LABEL - For cleanest output, disable "Headers and Footers" in your print settings.</div>${labelsHtml}</body></html>`;
}

export default function ProductionBales() {
  const [selectedPressingBatchId, setSelectedPressingBatchId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [scannedBales, setScannedBales] = useState<any[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [dualLabel, setDualLabel] = useState(true);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: pressingBatches, isLoading: batchesLoading } = useQuery<any[]>({
    queryKey: ["/api/pressing-batches"],
  });

  const { data: baleProducts } = useQuery<BaleProduct[]>({
    queryKey: ["/api/bale-products"],
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const activeLocations = locations?.filter((l) => l.active);

  const pendingBatches = pressingBatches?.filter((b: any) => b.batch.status === "PENDING" && b.pendingCount > 0);
  const selectedBatchData = pressingBatches?.find((b: any) => b.batch.id.toString() === selectedPressingBatchId);

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
      const response = await apiRequest("GET", `/api/production-bales/lookup/${encodeURIComponent(value.trim())}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Bale not found");
      }

      const result = await response.json();
      const bale = result.bale || result;

      if (bale.status !== "PENDING") {
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
        articleCode: product?.articleCode || bale.barcodeValue || "",
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

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!countsMatch) {
        throw new Error(`Count mismatch: expected ${expectedCount}, scanned ${scannedCount}`);
      }
      if (!selectedLocationId) {
        throw new Error("Please select a warehouse location");
      }

      const response = await apiRequest("POST", "/api/production-bales/finalize", {
        pressingBatchId: parseInt(selectedPressingBatchId),
        scannedBaleIds: scannedBales.map((b: any) => b.id),
        locationId: parseInt(selectedLocationId),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to finalize bales");
      }

      return await response.json();
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pressing-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mix-batches"] });

      const locName = selectedLocationName ? `${selectedLocationName.code} - ${selectedLocationName.name}` : "";

      const labels = scannedBales.map((bale: any) => ({
        barcodeValue: bale.barcodeValue || bale.baleCode,
        articleCode: bale.articleCode || "",
        pieces: 1,
        approxWeightKg: bale.weightKg || "0",
        productName: bale.productName || "",
        locationName: locName,
      }));

      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(generateFinalLabelHtml(labels, dualLabel));
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
      } else {
        toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
      }

      toast({
        title: "Finalized",
        description: `${result.updated} bale(s) moved to stock and labels printed`,
      });

      setScannedBales([]);
      setSelectedPressingBatchId("");
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
                        <SelectItem key={b.batch.id} value={b.batch.id.toString()}>
                          Batch #{b.batch.id} - {b.product?.name || "Unknown"} ({b.pendingCount} pending)
                          {b.mixBatch ? ` - Mix: ${b.mixBatch.name || b.mixBatch.batchCode}` : ""}
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
                        <TableCell className="font-mono text-sm">{bale.barcodeValue || bale.baleCode}</TableCell>
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
                    {selectedBatchData.product?.name || "Unknown"}
                  </p>
                </div>
                {selectedBatchData.mixBatch && (
                  <div>
                    <p className="text-sm text-muted-foreground">Mix Batch</p>
                    <p className="font-medium" data-testid="text-batch-mix">
                      {selectedBatchData.mixBatch.name || selectedBatchData.mixBatch.batchCode}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-sm" data-testid="text-batch-created">
                    {new Date(selectedBatchData.batch.createdAt).toLocaleString()}
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
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger data-testid="select-finalize-location">
                  <SelectValue placeholder="Select Location" />
                </SelectTrigger>
                <SelectContent>
                  {activeLocations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.code} - {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  id="final-dual-label-toggle"
                  checked={dualLabel}
                  onCheckedChange={setDualLabel}
                  data-testid="switch-final-dual-label"
                />
                <Label htmlFor="final-dual-label-toggle" className="text-sm cursor-pointer">
                  {dualLabel ? "Dual labels" : "Single label"}
                </Label>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={() => finalizeMutation.mutate()}
                disabled={
                  finalizeMutation.isPending ||
                  !countsMatch ||
                  !selectedLocationId ||
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
