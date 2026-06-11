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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Search, Download,
  FileText, CheckCircle, Package, Loader2, BarChart2, Save,
  Hash, ShoppingCart, Columns, RotateCcw, Truck, Filter, ChevronDown,
  CircleDollarSign, MapPin, Container,
} from "lucide-react";

// ─── Column definitions ───────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: "code",             label: "Code",               default: true  },
  { key: "name",             label: "Name",               default: true  },
  { key: "salesQty",         label: "Sales Qty",          default: true  },
  { key: "avgSell",          label: "Avg Sell",           default: true  },
  { key: "dubaiPrice",       label: "Dubai Price",        default: true  },
  { key: "extraPerBale",     label: "Extra / Bale",       default: true  },
  { key: "landingCost",      label: "Landing Cost",       default: true  },
  { key: "costProfit",       label: "Cost Profit",        default: true  },
  { key: "status",           label: "Status",             default: true  },
  { key: "qtyToOrder",       label: "Qty to Order",       default: true  },
  { key: "inventoryAvgCost", label: "Inventory Avg Cost", default: false },
  { key: "hassanPrice",      label: "Hassan Price",       default: false },
  { key: "hassanProfit",     label: "Hassan Profit",      default: false },
  { key: "currentStock",     label: "Current Stock",      default: false },
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

// ─── Status options ───────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "gaining",       label: "Gaining",          dot: "bg-emerald-500" },
  { value: "losing",        label: "Losing",           dot: "bg-red-500"     },
  { value: "break_even",    label: "Break Even",       dot: "bg-blue-500"    },
  { value: "no_sales_data", label: "No Data",          dot: "bg-amber-500"   },
  { value: "missing_po",    label: "Missing PO Price", dot: "bg-orange-500"  },
];

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
  groupSellingPrice: number | null;
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

interface OtwContainer {
  id: number;
  container_number: string;
  eta: string | null;
  status: string;
  items_total: string | null;
  item_name: string | null;
  loaded_items_count: string;
}

