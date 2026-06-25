import { useState, useMemo, Fragment, useCallback, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Plus,
  ChevronDown,
  ChevronRight,
  Container,
  CheckCircle2,
  Lock,
  Pencil,
  X,
  Link2,
  FileDown,
  RotateCcw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import CreateProformaV5Drawer from "./CreateProformaV5Drawer";
import EditProformaV5Drawer from "./EditProformaV5Drawer";
import { PageHeader } from "@/components/PageHeader";

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface ContainerDetail {
  orderId: number;
  containerName: string;
  status: string;
  expectedQty: number;
  loadedQty: number;
  remainingQty: number;
}
interface ProformaDetail {
  proformaId: number;
  proformaName: string;
  customerId: number;
  customerName: string;
  lineQty: number;
  containerCount: number;
  totalExpected: number;
  containers: ContainerDetail[];
}
interface V5Row {
  articleCode: string;
  productName: string;
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  totalKg: number;
  proformaDetails: ProformaDetail[];
  isGarbageOrWipers?: boolean;
}
interface V5Totals {
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  totalKg: number;
  shortageCount: number;
}
interface V5Data {
  rows: V5Row[];
  totals: V5Totals;
  productNames: Record<string, string>;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  LOADING: "Loading",
  PENDING_VERIFICATION: "Verified",
  VERIFIED: "Verified",
  FINALIZED: "Finalized",
  CANCELLED: "Cancelled",
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function FactoryStockAllocationV5() {
  const { toast } = useToast();
  const searchString = useSearch();
  const focusProformaId = useMemo(() => {
    const p = new URLSearchParams(searchString).get("proformaId");
    return p ? parseInt(p) : null;
  }, [searchString]);

  const openEditOnLoad = useMemo(() => {
    return new URLSearchParams(searchString).get("openEdit") === "true";
  }, [searchString]);

  const firstMatchRef = useRef<HTMLTableRowElement | null>(null);

  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [editDrawerProformaId, setEditDrawerProformaId] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [hideZero, setHideZero] = useState(true);
  const [showNegativeOnly, setShowNegativeOnly] = useState(false);
  const [showGarbageWipers, setShowGarbageWipers] = useState(false);
  const [refreshFlash, setRefreshFlash] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Export dialog state ─────────────────────────────────────────────────── */
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportIncludePositive, setExportIncludePositive] = useState(true);
  const [exportIncludeNegative, setExportIncludeNegative] = useState(true);
  const [exportIncludeZero, setExportIncludeZero] = useState(false);

  /* ── Add-Containers dialog state ────────────────────────────────────────── */
  const [addCtDialog, setAddCtDialog] = useState<{
    proformaId: number;
    proformaName: string;
    existingCount: number;
  } | null>(null);
  const [ctCount, setCtCount] = useState(1);
  const [ctNames, setCtNames] = useState<string[]>([]);

  function openAddContainers(proformaId: number, proformaName: string, existingCount: number) {
    setAddCtDialog({ proformaId, proformaName, existingCount });
    setCtCount(1);
    setCtNames([`Container ${existingCount + 1}`]);
  }

  function handleCtCountChange(val: number) {
    const n = Math.max(1, Math.min(50, val || 1));
    setCtCount(n);
    setCtNames((prev) => {
      const base = addCtDialog?.existingCount ?? 0;
      if (n > prev.length) {
        const extra = Array.from({ length: n - prev.length }, (_, i) => `Container ${base + prev.length + i + 1}`);
        return [...prev, ...extra];
      }
      return prev.slice(0, n);
    });
  }

  function handleCtNameChange(idx: number, val: string) {
    setCtNames((prev) => prev.map((n, i) => (i === idx ? val : n)));
  }

  const addContainersMut = useMutation({
    mutationFn: ({ proformaId, names }: { proformaId: number; names: string[] }) =>
      apiRequest("POST", `/api/factory/v5/proforma/${proformaId}/add-containers`, { containerNames: names }),
    onSuccess: (_data, { names }) => {
      toast({ title: `Added ${names.length} container${names.length !== 1 ? "s" : ""}.` });
      setAddCtDialog(null);
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error adding containers", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  function submitAddContainers() {
    if (!addCtDialog) return;
    const trimmed = ctNames.map((n) => n.trim());
    if (trimmed.some((n) => !n)) {
      toast({ title: "Validation error", description: "Container names must not be empty.", variant: "destructive" });
      return;
    }
    const uniq = new Set(trimmed);
    if (uniq.size !== trimmed.length) {
      toast({ title: "Validation error", description: "Container names must be unique.", variant: "destructive" });
      return;
    }
    addContainersMut.mutate({ proformaId: addCtDialog.proformaId, names: trimmed });
  }

  /* ── Close-Proforma dialog state ─────────────────────────────────────────── */
  const [closeDialog, setCloseDialog] = useState<{
    proformaId: number;
    proformaName: string;
  } | null>(null);

  const closeProformaMut = useMutation({
    mutationFn: (proformaId: number) => apiRequest("PATCH", `/api/factory/v5/proforma/${proformaId}/close`, {}),
    onSuccess: () => {
      toast({ title: "Proforma closed." });
      setCloseDialog(null);
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error closing proforma", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  /* ── Edit-Draft-Quantities dialog state ─────────────────────────────────── */
  interface EditDraftArticle {
    articleCode: string;
    productName: string;
    currentExpectedQty: number;
    eligibleCount: number; // DRAFT containers with 0 loadedQty for this article
  }
  const [editDraftDialog, setEditDraftDialog] = useState<{
    proformaId: number;
    proformaName: string;
    articles: EditDraftArticle[];
  } | null>(null);
  const [editDraftQtys, setEditDraftQtys] = useState<Record<string, number>>({});

  function openEditDraft(proformaId: number, proformaName: string, currentRows: V5Row[]) {
    const articles: EditDraftArticle[] = [];
    for (const row of currentRows) {
      const pd = row.proformaDetails.find((p) => p.proformaId === proformaId);
      if (!pd) continue;
      const eligible = pd.containers.filter((c) => c.status === "DRAFT" && c.loadedQty === 0);
      if (eligible.length === 0) continue;
      articles.push({
        articleCode: row.articleCode,
        productName: row.productName,
        currentExpectedQty: eligible[0].expectedQty,
        eligibleCount: eligible.length,
      });
    }
    setEditDraftDialog({ proformaId, proformaName, articles });
    const initQtys: Record<string, number> = {};
    articles.forEach((a) => {
      initQtys[a.articleCode] = a.currentExpectedQty;
    });
    setEditDraftQtys(initQtys);
  }

  const editDraftMut = useMutation({
    mutationFn: ({
      proformaId,
      updates,
    }: {
      proformaId: number;
      updates: { articleCode: string; expectedQty: number }[];
    }) => apiRequest("PATCH", `/api/factory/v5/proforma/${proformaId}/draft-expected-lines`, { updates }),
    onSuccess: (data: any) => {
      toast({ title: `Draft quantities updated (${data?.updated ?? 0} lines changed).` });
      setEditDraftDialog(null);
      query.refetch();
    },
    onError: (err: any) => {
      toast({
        title: "Error updating quantities",
        description: err.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  function submitEditDraft() {
    if (!editDraftDialog) return;
    const updates = editDraftDialog.articles.map((a) => ({
      articleCode: a.articleCode,
      expectedQty: editDraftQtys[a.articleCode] ?? a.currentExpectedQty,
    }));
    const invalid = updates.find((u) => !Number.isInteger(u.expectedQty) || u.expectedQty < 0);
    if (invalid) {
      toast({
        title: "Validation error",
        description: "Quantities must be non-negative integers.",
        variant: "destructive",
      });
      return;
    }
    editDraftMut.mutate({ proformaId: editDraftDialog.proformaId, updates });
  }

  /* ── Link-Existing-Container dialog state ───────────────────────────────── */
  interface UnlinkedOrder {
    id: number;
    containerNumber: string;
    status: string;
    customerId: number | null;
    customerName: string;
    createdAt: string;
    loadedBaleCount: number;
  }
  const [linkDialog, setLinkDialog] = useState<{
    proformaId: number;
    proformaName: string;
    proformaCustomerId: number | null;
  } | null>(null);
  const [linkSelected, setLinkSelected] = useState<Set<number>>(new Set());

  const unlinkedQuery = useQuery<{ orders: UnlinkedOrder[] }>({
    queryKey: ["/api/factory/v5/unlinked-loading-orders"],
    queryFn: async () => {
      const res = await fetch("/api/factory/v5/unlinked-loading-orders", { credentials: "include" });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed");
      }
      return res.json();
    },
    enabled: !!linkDialog,
    staleTime: 15000,
  });

  const linkMut = useMutation({
    mutationFn: async ({ proformaId, orderIds }: { proformaId: number; orderIds: number[] }) => {
      const results = [];
      for (const orderId of orderIds) {
        const r = await apiRequest("PATCH", `/api/factory/customer-orders/${orderId}/link-proforma`, { proformaId });
        results.push(r);
      }
      return results;
    },
    onSuccess: (_data, { orderIds }) => {
      toast({ title: `Linked ${orderIds.length} container${orderIds.length !== 1 ? "s" : ""} to proforma.` });
      setLinkDialog(null);
      setLinkSelected(new Set());
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Linking failed", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  /* ── Restore-Cancelled-Container dialog state ────────────────────────────── */
  interface CancelledContainerRow {
    id: number;
    containerNumber: string;
    customerName: string;
    cancelledAt: string;
    wasLoading: boolean;
    proformaId: number | null;
    proformaName: string | null;
  }
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);

  const cancelledContainersQuery = useQuery<{ orders: CancelledContainerRow[] }>({
    queryKey: ["/api/factory/v5/recently-cancelled-containers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/v5/recently-cancelled-containers", { credentials: "include" });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed");
      }
      return res.json();
    },
    enabled: restoreDialogOpen,
    staleTime: 15000,
  });

  const restoreContainerMut = useMutation({
    mutationFn: (orderId: number) => apiRequest("POST", `/api/factory/v5/containers/${orderId}/restore`, {}),
    onSuccess: (data: any) => {
      toast({ title: `Container restored to ${data?.restoredTo === "LOADING" ? "Loading" : "Draft"}.` });
      cancelledContainersQuery.refetch();
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Restore failed", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  /* ── Cancel-Container dialog state ──────────────────────────────────────── */
  const [cancelDialog, setCancelDialog] = useState<{
    orderId: number;
    containerName: string;
    status: "DRAFT" | "LOADING";
  } | null>(null);
  const [cancelSuperUser, setCancelSuperUser] = useState("");
  const [cancelSuperPass, setCancelSuperPass] = useState("");

  const cancelContainerMut = useMutation({
    mutationFn: ({
      orderId,
      supervisorUsername,
      supervisorPassword,
    }: {
      orderId: number;
      supervisorUsername?: string;
      supervisorPassword?: string;
    }) =>
      apiRequest("POST", `/api/factory/customer-orders/${orderId}/cancel`, {
        ...(supervisorUsername ? { supervisorUsername, supervisorPassword } : {}),
      }),
    onSuccess: () => {
      toast({ title: "Container cancelled." });
      setCancelDialog(null);
      setCancelSuperUser("");
      setCancelSuperPass("");
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Cancel failed", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  /* ── Query ──────────────────────────────────────────────────────────────── */
  const query = useQuery<V5Data>({
    queryKey: ["/api/factory/v5/stock-allocation", hideZero],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (hideZero) params.set("hideZero", "true");
      const res = await fetch(`/api/factory/v5/stock-allocation?${params}`, { credentials: "include" });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed");
      }
      return res.json();
    },
    retry: 1,
  });

  function isGarbageOrWipers(row: V5Row) {
    if (row.isGarbageOrWipers !== undefined) return row.isGarbageOrWipers;
    const n = row.productName.toLowerCase();
    return n.includes("wiper") || n.includes("garbage");
  }

  const allRows = (query.data?.rows ?? []).slice().sort((a, b) => a.productName.localeCompare(b.productName));
  const garbageWipersCount = allRows.filter(isGarbageOrWipers).length;
  const filteredRows = showGarbageWipers ? allRows : allRows.filter((r) => !isGarbageOrWipers(r));
  const negativeFilteredRows = showNegativeOnly ? filteredRows.filter((r) => r.freeToPromise < 0) : filteredRows;
  const rows = searchQuery.trim()
    ? negativeFilteredRows.filter((r) => {
        const q = searchQuery.toLowerCase();
        return r.productName.toLowerCase().includes(q) || r.articleCode.toLowerCase().includes(q);
      })
    : negativeFilteredRows;
  const totals = query.data?.totals;

  // Auto-expand rows that contain the focused proforma, then scroll to first match
  useEffect(() => {
    if (!focusProformaId || rows.length === 0) return;
    const toExpand = rows
      .filter((r) => r.proformaDetails.some((p) => p.proformaId === focusProformaId))
      .map((r) => r.articleCode);
    if (toExpand.length === 0) return;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      toExpand.forEach((c) => next.add(c));
      return next;
    });
    // Scroll after a tick so the rows have rendered
    setTimeout(() => {
      firstMatchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [focusProformaId, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open edit drawer when navigated here with openEdit=true
  const editOpenedRef = useRef(false);
  useEffect(() => {
    if (!openEditOnLoad || !focusProformaId || rows.length === 0 || editOpenedRef.current) return;
    editOpenedRef.current = true;
    setEditDrawerProformaId(focusProformaId);
  }, [openEditOnLoad, focusProformaId, rows.length]);

  const handleRefresh = useCallback(() => {
    query.refetch().then(() => {
      setRefreshFlash(true);
      setTimeout(() => setRefreshFlash(false), 1500);
    });
  }, [query]);

  function toggleRow(code: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  /* ── Excel export ────────────────────────────────────────────────────────── */
  async function handleExportExcel() {
    const XLSX = (await import("xlsx-js-style")).default;

    const filtered = rows.filter((r) => {
      if (r.freeToPromise > 0) return exportIncludePositive;
      if (r.freeToPromise < 0) return exportIncludeNegative;
      return exportIncludeZero;
    });

    // ── colour helpers ──────────────────────────────────────────────────────
    const headerFill = { patternType: "solid", fgColor: { rgb: "1E293B" } };
    const headerFont = { bold: true, color: { rgb: "F8FAFC" }, sz: 10 };
    const positiveFill = { patternType: "solid", fgColor: { rgb: "DCFCE7" } };
    const negativeFill = { patternType: "solid", fgColor: { rgb: "FEE2E2" } };
    const neutralFill = { patternType: "solid", fgColor: { rgb: "F1F5F9" } };
    const monoFont = { name: "Courier New", sz: 10 };
    const border = {
      top: { style: "thin", color: { rgb: "CBD5E1" } },
      bottom: { style: "thin", color: { rgb: "CBD5E1" } },
      left: { style: "thin", color: { rgb: "CBD5E1" } },
      right: { style: "thin", color: { rgb: "CBD5E1" } },
    };

    function hCell(v: string) {
      return {
        v,
        t: "s",
        s: { fill: headerFill, font: headerFont, alignment: { horizontal: "center", vertical: "center" }, border },
      };
    }
    function numCell(v: number, fill?: object, color?: string) {
      return {
        v,
        t: "n",
        s: {
          font: { ...monoFont, ...(color ? { color: { rgb: color } } : {}) },
          fill: fill ?? { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
          alignment: { horizontal: "right" },
          border,
        },
      };
    }
    function txtCell(v: string, bold = false) {
      return { v, t: "s", s: { font: { sz: 10, bold }, alignment: { horizontal: "left", wrapText: true }, border } };
    }

    const headerRow = [
      hCell("Article Code"),
      hCell("Product Name"),
      hCell("Stock Available"),
      hCell("Expected to Load"),
      hCell("Total Loaded"),
      hCell("Available Balance"),
    ];

    const dataRows = filtered.map((r) => {
      const bal = r.freeToPromise;
      const balFill = bal > 0 ? positiveFill : bal < 0 ? negativeFill : neutralFill;
      const balColor = bal > 0 ? "15803D" : bal < 0 ? "DC2626" : "64748B";
      return [
        txtCell(r.articleCode, true),
        txtCell(r.productName),
        numCell(r.stockAvailable, { patternType: "solid", fgColor: { rgb: "FFFFFF" } }, "15803D"),
        numCell(r.expectedToLoad, { patternType: "solid", fgColor: { rgb: "FFFFFF" } }, "D97706"),
        numCell(r.totalLoaded, { patternType: "solid", fgColor: { rgb: "FFFFFF" } }, "2563EB"),
        numCell(bal, balFill, balColor),
      ];
    });

    // Totals row
    const totalsBal = filtered.reduce((s, r) => s + r.freeToPromise, 0);
    const totalsRow = [
      {
        v: "TOTALS",
        t: "s",
        s: {
          font: { bold: true, sz: 10 },
          fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
          alignment: { horizontal: "left" },
          border,
        },
      },
      {
        v: `${filtered.length} products`,
        t: "s",
        s: {
          font: { sz: 10, color: { rgb: "64748B" } },
          fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
          alignment: { horizontal: "left" },
          border,
        },
      },
      numCell(
        filtered.reduce((s, r) => s + r.stockAvailable, 0),
        { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        "15803D"
      ),
      numCell(
        filtered.reduce((s, r) => s + r.expectedToLoad, 0),
        { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        "D97706"
      ),
      numCell(
        filtered.reduce((s, r) => s + r.totalLoaded, 0),
        { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        "2563EB"
      ),
      numCell(
        totalsBal,
        { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
        totalsBal < 0 ? "DC2626" : totalsBal > 0 ? "15803D" : "64748B"
      ),
    ];

    const wsData = [headerRow, ...dataRows, totalsRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 16 }, // Article Code
      { wch: 36 }, // Product Name
      { wch: 16 }, // Stock Available
      { wch: 18 }, // Expected to Load
      { wch: 14 }, // Total Loaded
      { wch: 18 }, // Available Balance
    ];
    ws["!rows"] = [{ hpt: 22 }, ...dataRows.map(() => ({ hpt: 18 })), { hpt: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock Allocation");

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `stock_allocation_${stamp}.xlsx`);
    setExportDialogOpen(false);
  }

  /* ── Article rows for the drawer ──────────────────────────────────────── */
  const drawerRows = useMemo(
    () =>
      allRows.map((r) => ({
        articleCode: r.articleCode,
        productName: r.productName,
        stockAvailable: r.stockAvailable,
        totalLoaded: r.totalLoaded,
        expectedToLoad: r.expectedToLoad,
        freeToPromise: r.freeToPromise,
      })),
    [allRows]
  );

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <PageHeader title="Stock Allocation" />
          <Badge variant="secondary" className="text-[11px] font-semibold tracking-wide">
            v5
          </Badge>
          {totals && totals.shortageCount > 0 && (
            <Badge variant="destructive" className="text-[11px] gap-1">
              <AlertTriangle className="h-3 w-3" />
              {totals.shortageCount} shortage{totals.shortageCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product or code…"
              className="pl-8 h-9 w-52 text-sm"
              data-testid="input-v5-search"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate rounded"
                data-testid="button-v5-clear-search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={hideZero ? "default" : "outline"}
            size="sm"
            onClick={() => setHideZero((v) => !v)}
            data-testid="button-v5-toggle-zero"
          >
            {hideZero ? "Show Zero Rows" : "Hide Zero Rows"}
          </Button>
          <Button
            variant={showNegativeOnly ? "destructive" : "outline"}
            size="sm"
            onClick={() => setShowNegativeOnly((v) => !v)}
            data-testid="button-v5-toggle-negative-only"
          >
            {showNegativeOnly ? `Negative Only (${rows.length})` : "Negative Only"}
          </Button>
          <Button
            variant={showGarbageWipers ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowGarbageWipers((v) => !v)}
            data-testid="button-v5-toggle-garbage-wipers"
          >
            {showGarbageWipers
              ? `Hide Garbage/Wipers (${garbageWipersCount})`
              : `Show Garbage/Wipers${garbageWipersCount > 0 ? ` (${garbageWipersCount})` : ""}`}
          </Button>

          <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setExportDialogOpen(true)}
                disabled={rows.length === 0}
                data-testid="button-v5-export-excel"
              >
                <FileDown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export Excel</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setRestoreDialogOpen(true)}
                data-testid="button-v5-restore-cancelled"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Restore Cancelled</TooltipContent>
          </Tooltip>

          <Button size="sm" onClick={() => setCreateDrawerOpen(true)} data-testid="button-v5-open-create-proforma">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Proforma
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={refreshFlash ? "secondary" : "outline"}
                size="icon"
                onClick={handleRefresh}
                disabled={query.isFetching}
                data-testid="button-v5-refresh"
                className={cn(refreshFlash && "ring-2 ring-primary/40")}
              >
                {refreshFlash ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{refreshFlash ? "Refreshed" : "Refresh"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      {query.isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">{(query.error as Error)?.message || "Failed to load."}</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No data found. Create a proforma with containers to use V5 stock allocation.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border max-h-[calc(100vh-180px)]">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead>
              <tr className="bg-muted sticky top-0 z-30">
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[200px]">
                  Product
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[120px]">
                  Stock Available
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[130px] text-amber-600 dark:text-amber-400">
                  Expected to Load
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[110px] text-blue-600 dark:text-blue-400">
                  Total Loaded
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[140px]">
                  Available Balance
                </th>
                <th className="text-center px-3 py-2.5 font-medium border-b whitespace-nowrap min-w-[70px]">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isExpanded = expandedRows.has(row.articleCode);
                const isShortage = row.freeToPromise < 0;

                return (
                  // Issue 7 fix: key on Fragment to avoid React warning
                  <Fragment key={row.articleCode}>
                    <tr
                      className={cn(
                        "border-b transition-colors",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                        isShortage && "bg-destructive/5"
                      )}
                      data-testid={`row-v5-${row.articleCode}`}
                    >
                      <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                        <div className="flex items-center gap-1.5">
                          {isShortage && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <div>
                            <div
                              className="font-medium text-xs leading-tight truncate max-w-[200px]"
                              title={row.productName}
                            >
                              {row.productName}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">{row.articleCode}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-xs">
                        {row.stockAvailable > 0 ? (
                          <span className="text-green-700 dark:text-green-400 font-medium">{row.stockAvailable}</span>
                        ) : (
                          <span className="text-muted-foreground/40">0</span>
                        )}
                      </td>

                      <td
                        className={cn(
                          "px-3 py-2 border-r text-right font-mono tabular-nums text-xs",
                          row.expectedToLoad > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/40"
                        )}
                      >
                        {row.expectedToLoad > 0 ? row.expectedToLoad : "0"}
                      </td>

                      <td
                        className={cn(
                          "px-3 py-2 border-r text-right font-mono tabular-nums text-xs",
                          row.totalLoaded > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/40"
                        )}
                      >
                        {row.totalLoaded > 0 ? row.totalLoaded : <span className="text-muted-foreground/40">—</span>}
                      </td>

                      <td
                        className={cn(
                          "px-3 py-2 border-r text-right font-mono tabular-nums text-xs font-semibold",
                          row.freeToPromise < 0
                            ? "text-destructive"
                            : row.freeToPromise === 0
                              ? "text-muted-foreground"
                              : "text-green-700 dark:text-green-400"
                        )}
                      >
                        <span className="flex items-center justify-end gap-1">
                          {isShortage && <AlertTriangle className="h-3 w-3" />}
                          {row.freeToPromise > 0 ? `+${row.freeToPromise}` : row.freeToPromise}
                        </span>
                        {isShortage && (
                          <div className="text-[10px] text-destructive/80 font-normal text-right">
                            need {Math.abs(row.freeToPromise)} more
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 text-center">
                        {row.proformaDetails.length > 0 ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleRow(row.articleCode)}
                            data-testid={`button-v5-expand-${row.articleCode}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable proforma/container detail */}
                    {isExpanded &&
                      row.proformaDetails.map((proforma) => {
                        // Only show active (non-finalized, non-cancelled) containers
                        const activeContainers = proforma.containers.filter(
                          (c) => c.status !== "FINALIZED" && c.status !== "CANCELLED"
                        );

                        const isFocused = focusProformaId === proforma.proformaId;
                        const isFirstFocused = isFocused && !firstMatchRef.current;

                        return (
                          <tr
                            key={`${row.articleCode}-p${proforma.proformaId}`}
                            ref={
                              isFirstFocused
                                ? (el) => {
                                    firstMatchRef.current = el;
                                  }
                                : undefined
                            }
                            className={cn(
                              "border-b",
                              isFocused ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "bg-muted/30"
                            )}
                          >
                            <td colSpan={5} className="px-0 py-0">
                              <div className="px-8 py-2">
                                <div className="flex items-center gap-2 mb-1.5 text-xs flex-wrap">
                                  <span className={cn("font-semibold", isFocused && "text-primary")}>
                                    {proforma.proformaName}
                                  </span>
                                  <span className="text-muted-foreground">—</span>
                                  <span className="text-muted-foreground">{proforma.customerName}</span>
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                                    {proforma.containerCount} container{proforma.containerCount !== 1 ? "s" : ""}
                                  </Badge>
                                  <span className="text-muted-foreground">
                                    {proforma.lineQty} × {proforma.containerCount} =
                                    <span className="font-semibold text-amber-600 dark:text-amber-400 ml-1">
                                      {proforma.totalExpected} expected
                                    </span>
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-2 text-[10px]"
                                    data-testid={`button-v5-add-containers-${proforma.proformaId}`}
                                    onClick={() =>
                                      openAddContainers(
                                        proforma.proformaId,
                                        proforma.proformaName,
                                        proforma.containerCount
                                      )
                                    }
                                  >
                                    <Plus className="h-2.5 w-2.5 mr-1" />
                                    Add Containers
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-2 text-[10px]"
                                    data-testid={`button-v5-link-container-${proforma.proformaId}`}
                                    onClick={() => {
                                      setLinkSelected(new Set());
                                      setLinkDialog({
                                        proformaId: proforma.proformaId,
                                        proformaName: proforma.proformaName,
                                        proformaCustomerId: proforma.customerId ?? null,
                                      });
                                    }}
                                  >
                                    <Link2 className="h-2.5 w-2.5 mr-1" />
                                    Link Existing
                                  </Button>
                                  {/* Edit Proforma — opens in-page edit drawer */}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-2 text-[10px]"
                                    data-testid={`button-v5-edit-proforma-${proforma.proformaId}`}
                                    onClick={() => setEditDrawerProformaId(proforma.proformaId)}
                                  >
                                    <Pencil className="h-2.5 w-2.5 mr-1" />
                                    Edit Proforma
                                  </Button>
                                  {/* Edit Draft Quantities — only when at least one DRAFT container has 0 loaded bales */}
                                  {activeContainers.some((c) => c.status === "DRAFT" && c.loadedQty === 0) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-5 px-2 text-[10px]"
                                      data-testid={`button-v5-edit-draft-${proforma.proformaId}`}
                                      onClick={() => openEditDraft(proforma.proformaId, proforma.proformaName, rows)}
                                    >
                                      <Pencil className="h-2.5 w-2.5 mr-1" />
                                      Edit Draft Qty
                                    </Button>
                                  )}
                                </div>

                                {activeContainers.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {activeContainers.map((c) => (
                                      <div
                                        key={c.orderId}
                                        className="flex items-center gap-1.5 bg-background border rounded-md px-2 py-1 text-xs"
                                        data-testid={`detail-v5-container-${c.orderId}`}
                                      >
                                        <Container className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="font-medium">{c.containerName}</span>
                                        <Badge variant="outline" className="text-[9px] h-4 px-1">
                                          {STATUS_LABELS[c.status] ?? c.status}
                                        </Badge>
                                        <span className="text-muted-foreground tabular-nums">
                                          {c.loadedQty}/{c.expectedQty}
                                          {c.remainingQty > 0 && (
                                            <span className="text-amber-500 ml-1">-{c.remainingQty}</span>
                                          )}
                                          {c.remainingQty === 0 && c.expectedQty > 0 && (
                                            <span className="text-green-500 ml-1">✓</span>
                                          )}
                                        </span>
                                        {(c.status === "DRAFT" || c.status === "LOADING") && (
                                          <button
                                            type="button"
                                            title={`Cancel ${c.containerName}`}
                                            data-testid={`button-v5-cancel-container-${c.orderId}`}
                                            onClick={() => {
                                              setCancelSuperUser("");
                                              setCancelSuperPass("");
                                              setCancelDialog({
                                                orderId: c.orderId,
                                                containerName: c.containerName,
                                                status: c.status as "DRAFT" | "LOADING",
                                              });
                                            }}
                                            className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                                          >
                                            <X className="h-3 w-3" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-muted-foreground italic">No containers linked yet</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}

              {/* Totals row */}
              {totals && (
                <tr className="bg-muted font-semibold text-xs border-t-2 sticky bottom-0 z-10">
                  <td className="px-3 py-2 border-r sticky left-0 bg-muted z-20">
                    Totals <span className="font-normal text-muted-foreground">({rows.length} products)</span>
                  </td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums">
                    <span className="text-green-700 dark:text-green-400">{totals.stockAvailable}</span>
                  </td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {totals.expectedToLoad}
                  </td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {totals.totalLoaded > 0 ? totals.totalLoaded : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 border-r text-right font-mono tabular-nums",
                      totals.freeToPromise < 0
                        ? "text-destructive"
                        : totals.freeToPromise === 0
                          ? "text-muted-foreground"
                          : "text-green-700 dark:text-green-400"
                    )}
                  >
                    {totals.freeToPromise > 0 ? `+${totals.freeToPromise}` : totals.freeToPromise}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create drawer */}
      <CreateProformaV5Drawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        articleRows={drawerRows}
        onSuccess={() => query.refetch()}
      />

      {/* Edit Proforma drawer */}
      {editDrawerProformaId !== null && (
        <EditProformaV5Drawer
          open={editDrawerProformaId !== null}
          onClose={() => setEditDrawerProformaId(null)}
          proformaId={editDrawerProformaId}
          articleRows={drawerRows}
          onSuccess={() => query.refetch()}
        />
      )}

      {/* Add Containers dialog */}
      <Dialog
        open={!!addCtDialog}
        onOpenChange={(open) => {
          if (!open) setAddCtDialog(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Containers</DialogTitle>
          </DialogHeader>

          {addCtDialog && (
            <div className="flex flex-col gap-4 py-1">
              <p className="text-sm text-muted-foreground">
                Adding to <span className="font-semibold text-foreground">{addCtDialog.proformaName}</span> (
                {addCtDialog.existingCount} existing container{addCtDialog.existingCount !== 1 ? "s" : ""})
              </p>

              {/* Number of containers */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium w-36 shrink-0">Number to add</label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={ctCount}
                  onChange={(e) => handleCtCountChange(parseInt(e.target.value) || 1)}
                  className="w-24"
                  data-testid="input-v5-ct-count"
                />
              </div>

              {/* Editable name list */}
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {ctNames.map((name, idx) => {
                  const isDupe = ctNames.filter((n) => n.trim() === name.trim() && name.trim()).length > 1;
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6 text-right shrink-0">{idx + 1}.</span>
                      <Input
                        value={name}
                        onChange={(e) => handleCtNameChange(idx, e.target.value)}
                        placeholder={`Container ${addCtDialog.existingCount + idx + 1}`}
                        className={cn("flex-1", isDupe && "border-destructive focus-visible:ring-destructive")}
                        data-testid={`input-v5-ct-name-${idx}`}
                      />
                      {isDupe && <span className="text-[10px] text-destructive shrink-0">duplicate</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddCtDialog(null)} data-testid="button-v5-ct-cancel">
              Cancel
            </Button>
            <Button
              onClick={submitAddContainers}
              disabled={addContainersMut.isPending}
              data-testid="button-v5-ct-submit"
            >
              {addContainersMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding…
                </>
              ) : (
                `Add ${ctCount} Container${ctCount !== 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Draft Quantities dialog */}
      <Dialog
        open={!!editDraftDialog}
        onOpenChange={(open) => {
          if (!open) setEditDraftDialog(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-muted-foreground" />
              Edit Draft Quantities
            </DialogTitle>
          </DialogHeader>

          {editDraftDialog && (
            <div className="flex flex-col gap-4 py-1">
              <p className="text-sm text-muted-foreground">
                Editing expected quantities for{" "}
                <span className="font-semibold text-foreground">{editDraftDialog.proformaName}</span>.
              </p>

              {editDraftDialog.articles.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No eligible draft containers found.</p>
              ) : (
                <div className="rounded-md border text-xs overflow-hidden">
                  <div className="grid grid-cols-[1fr_60px_80px_64px] bg-muted px-3 py-2 gap-3 font-medium text-muted-foreground border-b">
                    <span>Article</span>
                    <span className="text-right">Current</span>
                    <span className="text-right">New Qty</span>
                    <span className="text-right">Ctrs</span>
                  </div>
                  {editDraftDialog.articles.map((a) => (
                    <div
                      key={a.articleCode}
                      className="grid grid-cols-[1fr_60px_80px_64px] px-3 py-2 gap-3 items-center border-b last:border-0"
                    >
                      <div>
                        <div className="font-medium truncate max-w-[180px]" title={a.productName}>
                          {a.productName}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">{a.articleCode}</div>
                      </div>
                      <span className="text-right font-mono tabular-nums text-muted-foreground">
                        {a.currentExpectedQty}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        className="w-full h-7 text-xs text-right"
                        value={editDraftQtys[a.articleCode] ?? a.currentExpectedQty}
                        onChange={(e) =>
                          setEditDraftQtys((prev) => ({
                            ...prev,
                            [a.articleCode]: Math.max(0, parseInt(e.target.value) || 0),
                          }))
                        }
                        data-testid={`input-v5-edit-draft-qty-${a.articleCode}`}
                      />
                      <span className="text-right text-muted-foreground tabular-nums font-mono">
                        {a.eligibleCount}×
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                Only draft containers that have not started loading will be updated. Existing loaded containers will not
                change.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditDraftDialog(null)}
              data-testid="button-v5-edit-draft-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={submitEditDraft}
              disabled={editDraftMut.isPending || !editDraftDialog || editDraftDialog.articles.length === 0}
              data-testid="button-v5-edit-draft-submit"
            >
              {editDraftMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Proforma confirmation dialog */}
      <Dialog
        open={!!closeDialog}
        onOpenChange={(open) => {
          if (!open) setCloseDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Close Proforma
            </DialogTitle>
          </DialogHeader>

          {closeDialog && (
            <div className="flex flex-col gap-3 py-1">
              <p className="text-sm text-muted-foreground">
                Close <span className="font-semibold text-foreground">{closeDialog.proformaName}</span>?
              </p>
              <p className="text-sm text-muted-foreground">
                It will stop counting in Expected to Load. Existing containers and history will remain.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCloseDialog(null)} data-testid="button-v5-close-pf-cancel">
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => closeDialog && closeProformaMut.mutate(closeDialog.proformaId)}
              disabled={closeProformaMut.isPending}
              data-testid="button-v5-close-pf-confirm"
            >
              {closeProformaMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Closing…
                </>
              ) : (
                "Close Proforma"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Existing Container dialog */}
      <Dialog
        open={!!linkDialog}
        onOpenChange={(open) => {
          if (!open) {
            setLinkDialog(null);
            setLinkSelected(new Set());
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Link Existing Container
            </DialogTitle>
          </DialogHeader>

          {linkDialog && (
            <div className="flex flex-col gap-4 py-1">
              <p className="text-sm text-muted-foreground">
                Linking to <span className="font-semibold text-foreground">{linkDialog.proformaName}</span>.
              </p>

              <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Only link containers that truly belong to this proforma. Expected quantities will be set from this
                  proforma's lines and container progress will appear in Stock Allocation V5.
                </p>
              </div>

              {unlinkedQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : unlinkedQuery.isError ? (
                <p className="text-sm text-destructive">Failed to load unlinked containers.</p>
              ) : (unlinkedQuery.data?.orders ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4 italic">
                  No unlinked LOADING containers found.
                </p>
              ) : (
                <div className="rounded-md border overflow-hidden max-h-72 overflow-y-auto">
                  <div className="grid grid-cols-[20px_1fr_80px_64px_56px] bg-muted px-3 py-2 gap-2 text-xs font-medium text-muted-foreground border-b sticky top-0">
                    <span />
                    <span>Container / Customer</span>
                    <span className="text-right">Loaded</span>
                    <span className="text-right">Date</span>
                    <span />
                  </div>
                  {(unlinkedQuery.data?.orders ?? []).map((order) => {
                    const isSelected = linkSelected.has(order.id);
                    const customerMismatch =
                      linkDialog.proformaCustomerId != null &&
                      order.customerId != null &&
                      order.customerId !== linkDialog.proformaCustomerId;
                    return (
                      <div
                        key={order.id}
                        className={cn(
                          "grid grid-cols-[20px_1fr_80px_64px_56px] px-3 py-2 gap-2 items-center text-xs border-b last:border-0",
                          customerMismatch ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover-elevate",
                          isSelected && "bg-primary/5"
                        )}
                        onClick={() => {
                          if (customerMismatch) return;
                          setLinkSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(order.id)) next.delete(order.id);
                            else next.add(order.id);
                            return next;
                          });
                        }}
                        data-testid={`row-unlinked-order-${order.id}`}
                      >
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                            isSelected ? "bg-primary border-primary" : "border-muted-foreground/30",
                            customerMismatch && "border-muted-foreground/15"
                          )}
                        >
                          {isSelected && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{order.containerNumber}</div>
                          <div className="text-muted-foreground truncate">{order.customerName}</div>
                          {customerMismatch && (
                            <div className="text-destructive text-[10px]">Customer mismatch — cannot link</div>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <span className="text-blue-600 dark:text-blue-400">{order.loadedBaleCount}</span>
                          <span className="text-muted-foreground ml-0.5">bales</span>
                        </div>
                        <div className="text-right text-muted-foreground tabular-nums">
                          {new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                        <div>
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            {STATUS_LABELS[order.status] ?? order.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setLinkDialog(null);
                setLinkSelected(new Set());
              }}
              data-testid="button-v5-link-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                linkDialog && linkMut.mutate({ proformaId: linkDialog.proformaId, orderIds: Array.from(linkSelected) })
              }
              disabled={linkMut.isPending || linkSelected.size === 0}
              data-testid="button-v5-link-submit"
            >
              {linkMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Linking…
                </>
              ) : (
                `Link ${linkSelected.size > 0 ? linkSelected.size + " " : ""}Container${linkSelected.size !== 1 ? "s" : ""}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Cancelled Container dialog */}
      <Dialog
        open={restoreDialogOpen}
        onOpenChange={(open) => {
          if (!open) setRestoreDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              Restore Cancelled Container
            </DialogTitle>
            <DialogDescription>
              Cancelled V5 containers from the last 30 days. Restoring puts the container back to its previous status.
              Any bales that were scanned in will need to be re-scanned.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto py-1">
            {cancelledContainersQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : cancelledContainersQuery.isError ? (
              <p className="text-sm text-destructive text-center py-4">Failed to load cancelled containers.</p>
            ) : (cancelledContainersQuery.data?.orders ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recently cancelled containers found (last 30 days).
              </p>
            ) : (
              (cancelledContainersQuery.data?.orders ?? []).map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
                  data-testid={`row-cancelled-container-${order.id}`}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{order.containerNumber}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {order.wasLoading ? "Was Loading" : "Was Draft"}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate">
                      {order.customerName}
                      {order.proformaName ? ` · ${order.proformaName}` : ""}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Cancelled {new Date(order.cancelledAt).toLocaleDateString()}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restoreContainerMut.mutate(order.id)}
                    disabled={restoreContainerMut.isPending}
                    data-testid={`button-restore-container-${order.id}`}
                  >
                    {restoreContainerMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Restore
                      </>
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreDialogOpen(false)}
              data-testid="button-restore-dialog-close"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Container — DRAFT */}
      <AlertDialog
        open={cancelDialog?.status === "DRAFT"}
        onOpenChange={(open) => {
          if (!open) setCancelDialog(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <X className="h-4 w-4" />
              Cancel Container?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 pt-1">
                <p>
                  You are about to cancel{" "}
                  <span className="font-semibold text-foreground">{cancelDialog?.containerName}</span>.
                </p>
                <p>
                  It will be removed from the expected load count. You can restore it within 30 days using the "Restore
                  Cancelled" button.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel data-testid="button-v5-cancel-ct-dismiss">Keep Container</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelDialog && cancelContainerMut.mutate({ orderId: cancelDialog.orderId })}
              disabled={cancelContainerMut.isPending}
              data-testid="button-v5-cancel-ct-confirm"
            >
              {cancelContainerMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Yes, Cancel It"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Container — LOADING */}
      <AlertDialog
        open={cancelDialog?.status === "LOADING"}
        onOpenChange={(open) => {
          if (!open) setCancelDialog(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <X className="h-4 w-4" />
              Cancel Loading Container?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3 pt-1">
                <p>
                  You are about to cancel{" "}
                  <span className="font-semibold text-foreground">{cancelDialog?.containerName}</span>, which is
                  actively loading.
                </p>
                <p className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                  All scanned bale links will be removed and bales returned to stock. You can restore this container
                  within 30 days using the "Restore Cancelled" button.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel data-testid="button-v5-cancel-ct-dismiss">Keep Container</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelDialog && cancelContainerMut.mutate({ orderId: cancelDialog.orderId })}
              disabled={cancelContainerMut.isPending}
              data-testid="button-v5-cancel-ct-confirm"
            >
              {cancelContainerMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Yes, Cancel It"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Excel dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileDown className="h-4 w-4 text-muted-foreground" />
              Export Stock Allocation
            </DialogTitle>
            <DialogDescription>Choose which rows to include in the Excel export.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            <p className="text-xs text-muted-foreground">
              The export includes Article Code, Product Name, Stock Available, Expected to Load, Total Loaded, and
              Available Balance — with colour-coded balance cells.
            </p>

            <div className="rounded-md border divide-y">
              <label
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
                data-testid="checkbox-export-positive"
              >
                <Checkbox checked={exportIncludePositive} onCheckedChange={(v) => setExportIncludePositive(!!v)} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">Positive balance</span>
                  <span className="text-xs text-muted-foreground">More stock than required</span>
                </div>
                <span className="ml-auto text-xs font-mono text-green-700 dark:text-green-400">
                  {rows.filter((r) => r.freeToPromise > 0).length} rows
                </span>
              </label>

              <label
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
                data-testid="checkbox-export-negative"
              >
                <Checkbox checked={exportIncludeNegative} onCheckedChange={(v) => setExportIncludeNegative(!!v)} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-destructive">Negative balance (shortages)</span>
                  <span className="text-xs text-muted-foreground">Stock is below what is needed</span>
                </div>
                <span className="ml-auto text-xs font-mono text-destructive">
                  {rows.filter((r) => r.freeToPromise < 0).length} rows
                </span>
              </label>

              <label
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
                data-testid="checkbox-export-zero"
              >
                <Checkbox checked={exportIncludeZero} onCheckedChange={(v) => setExportIncludeZero(!!v)} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-muted-foreground">Zero balance</span>
                  <span className="text-xs text-muted-foreground">Exactly meets requirements</span>
                </div>
                <span className="ml-auto text-xs font-mono text-muted-foreground">
                  {rows.filter((r) => r.freeToPromise === 0).length} rows
                </span>
              </label>
            </div>

            {/* Preview count */}
            <div className="text-xs text-center text-muted-foreground">
              {(() => {
                const count = rows.filter(
                  (r) =>
                    (r.freeToPromise > 0 && exportIncludePositive) ||
                    (r.freeToPromise < 0 && exportIncludeNegative) ||
                    (r.freeToPromise === 0 && exportIncludeZero)
                ).length;
                return count > 0 ? (
                  <span>
                    <span className="font-semibold text-foreground">{count}</span> rows will be exported
                  </span>
                ) : (
                  <span className="text-destructive font-medium">Select at least one filter above</span>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} data-testid="button-export-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleExportExcel}
              disabled={!exportIncludePositive && !exportIncludeNegative && !exportIncludeZero}
              data-testid="button-export-confirm"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Download Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
