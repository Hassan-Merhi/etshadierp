import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Printer, Trash2, Search, Package, Filter, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
import { buildZplBatch } from "@/lib/zplBuilder";
import type { FactoryMixBatch, FactoryBaleProduct } from "@shared/schema";

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
          <img class="hmd-logo" src="/hmd-logo-clean.png" alt="HMD" />
          <div class="info-section">
            <div><span class="info-label">PIECES:</span> <span class="info-value">${label.pieces}</span></div>
            <div><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
            <div><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${label.weightKg} KGS</span></div>
          </div>
        </div>
        <div class="ref-barcode-section">
          <img class="ref-barcode-img" src="/api/barcode/${encodeURIComponent(label.baleCode)}" alt="REF Barcode" />
          <div class="ref-barcode-number">${label.baleCode}</div>
        </div>
        <div class="article-barcode-section">
          <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
        </div>
        <div class="product-name-section">
          <div class="product-name-text">${label.productName}</div>
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
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .page-container { width: 3in; height: 3.94in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .page-container:last-child { page-break-after: auto; }
    .single-page { width: 3in; height: 1.97in; page-break-after: always; page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
    .single-page:last-child { page-break-after: auto; }
    .label { width: 3in; height: 1.97in; padding: 2mm 3mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; position: relative; background: #fff; }
    .label-content { display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
    .name-label { justify-content: center; align-items: center; }
    .name-label-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: 1mm; }
    .name-barcode-img { width: 60mm; height: 12mm; object-fit: contain; }
    .name-label-text { font-size: 16pt; font-weight: 900; color: #000; text-align: center; line-height: 1.15; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden; max-width: 100%; display: block; }
    .label-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 2mm; }
    .hmd-logo { height: 11mm; width: auto; object-fit: contain; flex-shrink: 0; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .ref-barcode-section { text-align: center; margin-top: 1mm; }
    .ref-barcode-img { width: 100%; height: 10mm; object-fit: fill; }
    .ref-barcode-number { font-size: 7pt; font-weight: 900; font-family: 'Courier New', monospace; margin-top: 0.5mm; letter-spacing: 1.5px; }
    .article-barcode-section { text-align: center; margin-top: 2mm; }
    .article-barcode-img { width: 100%; height: 10mm; object-fit: fill; }
    .product-name-section { text-align: center; margin-top: 1mm; border-top: 0.3mm dashed #ccc; padding-top: 0.5mm; }
    .product-name-text { font-size: 9pt; font-weight: 900; font-family: Arial, Helvetica, sans-serif; color: #000; text-transform: uppercase; word-break: break-word; line-height: 1.1; }
    .print-note { text-align: center; font-size: 9pt; color: #666; padding: 4px; background: #fffbe6; border-bottom: 1px solid #eee; }
    @media print {
      .print-note { display: none !important; }
      header, .print-header, .page-header { display: none !important; }
      body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      * { color: #000 !important; }
      .info-label, .info-value, .ref-barcode-number { -webkit-text-stroke: 0.3px #000; }
      .name-label-text, .product-name-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
      .ref-barcode-img, .article-barcode-img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
    }
  </style></head><body><div class="print-note">Set printer to BEST quality, max darkness. Disable "Headers and Footers" in print settings.</div>${labelsHtml}</body></html>`;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_PRESSING: "outline",
  LABEL_PRINTED: "secondary",
  PRESSED: "default",
  FINALIZED: "default",
  RESERVED: "outline",
  SOLD: "destructive",
};

export default function BalesHistory() {
  const [searchTerm, setSearchTerm] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const { toast } = useToast();

  const { data: balesData, isLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/bales"],
  });

  const { data: mixBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const deleteBale = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/factory/bales/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Bale deleted" });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      toast({ title: "Error deleting bale", description: error.message, variant: "destructive" });
      setDeleteConfirm(null);
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return await apiRequest("PATCH", `/api/factory/bales/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      return await apiRequest("PATCH", "/api/factory/bales/bulk-status", { ids, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      setSelectedIds(new Set());
      setBulkStatus("");
      toast({ title: "Bulk status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    },
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (filteredItems: any[]) => {
    const filteredIds = filteredItems.map((r: any) => r.bale.id);
    const allSelected = filteredIds.every((id: number) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const handleReprint = async (baleRow: any) => {
    if (isZebraMode()) {
      try {
        const label = {
          referenceNumber: baleRow.bale.baleCode,
          articleCode: baleRow.product?.articleCode || baleRow.bale.category || "",
          pieces: baleRow.bale.quantity || 1,
          approxWeightKg: baleRow.bale.weightKg || "0",
          productName: baleRow.product?.name || baleRow.bale.category || "",
        };
        const zpl = buildZplBatch([label], true);
        await printRawZpl(zpl);
        toast({ title: "Label sent to Zebra printer" });
      } catch (err: any) {
        toast({ title: "Zebra print failed — falling back to browser", description: err.message, variant: "destructive" });
        const html = generateReprintHtml(baleRow.bale, baleRow.product, true);
        const w = window.open("", "_blank", "width=400,height=600");
        if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
      }
    } else {
      const html = generateReprintHtml(baleRow.bale, baleRow.product, true);
      const w = window.open("", "_blank", "width=400,height=600");
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
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
                <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
                <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                <SelectItem value="PRESSED">Pressed</SelectItem>
                <SelectItem value="FINALIZED">Finalized</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger className="w-[180px]" data-testid="select-bulk-status">
                  <SelectValue placeholder="Change status to..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
                  <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                  <SelectItem value="PRESSED">Pressed</SelectItem>
                  <SelectItem value="FINALIZED">Finalized</SelectItem>
                  <SelectItem value="RESERVED">Reserved</SelectItem>
                  <SelectItem value="SOLD">Sold</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!bulkStatus || bulkUpdateStatus.isPending}
                onClick={() => bulkUpdateStatus.mutate({ ids: Array.from(selectedIds), status: bulkStatus })}
                data-testid="button-bulk-update"
              >
                {bulkUpdateStatus.isPending ? "Updating..." : "Apply"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setSelectedIds(new Set()); setBulkStatus(""); }}
                data-testid="button-clear-selection"
              >
                Clear
              </Button>
            </div>
          )}

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
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filtered.length > 0 && filtered.every((r: any) => selectedIds.has(r.bale.id))}
                        onCheckedChange={() => toggleSelectAll(filtered)}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
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
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(bale.id)}
                            onCheckedChange={() => toggleSelect(bale.id)}
                            data-testid={`checkbox-bale-${bale.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{bale.baleCode}</TableCell>
                        <TableCell>{product?.name || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{product?.articleCode || bale.category || "-"}</TableCell>
                        <TableCell className="text-xs">{batch?.name || "-"}</TableCell>
                        <TableCell className="text-right">{bale.quantity}</TableCell>
                        <TableCell className="text-right font-mono">{formatLabelNum(bale.weightKg)}</TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">{formatLabelNum(bale.costPerKg)}</TableCell>
                        <TableCell>
                          <Select
                            value={bale.status}
                            onValueChange={(val) => updateStatus.mutate({ id: bale.id, status: val })}
                          >
                            <SelectTrigger className="w-[140px] h-8 text-xs" data-testid={`select-status-${bale.id}`}>
                              <Badge variant={(STATUS_COLORS[bale.status] || "secondary") as any} className="text-xs">
                                {bale.status.replace(/_/g, " ")}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
                              <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                              <SelectItem value="PRESSED">Pressed</SelectItem>
                              <SelectItem value="FINALIZED">Finalized</SelectItem>
                              <SelectItem value="RESERVED">Reserved</SelectItem>
                              <SelectItem value="SOLD">Sold</SelectItem>
                            </SelectContent>
                          </Select>
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
