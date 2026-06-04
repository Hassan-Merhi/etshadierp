import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PeriodFilter, PeriodFilterValue } from "@/components/ui/period-filter";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Save,
  DollarSign,
  Hash,
  ShoppingCart,
  Columns,
  RotateCcw,
  Truck,
} from "lucide-react";

// ─── Column definitions ──────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: "code",             label: "Code",                 default: true  },
  { key: "name",             label: "Name",                 default: true  },
  { key: "salesQty",         label: "Sales Qty",            default: true  },
  { key: "avgSell",          label: "Avg Sell",             default: true  },
  { key: "dubaiPrice",       label: "Dubai Price",          default: true  },
  { key: "extraPerBale",     label: "Extra / Bale",         default: true  },
  { key: "landingCost",      label: "Landing Cost",         default: true  },
  { key: "costProfit",       label: "Cost Profit",          default: true  },
  { key: "status",           label: "Status",               default: true  },
  { key: "qtyToOrder",       label: "Qty to Order",         default: true  },
  { key: "inventoryAvgCost", label: "Inventory Avg Cost",   default: false },
  { key: "hassanPrice",      label: "Hassan Price",         default: false },
  { key: "hassanProfit",     label: "Hassan Profit",        default: false },
  { key: "currentStock",     label: "Current Stock",        default: false },
] as const;

type ColKey = typeof ALL_COLUMNS[number]["key"];
type ColVisibility = Record<ColKey, boolean>;

const DEFAULT_COL_VISIBILITY: ColVisibility = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c.key, c.default])
) as ColVisibility;

const STORAGE_KEY_COLS = "spc_col_visibility_v2";

function loadColVisibility(): ColVisibility {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COLS);
    if (saved) return { ...DEFAULT_COL_VISIBILITY, ...JSON.parse(saved) };
  } catch {}
  return { ...DEFAULT_COL_VISIBILITY };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface AnalysisRow {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  currentStock: number;
  salesQty: number;
  avgSellingPrice: number | null;
  poPrice: number | null;
  poPriceSource: string;
  inventoryAvgCost: number;
  nCost: number;
  configPrice: number;
  offloadingCost: number;
  profitPercent: number | null;
  status: string;
  proformaQty: number | null;
  proformaBarcode: string | null;
}

interface ComputedRow extends AnalysisRow {
  landingCost: number | null;
  costProfit: number | null;
  costProfitPct: number | null;
  computedStatus: string;
  hassanProfit: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// ─── Component ───────────────────────────────────────────────────────────────
export default function SupplierProfitCheck() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();

