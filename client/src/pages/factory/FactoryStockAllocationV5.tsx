import { useState, useMemo, Fragment, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, AlertTriangle, Plus, ChevronDown, ChevronRight, Container, CheckCircle2, Lock, Pencil, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import CreateProformaV5Drawer from "./CreateProformaV5Drawer";

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
  DRAFT: "Draft", LOADING: "Loading", PENDING_VERIFICATION: "Pending",
  VERIFIED: "Verified", FINALIZED: "Finalized", CANCELLED: "Cancelled",
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function FactoryStockAllocationV5() {
  const { toast } = useToast();

  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [expandedRows, setExpandedRows]         = useState<Set<string>>(new Set());
  const [hideZero, setHideZero]                 = useState(true);
  const [refreshFlash, setRefreshFlash]         = useState(false);

  /* ── Add-Containers dialog state ────────────────────────────────────────── */
  const [addCtDialog, setAddCtDialog] = useState<{
    proformaId: number;
    proformaName: string;
    existingCount: number;
  } | null>(null);
  const [ctCount, setCtCount]   = useState(1);
  const [ctNames, setCtNames]   = useState<string[]>([]);

  function openAddContainers(proformaId: number, proformaName: string, existingCount: number) {
    setAddCtDialog({ proformaId, proformaName, existingCount });
    setCtCount(1);
    setCtNames([`Container ${existingCount + 1}`]);
  }

  function handleCtCountChange(val: number) {
    const n = Math.max(1, Math.min(50, val || 1));
    setCtCount(n);
    setCtNames(prev => {
      const base = addCtDialog?.existingCount ?? 0;
      if (n > prev.length) {
        const extra = Array.from({ length: n - prev.length }, (_, i) =>
          `Container ${base + prev.length + i + 1}`
        );
        return [...prev, ...extra];
      }
      return prev.slice(0, n);
    });
  }

  function handleCtNameChange(idx: number, val: string) {
    setCtNames(prev => prev.map((n, i) => (i === idx ? val : n)));
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
    const trimmed = ctNames.map(n => n.trim());
    if (trimmed.some(n => !n)) {
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
    mutationFn: (proformaId: number) =>
      apiRequest("PATCH", `/api/factory/v5/proforma/${proformaId}/close`, {}),
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
      const pd = row.proformaDetails.find(p => p.proformaId === proformaId);
      if (!pd) continue;
      const eligible = pd.containers.filter(c => c.status === "DRAFT" && c.loadedQty === 0);
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
    articles.forEach(a => { initQtys[a.articleCode] = a.currentExpectedQty; });
    setEditDraftQtys(initQtys);
  }

  const editDraftMut = useMutation({
    mutationFn: ({ proformaId, updates }: { proformaId: number; updates: { articleCode: string; expectedQty: number }[] }) =>
      apiRequest("PATCH", `/api/factory/v5/proforma/${proformaId}/draft-expected-lines`, { updates }),
    onSuccess: (data: any) => {
      toast({ title: `Draft quantities updated (${data?.updated ?? 0} lines changed).` });
      setEditDraftDialog(null);
      query.refetch();
    },
    onError: (err: any) => {
      toast({ title: "Error updating quantities", description: err.message ?? "Unknown error", variant: "destructive" });
    },
  });

  function submitEditDraft() {
    if (!editDraftDialog) return;
    const updates = editDraftDialog.articles.map(a => ({
      articleCode: a.articleCode,
      expectedQty: editDraftQtys[a.articleCode] ?? a.currentExpectedQty,
    }));
    const invalid = updates.find(u => !Number.isInteger(u.expectedQty) || u.expectedQty < 0);
    if (invalid) {
      toast({ title: "Validation error", description: "Quantities must be non-negative integers.", variant: "destructive" });
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
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    enabled: !!linkDialog,
    staleTime: 0,
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

  /* ── Cancel-Container dialog state ──────────────────────────────────────── */
  const [cancelDialog, setCancelDialog] = useState<{
    orderId: number;
    containerName: string;
    status: "DRAFT" | "LOADING";
  } | null>(null);
  const [cancelSuperUser, setCancelSuperUser] = useState("");
  const [cancelSuperPass, setCancelSuperPass] = useState("");

  const cancelContainerMut = useMutation({
    mutationFn: ({ orderId, supervisorUsername, supervisorPassword }: {
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
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
  });

  const rows   = query.data?.rows ?? [];
  const totals = query.data?.totals;

  const handleRefresh = useCallback(() => {
    query.refetch().then(() => {
      setRefreshFlash(true);
      setTimeout(() => setRefreshFlash(false), 1500);
    });
  }, [query]);

  function toggleRow(code: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  /* ── Article rows for the drawer ──────────────────────────────────────── */
  const drawerRows = useMemo(() => rows.map(r => ({
    articleCode:    r.articleCode,
    productName:    r.productName,
    stockAvailable: r.stockAvailable,
    totalLoaded:    r.totalLoaded,
    expectedToLoad: r.expectedToLoad,
    freeToPromise:  r.freeToPromise,
  })), [rows]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">Stock Allocation</h1>
          <Badge variant="secondary" className="text-[11px] font-semibold tracking-wide">v5</Badge>
          {totals && totals.shortageCount > 0 && (
            <Badge variant="destructive" className="text-[11px] gap-1">
              <AlertTriangle className="h-3 w-3" />
              {totals.shortageCount} shortage{totals.shortageCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={hideZero ? "default" : "outline"}
            size="default"
            onClick={() => setHideZero(v => !v)}
            data-testid="button-v5-toggle-zero"
          >
            {hideZero ? "Show Zero Rows" : "Hide Zero Rows"}
          </Button>
          <Button size="default" onClick={() => setCreateDrawerOpen(true)} data-testid="button-v5-open-create-proforma">
            <Plus className="h-4 w-4 mr-2" />Create Proforma
          </Button>
          <Button
            variant={refreshFlash ? "secondary" : "outline"}
            size="default"
            onClick={handleRefresh}
            disabled={query.isFetching}
            data-testid="button-v5-refresh"
            className={cn(refreshFlash && "ring-2 ring-primary/40")}
          >
            {refreshFlash
              ? <><CheckCircle2 className="h-4 w-4 mr-2 text-primary" />Refreshed</>
              : query.isFetching
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Refreshing…</>
                : <><RefreshCw className="h-4 w-4 mr-2" />Refresh</>}
          </Button>
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
          <Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
        </div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No data found. Create a proforma with containers to use V5 stock allocation.</CardContent></Card>
      ) : (
        <div className="overflow-auto rounded-md border max-h-[calc(100vh-180px)]">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead>
              <tr className="bg-muted sticky top-0 z-10">
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[200px]">Product</th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[120px]">Stock Available</th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[130px] text-amber-600 dark:text-amber-400">Expected to Load</th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[110px] text-blue-600 dark:text-blue-400">Total Loaded</th>
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
                        isShortage && "bg-destructive/5",
                      )}
                      data-testid={`row-v5-${row.articleCode}`}
                    >
                      <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                        <div className="flex items-center gap-1.5">
                          {isShortage && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <div>
                            <div className="font-medium text-xs leading-tight truncate max-w-[200px]" title={row.productName}>{row.productName}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{row.articleCode}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-xs">
                        {row.stockAvailable > 0
                          ? <span className="text-green-700 dark:text-green-400 font-medium">{row.stockAvailable}</span>
                          : <span className="text-muted-foreground/40">0</span>}
                      </td>

                      <td className={cn(
                        "px-3 py-2 border-r text-right font-mono tabular-nums text-xs",
                        row.expectedToLoad > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/40",
                      )}>
                        {row.expectedToLoad > 0 ? row.expectedToLoad : "0"}
                      </td>

                      <td className={cn(
                        "px-3 py-2 border-r text-right font-mono tabular-nums text-xs",
                        row.totalLoaded > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/40",
                      )}>
                        {row.totalLoaded > 0 ? row.totalLoaded : <span className="text-muted-foreground/40">—</span>}
                      </td>

                      <td className={cn(
                        "px-3 py-2 border-r text-right font-mono tabular-nums text-xs font-semibold",
                        row.freeToPromise < 0
                          ? "text-destructive"
                          : row.freeToPromise === 0
                          ? "text-muted-foreground"
                          : "text-green-700 dark:text-green-400",
                      )}>
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
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable proforma/container detail */}
                    {isExpanded && row.proformaDetails.map(proforma => {
                      // Ready to close: has containers and all are FINALIZED or CANCELLED
                      const isReadyToClose =
                        proforma.containerCount > 0 &&
                        proforma.containers.length > 0 &&
                        proforma.containers.every(c => c.status === "FINALIZED" || c.status === "CANCELLED");

                      return (
                      <tr key={`${row.articleCode}-p${proforma.proformaId}`} className="border-b bg-muted/30">
                        <td colSpan={5} className="px-0 py-0">
                          <div className="px-8 py-2">
                            <div className="flex items-center gap-2 mb-1.5 text-xs flex-wrap">
                              <span className="font-semibold">{proforma.proformaName}</span>
                              <span className="text-muted-foreground">—</span>
                              <span className="text-muted-foreground">{proforma.customerName}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {proforma.containerCount} container{proforma.containerCount !== 1 ? "s" : ""}
                              </Badge>
                              <span className="text-muted-foreground">
                                {proforma.lineQty} × {proforma.containerCount} =
                                <span className="font-semibold text-amber-600 dark:text-amber-400 ml-1">{proforma.totalExpected} expected</span>
                              </span>
                              {isReadyToClose && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] h-4 px-1.5 gap-0.5 text-green-700 dark:text-green-400 border-green-600/40"
                                  data-testid={`badge-v5-ready-to-close-${proforma.proformaId}`}
                                >
                                  <CheckCircle2 className="h-2.5 w-2.5" />Ready to Close
                                </Badge>
                              )}
                              {!isReadyToClose && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-5 px-2 text-[10px]"
                                  data-testid={`button-v5-add-containers-${proforma.proformaId}`}
                                  onClick={() => openAddContainers(proforma.proformaId, proforma.proformaName, proforma.containerCount)}
                                >
                                  <Plus className="h-2.5 w-2.5 mr-1" />Add Containers
                                </Button>
                              )}
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
                                <Link2 className="h-2.5 w-2.5 mr-1" />Link Existing
                              </Button>
                              {/* Edit Draft Quantities — only when at least one DRAFT container has 0 loaded bales */}
                              {!isReadyToClose && proforma.containers.some(c => c.status === "DRAFT" && c.loadedQty === 0) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-5 px-2 text-[10px]"
                                  data-testid={`button-v5-edit-draft-${proforma.proformaId}`}
                                  onClick={() => openEditDraft(proforma.proformaId, proforma.proformaName, rows)}
                                >
                                  <Pencil className="h-2.5 w-2.5 mr-1" />Edit Draft Qty
                                </Button>
                              )}
                              {isReadyToClose && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-5 px-2 text-[10px]"
                                  data-testid={`button-v5-close-proforma-${proforma.proformaId}`}
                                  onClick={() => setCloseDialog({ proformaId: proforma.proformaId, proformaName: proforma.proformaName })}
                                >
                                  <Lock className="h-2.5 w-2.5 mr-1" />Close Proforma
                                </Button>
                              )}
                            </div>

                            {proforma.containers.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {proforma.containers.map(c => (
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
                  <td className={cn(
                    "px-3 py-2 border-r text-right font-mono tabular-nums",
                    totals.freeToPromise < 0
                      ? "text-destructive"
                      : totals.freeToPromise === 0
                      ? "text-muted-foreground"
                      : "text-green-700 dark:text-green-400",
                  )}>
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

      {/* Add Containers dialog */}
      <Dialog open={!!addCtDialog} onOpenChange={open => { if (!open) setAddCtDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Containers</DialogTitle>
          </DialogHeader>

          {addCtDialog && (
            <div className="flex flex-col gap-4 py-1">
              <p className="text-sm text-muted-foreground">
                Adding to <span className="font-semibold text-foreground">{addCtDialog.proformaName}</span>
                {" "}({addCtDialog.existingCount} existing container{addCtDialog.existingCount !== 1 ? "s" : ""})
              </p>

              {/* Number of containers */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium w-36 shrink-0">Number to add</label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={ctCount}
                  onChange={e => handleCtCountChange(parseInt(e.target.value) || 1)}
                  className="w-24"
                  data-testid="input-v5-ct-count"
                />
              </div>

              {/* Editable name list */}
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {ctNames.map((name, idx) => {
                  const isDupe = ctNames.filter(n => n.trim() === name.trim() && name.trim()).length > 1;
                  return (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-6 text-right shrink-0">{idx + 1}.</span>
                      <Input
                        value={name}
                        onChange={e => handleCtNameChange(idx, e.target.value)}
                        placeholder={`Container ${addCtDialog.existingCount + idx + 1}`}
                        className={cn("flex-1", isDupe && "border-destructive focus-visible:ring-destructive")}
                        data-testid={`input-v5-ct-name-${idx}`}
                      />
                      {isDupe && (
                        <span className="text-[10px] text-destructive shrink-0">duplicate</span>
                      )}
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
              {addContainersMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adding…</>
                : `Add ${ctCount} Container${ctCount !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Draft Quantities dialog */}
      <Dialog open={!!editDraftDialog} onOpenChange={open => { if (!open) setEditDraftDialog(null); }}>
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
                Editing expected quantities for <span className="font-semibold text-foreground">{editDraftDialog.proformaName}</span>.
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
                  {editDraftDialog.articles.map(a => (
                    <div
                      key={a.articleCode}
                      className="grid grid-cols-[1fr_60px_80px_64px] px-3 py-2 gap-3 items-center border-b last:border-0"
                    >
                      <div>
                        <div className="font-medium truncate max-w-[180px]" title={a.productName}>{a.productName}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{a.articleCode}</div>
                      </div>
                      <span className="text-right font-mono tabular-nums text-muted-foreground">{a.currentExpectedQty}</span>
                      <Input
                        type="number"
                        min={0}
                        className="w-full h-7 text-xs text-right"
                        value={editDraftQtys[a.articleCode] ?? a.currentExpectedQty}
                        onChange={e => setEditDraftQtys(prev => ({
                          ...prev,
                          [a.articleCode]: Math.max(0, parseInt(e.target.value) || 0),
                        }))}
                        data-testid={`input-v5-edit-draft-qty-${a.articleCode}`}
                      />
                      <span className="text-right text-muted-foreground tabular-nums font-mono">{a.eligibleCount}×</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                Only draft containers that have not started loading will be updated. Existing loaded containers will not change.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditDraftDialog(null)} data-testid="button-v5-edit-draft-cancel">
              Cancel
            </Button>
            <Button
              onClick={submitEditDraft}
              disabled={editDraftMut.isPending || !editDraftDialog || editDraftDialog.articles.length === 0}
              data-testid="button-v5-edit-draft-submit"
            >
              {editDraftMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Proforma confirmation dialog */}
      <Dialog open={!!closeDialog} onOpenChange={open => { if (!open) setCloseDialog(null); }}>
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
              {closeProformaMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Closing…</>
                : "Close Proforma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Existing Container dialog */}
      <Dialog open={!!linkDialog} onOpenChange={open => { if (!open) { setLinkDialog(null); setLinkSelected(new Set()); } }}>
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
                  Only link containers that truly belong to this proforma. Expected quantities will be set from this proforma's lines and container progress will appear in Stock Allocation V5.
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
                  {(unlinkedQuery.data?.orders ?? []).map(order => {
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
                          isSelected && "bg-primary/5",
                        )}
                        onClick={() => {
                          if (customerMismatch) return;
                          setLinkSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(order.id)) next.delete(order.id); else next.add(order.id);
                            return next;
                          });
                        }}
                        data-testid={`row-unlinked-order-${order.id}`}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                          isSelected ? "bg-primary border-primary" : "border-muted-foreground/30",
                          customerMismatch && "border-muted-foreground/15",
                        )}>
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
              onClick={() => { setLinkDialog(null); setLinkSelected(new Set()); }}
              data-testid="button-v5-link-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => linkDialog && linkMut.mutate({ proformaId: linkDialog.proformaId, orderIds: Array.from(linkSelected) })}
              disabled={linkMut.isPending || linkSelected.size === 0}
              data-testid="button-v5-link-submit"
            >
              {linkMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Linking…</>
                : `Link ${linkSelected.size > 0 ? linkSelected.size + " " : ""}Container${linkSelected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Container — DRAFT (simple confirmation, no supervisor required) */}
      {cancelDialog?.status === "DRAFT" && (
        <Dialog open onOpenChange={open => { if (!open) setCancelDialog(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <X className="h-4 w-4" />
                Cancel Container
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-1">
              <p className="text-sm text-muted-foreground">
                Cancel <span className="font-semibold text-foreground">{cancelDialog.containerName}</span>?
              </p>
              <p className="text-sm text-muted-foreground">
                This draft container will be marked as cancelled and removed from the expected load count. This cannot be undone.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setCancelDialog(null)} data-testid="button-v5-cancel-ct-dismiss">
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelContainerMut.mutate({ orderId: cancelDialog.orderId })}
                disabled={cancelContainerMut.isPending}
                data-testid="button-v5-cancel-ct-confirm"
              >
                {cancelContainerMut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Cancelling…</>
                  : "Cancel Container"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel Container — LOADING (supervisor credentials required) */}
      {cancelDialog?.status === "LOADING" && (
        <Dialog open onOpenChange={open => {
          if (!open) { setCancelDialog(null); setCancelSuperUser(""); setCancelSuperPass(""); }
        }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <X className="h-4 w-4" />
                Cancel Loading Container
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-1">
              <p className="text-sm text-muted-foreground">
                Cancel <span className="font-semibold text-foreground">{cancelDialog.containerName}</span>?
                This container is actively loading. Admin approval is required.
              </p>
              <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                All scanned bale links will be removed. Bales will remain in stock. This action cannot be undone.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm">Supervisor Username</Label>
                  <Input
                    autoComplete="off"
                    value={cancelSuperUser}
                    onChange={e => setCancelSuperUser(e.target.value)}
                    data-testid="input-v5-cancel-super-user"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-sm">Supervisor Password</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={cancelSuperPass}
                    onChange={e => setCancelSuperPass(e.target.value)}
                    data-testid="input-v5-cancel-super-pass"
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => { setCancelDialog(null); setCancelSuperUser(""); setCancelSuperPass(""); }}
                data-testid="button-v5-cancel-ct-dismiss"
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelContainerMut.mutate({
                  orderId: cancelDialog.orderId,
                  supervisorUsername: cancelSuperUser,
                  supervisorPassword: cancelSuperPass,
                })}
                disabled={cancelContainerMut.isPending || !cancelSuperUser.trim() || !cancelSuperPass}
                data-testid="button-v5-cancel-ct-confirm"
              >
                {cancelContainerMut.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Cancelling…</>
                  : "Cancel Container"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