interface LocationGroup {
  id: number;
  name: string;
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
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function ProfitCell({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = value >= 0;
  return (
    <div className={`text-right font-semibold tabular-nums ${positive ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
      <div className="text-sm">{value < 0 ? "-" : ""}${fmt(Math.abs(value))}</div>
      {pct != null && <div className="text-[11px] font-normal opacity-70">{fmt(Math.abs(pct), 1)}%</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "gaining")
    return <Badge className="bg-emerald-500 text-white gap-1 font-medium"><TrendingUp className="w-3 h-3" />Gaining</Badge>;
  if (status === "losing")
    return <Badge className="bg-red-500 text-white gap-1 font-medium"><TrendingDown className="w-3 h-3" />Losing</Badge>;
  if (status === "break_even")
    return <Badge className="bg-blue-500 text-white gap-1 font-medium"><Minus className="w-3 h-3" />Break Even</Badge>;
  return <Badge className="bg-amber-500 text-white gap-1 font-medium"><AlertTriangle className="w-3 h-3" />No Data</Badge>;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, iconBg, label, value, sub, valueColor,
}: {
  icon: any; iconBg: string; label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3 flex items-center gap-3">
      <div className={`p-2.5 rounded-lg shrink-0 ${iconBg}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-xl font-bold leading-tight tabular-nums ${valueColor ?? ""}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SupplierProfitCheck() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const companyId = selectedCompany?.id;
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>({ fromDate: "", toDate: "", preset: "all_time" });
  const [sourceType, setSourceType] = useState<"all" | "proforma" | "otw_containers">("all");
  const [proformaId, setProformaId] = useState<string>("");
  const [otwContainerIds, setOtwContainerIds] = useState<number[]>([]);
  const [sellPriceSource, setSellPriceSource] = useState<"avg" | "location_group">("avg");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [manualPoPrices, setManualPoPrices] = useState<Record<number, string>>({});
  const [manualAvgPrices, setManualAvgPrices] = useState<Record<number, string>>({});
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const debounceAvgTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const [freight, setFreight] = useState("");
  const [duties, setDuties] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [surcharge, setSurcharge] = useState("");

  const [colVisibility, setColVisibility] = useState<ColVisibility>(loadColVisibility);
  const [showColPicker, setShowColPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const [qtyMap, setQtyMap] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [activeStatuses, setActiveStatuses] = useState<string[]>([]);

  const [savedProforma, setSavedProforma] = useState<{ id: number; reference: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [proformaRef, setProformaRef] = useState<string>("");
  const [proformaNotes, setProformaNotes] = useState<string>("");

  // Autosave
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [qtyVersion, setQtyVersion] = useState(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Queries ─────────────────────────────────────────────────────────────
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

  const linkStockGroupMutation = useMutation({
    mutationFn: async (stockGroupId: number | null) => {
      const res = await apiRequest("PATCH", `/api/suppliers/${supplierId}/stock-group`, { stockGroupId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers", companyId] });
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

  const { data: locationGroups = [] } = useQuery<LocationGroup[]>({
    queryKey: ["/api/supplier-profit-check/location-groups", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch("/api/supplier-profit-check/location-groups", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const { data: otwContainers = [], isLoading: isLoadingOtw } = useQuery<OtwContainer[]>({
    queryKey: ["/api/supplier-profit-check/otw-containers", supplierId],
    enabled: !!supplierId && sourceType === "otw_containers",
    queryFn: async () => {
      const res = await fetch(`/api/supplier-profit-check/otw-containers?supplierId=${supplierId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const queryEnabled = !!supplierId && (
    sourceType === "all" ||
    (sourceType === "proforma" && !!proformaId) ||
    (sourceType === "otw_containers" && otwContainerIds.length > 0)
  );
  const { data: rows = [], isLoading } = useQuery<AnalysisRow[]>({
    queryKey: ["/api/supplier-profit-check/analyze", supplierId, periodFilter.fromDate, periodFilter.toDate, sourceType, proformaId, otwContainerIds, sellPriceSource, selectedLocationId],
    enabled: queryEnabled,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/supplier-profit-check/analyze", {
        supplierId: Number(supplierId),
        fromDate: periodFilter.fromDate,
        toDate: periodFilter.toDate,
        sourceType,
        proformaId: proformaId ? Number(proformaId) : undefined,
        containerIds: sourceType === "otw_containers" ? otwContainerIds : undefined,
        sellPriceSource,
        locationId: sellPriceSource === "location_group" && selectedLocationId ? Number(selectedLocationId) : undefined,
      });
      return res.json();
    },
  });

  // ─── PO price overrides (persisted to DB) ─────────────────────────────────
  const { data: overridesData } = useQuery<{ stockItemId: number; poPrice: string }[]>({
    queryKey: ["/api/supplier-profit-check/po-overrides", supplierId],
    enabled: !!supplierId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/supplier-profit-check/po-overrides?supplierId=${supplierId}`);
      return res.json();
    },
  });

  useEffect(() => {
    const initPo: Record<number, string> = {};
    const initAvg: Record<number, string> = {};
    for (const o of (overridesData ?? [])) {
      if (o.poPrice != null) initPo[o.stockItemId] = String(parseFloat(parseFloat(String(o.poPrice)).toFixed(2)));
      if (o.avgPrice != null) initAvg[o.stockItemId] = String(parseFloat(parseFloat(String(o.avgPrice)).toFixed(2)));
    }
    setManualPoPrices(initPo);
    setManualAvgPrices(initAvg);
  }, [overridesData]);

  // Auto-select first location group when groups load and none is selected
  useEffect(() => {
    if (sellPriceSource === "location_group" && locationGroups.length > 0 && !selectedLocationId) {
      setSelectedLocationId(String(locationGroups[0].id));
    }
  }, [locationGroups, sellPriceSource]);

  const saveOverrideMutation = useMutation({
    mutationFn: async (payload: { supplierId: number; stockItemId: number; poPrice?: number; avgPrice?: number }) => {
      const res = await apiRequest("PUT", "/api/supplier-profit-check/po-overrides", payload);
      return res.json();
    },
  });

  const handleManualPoChange = useCallback((stockItemId: number, value: string) => {
    setManualPoPrices(prev => ({ ...prev, [stockItemId]: value }));
    clearTimeout(debounceTimers.current[stockItemId]);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0 && supplierId) {
      debounceTimers.current[stockItemId] = setTimeout(() => {
        saveOverrideMutation.mutate({ supplierId: Number(supplierId), stockItemId, poPrice: num });
      }, 800);
    }
  }, [supplierId, saveOverrideMutation]);

  const handleArrowNav = useCallback((e: React.KeyboardEvent<HTMLInputElement>, dataAttr: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`[${dataAttr}]`));
    const idx = inputs.indexOf(e.currentTarget);
    const target = e.key === "ArrowDown" ? inputs[idx + 1] : inputs[idx - 1];
    if (target) { target.focus(); target.select(); }
  }, []);

  const handleManualAvgChange = useCallback((stockItemId: number, value: string) => {
    setManualAvgPrices(prev => ({ ...prev, [stockItemId]: value }));
    clearTimeout(debounceAvgTimers.current[stockItemId]);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0 && supplierId) {
      debounceAvgTimers.current[stockItemId] = setTimeout(() => {
        saveOverrideMutation.mutate({ supplierId: Number(supplierId), stockItemId, avgPrice: num });
      }, 800);
    }
  }, [supplierId, saveOverrideMutation]);

  useEffect(() => {
    const initialQty: Record<number, string> = {};
    for (const r of rows) {
      if (r.proformaQty != null && r.proformaQty > 0) initialQty[r.stockItemId] = String(r.proformaQty);
    }
    setQtyMap(initialQty);
    setSavedProforma(null);
    setAutosaveStatus("idle");
    // Don't bump qtyVersion here — initialization should not trigger autosave
  }, [rows]);

  // ─── Autosave effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (qtyVersion === 0) return; // skip initial render / initialization
    const targetId = sourceType === "proforma" && proformaId
      ? Number(proformaId)
      : savedProforma?.id ?? null;
    if (!targetId) return; // no proforma to save to yet

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setAutosaveStatus("saving");

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const items = computedRows
          .filter((r) => Number(qtyMap[r.stockItemId]) > 0)
          .map((r) => ({
            barcode: r.code, code: r.code, name: r.name, itemName: r.name,
            qty: Number(qtyMap[r.stockItemId]) || 0,
            supplierPrice: r.poPrice ?? r.nCost, weight: 0,
          }));
        const res = await apiRequest("PUT", `/api/supplier-profit-check/proforma/${targetId}/update-items`, { items });
        if (!res.ok) throw new Error("Save failed");
        setAutosaveStatus("saved");
        setTimeout(() => setAutosaveStatus("idle"), 2500);
      } catch {
        setAutosaveStatus("error");
        setTimeout(() => setAutosaveStatus("idle"), 3000);
      }
    }, 1200);
  }, [qtyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = queryEnabled && !isLoading && rows.length >= 0;

  // ─── Charge math ─────────────────────────────────────────────────────────
  const totalBales = useMemo(() => {
    const fromProforma = rows.reduce((s, r) => s + (r.proformaQty ?? 0), 0);
    if (fromProforma > 0) return fromProforma;
    return Object.values(qtyMap).reduce((s, v) => s + (Number(v) || 0), 0);
  }, [rows, qtyMap]);

  const totalExtraCharges = (Number(freight) || 0) + (Number(duties) || 0) + (Number(otherCharges) || 0) + (Number(surcharge) || 0);
  const extraCostPerBale = totalBales > 0 ? totalExtraCharges / totalBales : 0;

  // ─── Computed rows ────────────────────────────────────────────────────────
  const computedRows = useMemo((): ComputedRow[] => {
    return rows.map((row) => {
      const manualPoNum = parseFloat(manualPoPrices[row.stockItemId] ?? "");
      const poP = (!isNaN(manualPoNum) && manualPoNum > 0) ? manualPoNum : row.poPrice;
      const manualAvgNum = parseFloat(manualAvgPrices[row.stockItemId] ?? "");
      // Use group price when source is location_group; otherwise use avg/manual
      let sell: number | null;
      if (sellPriceSource === "location_group") {
        sell = row.groupSellingPrice ?? null;
      } else {
        sell = (!isNaN(manualAvgNum) && manualAvgNum > 0) ? manualAvgNum : row.avgSellingPrice;
      }
      const landingCost = poP != null ? poP + extraCostPerBale : null;
      const costProfit = sell != null && landingCost != null ? sell - landingCost : null;
      const costProfitPct = costProfit != null && sell != null && sell > 0 ? (costProfit / sell) * 100 : null;
      let computedStatus: string;
      if (sell == null || poP == null) computedStatus = "no_sales_data";
      else if (costProfit! > 0) computedStatus = "gaining";
      else if (costProfit! < 0) computedStatus = "losing";
      else computedStatus = "break_even";
      const hassanProfit = row.configPrice - row.inventoryAvgCost;
      return { ...row, landingCost, costProfit, costProfitPct, computedStatus, hassanProfit };
    });
  }, [rows, extraCostPerBale, manualPoPrices, manualAvgPrices, sellPriceSource]);

  // ─── Multi-status filter ──────────────────────────────────────────────────
  const toggleStatus = useCallback((val: string) => {
    setActiveStatuses((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  }, []);

  const statusFilterLabel = useMemo(() => {
    if (activeStatuses.length === 0) return "All Statuses";
    if (activeStatuses.length === 1) return STATUS_OPTIONS.find((s) => s.value === activeStatuses[0])?.label ?? activeStatuses[0];
    return `${activeStatuses.length} statuses`;
  }, [activeStatuses]);

  // ─── Filtered rows ────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return computedRows.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        if (!r.code.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q)) return false;
      }
      if (activeStatuses.length > 0) {
        const matchesStatus = activeStatuses.includes(r.computedStatus);
        const matchesMissingPo = activeStatuses.includes("missing_po") && r.poPriceSource === "missing";
        if (!matchesStatus && !matchesMissingPo) return false;
      }
      return true;
    });
  }, [computedRows, search, activeStatuses]);

  // ─── Summary stats ────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const withQty = computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0);
    const totalQty = withQty.reduce((s, r) => s + (Number(qtyMap[r.stockItemId]) || 0), 0);
    const totalLandingCost = withQty.reduce((s, r) =>
      r.landingCost != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.landingCost : s, 0);
    // Use the active sell price source for totals
    const effectiveSellPrice = (r: ComputedRow) =>
      sellPriceSource === "location_group" ? r.groupSellingPrice : r.avgSellingPrice;
    const totalEstSales = withQty.reduce((s, r) => {
      const sp = effectiveSellPrice(r);
      return sp != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * sp : s;
    }, 0);
    const totalCostProfit = withQty.reduce((s, r) =>
      r.costProfit != null ? s + (Number(qtyMap[r.stockItemId]) || 0) * r.costProfit : s, 0);
    const costProfitPct = totalEstSales > 0 ? (totalCostProfit / totalEstSales) * 100 : null;
    const losingCount = computedRows.filter((r) => r.computedStatus === "losing").length;
    const noDataCount = computedRows.filter((r) => r.computedStatus === "no_sales_data").length;
    const missingPoCount = computedRows.filter((r) => r.poPriceSource === "missing").length;
    const noGroupPriceCount = sellPriceSource === "location_group"
      ? computedRows.filter((r) => r.groupSellingPrice == null).length
      : 0;
    return {
      totalItems: computedRows.length, selectedCount: withQty.length, totalQty,
      totalLandingCost, totalEstSales, totalCostProfit, costProfitPct,
      losingCount, noDataCount, missingPoCount, noGroupPriceCount,
    };
  }, [computedRows, qtyMap, sellPriceSource]);

  const itemsWithQty = useMemo(
    () => computedRows.filter((r) => Number(qtyMap[r.stockItemId]) > 0),
    [computedRows, qtyMap]
  );

  // ─── Column helpers ───────────────────────────────────────────────────────
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
        barcode: r.code, code: r.code, name: r.name, itemName: r.name,
        qty: Number(qtyMap[r.stockItemId]) || 0,
        supplierPrice: r.poPrice ?? r.nCost, weight: 0,
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
    } finally { setIsSaving(false); }
  }, [itemsWithQty, qtyMap, supplierId, proformaRef, proformaNotes, toast]);

  const handleExportSupplier = useCallback(async () => {
    if (!savedProforma) return;
    try {
      const res = await fetch(`/api/supplier-profit-check/proforma/${savedProforma.id}/export-supplier`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `proforma-${savedProforma.reference}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { toast({ title: "Export failed", description: err.message, variant: "destructive" }); }
  }, [savedProforma, toast]);

  const handleExportInternal = useCallback(async () => {
    try {
      const exportRows = itemsWithQty.map((r) => ({ ...r, qty: Number(qtyMap[r.stockItemId]) || 0 }));
      const res = await fetch("/api/supplier-profit-check/export-internal", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: exportRows,
          supplierName: selectedSupplier?.legalName || selectedSupplier?.legal_name || "",
          fromDate: periodFilter.fromDate, toDate: periodFilter.toDate,
          proformaRef: savedProforma?.reference || "",
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `profit-analysis-${savedProforma?.reference || "export"}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { toast({ title: "Export failed", description: err.message, variant: "destructive" }); }
  }, [itemsWithQty, qtyMap, selectedSupplier, periodFilter, savedProforma, toast]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-full p-4 space-y-3">

        {/* ── Header + Setup (unified card) ── */}
        <div className="rounded-xl border bg-card overflow-hidden">
          {/* Top strip: title + action */}
          <div className="flex items-center justify-between gap-4 px-5 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/25 to-amber-600/10 border border-amber-500/20 shrink-0">
                <BarChart2 className="w-4 h-4 text-amber-500" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold tracking-tight leading-tight">Supplier Profit Check</h1>
                <p className="text-[11px] text-muted-foreground">Analyze item profitability before ordering</p>
              </div>
            </div>
            {/* Autosave indicator */}
            {autosaveStatus !== "idle" && (
              <span className={`flex items-center gap-1.5 text-xs shrink-0 ${
                autosaveStatus === "saving" ? "text-muted-foreground" :
                autosaveStatus === "saved"  ? "text-emerald-500" :
                "text-destructive"
              }`}>
                {autosaveStatus === "saving" && <Loader2 className="w-3 h-3 animate-spin" />}
                {autosaveStatus === "saved"  && <CheckCircle className="w-3 h-3" />}
                {autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "saved" ? "Saved" : "Save failed"}
              </span>
            )}

            {loaded && !savedProforma && !(sourceType === "proforma" && proformaId) && (
              <Button
                onClick={() => {
                  if (itemsWithQty.length === 0) { toast({ title: "Enter qty for at least one item", variant: "destructive" }); return; }
                  setShowConfirmModal(true);
                }}
                disabled={itemsWithQty.length === 0}
                className="bg-amber-500 text-white shrink-0"
                data-testid="button-create-proforma"
              >
                <Save className="w-4 h-4 mr-2" />
                Create Proforma ({itemsWithQty.length})
              </Button>
            )}
            {loaded && savedProforma && (
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleExportSupplier} data-testid="button-export-supplier-bar">
                  <Download className="w-4 h-4 mr-1.5" /> Supplier Excel
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportInternal} data-testid="button-export-internal-bar">
                  <FileText className="w-4 h-4 mr-1.5" /> Analysis Excel
                </Button>
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="px-5 py-4 space-y-4">
            {/* Row 1: Supplier, Date, Item Source, Sell Price Source */}
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1.5 min-w-[180px] flex-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Supplier</label>
                <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); setOtwContainerIds([]); }}>
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

              <div className="space-y-1.5 shrink-0">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sales Date Range</label>
                <PeriodFilter value={periodFilter} onChange={setPeriodFilter} hideCustomInputs data-testid="period-filter-sales" />
              </div>

              <div className="space-y-1.5 min-w-[160px] shrink-0">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Item Source</label>
                <Select value={sourceType} onValueChange={(v) => { setSourceType(v as "all" | "proforma" | "otw_containers"); setProformaId(""); setOtwContainerIds([]); }}>
                  <SelectTrigger data-testid="select-source-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Supplier Items</SelectItem>
                    <SelectItem value="proforma">Existing Proforma</SelectItem>
                    <SelectItem value="otw_containers">Containers OTW</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sourceType === "proforma" && (
                <div className="space-y-1.5 min-w-[160px] shrink-0">
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
              )}

