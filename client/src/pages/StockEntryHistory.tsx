import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { ChevronDown, ChevronRight, Download, Search, RotateCcw, Lock, Printer, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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

interface MatrixRow {
  productLabel: string;
  counts: Record<string, number>;
  total: number;
}

interface WorkerMatrix {
  workers: string[];
  rows: MatrixRow[];
  workerTotals: Record<string, number>;
  grandTotal: number;
}

function buildWorkerMatrix(filteredGroups: GroupRow[]): WorkerMatrix {
  const workerSet = new Set<string>();
  const productMap = new Map<string, Record<string, number>>();

  for (const g of filteredGroups) {
    for (const b of g.bales) {
      const productLabel = b.productName
        ? (b.articleCode ? `${b.productName} (${b.articleCode})` : b.productName)
        : "—";
      const workerKey = b.workerName || "Unassigned";

      workerSet.add(workerKey);

      if (!productMap.has(productLabel)) productMap.set(productLabel, {});
      const row = productMap.get(productLabel)!;
      row[workerKey] = (row[workerKey] || 0) + 1;
    }
  }

  const named: string[] = [];
  let hasUnassigned = false;
  for (const w of workerSet) {
    if (w === "Unassigned") hasUnassigned = true;
    else named.push(w);
  }
  named.sort((a, b) => a.localeCompare(b));
  const workers = hasUnassigned ? [...named, "Unassigned"] : named;

  const rows: MatrixRow[] = Array.from(productMap.entries())
    .map(([productLabel, counts]) => ({
      productLabel,
      counts,
      total: Object.values(counts).reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => a.productLabel.localeCompare(b.productLabel));

  const workerTotals: Record<string, number> = {};
  for (const w of workers) workerTotals[w] = 0;
  for (const row of rows) {
    for (const w of workers) {
      workerTotals[w] = (workerTotals[w] || 0) + (row.counts[w] || 0);
    }
  }

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return { workers, rows, workerTotals, grandTotal };
}

export default function StockEntryHistory() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [fromDate, setFromDate] = useState(thirtyDaysAgo);
  const [toDate, setToDate] = useState(today);
  const [categoryFilter, setCategoryFilter] = useState("all");
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

  const { data: rawGroups, isLoading } = useQuery<GroupRow[]>({
    queryKey: ["/api/factory/bales/stock-entry-history", params.toString()],
    queryFn: () => fetch(`/api/factory/bales/stock-entry-history?${params.toString()}`).then(r => r.json()),
  });
  const groups: GroupRow[] = Array.isArray(rawGroups) ? rawGroups : [];

  const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/factory/workers"] });
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["/api/factory/bale-products"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/worker-categories"],
    queryFn: () => fetch("/api/factory/worker-categories", { credentials: "include" }).then(r => r.json()),
  });

  const selectedCategoryWorkerIds: number[] | null = useMemo(() => {
    if (categoryFilter === "all") return null;
    const cat = categories.find((c: any) => String(c.id) === categoryFilter);
    if (!cat) return null;
    const ids = Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : [];
    return workers.filter((w: any) => w.active && ids.includes(w.id)).map((w: any) => w.id);
  }, [categoryFilter, categories, workers]);

  const filteredWorkers = useMemo(() => {
    if (!selectedCategoryWorkerIds) return workers;
    return workers.filter((w: any) => selectedCategoryWorkerIds.includes(w.id));
  }, [workers, selectedCategoryWorkerIds]);

  const filteredGroups = useMemo(() => {
    if (!selectedCategoryWorkerIds || workerIdFilter !== "all") return groups;
    return groups.filter((g) =>
      g.workerId !== null && selectedCategoryWorkerIds.includes(g.workerId)
    );
  }, [groups, selectedCategoryWorkerIds, workerIdFilter]);

  const totalBales = useMemo(() => filteredGroups.reduce((s, g) => s + g.baleCount, 0), [filteredGroups]);
  const totalWeight = useMemo(() => filteredGroups.reduce((s, g) => s + parseFloat(g.totalWeight || "0"), 0), [filteredGroups]);

  const bulkAssignMutation = useMutation({
    mutationFn: async ({ baleIds, workerId }: { baleIds: number[]; workerId: number }) => {
      const res = await apiRequest("PATCH", "/api/factory/bales/bulk-assign-worker", { baleIds, workerId });
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: "Worker assigned", description: `Worker updated for ${vars.baleIds.length} bale(s).` });
      qc.invalidateQueries({ queryKey: ["/api/factory/bales/stock-entry-history"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

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
    setFromDate(thirtyDaysAgo);
    setToDate(today);
    setCategoryFilter("all");
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

    const summaryRows = filteredGroups.map(g => ({
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

    const detailRows = filteredGroups.flatMap(g =>
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

    const matrix = buildWorkerMatrix(filteredGroups);
    const ws3 = XLSX.utils.aoa_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws3, [["Stock Entry History — Worker Matrix"]], { origin: "A1" });
    XLSX.utils.sheet_add_aoa(ws3, [[`Period: ${fromDate}  →  ${toDate}`]], { origin: "A2" });

    const matrixHeader = ["Bale / Product", ...matrix.workers, "Total"];
    XLSX.utils.sheet_add_aoa(ws3, [matrixHeader], { origin: "A4" });

    const matrixData = matrix.rows.map(row => [
      row.productLabel,
      ...matrix.workers.map(w => row.counts[w] || 0),
      row.total,
    ]);
    if (matrixData.length > 0) {
      XLSX.utils.sheet_add_aoa(ws3, matrixData, { origin: "A5" });
    }

    const totalsRow = ["TOTAL", ...matrix.workers.map(w => matrix.workerTotals[w] || 0), matrix.grandTotal];
    XLSX.utils.sheet_add_aoa(ws3, [totalsRow], { origin: { r: 4 + matrix.rows.length, c: 0 } });

    const colWidths = [{ wch: 36 }, ...matrix.workers.map(() => ({ wch: 14 })), { wch: 10 }];
    ws3["!cols"] = colWidths;
    ws3["!freeze"] = { xSplit: 0, ySplit: 4 };

    XLSX.utils.book_append_sheet(wb, ws3, "Worker Matrix");

    XLSX.writeFile(wb, `stock-entry-history-${fromDate}-to-${toDate}.xlsx`);
  }

  function handleExportPdf() {
    const pdfParams = new URLSearchParams(params);
    window.open(`/api/factory/bales/stock-entry-history/export-pdf?${pdfParams.toString()}`, "_blank");
  }

  function handlePrintMatrix() {
    if (filteredGroups.length === 0) return;
    const matrix = buildWorkerMatrix(filteredGroups);
    const { workers: cols, rows, workerTotals, grandTotal } = matrix;

    const numCols = cols.length + 2;
    const fontSize = numCols > 12 ? 7 : numCols > 8 ? 8.5 : 10;

    const headerCells = cols.map(w =>
      `<th class="wc">${w}</th>`
    ).join("");

    const dataRows = rows.map((row, idx) => {
      const cells = cols.map(w => {
        const v = row.counts[w] || 0;
        return `<td class="num">${v > 0 ? v : ""}</td>`;
      }).join("");
      return `<tr class="${idx % 2 === 1 ? "alt" : ""}">
        <td class="prod">${row.productLabel}</td>
        ${cells}
        <td class="num total-col">${row.total}</td>
      </tr>`;
    }).join("");

    const totalCells = cols.map(w =>
      `<td class="num">${workerTotals[w] || 0}</td>`
    ).join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Worker Matrix — ${fromDate} to ${toDate}</title>
  <style>
    @page { size: landscape; margin: 12mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: ${fontSize}px; color: #111; }

    .header { margin-bottom: 8px; }
    .header h1 { font-size: ${fontSize + 4}px; font-weight: 700; }
    .header .sub { font-size: ${fontSize}px; color: #444; margin-top: 2px; }
    .header .meta { font-size: ${fontSize - 1}px; color: #666; margin-top: 4px; font-weight: 600; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #ccc; padding: 3px 4px; overflow: hidden; }
    th { background: #1F3864; color: #fff; font-weight: 700; text-align: center; font-size: ${fontSize - 0.5}px; }
    th.prod-h { text-align: left; width: 22%; }
    th.wc { width: ${Math.floor(72 / Math.max(cols.length, 1))}%; }

    td.prod { text-align: left; font-weight: 500; word-break: break-word; }
    td.num { text-align: center; }
    td.total-col { font-weight: 700; background: #f0f4ff; }
    tr.alt td { background: #f8f8f8; }
    tr.alt td.total-col { background: #e8eeff; }

    tr.totals-row td { background: #1F3864 !important; color: #fff; font-weight: 700; border-color: #1a3060; }
    tr.totals-row td.num { text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Stock Entry History — Worker Matrix</h1>
    <div class="sub">Period: ${fromDate} &rarr; ${toDate}</div>
    <div class="meta">${cols.length} worker column${cols.length !== 1 ? "s" : ""}  &bull;  ${rows.length} product row${rows.length !== 1 ? "s" : ""}  &bull;  ${grandTotal} bales total</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="prod-h">Bale / Product</th>
        ${headerCells}
        <th class="wc">Total</th>
      </tr>
    </thead>
    <tbody>
      ${dataRows}
      <tr class="totals-row">
        <td class="prod">TOTAL</td>
        ${totalCells}
        <td class="num">${grandTotal}</td>
      </tr>
    </tbody>
  </table>
  <script>window.onload = function(){ window.print(); };<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    win.document.write(html);
    win.document.close();
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
            <TooltipContent>Worker assignment is locked once a worker has been set on a bale.</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-reset-filters">
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrintMatrix} disabled={filteredGroups.length === 0} data-testid="button-print-matrix">
            <Grid3X3 className="w-3 h-3 mr-1" /> Print Matrix
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={filteredGroups.length === 0} data-testid="button-export-pdf">
            <Printer className="w-3 h-3 mr-1" /> Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filteredGroups.length === 0} data-testid="button-export-excel">
            <Download className="w-3 h-3 mr-1" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From Date</Label>
          <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} data-testid="input-from-date" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To Date</Label>
          <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} data-testid="input-to-date" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setWorkerIdFilter("all"); }}>
            <SelectTrigger data-testid="select-category"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Worker</Label>
          <Select value={workerIdFilter} onValueChange={setWorkerIdFilter}>
            <SelectTrigger data-testid="select-worker"><SelectValue placeholder="All workers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workers</SelectItem>
              {filteredWorkers.map((w: any) => (
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
        <span>{filteredGroups.length} group{filteredGroups.length !== 1 ? "s" : ""}</span>
        <span>{totalBales} bales</span>
        <span>{totalWeight.toFixed(2)} kg total</span>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/50">
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
            {!isLoading && filteredGroups.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No stock entry records found for the selected filters.</td></tr>
            )}
            {filteredGroups.map(g => {
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
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    {g.workerName ? (
                      <span>{g.workerName}</span>
                    ) : (
                      <Select
                        value=""
                        onValueChange={(v) => {
                          const baleIds = g.bales.map(b => b.id);
                          bulkAssignMutation.mutate({ baleIds, workerId: parseInt(v) });
                        }}
                      >
                        <SelectTrigger className="h-7 w-36 text-xs text-muted-foreground italic" data-testid={`select-assign-worker-${groupKey(g)}`}>
                          <SelectValue placeholder="Assign worker…" />
                        </SelectTrigger>
                        <SelectContent>
                          {workers.filter((w: any) => w.active).map((w: any) => (
                            <SelectItem key={w.id} value={String(w.id)}>
                              {w.fullName || w.full_name || w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
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
                        <thead className="sticky top-0 z-10 bg-muted/50">
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
