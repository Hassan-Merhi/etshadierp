import { useMemo, useState, Suspense, lazy } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Layers,
  ShieldAlert,
  History,
  ChevronDown,
  ChevronRight,
  Undo2,
  RotateCcw,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { formatNumber } from "@/lib/formatNumber";

const BatchDetail = lazy(() => import("@/pages/BatchDetail"));

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface RecalcRow {
  containerId: number;
  rawStockId: number | null;
  containerNumber: string;
  containerStatus: string;
  supplierId: number | null;
  supplierName: string;
  currencyCode: string;
  receivedKg: number;
  usedKg: number;
  remainingKg: number;
  fullyUsed: boolean;
  activeRawStockRowExists: boolean;
  rawStockDeleted: boolean;
  mixSourceCount: number;
  affectedOpenBatchCount: number;
  affectedCompletedBatchCount: number;
  old: { costPerKg: number; costPerKgUsd: number };
  next: { costPerKg: number; costPerKgUsd: number };
  diffPct: number;
  changed: boolean;
  fxUnresolved: boolean;
  valuationKg?: number;
  actualReceivedKg?: number;
  wasPartialReceipt?: boolean;
}

interface AffectedMixBatchRow {
  batchId: number;
  batchCode: string;
  name: string | null;
  status: string;
  batchDate: string | null;
  wasCompleted: boolean;
  totalWeightKg: number;
  weightKgFromSelectedContainers: number;
  oldCostPerKg: number;
  newCostPerKg: number;
  costDifferencePerKg: number;
  totalCostDifference: number;
  oldTotalCost: number;
  newTotalCost: number;
  diffPct: number;
  baleCount: number;
  sourceContainerNumbers: string[];
  sourceChanges: Array<{
    containerId: number;
    containerNumber: string;
    weightKg: number;
    oldCostPerKgUsd: number;
    newCostPerKgUsd: number;
  }>;
}

interface SourceMismatchRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchStatus: string;
  containerId: number | null;
  containerNumber: string | null;
  supplierId: number | null;
  supplierName: string | null;
  weightKg: number;
  oldCostPerKgUsd: number;
  newCostPerKgUsd: number;
  fixable: boolean;
  reason: string;
}

interface FullAuditSummary {
  totalContainersScanned: number;
  containersCorrect: number;
  containerCostMismatches: number;
  activeRawStockMismatches: number;
  fullyUsedContainersWithMismatches: number;
  missingRawStockContainers: number;
  zeroCostSources: number;
  nonZeroSourceCostMismatches: number;
  unresolvedFxContainers: number;
  safeRepairsAvailable: number;
}

interface FullAuditRow {
  containerId: number;
  containerNumber: string;
  containerStatus: string;
  codes: string[];
  safeToRepair: boolean;
  fxUnresolved: boolean;
  fullyUsed: boolean;
}

interface FullAuditResult {
  summary: FullAuditSummary;
  rows: FullAuditRow[];
}

interface UndoLogRow {
  id: number;
  companyId: number;
  userId: number | null;
  username: string | null;
  description: string;
  containerCount: number;
  containerNumbers: string[];
  appliedAt: string;
  undoneAt: string | null;
  undoneByUserId: number | null;
  undoneByUsername: string | null;
}

interface SupplierRateAuditRow {
  supplierId: number;
  supplierName: string;
  /** The moving-average rate that was in place before "Recompute Supplier Rates" overwrote it. */
  oldRate: number;
  /** The all-time stable rate that the recompute wrote. */
  recomputedRate: number;
  /** The rate currently stored in the DB (may differ from recomputedRate if something else changed it since). */
  currentRate: number;
  overwroteAt: string;
  changedBy: string | null;
  /** True only when currentRate still matches what the recompute wrote — safe to restore. */
  canRestore: boolean;
}

interface SupplierRatePreviewRow {
  supplierId: number;
  supplierName: string;
  oldRate: number;
  newRate: number;
  rowCount: number;
  totalReceivedKg: number;
  skipped?: string;
}

// ─── Historical Replay interfaces ────────────────────────────────────────────

interface ReplaySupplierRow {
  supplierId: number;
  supplierName: string;
  startingRate: number;
  endingExpectedRate: number;
  currentStoredRate: number;
  replayRemainingKg: number;
  authoritativeRemainingKg: number;
  safeToRepair: boolean;
  reasons: string[];
  eventCount: number;
  affectedContainerCount: number;
  affectedSourceCount: number;
  affectedBatchCount: number;
  affectedBaleCount: number;
}

interface ReplaySummary {
  totalReceivedContainers: number;
  containersScanned: number;
  canonicalContainerMismatches: number;
  suppliersScanned: number;
  safeSuppliers: number;
  manualReviewSuppliers: number;
  supplierPricedSourcesScanned: number;
  sourceMismatches: number;
  batchesToUpdate: number;
  completedBatchesToUpdate?: number;
  balesToUpdate: number;
  finalizedBalesToUpdate?: number;
  unresolvedFx: number;
  missingDates: number;
  quantityTimelineMismatches: number;
  ambiguousEventOrdering: number;
  scanCoverageError: boolean;
}