  // Setup state
  const [supplierId, setSupplierId] = useState<string>("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>({ fromDate: "", toDate: "", preset: "all_time" });
  const [sourceType, setSourceType] = useState<"all" | "proforma">("all");
  const [proformaId, setProformaId] = useState<string>("");

  // Landing charge inputs
  const [freight, setFreight] = useState("");
  const [duties, setDuties] = useState("");
  const [otherCharges, setOtherCharges] = useState("");

  // Column visibility
  const [colVisibility, setColVisibility] = useState<ColVisibility>(loadColVisibility);
  const [showColPicker, setShowColPicker] = useState(false);

  // Qty edit state
  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Proforma save state
  const [savedProforma, setSavedProforma] = useState<{ id: number; reference: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [proformaRef, setProformaRef] = useState<string>("");
  const [proformaNotes, setProformaNotes] = useState<string>("");

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch(`/api/suppliers?companyId=${companyId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const { data: stockGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-groups", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch(`/api/stock-groups?companyId=${companyId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const selectedSupplier = suppliers.find((s: any) => String(s.id) === supplierId);
  const linkedStockGroupId: number | null = selectedSupplier?.stockGroupId ?? selectedSupplier?.stock_group_id ?? null;

  const linkStockGroupMutation = useMutation({
    mutationFn: async (stockGroupId: number | null) => {
      const res = await apiRequest("PATCH", `/api/suppliers/${supplierId}/stock-group`, { stockGroupId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-profit-check/analyze"] });
      toast({ title: "Supplier stock group updated" });
    },
    onError: (err: any) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const { data: proformas = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers", supplierId, "proformas"],
    enabled: !!supplierId && sourceType === "proforma",
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${supplierId}/proformas`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const queryEnabled = !!supplierId && (sourceType !== "proforma" || !!proformaId);
  const { data: rows = [], isLoading } = useQuery<AnalysisRow[]>({
    queryKey: ["/api/supplier-profit-check/analyze", supplierId, periodFilter.fromDate, periodFilter.toDate, sourceType, proformaId],
    enabled: queryEnabled,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/supplier-profit-check/analyze", {
        supplierId: Number(supplierId),
        fromDate: periodFilter.fromDate,
        toDate: periodFilter.toDate,
        sourceType,
        proformaId: proformaId ? Number(proformaId) : undefined,
      });
      return res.json();
    },
  });

  useEffect(() => {
    const initialQty: Record<number, string> = {};
    for (const r of rows) {
      if (r.proformaQty != null && r.proformaQty > 0) {
        initialQty[r.stockItemId] = String(r.proformaQty);
      }
    }
    setQtyMap(initialQty);
    setSavedProforma(null);
  }, [rows]);

  const loaded = queryEnabled && !isLoading && rows.length >= 0;

  // ─── Charge calculations ──────────────────────────────────────────────────
  const totalBales = useMemo(() => {
    // Prefer proformaQty from data; fall back to qtyMap
    const fromProforma = rows.reduce((s, r) => s + (r.proformaQty ?? 0), 0);
    if (fromProforma > 0) return fromProforma;
    return Object.values(qtyMap).reduce((s, v) => s + (Number(v) || 0), 0);
  }, [rows, qtyMap]);

  const totalExtraCharges = (Number(freight) || 0) + (Number(duties) || 0) + (Number(otherCharges) || 0);
  const extraCostPerBale = totalBales > 0 ? totalExtraCharges / totalBales : 0;

  // ─── Computed rows ────────────────────────────────────────────────────────
  const computedRows = useMemo((): ComputedRow[] => {
    return rows.map((row) => {
      const sell = row.avgSellingPrice;
      const poP = row.poPrice;

      // Landing Cost = Dubai Price + Extra Per Bale
      const landingCost = poP != null ? poP + extraCostPerBale : null;

      // Cost Profit = Avg Sell − Landing Cost
      const costProfit = sell != null && landingCost != null ? sell - landingCost : null;
      const costProfitPct = costProfit != null && sell != null && sell > 0 ? (costProfit / sell) * 100 : null;

      // Status
      let computedStatus: string;
      if (sell == null || poP == null) computedStatus = "no_sales_data";
      else if (costProfit! > 0) computedStatus = "gaining";
      else if (costProfit! < 0) computedStatus = "losing";
      else computedStatus = "break_even";

      // Hassan's Profit = Hassan Price − Inventory Avg Cost
      const hassanProfit = row.configPrice - row.inventoryAvgCost;

      return {
        ...row,
        landingCost,
        costProfit,
        costProfitPct,
        computedStatus,
        hassanProfit,
      };
    });
  }, [rows, extraCostPerBale]);

  // ─── Filtered rows ────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return computedRows.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== "all") {
        if (statusFilter === "missing_po") {
          if (r.poPriceSource !== "missing") return false;
        } else {
          if (r.computedStatus !== statusFilter) return false;
        }
      }
      return true;
    });
  }, [computedRows, search, statusFilter]);

  // ─── Summary stats ────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const withQty = computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0);
    const totalQty = withQty.reduce((s, r) => s + (Number(qtyMap[r.stockItemId]) || 0), 0);

    // Landing cost total = sum(landingCost * qty)
    const totalLandingCost = withQty.reduce((s, r) => {
      return r.landingCost != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.landingCost : s;
    }, 0);
    const totalEstSales = withQty.reduce((s, r) => {
      return r.avgSellingPrice != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.avgSellingPrice : s;
    }, 0);
    const totalCostProfit = withQty.reduce((s, r) => {
      return r.costProfit != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.costProfit : s;
    }, 0);
    const costProfitPct = totalEstSales > 0 ? (totalCostProfit / totalEstSales) * 100 : null;

    const losingCount = computedRows.filter((r) => r.computedStatus === "losing").length;
    const noDataCount = computedRows.filter((r) => r.computedStatus === "no_sales_data").length;
    const missingPoCount = computedRows.filter((r) => r.poPriceSource === "missing").length;

    return {
      totalItems: computedRows.length,
      selectedCount: withQty.length,
      totalQty,
      totalLandingCost,
      totalEstSales,
      totalCostProfit,
      costProfitPct,
      losingCount,
      noDataCount,
      missingPoCount,
    };
  }, [computedRows, qtyMap]);

  const itemsWithQty = useMemo(
    () => computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0),
    [computedRows, qtyMap]
  );

  // ─── Column visibility helpers ────────────────────────────────────────────
  const toggleCol = useCallback((key: ColKey) => {
    setColVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetCols = useCallback(() => {
    setColVisibility({ ...DEFAULT_COL_VISIBILITY });
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(DEFAULT_COL_VISIBILITY));
  }, []);

  const visibleColCount = ALL_COLUMNS.filter((c) => colVisibility[c.key]).length;

  // ─── Actions ──────────────────────────────────────────────────────────────
  const handleSaveProforma = useCallback(async () => {
    setIsSaving(true);
    try {
      const items = itemsWithQty.map((r) => ({
        barcode: r.code,
        code: r.code,
        name: r.name,
        itemName: r.name,
        qty: Number(qtyMap[r.stockItemId]) || 0,
        supplierPrice: r.poPrice ?? r.nCost,
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
          fromDate: periodFilter.fromDate,
          toDate: periodFilter.toDate,
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
  }, [itemsWithQty, qtyMap, supplierId, suppliers, selectedSupplier, periodFilter, savedProforma, toast]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-full p-4 space-y-3">

        {/* Page Header */}
        <div className="flex items-center justify-between gap-3 pb-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-amber-500/10">
              <BarChart2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Supplier Profit Check</h1>
              <p className="text-xs text-muted-foreground">Analyze item profitability before ordering</p>
            </div>
          </div>
        </div>

        {/* Setup Panel */}
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Supplier</label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger data-testid="select-supplier">
                    <SelectValue placeholder="Select supplier…" />
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
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sales Date Range</label>
                <PeriodFilter value={periodFilter} onChange={setPeriodFilter} hideCustomInputs data-testid="period-filter-sales" />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Item Source</label>
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
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Select Proforma</label>
                  <Select value={proformaId} onValueChange={setProformaId}>
                    <SelectTrigger data-testid="select-proforma"><SelectValue placeholder="Select proforma…" /></SelectTrigger>
                    <SelectContent>
                      {proformas.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.reference}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : <div />}
            </div>
          </CardContent>
        </Card>

        {/* Landing Charges Card */}
        {loaded && (
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex items-center gap-2 shrink-0">
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Landing Charges</span>
                </div>
                <div className="flex flex-wrap gap-3 flex-1">
                  <div className="space-y-1 w-32">
                    <label className="text-[11px] text-muted-foreground">Freight</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={freight}
                      onChange={(e) => setFreight(e.target.value)}
                      className="h-8 text-right"
                      data-testid="input-freight"
                    />
                  </div>
                  <div className="space-y-1 w-32">
                    <label className="text-[11px] text-muted-foreground">Duties</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={duties}
                      onChange={(e) => setDuties(e.target.value)}
                      className="h-8 text-right"
                      data-testid="input-duties"
                    />
                  </div>
                  <div className="space-y-1 w-32">
                    <label className="text-[11px] text-muted-foreground">Other Charges</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={otherCharges}
                      onChange={(e) => setOtherCharges(e.target.value)}
                      className="h-8 text-right"
                      data-testid="input-other-charges"
                    />
                  </div>
                </div>
                {/* Derived values */}
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="space-y-0.5">
                    <div className="text-[11px] text-muted-foreground">Total Extra</div>
                    <div className="font-semibold">${fmt(totalExtraCharges)}</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[11px] text-muted-foreground">Total Bales</div>
                    <div className="font-semibold">
                      {totalBales.toLocaleString()}
                      {totalBales === 0 && <span className="text-amber-500 text-xs ml-1">(enter qty)</span>}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[11px] text-muted-foreground">Extra / Bale</div>
                    <div className={`font-semibold ${extraCostPerBale > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      ${fmt(extraCostPerBale)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats Row */}
        {loaded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="rounded-md border bg-card px-3 py-2.5 flex items-start gap-2.5">
              <div className="mt-0.5 p-1.5 rounded-md bg-muted shrink-0">
                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">Items</div>
                <div className="text-xl font-bold leading-tight">{summary.selectedCount}</div>
                <div className="text-[11px] text-muted-foreground">of {summary.totalItems}</div>
              </div>
            </div>

            <div className="rounded-md border bg-card px-3 py-2.5 flex items-start gap-2.5">
              <div className="mt-0.5 p-1.5 rounded-md bg-muted shrink-0">
                <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">Total Qty</div>
                <div className="text-xl font-bold leading-tight">{summary.totalQty.toLocaleString()}</div>
              </div>
            </div>

            <div className="rounded-md border bg-card px-3 py-2.5 flex items-start gap-2.5">
              <div className="mt-0.5 p-1.5 rounded-md bg-muted shrink-0">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">Total Avg Cost</div>
                <div className="text-base font-bold leading-tight">${fmt(summary.totalLandingCost)}</div>
              </div>
            </div>

            <div className="rounded-md border bg-card px-3 py-2.5 flex items-start gap-2.5">
              <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${summary.totalCostProfit >= 0 ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                <TrendingUp className={`w-3.5 h-3.5 ${summary.totalCostProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`} />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">Cost Profit</div>
                <div className={`text-base font-bold leading-tight ${summary.totalCostProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"}`}>
                  {summary.totalCostProfit < 0 ? "-" : ""}${fmt(Math.abs(summary.totalCostProfit))}
                </div>
                {summary.costProfitPct != null && (
                  <div className="text-[11px] text-muted-foreground">{fmt(Math.abs(summary.costProfitPct), 1)}%</div>
                )}
              </div>
            </div>

            <div className="rounded-md border bg-card px-3 py-2.5 flex items-start gap-2.5">
              <div className="mt-0.5 p-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="text-[11px] font-medium text-muted-foreground">Issues</div>
                <div className="text-[11px]">
                  <span className="font-semibold text-red-600">{summary.losingCount}</span>
                  <span className="text-muted-foreground ml-1">cost losing</span>
                </div>
                <div className="text-[11px]">
                  <span className="font-semibold text-amber-600">{summary.noDataCount}</span>
                  <span className="text-muted-foreground ml-1">no data</span>
                </div>
                {summary.missingPoCount > 0 && (
                  <div className="text-[11px]">
                    <span className="font-semibold text-orange-600">{summary.missingPoCount}</span>
                    <span className="text-muted-foreground ml-1">no PO price</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Saved Proforma Banner */}
        {savedProforma && (
          <div className="flex flex-wrap items-center gap-3 justify-between rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Proforma saved:</span>
              <span className="font-mono text-sm text-emerald-700 dark:text-emerald-400">{savedProforma.reference}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleExportSupplier} data-testid="button-export-supplier">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Supplier Excel
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportInternal} data-testid="button-export-internal">
                <FileText className="w-3.5 h-3.5 mr-1.5" /> Analysis Excel
              </Button>
            </div>
          </div>
        )}

        {/* Filter Bar + Actions */}
        {loaded && (
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search code / name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-44"
                  data-testid="input-search"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="gaining">Gaining</SelectItem>
                  <SelectItem value="losing">Losing</SelectItem>
                  <SelectItem value="break_even">Break Even</SelectItem>
                  <SelectItem value="no_sales_data">No Data</SelectItem>
                  <SelectItem value="missing_po">Missing PO Price</SelectItem>
                </SelectContent>
              </Select>

              {/* Column picker */}
              <Popover open={showColPicker} onOpenChange={setShowColPicker}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-columns">
                    <Columns className="w-3.5 h-3.5 mr-1.5" />
                    Columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Show / Hide Columns</span>
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={resetCols} data-testid="button-reset-columns">
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {ALL_COLUMNS.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 px-1 py-1 rounded hover-elevate cursor-pointer"
                        data-testid={`col-toggle-${col.key}`}
                      >
                        <Checkbox
                          checked={colVisibility[col.key]}
                          onCheckedChange={() => toggleCol(col.key)}
                        />
                        <span className="text-sm">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
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
          <Table wrapperClassName="max-h-[calc(100vh-320px)]">
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow className="border-b-2">
                {colVisibility.code           && <TableHead className="min-w-[90px] text-xs font-semibold">Code</TableHead>}
                {colVisibility.name           && <TableHead className="min-w-[200px] text-xs font-semibold">Name</TableHead>}
                {colVisibility.salesQty       && <TableHead className="text-right min-w-[80px] text-xs font-semibold">Sales Qty</TableHead>}
                {colVisibility.avgSell        && <TableHead className="text-right min-w-[100px] text-xs font-semibold">Avg Sell</TableHead>}
                {colVisibility.dubaiPrice     && (
                  <TableHead className="text-right min-w-[110px] text-xs font-semibold">
                    <div>Dubai Price</div>
                    <div className="font-normal text-muted-foreground" style={{ fontSize: "10px" }}>PO rate</div>
                  </TableHead>
                )}
                {colVisibility.extraPerBale   && (
                  <TableHead className="text-right min-w-[90px] text-xs font-semibold">
                    <div>Extra / Bale</div>
                    <div className="font-normal text-muted-foreground" style={{ fontSize: "10px" }}>freight+duties</div>
                  </TableHead>
                )}
                {colVisibility.landingCost    && (
                  <TableHead className="text-right min-w-[110px] text-xs font-semibold">
                    <div>Landing Cost</div>
                    <div className="font-normal text-muted-foreground" style={{ fontSize: "10px" }}>Dubai + Extra</div>
                  </TableHead>
                )}
                {colVisibility.costProfit     && (
                  <TableHead className="text-right min-w-[130px] text-xs font-semibold">
                    <div className="text-emerald-600 dark:text-emerald-400">Cost Profit</div>
                    <div className="font-normal text-muted-foreground" style={{ fontSize: "10px" }}>Sell − Landing</div>
                  </TableHead>
                )}
                {colVisibility.status         && <TableHead className="min-w-[90px] text-xs font-semibold">Status</TableHead>}
                {colVisibility.qtyToOrder     && <TableHead className="text-right min-w-[100px] text-xs font-semibold">Qty to Order</TableHead>}
                {colVisibility.inventoryAvgCost && <TableHead className="text-right min-w-[130px] text-xs font-semibold">Inventory Avg Cost</TableHead>}
                {colVisibility.hassanPrice    && <TableHead className="text-right min-w-[110px] text-xs font-semibold">Hassan Price</TableHead>}
                {colVisibility.hassanProfit   && <TableHead className="text-right min-w-[120px] text-xs font-semibold">Hassan Profit</TableHead>}
                {colVisibility.currentStock   && <TableHead className="text-right min-w-[100px] text-xs font-semibold">Stock</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColCount} className="text-center py-12 text-muted-foreground">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No items match your filters</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => {
                  const rowBg =
                    row.computedStatus === "losing"
                      ? "bg-red-50/40 dark:bg-red-900/10"
                      : row.computedStatus === "no_sales_data"
                      ? "bg-amber-50/40 dark:bg-amber-900/10"
                      : "";

                  return (
                    <TableRow key={row.stockItemId} className={`${rowBg} hover:bg-muted/30`} data-testid={`row-item-${row.stockItemId}`}>
                      {colVisibility.code && (
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.code}</TableCell>
                      )}
                      {colVisibility.name && (
                        <TableCell className="font-medium text-sm">{row.name}</TableCell>
                      )}
                      {colVisibility.salesQty && (
                        <TableCell className="text-right font-mono text-sm">
                          {row.salesQty > 0
                            ? row.salesQty.toLocaleString("en-US")
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      )}
                      {colVisibility.avgSell && (
                        <TableCell className="text-right text-sm font-medium">
                          {row.avgSellingPrice != null
                            ? `$${fmt(row.avgSellingPrice)}`
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      )}
                      {colVisibility.dubaiPrice && (
                        <TableCell className="text-right text-sm">
                          {row.poPrice != null ? (
                            <div>
                              <span className="font-mono">${fmt(row.poPrice)}</span>
                              {row.poPriceSource === "any_po_fallback" && (
                                <div className="text-[10px] text-amber-500 leading-tight">any supplier</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-orange-500 text-xs">No PO price</span>
                          )}
                        </TableCell>
                      )}
                      {colVisibility.extraPerBale && (
                        <TableCell className="text-right text-sm">
                          {extraCostPerBale > 0
                            ? <span className="font-mono text-amber-600 dark:text-amber-400">${fmt(extraCostPerBale)}</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      )}
                      {colVisibility.landingCost && (
                        <TableCell className="text-right text-sm font-medium">
                          {row.landingCost != null
                            ? `$${fmt(row.landingCost)}`
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      )}
                      {colVisibility.costProfit && (
                        <TableCell>
                          <ProfitCell value={row.costProfit} pct={row.costProfitPct} />
                        </TableCell>
                      )}
                      {colVisibility.status && (
                        <TableCell>
                          <StatusBadge status={row.computedStatus} />
                        </TableCell>
                      )}
                      {colVisibility.qtyToOrder && (
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={qtyMap[row.stockItemId] ?? ""}
                            onChange={(e) => setQtyMap((prev) => ({ ...prev, [row.stockItemId]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                e.preventDefault();
                                const inputs = Array.from(
                                  document.querySelectorAll<HTMLInputElement>("[data-qty-input]")
                                );
                                const idx = inputs.indexOf(e.currentTarget as HTMLInputElement);
                                const target = e.key === "ArrowDown" ? inputs[idx + 1] : inputs[idx - 1];
                                if (target) { target.focus(); target.select(); }
                              }
                            }}
                            className="w-24 h-7 text-right ml-auto"
                            data-testid={`input-qty-${row.stockItemId}`}
                            data-qty-input="true"
                          />
                        </TableCell>
                      )}
                      {colVisibility.inventoryAvgCost && (
                        <TableCell className="text-right text-sm font-mono text-muted-foreground">
                          ${fmt(row.inventoryAvgCost)}
                        </TableCell>
                      )}
                      {colVisibility.hassanPrice && (
                        <TableCell className="text-right text-sm font-mono">
                          {row.configPrice > 0 ? `$${fmt(row.configPrice)}` : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      )}
                      {colVisibility.hassanProfit && (
                        <TableCell>
                          <ProfitCell value={row.hassanProfit} pct={row.configPrice > 0 ? (row.hassanProfit / row.configPrice) * 100 : null} />
                        </TableCell>
                      )}
                      {colVisibility.currentStock && (
                        <TableCell className="text-right text-sm font-mono text-muted-foreground">
                          {row.currentStock > 0 ? row.currentStock.toLocaleString() : <span className="text-xs">—</span>}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}

        {/* Empty states */}
        {!supplierId && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <div className="p-4 rounded-full bg-muted">
              <BarChart2 className="w-8 h-8 text-muted-foreground opacity-60" />
            </div>
            <div>
              <p className="font-medium text-sm">Select a supplier to begin</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose a supplier from the panel above to load its items</p>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Calculating profitability…</p>
          </div>
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
                { label: "Total Landing Cost", value: `$${fmt(summary.totalLandingCost)}` },
                { label: "Cost Profit", value: `${summary.totalCostProfit < 0 ? "-" : ""}$${fmt(Math.abs(summary.totalCostProfit))}`, negative: summary.totalCostProfit < 0 },
                { label: "Losing Items", value: summary.losingCount, warn: summary.losingCount > 0 },
                { label: "No PO Price", value: summary.missingPoCount, warn: summary.missingPoCount > 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-md border p-2 bg-muted/30">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className={`text-sm font-semibold ${"warn" in item && item.warn ? "text-red-600" : "negative" in item && item.negative ? "text-red-600" : ""}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {summary.losingCount > 0 && (
              <div className="flex gap-2 items-start rounded-md border border-red-200 bg-red-50 dark:bg-red-900/10 p-2 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{summary.losingCount} item(s) are cost-losing. Review before confirming.</span>
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
