import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight, Download, Search, RotateCcw, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormat } from "@/contexts/DateFormatContext";
import type { Location } from "@shared/schema";

const STATUS_OPTIONS = [
  "PENDING_PRESSING","LABEL_PRINTED","PRESSED","FINALIZED","IN_STOCK",
  "RESERVED","RESERVED_FOR_ORDER","SOLD","REPACKED","REMOVED",
];

const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FINALIZED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SOLD: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  REMOVED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  RESERVED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  RESERVED_FOR_ORDER: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

interface GroupRow {
  stockEntryDate: string;
  erpLocationId: number | null;
  locationName: string;
  workerId: number | null;
  workerName: string | null;
  productId: number | null;
  productName: string | null;
  articleCode: string | null;
  baleCount: number;
  totalWeight: string;
  avgWeight: string;
  firstFinalizedAt: string | null;
  lastFinalizedAt: string | null;
  bales: BaleDetail[];
}

interface BaleDetail {
  id: number;
  referenceNumber: string;
  weightKg: string;
  status: string;
  finalizedAt: string | null;
  stockEntryDate: string;
  locationName: string;
  workerName: string | null;
  productName: string | null;
  articleCode: string | null;
}

export default function StockEntryHistory() {
  const { formatDisplayDate } = useDateFormat();
  const today = new Date().toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [workerIdFilter, setWorkerIdFilter] = useState("all");
  const [productIdFilter, setProductIdFilter] = useState("all");
  const [locationIdFilter, setLocationIdFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  params.set("startDate", fromDate);
  params.set("endDate", toDate);
  if (workerIdFilter !== "all") params.set("workerId", workerIdFilter);
  if (productIdFilter !== "all") params.set("productId", productIdFilter);
  if (locationIdFilter !== "all") params.set("locationId", locationIdFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (search.trim()) params.set("search", search.trim());
  if (!includeUnassigned) params.set("includeUnassigned", "false");

  const { data: groups = [], isLoading } = useQuery<GroupRow[]>({
    queryKey: ["/api/factory/bales/stock-entry-history", params.toString()],
    queryFn: () => fetch(`/api/factory/bales/stock-entry-history?${params.toString()}`).then(r => r.json()),
  });

  const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/factory/workers"] });
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["/api/factory/bale-products"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const totalBales = useMemo(() => groups.reduce((s, g) => s + g.baleCount, 0), [groups]);
  const totalWeight = useMemo(() => groups.reduce((s, g) => s + parseFloat(g.totalWeight || "0"), 0), [groups]);

  function groupKey(g: GroupRow) {
    return `${g.stockEntryDate}|${g.erpLocationId}|${g.workerId}|${g.productId}`;
  }

  function toggleExpand(key: string) {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function resetFilters() {
    setFromDate(today);
    setToDate(today);
    setWorkerIdFilter("all");
    setProductIdFilter("all");
    setLocationIdFilter("all");
    setStatusFilter("all");
    setSearch("");
    setIncludeUnassigned(true);
  }

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    const summaryRows = groups.map(g => ({
      "Stock Entry Date": g.stockEntryDate,
      "Location": g.locationName,
      "Worker": g.workerName || "Unassigned",
      "Product": g.productName || "—",
      "Article Code": g.articleCode || "—",
      "Bale Count": g.baleCount,
      "Total Weight (kg)": parseFloat(g.totalWeight || "0"),
      "Avg Weight (kg)": parseFloat(g.avgWeight || "0"),
      "First Bale Time": g.firstFinalizedAt ? new Date(g.firstFinalizedAt).toLocaleString() : "—",
      "Last Bale Time": g.lastFinalizedAt ? new Date(g.lastFinalizedAt).toLocaleString() : "—",
    }));
    const ws1 = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, "Summary");

    const detailRows = groups.flatMap(g =>
      g.bales.map(b => ({
        "Stock Entry Date": b.stockEntryDate,
        "Location": b.locationName,
        "Worker": b.workerName || "Unassigned",
        "Product": b.productName || "—",
        "Article Code": b.articleCode || "—",
        "Reference Number": b.referenceNumber,
        "Weight (kg)": parseFloat(b.weightKg || "0"),
        "Status": b.status,
        "Finalized At": b.finalizedAt ? new Date(b.finalizedAt).toLocaleString() : "—",
      }))
    );
    const ws2 = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Bale Details");

    XLSX.writeFile(wb, `stock-entry-history-${fromDate}-to-${toDate}.xlsx`);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Stock Entry History</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="w-4 h-4 text-muted-foreground cursor-default" />
            </TooltipTrigger>
            <TooltipContent>Worker assignment is locked for all stock-entry bales.</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-reset-filters">
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={groups.length === 0} data-testid="button-export-excel">
            <Download className="w-3 h-3 mr-1" /> Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From Date</Label>
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} data-testid="input-from-date" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To Date</Label>
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} data-testid="input-to-date" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Worker</Label>
          <Select value={workerIdFilter} onValueChange={setWorkerIdFilter}>
            <SelectTrigger data-testid="select-worker"><SelectValue placeholder="All workers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workers</SelectItem>
              {workers.map((w: any) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Product</Label>
          <Select value={productIdFilter} onValueChange={setProductIdFilter}>
            <SelectTrigger data-testid="select-product"><SelectValue placeholder="All products" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Products</SelectItem>
              {products.map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Location</Label>
          <Select value={locationIdFilter} onValueChange={setLocationIdFilter}>
            <SelectTrigger data-testid="select-location"><SelectValue placeholder="All locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((l: any) => (
                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger data-testid="select-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by reference number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-unassigned"
            checked={includeUnassigned}
            onCheckedChange={v => setIncludeUnassigned(!!v)}
            data-testid="checkbox-include-unassigned"
          />
          <Label htmlFor="include-unassigned" className="text-sm cursor-pointer">Include Unassigned</Label>
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span>{groups.length} group{groups.length !== 1 ? "s" : ""}</span>
        <span>{totalBales} bales</span>
        <span>{totalWeight.toFixed(2)} kg total</span>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 w-6"></th>
              <th className="px-3 py-2">Entry Date</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Worker</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-right">Bales</th>
              <th className="px-3 py-2 text-right">Total kg</th>
              <th className="px-3 py-2 text-right">Avg kg</th>
              <th className="px-3 py-2">First Bale</th>
              <th className="px-3 py-2">Last Bale</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
            )}
            {!isLoading && groups.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No stock entry records found for the selected filters.</td></tr>
            )}
            {groups.map(g => {
              const key = groupKey(g);
              const expanded = expandedKeys.has(key);
              return [
                <tr
                  key={key}
                  className="border-t hover-elevate cursor-pointer"
                  onClick={() => toggleExpand(key)}
                  data-testid={`row-group-${key}`}
                >
                  <td className="px-3 py-2 text-muted-foreground">
                    {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </td>
                  <td className="px-3 py-2 font-medium">{formatDisplayDate(g.stockEntryDate)}</td>
                  <td className="px-3 py-2">{g.locationName}</td>
                  <td className="px-3 py-2">
                    {g.workerName
                      ? g.workerName
                      : <span className="text-muted-foreground italic">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span>{g.productName || "—"}</span>
                    {g.articleCode && <span className="ml-1 text-xs text-muted-foreground">{g.articleCode}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{g.baleCount}</td>
                  <td className="px-3 py-2 text-right">{parseFloat(g.totalWeight || "0").toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{parseFloat(g.avgWeight || "0").toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(g.firstFinalizedAt)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtTime(g.lastFinalizedAt)}</td>
                </tr>,
                expanded && (
                  <tr key={key + "-detail"} className="bg-muted/20">
                    <td colSpan={10} className="px-6 py-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left pb-1 pr-4">Reference</th>
                            <th className="text-left pb-1 pr-4">Product</th>
                            <th className="text-left pb-1 pr-4">Worker</th>
                            <th className="text-right pb-1 pr-4">Weight (kg)</th>
                            <th className="text-left pb-1 pr-4">Status</th>
                            <th className="text-left pb-1 pr-4">Entry Date</th>
                            <th className="text-left pb-1 pr-4">Finalized At</th>
                            <th className="text-left pb-1">Location</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.bales.map(b => (
                            <tr key={b.id} className="border-t border-border/40" data-testid={`row-bale-${b.id}`}>
                              <td className="py-1 pr-4 font-mono">{b.referenceNumber}</td>
                              <td className="py-1 pr-4">{b.productName || "—"}</td>
                              <td className="py-1 pr-4">{b.workerName || <span className="italic text-muted-foreground">Unassigned</span>}</td>
                              <td className="py-1 pr-4 text-right">{parseFloat(b.weightKg || "0").toFixed(2)}</td>
                              <td className="py-1 pr-4">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[b.status] || "bg-muted text-muted-foreground"}`}>
                                  {b.status}
                                </span>
                              </td>
                              <td className="py-1 pr-4">{b.stockEntryDate ? formatDisplayDate(b.stockEntryDate) : "—"}</td>
                              <td className="py-1 pr-4">{b.finalizedAt ? new Date(b.finalizedAt).toLocaleString() : "—"}</td>
                              <td className="py-1">{b.locationName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
