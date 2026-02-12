import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Minus, Trash2, Printer, Barcode, ScanLine, AlertCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import type { FactoryBaleProduct } from "@shared/schema";

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

function generateFullLabelHtml(label: {
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
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
          </div>
        </div>
        <div class="barcode-section">
          <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
          <div class="product-name-text">${label.productName}</div>
        </div>
      </div>
    </div>`;
}

function generateLabelHtml(labels: Array<{
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
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
              <img class="name-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
              <div class="name-label-text">${label.productName}</div>
            </div>
          </div>
        </div>`;
    } else {
      labelsHtml += `<div class="single-page">${fullLabel}</div>`;
    }
  }
  const pageSize = dualLabel ? 'size: 3in 3.94in;' : 'size: 3in 1.97in;';
  return `<html><head><title></title><style>
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
  </style></head><body><div class="print-note">For cleanest output, disable "Headers and Footers" in your print settings.</div>${labelsHtml}</body></html>`;
}

export default function PressingBales() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [dualLabel, setDualLabel] = useState(true);
  const scanRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: baleProducts, isLoading: productsLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
  });

  const activeProducts = baleProducts?.filter((p) => p.active);

  useEffect(() => {
    if (scanRef.current) {
      scanRef.current.focus();
    }
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
          item.productId === product.id
            ? { ...item, qty: item.qty + 1 }
            : item
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

  const updateQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.productId === productId
            ? { ...item, qty: Math.max(0, item.qty + delta) }
            : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const setQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
    } else {
      setCart((prev) =>
        prev.map((item) =>
          item.productId === productId ? { ...item, qty } : item
        )
      );
    }
  };

  const updateWeight = (productId: number, weight: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, weightPerBaleKg: weight } : item
      )
    );
  };

  const removeItem = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  const totalKgToConsume = cart.reduce((sum, item) => sum + item.qty * item.weightPerBaleKg, 0);

  const printBaleLabels = async (bales: any[], products: FactoryBaleProduct[], weights: string[]) => {
    try {
      const labelData = bales.map((bale: any, idx: number) => ({
        productionBaleId: bale.id,
        productId: products[idx].id,
        articleCode: products[idx].articleCode || products[idx].code,
        pieces: 1,
        approxWeightKg: weights[idx],
      }));

      const labelPrintResponse = await apiRequest("POST", "/api/bale-label-prints", {
        bales: labelData,
      });

      if (!labelPrintResponse.ok) {
        const err = await labelPrintResponse.json();
        throw new Error(err.message || "Failed to create label print records");
      }

      const { labelPrints } = await labelPrintResponse.json();

      const labels = labelPrints.map((lp: any, idx: number) => ({
        referenceNumber: lp.referenceNumber,
        articleCode: lp.articleCode,
        pieces: lp.pieces,
        approxWeightKg: lp.approxWeightKg,
        productName: products[idx]?.name || "",
      }));

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast({ title: "Error", description: "Please allow pop-ups to print labels", variant: "destructive" });
        return;
      }

      printWindow.document.write(generateLabelHtml(labels, dualLabel));
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 500);
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to generate labels", variant: "destructive" });
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) {
        throw new Error("Please add items to cart");
      }

      const allBales: any[] = [];
      const allProducts: FactoryBaleProduct[] = [];
      const allWeights: string[] = [];

      for (const item of cart) {
        const payload: any = {
          productId: item.productId,
          quantity: item.qty.toString(),
          weightPerBale: item.weightPerBaleKg.toString(),
          mode: "pressing",
        };

        const response = await apiRequest("POST", "/api/factory/pressing/create-and-print", payload);

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.message || "Failed to create bales");
        }

        const result = await response.json();
        allBales.push(...result.bales);
        for (let i = 0; i < result.bales.length; i++) {
          allProducts.push(item.product);
          allWeights.push(item.weightPerBaleKg.toString());
        }
      }

      return { bales: allBales, products: allProducts, weights: allWeights };
    },
    onSuccess: async ({ bales, products, weights }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pressing-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });

      await printBaleLabels(bales, products, weights);

      toast({
        title: "Success",
        description: `Created ${bales.length} pressing bale(s) and sent to printer`,
      });

      setCart([]);
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
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Pressing Bales</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-subtitle">Scan products to create PENDING bales for counting</p>
          </div>
          <Badge variant="secondary" data-testid="text-pressing-badge">PRESSING</Badge>
        </div>
        <div className="flex items-center gap-3 rounded-md border px-3 py-2">
          <Switch
            id="pressing-dual-label-toggle"
            checked={dualLabel}
            onCheckedChange={setDualLabel}
            data-testid="switch-dual-label"
          />
          <Label htmlFor="pressing-dual-label-toggle" className="text-sm cursor-pointer">
            {dualLabel ? "Dual labels" : "Single label"}
          </Label>
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
              <div className="space-y-2">
                <Input
                  ref={scanRef}
                  value={scanInput}
                  onChange={(e) => {
                    setScanInput(e.target.value);
                    setScanError("");
                  }}
                  onKeyDown={handleScanKeyDown}
                  placeholder="Scan barcode or type article code..."
                  autoFocus
                  data-testid="input-scan"
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Cart ({totalQty} bales)</CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Barcode className="h-8 w-8 mx-auto mb-2" />
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
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => updateQty(item.productId, -1)}
                              data-testid={`button-qty-minus-${item.productId}`}
                            >
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
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => updateQty(item.productId, 1)}
                              data-testid={`button-qty-plus-${item.productId}`}
                            >
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.productId)}
                            data-testid={`button-remove-${item.productId}`}
                          >
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
                <CardTitle className="text-lg">Production Total</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground">Total Bales</div>
                <div className="text-2xl font-bold" data-testid="text-total-bales">{totalQty}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Weight</div>
                <div className="text-2xl font-bold" data-testid="text-total-weight">{formatNumber(totalKgToConsume)} kg</div>
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full gap-2"
            disabled={cart.length === 0 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            data-testid="button-create-print"
          >
            <Printer className="h-4 w-4" />
            {createMutation.isPending ? "Creating..." : "Create + Print Pressing"}
          </Button>
        </div>
      </div>
    </div>
  );
}
