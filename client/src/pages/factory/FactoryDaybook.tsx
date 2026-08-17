import type { ClientErrorLike } from "@/lib/clientError";
import { useState, useMemo, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AuditLog } from "@/pages/settings/AuditLog";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { addDays, format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  BookOpen,
  Eye,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  FileDown,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";
import { utils, writeFile } from "@/lib/excelHelper";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { cn } from "@/lib/utils";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import type { DaybookEntry, DisplayEntry, FactoryDaybookUIState } from "./daybook/types";
import {
  parseBalesMeta,
  mergeBaleEntries,
  expandBaleEntries,
  formatDaybookDescription,
  currencySymbol,
  formatTxType,
  getFactoryTxTypeBadge,
  VOUCHER_TX_TYPES,
} from "./daybook/daybookUtils";
import { FACTORY_DAYBOOK_STATE_KEY, loadFactoryDaybookState, saveFactoryDaybookState } from "./daybook/daybookUiState";
import { ViewEntryModal } from "./daybook/ViewEntryModal";

export default function FactoryDaybook() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { formatDisplayDate, formatDisplayTime: _formatDisplayTime } = useDateFormat();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const routePrefix = appMode === "properties" ? "/properties" : "/factory";

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdminOrOwner =
    currentUser?.role === "Admin" || currentUser?.role === "Owner" || currentUser?.role === "Developer";

  // ── Filter state ──────────────────────────────────────────────────────────
  // Restore any saved session state directly in the initializers (not in a
  // post-mount useEffect) so the very first query fires once, with the right
  // dates/filters — never "today" followed immediately by a second, wider fetch.
  const initialDaybookStateRef = useRef<FactoryDaybookUIState | null>(loadFactoryDaybookState());
  const [activeDaybookTab, setActiveDaybookTab] = useState<"transactions" | "activity">("transactions");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(
    () => initialDaybookStateRef.current?.periodFilter || getDefaultPeriodValue("today")
  );
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [txTypeFilter, setTxTypeFilter] = useState(() => initialDaybookStateRef.current?.txTypeFilter || "ALL");
  const [currencyFilter, setCurrencyFilter] = useState(() => initialDaybookStateRef.current?.currencyFilter || "ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "exclude" | "only">(
    () => (initialDaybookStateRef.current?.statusFilter as "all" | "exclude" | "only") || "all"
  );
  const [searchQuery, setSearchQuery] = useState(() => initialDaybookStateRef.current?.searchQuery || "");
  const [minAmount, setMinAmount] = useState(() => initialDaybookStateRef.current?.minAmount || "");
  const [maxAmount, setMaxAmount] = useState(() => initialDaybookStateRef.current?.maxAmount || "");
  const [sortOrder, _setSortOrder] = useState<"asc" | "desc">(() => initialDaybookStateRef.current?.sortOrder || "desc");
  // searchQuery filters client-side only (not part of the query key below), but debounce
  // it anyway so rapid typing doesn't thrash the derived filteredEntries memo on large lists.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── View/UX state ─────────────────────────────────────────────────────────
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [selectedRowId, _setSelectedRowId] = useState<string | null>(null);
  const scrollYRef = useRef(0);

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [editEntry, setEditEntry] = useState<DaybookEntry | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmountCurrency, setEditAmountCurrency] = useState("");
  const [editAmountUsd, setEditAmountUsd] = useState("");
  const [editTxDate, setEditTxDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const [costEditEntry, setCostEditEntry] = useState<DaybookEntry | null>(null);
  const [costEditAmount, setCostEditAmount] = useState("");
  const [costEditReason, setCostEditReason] = useState("");
  const [viewEntry, setViewEntry] = useState<DaybookEntry | null>(null);
  const [voidEntry, setVoidEntry] = useState<DaybookEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<DaybookEntry | null>(null);
  const [isExportingDetailed, setIsExportingDetailed] = useState(false);
  const [urlEntryHandled, setUrlEntryHandled] = useState(false);

  // ── Derive API date params from periodFilter ──────────────────────────────
  const startDate = periodFilter.fromDate;
  const endDate = periodFilter.toDate;

  // ── Keyboard date navigation ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasAnyOpenDialog()) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const fmt = "yyyy-MM-dd";
      const isBack = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";
      if (isBack) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), -1), fmt),
          toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), -1), fmt),
          preset: "custom",
        }));
      } else if (isForward) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), 1), fmt),
          toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), 1), fmt),
          preset: "custom",
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // ── Scroll selected row into view ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedRowId) return;
    const el = document.querySelector(`[data-row-id="${selectedRowId}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedRowId]);

  // ── API query ─────────────────────────────────────────────────────────────
  const queryParams = new URLSearchParams();
  // Always send startDate/endDate explicitly — including as empty strings for the
  // "All Time" preset — so the server can tell "user explicitly wants all time" apart
  // from "caller omitted the params entirely" (e.g. a raw API call) and only applies
  // its own safety-net default in the latter case.
  queryParams.set("startDate", startDate || "");
  queryParams.set("endDate", endDate || "");
  if (txTypeFilter !== "ALL") queryParams.set("txType", txTypeFilter);
  if (currencyFilter !== "ALL") queryParams.set("currencyCode", currencyFilter);

  const { data: entries = [], isLoading } = useQuery<DaybookEntry[]>({
    queryKey: ["/api/factory/daybook", startDate, endDate, txTypeFilter, currencyFilter],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daybook?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch daybook");
      return res.json();
    },
    // Avoid the bandwidth spike from constant refetching: the daybook list doesn't
    // need to be second-by-second live, and refocusing/reconnecting shouldn't
    // trigger a fresh multi-MB fetch every time.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hiddenErpCosts: string[] = myErpPages?.hiddenErpCostFields ?? [];
  const showAmounts = !hiddenErpCosts.includes("daybook_amounts");

  // ── URL deep link: ?entryId= or ?voucherId= on mount ─────────────────────
  useEffect(() => {
    if (urlEntryHandled || isLoading || entries.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const entryId = parseInt(params.get("entryId") ?? "");
    const voucherId = parseInt(params.get("voucherId") ?? "");
    if (!isNaN(entryId) && entryId !== 0) {
      const found = entries.find((e) => e.id === entryId);
      if (found) {
        setViewEntry(found);
        setUrlEntryHandled(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("entryId");
        window.history.replaceState({}, "", url.toString());
      }
    } else if (!isNaN(voucherId) && voucherId !== 0) {
      const found = entries.find((e) => e.referenceId === voucherId);
      if (found) {
        setViewEntry(found);
        setUrlEntryHandled(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("voucherId");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [entries, isLoading, urlEntryHandled]);

  // ── Client-side filters (search, amount range, status) ────────────────────
  const filteredEntries = useMemo(() => {
    let result = entries;
    // Always hide worker edit audit entries
    result = result.filter((e) => e.txType !== "WORKER_EDITED");
    // Non-admins only see their own entries (View Only users are observers — they see everything)
    if (!isAdminOrOwner && currentUser?.role !== "View Only" && currentUser?.id) {
      result = result.filter((e) => e.createdBy === currentUser.id);
    }
    if (statusFilter === "exclude") result = result.filter((e) => !e.optional);
    else if (statusFilter === "only") result = result.filter((e) => e.optional);
    if (debouncedSearchQuery.trim()) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          formatDaybookDescription(e).toLowerCase().includes(q) ||
          formatTxType(e.txType).toLowerCase().includes(q) ||
          e.txType.toLowerCase().includes(q)
      );
    }
    const minAmt = minAmount ? parseFloat(minAmount) : null;
    const maxAmt = maxAmount ? parseFloat(maxAmount) : null;
    if (minAmt !== null || maxAmt !== null) {
      result = result.filter((e) => {
        const amt = parseFloat(e.amountCurrency || "0");
        if (minAmt !== null && amt < minAmt) return false;
        if (maxAmt !== null && amt > maxAmt) return false;
        return true;
      });
    }
    result = [...result].sort((a, b) => {
      const aDate = a.effectiveDate || a.txDate;
      const bDate = b.effectiveDate || b.txDate;
      const dateCmp = aDate.localeCompare(bDate) || a.id - b.id;
      return sortOrder === "desc" ? -dateCmp : dateCmp;
    });
    return result;
  }, [entries, isAdminOrOwner, currentUser?.role, currentUser.id, statusFilter, debouncedSearchQuery, minAmount, maxAmount, sortOrder]);

  // ── Condensed grouped rows ────────────────────────────────────────────────
  const condensedRows = useMemo(() => {
    const grouped: Record<
      string,
      {
        date: string;
        txType: string;
        currencyCode: string;
        count: number;
        totalAmountCurrency: number;
        fxRateToUsd: string | null;
        totalAmountUsd: number;
        key: string;
      }
    > = {};
    filteredEntries.forEach((e) => {
      const eDate = e.effectiveDate || e.txDate;
      const key = `${eDate}|${e.txType}|${e.currencyCode}`;
      if (!grouped[key]) {
        grouped[key] = {
          date: eDate,
          txType: e.txType,
          currencyCode: e.currencyCode,
          count: 0,
          totalAmountCurrency: 0,
          fxRateToUsd: e.fxRateToUsd,
          totalAmountUsd: 0,
          key,
        };
      }
      // Count individual bales for BALE_STOCK_ENTRY so the count reflects bales not batches
      const baleCount = e.txType === "BALE_STOCK_ENTRY" ? Math.max(parseBalesMeta(e).length, 1) : 1;
      grouped[key].count += baleCount;
      grouped[key].totalAmountCurrency += parseFloat(e.amountCurrency || "0");
      grouped[key].totalAmountUsd += parseFloat(e.amountUsd || "0");
      if (grouped[key].fxRateToUsd !== e.fxRateToUsd) grouped[key].fxRateToUsd = null;
    });
    return Object.values(grouped).sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return a.txType.localeCompare(b.txType);
    });
  }, [filteredEntries]);

  const getEntriesForCondensedRow = (rowKey: string): DisplayEntry[] => {
    const [date, txType, currencyCode] = rowKey.split("|");
    const raw = filteredEntries.filter(
      (e) => (e.effectiveDate || e.txDate) === date && e.txType === txType && e.currencyCode === currencyCode
    );
    if (txType === "BALE_STOCK_ENTRY") {
      return raw.map((e) => ({ ...e, _vKey: String(e.id), _source: e }) as DisplayEntry);
    }
    return expandBaleEntries(raw);
  };

  // ── Active filters detection ──────────────────────────────────────────────
  const hasActiveFilters =
    periodFilter.preset !== "today" ||
    txTypeFilter !== "ALL" ||
    currencyFilter !== "ALL" ||
    statusFilter !== "all" ||
    !!searchQuery ||
    !!minAmount ||
    !!maxAmount;

  const clearFilters = () => {
    setPeriodFilter(getDefaultPeriodValue("today"));
    setTxTypeFilter("ALL");
    setCurrencyFilter("ALL");
    setStatusFilter("all");
    setSearchQuery("");
    setMinAmount("");
    setMaxAmount("");
  };

  // ── Session persistence: restore scroll position on mount ─────────────────
  // Filter/period state is now restored directly in the useState initializers
  // above (see initialDaybookStateRef) so the query doesn't fire twice on
  // mount — once for the "today" default, then again for the restored range.
  useEffect(() => {
    const scrollY = initialDaybookStateRef.current?.scrollY || 0;
    if (!scrollY) return;
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior });
    });
  }, []);

  // ── Session persistence: save on every state change ───────────────────────
  useEffect(() => {
    saveFactoryDaybookState({
      periodFilter,
      txTypeFilter,
      currencyFilter,
      statusFilter,
      searchQuery,
      minAmount,
      maxAmount,
      sortOrder,
      scrollY: scrollYRef.current,
    });
  }, [periodFilter, txTypeFilter, currencyFilter, statusFilter, searchQuery, minAmount, maxAmount, sortOrder]);

  // ── Session persistence: track scroll ────────────────────────────────────
  useEffect(() => {
    const handleScroll = () => {
      scrollYRef.current = window.scrollY;
      try {
        const raw = sessionStorage.getItem(FACTORY_DAYBOOK_STATE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          state.scrollY = window.scrollY;
          sessionStorage.setItem(FACTORY_DAYBOOK_STATE_KEY, JSON.stringify(state));
        }
      } catch {
        // Storage is unavailable in private mode and can throw on quota; the value is a convenience, not state we need.
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ── Session persistence: clear on unmount if leaving daybook flow ─────────
  useEffect(() => {
    return () => {
      const path = window.location.pathname;
      const isDaybookFlow =
        path.includes("/factory/daybook") ||
        path.includes("/factory/vouchers") ||
        path.includes("/properties/daybook") ||
        path.includes("/properties/vouchers");
      if (!isDaybookFlow) sessionStorage.removeItem(FACTORY_DAYBOOK_STATE_KEY);
    };
  }, []);

  // ── Excel export: summary ─────────────────────────────────────────────────
  const handleExportToExcel = async () => {
    if (filteredEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "No entries found for the current filters.",
        variant: "destructive",
      });
      return;
    }
    const exportData = filteredEntries.map((e) => ({
      Date: formatDisplayDate(e.txDate + "T00:00:00"),
      Type: formatTxType(e.txType),
      Description: formatDaybookDescription(e),
      Currency: e.currencyCode,
      Amount: parseFloat(e.amountCurrency || "0"),
      "FX Rate": parseFloat(e.fxRateToUsd || "1"),
      "Amount (USD)": parseFloat(e.amountUsd || "0"),
      Optional: e.optional ? "Yes" : "No",
    }));
    const worksheet = utils.json_to_sheet(exportData);
    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 22 },
      { wch: 40 },
      { wch: 10 },
      { wch: 15 },
      { wch: 10 },
      { wch: 15 },
      { wch: 10 },
    ];
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Factory Daybook");
    const fileName = `FactoryDaybook_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);
    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${filteredEntries.length} entries.`,
    });
  };

  // ── Excel export: detailed (with voucher debit/credit entries) ────────────
  const handleExportDetailedToExcel = async () => {
    if (filteredEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "No entries found for the current filters.",
        variant: "destructive",
      });
      return;
    }
    setIsExportingDetailed(true);
    try {
      type DetailRow = {
        Date: string;
        Type: string;
        Description: string;
        Currency: string;
        Amount: number;
        "Amount (USD)": number;
        Optional: string;
        "Account Name": string;
        Debit: string;
        Credit: string;
      };
      const detailedData: DetailRow[] = [];

      for (const entry of filteredEntries) {
        const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
        const baseRow = {
          Date: formatDisplayDate(entry.txDate + "T00:00:00"),
          Type: formatTxType(entry.txType),
          Description: formatDaybookDescription(entry),
          Currency: entry.currencyCode,
          Amount: parseFloat(entry.amountCurrency || "0"),
          "Amount (USD)": parseFloat(entry.amountUsd || "0"),
          Optional: entry.optional ? "Yes" : "No",
        };
        if (isVoucherBacked) {
          try {
            const res = await fetch(`/api/vouchers/${entry.referenceId}/view-entries`, { credentials: "include" });
            if (res.ok) {
              const raw = await res.json();
              const vEntries = Array.isArray(raw) ? raw : raw.entries || [];
              if (vEntries.length > 0) {
                for (const ve of vEntries) {
                  detailedData.push({
                    ...baseRow,
                    "Account Name": ve.accountName || "",
                    Debit: parseFloat(ve.debitAmount || "0") > 0 ? String(parseFloat(ve.debitAmount)) : "",
                    Credit: parseFloat(ve.creditAmount || "0") > 0 ? String(parseFloat(ve.creditAmount)) : "",
                  });
                }
                continue;
              }
            }
          } catch {
            // Failure here is non-fatal and the surrounding flow continues deliberately.
          }
        }
        detailedData.push({ ...baseRow, "Account Name": "", Debit: "", Credit: "" });
      }

      const workbook = utils.book_new();
      const dataByType: Record<string, DetailRow[]> = {};
      for (const row of detailedData) {
        if (!dataByType[row.Type]) dataByType[row.Type] = [];
        dataByType[row.Type].push(row);
      }
      for (const type of Object.keys(dataByType).sort()) {
        const ws = utils.json_to_sheet(dataByType[type]);
        ws["!cols"] = [
          { wch: 12 },
          { wch: 22 },
          { wch: 40 },
          { wch: 10 },
          { wch: 15 },
          { wch: 15 },
          { wch: 10 },
          { wch: 30 },
          { wch: 15 },
          { wch: 15 },
        ];
        const sheetName = type.substring(0, 31).replace(/[\\/*?[\]:]/g, "_");
        utils.book_append_sheet(workbook, ws, sheetName);
      }

      const fileName = `FactoryDaybook_Detailed_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName} with ${detailedData.length} entries.` });
    } catch (_error) {
      toast({ title: "Export failed", description: "An error occurred while exporting.", variant: "destructive" });
    } finally {
      setIsExportingDetailed(false);
    }
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number; data: unknown }) => {
      const res = await factoryApiRequest("PUT", `/api/factory/daybook/${entryId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      setEditEntry(null);
      setEditReason("");
      toast({ title: "Entry updated", description: "Description synced to source record." });
    },
    onError: (e: ClientErrorLike) => {
      if (e?._handledGlobally) return;
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/daybook/entry/${entryId}/void`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setVoidEntry(null);
      toast({ title: "Voucher voided", description: "All accounting entries have been reversed." });
    },
    onError: (e: ClientErrorLike) => {
      if (e?._handledGlobally) return;
      toast({ title: "Void failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/daybook/entry/${entryId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setDeleteEntry(null);
      toast({ title: "Entry deleted", description: "The daybook entry has been permanently removed." });
    },
    onError: (e: ClientErrorLike) => {
      if (e?._handledGlobally) return;
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const CONTAINER_COST_TX_TYPES = new Set(["OFFLOAD_RAW_STOCK", "FREIGHT", "COMMISSION", "DUTY", "OTHER_CHARGE"]);

  const _isCostEditable = (entry: DaybookEntry) => {
    if (!isAdminOrOwner) return false;
    if (!CONTAINER_COST_TX_TYPES.has(entry.txType)) return false;
    if (entry.id < 0) return false; // synthetic/voucher rows
    if (entry.referenceTable === "vouchers") return false;
    return true;
  };

  const costEditMutation = useMutation({
    mutationFn: async ({ entryId, newAmount, reason }: { entryId: number; newAmount: string; reason: string }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/daybook/${entryId}/cost-edit`, { newAmount, reason });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update cost");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      setCostEditEntry(null);
      setCostEditAmount("");
      setCostEditReason("");
      toast({ title: "Cost updated", description: data.message || "Container costs recalculated and cascaded." });
    },
    onError: (e: ClientErrorLike) => {
      if (e?._handledGlobally) return;
      toast({ title: "Cost edit failed", description: e.message, variant: "destructive" });
    },
  });

  const _openEditDialog = (entry: DaybookEntry) => {
    setEditEntry(entry);
    setEditDescription(entry.description);
    setEditAmountCurrency(entry.amountCurrency);
    setEditAmountUsd(entry.amountUsd);
    setEditTxDate(entry.txDate);
    setEditReason("");
  };

  const handleEntryClick = (entry: DaybookEntry, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (entry.txType === "BALE_TRANSFER") navigate(`${routePrefix}/bale-transfers`);
  };

  const editSourceRecord = (entry: DaybookEntry) => {
    if (entry.txType === "BALE_STOCK_ENTRY") return;
    if (entry.txType === "INVOICE" && entry.referenceId) {
      navigate(`${routePrefix}/sales/invoices/${entry.referenceId}`);
      return;
    }
    if (entry.txType === "BALE_SALE" && entry.referenceId) {
      navigate(`${routePrefix}/pos?edit=${entry.referenceId}`);
      return;
    }
    const tab = VOUCHER_TX_TYPES[entry.txType];
    if (tab && entry.referenceId) navigate(`${routePrefix}/vouchers?edit=${entry.referenceId}&tab=${tab}`);
  };

  const handleEditSubmit = () => {
    if (!editEntry || !editReason.trim()) return;
    const isVoucherBacked = editEntry.referenceTable === "vouchers" || editEntry.id < 0;
    editMutation.mutate({
      entryId: editEntry.id,
      data: {
        description: editDescription,
        ...(!isVoucherBacked && { amountCurrency: editAmountCurrency, amountUsd: editAmountUsd }),
        ...(editTxDate !== editEntry.txDate && { txDate: editTxDate }),
        reason: editReason.trim(),
      },
    });
  };

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader title="Factory Daybook" subtitle="All factory transactions in one view" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              disabled={filteredEntries.length === 0 || isExportingDetailed}
              data-testid="button-export-excel"
              className="gap-2"
            >
              <FileDown className="w-4 h-4" />
              {isExportingDetailed ? "Exporting..." : "Export"}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportToExcel} data-testid="export-simple">
              Summary Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportDetailedToExcel} data-testid="export-detailed">
              Detailed Export (with entries)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tab selector: Transactions / Edits & Activity */}
      <Tabs
        value={activeDaybookTab}
        onValueChange={(value) => setActiveDaybookTab(value as "transactions" | "activity")}
      >
        <TabsList className="w-fit">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="activity">Edits &amp; Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4 mt-2">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search"
                  className="w-44 h-8 text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const fmt = "yyyy-MM-dd";
                    setPeriodFilter((prev) => ({
                      fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), -1), fmt),
                      toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), -1), fmt),
                      preset: "custom",
                    }));
                  }}
                  title="Previous day (−)"
                  data-testid="button-prev-day"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="period-filter" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const fmt = "yyyy-MM-dd";
                    setPeriodFilter((prev) => ({
                      fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), 1), fmt),
                      toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), 1), fmt),
                      preset: "custom",
                    }));
                  }}
                  title="Next day (+)"
                  data-testid="button-next-day"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
                  <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-tx-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Types</SelectItem>
                    <SelectItem value="PAYMENT">Payment</SelectItem>
                    <SelectItem value="RECEIPT">Receipt</SelectItem>
                    <SelectItem value="JOURNAL">Journal</SelectItem>
                    <SelectItem value="INVOICE">Invoice</SelectItem>
                    <SelectItem value="BALE_TRANSFER">Bale Transfer</SelectItem>
                    <SelectItem value="CONTAINER_IMPORT">Container Import</SelectItem>
                    <SelectItem value="OFFLOAD_RAW_STOCK">Offload Raw Stock</SelectItem>
                    <SelectItem value="COMMISSION">Commission</SelectItem>
                    <SelectItem value="BALE_PRESSING">Bale Pressing</SelectItem>
                    <SelectItem value="BALE_FINALIZE">Bale Finalize</SelectItem>
                    <SelectItem value="BALE_STOCK_ENTRY">Bale Stock Entry</SelectItem>
                    <SelectItem value="BALE_REMOVAL">Bale Removal</SelectItem>
                    <SelectItem value="FREIGHT_PAYMENT">Freight Payment</SelectItem>
                    <SelectItem value="SUPPLIER_PAYMENT">Supplier Payment</SelectItem>
                    <SelectItem value="PAYROLL_PAYMENT">Payroll Payment</SelectItem>
                    <SelectItem value="DOC_UPLOAD">Doc Upload</SelectItem>
                    <SelectItem value="DOC_DELETE">Doc Delete</SelectItem>
                    <SelectItem value="FREIGHT_ADD">Freight Add</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "exclude" | "only")}>
                  <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Entries</SelectItem>
                    <SelectItem value="exclude">Exclude Optional</SelectItem>
                    <SelectItem value="only">Only Optional</SelectItem>
                  </SelectContent>
                </Select>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    data-testid="button-clear-filters"
                    className="gap-1 h-8 text-sm"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Transactions
                  {filteredEntries.length > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      ({`${condensedRows.length} group${condensedRows.length === 1 ? "" : "s"}`})
                    </span>
                  )}
                </CardTitle>
              </div>
              <CardDescription>All factory transactions in one view</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-6">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {hasActiveFilters ? (
                    <div>
                      <p className="mb-2">No transactions found matching your filters.</p>
                      <Button variant="outline" onClick={clearFilters} data-testid="button-clear-filters-empty">
                        Clear Filters
                      </Button>
                    </div>
                  ) : (
                    <>
                      <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
                      <p className="mt-2">Factory transactions will appear here as you perform operations</p>
                    </>
                  )}
                </div>
              ) : (
                /* ── CONDENSED VIEW — matches ERP Daybook: Date/Type | Count | Total ── */
                <div className="w-full">
                  {/* Header */}
                  <div
                    className={cn(
                      "sticky top-0 z-30 bg-background border-b grid w-full px-4 py-2",
                      showAmounts ? "grid-cols-[minmax(0,1fr)_100px_180px]" : "grid-cols-[minmax(0,1fr)_100px]"
                    )}
                  >
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Date / Type
                    </span>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-center">
                      Count
                    </span>
                    {showAmounts && (
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-right">
                        Total
                      </span>
                    )}
                  </div>

                  {/* Group condensedRows by date for date-separator rows */}
                  {(() => {
                    const dateMap = new Map<string, typeof condensedRows>();
                    for (const row of condensedRows) {
                      if (!dateMap.has(row.date)) dateMap.set(row.date, []);
                      dateMap.get(row.date)!.push(row);
                    }
                    return Array.from(dateMap.entries()).map(([date, rows]) => {
                      const dayTotal = rows.reduce((s, r) => s + r.totalAmountCurrency, 0);
                      const dayCcy = rows[0]?.currencyCode ?? "USD";
                      const colsClass = showAmounts
                        ? "grid-cols-[minmax(0,1fr)_100px_180px]"
                        : "grid-cols-[minmax(0,1fr)_100px]";
                      return (
                        <div key={date} className="w-full">
                          {/* Date separator row */}
                          <div className={cn("grid w-full px-4 py-1.5 bg-muted/40 border-b", colsClass)}>
                            <span className="font-semibold text-sm">{formatDisplayDate(date + "T00:00:00")}</span>
                            <span />
                            {showAmounts && (
                              <span className="font-mono font-medium text-sm text-right">
                                {currencySymbol(dayCcy)}
                                {formatNumber(dayTotal)}
                              </span>
                            )}
                          </div>

                          {/* Type rows under this date */}
                          {rows.map((row) => {
                            const isExpanded = expandedRowKey === row.key;
                            const expandedEntries = isExpanded ? getEntriesForCondensedRow(row.key) : [];
                            const { variant: bv, className: bc } = getFactoryTxTypeBadge(row.txType);
                            return (
                              <div key={row.key} className="w-full border-b last:border-b-0">
                                {/* Group type row */}
                                <div
                                  data-testid={`row-condensed-${row.date}-${row.txType}`}
                                  onClick={() => setExpandedRowKey(isExpanded ? null : row.key)}
                                  className={cn(
                                    "grid w-full pl-6 pr-4 py-3 cursor-pointer hover-elevate items-center",
                                    colsClass
                                  )}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {isExpanded ? (
                                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    )}
                                    <Badge variant={bv} className={cn(bc, "whitespace-nowrap")}>
                                      {formatTxType(row.txType)}
                                    </Badge>
                                  </div>
                                  <div className="text-center text-muted-foreground text-sm font-mono">{row.count}</div>
                                  {showAmounts && (
                                    <div className="text-right font-mono font-medium text-sm">
                                      {currencySymbol(row.currencyCode)}
                                      {formatNumber(row.totalAmountCurrency)}
                                      {row.currencyCode !== "USD" && (
                                        <div className="text-xs text-muted-foreground font-mono">
                                          {row.currencyCode}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Expanded entry sub-rows */}
                                {isExpanded &&
                                  row.txType === "BALE_STOCK_ENTRY" &&
                                  (() => {
                                    const hasEntries = expandedEntries.length > 0;
                                    const mergedEntry = hasEntries
                                      ? mergeBaleEntries(
                                          expandedEntries.map((e) => (e as DisplayEntry)._source ?? (e as DaybookEntry))
                                        )
                                      : undefined;
                                    return (
                                      <div className={cn("grid w-full bg-muted/20 border-t items-center", colsClass)}>
                                        <div className="pl-14 pr-2 py-2 min-w-0">
                                          <span className="text-sm text-foreground">
                                            {row.count} bale{row.count !== 1 ? "s" : ""}
                                          </span>
                                        </div>
                                        <div />
                                        {showAmounts ? (
                                          <div className="flex items-center justify-end gap-1 pr-2 py-2">
                                            <span className="text-sm font-mono font-medium">
                                              {currencySymbol(row.currencyCode)}
                                              {formatNumber(row.totalAmountCurrency)}
                                            </span>
                                            {mergedEntry && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="View details"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setViewEntry(mergedEntry);
                                                }}
                                                data-testid="button-view-bale-summary"
                                              >
                                                <Eye className="h-3 w-3" />
                                              </Button>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-end gap-1 pr-2 py-2">
                                            {mergedEntry && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="View details"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setViewEntry(mergedEntry);
                                                }}
                                                data-testid="button-view-bale-summary"
                                              >
                                                <Eye className="h-3 w-3" />
                                              </Button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                {isExpanded &&
                                  row.txType !== "BALE_STOCK_ENTRY" &&
                                  expandedEntries.map((entry) => {
                                    const de = entry as DisplayEntry;
                                    const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                                    const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
                                    const canEdit =
                                      !!VOUCHER_TX_TYPES[entry.txType] &&
                                      !!entry.referenceId &&
                                      entry.txType !== "BALE_STOCK_ENTRY";
                                    const inlineMeta = (() => {
                                      try {
                                        return JSON.parse(entry.metaJson || "{}");
                                      } catch {
                                        return {};
                                      }
                                    })();
                                    let pencilTarget: string | null = null;
                                    if (entry.txType === "CONTAINER_IMPORT" && entry.referenceId)
                                      pencilTarget = `/factory/containers?edit=${entry.referenceId}`;
                                    else if (entry.txType === "OFFLOAD_RAW_STOCK" && inlineMeta.containerId)
                                      pencilTarget = `/factory/containers?edit=${inlineMeta.containerId}`;
                                    else if (entry.txType === "COMMISSION" && inlineMeta.containerId)
                                      pencilTarget = `/factory/containers?edit=${inlineMeta.containerId}`;
                                    else if (entry.txType === "OTHER_CHARGE" && entry.referenceId)
                                      pencilTarget = `/factory/containers?edit=${entry.referenceId}`;
                                    const showPencil = pencilTarget && isAdminOrOwner;
                                    return (
                                      <div
                                        key={de._vKey ?? entry.id}
                                        data-testid={`row-expanded-${entry.id}`}
                                        onClick={isBaleTransfer ? (e) => handleEntryClick(entry, e) : undefined}
                                        className={cn(
                                          "grid w-full bg-muted/20 border-t items-center",
                                          colsClass,
                                          isBaleTransfer && "cursor-pointer"
                                        )}
                                      >
                                        {/* Description — deep indent to align under badge */}
                                        <div className="pl-14 pr-2 py-2 min-w-0">
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <span
                                              className="text-sm text-foreground truncate"
                                              title={formatDaybookDescription(entry)}
                                            >
                                              {formatDaybookDescription(entry)}
                                            </span>
                                            {entry.optional && (
                                              <Badge
                                                variant="outline"
                                                className="text-muted-foreground text-xs shrink-0"
                                                data-testid={`badge-optional-${entry.id}`}
                                              >
                                                Optional
                                              </Badge>
                                            )}
                                          </div>
                                        </div>
                                        {/* Empty count cell */}
                                        <div />
                                        {/* Amount + actions */}
                                        {showAmounts ? (
                                          <div className="flex items-center justify-end gap-1 pr-2 py-2">
                                            <span className="text-sm font-mono font-medium">
                                              {currencySymbol(entry.currencyCode)}
                                              {formatNumber(parseFloat(entry.amountCurrency))}
                                            </span>
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              title="View details"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setViewEntry((de._source ?? entry) as DaybookEntry);
                                              }}
                                              data-testid={`button-view-${entry.id}`}
                                            >
                                              <Eye className="h-3 w-3" />
                                            </Button>
                                            {showPencil && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="Go to container"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  navigate(pencilTarget!);
                                                }}
                                                data-testid={`button-pencil-${entry.id}`}
                                              >
                                                <Pencil className="h-3 w-3 text-amber-500" />
                                              </Button>
                                            )}
                                            {canEdit && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="Edit"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  editSourceRecord(entry);
                                                }}
                                                data-testid={`button-edit-source-${entry.id}`}
                                              >
                                                <ExternalLink className="h-3 w-3" />
                                              </Button>
                                            )}
                                            {isAdminOrOwner &&
                                              isVoucherBacked &&
                                              ["PAYMENT", "RECEIPT", "JOURNAL"].includes(entry.txType) && (
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  title="Void"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setVoidEntry(entry);
                                                  }}
                                                  data-testid={`button-void-voucher-${entry.id}`}
                                                >
                                                  <Trash2 className="h-3 w-3" />
                                                </Button>
                                              )}
                                            {/* Hard-delete button for non-voucher entries (admin/developer only).
                                            SUPPLIER_FX_TRANSFER must be deleted from the supplier management
                                            page so the underlying transfer record is also removed. */}
                                            {isAdminOrOwner &&
                                              entry.id > 0 &&
                                              entry.txType !== "SUPPLIER_FX_TRANSFER" &&
                                              !(
                                                isVoucherBacked &&
                                                ["PAYMENT", "RECEIPT", "JOURNAL"].includes(entry.txType)
                                              ) && (
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  title="Delete entry"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteEntry(de._source as DaybookEntry);
                                                  }}
                                                  data-testid={`button-delete-${entry.id}`}
                                                >
                                                  <Trash2 className="h-3 w-3 text-destructive/70" />
                                                </Button>
                                              )}
                                          </div>
                                        ) : (
                                          <div className="flex items-center justify-end gap-1 pr-2 py-2">
                                            <Button
                                              size="icon"
                                              variant="ghost"
                                              title="View details"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setViewEntry((de._source ?? entry) as DaybookEntry);
                                              }}
                                              data-testid={`button-view-${entry.id}`}
                                            >
                                              <Eye className="h-3 w-3" />
                                            </Button>
                                            {showPencil && (
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                title="Go to container"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  navigate(pencilTarget!);
                                                }}
                                                data-testid={`button-pencil-${entry.id}`}
                                              >
                                                <Pencil className="h-3 w-3 text-amber-500" />
                                              </Button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog
            open={editEntry !== null}
            onOpenChange={(open) => {
              if (!open) setEditEntry(null);
            }}
          >
            <DialogContent data-testid="dialog-edit-daybook">
              <DialogHeader>
                <DialogTitle>Edit Daybook Entry</DialogTitle>
                <DialogDescription>
                  Modify the entry details. A reason is required for the audit trail.
                </DialogDescription>
              </DialogHeader>
              {editEntry &&
                (() => {
                  const isVoucherBacked = editEntry.referenceTable === "vouchers" || editEntry.id < 0;
                  return (
                    <div className="space-y-4">
                      {isVoucherBacked && (
                        <div
                          className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                          data-testid="note-voucher-sync"
                        >
                          Saving will update the description on the linked voucher, so Accounts statements stay in sync.
                          To change amounts, use the source record edit button.
                        </div>
                      )}
                      <div>
                        <Label className="text-sm font-medium">Description</Label>
                        <Textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          data-testid="input-edit-description"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Date</Label>
                        <Input
                          type="date"
                          value={editTxDate}
                          onChange={(e) => setEditTxDate(e.target.value)}
                          data-testid="input-edit-tx-date"
                        />
                      </div>
                      {!isVoucherBacked && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-sm font-medium">Amount ({editEntry.currencyCode})</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={editAmountCurrency}
                              onChange={(e) => setEditAmountCurrency(e.target.value)}
                              data-testid="input-edit-amount-currency"
                            />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">Amount (USD)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={editAmountUsd}
                              onChange={(e) => setEditAmountUsd(e.target.value)}
                              data-testid="input-edit-amount-usd"
                            />
                          </div>
                        </div>
                      )}
                      <div>
                        <Label className="text-sm font-medium">Reason for edit *</Label>
                        <Textarea
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                          placeholder="Why is this change needed?"
                          data-testid="input-edit-reason"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="button-cancel-edit">
                          Cancel
                        </Button>
                        <Button
                          disabled={!editReason.trim() || editMutation.isPending}
                          onClick={() => wrapAdminAction(handleEditSubmit, "Edit Entry")}
                          data-testid="button-submit-edit"
                        >
                          {editMutation.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
            </DialogContent>
          </Dialog>

          {/* View Details Modal */}
          <Dialog
            open={viewEntry !== null}
            onOpenChange={(open) => {
              if (!open) setViewEntry(null);
            }}
          >
            <DialogContent
              className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto"
              data-testid="dialog-view-entry"
            >
              {viewEntry && (
                <ViewEntryModal
                  entry={viewEntry}
                  onClose={() => setViewEntry(null)}
                  onNavigate={navigate}
                  formatDisplayDate={formatDisplayDate}
                />
              )}
            </DialogContent>
          </Dialog>

          {/* Void Alert */}
          <AlertDialog
            open={voidEntry !== null}
            onOpenChange={(open) => {
              if (!open) setVoidEntry(null);
            }}
          >
            <AlertDialogContent data-testid="dialog-void-voucher">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this voucher?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will reverse all accounting entries. This action cannot be undone.
                  {voidEntry && <span className="block mt-2 font-medium text-foreground">{voidEntry.description}</span>}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-void">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => wrapAdminAction(() => voidEntry && voidMutation.mutate(voidEntry.id), "Void Entry")}
                  disabled={voidMutation.isPending}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-confirm-void"
                >
                  {voidMutation.isPending ? "Voiding..." : "Void Voucher"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {/* Hard Delete Alert */}
          <AlertDialog
            open={deleteEntry !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteEntry(null);
            }}
          >
            <AlertDialogContent data-testid="dialog-delete-entry">
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently delete this entry?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove the daybook entry. This action cannot be undone.
                  {deleteEntry && (
                    <span className="block mt-2 font-medium text-foreground">
                      {formatDaybookDescription(deleteEntry)}
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteEntry && deleteMutation.mutate(deleteEntry.id)}
                  disabled={deleteMutation.isPending}
                  className="bg-destructive text-destructive-foreground"
                  data-testid="button-confirm-delete"
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete Entry"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Cost Edit Dialog */}
          <Dialog
            open={costEditEntry !== null}
            onOpenChange={(open) => {
              if (!open) setCostEditEntry(null);
            }}
          >
            <DialogContent className="max-w-md" data-testid="dialog-cost-edit-daybook">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-amber-500" />
                  Edit Container Cost
                </DialogTitle>
                <DialogDescription>
                  {costEditEntry &&
                    (() => {
                      const txLabels: Record<string, string> = {
                        OFFLOAD_RAW_STOCK: "Total inclusive cost (base material)",
                        FREIGHT: "Freight charge",
                        COMMISSION: "Commission",
                        DUTY: "Duty",
                        OTHER_CHARGE: "Other charge / additional charge",
                      };
                      return `${txLabels[costEditEntry.txType] || costEditEntry.txType} — ${costEditEntry.description}`;
                    })()}
                </DialogDescription>
              </DialogHeader>
              {costEditEntry &&
                (() => {
                  const isDuty = costEditEntry.txType === "DUTY";
                  const isBaseMaterial = costEditEntry.txType === "OFFLOAD_RAW_STOCK";
                  return (
                    <div className="space-y-4 py-1">
                      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 p-3 text-sm space-y-1">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                          <div className="space-y-1">
                            <p className="font-medium">This will cascade to inventory costs.</p>
                            <p>
                              Saving updates the raw stock cost per kg and recalculates the weighted-average cost of all
                              mix batches that used this container.
                            </p>
                            {isBaseMaterial && (
                              <p>Editing the total cost will back-calculate a new base rate per kg.</p>
                            )}
                            {isDuty && (
                              <p>Only confirmed duty can be edited here. A duty audit log entry will be written.</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Current amount ({costEditEntry.currencyCode})</Label>
                        <div className="text-sm text-muted-foreground font-mono mt-0.5">
                          {formatNumber(parseFloat(costEditEntry.amountCurrency || "0"), 2)}{" "}
                          {costEditEntry.currencyCode}
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">New amount ({costEditEntry.currencyCode}) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={costEditAmount}
                          onChange={(e) => setCostEditAmount(e.target.value)}
                          placeholder="Enter corrected amount"
                          data-testid="input-cost-edit-amount"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Reason for edit *</Label>
                        <Textarea
                          value={costEditReason}
                          onChange={(e) => setCostEditReason(e.target.value)}
                          placeholder="Why is this correction needed?"
                          data-testid="input-cost-edit-reason"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setCostEditEntry(null)}
                          data-testid="button-cancel-cost-edit"
                        >
                          Cancel
                        </Button>
                        <Button
                          disabled={!costEditReason.trim() || !costEditAmount || costEditMutation.isPending}
                          onClick={() => {
                            if (!costEditEntry) return;
                            costEditMutation.mutate({
                              entryId: costEditEntry.id,
                              newAmount: costEditAmount,
                              reason: costEditReason.trim(),
                            });
                          }}
                          data-testid="button-submit-cost-edit"
                        >
                          {costEditMutation.isPending ? "Saving..." : "Save & Recalculate"}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="activity" className="mt-2">
          {activeDaybookTab === "activity" && <AuditLog context="daybook" defaultActions="all" />}
        </TabsContent>
      </Tabs>

      {AdminDialog}
    </div>
  );
}
