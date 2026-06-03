import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Search,
  Download,
  FileText,
  CheckCircle,
  Package,
  DollarSign,
  Loader2,
  BarChart2,
  RefreshCw,
  Save,
} from "lucide-react";

interface AnalysisRow {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  currentStock: number;
  avgSellingPrice: number | null;
  dubaiCost: number;
  dubaiCostSource: string;
  configPrice: number;
  offloadingCost: number;
  offloadingSource: string;
  totalCost: number;
  estimatedProfit: number | null;
  profitPercent: number | null;
  status: string;
  proformaQty: number | null;
  proformaBarcode: string | null;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "-";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "gaining")
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 gap-1">
        <TrendingUp className="w-3 h-3" /> Gaining
      </Badge>
    );
  if (status === "losing")
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 gap-1">
        <TrendingDown className="w-3 h-3" /> Losing
      </Badge>
    );
  if (status === "break_even")
    return (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 gap-1">
        <Minus className="w-3 h-3" /> Break Even
      </Badge>
    );
  return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 gap-1">
      <AlertTriangle className="w-3 h-3" /> No Data
    </Badge>
  );
}

export default function SupplierProfitCheck() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const companyId = selectedCompany?.id;

  // Setup state
  const [supplierId, setSupplierId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [sourceType, setSourceType] = useState<"all" | "proforma">("all");
  const [proformaId, setProformaId] = useState<string>("");

  // Data state
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Edit state
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});
  const [priceMap, setPriceMap] = useState<Record<number, string>>({});

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [qtyEnteredOnly, setQtyEnteredOnly] = useState(false);
  const [minProfitPct, setMinProfitPct] = useState<string>("");

  // Proforma save state
  const [savedProforma, setSavedProforma] = useState<{ id: number; reference: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [proformaRef, setProformaRef] = useState<string>("");
  const [proformaNotes, setProformaNotes] = useState<string>("");

  // Queries
  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch(`/api/suppliers?companyId=${companyId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const { data: proformas = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", supplierId, "proformas"],
    enabled: !!supplierId && sourceType === "proforma",
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${supplierId}/proformas`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  // Rows with live profit recalculation using user-edited prices
  const computedRows = useMemo(() => {
    return rows.map((row) => {
      const editedPrice = priceMap[row.stockItemId];
      const dubaiCost = editedPrice !== undefined ? Number(editedPrice) || 0 : row.dubaiCost;
      const totalCost = dubaiCost + row.configPrice + row.offloadingCost;
      let estimatedProfit: number | null = null;
      let profitPercent: number | null = null;
      let status = row.status;
      if (row.avgSellingPrice != null) {
        estimatedProfit = row.avgSellingPrice - totalCost;
        profitPercent = row.avgSellingPrice > 0 ? (estimatedProfit / row.avgSellingPrice) * 100 : null;
        if (estimatedProfit > 0) status = "gaining";
        else if (estimatedProfit < 0) status = "losing";
        else status = "break_even";
      }
      return { ...row, dubaiCost, totalCost, estimatedProfit, profitPercent, status };
    });
  }, [rows, priceMap]);

  // Groups for filter
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const r of rows) {
      const key = r.stockGroupId ? String(r.stockGroupId) : "null";
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ id: key, name: r.stockGroupName || "No Group" });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    const minPct = minProfitPct ? Number(minProfitPct) : null;
    return computedRows.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "missing_offload" && r.offloadingSource !== "missing") return false;
        if (statusFilter !== "missing_offload" && r.status !== statusFilter) return false;
      }
      if (groupFilter !== "all") {
        const key = r.stockGroupId ? String(r.stockGroupId) : "null";
        if (key !== groupFilter) return false;
      }
      if (qtyEnteredOnly && !(Number(qtyMap[r.stockItemId]) > 0)) return false;
      if (minPct != null && (r.profitPercent == null || r.profitPercent < minPct)) return false;
      return true;
    });
  }, [computedRows, search, statusFilter, groupFilter, qtyEnteredOnly, qtyMap, minProfitPct]);

  // Summary stats
  const summary = useMemo(() => {
    const withQty = computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0);
    const totalQty = withQty.reduce((s, r) => s + (Number(qtyMap[r.stockItemId]) || 0), 0);
    const totalSupCost = withQty.reduce(
      (s, r) => s + (Number(qtyMap[r.stockItemId]) || 0) * r.dubaiCost,
      0
    );
    const totalEstSales = withQty.reduce((s, r) => {
      return r.avgSellingPrice != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.avgSellingPrice : s;
    }, 0);
    const totalEstProfit = withQty.reduce((s, r) => {
      return r.estimatedProfit != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.estimatedProfit : s;
    }, 0);
    const avgProfitPct =
      totalEstSales > 0 ? (totalEstProfit / totalEstSales) * 100 : null;
    const losingCount = computedRows.filter((r) => r.status === "losing").length;
    const noDataCount = computedRows.filter((r) => r.status === "no_sales_data").length;
    const missingOffloadCount = computedRows.filter((r) => r.offloadingSource === "missing").length;
    const selectedCount = withQty.length;

    // Items where dubai cost would change
    const dubaiUpdateCount = withQty.filter((r) => {
      const editedPrice = priceMap[r.stockItemId];
      if (editedPrice === undefined) return false;
      return Math.abs(Number(editedPrice) - r.dubaiCost) > 0.001;
    }).length;

    return {
      totalItems: computedRows.length,
      selectedCount,
      totalQty,
      totalSupCost,
      totalEstSales,
      totalEstProfit,
      avgProfitPct,
      losingCount,
      noDataCount,
      missingOffloadCount,
      dubaiUpdateCount,
    };
  }, [computedRows, qtyMap, priceMap]);

  const handleLoad = useCallback(async () => {
    if (!supplierId) {
      toast({ title: "Select a supplier", variant: "destructive" });
      return;
    }
    if (!fromDate || !toDate) {
      toast({ title: "Select a date range", variant: "destructive" });
      return;
    }
    if (sourceType === "proforma" && !proformaId) {
      toast({ title: "Select a proforma", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    setLoaded(false);
    setSavedProforma(null);
    try {
      const data = await apiRequest("POST", "/api/supplier-profit-check/analyze", {
        supplierId: Number(supplierId),
        fromDate,
        toDate,
        sourceType,
        proformaId: proformaId ? Number(proformaId) : undefined,
      });
      const analysisRows: AnalysisRow[] = await data.json();
      setRows(analysisRows);
      // Pre-fill qty from proforma if source is proforma
      const initialQty: Record<number, string> = {};
      const initialPrice: Record<number, string> = {};
      for (const r of analysisRows) {
        if (r.proformaQty != null && r.proformaQty > 0) {
          initialQty[r.stockItemId] = String(r.proformaQty);
        }
        if (r.dubaiCost > 0) {
          initialPrice[r.stockItemId] = String(r.dubaiCost);
        }
      }
      setQtyMap(initialQty);
      setPriceMap(initialPrice);
      setLoaded(true);
      toast({ title: `Loaded ${analysisRows.length} items` });
    } catch (err: any) {
      toast({ title: "Failed to load", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [supplierId, fromDate, toDate, sourceType, proformaId, toast]);

  const itemsWithQty = useMemo(
    () => computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0),
    [computedRows, qtyMap]
  );

  const handleCreateProforma = useCallback(() => {
    if (itemsWithQty.length === 0) {
      toast({ title: "Enter qty for at least one item", variant: "destructive" });
      return;
    }
    setShowConfirmModal(true);
  }, [itemsWithQty.length, toast]);

  const handleSaveProforma = useCallback(async () => {
    setIsSaving(true);
    try {
      const items = itemsWithQty.map((r) => ({
        barcode: r.code,
        code: r.code,
        name: r.name,
        itemName: r.name,
        qty: Number(qtyMap[r.stockItemId]) || 0,
        supplierPrice: Number(priceMap[r.stockItemId] ?? r.dubaiCost) || 0,
        weight: 0,
      }));

      const selectedSupplier = suppliers.find((s) => String(s.id) === supplierId);
      const res = await apiRequest("POST", "/api/supplier-profit-check/save-proforma", {
        supplierId: Number(supplierId),
        reference: proformaRef || undefined,
        notes: proformaNotes || undefined,
        items,
      });
      const data = await res.json();
      setSavedProforma({ id: data.id, reference: data.reference });
      setShowConfirmModal(false);
      toast({
        title: "Proforma saved",
        description: `Reference: ${data.reference}`,
      });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [itemsWithQty, qtyMap, priceMap, supplierId, proformaRef, proformaNotes, suppliers, toast]);

  const handleExportSupplier = useCallback(async () => {
    if (!savedProforma) return;
    try {
      const res = await fetch(
        `/api/supplier-profit-check/proforma/${savedProforma.id}/export-supplier`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proforma-${savedProforma.reference}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }, [savedProforma, toast]);

  const handleExportInternal = useCallback(async () => {
    try {
      const selectedSupplier = suppliers.find((s) => String(s.id) === supplierId);
      const exportRows = itemsWithQty.map((r) => ({
        ...r,
        qty: Number(qtyMap[r.stockItemId]) || 0,
        dubaiCost: Number(priceMap[r.stockItemId] ?? r.dubaiCost),
      }));
      const res = await fetch("/api/supplier-profit-check/export-internal", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: exportRows,
          supplierName: selectedSupplier?.legalName || selectedSupplier?.legal_name || "",
          fromDate,
          toDate,
          proformaRef: savedProforma?.reference || "",
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `profit-analysis-${savedProforma?.reference || "export"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }, [itemsWithQty, qtyMap, priceMap, supplierId, suppliers, fromDate, toDate, savedProforma, toast]);

  const selectedSupplierName = useMemo(() => {
    const s = suppliers.find((x) => String(x.id) === supplierId);
    return s?.legalName || s?.legal_name || "";
  }, [suppliers, supplierId]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-full p-4 space-y-4">
        {/* Page Title */}
        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6 text-amber-600" />
          <div>
            <h1 className="text-xl font-semibold">Supplier Profit Check</h1>
            <p className="text-sm text-muted-foreground">
              Analyze item profitability before ordering from a supplier
            </p>
          </div>
        </div>

        {/* Setup Panel */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Supplier
                </label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger data-testid="select-supplier">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.legalName || s.legal_name || s.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Sales Date Range
                </label>
                <div className="flex gap-1 items-center">
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    data-testid="input-from-date"
                  />
                  <span className="text-muted-foreground text-sm">–</span>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    data-testid="input-to-date"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Item Source
                </label>
                <Select
                  value={sourceType}
                  onValueChange={(v) => {
                    setSourceType(v as "all" | "proforma");
                    setProformaId("");
                  }}
                >
                  <SelectTrigger data-testid="select-source-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Supplier Items</SelectItem>
                    <SelectItem value="proforma">Existing Proforma</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sourceType === "proforma" ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Select Proforma
                  </label>
                  <Select value={proformaId} onValueChange={setProformaId}>
                    <SelectTrigger data-testid="select-proforma">
                      <SelectValue placeholder="Select proforma" />
                    </SelectTrigger>
                    <SelectContent>
                      {proformas.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.reference}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div />
              )}

              <div className="lg:col-span-4 flex justify-end">
                <Button
                  onClick={handleLoad}
                  disabled={isLoading || !supplierId}
                  data-testid="button-load-items"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {isLoading ? "Loading..." : "Load Items"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {loaded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Selected Items</div>
                <div className="text-2xl font-bold">{summary.selectedCount}</div>
                <div className="text-xs text-muted-foreground">of {summary.totalItems} total</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Total Qty</div>
                <div className="text-2xl font-bold">{summary.totalQty.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Total Supplier Cost</div>
                <div className="text-2xl font-bold">${fmt(summary.totalSupCost)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Est. Profit</div>
                <div
                  className={`text-2xl font-bold ${
                    summary.totalEstProfit >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  ${fmt(summary.totalEstProfit)}
                </div>
                {summary.avgProfitPct != null && (
                  <div className="text-xs text-muted-foreground">{fmt(summary.avgProfitPct)}% avg</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Issues</div>
                <div className="space-y-0.5">
                  <div className="text-sm">
                    <span className="text-red-600 font-semibold">{summary.losingCount}</span>
                    <span className="text-muted-foreground"> losing</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-amber-600 font-semibold">{summary.noDataCount}</span>
                    <span className="text-muted-foreground"> no sales data</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-orange-600 font-semibold">{summary.missingOffloadCount}</span>
                    <span className="text-muted-foreground"> missing offload</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* After save: proforma reference + export buttons */}
        {savedProforma && (
          <Card className="border-green-500 bg-green-50 dark:bg-green-900/10">
            <CardContent className="pt-3 pb-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <span className="font-semibold text-green-800 dark:text-green-300">
                      Proforma saved:
                    </span>{" "}
                    <span className="font-mono text-green-700 dark:text-green-400">
                      {savedProforma.reference}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={handleExportSupplier}
                    data-testid="button-export-supplier"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Supplier Excel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleExportInternal}
                    data-testid="button-export-internal"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Analysis Excel
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filter Bar + Actions */}
        {loaded && (
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search code / name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-48"
                  data-testid="input-search"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="gaining">Gaining</SelectItem>
                  <SelectItem value="losing">Losing</SelectItem>
                  <SelectItem value="break_even">Break Even</SelectItem>
                  <SelectItem value="no_sales_data">No Sales Data</SelectItem>
                  <SelectItem value="missing_offload">Missing Offload</SelectItem>
                </SelectContent>
              </Select>

              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-36" data-testid="select-group-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant={qtyEnteredOnly ? "default" : "outline"}
                onClick={() => setQtyEnteredOnly((v) => !v)}
                data-testid="button-qty-filter"
              >
                Qty Entered Only
              </Button>

              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Min Profit%</span>
                <Input
                  type="number"
                  placeholder="0"
                  value={minProfitPct}
                  onChange={(e) => setMinProfitPct(e.target.value)}
                  className="w-20"
                  data-testid="input-min-profit"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {!savedProforma && (
                <Button
                  onClick={handleCreateProforma}
                  disabled={itemsWithQty.length === 0}
                  data-testid="button-create-proforma"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Create Proforma ({itemsWithQty.length})
                </Button>
              )}
              {savedProforma && (
                <>
                  <Button variant="outline" onClick={handleExportSupplier} data-testid="button-export-supplier-bar">
                    <Download className="w-4 h-4 mr-2" />
                    Supplier Excel
                  </Button>
                  <Button variant="outline" onClick={handleExportInternal} data-testid="button-export-internal-bar">
                    <FileText className="w-4 h-4 mr-2" />
                    Analysis Excel
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Data Table */}
        {loaded && (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="min-w-[100px]">Code</TableHead>
                  <TableHead className="min-w-[200px]">Name</TableHead>
                  <TableHead className="min-w-[120px]">Group</TableHead>
                  <TableHead className="text-right min-w-[90px]">Stock</TableHead>
                  <TableHead className="text-right min-w-[110px]">Avg Sell</TableHead>
                  <TableHead className="text-right min-w-[110px]">Dubai Cost</TableHead>
                  <TableHead className="text-right min-w-[100px]">Config</TableHead>
                  <TableHead className="text-right min-w-[110px]">Offload</TableHead>
                  <TableHead className="text-right min-w-[100px]">Total Cost</TableHead>
                  <TableHead className="text-right min-w-[110px]">Profit</TableHead>
                  <TableHead className="text-right min-w-[80px]">Prof%</TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="text-right min-w-[100px]">Qty to Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No items match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const isLosing = row.status === "losing";
                    const isNoData = row.status === "no_sales_data";
                    const isMissingOffload = row.offloadingSource === "missing";

                    return (
                      <TableRow
                        key={row.stockItemId}
                        className={
                          isLosing
                            ? "bg-red-50/60 dark:bg-red-900/10"
                            : isNoData
                            ? "bg-amber-50/60 dark:bg-amber-900/10"
                            : ""
                        }
                        data-testid={`row-item-${row.stockItemId}`}
                      >
                        <TableCell className="font-mono text-xs">{row.code}</TableCell>
                        <TableCell className="font-medium text-sm">{row.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.stockGroupName || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt(row.currentStock, 0)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {row.avgSellingPrice != null ? (
                            `$${fmt(row.avgSellingPrice)}`
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={priceMap[row.stockItemId] ?? String(row.dubaiCost)}
                            onChange={(e) =>
                              setPriceMap((prev) => ({
                                ...prev,
                                [row.stockItemId]: e.target.value,
                              }))
                            }
                            className="w-24 h-7 text-right text-sm ml-auto"
                            data-testid={`input-price-${row.stockItemId}`}
                          />
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          ${fmt(row.configPrice)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <div className="flex items-center justify-end gap-1">
                            <span>${fmt(row.offloadingCost)}</span>
                            {isMissingOffload && (
                              <AlertTriangle className="w-3 h-3 text-orange-500 shrink-0" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          ${fmt(row.totalCost)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {row.estimatedProfit != null ? (
                            <span
                              className={
                                row.estimatedProfit > 0
                                  ? "text-green-600"
                                  : row.estimatedProfit < 0
                                  ? "text-red-600"
                                  : ""
                              }
                            >
                              ${fmt(row.estimatedProfit)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {row.profitPercent != null ? (
                            <span
                              className={
                                row.profitPercent > 0
                                  ? "text-green-600"
                                  : row.profitPercent < 0
                                  ? "text-red-600"
                                  : ""
                              }
                            >
                              {fmt(row.profitPercent, 1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={qtyMap[row.stockItemId] ?? ""}
                            onChange={(e) =>
                              setQtyMap((prev) => ({
                                ...prev,
                                [row.stockItemId]: e.target.value,
                              }))
                            }
                            className="w-24 h-7 text-right ml-auto"
                            data-testid={`input-qty-${row.stockItemId}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Empty state before load */}
        {!loaded && !isLoading && (
          <Card>
            <CardContent className="py-16 text-center">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-muted-foreground">
                Select a supplier and date range, then click <strong>Load Items</strong> to start the analysis.
              </p>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-10 h-10 mx-auto mb-3 animate-spin opacity-40" />
              <p className="text-muted-foreground">Loading items and calculating profitability...</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="w-5 h-5" />
              Confirm Proforma Creation
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Items Selected", value: summary.selectedCount },
                { label: "Total Quantity", value: summary.totalQty.toLocaleString() },
                { label: "Total Supplier Value", value: `$${fmt(summary.totalSupCost)}` },
                { label: "Est. Total Profit", value: `$${fmt(summary.totalEstProfit)}`, colored: true },
                { label: "Losing Items", value: summary.losingCount, warn: summary.losingCount > 0 },
                { label: "No Sales Data", value: summary.noDataCount, warn: summary.noDataCount > 0 },
                { label: "Dubai Cost Updates", value: summary.dubaiUpdateCount, info: true },
              ].map((item) => (
                <div key={item.label} className="rounded-md border p-2 bg-muted/30">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div
                    className={`text-sm font-semibold ${
                      item.warn
                        ? "text-red-600"
                        : item.info
                        ? "text-amber-600"
                        : item.colored
                        ? summary.totalEstProfit >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : ""
                    }`}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {summary.losingCount > 0 && (
              <div className="flex gap-2 items-start rounded-md border border-red-200 bg-red-50 dark:bg-red-900/10 p-2 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{summary.losingCount} item(s) are currently losing. Review before confirming.</span>
              </div>
            )}

            {summary.dubaiUpdateCount > 0 && (
              <div className="flex gap-2 items-start rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/10 p-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {summary.dubaiUpdateCount} item(s) have a modified supplier price that will be saved as the new Dubai Cost in this proforma.
                </span>
              </div>
            )}

            {/* Proforma details */}
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Proforma Reference</label>
                <Input
                  placeholder="Auto-generated if blank"
                  value={proformaRef}
                  onChange={(e) => setProformaRef(e.target.value)}
                  data-testid="input-proforma-ref"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Input
                  placeholder="Any notes..."
                  value={proformaNotes}
                  onChange={(e) => setProformaNotes(e.target.value)}
                  data-testid="input-proforma-notes"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirmModal(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveProforma} disabled={isSaving} data-testid="button-confirm-save">
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isSaving ? "Saving..." : "Save Proforma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