              {/* Sell Price Source */}
              <div className="space-y-1.5 min-w-[180px] shrink-0">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Sell Price Source
                </label>
                <Select value={sellPriceSource} onValueChange={(v) => {
                  setSellPriceSource(v as "avg" | "location_group");
                  if (v === "location_group" && locationGroups.length > 0) {
                    setSelectedLocationId(String(locationGroups[0].id));
                  } else {
                    setSelectedLocationId("");
                  }
                }}>
                  <SelectTrigger data-testid="select-sell-price-source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="avg">Average Sell Price</SelectItem>
                    <SelectItem value="location_group">Location Group Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {sellPriceSource === "location_group" && (
                <div className="space-y-1.5 min-w-[180px] shrink-0">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Location Group</label>
                  {locationGroups.length === 0 ? (
                    <div className="h-9 flex items-center px-3 rounded-md border text-xs text-muted-foreground">
                      No groups configured
                    </div>
                  ) : (
                    <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                      <SelectTrigger data-testid="select-location-group"><SelectValue placeholder="Select group…" /></SelectTrigger>
                      <SelectContent>
                        {locationGroups.map((lg) => (
                          <SelectItem key={lg.id} value={String(lg.id)}>{lg.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>

            {/* Row 2: OTW Containers picker (only when sourceType === 'otw_containers') */}
            {sourceType === "otw_containers" && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Container className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OTW Containers</span>
                  {otwContainerIds.length > 0 && (
                    <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0 h-4">{otwContainerIds.length} selected</Badge>
                  )}
                  {otwContainerIds.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2 ml-auto" onClick={() => setOtwContainerIds([])}>
                      Clear
                    </Button>
                  )}
                </div>
                {!supplierId ? (
                  <p className="text-xs text-muted-foreground italic">Select a supplier first to see OTW containers.</p>
                ) : isLoadingOtw ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Loading containers…</span>
                  </div>
                ) : otwContainers.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No OTW containers found for this supplier.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {otwContainers.map((c) => {
                      const selected = otwContainerIds.includes(c.id);
                      const itemCount = Number(c.loaded_items_count) || 0;
                      return (
                        <label
                          key={c.id}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer text-xs hover-elevate transition-colors ${selected ? "border-blue-500/60 bg-blue-500/10" : "bg-background"}`}
                          data-testid={`container-checkbox-${c.id}`}
                        >
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(chk) => {
                              setOtwContainerIds((prev) =>
                                chk ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                              );
                            }}
                          />
                          <div>
                            <div className="font-mono font-semibold">{c.container_number}</div>
                            <div className="text-muted-foreground text-[10px]">
                              {itemCount > 0 ? `${itemCount} items` : "No items loaded"}
                              {c.eta ? ` · ETA ${c.eta}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                {otwContainerIds.length === 0 && otwContainers.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Select at least one container to load items.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Landing Charges Strip ── */}
        {loaded && (
          <div className="rounded-xl border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-5">
              {/* Label */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="p-1.5 rounded-lg bg-amber-500/15">
                  <Truck className="w-3.5 h-3.5 text-amber-500" />
                </div>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Landing Charges</span>
              </div>

              {/* Inputs */}
              <div className="flex flex-wrap gap-3 flex-1">
                {[
                  { label: "Freight",        value: freight,       set: setFreight,       id: "input-freight"        },
                  { label: "Duties",         value: duties,        set: setDuties,        id: "input-duties"         },
                  { label: "Transportation", value: otherCharges,  set: setOtherCharges,  id: "input-other-charges"  },
                  { label: "Surcharge",      value: surcharge,     set: setSurcharge,     id: "input-surcharge"      },
                ].map(({ label, value, set, id }) => (
                  <div key={id} className="space-y-1 w-32">
                    <label className="text-[11px] text-muted-foreground font-medium">{label}</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">$</span>
                      <Input
                        type="number" min="0" placeholder="0"
                        value={value} onChange={(e) => set(e.target.value)}
                        className="h-8 pl-6 text-right font-mono"
                        data-testid={id}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Derived metric chips */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { label: "Total Extra",  value: `$${fmt(totalExtraCharges)}`, highlight: false },
                  { label: "Total Bales",  value: totalBales.toLocaleString(),   highlight: false },
                  { label: "Extra / Bale", value: `$${fmt(extraCostPerBale)}`,   highlight: true  },
                ].map(({ label, value, highlight }) => (
                  <div key={label} className={`rounded-lg px-3 py-1.5 text-center ${highlight ? "bg-amber-500/15 border border-amber-500/30" : "bg-background border"}`}>
                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</div>
                    <div className={`text-sm font-bold tabular-nums ${highlight ? "text-amber-500" : ""}`}>{value}</div>
                  </div>
                ))}
                {totalBales === 0 && (
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 gap-1">
                    <AlertTriangle className="w-3 h-3" /> Enter qty to see Extra/Bale
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Summary Cards ── */}
        {loaded && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <StatCard
              icon={Hash} iconBg="bg-blue-500/10 text-blue-500"
              label="Items" value={String(summary.selectedCount)}
              sub={`of ${summary.totalItems}`}
            />
            <StatCard
              icon={ShoppingCart} iconBg="bg-indigo-500/10 text-indigo-500"
              label="Total Qty" value={summary.totalQty.toLocaleString()}
            />
            <StatCard
              icon={CircleDollarSign} iconBg="bg-amber-500/10 text-amber-500"
              label="Total Landing Cost" value={`$${fmt(summary.totalLandingCost)}`}
            />
            <StatCard
              icon={TrendingUp}
              iconBg={summary.totalCostProfit >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}
              label="Cost Profit"
              value={`${summary.totalCostProfit < 0 ? "-" : ""}$${fmt(Math.abs(summary.totalCostProfit))}`}
              sub={summary.costProfitPct != null ? `${fmt(Math.abs(summary.costProfitPct), 1)}%` : undefined}
              valueColor={summary.totalCostProfit >= 0 ? "text-emerald-500" : "text-red-500"}
            />
            {/* Issues card */}
            <div className="rounded-xl border bg-card px-4 py-3">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Issues</div>
              <div className="space-y-1">
                {summary.losingCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    <span className="text-xs"><span className="font-bold text-red-500">{summary.losingCount}</span> <span className="text-muted-foreground">cost losing</span></span>
                  </div>
                )}
                {summary.noDataCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-xs"><span className="font-bold text-amber-500">{summary.noDataCount}</span> <span className="text-muted-foreground">no data</span></span>
                  </div>
                )}
                {summary.missingPoCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs"><span className="font-bold text-orange-500">{summary.missingPoCount}</span> <span className="text-muted-foreground">no PO price</span></span>
                  </div>
                )}
                {summary.noGroupPriceCount > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="text-xs"><span className="font-bold text-amber-500">{summary.noGroupPriceCount}</span> <span className="text-muted-foreground">no group price</span></span>
                  </div>
                )}
                {summary.losingCount === 0 && summary.noDataCount === 0 && summary.missingPoCount === 0 && summary.noGroupPriceCount === 0 && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs text-emerald-500 font-medium">All good</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Saved Proforma Banner ── */}
        {savedProforma && (
          <div className="flex flex-wrap items-center gap-3 justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium">Proforma saved:</span>
              <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">{savedProforma.reference}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleExportSupplier} data-testid="button-export-supplier">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Supplier Excel
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportInternal} data-testid="button-export-internal">
                <FileText className="w-3.5 h-3.5 mr-1.5" /> Analysis Excel
              </Button>
            </div>
          </div>
        )}

        {/* ── Filter Bar ── */}
        {loaded && (
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search code / name"
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-48 rounded-lg"
                data-testid="input-search"
              />
            </div>

            {/* Multi-select status filter */}
            <Popover open={showStatusPicker} onOpenChange={setShowStatusPicker}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`rounded-lg gap-1.5 ${activeStatuses.length > 0 ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400" : ""}`}
                  data-testid="button-status-filter"
                >
                  <Filter className="w-3.5 h-3.5" />
                  {statusFilterLabel}
                  {activeStatuses.length > 0 && (
                    <Badge className="bg-amber-500 text-white ml-1 px-1.5 py-0 h-4 text-[10px]">
                      {activeStatuses.length}
                    </Badge>
                  )}
                  <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filter by Status</span>
                  {activeStatuses.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-5 text-xs px-1.5" onClick={() => setActiveStatuses([])} data-testid="button-clear-status">
                      Clear
                    </Button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {STATUS_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover-elevate cursor-pointer" data-testid={`status-filter-${opt.value}`}>
                      <Checkbox
                        checked={activeStatuses.includes(opt.value)}
                        onCheckedChange={() => toggleStatus(opt.value)}
                      />
                      <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                      <span className="text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 pt-1.5 border-t">
                  <p className="text-[10px] text-muted-foreground px-1.5">Select multiple to combine filters</p>
                </div>
              </PopoverContent>
            </Popover>

            {/* Column picker */}
            <Popover open={showColPicker} onOpenChange={setShowColPicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="rounded-lg gap-1.5" data-testid="button-columns">
                  <Columns className="w-3.5 h-3.5" /> Columns
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Columns</span>
                  <Button variant="ghost" size="sm" className="h-5 text-xs px-1.5" onClick={resetCols} data-testid="button-reset-columns">
                    <RotateCcw className="w-3 h-3 mr-1" /> Reset
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {ALL_COLUMNS.map((col) => (
                    <label key={col.key} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-md hover-elevate cursor-pointer" data-testid={`col-toggle-${col.key}`}>
                      <Checkbox checked={colVisibility[col.key]} onCheckedChange={() => toggleCol(col.key)} />
                      <span className="text-sm">{col.label}</span>
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Result count */}
            {(search || activeStatuses.length > 0) && (
              <span className="text-xs text-muted-foreground">
                Showing {filteredRows.length} of {computedRows.length}
              </span>
            )}
          </div>
        )}

        {/* ── Data Table ── */}
        {loaded && (
          <div className="rounded-xl border overflow-hidden">
            <Table wrapperClassName="max-h-[calc(100vh-340px)]">
              <TableHeader className="sticky top-0 z-30">
                <TableRow className="bg-muted/60 border-b-2 hover:bg-muted/60">
                  {colVisibility.code           && <TableHead className="min-w-[90px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Code</TableHead>}
                  {colVisibility.name           && <TableHead className="min-w-[200px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Name</TableHead>}
                  {colVisibility.salesQty       && <TableHead className="text-right min-w-[80px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Sales Qty</TableHead>}
                  {colVisibility.avgSell        && <TableHead className="text-right min-w-[100px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{sellPriceSource === "location_group" ? "Group Sell" : "Avg Sell"}</TableHead>}
                  {colVisibility.dubaiPrice     && (
                    <TableHead className="text-right min-w-[110px] text-[11px] font-bold uppercase tracking-wide">
                      <span className="text-amber-500">Dubai Price</span>
                      <div className="font-normal text-muted-foreground normal-case text-[10px]">PO rate</div>
                    </TableHead>
                  )}
                  {colVisibility.extraPerBale   && (
                    <TableHead className="text-right min-w-[90px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Extra / Bale
                      <div className="font-normal normal-case text-[10px]">freight+duties</div>
                    </TableHead>
                  )}
                  {colVisibility.landingCost    && (
                    <TableHead className="text-right min-w-[110px] text-[11px] font-bold uppercase tracking-wide">
                      <span className="text-blue-500">Landing Cost</span>
                      <div className="font-normal text-muted-foreground normal-case text-[10px]">Dubai + Extra</div>
                    </TableHead>
                  )}
                  {colVisibility.costProfit     && (
                    <TableHead className="text-right min-w-[130px] text-[11px] font-bold uppercase tracking-wide">
                      <span className="text-emerald-500">Cost Profit</span>
                      <div className="font-normal text-muted-foreground normal-case text-[10px]">Sell − Landing</div>
                    </TableHead>
                  )}
                  {colVisibility.status         && <TableHead className="min-w-[100px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Status</TableHead>}
                  {colVisibility.qtyToOrder     && <TableHead className="text-right min-w-[100px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Qty to Order</TableHead>}
                  {colVisibility.inventoryAvgCost && <TableHead className="text-right min-w-[130px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Inv. Avg Cost</TableHead>}
                  {colVisibility.hassanPrice    && <TableHead className="text-right min-w-[110px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Hassan Price</TableHead>}
                  {colVisibility.hassanProfit   && <TableHead className="text-right min-w-[120px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Hassan Profit</TableHead>}
                  {colVisibility.currentStock   && <TableHead className="text-right min-w-[100px] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Stock</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColCount} className="text-center py-16 text-muted-foreground">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No items match your filters</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row, idx) => {
                    const isLosing = row.computedStatus === "losing";
                    const isNoData = row.computedStatus === "no_sales_data";
                    const isNoGroupPrice = sellPriceSource === "location_group" && row.groupSellingPrice == null;
                    const rowClass = [
                      isLosing  ? "border-l-2 border-l-red-500 bg-red-500/5"
                      : isNoGroupPrice ? "border-l-2 border-l-amber-400 bg-amber-500/5"
                      : isNoData ? "bg-amber-500/3"
                      : idx % 2 === 1 ? "bg-muted/20"
                      : "",
                      "hover:bg-muted/40 transition-colors",
                    ].join(" ");

                    return (
                      <TableRow key={row.stockItemId} className={rowClass} data-testid={`row-item-${row.stockItemId}`}>
                        {colVisibility.code && (
                          <TableCell className="font-mono text-xs text-muted-foreground py-2.5">{row.code}</TableCell>
                        )}
                        {colVisibility.name && (
                          <TableCell className="font-medium text-sm py-2.5">{row.name}</TableCell>
                        )}
                        {colVisibility.salesQty && (
                          <TableCell className="text-right font-mono text-sm py-2.5">
                            {row.salesQty > 0 ? row.salesQty.toLocaleString("en-US") : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                        )}
                        {colVisibility.avgSell && (
                          <TableCell className="text-right text-sm font-medium py-2.5">
                            {sellPriceSource === "location_group" ? (
                              <div className="text-right">
                                {row.groupSellingPrice != null ? (
                                  <span className="font-mono text-sm">${fmt(row.groupSellingPrice)}</span>
                                ) : (
                                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">No Price</span>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-0.5">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder={row.avgSellingPrice != null ? fmt(row.avgSellingPrice) : "—"}
                                  value={manualAvgPrices[row.stockItemId] ?? ""}
                                  onChange={(e) => handleManualAvgChange(row.stockItemId, e.target.value)}
                                  onKeyDown={(e) => handleArrowNav(e, "data-avg-input")}
                                  className="h-7 w-20 text-right text-xs px-1.5 font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  data-testid={`input-manual-avg-price-${row.stockItemId}`}
                                  data-avg-input="true"
                                />
                                {manualAvgPrices[row.stockItemId] && row.avgSellingPrice != null && (
                                  <span className="text-[10px] text-muted-foreground leading-tight">auto ${fmt(row.avgSellingPrice)}</span>
                                )}
                              </div>
                            )}
                          </TableCell>
                        )}
                        {colVisibility.dubaiPrice && (
                          <TableCell className="text-right text-sm py-2.5 bg-amber-500/5">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">$</span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder={row.poPrice != null ? fmt(row.poPrice) : "—"}
                                  value={manualPoPrices[row.stockItemId] ?? ""}
                                  onChange={(e) => handleManualPoChange(row.stockItemId, e.target.value)}
                                  onKeyDown={(e) => handleArrowNav(e, "data-po-input")}
                                  className="h-7 w-20 text-right text-xs px-1.5 font-mono border-amber-300 dark:border-amber-700 focus-visible:ring-amber-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  data-testid={`input-manual-po-price-${row.stockItemId}`}
                                  data-po-input="true"
                                />
                              </div>
                              {manualPoPrices[row.stockItemId] && row.poPrice != null && (
                                <span className="text-[10px] text-muted-foreground leading-tight">auto ${fmt(row.poPrice)}</span>
                              )}
                              {!manualPoPrices[row.stockItemId] && row.poPriceSource === "any_po_fallback" && (
                                <span className="text-[10px] text-amber-500/80 leading-tight">any supplier</span>
                              )}
                            </div>
                          </TableCell>
                        )}
                        {colVisibility.extraPerBale && (
                          <TableCell className="text-right text-sm py-2.5">
                            {extraCostPerBale > 0
                              ? <span className="font-mono text-amber-500">${fmt(extraCostPerBale)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                        )}
                        {colVisibility.landingCost && (
                          <TableCell className="text-right text-sm font-medium py-2.5 bg-blue-500/5">
                            {row.landingCost != null
                              ? <span className="text-blue-600 dark:text-blue-400 tabular-nums">${fmt(row.landingCost)}</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                        )}
                        {colVisibility.costProfit && (
                          <TableCell className="py-2.5">
                            <ProfitCell value={row.costProfit} pct={row.costProfitPct} />
                          </TableCell>
                        )}
                        {colVisibility.status && (
                          <TableCell className="py-2.5">
                            <StatusBadge status={row.computedStatus} />
                          </TableCell>
                        )}
                        {colVisibility.qtyToOrder && (
                          <TableCell className="py-2.5">
                            <Input
                              type="number" min="0" step="1" placeholder="0"
                              value={qtyMap[row.stockItemId] ?? ""}
                              onChange={(e) => {
                                setQtyMap((prev) => ({ ...prev, [row.stockItemId]: e.target.value }));
                                setQtyVersion((v) => v + 1);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                  e.preventDefault();
                                  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-qty-input]"));
                                  const idx2 = inputs.indexOf(e.currentTarget as HTMLInputElement);
                                  const target = e.key === "ArrowDown" ? inputs[idx2 + 1] : inputs[idx2 - 1];
                                  if (target) { target.focus(); target.select(); }
                                }
                              }}
                              className="w-24 h-7 text-right ml-auto font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              data-testid={`input-qty-${row.stockItemId}`}
                              data-qty-input="true"
                            />
                          </TableCell>
                        )}
                        {colVisibility.inventoryAvgCost && (
                          <TableCell className="text-right text-sm font-mono text-muted-foreground py-2.5">
                            ${fmt(row.inventoryAvgCost)}
                          </TableCell>
                        )}
                        {colVisibility.hassanPrice && (
                          <TableCell className="text-right text-sm font-mono py-2.5">
                            {row.configPrice > 0 ? `$${fmt(row.configPrice)}` : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                        )}
                        {colVisibility.hassanProfit && (
                          <TableCell className="py-2.5">
                            <ProfitCell value={row.hassanProfit} pct={row.configPrice > 0 ? (row.hassanProfit / row.configPrice) * 100 : null} />
                          </TableCell>
                        )}
                        {colVisibility.currentStock && (
                          <TableCell className="text-right text-sm font-mono text-muted-foreground py-2.5">
                            {row.currentStock > 0 ? row.currentStock.toLocaleString() : <span className="text-xs">—</span>}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* ── Empty states ── */}
        {!supplierId && (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="p-5 rounded-2xl bg-muted/60">
              <BarChart2 className="w-10 h-10 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="font-semibold text-base">Select a supplier to begin</p>
              <p className="text-sm text-muted-foreground mt-1">Choose a supplier from the panel above to load its items</p>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Calculating profitability…</p>
          </div>
        )}
      </div>

      {/* ── Confirm Proforma Modal ── */}
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
                { label: "Items Selected",    value: summary.selectedCount },
                { label: "Total Quantity",     value: summary.totalQty.toLocaleString() },
                { label: "Total Landing Cost", value: `$${fmt(summary.totalLandingCost)}` },
                { label: "Cost Profit",        value: `${summary.totalCostProfit < 0 ? "-" : ""}$${fmt(Math.abs(summary.totalCostProfit))}`, negative: summary.totalCostProfit < 0 },
                { label: "Losing Items",       value: summary.losingCount, warn: summary.losingCount > 0 },
                { label: "No PO Price",        value: summary.missingPoCount, warn: summary.missingPoCount > 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border p-2.5 bg-muted/30">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className={`text-sm font-semibold ${"warn" in item && item.warn ? "text-red-500" : "negative" in item && item.negative ? "text-red-500" : ""}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
            {summary.losingCount > 0 && (
              <div className="flex gap-2 items-start rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-sm text-red-600 dark:text-red-400">
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
