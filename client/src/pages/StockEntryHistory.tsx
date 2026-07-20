import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import * as XLSX from "@/lib/excelHelper";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Search,
  RotateCcw,
  List,
  AlignJustify,
  FileDown,
  MoreVertical,
  CalendarRange,
  MessageCircle,
  Loader2,
  History,
  Users,
  Package,
  MapPin,
  Tag,
  Layers,
} from "lucide-react";
import ProductionPlannerDialog from "./factory/ProductionPlannerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Location } from "@shared/schema";

const STATUS_OPTIONS = [
  "PENDING_PRESSING",
  "LABEL_PRINTED",
  "PRESSED",
  "FINALIZED",
  "IN_STOCK",
  "RESERVED",
  "RESERVED_FOR_ORDER",
  "SOLD",
  "REPACKED",
  "DISPATCHED",
  "DELETED",
];

const STATUS_COLORS: Record<string, string> = {
  IN_STOCK: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FINALIZED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SOLD: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  REMOVED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  DELETED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  DISPATCHED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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

interface StockEntryHistoryPage {
  items: GroupRow[];
  total: number;
  totalBales: number;
  totalWeight: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Fetches all pages of a stock-entry-history query using limit=250 per page.
 *  Safety cap: 100 pages. Use only for actions requiring every matching row
 *  (exports, bulk ops, print). Never use for the normal paginated screen list. */
async function fetchAllStockEntryHistoryPages(baseParams: URLSearchParams): Promise<GroupRow[]> {
  const p = new URLSearchParams(baseParams);
  p.set("page", "1");
  p.set("limit", "250");
  const r = await fetch(`/api/factory/bales/stock-entry-history?${p.toString()}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Stock entry history request failed: ${r.status}`);
  const firstData: StockEntryHistoryPage = await r.json();
  if (!Array.isArray(firstData.items)) {
    throw new Error("Invalid response from stock entry history endpoint");
  }
  const allItems: GroupRow[] = [...firstData.items];
  const totalPages = Math.min(firstData.totalPages, 100); // hard safety cap: 100 pages max
  // Fetch remaining pages with concurrency limit of 2
  for (let batchStart = 2; batchStart <= totalPages; batchStart += 2) {
    const pageNums = [batchStart, batchStart + 1].filter((n) => n <= totalPages);
    const results = await Promise.all(
      pageNums.map(async (pageNum) => {
        const pp = new URLSearchParams(baseParams);
        pp.set("page", String(pageNum));
        pp.set("limit", "250");
        const res = await fetch(`/api/factory/bales/stock-entry-history?${pp.toString()}`, { credentials: "include" });
        if (!res.ok) throw new Error(`Stock entry history page ${pageNum} failed: ${res.status}`);
        const data: StockEntryHistoryPage = await res.json();
        if (!Array.isArray(data.items)) throw new Error(`Invalid response for page ${pageNum}`);
        return data.items;
      })
    );
    for (const pageItems of results) allItems.push(...pageItems);
  }
  return allItems;
}

function buildWorkerMatrix(filteredGroups: GroupRow[]): WorkerMatrix {
  const workerSet = new Set<string>();
  const productMap = new Map<string, Record<string, number>>();

  for (const g of filteredGroups) {
    for (const b of g.bales) {
      const productLabel = b.productName
        ? b.articleCode
          ? `${b.productName} (${b.articleCode})`
          : b.productName
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

function formatDailyNum(val: number): string {
  if (val === 0) return "0";
  return val % 1 === 0 ? val.toFixed(0) : parseFloat(val.toFixed(3)).toString();
}

interface StockEntryHistoryProps {
  onActiveDateChange?: (date: string | null) => void;
}

export default function StockEntryHistory({ onActiveDateChange }: StockEntryHistoryProps = {}) {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString("en-CA");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA");

  // fromActive: send startDate; toActive: send endDate (activating To deactivates From)
  const [fromActive, setFromActive] = useState(true);
  const [toActive, setToActive] = useState(true);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  useEffect(() => {
    if (!onActiveDateChange) return;
    onActiveDateChange(fromActive ? fromDate : null);
  }, [fromActive, fromDate]);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [workerIdFilter, setWorkerIdFilter] = useState("all");
  const [productIdFilter, setProductIdFilter] = useState("all");
  const [locationIdFilter, setLocationIdFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"condensed" | "detailed">("condensed");

  // Condensed mode: use lite mode (no per-bale JSON_AGG) for a small initial payload (~95% smaller).
  // Detailed mode fetches the full response so the flat bale list is populated.
  const useLite = viewMode === "condensed";

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Reset to page 1 whenever any filter changes (but not on page/pageSize changes themselves).
  const filtersKey = useMemo(
    () =>
      [
        fromActive ? fromDate : "",
        toActive ? toDate : "",
        workerIdFilter,
        productIdFilter,
        locationIdFilter,
        categoryFilter,
        statusFilter,
        debouncedSearch,
        String(includeUnassigned),
        String(useLite),
      ].join("|"),
    [fromActive, fromDate, toActive, toDate, workerIdFilter, productIdFilter, locationIdFilter, categoryFilter, statusFilter, debouncedSearch, includeUnassigned, useLite]
  );
  useEffect(() => {
    setPage(1);
  }, [filtersKey]);

  const params = new URLSearchParams();
  if (fromActive) params.set("startDate", fromDate);
  if (toActive) params.set("endDate", toDate);
  if (workerIdFilter !== "all") params.set("workerId", workerIdFilter);
  if (productIdFilter !== "all") params.set("productId", productIdFilter);
  if (locationIdFilter !== "all") params.set("locationId", locationIdFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
  if (!includeUnassigned) params.set("includeUnassigned", "false");
  if (useLite) params.set("lite", "1");
  params.set("page", String(page));
  params.set("limit", String(pageSize));

  const { data: pagedGroups, isLoading } = useQuery<StockEntryHistoryPage>({
    queryKey: ["/api/factory/bales/stock-entry-history", params.toString(), page, pageSize],
    queryFn: async () => {
      const r = await fetch(`/api/factory/bales/stock-entry-history?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Stock entry history failed: ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data.items)) throw new Error("Invalid response: items is not an array");
      return data as StockEntryHistoryPage;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
  const groups: GroupRow[] = pagedGroups?.items ?? [];

  // If the current page becomes invalid after filters narrow the result set, move to the last valid page.
  useEffect(() => {
    const tp = pagedGroups?.totalPages;
    if (typeof tp === "number" && tp > 0 && page > tp) setPage(tp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagedGroups?.totalPages]);

  const { data: workers = [] } = useQuery<any[]>({ queryKey: ["/api/factory/workers"], staleTime: 60_000, refetchOnWindowFocus: false });
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["/api/factory/bale-products"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: categories = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/worker-categories"],
    queryFn: () => fetch("/api/factory/worker-categories", { credentials: "include" }).then((r) => r.json()),
  });

  // Fetch production plan targets when viewing a single day
  const planDate = fromActive && toActive && fromDate === toDate ? fromDate : null;
  const { data: workerTargets = {} } = useQuery<Record<number, { targetBales: number; workerCount: number }>>({
    queryKey: ["/api/factory/production-planner", planDate, "worker-targets"],
    queryFn: () =>
      fetch(`/api/factory/production-planner/${planDate}/worker-targets`, { credentials: "include" }).then((r) =>
        r.json()
      ),
    enabled: !!planDate,
  });

  // Per-group bale queries: lazily loaded only when a sub-group row is expanded in condensed mode.
  const expandedGroupBaleKeys = useMemo(
    () => Array.from(expandedKeys).filter((k) => k.endsWith("-bales")),
    [expandedKeys]
  );
  const groupBaleQueries = useQueries({
    queries: expandedGroupBaleKeys.map((key) => {
      const baseKey = key.replace(/-bales$/, "");
      const group = groups.find((g) => groupKey(g) === baseKey);
      if (!group)
        return { queryKey: ["noop", key], queryFn: () => [] as BaleDetail[], enabled: false };
      const gp = new URLSearchParams();
      gp.set("startDate", group.stockEntryDate);
      gp.set("endDate", group.stockEntryDate);
      if (group.workerId) gp.set("workerId", String(group.workerId));
      if (group.productId) gp.set("productId", String(group.productId));
      if (group.erpLocationId) gp.set("locationId", String(group.erpLocationId));
      return {
        queryKey: ["/api/factory/bales/stock-entry-history/group", gp.toString()],
        queryFn: (): Promise<BaleDetail[]> =>
          fetchAllStockEntryHistoryPages(gp).then((rows) => rows.flatMap((g) => g.bales ?? [])),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        enabled: useLite && !!group,
      };
    }),
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
    return groups.filter((g) => g.workerId !== null && selectedCategoryWorkerIds.includes(g.workerId));
  }, [groups, selectedCategoryWorkerIds, workerIdFilter]);

  const totalBales = useMemo(() => filteredGroups.reduce((s, g) => s + g.baleCount, 0), [filteredGroups]);
  const totalWeight = useMemo(
    () => filteredGroups.reduce((s, g) => s + parseFloat(g.totalWeight || "0"), 0),
    [filteredGroups]
  );

  // Condensed view: group by worker
  interface WorkerCondensed {
    workerKey: string;
    workerId: number | null;
    workerName: string | null;
    totalBales: number;
    totalWeight: number;
    groups: GroupRow[];
  }
  const workerGroups = useMemo<WorkerCondensed[]>(() => {
    const map = new Map<string, WorkerCondensed>();
    for (const g of filteredGroups) {
      const key = g.workerId != null ? String(g.workerId) : "unassigned";
      if (!map.has(key)) {
        map.set(key, {
          workerKey: key,
          workerId: g.workerId,
          workerName: g.workerName,
          totalBales: 0,
          totalWeight: 0,
          groups: [],
        });
      }
      const wg = map.get(key)!;
      wg.totalBales += g.baleCount;
      wg.totalWeight += parseFloat(g.totalWeight || "0");
      wg.groups.push(g);
    }
    // Add zero-bale entries for workers in the production plan who haven't made any bales yet
    if (Object.keys(workerTargets).length > 0) {
      const workerNameById = new Map<number, string>(
        (workers as any[]).map((w: any) => [w.id, w.fullName ?? w.full_name ?? ""])
      );
      for (const workerIdStr of Object.keys(workerTargets)) {
        const wid = Number(workerIdStr);
        const key = String(wid);
        if (!map.has(key)) {
          const name = workerNameById.get(wid) ?? null;
          map.set(key, { workerKey: key, workerId: wid, workerName: name, totalBales: 0, totalWeight: 0, groups: [] });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBales - a.totalBales);
  }, [filteredGroups, workerTargets, workers]);

  // Detailed view: flat list of all bales
  const allBales = useMemo(() => filteredGroups.flatMap((g) => g.bales), [filteredGroups]);

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

  const sendWorkerPdfWaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/bales/send-worker-pdf-whatsapp", {
        date: fromActive ? fromDate : today,
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Send failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent", description: "Worker PDF sent to production WhatsApp group." });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  function groupKey(g: GroupRow) {
    return `${g.stockEntryDate}|${g.erpLocationId}|${g.workerId}|${g.productId}`;
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /** Returns loaded bales for a group. In condensed (lite) mode, fetched lazily on expand. */
  function getGroupBales(g: GroupRow): BaleDetail[] {
    if (!useLite) return g.bales;
    const key = groupKey(g) + "-bales";
    const idx = expandedGroupBaleKeys.indexOf(key);
    if (idx < 0) return [];
    return groupBaleQueries[idx]?.data ?? [];
  }

  /**
   * Resolves the bale ids for a group for actions (like Reassign) that don't require the
   * row to already be expanded. In condensed (lite) mode, getGroupBales() only has data once
   * the user has expanded that specific group's bale-detail row — before that it returns []
   * (which used to send an empty baleIds array to the server and fail with "baleIds array is
   * required"). This fetches the group's bales on demand, reusing the same cache key/params
   * as the lazy per-group query so a later expand just reads the cache.
   */
  async function resolveGroupBaleIds(g: GroupRow): Promise<number[]> {
    const cached = getGroupBales(g);
    if (cached.length > 0) return cached.map((b) => b.id);
    if (!useLite) return g.bales.map((b) => b.id);

    const gp = new URLSearchParams();
    gp.set("startDate", g.stockEntryDate);
    gp.set("endDate", g.stockEntryDate);
    if (g.workerId) gp.set("workerId", String(g.workerId));
    if (g.productId) gp.set("productId", String(g.productId));
    if (g.erpLocationId) gp.set("locationId", String(g.erpLocationId));

    const rows = await qc.fetchQuery<GroupRow[]>({
      queryKey: ["/api/factory/bales/stock-entry-history/group", gp.toString()],
      queryFn: () => fetchAllStockEntryHistoryPages(gp),
      staleTime: 5 * 60 * 1000,
    });
    const bales = rows.flatMap((row) => row.bales ?? []);
    return bales.map((b) => b.id);
  }

  /** True while the per-group bale query is in-flight for an expanded group. */
  function isGroupBalesLoading(g: GroupRow): boolean {
    if (!useLite) return false;
    const key = groupKey(g) + "-bales";
    const idx = expandedGroupBaleKeys.indexOf(key);
    if (idx < 0) return false;
    return groupBaleQueries[idx]?.isLoading ?? false;
  }

  /** Fetches all matching group data (with bales) across all pages for exports and print. */
  async function fetchGroupsWithBales(): Promise<GroupRow[]> {
    const fullParams = new URLSearchParams(params);
    fullParams.delete("lite"); // ensure we get bale data
    fullParams.delete("page"); // fetchAllStockEntryHistoryPages manages its own pagination
    fullParams.delete("limit");
    return fetchAllStockEntryHistoryPages(fullParams);
  }

  function resetFilters() {
    setFromActive(false);
    setToActive(false);
    setFromDate(today);
    setToDate(today);
    setCategoryFilter("all");
    setWorkerIdFilter("all");
    setProductIdFilter("all");
    setLocationIdFilter("all");
    setStatusFilter("all");
    setSearch("");
    setIncludeUnassigned(true);
    setPage(1);
    setPageSize(100);
  }

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "—";
    }
  }

  async function exportExcel() {
    const wb = XLSX.utils.book_new();

    const summaryRows = filteredGroups.map((g) => ({
      "Stock Entry Date": g.stockEntryDate,
      Location: g.locationName,
      Worker: g.workerName || "Unassigned",
      Product: g.productName || "—",
      "Article Code": g.articleCode || "—",
      "Bale Count": g.baleCount,
      "Total Weight (kg)": parseFloat(g.totalWeight || "0"),
      "Avg Weight (kg)": parseFloat(g.avgWeight || "0"),
      "First Bale Time": g.firstFinalizedAt ? new Date(g.firstFinalizedAt).toLocaleString() : "—",
      "Last Bale Time": g.lastFinalizedAt ? new Date(g.lastFinalizedAt).toLocaleString() : "—",
    }));
    const ws1 = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, "Summary");

    // In lite mode, we need to fetch full bale data for the detail and matrix sheets.
    const groupsWithBales = await fetchGroupsWithBales();

    const detailRows = groupsWithBales.flatMap((g) =>
      g.bales.map((b) => ({
        "Stock Entry Date": b.stockEntryDate,
        Location: b.locationName,
        Worker: b.workerName || "Unassigned",
        Product: b.productName || "—",
        "Article Code": b.articleCode || "—",
        "Reference Number": b.referenceNumber,
        "Weight (kg)": parseFloat(b.weightKg || "0"),
        Status: b.status,
        "Finalized At": b.finalizedAt ? new Date(b.finalizedAt).toLocaleString() : "—",
      }))
    );
    const ws2 = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Bale Details");

    const matrix = buildWorkerMatrix(groupsWithBales);
    const ws3 = XLSX.utils.aoa_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws3, [["Stock Entry History — Worker Matrix"]], { origin: "A1" });
    XLSX.utils.sheet_add_aoa(ws3, [[`Period: ${fromDate}  →  ${toDate}`]], { origin: "A2" });

    const matrixHeader = ["Bale / Product", ...matrix.workers, "Total"];
    XLSX.utils.sheet_add_aoa(ws3, [matrixHeader], { origin: "A4" });

    const matrixData = matrix.rows.map((row) => [
      row.productLabel,
      ...matrix.workers.map((w) => row.counts[w] || 0),
      row.total,
    ]);
    if (matrixData.length > 0) {
      XLSX.utils.sheet_add_aoa(ws3, matrixData, { origin: "A5" });
    }

    const totalsRow = ["TOTAL", ...matrix.workers.map((w) => matrix.workerTotals[w] || 0), matrix.grandTotal];
    XLSX.utils.sheet_add_aoa(ws3, [totalsRow], { origin: { r: 4 + matrix.rows.length, c: 0 } });

    const colWidths = [{ wch: 36 }, ...matrix.workers.map(() => ({ wch: 14 })), { wch: 10 }];
    ws3["!cols"] = colWidths;
    ws3["!freeze"] = { xSplit: 0, ySplit: 4 };

    XLSX.utils.book_append_sheet(wb, ws3, "Worker Matrix");

    await XLSX.writeFile(wb, `stock-entry-history-${fromDate}-to-${toDate}.xlsx`);
  }

  async function handlePrintMatrix() {
    if (filteredGroups.length === 0) return;
    const groupsWithBales = await fetchGroupsWithBales();
    const matrix = buildWorkerMatrix(groupsWithBales);
    const { workers: cols, rows, workerTotals, grandTotal } = matrix;

    // Readable font — minimum 8.5 px regardless of column count
    const fontSize = cols.length > 20 ? 8.5 : cols.length > 14 ? 9.5 : cols.length > 10 ? 10.5 : 11.5;

    // Palette of vivid accent colors for worker columns (cycles if more workers than colors)
    const palette = [
      "#2563eb",
      "#16a34a",
      "#dc2626",
      "#9333ea",
      "#ea580c",
      "#0891b2",
      "#be185d",
      "#65a30d",
      "#7c3aed",
      "#b45309",
      "#0284c7",
      "#15803d",
      "#e11d48",
      "#7e22ce",
      "#c2410c",
      "#0e7490",
      "#9d174d",
      "#4d7c0f",
      "#6d28d9",
      "#92400e",
    ];
    const colColor = (i: number) => palette[i % palette.length];

    // Worker header — split on the last space so two short lines fit the narrow column
    const headerCells = cols
      .map((w, i) => {
        const c = colColor(i);
        const lastSpace = w.lastIndexOf(" ");
        const label = lastSpace > 0 ? `${w.slice(0, lastSpace)}<br/>${w.slice(lastSpace + 1)}` : w;
        return `<th class="wc" style="background:${c};">${label}</th>`;
      })
      .join("");

    // Split "Product Name (CODE)" into two stacked lines to keep the cell narrow
    const prodHtml = (label: string) => {
      const m = label.match(/^(.*)\s\(([^)]+)\)$/);
      if (m) return `${m[1]}<br/><span class="code">${m[2]}</span>`;
      return label;
    };

    const dataRows = rows
      .map((row, idx) => {
        const rowBg = idx % 2 === 0 ? "#ffffff" : "#f1f5f9";
        const cells = cols
          .map((w, i) => {
            const v = row.counts[w] || 0;
            const accent = colColor(i);
            const style =
              v > 0
                ? `style="color:${accent};font-weight:700;background:${rowBg};"`
                : `style="background:${rowBg};color:#cbd5e1;"`;
            return `<td class="num" ${style}>${v > 0 ? v : "&middot;"}</td>`;
          })
          .join("");
        return `<tr>
        <td class="prod" style="background:${rowBg};">${prodHtml(row.productLabel)}</td>
        ${cells}
        <td class="num total-col" style="background:${idx % 2 === 0 ? "#e0f2fe" : "#bae6fd"};">${row.total}</td>
      </tr>`;
      })
      .join("");

    const totalCells = cols
      .map((w, i) => {
        const c = colColor(i);
        return `<td class="num" style="background:${c};color:#fff;">${workerTotals[w] || 0}</td>`;
      })
      .join("");

    // Column widths: product = 12%, total = 7%, workers share the remaining 81%
    const workerColPct = Math.max(2, Math.floor(81 / Math.max(cols.length, 1)));

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Worker Matrix — ${fromDate} to ${toDate}</title>
  <style>
    @page { size: landscape; margin: 8mm 7mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: ${fontSize}px; color: #1e293b; background: #fff; }

    .header { margin-bottom: 5px; display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #2563eb; padding-bottom: 3px; }
    .header-left h1 { font-size: ${fontSize + 2.5}px; font-weight: 800; color: #1e3a8a; letter-spacing: -0.3px; }
    .header-left .sub { font-size: ${fontSize - 0.5}px; color: #475569; margin-top: 1px; }
    .header-right { text-align: right; font-size: ${fontSize - 0.5}px; color: #64748b; line-height: 1.5; }
    .header-right strong { color: #1e3a8a; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #e2e8f0; padding: 2px 3px; overflow: hidden; }
    th { color: #fff; font-weight: 700; text-align: center; font-size: ${fontSize}px; line-height: 1.3; }
    th.prod-h { background: #1e3a8a; text-align: left; width: 12%; }
    th.wc { width: ${workerColPct}%; }
    th.total-h { background: #0369a1; width: 7%; }

    td.prod { text-align: left; font-weight: 500; word-break: break-word; color: #1e293b; font-size: ${fontSize}px; line-height: 1.3; }
    .code { color: #64748b; font-size: ${Math.max(6.5, fontSize - 1.5)}px; font-weight: 400; }
    td.num { text-align: center; font-size: ${fontSize}px; }
    td.total-col { font-weight: 800; text-align: center; }

    tr.totals-row td { font-weight: 800; border-color: #1e3a8a; }
    tr.totals-row td.prod-total { background: #1e3a8a; color: #fff; text-align: left; }
    tr.totals-row td.grand { background: #0369a1; color: #fff; text-align: center; font-weight: 800; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>Worker Bale Matrix</h1>
      <div class="sub">Stock Entry History &nbsp;&middot;&nbsp; ${fromDate} &rarr; ${toDate}</div>
    </div>
    <div class="header-right">
      <strong>${cols.length}</strong> worker${cols.length !== 1 ? "s" : ""} &nbsp;|&nbsp;
      <strong>${rows.length}</strong> product${rows.length !== 1 ? "s" : ""} &nbsp;|&nbsp;
      <strong>${grandTotal}</strong> bales total
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="prod-h">Product / Article</th>
        ${headerCells}
        <th class="total-h">Total</th>
      </tr>
    </thead>
    <tbody>
      ${dataRows}
      <tr class="totals-row">
        <td class="prod-total">TOTAL</td>
        ${totalCells}
        <td class="grand">${grandTotal}</td>
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

  async function handleExportWorkerPDF() {
    if (filteredGroups.length === 0) return;

    // In lite mode, fetch full bale data for the per-worker PDF.
    const groupsWithBales = await fetchGroupsWithBales();

    // Collect all bales across all groups
    const allBales: BaleDetail[] = groupsWithBales.flatMap((g) => g.bales);

    // Group bales by worker
    const byWorker = new Map<string, BaleDetail[]>();
    for (const b of allBales) {
      const w = b.workerName || "Unassigned";
      if (!byWorker.has(w)) byWorker.set(w, []);
      byWorker.get(w)!.push(b);
    }

    // Sort workers alphabetically
    const sortedWorkers = Array.from(byWorker.keys()).sort((a, b) => a.localeCompare(b, "ar"));

    // Build detail rows (grouped by worker, bales sorted by product)
    let detailRowsHtml = "";
    for (const worker of sortedWorkers) {
      const bales = byWorker.get(worker)!.sort((a, b) => (a.productName || "").localeCompare(b.productName || ""));
      const workerBaleCount = bales.length;
      const workerTotalKg = bales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0);

      bales.forEach((b, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === bales.length - 1;
        const productLabel = b.productName
          ? b.articleCode
            ? `${b.productName} (${b.articleCode})`
            : b.productName
          : "—";
        const evenOdd = idx % 2 === 0 ? "#fff" : "#f8fafc";
        detailRowsHtml += `<tr style="background:${evenOdd};">
          <td class="ref">${b.referenceNumber || "—"}</td>
          <td class="worker">${isFirst ? `<span class="worker-name">${worker}</span>` : ""}</td>
          <td class="prod">${productLabel}</td>
          <td class="wt">${parseFloat(b.weightKg || "0").toFixed(0)}</td>
          <td class="total-pp">${isLast ? `<strong>${workerBaleCount}</strong><br/><span class="total-kg">${workerTotalKg.toFixed(0)} kg</span>` : ""}</td>
        </tr>`;
      });
    }

    // Summary — sorted by bale count descending
    const summaryRows = sortedWorkers
      .map((w) => {
        const bales = byWorker.get(w)!;
        const count = bales.length;
        const totalKg = bales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0);
        return { worker: w, count, totalKg };
      })
      .sort((a, b) => b.count - a.count);

    const grandBales = summaryRows.reduce((s, r) => s + r.count, 0);
    const grandKg = summaryRows.reduce((s, r) => s + r.totalKg, 0);

    const summaryRowsHtml = summaryRows
      .map(
        (r, idx) => `
      <tr style="background:${idx % 2 === 0 ? "#fff" : "#f8fafc"};">
        <td class="sum-worker">${r.worker}</td>
        <td class="sum-num">${r.count}</td>
        <td class="sum-num">${r.totalKg.toFixed(0)}</td>
      </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Worker Bales Report — ${fromDate} to ${toDate}</title>
  <style>
    @page { size: portrait; margin: 10mm 8mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 9px; color: #1e293b; background: #fff; }

    .page-header { display: flex; align-items: flex-end; justify-content: space-between; border-bottom: 2px solid #1e3a8a; padding-bottom: 4px; margin-bottom: 8px; }
    .page-header h1 { font-size: 13px; font-weight: 800; color: #1e3a8a; }
    .page-header .sub { font-size: 8.5px; color: #64748b; margin-top: 2px; }
    .page-header .meta { text-align: right; font-size: 8px; color: #64748b; line-height: 1.6; }

    table { width: 100%; border-collapse: collapse; }
    th { background: #1e3a8a; color: #fff; font-weight: 700; padding: 3px 5px; text-align: left; font-size: 8.5px; border: 1px solid #c8d5e8; }
    th.r { text-align: right; }
    td { padding: 2px 5px; border: 1px solid #e2e8f0; vertical-align: middle; font-size: 8.5px; }

    td.ref { font-family: monospace; font-size: 7.5px; color: #334155; white-space: nowrap; }
    td.worker { min-width: 60px; }
    .worker-name { font-weight: 700; color: #1e3a8a; }
    td.prod { color: #334155; }
    td.wt { text-align: right; font-variant-numeric: tabular-nums; }
    td.total-pp { text-align: center; font-size: 8px; color: #0369a1; border-left: 2px solid #bae6fd; }
    .total-kg { font-size: 7px; color: #64748b; }

    .page-break { page-break-before: always; }
    .section-title { font-size: 12px; font-weight: 700; color: #1e3a8a; margin-bottom: 6px; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 3px; }

    td.sum-worker { font-weight: 600; }
    td.sum-num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    tr.grand-total td { background: #1e3a8a !important; color: #fff; font-weight: 700; }
    tr.grand-total td.sum-num { text-align: right; }
  </style>
</head>
<body>
  <div class="page-header">
    <div>
      <h1>Worker Bales Report</h1>
      <div class="sub">Stock Entry History &nbsp;&middot;&nbsp; ${fromDate} &rarr; ${toDate}</div>
    </div>
    <div class="meta">
      ${sortedWorkers.length} workers &nbsp;|&nbsp; ${grandBales} bales &nbsp;|&nbsp; ${grandKg.toFixed(0)} kg total
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:16%">Reference</th>
        <th style="width:18%">Worker</th>
        <th>Product</th>
        <th class="r" style="width:9%">Weight (kg)</th>
        <th class="r" style="width:14%">Total / Person</th>
      </tr>
    </thead>
    <tbody>
      ${detailRowsHtml}
      <tr style="background:#1e3a8a;color:#fff;font-weight:800;">
        <td colspan="3" style="color:#fff;padding:3px 5px;">TOTAL</td>
        <td style="text-align:right;color:#fff;padding:3px 5px;">${grandKg.toFixed(0)}</td>
        <td style="text-align:center;color:#fff;padding:3px 5px;">${grandBales}</td>
      </tr>
    </tbody>
  </table>

  <div class="page-break"></div>

  <div class="page-header">
    <div>
      <h1>Worker Summary</h1>
      <div class="sub">Stock Entry History &nbsp;&middot;&nbsp; ${fromDate} &rarr; ${toDate}</div>
    </div>
    <div class="meta">
      ${sortedWorkers.length} workers &nbsp;|&nbsp; ${grandBales} bales &nbsp;|&nbsp; ${grandKg.toFixed(0)} kg
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Worker</th>
        <th class="r" style="width:18%">Bales</th>
        <th class="r" style="width:22%">Total Weight (kg)</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRowsHtml}
      <tr class="grand-total">
        <td></td>
        <td class="sum-num">${grandBales}</td>
        <td class="sum-num">${grandKg.toFixed(0)}</td>
      </tr>
    </tbody>
  </table>

  <script>window.onload = function(){ window.print(); };<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="p-4 space-y-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-xl bg-gradient-to-br from-sky-500/30 to-sky-600/10 border border-sky-500/25 shrink-0">
            <History className="h-4 w-4 text-sky-500" />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight">Stock Entry History</h2>
            <p className="text-xs text-muted-foreground leading-tight">Browse and filter recorded bale entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ProductionPlannerDialog />
          {/* View toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <Button
              variant={viewMode === "condensed" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs rounded-md"
              onClick={() => setViewMode("condensed")}
              data-testid="button-view-condensed"
            >
              <AlignJustify className="w-3 h-3 mr-1" /> Condensed
            </Button>
            <Button
              variant={viewMode === "detailed" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs rounded-md"
              onClick={() => setViewMode("detailed")}
              data-testid="button-view-detailed"
            >
              <List className="w-3 h-3 mr-1" /> Detailed
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" data-testid="button-actions-menu">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={resetFilters} data-testid="button-reset-filters">
                <RotateCcw className="w-3 h-3 mr-2" /> Reset Filters
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleExportWorkerPDF}
                disabled={filteredGroups.length === 0}
                data-testid="button-export-worker-pdf"
              >
                <FileDown className="w-3 h-3 mr-2" /> Worker PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => sendWorkerPdfWaMutation.mutate()}
                disabled={filteredGroups.length === 0 || sendWorkerPdfWaMutation.isPending}
                data-testid="button-send-worker-pdf-whatsapp"
              >
                {sendWorkerPdfWaMutation.isPending ? (
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                ) : (
                  <MessageCircle className="w-3 h-3 mr-2" />
                )}
                Send Worker PDF to WhatsApp
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={exportExcel}
                disabled={filteredGroups.length === 0}
                data-testid="button-export-excel"
              >
                <Download className="w-3 h-3 mr-2" /> Export Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Filters panel ── */}
      <div className="rounded-xl border bg-muted/30 p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Layers className="h-3 w-3" />
              Category
            </div>
            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v);
                setWorkerIdFilter("all");
              }}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="select-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Users className="h-3 w-3" />
              Worker
            </div>
            <Select value={workerIdFilter} onValueChange={setWorkerIdFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-worker">
                <SelectValue placeholder="All workers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Workers</SelectItem>
                {filteredWorkers.map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Package className="h-3 w-3" />
              Product
            </div>
            <Select value={productIdFilter} onValueChange={setProductIdFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-product">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <MapPin className="h-3 w-3" />
              Location
            </div>
            <Select value={locationIdFilter} onValueChange={setLocationIdFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-location">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((l: any) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
              <Tag className="h-3 w-3" />
              Status
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Date + Search band ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-muted/30 flex-wrap">
        <Button
          variant={fromActive ? "default" : "ghost"}
          size="sm"
          onClick={() => setFromActive((v) => !v)}
          data-testid="button-toggle-from-date"
          className="toggle-elevate shrink-0 h-7 px-2.5 text-xs"
        >
          <CalendarRange className="w-3.5 h-3.5 mr-1.5" />
          From
        </Button>
        {fromActive && (
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            data-testid="input-from-date"
            className="w-34 h-7 text-xs shrink-0"
          />
        )}
        <Button
          variant={toActive ? "default" : "ghost"}
          size="sm"
          onClick={() => {
            setToActive((prev) => {
              const next = !prev;
              // Activating "To" ignores "From" — deactivate it automatically
              if (next) setFromActive(false);
              return next;
            });
          }}
          data-testid="button-toggle-to-date"
          className="toggle-elevate shrink-0 h-7 px-2.5 text-xs"
        >
          To
        </Button>
        {toActive && (
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            data-testid="input-to-date"
            className="w-34 h-7 text-xs shrink-0"
          />
        )}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-7 text-xs"
            placeholder="Search by reference number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Checkbox
            id="include-unassigned"
            checked={includeUnassigned}
            onCheckedChange={(v) => setIncludeUnassigned(!!v)}
            data-testid="checkbox-include-unassigned"
          />
          <Label htmlFor="include-unassigned" className="text-xs cursor-pointer whitespace-nowrap">
            Include Unassigned
          </Label>
        </div>
      </div>

      {/* ── Summary pill-cards ── show dataset-level totals (all pages, full filter) ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-slate-500/10 border-slate-500/20">
          <span className="text-xs font-semibold text-slate-500">Groups</span>
          <span className="text-sm font-bold tabular-nums text-slate-600 dark:text-slate-300">
            {(pagedGroups?.total ?? filteredGroups.length).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-emerald-500/10 border-emerald-500/20">
          <span className="text-xs font-semibold text-emerald-500">Bales</span>
          <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {(pagedGroups?.totalBales ?? totalBales).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-sky-500/10 border-sky-500/20">
          <span className="text-xs font-semibold text-sky-500">Weight</span>
          <span className="text-sm font-bold tabular-nums text-sky-600 dark:text-sky-400">
            {(pagedGroups?.totalWeight ?? totalWeight).toFixed(2)}
          </span>
          <span className="text-xs text-sky-600/70 dark:text-sky-400/70">kg</span>
        </div>
      </div>

      {/* ── Pagination controls ── */}
      {(pagedGroups?.total ?? 0) > 0 && (
        <div className="flex items-center gap-3 flex-wrap" data-testid="pagination-controls">
          <span className="text-xs text-muted-foreground tabular-nums">
            Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, pagedGroups!.total).toLocaleString()} of {pagedGroups!.total.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground tabular-nums">Page {page} of {pagedGroups!.totalPages}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[72px] h-7 text-xs" data-testid="select-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="250">250</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground/60">/ page</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={!pagedGroups?.hasPreviousPage}
              onClick={() => setPage((p) => p - 1)}
              data-testid="button-prev-page"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={!pagedGroups?.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
              data-testid="button-next-page"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── CONDENSED VIEW: grouped by worker ── */}
      {viewMode === "condensed" && (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-30 bg-muted border-b-2 border-border/60">
              <tr className="text-left">
                <th className="px-3 py-2.5 w-6"></th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  No. Workers
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Worker</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  Target
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  Shortage
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  Bales
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  Total kg
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && workerGroups.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No stock entry records found for the selected filters.
                  </td>
                </tr>
              )}
              {workerGroups.map((wg) => {
                const wExpanded = expandedKeys.has(wg.workerKey);
                const plan = wg.workerId != null ? workerTargets[wg.workerId] : undefined;
                const target = plan?.targetBales ?? 0;
                const workerCount = plan?.workerCount ?? 0;
                const diff = wg.totalBales - target;
                return [
                  /* Worker header row */
                  <tr
                    key={wg.workerKey}
                    className="border-t hover-elevate cursor-pointer bg-muted/30"
                    onClick={() => toggleExpand(wg.workerKey)}
                    data-testid={`row-worker-${wg.workerKey}`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">
                      {wExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {plan && workerCount > 0 ? workerCount : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 font-semibold">
                      {wg.workerName || <span className="italic text-muted-foreground">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {plan && target > 0 ? target : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {plan && target > 0 ? (
                        <span
                          className={
                            diff >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                          }
                        >
                          {diff >= 0 ? `+${diff}` : diff}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{wg.totalBales}</td>
                    <td className="px-3 py-2 text-right font-semibold">{wg.totalWeight.toFixed(2)}</td>
                  </tr>,

                  /* Expanded: sub-group rows per date+location+product */
                  wExpanded && (
                    <tr key={wg.workerKey + "-sub"} className="bg-muted/10">
                      <td colSpan={7} className="px-0 py-0">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b bg-muted/20">
                              <th className="px-8 py-1.5 text-left w-6"></th>
                              <th className="px-3 py-1.5 text-left">Date</th>
                              <th className="px-3 py-1.5 text-left">Location</th>
                              <th className="px-3 py-1.5 text-left">Product</th>
                              <th className="px-3 py-1.5 text-right">Bales</th>
                              <th className="px-3 py-1.5 text-right">Total kg</th>
                              <th className="px-3 py-1.5 text-right">Avg kg</th>
                              <th className="px-3 py-1.5">Reassign</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wg.groups.map((g) => {
                              const gKey = groupKey(g);
                              const gExpanded = expandedKeys.has(gKey + "-bales");
                              return [
                                <tr
                                  key={gKey}
                                  className="border-t border-border/40 hover-elevate cursor-pointer"
                                  onClick={() => toggleExpand(gKey + "-bales")}
                                  data-testid={`row-group-${gKey}`}
                                >
                                  <td className="px-8 py-1.5 text-muted-foreground">
                                    {gExpanded ? (
                                      <ChevronDown className="w-3 h-3" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3" />
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5">{formatDisplayDate(g.stockEntryDate)}</td>
                                  <td className="px-3 py-1.5">{g.locationName}</td>
                                  <td className="px-3 py-1.5">
                                    {g.productName || "—"}
                                    {g.articleCode && (
                                      <span className="ml-1 text-muted-foreground">({g.articleCode})</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-medium">{g.baleCount}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    {parseFloat(g.totalWeight || "0").toFixed(2)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    {parseFloat(g.avgWeight || "0").toFixed(2)}
                                  </td>
                                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                                    <Select
                                      value={g.workerId ? String(g.workerId) : ""}
                                      onValueChange={async (v) => {
                                        const workerId = parseInt(v);
                                        const baleIds = await resolveGroupBaleIds(g);
                                        if (baleIds.length === 0) {
                                          toast({
                                            title: "Reassign failed",
                                            description: "Could not find any bales for this group.",
                                            variant: "destructive",
                                          });
                                          return;
                                        }
                                        bulkAssignMutation.mutate({ baleIds, workerId });
                                      }}
                                    >
                                      <SelectTrigger
                                        className="h-6 w-36 text-xs"
                                        data-testid={`select-assign-worker-${gKey}`}
                                      >
                                        <SelectValue placeholder="Reassign…" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {workers
                                          .filter((w: any) => w.active)
                                          .map((w: any) => (
                                            <SelectItem key={w.id} value={String(w.id)}>
                                              {w.fullName || w.full_name || w.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </td>
                                </tr>,
                                /* Bale-level detail inside sub-group */
                                gExpanded && (
                                  <tr key={gKey + "-bales-detail"} className="bg-muted/20">
                                    <td colSpan={10} className="px-12 py-2">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-muted-foreground">
                                            <th className="text-left pb-1 pr-4">Reference</th>
                                            <th className="text-right pb-1 pr-4">Weight (kg)</th>
                                            <th className="text-left pb-1 pr-4">Status</th>
                                            <th className="text-left pb-1">Finalized At</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {isGroupBalesLoading(g) ? (
                                             <tr><td colSpan={4} className="py-2 text-xs text-muted-foreground">Loading bale details…</td></tr>
                                           ) : getGroupBales(g).map((b) => (
                                            <tr
                                              key={b.id}
                                              className="border-t border-border/30"
                                              data-testid={`row-bale-${b.id}`}
                                            >
                                              <td className="py-1 pr-4 font-mono">{b.referenceNumber}</td>
                                              <td className="py-1 pr-4 text-right">
                                                {parseFloat(b.weightKg || "0").toFixed(2)}
                                              </td>
                                              <td className="py-1 pr-4">
                                                <span
                                                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-muted text-muted-foreground"}`}
                                                >
                                                  {b.status}
                                                </span>
                                              </td>
                                              <td className="py-1">
                                                {b.finalizedAt
                                                  ? new Date(b.finalizedAt).toLocaleTimeString([], {
                                                      hour: "2-digit",
                                                      minute: "2-digit",
                                                    })
                                                  : "—"}
                                              </td>
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
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── DETAILED VIEW: flat per-bale list ── */}
      {viewMode === "detailed" && (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-30 bg-muted border-b-2 border-border/60">
              <tr className="text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Reference</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Date</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Location</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Worker</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Product</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Article</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground tracking-wide">
                  Weight (kg)
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Status</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground tracking-wide">Finalized At</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && allBales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                    No bales found for the selected filters.
                  </td>
                </tr>
              )}
              {allBales.map((b, idx) => (
                <tr
                  key={b.id}
                  className={`border-t ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
                  data-testid={`row-bale-${b.id}`}
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{b.referenceNumber}</td>
                  <td className="px-3 py-1.5">{b.stockEntryDate ? formatDisplayDate(b.stockEntryDate) : "—"}</td>
                  <td className="px-3 py-1.5">{b.locationName}</td>
                  <td className="px-3 py-1.5">
                    {b.workerName || <span className="italic text-muted-foreground text-xs">Unassigned</span>}
                  </td>
                  <td className="px-3 py-1.5">{b.productName || "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">{b.articleCode || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{parseFloat(b.weightKg || "0").toFixed(2)}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-muted text-muted-foreground"}`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">
                    {b.finalizedAt ? new Date(b.finalizedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
