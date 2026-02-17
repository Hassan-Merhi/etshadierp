import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Printer, Trash2, Search, Package, Filter, CheckSquare, CalendarDays } from "lucide-react";
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

const HMD_LOGO_BASE64 = 'data:image/png;base64,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';

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
        <div class="label-header">
          <div class="logo-area">
            <img class="hmd-logo" src="${HMD_LOGO_BASE64}" alt="HMD" />
          </div>
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
    .label-header { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
    .logo-area { flex-shrink: 0; }
    .hmd-logo { height: 14mm; width: auto; object-fit: contain; display: block; }
    .info-section { text-align: right; font-size: 9pt; line-height: 1.5; }
    .info-label { font-weight: 900; }
    .info-value { font-weight: 900; }
    .ref-barcode-section { text-align: center; margin-top: 1mm; }
    .ref-barcode-img { width: 100%; height: 10mm; object-fit: fill; }
    .ref-barcode-number { font-size: 9pt; font-weight: 900; font-family: 'Courier New', monospace; margin-top: 0.5mm; letter-spacing: 1.5px; -webkit-text-stroke: 0.5px #000; }
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
  IN_STOCK: "default",
  RESERVED: "outline",
  SOLD: "destructive",
};

export default function BalesHistory() {
  const [searchTerm, setSearchTerm] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("IN_STOCK");
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split("T")[0]);
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

    if (dateFilter) {
      const baleDate = bale.createdAt ? new Date(bale.createdAt).toISOString().split("T")[0] : null;
      if (baleDate !== dateFilter) return false;
    }

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

  const todayStr = new Date().toISOString().split("T")[0];
  const todayInStock = (balesData || []).filter((row: any) => {
    const bale = row.bale;
    if (bale.status !== "IN_STOCK") return false;
    const baleDate = bale.createdAt ? new Date(bale.createdAt).toISOString().split("T")[0] : null;
    return baleDate === todayStr;
  });
  const todayTotalQty = todayInStock.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);
  const todayTotalKg = todayInStock.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Package className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Bales History</h2>
          <Badge variant="secondary" data-testid="badge-total-bales">{totalBales} bales</Badge>
          <Badge variant="outline" data-testid="badge-total-weight">{formatLabelNum(totalWeight)} kg</Badge>
        </div>
        <Card className="border-dashed">
          <CardContent className="py-2 px-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Today&apos;s In Stock</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold" data-testid="text-today-qty">{todayTotalQty} qty</span>
                <span className="text-sm font-semibold" data-testid="text-today-kg">{formatLabelNum(todayTotalKg)} kg</span>
              </div>
            </div>
          </CardContent>
        </Card>
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
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-[160px]"
                data-testid="input-date-filter"
              />
              {dateFilter && (
                <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} data-testid="button-clear-date">
                  Clear
                </Button>
              )}
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
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
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
                  <SelectItem value="IN_STOCK">In Stock</SelectItem>
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
                    <TableHead>Product</TableHead>
                    <TableHead>Article</TableHead>
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
                        <TableCell>{product?.name || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{product?.articleCode || bale.category || "-"}</TableCell>
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
                              <SelectItem value="IN_STOCK">In Stock</SelectItem>
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
