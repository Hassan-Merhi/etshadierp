import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  salesQty: number;
  avgSellingPrice: number | null;
  nCost: number;
  nCostSource: string;
  configPrice: number;
  offloadingCost: number;
  totalCost: number;
  estimatedProfit: number | null;
  profitPercent: number | null;
  status: string;
  proformaQty: number | null;
  proformaBarcode: string | null;
}

interface ComputedRow extends AnalysisRow {
  hassansProfit: number;
  hassansProfitPct: number | null;
  costProfit: number | null;
  costProfitPct: number | null;
  statusByConfig: string;
  statusByOffload: string;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "-";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function ProfitCell({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = value >= 0;
  return (
    <div className={`text-right font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      <div>{value < 0 ? "-" : ""}${fmt(Math.abs(value))}</div>
      {pct != null && (
        <div className="text-xs font-normal opacity-75">{fmt(Math.abs(pct), 1)}%</div>
      )}
    </div>
  );
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

function calcStatus(profit: number | null): string {
  if (profit == null) return "no_sales_data";
  if (profit > 0) return "gaining";
  if (profit < 0) return "losing";
  return "break_even";
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

  // Qty edit state
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [qtyEnteredOnly, setQtyEnteredOnly] = useState(false);

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

  // Computed rows: two profit columns
  const computedRows = useMemo((): ComputedRow[] => {
    return rows.map((row) => {
      const sell = row.avgSellingPrice;

      // Hassan's Profit = Hassan's Price − Avg Cost
      const hassansProfit = row.configPrice - row.offloadingCost;
      const hassansProfitPct = row.configPrice > 0 ? (hassansProfit / row.configPrice) * 100 : null;

      // Cost Profit = Avg Sell − Avg Cost
      let costProfit: number | null = null;
      let costProfitPct: number | null = null;
      if (sell != null) {
        costProfit = sell - row.offloadingCost;
        costProfitPct = sell > 0 ? (costProfit / sell) * 100 : null;
      }

      return {
        ...row,
        hassansProfit,
        hassansProfitPct,
        costProfit,
        costProfitPct,
        statusByConfig: calcStatus(hassansProfit),
        statusByOffload: calcStatus(costProfit),
      };
    });
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return computedRows.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "missing_offload") {
          if (r.offloadingCost > 0) return false;
        } else {
          // filter by config status (primary profit)
          if (r.statusByConfig !== statusFilter) return false;
        }
      }
      if (qtyEnteredOnly && !(Number(qtyMap[r.stockItemId]) > 0)) return false;
      return true;
    });
  }, [computedRows, search, statusFilter, qtyEnteredOnly, qtyMap]);

  // Summary stats (based on items with qty entered)
  const summary = useMemo(() => {
    const withQty = computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0);
    const totalQty = withQty.reduce((s, r) => s + (Number(qtyMap[r.stockItemId]) || 0), 0);
    const totalAvgCost = withQty.reduce(
      (s, r) => s + (Number(qtyMap[r.stockItemId]) || 0) * r.offloadingCost,
      0
    );
    const totalEstSales = withQty.reduce((s, r) => {
      return r.avgSellingPrice != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.avgSellingPrice : s;
    }, 0);
    const totalHassansProfit = withQty.reduce((s, r) => {
      return s + (Number(qtyMap[r.stockItemId]) || 0) * r.hassansProfit;
    }, 0);
    const totalCostProfit = withQty.reduce((s, r) => {
      return r.costProfit != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.costProfit : s;
    }, 0);
    const hassansProfitPct = totalAvgCost > 0 ? (totalHassansProfit / totalAvgCost) * 100 : null;
    const costProfitPct = totalEstSales > 0 ? (totalCostProfit / totalEstSales) * 100 : null;

    const losingConfigCount = computedRows.filter((r) => r.statusByConfig === "losing").length;
    const losingOffloadCount = computedRows.filter((r) => r.statusByOffload === "losing").length;
    const noDataCount = computedRows.filter((r) => r.statusByConfig === "no_sales_data").length;
    const missingOffloadCount = computedRows.filter((r) => r.offloadingCost === 0).length;

    return {
      totalItems: computedRows.length,
      selectedCount: withQty.length,
      totalQty,
      totalAvgCost,
      totalEstSales,
      totalHassansProfit,
      totalCostProfit,
      hassansProfitPct,
      costProfitPct,
      losingConfigCount,
      losingOffloadCount,
      noDataCount,
      missingOffloadCount,
    };
  }, [computedRows, qtyMap]);

  const handleLoad = useCallback(async () => {
    if (!supplierId) { toast({ title: "Select a supplier", variant: "destructive" }); return; }
    if (!fromDate || !toDate) { toast({ title: "Select a date range", variant: "destructive" }); return; }
    if (sourceType === "proforma" && !proformaId) { toast({ title: "Select a proforma", variant: "destructive" }); return; }

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
      const initialQty: Record<number, string> = {};
      for (const r of analysisRows) {
        if (r.proformaQty != null && r.proformaQty > 0) {
          initialQty[r.stockItemId] = String(r.proformaQty);
        }
      }
      setQtyMap(initialQty);
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

  const handleSaveProforma = useCallback(async () => {
    setIsSaving(true);
    try {
      const items = itemsWithQty.map((r) => ({
        barcode: r.code,
        code: r.code,
        name: r.name,
        itemName: r.name,
        qty: Number(qtyMap[r.stockItemId]) || 0,
        supplierPrice: r.nCost,
        weight: 0,
      }));
      const res = await apiRequest("POST", "/api/supplier-profit-check/save-proforma", {
        supplierId: Number(supplierId),
        reference: proformaRef || undefined,
        notes: proformaNotes || undefined,
        items,
      });
      const data = await res.json();
      setSavedProforma({ id: data.id, reference: data.reference });
      setShowConfirmModal(false);
      toast({ title: "Proforma saved", description: `Reference: ${data.reference}` });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [itemsWithQty, qtyMap, supplierId, proformaRef, proformaNotes, toast]);

  const handleExportSupplier = useCallback(async () => {
    if (!savedProforma) return;
    try {
      const res = await fetch(`/api/supplier-profit-check/proforma/${savedProforma.id}/export-supplier`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `proforma-${savedProforma.reference}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }, [savedProforma, toast]);

  const handleExportInternal = useCallback(async () => {
    try {
      const selectedSupplier = suppliers.find((s: any) => String(s.id) === supplierId);
      const exportRows = itemsWithQty.map((r) => ({
        ...r,
        qty: Number(qtyMap[r.stockItemId]) || 0,
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
      a.href = url; a.download = `profit-analysis-${savedProforma?.reference || "export"}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    }
  }, [itemsWithQty, qtyMap, supplierId, suppliers, fromDate, toDate, savedProforma, toast]);

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
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supplier</label>
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
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sales Date Range</label>
                <div className="flex gap-1 items-center">
                  <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} data-testid="input-from-date" />
                  <span className="text-muted-foreground text-sm shrink-0">–</span>
                  <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} data-testid="input-to-date" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Item Source</label>
                <Select value={sourceType} onValueChange={(v) => { setSourceType(v as "all" | "proforma"); setProformaId(""); }}>
                  <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Supplier Items</SelectItem>
                    <SelectItem value="proforma">Existing Proforma</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sourceType === "proforma" ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Select Proforma</label>
                  <Select value={proformaId} onValueChange={setProformaId}>
                    <SelectTrigger data-testid="select-proforma"><SelectValue placeholder="Select proforma" /></SelectTrigger>
                    <SelectContent>
                      {proformas.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.reference}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : <div />}

              <div className="lg:col-span-4 flex justify-end">
                <Button onClick={handleLoad} disabled={isLoading || !supplierId} data-testid="button-load-items">
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {isLoading ? "Loading..." : "Load Items"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {loaded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Items</div>
                <div className="text-2xl font-bold">{summary.selectedCount}</div>
                <div className="text-xs text-muted-foreground">of {summary.totalItems}</div>
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
                <div className="text-xs text-muted-foreground">Total Avg Cost</div>
                <div className="text-lg font-bold">${fmt(summary.totalAvgCost)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Hassan's Profit</div>
                <div className={`text-lg font-bold ${summary.totalHassansProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {summary.totalHassansProfit < 0 ? "-" : ""}${fmt(Math.abs(summary.totalHassansProfit))}
                </div>
                {summary.hassansProfitPct != null && (
                  <div className="text-xs text-muted-foreground">{fmt(Math.abs(summary.hassansProfitPct), 1)}%</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Cost Profit</div>
                <div className={`text-lg font-bold ${summary.totalCostProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {summary.totalCostProfit < 0 ? "-" : ""}${fmt(Math.abs(summary.totalCostProfit))}
                </div>
                {summary.costProfitPct != null && (
                  <div className="text-xs text-muted-foreground">{fmt(Math.abs(summary.costProfitPct), 1)}%</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="text-xs text-muted-foreground">Issues</div>
                <div className="space-y-0.5 text-sm">
                  <div><span className="font-semibold text-red-600">{summary.losingConfigCount}</span> <span className="text-muted-foreground">losing (Hassan)</span></div>
                  <div><span className="font-semibold text-red-600">{summary.losingOffloadCount}</span> <span className="text-muted-foreground">losing (cost)</span></div>
                  <div><span className="font-semibold text-amber-600">{summary.noDataCount}</span> <span className="text-muted-foreground">no data</span></div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Saved proforma banner */}
        {savedProforma && (
          <Card className="border-green-500 bg-green-50 dark:bg-green-900/10">
            <CardContent className="pt-3 pb-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-800 dark:text-green-300">Proforma saved:</span>
                  <span className="font-mono text-green-700 dark:text-green-400">{savedProforma.reference}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={handleExportSupplier} data-testid="button-export-supplier">
                    <Download className="w-4 h-4 mr-2" /> Supplier Excel
                  </Button>
                  <Button variant="outline" onClick={handleExportInternal} data-testid="button-export-internal">
                    <FileText className="w-4 h-4 mr-2" /> Analysis Excel
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
                <SelectTrigger className="w-44" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="gaining">Gaining (Config)</SelectItem>
                  <SelectItem value="losing">Losing (Config)</SelectItem>
                  <SelectItem value="break_even">Break Even (Config)</SelectItem>
                  <SelectItem value="no_sales_data">No Sales Data</SelectItem>
                  <SelectItem value="missing_offload">Missing Offload Cost</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={qtyEnteredOnly ? "default" : "outline"}
                onClick={() => setQtyEnteredOnly((v) => !v)}
                data-testid="button-qty-filter"
              >
                Qty Entered Only
              </Button>
            </div>

            <div className="flex gap-2">
              {!savedProforma && (
                <Button
                  onClick={() => {
                    if (itemsWithQty.length === 0) { toast({ title: "Enter qty for at least one item", variant: "destructive" }); return; }
                    setShowConfirmModal(true);
                  }}
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
                    <Download className="w-4 h-4 mr-2" /> Supplier Excel
                  </Button>
                  <Button variant="outline" onClick={handleExportInternal} data-testid="button-export-internal-bar">
                    <FileText className="w-4 h-4 mr-2" /> Analysis Excel
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
              <TableHeader className="sticky top-0 z-20 bg-background">
                <TableRow className="bg-muted/50">
                  <TableHead className="min-w-[90px]">Code</TableHead>
                  <TableHead className="min-w-[200px]">Name</TableHead>
                  <TableHead className="text-right min-w-[90px]">Sales Qty</TableHead>
                  <TableHead className="text-right min-w-[110px]">Avg Sell</TableHead>
                  <TableHead className="text-right min-w-[110px]">Hassan's Price</TableHead>
                  <TableHead className="text-right min-w-[100px]">Avg Cost</TableHead>
                  {/* Hassan's Profit = Hassan's Price − Avg Cost */}
                  <TableHead className="text-right min-w-[130px] bg-blue-50/50 dark:bg-blue-900/10">
                    <div className="text-blue-700 dark:text-blue-400">Hassan's Profit</div>
                    <div className="text-[10px] font-normal text-muted-foreground">Hassan's Price − Avg Cost</div>
                  </TableHead>
                  {/* Cost Profit = Avg Sell − Avg Cost */}
                  <TableHead className="text-right min-w-[130px] bg-violet-50/50 dark:bg-violet-900/10">
                    <div className="text-violet-700 dark:text-violet-400">Cost Profit</div>
                    <div className="text-[10px] font-normal text-muted-foreground">Avg Sell − Avg Cost</div>
                  </TableHead>
                  <TableHead className="min-w-[90px]">Status</TableHead>
                  <TableHead className="text-right min-w-[100px]">Qty to Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      No items match your filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => {
                    const rowBg =
                      row.statusByConfig === "losing"
                        ? "bg-red-50/50 dark:bg-red-900/10"
                        : row.statusByConfig === "no_sales_data"
                        ? "bg-amber-50/50 dark:bg-amber-900/10"
                        : "";

                    return (
                      <TableRow key={row.stockItemId} className={rowBg} data-testid={`row-item-${row.stockItemId}`}>
                        <TableCell className="font-mono text-xs">{row.code}</TableCell>
                        <TableCell className="font-medium text-sm">{row.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {row.salesQty > 0
                            ? row.salesQty.toLocaleString("en-US")
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {row.avgSellingPrice != null ? `$${fmt(row.avgSellingPrice)}` : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        {/* Hassan's Price — from stock_items.selling_price */}
                        <TableCell className="text-right text-sm">
                          <span className={`font-mono ${row.configPrice === 0 ? "text-orange-500" : ""}`}>${fmt(row.configPrice)}</span>
                        </TableCell>
                        {/* Avg Cost — inventory avg or PO fallback */}
                        <TableCell className="text-right text-sm">
                          <span className={`font-mono ${row.nCostSource === "missing" ? "text-orange-500" : row.nCostSource === "po_fallback" ? "text-amber-600" : ""}`}>${fmt(row.offloadingCost)}</span>
                        </TableCell>
                        {/* Hassan's Profit */}
                        <TableCell className="bg-blue-50/30 dark:bg-blue-900/10">
                          <ProfitCell value={row.hassansProfit} pct={row.hassansProfitPct} />
                        </TableCell>
                        {/* Cost Profit */}
                        <TableCell className="bg-violet-50/30 dark:bg-violet-900/10">
                          <ProfitCell value={row.costProfit} pct={row.costProfitPct} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.statusByConfig} />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={qtyMap[row.stockItemId] ?? ""}
                            onChange={(e) => setQtyMap((prev) => ({ ...prev, [row.stockItemId]: e.target.value }))}
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

        {/* Empty states */}
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

      {/* Confirm Proforma Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="w-5 h-5" /> Confirm Proforma Creation
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Items Selected", value: summary.selectedCount },
                { label: "Total Quantity", value: summary.totalQty.toLocaleString() },
                { label: "Total Avg Cost", value: `$${fmt(summary.totalAvgCost)}` },
                { label: "Hassan's Profit", value: `${summary.totalHassansProfit < 0 ? "-" : ""}$${fmt(Math.abs(summary.totalHassansProfit))}`, negative: summary.totalHassansProfit < 0 },
                { label: "Cost Profit", value: `${summary.totalCostProfit < 0 ? "-" : ""}$${fmt(Math.abs(summary.totalCostProfit))}`, negative: summary.totalCostProfit < 0 },
                { label: "Losing Items (Hassan)", value: summary.losingConfigCount, warn: summary.losingConfigCount > 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-md border p-2 bg-muted/30">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className={`text-sm font-semibold ${"warn" in item && item.warn ? "text-red-600" : "negative" in item && item.negative ? "text-red-600" : ""}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {summary.losingConfigCount > 0 && (
              <div className="flex gap-2 items-start rounded-md border border-red-200 bg-red-50 dark:bg-red-900/10 p-2 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{summary.losingConfigCount} item(s) are losing on Config Profit. Review before confirming.</span>
              </div>
            )}

            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Proforma Reference</label>
                <Input placeholder="Auto-generated if blank" value={proformaRef} onChange={(e) => setProformaRef(e.target.value)} data-testid="input-proforma-ref" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Input placeholder="Any notes..." value={proformaNotes} onChange={(e) => setProformaNotes(e.target.value)} data-testid="input-proforma-notes" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirmModal(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSaveProforma} disabled={isSaving} data-testid="button-confirm-save">
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {isSaving ? "Saving..." : "Save Proforma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
