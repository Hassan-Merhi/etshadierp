import { useState, useRef, useEffect } from "react";
import { ScanLine, Trash2, Download, AlertCircle, X, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "@/lib/excelHelper";
import { formatNumber } from "@/lib/formatNumber";

interface ScannedBale {
  refCode: string;
  articleCode: string;
  productName: string;
  weightKg: number;
  status: string;
  scannedAt: Date;
}

function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  if (s === "IN_STOCK") return <Badge className="bg-green-600 text-white border-0">In Stock</Badge>;
  if (s === "LOADING" || s === "LOADED") return <Badge className="bg-amber-500 text-white border-0">Loading</Badge>;
  if (s === "SOLD") return <Badge className="bg-red-600 text-white border-0">Sold</Badge>;
  if (s === "RESERVED_FOR_ORDER") return <Badge className="bg-blue-600 text-white border-0">Reserved</Badge>;
  if (s === "LABEL_PRINTED") return <Badge variant="outline">Label Printed</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function GroundScan() {
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scannedBales, setScannedBales] = useState<ScannedBale[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const timeout = setTimeout(() => scanRef.current?.focus(), 100);
    return () => clearTimeout(timeout);
  }, []);

  const totalWeight = scannedBales.reduce((sum, b) => sum + b.weightKg, 0);

  async function handleScan() {
    const value = scanInput.trim().toUpperCase();
    if (!value) return;

    const duplicate = scannedBales.find((b) => b.refCode === value);
    if (duplicate) {
      setScanError(`Already scanned: ${value}`);
      toast({
        title: "Duplicate scan",
        description: `${value} is already in the list.`,
        variant: "destructive",
      });
      setScanInput("");
      return;
    }

    setScanError("");
    setScanning(true);

    try {
      const res = await fetch(`/api/lookup/reference/${encodeURIComponent(value)}`, {
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 404) {
          setScanError(`Not found: ${value}`);
          toast({
            title: "Bale not found",
            description: `No bale with ref code "${value}" found.`,
            variant: "destructive",
          });
        } else {
          setScanError("Lookup failed — try again");
        }
        setScanInput("");
        return;
      }

      const data = await res.json();
      const baleInfo = data.baleInfo;
      const product = data.product;
      const labelPrint = data.labelPrint;

      const articleCode =
        product?.articleCode ||
        labelPrint?.articleCode ||
        baleInfo?.articleCode ||
        "";

      const productName =
        baleInfo?.productName ||
        product?.name ||
        "Unknown";

      const weightKg = parseFloat(baleInfo?.weightKg || labelPrint?.approxWeightKg || "0");
      const status = baleInfo?.status || "";

      const entry: ScannedBale = {
        refCode: value,
        articleCode,
        productName,
        weightKg,
        status,
        scannedAt: new Date(),
      };

      setScannedBales((prev) => [entry, ...prev]);
      setScanInput("");
      setScanError("");

      toast({
        title: "Bale scanned",
        description: `${productName} — ${status}`,
      });
    } catch {
      setScanError("Network error — try again");
    } finally {
      setScanning(false);
      setTimeout(() => scanRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleScan();
  }

  function removeBale(refCode: string) {
    setScannedBales((prev) => prev.filter((b) => b.refCode !== refCode));
  }

  function clearAll() {
    setScannedBales([]);
    setScanError("");
    setScanInput("");
    setTimeout(() => scanRef.current?.focus(), 50);
  }

  async function exportExcel() {
    if (scannedBales.length === 0) return;
    setExporting(true);
    try {
      // 1. Fetch all system IN_STOCK bales
      const res = await fetch("/api/factory/stock-entry/in-stock", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch system stock");
      const systemBales: { referenceNumber: string; articleCode: string; productName?: string; weightKg: string }[] = await res.json();

      const scannedRefs = new Set(scannedBales.map((b) => b.refCode.toUpperCase()));
      const systemRefs = new Set(systemBales.map((b) => (b.referenceNumber || "").toUpperCase()));

      // 2. Per-article summary
      type ArticleRow = { articleCode: string; productName: string; systemQty: number; systemWeightKg: number; scannedQty: number; scannedWeightKg: number };
      const articleMap = new Map<string, ArticleRow>();

      for (const b of systemBales) {
        const key = b.articleCode || "UNKNOWN";
        if (!articleMap.has(key)) articleMap.set(key, { articleCode: key, productName: b.productName || "", systemQty: 0, systemWeightKg: 0, scannedQty: 0, scannedWeightKg: 0 });
        const row = articleMap.get(key)!;
        row.systemQty++;
        row.systemWeightKg += parseFloat(b.weightKg || "0");
      }
      for (const b of scannedBales) {
        const key = b.articleCode || "UNKNOWN";
        if (!articleMap.has(key)) articleMap.set(key, { articleCode: key, productName: b.productName || "", systemQty: 0, systemWeightKg: 0, scannedQty: 0, scannedWeightKg: 0 });
        const row = articleMap.get(key)!;
        row.scannedQty++;
        row.scannedWeightKg += b.weightKg;
      }

      // 3. Missing bales = in system but NOT scanned
      const missingBales = systemBales.filter((b) => !scannedRefs.has((b.referenceNumber || "").toUpperCase()));
      // Extra bales = scanned but NOT in system
      const extraBales = scannedBales.filter((b) => !systemRefs.has(b.refCode.toUpperCase()));

      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      const wb = XLSX.utils.book_new();

      // ── Sheet 1: Summary ──────────────────────────────────────────────────
      const summaryAoa: any[][] = [];
      summaryAoa.push([`Ground Stock Verification — ${dateStr} ${timeStr}`]);
      summaryAoa.push([]);
      summaryAoa.push([`System IN_STOCK bales`, systemBales.length, "", `Scanned on ground`, scannedBales.length]);
      summaryAoa.push([`Missing (system not scanned)`, missingBales.length, "", `Extra (scanned not in system)`, extraBales.length]);
      summaryAoa.push([]);
      summaryAoa.push(["Article Code", "Product Name", "System Qty", "System Wt (kg)", "Scanned Qty", "Scanned Wt (kg)", "Missing Qty", "Missing Wt (kg)"]);
      const summaryArticles = [...articleMap.values()].sort((a, b) => a.articleCode.localeCompare(b.articleCode));
      for (const r of summaryArticles) {
        const missingQty = Math.max(0, r.systemQty - r.scannedQty);
        const missingWt = missingBales.filter((b) => (b.articleCode || "UNKNOWN") === r.articleCode).reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0);
        summaryAoa.push([r.articleCode, r.productName, r.systemQty, +r.systemWeightKg.toFixed(3), r.scannedQty, +r.scannedWeightKg.toFixed(3), missingQty, +missingWt.toFixed(3)]);
      }
      summaryAoa.push([]);
      const totalSystemWt = systemBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0);
      const totalMissingWt = missingBales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0);
      summaryAoa.push(["TOTAL", "", systemBales.length, +totalSystemWt.toFixed(3), scannedBales.length, +totalWeight.toFixed(3), missingBales.length, +totalMissingWt.toFixed(3)]);

      const ws1 = XLSX.utils.aoa_to_sheet(summaryAoa);
      ws1["!cols"] = [{ wch: 16 }, { wch: 32 }, { wch: 13 }, { wch: 16 }, { wch: 13 }, { wch: 16 }, { wch: 13 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Summary");

      // ── Sheet 2: Missing Bales ────────────────────────────────────────────
      const missingAoa: any[][] = [];
      missingAoa.push(["Missing Bales — in system (IN_STOCK) but NOT scanned on ground"]);
      missingAoa.push([]);
      missingAoa.push(["Ref Number", "Article Code", "Product Name", "Weight (kg)"]);
      for (const b of missingBales) {
        missingAoa.push([b.referenceNumber, b.articleCode || "", b.productName || "", +parseFloat(b.weightKg || "0").toFixed(3)]);
      }
      if (missingBales.length === 0) missingAoa.push(["— No missing bales —", "", "", ""]);
      missingAoa.push([]);
      missingAoa.push([`Total missing: ${missingBales.length} bales`, "", "", +totalMissingWt.toFixed(3)]);

      const ws2 = XLSX.utils.aoa_to_sheet(missingAoa);
      ws2["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 32 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Missing Bales");

      // ── Sheet 3: Extra Bales (scanned but not in system) ──────────────────
      if (extraBales.length > 0) {
        const extraAoa: any[][] = [];
        extraAoa.push(["Extra Bales — scanned on ground but NOT found in system (IN_STOCK)"]);
        extraAoa.push([]);
        extraAoa.push(["Ref Code", "Article Code", "Product Name", "Weight (kg)", "Status"]);
        for (const b of extraBales) {
          extraAoa.push([b.refCode, b.articleCode || "", b.productName || "", +b.weightKg.toFixed(3), b.status]);
        }
        const ws3 = XLSX.utils.aoa_to_sheet(extraAoa);
        ws3["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 32 }, { wch: 14 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws3, "Extra Bales");
      }

      await XLSX.writeFile(wb, `ground-verification-${dateStr}.xlsx`);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1 flex flex-col gap-2">
          <div className="relative">
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setScanError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="Scan ref code / barcode..."
              className="pl-9"
              disabled={scanning}
              data-testid="input-ground-scan"
              autoComplete="off"
            />
          </div>
          {scanError && (
            <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-ground-scan-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {scanError}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            onClick={handleScan}
            disabled={scanning || !scanInput.trim()}
            data-testid="button-ground-scan-confirm"
          >
            {scanning ? "Looking up..." : "Scan"}
          </Button>
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={scannedBales.length === 0 || exporting}
            data-testid="button-ground-scan-export"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            {exporting ? "Exporting..." : "Export Verification"}
          </Button>
          {scannedBales.length > 0 && (
            <Button
              variant="ghost"
              onClick={clearAll}
              data-testid="button-ground-scan-clear"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span data-testid="text-ground-scan-count">
          <span className="font-semibold text-foreground">{scannedBales.length}</span>{" "}
          bale{scannedBales.length !== 1 ? "s" : ""} scanned
        </span>
        <span data-testid="text-ground-scan-weight">
          <span className="font-semibold text-foreground">{formatNumber(totalWeight, 2)} kg</span> total weight
        </span>
      </div>

      {scannedBales.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">Scan a bale to add it to the list</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Ref Code</TableHead>
                <TableHead>Article Code</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scannedBales.map((bale, idx) => (
                <TableRow key={bale.refCode} data-testid={`row-ground-scan-${bale.refCode}`}>
                  <TableCell className="text-muted-foreground text-xs">
                    {scannedBales.length - idx}
                  </TableCell>
                  <TableCell className="font-mono text-sm" data-testid={`text-ground-scan-ref-${bale.refCode}`}>
                    {bale.refCode}
                  </TableCell>
                  <TableCell data-testid={`text-ground-scan-article-${bale.refCode}`}>
                    {bale.articleCode ? (
                      <Badge variant="outline">{bale.articleCode}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-ground-scan-product-${bale.refCode}`}>
                    {bale.productName}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-ground-scan-weight-${bale.refCode}`}>
                    {formatNumber(bale.weightKg, 2)}
                  </TableCell>
                  <TableCell data-testid={`text-ground-scan-status-${bale.refCode}`}>
                    <StatusBadge status={bale.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeBale(bale.refCode)}
                      data-testid={`button-ground-scan-remove-${bale.refCode}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
