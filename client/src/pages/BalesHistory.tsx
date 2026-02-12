import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Printer, Trash2, Search, Package, Filter, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { MixBatch, BaleProduct } from "@shared/schema";

function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return parseFloat(n.toFixed(3)).toString();
}

function generateReprintHtml(bale: any, product: any, dualLabel: boolean): string {
  const label = {
    baleCode: bale.baleCode,
    articleCode: product?.articleCode || bale.category || "",
    productName: product?.name || bale.category || "",
    weightKg: formatLabelNum(bale.weightKg),
    pieces: formatLabelNum(bale.quantity),
    date: bale.pressedAt
      ? new Date(bale.pressedAt).toLocaleDateString()
      : new Date(bale.createdAt).toLocaleDateString(),
  };

  const fullLabel = `
    <div class="label">
      <div class="label-content">
        <div class="label-top">
          <div class="logo-section">
            <div class="logo-text">HMD</div>
            <div class="logo-subtitle">TEXTILES</div>
          </div>
          <div class="info-section">
            <div><span class="info-label">PCS:</span> <span class="info-value">${label.pieces}</span></div>
            <div><span class="info-label">KG:</span> <span class="info-value">${label.weightKg}</span></div>
            <div><span class="info-label">DATE:</span> <span class="info-value">${label.date}</span></div>
          </div>
        </div>
        <div class="barcode-section">
          <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.baleCode)}" alt="Bale Barcode" />
          <div class="barcode-number">${label.baleCode}</div>
        </div>
        <div class="article-barcode-section">
          <img class="barcode-img-small" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
          <div class="article-name">${label.articleCode}</div>
        </div>
      </div>
    </div>`;

  let labelsHtml = "";
  if (dualLabel) {
    labelsHtml = `
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
    labelsHtml = `<div class="single-page">${fullLabel}</div>`;
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
    .label { width: 3in; height: 1.97in; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; border-bottom: 1px dashed #ccc; position: relative; background-image: url('/hmd-label-bg.jpeg'); background-repeat: no-repeat; background-position: center; background-size: contain; }
    .label::before { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,0.80); }
    .label-content { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
    .name-label { border-bottom: none; justify-content: center; align-items: center; }
    .name-label-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: 1mm; }
    .name-barcode-img { width: 60mm; height: 12mm; object-fit: contain; }
    .name-label-text { font-size: 18pt; font-weight: 900; color: #000; text-align: center; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.5px; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1mm; }
    .logo-section { display: flex; flex-direction: column; align-items: flex-start; }
    .logo-text { font-size: 28pt; font-weight: 900; letter-spacing: 3px; color: #000; line-height: 1; }
    .logo-subtitle { font-size: 6pt; font-weight: 700; letter-spacing: 1.5px; color: #000; margin-top: 0.5mm; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .barcode-section { text-align: center; margin-top: 1mm; }
    .barcode-img { width: 65mm; height: 14mm; object-fit: contain; }
    .barcode-number { font-size: 14pt; font-weight: 900; margin-top: 0.5mm; color: #000; letter-spacing: 1px; }
    .article-barcode-section { text-align: center; margin-top: 1mm; }
    .barcode-img-small { width: 55mm; height: 8mm; object-fit: contain; }
    .article-name { font-size: 7pt; font-weight: 700; margin-top: 0.3mm; color: #000; text-transform: uppercase; }
    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print { .print-note { display: none !important; } header, .print-header, .page-header { display: none !important; } body { margin: 0; } }
  </style></head><body><div class="print-note">For cleanest output, disable "Headers and Footers" in your print settings.</div>${labelsHtml}</body></html>`;
}

const STATUS_COLORS: Record<string, string> = {
  LABEL_PRINTED: "secondary",
  PRESSED: "default",
  IN_STOCK: "default",
  RESERVED: "outline",
  SOLD: "destructive",
};

export default function BalesHistory() {
  const [searchTerm, setSearchTerm] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: balesData, isLoading } = useQuery<any[]>({
    queryKey: ["/api/production-bales"],
  });

  const { data: mixBatches } = useQuery<MixBatch[]>({
    queryKey: ["/api/mix-batches"],
  });

  const deleteBale = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/production-bales/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      toast({ title: "Bale deleted" });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      toast({ title: "Error deleting bale", description: error.message, variant: "destructive" });
      setDeleteConfirm(null);
    },
  });

  const handleReprint = (baleRow: any) => {
    const html = generateReprintHtml(baleRow.bale, baleRow.product, true);
    const w = window.open("", "_blank", "width=400,height=600");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    }
  };

  const filtered = (balesData || []).filter((row: any) => {
    const bale = row.bale;
    const product = row.product;
    const batch = row.mixBatch;

    if (batchFilter !== "all" && String(bale.mixBatchId) !== batchFilter) return false;
    if (statusFilter !== "all" && bale.status !== statusFilter) return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchFields = [
        bale.baleCode,
        bale.barcodeValue,
        bale.category,
        product?.name,
        product?.articleCode,
        batch?.name,
      ].filter(Boolean).map((s: string) => s.toLowerCase());
      if (!searchFields.some((f) => f.includes(term))) return false;
    }

    return true;
  });

  const totalWeight = filtered.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);
  const totalBales = filtered.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Package className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Bales History</h2>
        <Badge variant="secondary" data-testid="badge-total-bales">{totalBales} bales</Badge>
        <Badge variant="outline" data-testid="badge-total-weight">{formatLabelNum(totalWeight)} kg</Badge>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by code, product, batch..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-bales-search"
              />
            </div>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-batch-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="All Batches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Batches</SelectItem>
                {mixBatches?.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                <SelectItem value="PRESSED">Pressed</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No bales found</p>
              {searchTerm && <p className="text-xs mt-1">Try a different search term</p>}
            </div>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bale Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Article</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Weight (kg)</TableHead>
                    <TableHead className="text-right">Cost/kg</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row: any) => {
                    const bale = row.bale;
                    const product = row.product;
                    const batch = row.mixBatch;
                    return (
                      <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                        <TableCell className="font-mono text-xs">{bale.baleCode}</TableCell>
                        <TableCell>{product?.name || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{product?.articleCode || bale.category || "-"}</TableCell>
                        <TableCell className="text-xs">{batch?.name || "-"}</TableCell>
                        <TableCell className="text-right">{bale.quantity}</TableCell>
                        <TableCell className="text-right font-mono">{formatLabelNum(bale.weightKg)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatLabelNum(bale.costPerKg)}</TableCell>
                        <TableCell>
                          <Badge variant={(STATUS_COLORS[bale.status] || "secondary") as any} data-testid={`badge-status-${bale.id}`}>
                            {bale.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(bale.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleReprint(row)}
                              data-testid={`button-reprint-${bale.id}`}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteConfirm(bale.id)}
                              data-testid={`button-delete-${bale.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bale</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this bale? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteBale.mutate(deleteConfirm)}
              disabled={deleteBale.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteBale.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
