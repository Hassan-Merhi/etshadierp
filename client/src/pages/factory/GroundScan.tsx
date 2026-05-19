import { useState, useRef, useEffect } from "react";
import { ScanLine, Trash2, Download, AlertCircle, X, Package } from "lucide-react";
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

  function exportExcel() {
    if (scannedBales.length === 0) return;

    const rows = scannedBales.map((b) => ({
      "Ref Code": b.refCode,
      "Article Code": b.articleCode,
      "Product Name": b.productName,
      "Weight (kg)": b.weightKg,
      "Status": b.status,
    }));

    const totalsRow = {
      "Ref Code": `Total: ${scannedBales.length} bales`,
      "Article Code": "",
      "Product Name": "",
      "Weight (kg)": totalWeight,
      "Status": "",
    };

    const ws = XLSX.utils.json_to_sheet([...rows, {}, totalsRow]);
    ws["!cols"] = [
      { wch: 18 },
      { wch: 16 },
      { wch: 30 },
      { wch: 14 },
      { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ground Scan");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `ground-scan-${dateStr}.xlsx`);
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
            disabled={scannedBales.length === 0}
            data-testid="button-ground-scan-export"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Export
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
