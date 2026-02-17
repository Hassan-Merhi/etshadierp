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
import { LabelPrintSettings, getPaperFormat } from "@/components/LabelPrintSettings";
import { generateCombinedLabelsHtml, generateA5LabelsHtml, generateStickerLabelsHtml, formatLabelNum, type LabelData } from "@/lib/labelHtml";
import type { FactoryMixBatch, FactoryBaleProduct } from "@shared/schema";


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
    const label: LabelData = {
      referenceNumber: baleRow.bale.baleCode,
      articleCode: baleRow.product?.articleCode || baleRow.bale.category || "",
      pieces: baleRow.bale.quantity || 1,
      approxWeightKg: baleRow.bale.weightKg || "0",
      productName: baleRow.product?.name || baleRow.bale.category || "",
    };

    if (isZebraMode()) {
      try {
        const zpl = buildZplBatch([label], true);
        await printRawZpl(zpl);
        toast({ title: "Label sent to Zebra printer" });
      } catch (err: any) {
        toast({ title: "Zebra print failed — falling back to browser", description: err.message, variant: "destructive" });
        openBrowserReprint([label]);
      }
    } else {
      openBrowserReprint([label]);
    }
  };

  const openBrowserReprint = (labels: LabelData[]) => {
    const fmt = getPaperFormat();
    const paperHtml = fmt === "A5"
      ? generateA5LabelsHtml(labels)
      : generateCombinedLabelsHtml(labels);
    const stickerHtml = generateStickerLabelsHtml(labels);

    const w1 = window.open("", "_blank", "width=800,height=900");
    if (w1) { w1.document.write(paperHtml); w1.document.close(); }

    const w2 = window.open("", "_blank", "width=400,height=600");
    if (w2) { w2.document.write(stickerHtml); w2.document.close(); }
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
            <LabelPrintSettings />
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
