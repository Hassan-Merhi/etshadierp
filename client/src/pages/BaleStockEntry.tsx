import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Minus, Trash2, Printer, ScanLine, AlertCircle, Package, CheckCircle,
  XCircle, ShieldAlert, Lock, Upload, FileSpreadsheet
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
import { LabelPrintSettings, getPaperFormat } from "@/components/LabelPrintSettings";
import { Label } from "@/components/ui/label";
import * as XLSX from "xlsx";
import type { FactoryBaleProduct, Location, FactoryMixBatch, FactoryCategory } from "@shared/schema";

interface CartItem {
  productId: number;
  product: FactoryBaleProduct;
  qty: number;
  weightPerBaleKg: number;
}

const HMD_LOGO_BASE64 = 'data:image/png;base64,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';

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
        <img class="logo-img" src="${HMD_LOGO_BASE64}" alt="HMD" />
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
    .label-top { display: flex; justify-content: space-between; align-items: center; }
    .logo-section { flex-shrink: 0; }
    .logo-img { height: 14mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: auto; }
    .barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .barcode-number { font-size: 14pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 1mm; letter-spacing: 2px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-area { text-align: center; margin-top: 2mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .article-barcode-number { font-size: 12pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; letter-spacing: 1.5px; text-transform: uppercase; color: #000; }

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

function generateA5LabelsHtml(labels: LabelData[]) {
  let labelsHtml = '';
  for (const label of labels) {
    labelsHtml += `
      <div class="a5-page">
        <div class="a5-preprint-gap"></div>
        <div class="a5-content-area">
          <div class="a5-detail-block">
            ${buildDetailBlock(label)}
          </div>
          <div class="a5-name-below">
            <div class="a5-name-below-text">${label.productName}</div>
          </div>
        </div>
      </div>
      <div class="a5-page">
        <div class="a5-preprint-gap"></div>
        <div class="a5-bottom-namebox">
          <div class="a5-bottom-name-text">${label.productName}</div>
        </div>
      </div>`;
  }
  return `<html><head><title>Stock Entry Labels - A5</title><style>
    @page { size: 148.5mm 210mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }

    .code-label { width: 76mm; max-height: 58.5mm; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; background: #fff; overflow: hidden; }
    .label-top { display: flex; justify-content: space-between; align-items: center; }
    .logo-section { flex-shrink: 0; }
    .logo-img { height: 14mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 8pt; line-height: 1.4; }
    .info-key { font-weight: 900; }
    .info-val { font-weight: 900; }
    .barcode-area { text-align: center; margin-top: auto; }
    .barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .barcode-number { font-size: 14pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 1mm; letter-spacing: 2px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-area { text-align: center; margin-top: 2mm; border-top: 0.3mm dashed #ccc; padding-top: 1mm; }
    .article-barcode-img { width: 100%; height: 14mm; object-fit: fill; }
    .article-barcode-number { font-size: 12pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 0.5mm; letter-spacing: 1.5px; text-transform: uppercase; color: #000; }

    .a5-page { width: 148.5mm; height: 210mm; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
    .a5-page:last-child { page-break-after: auto; }

    .a5-preprint-gap { height: 90mm; flex-shrink: 0; }
    .a5-content-area { flex: 1; display: flex; flex-direction: column; padding: 0 8mm; overflow: hidden; }
    .a5-detail-block { flex-shrink: 0; width: 100%; max-width: 132mm; margin: 0 auto; border: 0.3mm solid #ccc; }
    .a5-name-below { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 2mm 0; }
    .a5-name-below-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; overflow: hidden; font-size: clamp(20pt, 5vw, 40pt); line-height: 1.15; color: #000; word-break: break-word; }

    .a5-bottom-namebox { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 8mm; }
    .a5-bottom-name-text { width: 100%; text-align: center; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; overflow: hidden; font-size: clamp(28pt, 8vw, 56pt); line-height: 1.15; color: #000; word-break: break-word; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-key, .info-val, .barcode-number, .article-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .a5-name-below-text, .a5-bottom-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">A5 Bale Labels. Select A5 paper size, Portrait, 100% scale. Set BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
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
                <img class="sticker-logo" src="${HMD_LOGO_BASE64}" alt="HMD" />
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
      </div>`;
  }
  return `<html><head><title>Sticker Labels</title><style>
    @page { size: 3in 1.97in; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .sticker-page { width: 3in; height: 1.97in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .sticker-page:last-child { page-break-after: auto; }
    .label { width: 3in; height: 1.97in; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; background: #fff; }
    .label-content { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
    .label-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1mm; }
    .logo-section { flex-shrink: 0; }
    .sticker-logo { height: 14mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .ref-barcode-section { text-align: center; margin-top: 1mm; }
    .ref-barcode-img { width: 100%; height: 10mm; object-fit: fill; }
    .ref-barcode-number { font-size: 14pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; margin-top: 1mm; letter-spacing: 2px; text-transform: uppercase; -webkit-text-stroke: 0.5px #000; }
    .article-barcode-section { text-align: center; margin-top: 2mm; }
    .article-barcode-img { width: 100%; height: 10mm; object-fit: fill; }
    .product-section { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 0.5mm; }
    .product-name-text { font-size: 9pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; color: #000; text-transform: uppercase; word-break: break-word; line-height: 1.1; }

    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      * { color: #000 !important; }
      .info-label, .info-value, .ref-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .product-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      .ref-barcode-img, .article-barcode-img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">Sticker Labels. Set printer to BEST quality, max darkness. Disable "Headers and Footers".</div>${labelsHtml}</body></html>`;
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
  const { data: categories } = useQuery<FactoryCategory[]>({ queryKey: ["/api/factory/categories"] });

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateName, setQuickCreateName] = useState("");
  const [quickCreateCategoryId, setQuickCreateCategoryId] = useState("");
  const [quickCreateWeight, setQuickCreateWeight] = useState("");

  const activeCategories = categories?.filter((c) => c.isActive);

  const quickCreateMutation = useMutation({
    mutationFn: async () => {
      const body: any = { name: quickCreateName };
      if (quickCreateCategoryId) body.categoryId = parseInt(quickCreateCategoryId);
      if (quickCreateWeight) body.weightPerBaleKg = quickCreateWeight;
      const response = await apiRequest("POST", "/api/factory/bale-products", body);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create product");
      }
      return await response.json();
    },
    onSuccess: (newProduct: FactoryBaleProduct) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({ title: "Product Created", description: `"${newProduct.name}" created successfully` });
      setQuickCreateOpen(false);
      setQuickCreateName("");
      setQuickCreateCategoryId("");
      setQuickCreateWeight("");
      setScanInput("");
      setShowDropdown(false);
      const defaultWeight = newProduct.weightPerBaleKg ? parseFloat(newProduct.weightPerBaleKg) : 25;
      setCart((prev) => [...prev, { productId: newProduct.id, product: newProduct, qty: 1, weightPerBaleKg: defaultWeight }]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const activeProducts = baleProducts?.filter((p) => p.active);
  const activeLocations = locations?.filter((l) => l.active);
  const activeMixBatches = mixBatches?.filter((b) => b.status === "ACTIVE");

  const selectedMixBatch = activeMixBatches?.find((b) => b.id.toString() === selectedMixBatchId);
  const mixBatchRemaining = selectedMixBatch
    ? parseFloat(selectedMixBatch.totalWeightKg) - parseFloat(selectedMixBatch.usedKg || "0")
    : 0;

  useEffect(() => {
    if (activeLocations && activeLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(activeLocations[0].id.toString());
    }
  }, [activeLocations, selectedLocationId]);

  useEffect(() => {
    if (activeMixBatches && activeMixBatches.length === 1 && !selectedMixBatchId) {
      setSelectedMixBatchId(activeMixBatches[0].id.toString());
    }
  }, [activeMixBatches, selectedMixBatchId]);

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
    const paperFormat = getPaperFormat();
    const labelHtml = paperFormat === "A5" ? generateA5LabelsHtml(labels) : generateCombinedLabelsHtml(labels);
    const a4Window = window.open("", "_blank");
    if (a4Window) {
      a4Window.document.write(labelHtml);
      a4Window.document.close();
      a4Window.focus();
      setTimeout(() => a4Window.print(), 500);
    }
    const stickerWindow = window.open("", "_blank");
    if (stickerWindow) {
      stickerWindow.document.write(generateStickerLabelsHtml(labels));
      stickerWindow.document.close();
      stickerWindow.focus();
      const imgs = stickerWindow.document.images;
      let loaded = 0;
      const total = imgs.length;
      const tryPrint = () => { loaded++; if (loaded >= total) setTimeout(() => stickerWindow.print(), 300); };
      if (total === 0) { setTimeout(() => stickerWindow.print(), 300); }
      else { for (let i = 0; i < total; i++) { if (imgs[i].complete) tryPrint(); else imgs[i].onload = imgs[i].onerror = tryPrint; } }
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
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });

      toast({
        title: "Stock Entry Complete",
        description: `${result.bales.length} bale(s) entered into stock. Preparing labels...`,
      });

      setConfirmDialogOpen(false);
      setCart([]);

      printLabels(result.bales);
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
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg" data-testid="dropdown-no-products">
                    <div className="px-3 py-2 text-sm text-muted-foreground">No products found</div>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover-elevate flex items-center gap-2 text-sm font-medium border-t"
                      onClick={() => {
                        setQuickCreateName(scanInput.trim());
                        setQuickCreateOpen(true);
                        setShowDropdown(false);
                      }}
                      data-testid="button-quick-create-product"
                    >
                      <Plus className="h-4 w-4" />
                      Create New Product "{scanInput.trim()}"
                    </button>
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
              {totalQty} bale(s) will be entered into stock. Labels ({getPaperFormat()} format) and sticker labels will print for each bale.
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

      <Dialog open={quickCreateOpen} onOpenChange={setQuickCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Create Product</DialogTitle>
            <DialogDescription>Create a new bale product. Article code will be auto-generated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-create-name">Name</Label>
              <Input
                id="quick-create-name"
                value={quickCreateName}
                onChange={(e) => setQuickCreateName(e.target.value)}
                placeholder="Product name..."
                data-testid="input-quick-create-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-create-category">Category</Label>
              <Select value={quickCreateCategoryId} onValueChange={setQuickCreateCategoryId}>
                <SelectTrigger data-testid="select-quick-create-category">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories?.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-create-weight">Weight per Bale (kg)</Label>
              <Input
                id="quick-create-weight"
                type="number"
                value={quickCreateWeight}
                onChange={(e) => setQuickCreateWeight(e.target.value)}
                placeholder="Optional - leave empty for default"
                step="0.1"
                min={0}
                data-testid="input-quick-create-weight"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setQuickCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => quickCreateMutation.mutate()}
              disabled={!quickCreateName.trim() || quickCreateMutation.isPending}
              data-testid="button-quick-create-submit"
            >
              {quickCreateMutation.isPending ? "Creating..." : "Create & Add to Cart"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveFromStockTab() {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");
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

  const filteredBales = inStockBales?.filter((bale: any) => {
    if (!dateFilter) return true;
    const baleDate = bale.finalizedAt ? new Date(bale.finalizedAt).toISOString().split("T")[0] : null;
    return baleDate === dateFilter;
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
    if (!filteredBales) return;
    const allIds = new Set(filteredBales.map((b: any) => b.id));
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-56">
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
          <div className="w-44">
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); setSelectedBaleIds(new Set()); }}
              data-testid="input-date-filter"
            />
          </div>
          {dateFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFilter(""); setSelectedBaleIds(new Set()); }} data-testid="button-clear-date">
              Clear date
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {filteredBales && filteredBales.length > 0 && (
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
      ) : !filteredBales || filteredBales.length === 0 ? (
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
                  {filteredBales.map((bale: any) => {
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

interface ImportBaleRow {
  itemName: string;
  weight: string;
  barcode: string;
  quantity: number;
  productionDate: string;
}

function ImportBalesTab() {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [importRows, setImportRows] = useState<ImportBaleRow[]>([]);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: locations } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const activeLocations = locations?.filter((l) => l.active);

  useEffect(() => {
    if (activeLocations && activeLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(activeLocations[0].id.toString());
    }
  }, [activeLocations, selectedLocationId]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i] as any[];
          if (row && row.some((cell: any) => String(cell).toUpperCase().includes("ITEM NAME"))) {
            headerRowIdx = i;
            break;
          }
        }

        if (headerRowIdx === -1) {
          toast({ title: "Error", description: "Could not find header row with 'ITEM NAME' column", variant: "destructive" });
          return;
        }

        const headers = (jsonData[headerRowIdx] as any[]).map((h: any) => String(h).toUpperCase().trim());
        const nameIdx = headers.findIndex((h) => h.includes("ITEM NAME"));
        const weightIdx = headers.findIndex((h) => h.includes("WEIGHT"));
        const barcodeIdx = headers.findIndex((h) => h.includes("BARCODE"));
        const qtyIdx = headers.findIndex((h) => h.includes("QUANTITY"));
        const dateIdx = headers.findIndex((h) => h.includes("PRODUCTION DATE"));

        const rows: ImportBaleRow[] = [];
        for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (!row || !row[nameIdx]) continue;
          const itemName = String(row[nameIdx] || "").trim();
          if (!itemName) continue;
          rows.push({
            itemName,
            weight: String(row[weightIdx] || "").trim(),
            barcode: String(row[barcodeIdx] || "").trim(),
            quantity: parseInt(String(row[qtyIdx] || "1")) || 1,
            productionDate: String(row[dateIdx] || "").trim(),
          });
        }

        if (rows.length === 0) {
          toast({ title: "Warning", description: "No data rows found in the Excel file", variant: "destructive" });
          return;
        }

        setImportRows(rows);
        toast({ title: "File Parsed", description: `Found ${rows.length} bale(s) to import` });
      } catch (err: any) {
        toast({ title: "Parse Error", description: err.message || "Failed to parse Excel file", variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/factory/bales/import", {
        erpLocationId: parseInt(selectedLocationId),
        bales: importRows,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to import bales");
      }
      return await response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({ title: "Import Complete", description: `${result.imported || importRows.length} bale(s) imported successfully` });
      setImportRows([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (error: Error) => {
      toast({ title: "Import Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-muted-foreground mb-1.5">Warehouse Location</p>
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger data-testid="select-import-location">
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
          <p className="text-sm text-muted-foreground mb-1.5">Upload Excel File</p>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              data-testid="input-import-file"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-upload-excel"
            >
              <Upload className="h-4 w-4 mr-2" />
              {fileName || "Choose File..."}
            </Button>
            {fileName && (
              <Badge variant="secondary" data-testid="badge-file-name">
                <FileSpreadsheet className="h-3 w-3 mr-1" />
                {fileName}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {importRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg">Preview ({importRows.length} rows)</CardTitle>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={!selectedLocationId || importMutation.isPending}
                data-testid="button-import-submit"
              >
                {importMutation.isPending ? "Importing..." : `Import ${importRows.length} Bales`}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead>Production Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importRows.map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-import-${idx}`}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium" data-testid={`text-import-name-${idx}`}>{row.itemName}</TableCell>
                      <TableCell className="text-right" data-testid={`text-import-weight-${idx}`}>{row.weight}</TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`text-import-barcode-${idx}`}>{row.barcode}</TableCell>
                      <TableCell className="text-center" data-testid={`text-import-qty-${idx}`}>{row.quantity}</TableCell>
                      <TableCell data-testid={`text-import-date-${idx}`}>{row.productionDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {importRows.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium" data-testid="text-import-empty">Upload an Excel file to preview bales for import</p>
              <p className="text-sm mt-1">Expected columns: ITEM NAME, WEIGHT, ITEM BARCODE, QUANTITY, PRODUCTION DATE</p>
            </div>
          </CardContent>
        </Card>
      )}
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
          <TabsTrigger value="import" data-testid="tab-import-bales">
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Import Bales
          </TabsTrigger>
        </TabsList>
        <TabsContent value="entry" className="mt-4">
          <StockEntryTab />
        </TabsContent>
        <TabsContent value="remove" className="mt-4">
          <RemoveFromStockTab />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <ImportBalesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