interface HistoricalReplayResult {
  summary: ReplaySummary;
  supplierRows: ReplaySupplierRow[];
  containerRows: any[];
  sourceRows: any[];
  batchRows: any[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RawStockRecalculate() {
  const { toast } = useToast();
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [includeCompletedBatches, setIncludeCompletedBatches] = useState(false);
  const [includeHistoricalContainers, setIncludeHistoricalContainers] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<number | null>(null);
  const [selectedZeroCostSources, setSelectedZeroCostSources] = useState<Set<number>>(new Set());
  const [manualRates, setManualRates] = useState<Record<number, string>>({});
  const [expandedBatchSources, setExpandedBatchSources] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"recalc" | "sources" | "audit" | "history" | "replay">("recalc");

  // ── Historical Replay confirmation dialog (requires typing "APPLY HISTORICAL REPLAY") ──
  const [showReplayConfirmDialog, setShowReplayConfirmDialog] = useState(false);
  const [replayConfirmText, setReplayConfirmText] = useState("");
  const [includeFinalizedBales, setIncludeFinalizedBales] = useState(false);
  const REPLAY_CONFIRM_PHRASE = "APPLY HISTORICAL REPLAY" as const;

  // FIX 11: Per-supplier selection for Historical Replay. Only safe suppliers that
  // are selected will be included in the Prepare call.
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<number>>(new Set());

  // DEFECT 9 FIX: Store the full dry-run response (not just the token string) so the
  // confirm dialog can surface summary data and pass the complete token on apply.
  interface PreparedReplayData {
    confirmationToken: string;
    summary: Record<string, any>;
    safeSupplierIds: number[];
    suppliersToApply: any[];
    // DEFECT 9 (route) FIX: fingerprint is now included in the dry-run response.
    fingerprint?: string;
    expiresInMs: number;
    algorithmVersion: string;
  }
  const [preparedReplayToken, setPreparedReplayToken] = useState<PreparedReplayData | null>(null);

  // ── Recompute dry-run / confirmation dialog ────────────────────────────────
  const [recomputePreviewRows, setRecomputePreviewRows] = useState<SupplierRatePreviewRow[] | null>(null);
  const [showRecomputeDialog, setShowRecomputeDialog] = useState(false);

  // ── Restore from audit — per-row selection ────────────────────────────────
  const [selectedRestoreIds, setSelectedRestoreIds] = useState<Set<number>>(new Set());

  // ── Main preview ──────────────────────────────────────────────────────────
  const { data: rows, isLoading, isError: isPreviewError, error: previewErrorMsg, refetch } = useQuery<RecalcRow[]>({
    queryKey: ["/api/factory/raw-stock/recalc/preview"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/recalc/preview");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to load recalc preview");
      return res.json();
    },
    retry: false,
  });

  const changedRows = useMemo(() => (rows || []).filter((r) => r.changed), [rows]);
  const fxUnresolvedRows = useMemo(() => (rows || []).filter((r) => r.fxUnresolved), [rows]);
  const unchangedCount = (rows?.length || 0) - changedRows.length - fxUnresolvedRows.length;

  // Hide CLOSED/COMPLETED containers unless "include historical" is toggled
  const visibleChangedRows = useMemo(
    () =>
      includeHistoricalContainers
        ? changedRows
        : changedRows.filter((r) => !["CLOSED", "COMPLETED"].includes(r.containerStatus)),
    [changedRows, includeHistoricalContainers]
  );
  const hiddenHistoricalCount = changedRows.length - visibleChangedRows.length;

  const allSelected =
    visibleChangedRows.length > 0 &&
    visibleChangedRows.every((r) => selected.has(r.containerId));
  const selectedIds = useMemo(() => Array.from(selected).sort((a, b) => a - b), [selected]);

  // ── Affected mix batches ──────────────────────────────────────────────────
  const { data: affectedBatches, isLoading: batchesLoading } = useQuery<AffectedMixBatchRow[]>({
    queryKey: ["/api/factory/raw-stock/recalc/mix-batches-preview", selectedIds, includeCompletedBatches],
    queryFn: async () => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/mix-batches-preview", {
        containerIds: selectedIds,
        includeCompletedBatches,
      });
      if (!res.ok) throw new Error("Failed to load affected mix batches");
      return res.json();
    },
    enabled: selectedIds.length > 0,
  });

  // ── Source cost mismatches (full scan, replaces zero-cost-only) ───────────
  const { data: sourceMismatches, isLoading: sourceMismatchLoading, refetch: refetchSources } = useQuery<SourceMismatchRow[]>({
    queryKey: ["/api/factory/raw-stock/recalc/source-cost-mismatches"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/recalc/source-cost-mismatches");
      if (!res.ok) throw new Error("Failed to load source cost mismatches");
      return res.json();
    },
    enabled: activeTab === "sources",
  });

  const fixableSourceMismatches = useMemo(
    () => (sourceMismatches || []).filter((r) => r.fixable),
    [sourceMismatches]
  );
  const manualSourceMismatches = useMemo(
    () => (sourceMismatches || []).filter((r) => !r.fixable && r.containerId == null),
    [sourceMismatches]
  );
  const allSourceMismatchSelected =
    fixableSourceMismatches.length > 0 &&
    fixableSourceMismatches.every((r) => selectedZeroCostSources.has(r.sourceId));

  // ── Full audit ────────────────────────────────────────────────────────────
  const {
    data: fullAudit,
    isLoading: auditLoading,
    refetch: refetchAudit,
  } = useQuery<FullAuditResult>({
    queryKey: ["/api/factory/raw-stock/recalc/full-audit"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/recalc/full-audit");
      if (!res.ok) throw new Error("Failed to run full audit");
      return res.json();
    },
    enabled: activeTab === "audit",
  });

  // ── Undo log ──────────────────────────────────────────────────────────────
  const {
    data: undoLog,
    isLoading: undoLogLoading,
    refetch: refetchUndoLog,
  } = useQuery<UndoLogRow[]>({
    queryKey: ["/api/factory/raw-stock/recalc/undo-log"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/recalc/undo-log");
      if (!res.ok) throw new Error("Failed to load undo log");
      return res.json();
    },
    enabled: activeTab === "history",
  });

  // ── Rate recompute audit (what did "Recompute Supplier Rates" overwrite?) ──
  const {
    data: rateAuditRows,
    isLoading: rateAuditLoading,
    refetch: refetchRateAudit,
  } = useQuery<SupplierRateAuditRow[]>({
    queryKey: ["/api/factory/raw-stock/supplier-rate/recompute-audit"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/supplier-rate/recompute-audit");
      if (!res.ok) throw new Error("Failed to load rate audit");
      return res.json();
    },
    enabled: activeTab === "history",
  });

  const restorableRows = useMemo(
    () => (rateAuditRows || []).filter((r) => r.canRestore),
    [rateAuditRows]
  );

  // ── Historical Cost Replay ────────────────────────────────────────────────
  const {
    data: replayPreview,
    isLoading: replayLoading,
    isError: isReplayError,
    error: replayErrorMsg,
    refetch: refetchReplay,
  } = useQuery<HistoricalReplayResult>({
    queryKey: ["/api/factory/raw-stock/recalc/historical-replay"],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/raw-stock/recalc/historical-replay");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to load historical replay preview");
      return res.json();
    },
    enabled: activeTab === "replay",
    retry: false,
  });

  // FIX 12: Three-stage Prepare → Review → Apply flow.
  //
  // Stage 1 (Prepare) — dry-run call that issues a signed confirmation token.
  //   The "Prepare Historical Replay" button fires this mutation. On success it
  //   stores the token in `preparedReplayToken` and opens the confirm dialog.
  //
  // Stage 2 (Review) — the admin reads the exact scope shown in the dialog, types
  //   the confirmation phrase to prove intent, then clicks "Apply".
  //
  // Stage 3 (Apply) — uses the already-stored token. No second dry-run is needed;
  //   the route's fingerprint check guarantees the DB hasn't changed between stages.
  //
  // This separation means the token is fetched exactly once. In the old design a
  // single mutation fetched the token AND immediately consumed it in the same JS
  // microtask, so any mid-flight crash left an unconsumed token with no audit log.

  const replayPrepareMutation = useMutation({
    mutationFn: async (opts: {
      supplierIds: number[];
      includeCompletedBatches: boolean;
      includeFinalizedBales: boolean;
    }) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/historical-replay/apply", {
        dryRun: true,
        supplierIds: opts.supplierIds,
        includeCompletedBatches: opts.includeCompletedBatches,
        includeFinalizedBales: opts.includeFinalizedBales,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Dry-run failed");
      // DEFECT 9 FIX: return the full dry-run response, not just the token string.
      return res.json() as Promise<PreparedReplayData>;
    },
    onSuccess: (data) => {
      // DEFECT 9 FIX: store the full prepared-replay object, not just the token.
      setPreparedReplayToken(data);
      setReplayConfirmText("");
      setShowReplayConfirmDialog(true);
    },
    onError: (err: any) => {
      toast({ title: "Prepare failed", description: err.message, variant: "destructive" });
    },
  });

  const replayApplyMutation = useMutation({
    mutationFn: async (opts: {
      supplierIds: number[];
      includeCompletedBatches: boolean;
      includeFinalizedBales: boolean;
      confirmationToken: string;
    }) => {
      const applyRes = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/historical-replay/apply", {
        dryRun: false,
        confirmationToken: opts.confirmationToken,
        supplierIds: opts.supplierIds,
        includeCompletedBatches: opts.includeCompletedBatches,
        includeFinalizedBales: opts.includeFinalizedBales,
      });
      if (!applyRes.ok) throw new Error((await applyRes.json().catch(() => ({}))).message || "Apply failed");
      return applyRes.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      toast({
        title: "Historical replay applied",
        description:
          `Updated ${data.suppliersApplied} supplier(s), ` +
          `${data.sourcesUpdated} source(s), ` +
          `${data.batchesUpdated} batch(es), ` +
          `${data.balesUpdated} bale(s).`,
      });
      setPreparedReplayToken(null);
      refetchReplay();
    },
    onError: (err: any) => {
      toast({ title: "Historical replay failed", description: err.message, variant: "destructive" });
    },
  });

  const autoApplyFxMutation = useMutation({
    mutationFn: async (containerIds: number[]) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/auto-apply-fx", { containerIds });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to auto-apply FX");
      return res.json() as Promise<{ results: { containerNumber: string; rate: number | null; applied: boolean; reason?: string }[]; applied: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/full-audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      const lines = data.results.map((r) =>
        r.applied ? `${r.containerNumber}: applied ${r.rate}` : `${r.containerNumber}: skipped (${r.reason})`
      );
      toast({ title: `FX applied to ${data.applied} container(s)`, description: lines.join(" · ") });
    },
    onError: (err: any) => {
      toast({ title: "Auto-apply FX failed", description: err.message, variant: "destructive" });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (undoLogId: number) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/undo", { undoLogId });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to undo");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/full-audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/undo-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      toast({
        title: "Undo applied",
        description:
          `Restored ${data.containersRestored} container(s), ` +
          `${data.mixBatchesRestored} mix batch(es), ` +
          `${data.balesRestored} bale(s) to their previous values.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Undo failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUndo = (row: UndoLogRow) => {
    wrapAdminAction(() => {
      undoMutation.mutate(row.id);
    }, `Undo recalculation applied ${new Date(row.appliedAt).toLocaleString()} — restores ${row.containerCount} container(s)`);
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleChangedRows.map((r) => r.containerId)));
    }
  };
  const toggleOne = (containerId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  };

  const toggleSourceMismatch = (sourceId: number) => {
    setSelectedZeroCostSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };
  const toggleAllSourceMismatches = () => {
    if (allSourceMismatchSelected) {
      setSelectedZeroCostSources(new Set());
    } else {
      setSelectedZeroCostSources(new Set(fixableSourceMismatches.map((r) => r.sourceId)));
    }
  };

  const toggleBatchSourcesExpanded = (batchId: number) => {
    setExpandedBatchSources((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  // ── Apply container cost recalculation ───────────────────────────────────
  const applyMutation = useMutation({
    mutationFn: async ({
      containerIds,
      includeCompletedBatches,
      includeHistoricalContainers,
    }: {
      containerIds: number[];
      includeCompletedBatches: boolean;
      includeHistoricalContainers: boolean;
    }) => {
      const dryRun = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply", {
        containerIds,
        includeCompletedBatches,
        includeHistoricalContainers,
      });
      if (!dryRun.ok) throw new Error((await dryRun.json()).message || "Failed to prepare recalculation");
      const dryRunData = await dryRun.json();
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply", {
        containerIds,
        includeCompletedBatches,
        includeHistoricalContainers,
        confirm: true,
        confirmationToken: dryRunData.confirmationToken,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to apply recalculation");
      return res.json();
    },
    onSuccess: (data) => {
      const results = data.results || [];
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/full-audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/available-containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      setSelected(new Set());
      const applied = results.filter((r: any) => r.applied === true);
      const skipped = results.filter((r: any) => !r.applied);
      const totalBatches = results.reduce((s: number, r: any) => s + r.affectedBatches, 0);
      const totalBales = results.reduce((s: number, r: any) => s + r.affectedBales, 0);
      const totalCompleted = results.reduce(
        (s: number, r: any) => s + (r.completedBatchesRewritten || 0),
        0
      );
      const skipSummary = skipped.length > 0
        ? ` (${skipped.length} skipped: ${[...new Set(skipped.map((r: any) => r.skippedReason).filter(Boolean))].join("; ")})`
        : "";
      toast({
        title: "Recalculation applied",
        description:
          `Fixed ${applied.length} of ${results.length} container(s). Updated ${totalBatches} mix batch(es) and ${totalBales} bale(s).` +
          (totalCompleted > 0 ? ` (${totalCompleted} were completed/closed batches.)` : "") +
          skipSummary,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleApply = () => {
    if (selected.size === 0) return;
    const label =
      `Apply cost recalculation to ${selected.size} container(s)` +
      (includeCompletedBatches ? ", including rewriting completed/closed mix batches" : "") +
      (includeHistoricalContainers ? ", including CLOSED/COMPLETED containers" : "");
    wrapAdminAction(() => {
      applyMutation.mutate({
        containerIds: Array.from(selected),
        includeCompletedBatches,
        includeHistoricalContainers,
      });
    }, label);
  };

  // ── Apply All Safe (full-scan batch repair) ───────────────────────────────
  const applyAllSafeMutation = useMutation({
    mutationFn: async ({
      includeHistoricalContainers,
      includeCompletedBatches,
    }: {
      includeHistoricalContainers: boolean;
      includeCompletedBatches: boolean;
    }) => {
      const dryRun = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply-all-safe", {
        includeHistoricalContainers,
        includeCompletedBatches,
      });
      if (!dryRun.ok) throw new Error((await dryRun.json()).message || "Failed to prepare apply-all-safe");
      const dryRunData = await dryRun.json();
      if (!dryRunData.confirmationToken) {
        return dryRunData; // 0 safe containers — nothing to do
      }
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/apply-all-safe", {
        includeHistoricalContainers,
        includeCompletedBatches,
        confirm: true,
        confirmationToken: dryRunData.confirmationToken,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to apply safe repairs");
      return res.json();
    },
    onSuccess: (data) => {
      if (!data.results) {
        toast({ title: "Nothing to repair", description: "All containers are already correct." });
        return;
      }
      const results = data.results || [];
      const applied = results.filter((r: any) => r.applied);
      const totalBatches = results.reduce((s: number, r: any) => s + r.affectedBatches, 0);
      const totalBales = results.reduce((s: number, r: any) => s + r.affectedBales, 0);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/full-audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      toast({
        title: "All safe repairs applied",
        description: `Fixed ${applied.length} container(s). Updated ${totalBatches} mix batch(es) and ${totalBales} bale(s).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleApplyAllSafe = () => {
    const count = fullAudit?.summary.safeRepairsAvailable ?? "all";
    wrapAdminAction(() => {
      applyAllSafeMutation.mutate({ includeHistoricalContainers, includeCompletedBatches });
    }, `Apply all safe raw-material cost repairs (${count} container(s))`);
  };

  // ── Fix All Partial Offloads ───────────────────────────────────────────────
  // Filters the preview to PARTIALLY_RECEIVED containers that have a changed cost
  // and a resolved FX rate, then applies the recalculation with both historical
  // and completed-batch flags on — since partial offload containers span history.
  const partialOffloadCandidates = useMemo(
    () =>
      (rows || []).filter(
        // Catch historical containers already promoted to OFFLOADED by checking
        // wasPartialReceipt rather than containerStatus === "PARTIALLY_RECEIVED".
        (r) => r.changed && !r.fxUnresolved && r.wasPartialReceipt === true
      ),
    [rows]
  );

  const handleFixPartialOffloads = () => {
    if (partialOffloadCandidates.length === 0) return;
    const ids = partialOffloadCandidates.map((r) => r.containerId);
    wrapAdminAction(() => {
      applyMutation.mutate({
        containerIds: ids,
        includeHistoricalContainers: true,
        includeCompletedBatches: true,
      });
    }, `Fix cost on ${ids.length} PARTIALLY_RECEIVED container(s) — includes historical and completed batches`);
  };

  // ── Recompute supplier rates — dry-run first, then confirm ────────────────
  // Step 1: dry run — fetches preview without writing anything
  const recomputeDryRunMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/supplier-rate/recompute", { dryRun: true });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to fetch recompute preview");
      return res.json();
    },
    onSuccess: (data) => {
      const changedRows = (data.results as SupplierRatePreviewRow[]).filter((r) => !r.skipped);
      if (changedRows.length === 0) {
        toast({ title: "No changes needed", description: "All supplier rates already match the all-time stable average." });
        return;
      }
      setRecomputePreviewRows(data.results);
      setShowRecomputeDialog(true);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Step 2: actual apply (called from inside the confirmation dialog after admin override)
  const recomputeApplyMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/supplier-rate/recompute", { dryRun: false });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to recompute supplier rates");
      return res.json();
    },
    onSuccess: (data) => {
      setShowRecomputeDialog(false);
      setRecomputePreviewRows(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/supplier-rate/recompute-audit"] });
      toast({
        title: "Supplier rates updated",
        description: `Updated ${data.updated} supplier(s), skipped ${data.skipped} (already correct or no data).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleRecomputeSupplierRates = () => {
    recomputeDryRunMutation.mutate();
  };

  const handleRecomputeConfirm = () => {
    wrapAdminAction(
      () => recomputeApplyMutation.mutate(),
      "Recompute locked rate for ALL suppliers from all-time receipt-weighted average — overwrites moving-average rates"
    );
  };

  // ── Restore supplier rates from audit log ─────────────────────────────────
  const restoreRatesMutation = useMutation({
    mutationFn: async (restorations: Array<{ supplierId: number; rate: number }>) => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/supplier-rate/restore-from-audit", { restorations });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to restore supplier rates");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/preview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/supplier-rate/recompute-audit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/source-cost-mismatches"] });
      setSelectedRestoreIds(new Set());
      toast({
        title: "Rates restored",
        description: `Restored ${data.restored} supplier rate(s). Refresh "Source Cost Mismatches" to see and fix affected batches.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleRestoreAll = () => {
    const rows = (rateAuditRows || []).filter((r) => r.canRestore);
    if (rows.length === 0) return;
    wrapAdminAction(
      () => restoreRatesMutation.mutate(rows.map((r) => ({ supplierId: r.supplierId, rate: r.oldRate }))),
      `Restore ${rows.length} supplier rate(s) to their pre-recompute moving-average values`
    );
  };

  const handleRestoreSelected = () => {
    const rows = (rateAuditRows || []).filter((r) => r.canRestore && selectedRestoreIds.has(r.supplierId));
    if (rows.length === 0) return;
    wrapAdminAction(
      () => restoreRatesMutation.mutate(rows.map((r) => ({ supplierId: r.supplierId, rate: r.oldRate }))),
      `Restore ${rows.length} supplier rate(s) to their pre-recompute moving-average values`
    );
  };

  // ── Fix ALL source mismatches in one shot (no dry-run) ────────────────────
  const fixAllSourcesMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/fix-source-mismatches");
      if (!res.ok) throw new Error((await res.json()).message || "Failed to fix source mismatches");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/source-cost-mismatches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/history"] });
      toast({
        title: "Source costs updated",
        description: `Applied ${data.applied} fix(es), skipped ${data.skipped} (already correct).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFixAllSources = () => {
    const fixable = (sourceMismatches || []).filter((r) => r.fixable).length;
    wrapAdminAction(
      () => fixAllSourcesMutation.mutate(),
      `Fix all ${fixable} fixable source cost mismatch(es) — no dry-run`
    );
  };

  // ── Fix source mismatches ─────────────────────────────────────────────────
  const sourceMismatchFixMutation = useMutation({
    mutationFn: async ({ sourceIds, rates }: { sourceIds: number[]; rates: Record<number, number> }) => {
      const dryRun = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/zero-cost-sources/apply", {
        sourceIds,
        manualRates: rates,
      });
      if (!dryRun.ok) throw new Error((await dryRun.json()).message || "Failed to prepare fix");
      const dryRunData = await dryRun.json();
      const res = await modeApiRequest("POST", "/api/factory/raw-stock/recalc/zero-cost-sources/apply", {
        sourceIds,
        manualRates: rates,
        confirm: true,
        confirmationToken: dryRunData.confirmationToken,
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to apply fix");
      return res.json();
    },
    onSuccess: (data) => {
      const results = data.results || [];
      const applied = results.filter((r: any) => r.applied);
      const totalBales = results.reduce((s: number, r: any) => s + (r.affectedBales || 0), 0);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/source-cost-mismatches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/recalc/zero-cost-sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      setSelectedZeroCostSources(new Set());
      toast({
        title: "Source cost repairs applied",
        description: `Repaired ${applied.length} source(s). Updated ${totalBales} bale(s).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleFixSourceMismatches = () => {
    if (selectedZeroCostSources.size === 0) return;
    const rates: Record<number, number> = {};
    for (const id of selectedZeroCostSources) {
      const raw = manualRates[id];
      if (raw) {
        const parsed = parseFloat(raw);
        if (!isNaN(parsed) && parsed > 0) rates[id] = parsed;
      }
    }
    wrapAdminAction(() => {
      sourceMismatchFixMutation.mutate({ sourceIds: Array.from(selectedZeroCostSources), rates });
    }, `Repair source cost for ${selectedZeroCostSources.size} mix-batch source(s)`);
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const badgePct = (pct: number | null | undefined) => {
    const v = pct ?? 0;
    return (
      <Badge
        variant="outline"
        className={
          v > 0
            ? "text-red-500 border-red-500/30 bg-red-500/10"
            : "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
        }
      >
        {v > 0 ? "+" : ""}
        {v.toFixed(2)}%
      </Badge>
    );
  };

  const statusBadge = (status: string) => {
    const cls =
      status === "CLOSED" || status === "COMPLETED"
        ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
        : "text-muted-foreground";
    return (
      <Badge variant="outline" className={cls}>
        {status}
      </Badge>
    );
  };

  const codeBadge = (code: string) => {
    const cls =
      code === "CORRECT"
        ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
        : code === "UNRESOLVED_FX" || code === "MANUAL_REVIEW_REQUIRED"
        ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
        : "text-red-500 border-red-500/30 bg-red-500/10";
    return (
      <Badge key={code} variant="outline" className={`${cls} text-[10px] mr-1`}>
        {code}
      </Badge>
    );
  };

  // ─── Tabs ─────────────────────────────────────────────────────────────────
  const tabs = [
    { id: "recalc" as const, label: "Container Cost Recalc" },
    { id: "sources" as const, label: "Source Cost Mismatches" },
    { id: "audit" as const, label: "Full Audit" },
    { id: "history" as const, label: "History & Rates" },
    { id: "replay" as const, label: "Historical Replay" },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/factory/raw-stock">
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold leading-tight">Recalculate Raw Material Cost</h1>
            <p className="text-xs text-muted-foreground leading-tight">
              Recomputes each container's true landed cost/kg from its stored charges and shows what would change
              before anything is saved.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={includeCompletedBatches}
              onCheckedChange={(v) => setIncludeCompletedBatches(v === true)}
              data-testid="checkbox-include-completed-batches"
            />
            Also rewrite completed mix batches
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox
              checked={includeHistoricalContainers}
              onCheckedChange={(v) => setIncludeHistoricalContainers(v === true)}
              data-testid="checkbox-include-historical"
            />
            <History className="h-3 w-3" />
            Include CLOSED/COMPLETED containers
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={recomputeDryRunMutation.isPending || recomputeApplyMutation.isPending}
            onClick={handleRecomputeSupplierRates}
            title="Recompute all supplier locked rates from receipt-weighted average of their corrected raw-stock rows. Use after a recalc run where all containers were fully used."
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recompute Supplier Rates
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchAudit(); refetchSources(); }} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {t.id === "sources" && (sourceMismatches?.length ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500/15 text-red-600 text-[10px] px-1.5 py-0.5">
                {sourceMismatches!.length}
              </span>
            )}
            {t.id === "audit" && (fullAudit?.summary.safeRepairsAvailable ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/15 text-amber-600 text-[10px] px-1.5 py-0.5">
                {fullAudit!.summary.safeRepairsAvailable}
              </span>
            )}
          </button>
        ))}
      </div>

      {includeCompletedBatches && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          This will rewrite the cost of completed/closed mix batches (and any bales pressed from them) sourced from
          the selected containers — normally protected as locked historical record.
        </div>
      )}
      {includeHistoricalContainers && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          CLOSED/COMPLETED containers will be included. Their supplier locked rate will NOT be changed (they have no
          remaining kg), but their raw-stock row and mix-batch sources will be corrected.
        </div>
      )}

      {/* ── Tab: Container Cost Recalc ─────────────────────────────────────── */}
      {activeTab === "recalc" && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              {partialOffloadCandidates.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={applyMutation.isPending}
                  onClick={handleFixPartialOffloads}
                  title="Apply the correct fixed landed cost/kg to all PARTIALLY_RECEIVED containers with a changed cost and resolved FX rate — uses includeHistoricalContainers + includeCompletedBatches."
                  className="gap-2 text-blue-700 border-blue-400/50 hover:bg-blue-500/10"
                >
                  <Layers className="h-3.5 w-3.5" />
                  {applyMutation.isPending ? "Applying..." : `Fix All Partial Offloads (${partialOffloadCandidates.length})`}
                </Button>
              )}
            </div>
            <Button
              size="sm"
              disabled={selected.size === 0 || applyMutation.isPending}
              onClick={handleApply}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {applyMutation.isPending ? "Applying..." : `Apply Selected (${selected.size})`}
            </Button>
          </div>

          {isPreviewError ? (
            <div className="border border-red-500/30 bg-red-500/10 rounded-md p-3 text-sm text-red-700 dark:text-red-400 space-y-2">
              <div className="font-medium">Failed to load recalculation preview.</div>
              <div className="text-xs">{(previewErrorMsg as any)?.message || "An unexpected error occurred. Check server logs."}</div>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : isLoading ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Computing recalculation preview...</div>
          ) : (
            <>
              {fxUnresolvedRows.length > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  <div className="font-medium">
                    {fxUnresolvedRows.length} container(s) have an unresolved/unconfirmed exchange rate and were
                    skipped.
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                    {fxUnresolvedRows.map((r) => (
                      <span key={r.containerId}>
                        {r.containerNumber} ({r.currencyCode})
                      </span>
                    ))}
                  </div>
                  <div>Resolve/confirm these containers' exchange rates first, then refresh.</div>
                </div>
              )}

              {hiddenHistoricalCount > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
                  {hiddenHistoricalCount} CLOSED/COMPLETED container(s) with mismatches are hidden — enable
                  "Include CLOSED/COMPLETED containers" to see and repair them.
                </div>
              )}

              {visibleChangedRows.length === 0 && rows !== undefined ? (
                <div className="text-sm text-muted-foreground py-12 text-center border rounded-md bg-card">
                  Nothing to fix — every container's cost/kg already matches its stored charges.
                  {unchangedCount > 0 && ` (${unchangedCount} container(s) checked, all correct.)`}
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground">
                    {visibleChangedRows.length} container(s) have a mismatch
                    {unchangedCount > 0
                      ? ` — ${unchangedCount} other container(s) are already correct and hidden.`
                      : "."}
                  </div>
                  <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={allSelected}
                              onCheckedChange={toggleAll}
                              data-testid="checkbox-select-all"
                            />
                          </TableHead>
                          <TableHead>Container</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Supplier</TableHead>
                          <TableHead className="text-right">Received (kg)</TableHead>
                          <TableHead className="text-right">Remaining (kg)</TableHead>
                          <TableHead className="text-right">Current $/kg</TableHead>
                          <TableHead className="text-right">Corrected $/kg</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleChangedRows.map((row) => (
                          <TableRow key={row.containerId} className="group">
                            <TableCell>
                              <Checkbox
                                checked={selected.has(row.containerId)}
                                onCheckedChange={() => toggleOne(row.containerId)}
                                data-testid={`checkbox-row-${row.containerId}`}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.containerNumber}</TableCell>
                            <TableCell>{statusBadge(row.containerStatus)}</TableCell>
                            <TableCell className="text-sm">{row.supplierName}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {formatNumber(row.receivedKg)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {row.fullyUsed ? (
                                <span className="text-amber-600">fully used</span>
                              ) : (
                                formatNumber(row.remainingKg)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              ${(row.old?.costPerKgUsd ?? 0).toFixed(6)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-medium text-foreground">
                              ${(row.next?.costPerKgUsd ?? 0).toFixed(6)}
                            </TableCell>
                            <TableCell className="text-right">{badgePct(row.diffPct)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {selectedIds.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" />
                    Mix batches that would be affected by the selected container(s)
                    {batchesLoading && " — loading..."}
                  </div>
                  {!batchesLoading && (affectedBatches || []).length === 0 ? (
                    <div className="text-xs text-muted-foreground py-6 text-center border rounded-md bg-card">
                      No mix batches are sourced from the selected container(s)
                      {!includeCompletedBatches ? " (that are still open)." : "."}
                    </div>
                  ) : (
                    <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-6" />
                            <TableHead>Batch</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Total (kg)</TableHead>
                            <TableHead className="text-right">From Selected (kg)</TableHead>
                            <TableHead className="text-right">Old $/kg</TableHead>
                            <TableHead className="text-right">New $/kg</TableHead>
                            <TableHead className="text-right">Δ $/kg</TableHead>
                            <TableHead className="text-right">Total Δ</TableHead>
                            <TableHead className="text-right">Change</TableHead>
                            <TableHead className="text-right">Bales</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(affectedBatches || []).map((b) => (
                            <>
                              <TableRow
                                key={b.batchId}
                                className="cursor-pointer hover:bg-muted/40"
                                onClick={() => toggleBatchSourcesExpanded(b.batchId)}
                                data-testid={`row-affected-batch-${b.batchId}`}
                              >
                                <TableCell className="text-muted-foreground">
                                  {expandedBatchSources.has(b.batchId) ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </TableCell>
                                <TableCell
                                  className="font-mono text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailBatchId(b.batchId);
                                  }}
                                >
                                  <span className="hover:underline cursor-pointer">{b.batchCode}</span>
                                  {b.name ? (
                                    <span className="text-muted-foreground"> — {b.name}</span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {b.batchDate
                                    ? new Date(b.batchDate).toLocaleDateString()
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      b.wasCompleted
                                        ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {b.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                  {formatNumber(b.totalWeightKg)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                  {formatNumber(b.weightKgFromSelectedContainers)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                  ${(b.oldCostPerKg ?? 0).toFixed(6)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs font-medium">
                                  ${(b.newCostPerKg ?? 0).toFixed(6)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {(b.costDifferencePerKg ?? 0) > 0 ? "+" : ""}${(b.costDifferencePerKg ?? 0).toFixed(6)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {(b.totalCostDifference ?? 0) > 0 ? "+" : ""}${(b.totalCostDifference ?? 0).toFixed(2)}
                                </TableCell>
                                <TableCell className="text-right">{badgePct(b.diffPct)}</TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                  {b.baleCount}
                                </TableCell>
                              </TableRow>
                              {expandedBatchSources.has(b.batchId) &&
                                (b.sourceChanges || []).map((sc) => (
                                  <TableRow
                                    key={`${b.batchId}-${sc.containerId}`}
                                    className="bg-muted/20"
                                  >
                                    <TableCell />
                                    <TableCell
                                      colSpan={2}
                                      className="font-mono text-[10px] text-muted-foreground pl-8"
                                    >
                                      ↳ {sc.containerNumber}
                                    </TableCell>
                                    <TableCell />
                                    <TableCell />
                                    <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                      {formatNumber(sc.weightKg)} kg
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                                      ${(sc.oldCostPerKgUsd ?? 0).toFixed(6)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-[10px]">
                                      ${(sc.newCostPerKgUsd ?? 0).toFixed(6)}
                                    </TableCell>
                                    <TableCell colSpan={4} />
                                  </TableRow>
                                ))}
                            </>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Click a batch row to expand per-container sources · click the batch code to open its full detail.
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Tab: Source Cost Mismatches ────────────────────────────────────── */}
      {activeTab === "sources" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold leading-tight">Mix-batch source cost mismatches</h2>
            <p className="text-xs text-muted-foreground leading-tight">
              Sources whose recorded cost/kg doesn't match the container's corrected USD cost — includes both zero-cost
              and nonzero-but-wrong values.
            </p>
          </div>
          {sourceMismatchLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (sourceMismatches || []).length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center border rounded-md bg-card">
              No source cost mismatches found.
            </div>
          ) : (
            <>
              <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSourceMismatchSelected}
                          onCheckedChange={toggleAllSourceMismatches}
                          disabled={fixableSourceMismatches.length === 0}
                        />
                      </TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Current $/kg (USD)</TableHead>
                      <TableHead className="text-right">Corrected $/kg (USD)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sourceMismatches || []).map((r) => (
                      <TableRow key={r.sourceId}>
                        <TableCell>
                          <Checkbox
                            checked={selectedZeroCostSources.has(r.sourceId)}
                            onCheckedChange={() => toggleSourceMismatch(r.sourceId)}
                            disabled={!r.fixable && r.containerId != null}
                          />
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs cursor-pointer hover:underline"
                          onClick={() => setDetailBatchId(r.batchId)}
                        >
                          {r.batchCode}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.containerNumber
                            ? `Container ${r.containerNumber}`
                            : r.supplierName
                            ? `Supplier: ${r.supplierName}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatNumber(r.weightKg)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          ${(r.oldCostPerKgUsd ?? 0).toFixed(6)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium">
                          {r.fixable ? (
                            `${(r.newCostPerKgUsd ?? 0).toFixed(6)}`
                          ) : r.containerId == null ? (
                            <input
                              type="number"
                              step="0.000001"
                              placeholder="Enter $/kg USD"
                              className="w-28 text-right text-xs border rounded px-1.5 py-0.5 bg-background"
                              value={manualRates[r.sourceId] || ""}
                              onChange={(e) =>
                                setManualRates((prev) => ({ ...prev, [r.sourceId]: e.target.value }))
                              }
                            />
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs" title={r.reason}>
                          {r.fixable ? (
                            <Badge
                              variant="outline"
                              className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                            >
                              Ready
                            </Badge>
                          ) : r.containerId == null ? (
                            <Badge
                              variant="outline"
                              className="text-amber-600 border-amber-500/30 bg-amber-500/10"
                            >
                              Needs manual rate
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Unresolved
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {fixableSourceMismatches.length} fixable automatically ·{" "}
                  {manualSourceMismatches.length} need a manual rate.
                </p>
                <div className="flex items-center gap-2">
                  {fixableSourceMismatches.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fixAllSourcesMutation.isPending || sourceMismatchFixMutation.isPending}
                      onClick={handleFixAllSources}
                      title="Fix all fixable mismatches in one shot — no dry-run, admin-confirmed"
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Fix All ({fixableSourceMismatches.length})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={selectedZeroCostSources.size === 0 || sourceMismatchFixMutation.isPending || fixAllSourcesMutation.isPending}
                    onClick={handleFixSourceMismatches}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Fix Selected ({selectedZeroCostSources.size})
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Full Audit ────────────────────────────────────────────────── */}
      {activeTab === "audit" && (
        <div className="space-y-4">
          {auditLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !fullAudit ? (
            <div className="text-sm text-muted-foreground py-12 text-center">Loading audit...</div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Scanned", value: fullAudit.summary.totalContainersScanned, cls: "text-foreground" },
                  { label: "Correct", value: fullAudit.summary.containersCorrect, cls: "text-emerald-600" },
                  { label: "Safe repairs", value: fullAudit.summary.safeRepairsAvailable, cls: "text-red-600" },
                  { label: "Unresolved FX", value: fullAudit.summary.unresolvedFxContainers, cls: "text-amber-600" },
                  { label: "Container cost mismatch", value: fullAudit.summary.containerCostMismatches, cls: "text-red-600" },
                  { label: "Active RS mismatch", value: fullAudit.summary.activeRawStockMismatches, cls: "text-red-600" },
                  { label: "Zero-cost sources", value: fullAudit.summary.zeroCostSources, cls: "text-red-600" },
                  { label: "Nonzero source mismatch", value: fullAudit.summary.nonZeroSourceCostMismatches, cls: "text-red-600" },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="border rounded-md p-3 bg-card text-center space-y-1">
                    <div className={`text-xl font-bold ${cls}`}>{value}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
                  </div>
                ))}
              </div>

              {fullAudit.summary.safeRepairsAvailable > 0 && (
                <div className="flex items-center gap-3 border border-amber-500/30 bg-amber-500/10 rounded-md p-3">
                  <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
                    {fullAudit.summary.safeRepairsAvailable} container(s) can be automatically repaired. Use "Apply
                    All Safe" to fix them all in one operation.
                  </p>
                  <Button
                    size="sm"
                    className="shrink-0 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={applyAllSafeMutation.isPending}
                    onClick={handleApplyAllSafe}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {applyAllSafeMutation.isPending ? "Applying..." : "Apply All Safe"}
                  </Button>
                </div>
              )}

              {/* Audit rows table */}
              <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Issue Codes</TableHead>
                      <TableHead className="text-right">Repairable?</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fullAudit.rows.filter((r) => !r.codes.includes("CORRECT") && !r.codes.includes("FULLY_USED")).map((r) => (
                      <TableRow key={r.containerId}>
                        <TableCell className="font-mono text-xs">{r.containerNumber}</TableCell>
                        <TableCell>{statusBadge(r.containerStatus)}</TableCell>
                        <TableCell>{r.codes.map(codeBadge)}</TableCell>
                        <TableCell className="text-right">
                          {r.safeToRepair ? (
                            <Badge
                              variant="outline"
                              className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
                            >
                              Yes
                            </Badge>
                          ) : r.codes.includes("MANUAL_REVIEW_REQUIRED") ? (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2 text-blue-600 border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20"
                                disabled={autoApplyFxMutation.isPending}
                                onClick={() => autoApplyFxMutation.mutate([r.containerId])}
                              >
                                Apply rate from FX table
                              </Button>
                              <Badge
                                variant="outline"
                                className="text-amber-600 border-amber-500/30 bg-amber-500/10"
                              >
                                Manual review
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: History & Undo ────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="space-y-6">

          {/* ── Supplier Rate Recovery ──────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold leading-tight flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-amber-500" />
                  Restore supplier rates from audit log
                </h2>
                <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                  When "Recompute Supplier Rates" overwrites moving-average rates with all-time stable averages,
                  the original values are captured in the audit log. Restore them here — 100% accurate, no guessing.
                  After restoring, refresh "Source Cost Mismatches" to fix all affected mix-batch costs.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => { refetchRateAudit(); refetchUndoLog(); }} className="gap-2 shrink-0">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>

            {rateAuditLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !rateAuditRows || rateAuditRows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
                No "Recompute Supplier Rates" events found in the audit log for this company.
              </div>
            ) : (
              <>
                {restorableRows.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2 flex-1">
                      <strong>{restorableRows.length} supplier rate(s)</strong> were overwritten and can be restored to their
                      pre-recompute moving-average values. After restoring, go to{" "}
                      <button className="underline font-medium" onClick={() => setActiveTab("sources")}>Source Cost Mismatches</button>{" "}
                      and click "Fix All" to correct all affected mix-batch costs.
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {selectedRestoreIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                          disabled={restoreRatesMutation.isPending}
                          onClick={handleRestoreSelected}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Restore Selected ({selectedRestoreIds.size})
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                        disabled={restoreRatesMutation.isPending}
                        onClick={handleRestoreAll}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {restoreRatesMutation.isPending ? "Restoring..." : `Restore All (${restorableRows.length})`}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-8">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={restorableRows.length > 0 && restorableRows.every((r) => selectedRestoreIds.has(r.supplierId))}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedRestoreIds(new Set(restorableRows.map((r) => r.supplierId)));
                              else setSelectedRestoreIds(new Set());
                            }}
                          />
                        </TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Pre-recompute rate (restore to)</TableHead>
                        <TableHead className="text-right">Recomputed (wrong)</TableHead>
                        <TableHead className="text-right">Current rate</TableHead>
                        <TableHead>Overwritten at</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateAuditRows.map((row) => (
                        <TableRow key={row.supplierId} className={!row.canRestore ? "opacity-50" : ""}>
                          <TableCell>
                            {row.canRestore && (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                checked={selectedRestoreIds.has(row.supplierId)}
                                onChange={(e) => {
                                  const next = new Set(selectedRestoreIds);
                                  if (e.target.checked) next.add(row.supplierId);
                                  else next.delete(row.supplierId);
                                  setSelectedRestoreIds(next);
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{row.supplierName}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-600 dark:text-emerald-400">
                            ${row.oldRate.toFixed(6)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-red-500">
                            ${row.recomputedRate.toFixed(6)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            ${row.currentRate.toFixed(6)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(row.overwroteAt).toLocaleString()}
                            {row.changedBy && <span className="ml-1">by {row.changedBy}</span>}
                          </TableCell>
                          <TableCell>
                            {row.canRestore ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10 text-[10px]">
                                Restorable
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground text-[10px]" title="Current rate no longer matches what recompute wrote — something else changed it since.">
                                Already changed
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>

          <div className="border-t" />

          {/* ── Recalculation undo log ──────────────────────────────────────── */}
          <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold leading-tight">Recalculation history</h2>
              <p className="text-xs text-muted-foreground leading-tight">
                Each row is a saved snapshot of the before-state. Undo restores all affected containers,
                mix batches, bales, and supplier locked rates atomically.
              </p>
            </div>
          </div>

          {undoLogLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !undoLog || undoLog.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center border rounded-md bg-card">
              No recalculation history yet. Apply a recalculation and it will appear here.
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden bg-card shadow-sm">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Applied at</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Containers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {undoLog.map((row) => (
                    <TableRow key={row.id} className={row.undoneAt ? "opacity-50" : ""}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.appliedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.username ?? `User #${row.userId ?? "?"}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium text-foreground">{row.description}</div>
                        {row.containerNumbers && row.containerNumbers.length > 0 && (
                          <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                            {row.containerNumbers.slice(0, 6).join(", ")}
                            {row.containerNumbers.length > 6 && ` +${row.containerNumbers.length - 6} more`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.undoneAt ? (
                          <Badge variant="outline" className="text-muted-foreground text-[10px]">
                            Undone {new Date(row.undoneAt).toLocaleDateString()}
                            {row.undoneByUsername ? ` by ${row.undoneByUsername}` : ""}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[10px]">
                            Applied
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!row.undoneAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-7 text-xs border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                            disabled={undoMutation.isPending}
                            onClick={() => handleUndo(row)}
                          >
                            <Undo2 className="h-3 w-3" />
                            Undo
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
            <strong>Important:</strong> Undo restores the exact numerical values that were in place before the
            recalculation. If any other changes were made to the same containers between the recalculation and now
            (e.g. new charges, new offloads), those will also be reverted. Review before confirming.
          </div>
          </div>
        </div>
      )}

      {/* ── Tab: Historical Cost Replay ─────────────────────────────────── */}
      {activeTab === "replay" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-muted-foreground max-w-2xl">
              Replays container receipts, adjustments, and mix-batch consumption events in strict chronological order
              to compute the correct supplier moving-average rate at every point in time, then compares stored source
              costs against those historically-correct rates.
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={replayLoading}
              onClick={() => refetchReplay()}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {isReplayError && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-md p-3 text-sm text-red-700 dark:text-red-400 space-y-2">
              <div className="font-medium">Failed to load historical replay preview.</div>
              <div className="text-xs">{(replayErrorMsg as any)?.message || "An unexpected error occurred. Check server logs."}</div>
              <Button size="sm" variant="outline" onClick={() => refetchReplay()}>Retry</Button>
            </div>
          )}

          {replayLoading && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Computing historical cost replay — this may take a moment…
            </div>
          )}

          {replayPreview && !replayLoading && (
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Containers scanned", value: replayPreview.summary.containersScanned },
                  { label: "Suppliers scanned", value: replayPreview.summary.suppliersScanned },
                  { label: "Safe to repair", value: replayPreview.summary.safeSuppliers, cls: "text-emerald-600" },
                  { label: "Manual review", value: replayPreview.summary.manualReviewSuppliers, cls: "text-amber-600" },
                  { label: "Source mismatches", value: replayPreview.summary.sourceMismatches, cls: replayPreview.summary.sourceMismatches > 0 ? "text-red-500" : undefined },
                  { label: "Batches to update", value: replayPreview.summary.batchesToUpdate },
                  { label: "Bales to update", value: replayPreview.summary.balesToUpdate },
                  { label: "Unresolved FX", value: replayPreview.summary.unresolvedFx, cls: replayPreview.summary.unresolvedFx > 0 ? "text-amber-600" : undefined },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="border rounded-md px-3 py-2 bg-card">
                    <div className={`text-lg font-bold tabular-nums ${cls || ""}`}>{value}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {replayPreview.summary.scanCoverageError && (
                <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400">
                  <strong>Scan coverage mismatch:</strong> Some containers could not be included in the replay.
                  Containers scanned ({replayPreview.summary.containersScanned}) differs from universe
                  ({replayPreview.summary.totalReceivedContainers}). Check server logs for details.
                </div>
              )}

              {replayPreview.summary.missingDates > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400">
                  <strong>{replayPreview.summary.missingDates} event(s)</strong> have no effective date and were
                  placed at the end of the timeline. These suppliers are marked as requiring manual review and
                  will be skipped by the automated repair.
                </div>
              )}

              {replayPreview.summary.quantityTimelineMismatches > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400">
                  <strong>{replayPreview.summary.quantityTimelineMismatches} supplier(s)</strong> have a quantity
                  reconciliation mismatch — replay remaining kg differs from authoritative remaining kg. These
                  suppliers require manual review and will be skipped.
                </div>
              )}

              {/* Supplier rows */}
              {replayPreview.supplierRows.length > 0 && (
                <div className="border rounded-md overflow-hidden bg-card shadow-sm">
                  <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                    Supplier Timelines
                    <Badge variant="outline" className="text-[10px]">
                      {replayPreview.supplierRows.length} supplier(s)
                    </Badge>
                  </div>
                  {/* FIX 11: Select All / Clear controls */}
                  {(() => {
                    const safeIds = replayPreview.supplierRows.filter((s) => s.safeToRepair).map((s) => s.supplierId);
                    return safeIds.length > 0 ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-xs text-muted-foreground bg-muted/20">
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                          onClick={() => setSelectedSupplierIds(new Set(safeIds))}>
                          Select All Safe
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                          onClick={() => setSelectedSupplierIds(new Set())}>
                          Clear
                        </Button>
                        <span className="ml-auto font-medium">
                          {selectedSupplierIds.size}/{safeIds.length} selected
                        </span>
                      </div>
                    ) : null;
                  })()}
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="w-8 pl-3"></TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Current rate</TableHead>
                        <TableHead className="text-right">Replay end rate</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                        <TableHead className="text-right">Sources</TableHead>
                        <TableHead className="text-right">Batches</TableHead>
                        <TableHead className="text-right">Bales</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {replayPreview.supplierRows.map((s) => {
                        const delta = s.endingExpectedRate - s.currentStoredRate;
                        const isChecked = selectedSupplierIds.has(s.supplierId);
                        return (
                          <TableRow key={s.supplierId} className="text-xs">
                            {/* FIX 11: per-row checkbox; disabled for manual-review suppliers */}
                            <TableCell className="pl-3">
                              <Checkbox
                                checked={isChecked}
                                disabled={!s.safeToRepair}
                                onCheckedChange={(v) => {
                                  const next = new Set(selectedSupplierIds);
                                  if (v) next.add(s.supplierId); else next.delete(s.supplierId);
                                  setSelectedSupplierIds(next);
                                }}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{s.supplierName}</TableCell>
                            <TableCell className="text-right font-mono">${s.currentStoredRate.toFixed(6)}</TableCell>
                            <TableCell className="text-right font-mono">${s.endingExpectedRate.toFixed(6)}</TableCell>
                            <TableCell className={`text-right font-mono ${Math.abs(delta) > 0.000001 ? (delta > 0 ? "text-red-500" : "text-emerald-500") : "text-muted-foreground"}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(6)}
                            </TableCell>
                            <TableCell className="text-right">{s.affectedSourceCount}</TableCell>
                            <TableCell className="text-right">{s.affectedBatchCount}</TableCell>
                            <TableCell className="text-right">{s.affectedBaleCount}</TableCell>
                            <TableCell>
                              {s.safeToRepair ? (
                                <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10 text-[10px]">
                                  Safe
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10 text-[10px]">
                                  {s.reasons[0] || "Manual review"}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Options and apply — only show when there are safe suppliers */}
              {replayPreview.summary.safeSuppliers > 0 && (
                <div className="space-y-2 pt-2">
                  {/* includeFinalizedBales toggle */}
                  {(replayPreview.summary.finalizedBalesToUpdate ?? 0) > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-3 py-2 bg-amber-50 border-amber-200">
                      <Checkbox
                        id="include-finalized-bales"
                        checked={includeFinalizedBales}
                        onCheckedChange={(v) => setIncludeFinalizedBales(Boolean(v))}
                      />
                      <label htmlFor="include-finalized-bales" className="cursor-pointer font-medium text-amber-800">
                        Also update {replayPreview.summary.finalizedBalesToUpdate} finalized bale(s) (sold / dispatched / invoiced)
                      </label>
                    </div>
                  )}
                  {/* FIX 12: "Prepare" fires the dry-run mutation only.
                      The confirm dialog is opened by the mutation's onSuccess handler
                      after the token is stored in state — ensuring every apply uses
                      a freshly-signed token that was reviewed before clicking Apply. */}
                  <div className="flex items-center justify-between gap-2">
                    {selectedSupplierIds.size === 0 && replayPreview.summary.safeSuppliers > 0 && (
                      <span className="text-xs text-amber-600">
                        Select at least one safe supplier above to enable Prepare.
                      </span>
                    )}
                    <div className="ml-auto">
                      <Button
                        size="sm"
                        disabled={
                          replayPrepareMutation.isPending ||
                          replayApplyMutation.isPending ||
                          selectedSupplierIds.size === 0
                        }
                        onClick={() =>
                          wrapAdminAction(
                            () => {
                              replayPrepareMutation.mutate({
                                supplierIds: Array.from(selectedSupplierIds),
                                includeCompletedBatches,
                                includeFinalizedBales,
                              });
                            },
                            `Prepare historical cost replay for ${selectedSupplierIds.size} selected supplier(s) — a signed review token will be issued before any data is written.`
                          )
                        }
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {replayPrepareMutation.isPending
                          ? "Preparing…"
                          : `Prepare Historical Replay (${selectedSupplierIds.size} supplier(s))`}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {replayPreview.summary.safeSuppliers === 0 && replayPreview.supplierRows.length > 0 && (
                <div className="text-sm text-muted-foreground py-8 text-center border rounded-md bg-card">
                  No suppliers are safe to repair automatically.
                  {replayPreview.summary.manualReviewSuppliers > 0 &&
                    ` ${replayPreview.summary.manualReviewSuppliers} supplier(s) require manual review (missing event dates or quantity mismatches).`}
                </div>
              )}

              {replayPreview.supplierRows.length === 0 && (
                <div className="text-sm text-muted-foreground py-12 text-center border rounded-md bg-card">
                  Nothing to fix — all supplier timelines are consistent with stored costs.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Historical Replay Confirmation Dialog ─────────────────────────── */}
      {/* Requires the admin to type exactly "APPLY HISTORICAL REPLAY" before the
          mutation fires — prevents accidental one-click financial corrections. */}
      <Dialog
        open={showReplayConfirmDialog}
        onOpenChange={(open) => {
          if (!open) { setShowReplayConfirmDialog(false); setReplayConfirmText(""); }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Confirm Historical Cost Replay
            </DialogTitle>
            <DialogDescription className="text-xs space-y-2 pt-1">
              {replayPreview && (
                <span className="block">
                  This will update{" "}
                  <strong>{replayPreview.summary.safeSuppliers}</strong> supplier(s),{" "}
                  <strong>{replayPreview.summary.sourceMismatches}</strong> source row(s),{" "}
                  <strong>{replayPreview.summary.batchesToUpdate}</strong> batch(es), and{" "}
                  <strong>{replayPreview.summary.balesToUpdate}</strong> bale(s)
                  {(replayPreview.summary.completedBatchesToUpdate ?? 0) > 0 && includeCompletedBatches && (
                    <span> (including {replayPreview.summary.completedBatchesToUpdate} completed batch(es))</span>
                  )}
                  {(replayPreview.summary.finalizedBalesToUpdate ?? 0) > 0 && includeFinalizedBales && (
                    <span> (including {replayPreview.summary.finalizedBalesToUpdate} finalized bale(s))</span>
                  )}.
                  <br />This operation <strong>corrects historical cost data</strong> and cannot be trivially reversed — an undo snapshot will be saved.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="replay-confirm-input" className="text-xs font-medium">
                Type <span className="font-mono font-bold text-destructive">APPLY HISTORICAL REPLAY</span> to confirm:
              </Label>
              <Input
                id="replay-confirm-input"
                value={replayConfirmText}
                onChange={(e) => setReplayConfirmText(e.target.value)}
                placeholder="APPLY HISTORICAL REPLAY"
                className="font-mono text-sm"
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowReplayConfirmDialog(false); setReplayConfirmText(""); }}
            >
              Cancel
            </Button>
            {/* FIX 12: Apply uses the stored token from the Prepare step — no second dry-run. */}
            <Button
              size="sm"
              disabled={
                replayConfirmText !== REPLAY_CONFIRM_PHRASE ||
                replayApplyMutation.isPending ||
                !preparedReplayToken?.confirmationToken
              }
              onClick={() => {
                if (!preparedReplayToken?.confirmationToken) return;
                replayApplyMutation.mutate(
                  {
                    supplierIds: Array.from(selectedSupplierIds),
                    includeCompletedBatches,
                    includeFinalizedBales,
                    confirmationToken: preparedReplayToken.confirmationToken,
                  },
                  {
                    onSettled: () => {
                      setShowReplayConfirmDialog(false);
                      setReplayConfirmText("");
                      setPreparedReplayToken(null);
                    },
                  }
                );
              }}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {replayApplyMutation.isPending ? "Applying…" : "Apply Historical Replay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Recompute Supplier Rates — dry-run preview & confirmation dialog ── */}
      <Dialog open={showRecomputeDialog} onOpenChange={(open) => { if (!open) { setShowRecomputeDialog(false); setRecomputePreviewRows(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Confirm: Recompute Supplier Rates
            </DialogTitle>
            <DialogDescription className="text-xs">
              This will overwrite each supplier's locked rate with the{" "}
              <strong>all-time receipt-weighted average</strong> across all raw-stock rows.
              This differs from the <strong>moving-average formula</strong> used during real offloads, which
              weights by remaining kg at the moment of each offload.
              <br /><br />
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                If you accidentally clicked this, close the dialog and use
                "History &amp; Rates → Restore from Audit Log" instead.
              </span>
            </DialogDescription>
          </DialogHeader>

          {recomputePreviewRows && (
            <div className="space-y-3 mt-2">
              {/* Suppliers that would change */}
              {recomputePreviewRows.filter((r) => !r.skipped).length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Would update ({recomputePreviewRows.filter((r) => !r.skipped).length} suppliers)
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Current rate</TableHead>
                        <TableHead className="text-right">→ New rate</TableHead>
                        <TableHead className="text-right">Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recomputePreviewRows.filter((r) => !r.skipped).map((r) => {
                        const delta = r.newRate - r.oldRate;
                        return (
                          <TableRow key={r.supplierId}>
                            <TableCell className="text-sm font-medium">{r.supplierName}</TableCell>
                            <TableCell className="text-right font-mono text-xs">${r.oldRate.toFixed(6)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">${r.newRate.toFixed(6)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs ${delta > 0 ? "text-red-500" : "text-emerald-500"}`}>
                              {delta > 0 ? "+" : ""}{delta.toFixed(6)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Skipped suppliers */}
              {recomputePreviewRows.filter((r) => !!r.skipped).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {recomputePreviewRows.filter((r) => !!r.skipped).length} supplier(s) skipped (already correct or no data).
                </p>
              )}

              {/* DEFECT 13 FIX: Apply button removed — deprecated, use Historical Replay. */}
              <div className="flex justify-end gap-2 pt-2">
                <p className="text-xs text-amber-700 dark:text-amber-400 mr-auto mt-1 font-medium">
                  Applying is deprecated — use <strong>Historical Cost Replay</strong> instead.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setShowRecomputeDialog(false); setRecomputePreviewRows(null); }}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Batch detail dialog */}
      <Dialog open={detailBatchId !== null} onOpenChange={(open) => !open && setDetailBatchId(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Mix Batch Detail</DialogTitle>
            <DialogDescription>Sources, bales, and cost breakdown for this mix batch.</DialogDescription>
          </DialogHeader>
          {detailBatchId !== null && (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <BatchDetail batchId={detailBatchId} onBack={() => setDetailBatchId(null)} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>

      {AdminDialog}
    </div>
  );
}
