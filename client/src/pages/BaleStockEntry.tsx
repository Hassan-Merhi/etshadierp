import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Minus, Trash2, Printer, ScanLine, AlertCircle, Package, CheckCircle,
  XCircle, ShieldAlert, Lock
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
import { buildZplBatch } from "@/lib/zplBuilder";
import { LabelPrintSettings } from "@/components/LabelPrintSettings";
import type { FactoryBaleProduct, Location, FactoryMixBatch } from "@shared/schema";

interface CartItem {
  productId: number;
  product: FactoryBaleProduct;
  qty: number;
  weightPerBaleKg: number;
}

function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

type LabelData = {
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
};

function buildDetailBlock(label: LabelData) {
  return `<div class="code-label">
    <div class="label-top">
      <div class="logo-section">
        <img class="logo-img" src="/hmd-logo.jpeg" alt="HMD" />
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
  </div>`;
}

function generateCombinedLabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="a4-page">
        <div class="a4-top-half">
          <div class="a4-top-preprint-gap"></div>
          <div class="a4-top-content">
            <div class="a4-detail-left">
              ${buildDetailBlock(label)}
            </div>
            <div class="a4-name-right">
              <div class="a4-name-right-text">${label.productName}</div>
            </div>
          </div>
        </div>
        <div class="a4-bottom-half">
          <div class="a4-bottom-preprint-gap"></div>
          <div class="a4-bottom-namebox">
            <div class="a4-bottom-name-text">${label.productName}</div>
          </div>
        </div>
      </div>`;
  }
  return `<html><head><title>Stock Entry Labels - A4</title><style>
    @page { size: 210mm 297mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }

    .code-label { width: 76mm; max-height: 58.5mm; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; background: #fff; overflow: hidden; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .logo-section { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-img { height: 14mm; width: auto; object-fit: contain; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: auto; }
    .barcode-img { width: 100%; height: 20mm; object-fit: contain; }
    .barcode-number { font-size: 8pt; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 0.5mm; letter-spacing: 1px; }
    .article-barcode-area { text-align: center; margin-top: 3mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 100%; height: 18mm; object-fit: contain; }
    .article-barcode-number { font-size: 7pt; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 0.3mm; letter-spacing: 1px; color: #000; }

    .a4-page { width: 210mm; height: 297mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
    .a4-page:last-child { page-break-after: auto; }

    .a4-top-half { height: 148.5mm; flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; }
    .a4-top-preprint-gap { height: 90mm; flex-shrink: 0; }
    .a4-top-content { height: 58.5mm; flex-shrink: 0; display: flex; flex-direction: row; gap: 6mm; align-items: flex-start; padding: 0 10mm; }
    .a4-detail-left { flex-shrink: 0; width: 76mm; max-height: 58.5mm; overflow: hidden; border: 0.3mm solid #ccc; }
    .a4-name-right { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; height: 58.5mm; }
    .a4-name-right-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; overflow: hidden; font-size: clamp(18pt, 3.5vw, 36pt); line-height: 1.15; color: #000; word-break: break-word; }

    .a4-bottom-half { height: 148.5mm; flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; }
    .a4-bottom-preprint-gap { height: 90mm; flex-shrink: 0; }
    .a4-bottom-namebox { height: 58.5mm; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 10mm; }
    .a4-bottom-name-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; overflow: hidden; font-size: clamp(28pt, 6vw, 56pt); line-height: 1.15; color: #000; word-break: break-word; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-key, .info-val, .barcode-number, .article-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .a4-name-right-text, .a4-bottom-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">A4 Bale Labels. Set printer to BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
}

function generateStickerLabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="sticker-page">
        <div class="label">
          <div class="label-content">
            <div class="label-top">
              <div class="logo-section">
                <img class="logo-img" src="/hmd-logo.jpeg" alt="HMD" />
              </div>
              <div class="info-section">
                <div><span class="info-label">PIECES:</span> <span class="info-value">${formatLabelNum(label.pieces)}</span></div>
                <div><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
                <div><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
              </div>
            </div>
            <div class="ref-barcode-section">
              <img class="ref-barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Barcode" />
              <div class="ref-barcode-number">${label.referenceNumber}</div>
            </div>
            <div class="article-barcode-section">
              <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
            </div>
            <div class="product-section">
              <div class="product-name-text">${label.productName}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="sticker-page">
        <div class="label name-only-label">
          <div class="label-content name-only-content">
            <div class="name-only-text">${label.productName}</div>
          </div>
        </div>
      </div>`;
  }
  return `<html><head><title>Sticker Labels</title><style>
    @page { size: 3in 1.97in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .sticker-page { width: 3in; height: 1.97in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .sticker-page:last-child { page-break-after: auto; }
    .label { width: 3in; height: 1.97in; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; background: #fff; }
    .label-content { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1mm; }
    .logo-section { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-img { height: 10mm; width: auto; object-fit: contain; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .ref-barcode-section { text-align: center; margin-top: 0.5mm; }
    .ref-barcode-img { width: 100%; height: 18mm; object-fit: contain; }
    .ref-barcode-number { font-size: 6pt; font-weight: 700; font-family: 'Courier New', monospace; margin-top: 0.2mm; letter-spacing: 1px; }
    .article-barcode-section { text-align: center; margin-top: 2mm; }
    .article-barcode-img { width: 100%; height: 18mm; object-fit: contain; }
    .product-section { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 0.5mm; }
    .product-name-text { font-size: 11pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; color: #000; text-transform: uppercase; word-break: break-word; }

    .name-only-label { justify-content: center; align-items: center; }
    .name-only-content { justify-content: center; align-items: center; }
    .name-barcode-section { text-align: center; margin-bottom: 2mm; }
    .name-barcode-img { width: 55mm; height: 14mm; object-fit: contain; }
    .name-only-text { font-size: 24pt; font-weight: 900; color: #000; text-align: center; text-transform: uppercase; letter-spacing: 3px; word-break: break-word; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-label, .info-value, .ref-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .name-only-text, .product-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">Sticker Labels (2 per bale). Set printer to BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
}

function StockEntryTab() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedMixBatchId, setSelectedMixBatchId] = useState<string>("");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: baleProducts, isLoading: productsLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });
  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: mixBatches } = useQuery<FactoryMixBatch[]>({ queryKey: ["/api/factory/mix-batches"] });

  const activeProducts = baleProducts?.filter((p) => p.active);
  const activeLocations = locations?.filter((l) => l.active);
  const activeMixBatches = mixBatches?.filter((b) => b.status === "ACTIVE");

  const selectedMixBatch = activeMixBatches?.find((b) => b.id.toString() === selectedMixBatchId);
  const mixBatchRemaining = selectedMixBatch
    ? parseFloat(selectedMixBatch.totalWeightKg) - parseFloat(selectedMixBatch.usedKg || "0")
    : 0;

  useEffect(() => {
    if (scanRef.current) scanRef.current.focus();
  }, [cart]);

  const handleScan = (value: string) => {
    if (!value.trim()) return;
    setScanError("");

    const trimmed = value.trim().toLowerCase();
    const product = activeProducts?.find(
      (p) =>
        p.articleCode?.toLowerCase() === trimmed ||
        p.code.toLowerCase() === trimmed
    );

    if (!product) {
      setScanError(`Unknown product: "${value}"`);
      setScanInput("");
      return;
    }

    const defaultWeight = product.weightPerBaleKg ? parseFloat(product.weightPerBaleKg) : 25;

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { productId: product.id, product, qty: 1, weightPerBaleKg: defaultWeight }];
    });

    setScanInput("");
  };

  const handleScanKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(scanInput);
    }
  };

  const filteredProducts = scanInput.trim().length > 0
    ? (activeProducts || []).filter((p) => {
        const term = scanInput.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(term) ||
          (p.articleCode?.toLowerCase().includes(term)) ||
          p.code.toLowerCase().includes(term)
        );
      }).slice(0, 10)
    : [];

  const selectProduct = (product: FactoryBaleProduct) => {
    const defaultWeight = product.weightPerBaleKg ? parseFloat(product.weightPerBaleKg) : 25;
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { productId: product.id, product, qty: 1, weightPerBaleKg: defaultWeight }];
    });
    setScanInput("");
    setScanError("");
    setShowDropdown(false);
  };

  const updateQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId ? { ...item, qty: Math.max(0, item.qty + delta) } : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const setQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
    } else {
      setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, qty } : item)));
    }
  };

  const updateWeight = (productId: number, weight: number) => {
    setCart((prev) => prev.map((item) => (item.productId === productId ? { ...item, weightPerBaleKg: weight } : item)));
  };

  const removeItem = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalKg = cart.reduce((sum, item) => sum + item.qty * item.weightPerBaleKg, 0);

  const selectedLocationName = activeLocations?.find((l) => l.id.toString() === selectedLocationId);

  const handleConfirmClick = () => {
    if (!selectedLocationId) {
      toast({ title: "Error", description: "Please select a warehouse location", variant: "destructive" });
      return;
    }
    if (!selectedMixBatchId) {
      toast({ title: "Error", description: "Please select a mix batch", variant: "destructive" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Error", description: "Please add items to the cart", variant: "destructive" });
      return;
    }
    setConfirmDialogOpen(true);
  };

  const openBrowserPrint = (labels: LabelData[]) => {
    const a4Window = window.open("", "_blank");
    if (a4Window) {
      a4Window.document.write(generateCombinedLabelsHtml(labels));
      a4Window.document.close();
      a4Window.focus();
      setTimeout(() => a4Window.print(), 500);
    }
    const stickerWindow = window.open("", "_blank");
    if (stickerWindow) {
      stickerWindow.document.write(generateStickerLabelsHtml(labels));
      stickerWindow.document.close();
      stickerWindow.focus();
      setTimeout(() => stickerWindow.print(), 800);
    }
    if (!a4Window && !stickerWindow) {
      toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
    }
  };

  const printLabels = async (bales: any[]) => {
    try {
      const labelData = bales.map((bale: any) => {
        const cartItem = cart.find((c) => c.productId === bale.productId);
        return {
          productionBaleId: bale.id,
          productId: bale.productId,
          articleCode: bale.articleCode || cartItem?.product.articleCode || cartItem?.product.code || "",
          pieces: 1,
          approxWeightKg: bale.weightKg || "0",
        };
      });

      const labelResponse = await apiRequest("POST", "/api/bale-label-prints", { bales: labelData });

      if (!labelResponse.ok) {
        const err = await labelResponse.json();
        throw new Error(err.message || "Failed to create label records");
      }

      const { labelPrints } = await labelResponse.json();

      const labels = labelPrints.map((lp: any) => {
        const bale = bales.find((b: any) => b.id === lp.productionBaleId);
        return {
          referenceNumber: lp.referenceNumber,
          articleCode: lp.articleCode || bale?.articleCode || "",
          pieces: lp.pieces || 1,
          approxWeightKg: lp.approxWeightKg || bale?.weightKg || "0",
          productName: bale?.productName || "",
        };
      });

      if (isZebraMode()) {
        try {
          const zpl = buildZplBatch(labels, true);
          await printRawZpl(zpl);
          toast({ title: "Labels sent to Zebra printer" });
        } catch (err: any) {
          toast({ title: "Zebra print failed", description: err.message + " — Falling back to browser print.", variant: "destructive" });
          openBrowserPrint(labels);
        }
      } else {
        openBrowserPrint(labels);
      }
    } catch (error: any) {
      toast({ title: "Label Error", description: error.message || "Failed to generate labels", variant: "destructive" });
    }
  };

  const stockEntryMutation = useMutation({
    mutationFn: async () => {
      const items = cart.map((item) => ({
        productId: item.productId,
        quantity: item.qty,
        weightPerBale: item.weightPerBaleKg.toString(),
      }));

      const response = await apiRequest("POST", "/api/factory/stock-entry", {
        items,
        erpLocationId: parseInt(selectedLocationId),
        mixBatchId: parseInt(selectedMixBatchId),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to enter bales into stock");
      }

      return await response.json();
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });

      await printLabels(result.bales);

      toast({
        title: "Stock Entry Complete",
        description: `${result.bales.length} bale(s) entered into stock and sent to printer`,
      });

      setCart([]);
      setConfirmDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (productsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" data-testid="text-loading" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-muted-foreground mb-1.5">Warehouse Location</p>
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger data-testid="select-stock-entry-location">
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
        <div>
          <p className="text-sm text-muted-foreground mb-1.5">Mix Batch (raw material)</p>
          <Select value={selectedMixBatchId} onValueChange={setSelectedMixBatchId}>
            <SelectTrigger data-testid="select-stock-entry-mix-batch">
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
              Will consume: <span className={totalKg > mixBatchRemaining + 0.001 ? "text-destructive font-medium" : ""}>{formatNumber(totalKg)} kg</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        <div className="flex-1 min-w-0 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <ScanLine className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Scan / Add Product</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 relative">
                <Input
                  ref={scanRef}
                  value={scanInput}
                  onChange={(e) => { setScanInput(e.target.value); setScanError(""); setShowDropdown(true); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (filteredProducts.length === 1) {
                        selectProduct(filteredProducts[0]);
                      } else {
                        handleScan(scanInput);
                      }
                    }
                    if (e.key === "Escape") {
                      setShowDropdown(false);
                    }
                  }}
                  onFocus={() => { if (scanInput.trim()) setShowDropdown(true); }}
                  placeholder="Scan barcode or type name / article code..."
                  autoFocus
                  data-testid="input-stock-entry-scan"
                />
                {showDropdown && scanInput.trim().length > 0 && filteredProducts.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto" data-testid="dropdown-product-suggestions">
                    {filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover-elevate flex items-center justify-between gap-2 text-sm"
                        onClick={() => selectProduct(p)}
                        data-testid={`button-select-product-${p.id}`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{p.articleCode || p.code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showDropdown && scanInput.trim().length > 0 && filteredProducts.length === 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg px-3 py-2 text-sm text-muted-foreground">
                    No products found
                  </div>
                )}
                {scanError && (
                  <div className="flex items-center gap-2 text-destructive text-sm" data-testid="text-scan-error">
                    <AlertCircle className="h-4 w-4" />
                    {scanError}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Cart ({totalQty} bales)</CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p data-testid="text-empty-cart">Scan a product to add it to the cart</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-center w-40">Qty</TableHead>
                      <TableHead className="text-right w-32">Wt/Bale (kg)</TableHead>
                      <TableHead className="text-right w-32">Total (kg)</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((item) => (
                      <TableRow key={item.productId} data-testid={`row-cart-${item.productId}`}>
                        <TableCell>
                          <div className="font-medium" data-testid={`text-product-name-${item.productId}`}>{item.product.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">{item.product.articleCode || item.product.code}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="outline" size="icon" onClick={() => updateQty(item.productId, -1)} data-testid={`button-qty-minus-${item.productId}`}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              type="number"
                              value={item.qty}
                              onChange={(e) => setQty(item.productId, parseInt(e.target.value) || 0)}
                              className="w-16 text-center"
                              min={1}
                              data-testid={`input-qty-${item.productId}`}
                            />
                            <Button variant="outline" size="icon" onClick={() => updateQty(item.productId, 1)} data-testid={`button-qty-plus-${item.productId}`}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={item.weightPerBaleKg}
                            onChange={(e) => updateWeight(item.productId, parseFloat(e.target.value) || 0)}
                            className="w-24 text-right ml-auto"
                            step="0.1"
                            min={0}
                            data-testid={`input-weight-${item.productId}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium" data-testid={`text-total-kg-${item.productId}`}>
                          {formatNumber(item.qty * item.weightPerBaleKg)}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removeItem(item.productId)} data-testid={`button-remove-${item.productId}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="w-72 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Entry Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground">Total Bales</div>
                <div className="text-2xl font-bold" data-testid="text-total-bales">{totalQty}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Weight</div>
                <div className="text-2xl font-bold" data-testid="text-total-weight">{formatNumber(totalKg)} kg</div>
              </div>
              {selectedLocationName && (
                <div>
                  <div className="text-sm text-muted-foreground">Location</div>
                  <div className="text-sm font-medium">{selectedLocationName.code} - {selectedLocationName.name}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            className="w-full gap-2"
            disabled={cart.length === 0 || !selectedLocationId || !selectedMixBatchId || stockEntryMutation.isPending}
            onClick={handleConfirmClick}
            data-testid="button-confirm-stock-entry"
          >
            <CheckCircle className="h-4 w-4" />
            {stockEntryMutation.isPending ? "Processing..." : "Confirm & Print Labels"}
          </Button>
        </div>
      </div>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Stock Entry</DialogTitle>
            <DialogDescription>
              {totalQty} bale(s) will be entered into stock. An A4 label and a sticker label will print for each bale.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Wt/Bale</TableHead>
                  <TableHead className="text-right">Total KG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell>
                      <div className="font-medium">{item.product.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{item.product.articleCode || item.product.code}</div>
                    </TableCell>
                    <TableCell className="text-center font-medium">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatNumber(item.weightPerBaleKg)} kg</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(item.qty * item.weightPerBaleKg)} kg</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t pt-2 flex justify-between items-center font-semibold">
              <span>Total: {totalQty} bales</span>
              <span>{formatNumber(totalKg)} kg</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => stockEntryMutation.mutate()}
              disabled={stockEntryMutation.isPending}
              data-testid="button-dialog-confirm-entry"
            >
              <Printer className="h-4 w-4 mr-2" />
              {stockEntryMutation.isPending ? "Processing..." : "Enter Stock & Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveFromStockTab() {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedBaleIds, setSelectedBaleIds] = useState<Set<number>>(new Set());
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [supervisorUsername, setSupervisorUsername] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [authError, setAuthError] = useState("");
  const { toast } = useToast();

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const activeLocations = locations?.filter((l) => l.active);

  const { data: inStockBales, isLoading: balesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/stock-entry/in-stock", selectedLocationId],
    queryFn: async () => {
      const locParam = selectedLocationId && selectedLocationId !== "all" ? `?locationId=${selectedLocationId}` : "";
      const url = `/api/factory/stock-entry/in-stock${locParam}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: true,
  });

  const toggleBale = (baleId: number) => {
    setSelectedBaleIds((prev) => {
      const next = new Set(prev);
      if (next.has(baleId)) next.delete(baleId);
      else next.add(baleId);
      return next;
    });
  };

  const selectAll = () => {
    if (!inStockBales) return;
    const allIds = new Set(inStockBales.map((b: any) => b.id));
    setSelectedBaleIds(allIds);
  };

  const clearSelection = () => setSelectedBaleIds(new Set());

  const handleRemoveClick = () => {
    if (selectedBaleIds.size === 0) {
      toast({ title: "Error", description: "Select at least one bale to remove", variant: "destructive" });
      return;
    }
    setRemoveDialogOpen(true);
    setSupervisorUsername("");
    setSupervisorPassword("");
    setRemovalReason("");
    setAuthError("");
  };

  const removeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/factory/stock-entry/remove", {
        baleIds: Array.from(selectedBaleIds),
        supervisorUsername,
        supervisorPassword,
        reason: removalReason,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to remove bales");
      }

      return await response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });

      toast({
        title: "Bales Removed",
        description: `${result.removed} bale(s) removed from stock`,
      });

      setSelectedBaleIds(new Set());
      setRemoveDialogOpen(false);
    },
    onError: (error: Error) => {
      setAuthError(error.message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="w-64">
          <Select value={selectedLocationId} onValueChange={(v) => { setSelectedLocationId(v); setSelectedBaleIds(new Set()); }}>
            <SelectTrigger data-testid="select-remove-location">
              <SelectValue placeholder="Filter by location..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {activeLocations?.map((loc) => (
                <SelectItem key={loc.id} value={loc.id.toString()}>
                  {loc.code} - {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {inStockBales && inStockBales.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">Select All</Button>
              {selectedBaleIds.size > 0 && (
                <Button variant="outline" size="sm" onClick={clearSelection} data-testid="button-clear-selection">Clear</Button>
              )}
            </>
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedBaleIds.size === 0}
            onClick={handleRemoveClick}
            data-testid="button-remove-bales"
          >
            <ShieldAlert className="h-4 w-4 mr-1" />
            Remove ({selectedBaleIds.size})
          </Button>
        </div>
      </div>

      {balesLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : !inStockBales || inStockBales.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No bales in stock</p>
              <p className="text-sm mt-1">Enter bales using the Stock Entry tab first</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Ref Number</TableHead>
                    <TableHead>Article</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inStockBales.map((bale: any) => {
                    const isSelected = selectedBaleIds.has(bale.id);
                    return (
                      <TableRow
                        key={bale.id}
                        className={`cursor-pointer ${isSelected ? "bg-destructive/5" : ""}`}
                        onClick={() => toggleBale(bale.id)}
                        data-testid={`row-stock-bale-${bale.id}`}
                      >
                        <TableCell>
                          <div className={`h-4 w-4 rounded border-2 flex items-center justify-center ${isSelected ? "border-destructive bg-destructive" : "border-muted-foreground/30"}`}>
                            {isSelected && <CheckCircle className="h-3 w-3 text-white" />}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{bale.referenceNumber}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{bale.articleCode || "-"}</TableCell>
                        <TableCell>{bale.productName || "-"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatNumber(parseFloat(bale.weightKg || "0"))}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{bale.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {bale.finalizedAt ? new Date(bale.finalizedAt).toLocaleDateString() : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Supervisor Authorization Required
            </DialogTitle>
            <DialogDescription>
              Removing {selectedBaleIds.size} bale(s) from stock requires supervisor credentials. This action will be logged.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Supervisor Username</p>
              <Input
                value={supervisorUsername}
                onChange={(e) => { setSupervisorUsername(e.target.value); setAuthError(""); }}
                placeholder="Enter supervisor username..."
                data-testid="input-supervisor-username"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Supervisor Password</p>
              <Input
                type="password"
                value={supervisorPassword}
                onChange={(e) => { setSupervisorPassword(e.target.value); setAuthError(""); }}
                placeholder="Enter supervisor password..."
                data-testid="input-supervisor-password"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Reason for Removal</p>
              <Input
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                placeholder="Entered by mistake, damaged, etc..."
                data-testid="input-removal-reason"
              />
            </div>
            {authError && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" />
                {authError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!supervisorUsername || !supervisorPassword || removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing..." : "Remove from Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BaleStockEntry() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Bale Stock Entry</h1>
          <p className="text-muted-foreground text-sm mt-1">Scan products and enter bales directly into stock</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LabelPrintSettings />
          <Badge variant="secondary" data-testid="badge-stock-entry">STOCK ENTRY</Badge>
        </div>
      </div>

      <Tabs defaultValue="entry">
        <TabsList>
          <TabsTrigger value="entry" data-testid="tab-stock-entry">
            <ScanLine className="h-4 w-4 mr-1" />
            Stock Entry
          </TabsTrigger>
          <TabsTrigger value="remove" data-testid="tab-remove-stock">
            <ShieldAlert className="h-4 w-4 mr-1" />
            Remove from Stock
          </TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="mt-4">
          <StockEntryTab />
        </TabsContent>
        <TabsContent value="remove" className="mt-4">
          <RemoveFromStockTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
