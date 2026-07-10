import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useLocation, useRoute } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ScanLine,
  ArrowLeft,
  Play,
  CheckCircle,
  XCircle,
  Trash2,
  FileDown,
  FileSpreadsheet,
  AlertTriangle,
  Package,
  Truck,
  RotateCcw,
  List,
  FilePlus,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface InvoiceSummary {
  id: number;
  customerId: number;
  invoiceNumber: string | null;
  orderDate: string;
  status: string;
  totalQtyBales: number;
  grandTotal: string;
  containerNumber: string | null;
  customerName: string | null;
  customerCode: string | null;
}

interface LineSummary {
  lineId: number;
  articleCode: string;
  productName: string;
  invoiceQty: number;
  invoiceWeight: number;
  alreadyLoaded: number;
  currentSessionLoaded: number;
  remaining: number;
  pricePerBale: string;
}

interface SessionSummary {
  id: number;
  status: string;
  truckNo: string | null;
  driverName: string | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  createdByName: string | null;
  totalBales: number;
}

interface InvoiceBale {
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  loaded: boolean;
  loadedSessionId: number | null;
  loadedAt: string | null;
}

interface CurrentSessionBale {
  id: number;
  sessionId: number;
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  scannedAt: string;
  scannedByName: string | null;
}

interface LoadingSummaryResponse {
  invoice: InvoiceSummary;
  lines: LineSummary[];
  totals: { invoiceBales: number; alreadyLoaded: number; remaining: number };
  sessions: SessionSummary[];
  invoiceBales: InvoiceBale[];
  currentSessionBales: CurrentSessionBale[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "OPEN")
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Open</Badge>;
  if (status === "COMPLETED")
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Completed</Badge>;
  if (status === "CANCELLED") return <Badge variant="secondary">Cancelled</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function FactoryInvoiceLoadingScan() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/factory/invoices/:id/loading-scan");
  const invoiceId = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  useEscapeToParent(`/factory/sales/invoices/${invoiceId}`);

  // ── Active session state ──
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [showStartForm, setShowStartForm] = useState(false);

  const lsKey = `loading-scan-form-${invoiceId}`;
  const savedForm = (() => {
    try {
      return JSON.parse(localStorage.getItem(lsKey) || "{}");
    } catch {
      return {};
    }
  })();
  const [truckNo, setTruckNo] = useState<string>(savedForm.truckNo ?? "");
  const [driverName, setDriverName] = useState<string>(savedForm.driverName ?? "");
  const [notes, setNotes] = useState<string>(savedForm.notes ?? "");

  const autosaveForm = useCallback(
    (updates: { truckNo?: string; driverName?: string; notes?: string }) => {
      try {
        const current = (() => {
          try {
            return JSON.parse(localStorage.getItem(lsKey) || "{}");
          } catch {
            return {};
          }
        })();
        localStorage.setItem(lsKey, JSON.stringify({ ...current, ...updates }));
      } catch {}
    },
    [lsKey]
  );

  // ── Scanner state ──
  const [scanInput, setScanInput] = useState("");
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [scanMessage, setScanMessage] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);

  // ── Cancel dialog ──
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  // ── Bale refs dialog ──
  const [baleRefLine, setBaleRefLine] = useState<{ code: string; name: string } | null>(null);

  // ── View session bales dialog ──
  const [viewSessionId, setViewSessionId] = useState<number | null>(null);

  // ── Data ──
  const summaryKey = [`/api/factory/invoices/${invoiceId}/loading-summary`, activeSessionId];
  const {
    data: summary,
    isLoading,
    isError,
    error,
  } = useQuery<LoadingSummaryResponse>({
    queryKey: summaryKey,
    queryFn: async () => {
      const url = activeSessionId
        ? `/api/factory/invoices/${invoiceId}/loading-summary?sessionId=${activeSessionId}`
        : `/api/factory/invoices/${invoiceId}/loading-summary`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    enabled: !!invoiceId,
    refetchInterval: 10_000,
    retry: 1,
  });

  // Auto-resume the most recent OPEN session when the page loads (handles navigate-away + return)
  useEffect(() => {
    if (!summary || activeSessionId) return;
    const openSession = summary.sessions.find((s) => s.status === "OPEN");
    if (openSession) {
      setActiveSessionId(openSession.id);
    }
  }, [summary?.sessions.length]);

  // Auto-focus scan input when session is active
  useEffect(() => {
    if (activeSessionId && scanRef.current) {
      scanRef.current.focus();
    }
  }, [activeSessionId, summary?.currentSessionBales?.length]);

  const flashFeedback = useCallback((type: "success" | "error", msg: string) => {
    setScanFlash(type);
    setScanMessage(msg);
    setTimeout(() => setScanFlash(null), 1800);
  }, []);

  // ── Mutations ──

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/factory/invoices/${invoiceId}/loading-sessions`, {
        truckNo: truckNo || undefined,
        driverName: driverName || undefined,
        notes: notes || undefined,
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      setActiveSessionId(data.session.id);
      setShowStartForm(false);
      queryClient.invalidateQueries({ queryKey: [`/api/factory/invoices/${invoiceId}/loading-summary`] });
      toast({ title: "Session started", description: `Loading session #${data.session.id} is now open.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const scanBaleMutation = useMutation({
    mutationFn: async (barcode: string) => {
      const res = await apiRequest("POST", `/api/factory/invoice-loading-sessions/${activeSessionId}/scan-bale`, {
        barcode,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setScanInput("");
      queryClient.invalidateQueries({ queryKey: [`/api/factory/invoices/${invoiceId}/loading-summary`] });
      flashFeedback("success", `Scanned: ${data.bale?.referenceNumber || data.loadingBale?.baleReference}`);
      setTimeout(() => scanRef.current?.focus(), 50);
    },
    onError: (err: any) => {
      setScanInput("");
      flashFeedback("error", err.message);
      setTimeout(() => scanRef.current?.focus(), 50);
    },
  });

  const removeBaleFromSessionMutation = useMutation({
    mutationFn: async ({ sessionId, baleId }: { sessionId: number; baleId: number }) => {
      const res = await apiRequest("DELETE", `/api/factory/invoice-loading-sessions/${sessionId}/bales/${baleId}`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/factory/invoices/${invoiceId}/loading-summary`] });
      toast({ title: "Removed", description: "Bale removed and returned to unloaded." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const completeSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/factory/invoice-loading-sessions/${activeSessionId}/complete`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/factory/invoices/${invoiceId}/loading-summary`] });
      toast({ title: "Completed", description: "Loading session completed successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cancelSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/factory/invoice-loading-sessions/${activeSessionId}/cancel`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: () => {
      setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: [`/api/factory/invoices/${invoiceId}/loading-summary`] });
      toast({ title: "Cancelled", description: "Loading session cancelled." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createRemainingProformaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/factory/invoices/${invoiceId}/create-remaining-proforma`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json() as Promise<{ proformaId: number; proformaName: string }>;
    },
    onSuccess: (data) => {
      toast({ title: "Proforma created", description: `"${data.proformaName}" is ready. Opening now…` });
      navigate(`/factory/sales/proformas/${data.proformaId}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim();
    if (!code) return;
    scanBaleMutation.mutate(code);
  };

  const currentSession = summary?.sessions.find((s) => s.id === activeSessionId);
  const currentBales = summary?.currentSessionBales || [];
  const isFullyLoaded = (summary?.totals.remaining ?? 1) <= 0;
  const show50Warning = currentBales.length >= 50;
  const pendingLines = summary?.lines.filter((l) => l.remaining > 0) ?? [];
  const doneLineCount = (summary?.lines.length ?? 0) - pendingLines.length;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || (!isLoading && !summary)) {
    const msg = (error as any)?.message || "Invoice not found";
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 gap-3">
        <p className="text-destructive font-medium">{msg}</p>
        <Button variant="outline" onClick={() => navigate(`/factory/sales/invoices/${invoiceId}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Invoice
        </Button>
      </div>
    );
  }

  if (!summary) return null;

  const inv = summary.invoice;

  return (
    <div className="flex flex-col min-h-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* ── Back + Title ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/factory/sales/invoices/${invoiceId}`)}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold" data-testid="text-invoice-title">
              {inv.invoiceNumber || `Order #${inv.id}`}
            </h1>
            <Badge variant="default">Finalized</Badge>
            <Badge variant="outline" className="text-xs">
              Scan Loading
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {inv.customerName} · {inv.orderDate ? formatDisplayDate(inv.orderDate) : ""}
          </p>
        </div>
      </div>

      {/* ── Big counters ── */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Scanned</p>
            <p
              className="text-5xl font-bold text-green-600 dark:text-green-400 leading-none"
              data-testid="text-loaded-bales"
            >
              {summary.totals.alreadyLoaded}
            </p>
            <p className="text-xs text-muted-foreground mt-1">of {summary.totals.invoiceBales} bales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Remaining</p>
            <p
              className={`text-5xl font-bold leading-none ${
                summary.totals.remaining === 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
              data-testid="text-remaining-bales"
            >
              {summary.totals.remaining}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.sessions.length} session{summary.sessions.length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Fully loaded banner ── */}
      {isFullyLoaded && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              This invoice is fully loaded — all {summary.totals.invoiceBales} bales have been assigned to loading
              sessions.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Per-line summary (only pending lines shown) ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">Remaining Lines</CardTitle>
            {doneLineCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
                <CheckCircle className="h-3.5 w-3.5" />
                {doneLineCount} line{doneLineCount !== 1 ? "s" : ""} fully loaded
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pendingLines.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-green-700 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium text-sm">All lines fully loaded</span>
            </div>
          ) : (
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Article Code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Invoice Qty</TableHead>
                    <TableHead className="text-right">Loaded</TableHead>
                    {activeSessionId && <TableHead className="text-right">This Session</TableHead>}
                    <TableHead className="text-right">Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLines.map((line) => (
                    <TableRow key={line.lineId} data-testid={`row-line-${line.lineId}`}>
                      <TableCell className="font-mono text-xs">{line.articleCode}</TableCell>
                      <TableCell className="text-sm">
                        <button
                          className="text-left hover-elevate rounded-md px-1 -mx-1 py-0.5 font-medium underline-offset-2 hover:underline"
                          onClick={() => setBaleRefLine({ code: line.articleCode, name: line.productName })}
                          data-testid={`button-scan-bale-refs-${line.lineId}`}
                          title="Click to see all reference numbers"
                        >
                          {line.productName}
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-sm">{line.invoiceQty}</TableCell>
                      <TableCell className="text-right text-sm text-green-700 dark:text-green-400">
                        {line.alreadyLoaded}
                      </TableCell>
                      {activeSessionId && (
                        <TableCell className="text-right text-sm text-blue-700 dark:text-blue-400">
                          {line.currentSessionLoaded}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-sm font-bold text-amber-700 dark:text-amber-400">
                        {line.remaining}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Start loading form / active session scanner ── */}
      {!activeSessionId && !isFullyLoaded && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">Start New Loading Session</CardTitle>
              {!showStartForm && (
                <Button size="sm" onClick={() => setShowStartForm(true)} data-testid="button-show-start-form">
                  <Play className="h-4 w-4 mr-1" />
                  Start Loading
                </Button>
              )}
            </div>
          </CardHeader>
          {showStartForm && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="input-truck-no">Truck No.</Label>
                  <Input
                    id="input-truck-no"
                    placeholder="e.g. ABC-1234"
                    value={truckNo}
                    onChange={(e) => {
                      setTruckNo(e.target.value);
                      autosaveForm({ truckNo: e.target.value });
                    }}
                    data-testid="input-truck-no"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="input-driver-name">Driver Name</Label>
                  <Input
                    id="input-driver-name"
                    placeholder="Driver's name"
                    value={driverName}
                    onChange={(e) => {
                      setDriverName(e.target.value);
                      autosaveForm({ driverName: e.target.value });
                    }}
                    data-testid="input-driver-name"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-notes">Notes</Label>
                <Textarea
                  id="input-notes"
                  placeholder="Optional notes..."
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    autosaveForm({ notes: e.target.value });
                  }}
                  data-testid="input-notes"
                  className="resize-none"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => createSessionMutation.mutate()}
                  disabled={createSessionMutation.isPending}
                  data-testid="button-create-session"
                >
                  <Play className="h-4 w-4 mr-1" />
                  {createSessionMutation.isPending ? "Starting…" : "Start Session"}
                </Button>
                <Button variant="ghost" onClick={() => setShowStartForm(false)} data-testid="button-cancel-start-form">
                  Cancel
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Active session scanner ── */}
      {activeSessionId && currentSession && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium">Active Session #{currentSession.id}</CardTitle>
                <StatusBadge status={currentSession.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {currentSession.truckNo && (
                  <span className="flex items-center gap-1">
                    <Truck className="h-3 w-3" />
                    {currentSession.truckNo}
                  </span>
                )}
                {currentSession.driverName && <span>{currentSession.driverName}</span>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 50-bale warning */}
            {show50Warning && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  This load has reached {currentBales.length} bales. You can continue scanning if this truck is taking
                  more.
                </p>
              </div>
            )}

            {/* Scan flash feedback */}
            {scanFlash && (
              <div
                className={`flex items-center gap-2 p-3 rounded-md font-medium text-sm transition-all ${
                  scanFlash === "success"
                    ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700"
                    : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700"
                }`}
                data-testid="text-scan-feedback"
              >
                {scanFlash === "success" ? (
                  <CheckCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                {scanMessage}
              </div>
            )}

            {/* Scanner input */}
            <form onSubmit={handleScan} className="flex gap-2">
              <Input
                ref={scanRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Scan bale barcode / reference number…"
                className="font-mono text-base h-12 text-lg"
                autoComplete="off"
                autoFocus
                disabled={scanBaleMutation.isPending}
                data-testid="input-scanner"
              />
              <Button
                type="submit"
                size="default"
                className="h-12 px-5"
                disabled={!scanInput.trim() || scanBaleMutation.isPending}
                data-testid="button-scan-submit"
              >
                <ScanLine className="h-5 w-5" />
              </Button>
            </form>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{currentBales.length}</strong> scanned this session
              </span>
              <span>·</span>
              <span>
                <strong
                  className={
                    summary.totals.remaining === 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {summary.totals.remaining}
                </strong>{" "}
                remaining overall
              </span>
              <span>·</span>
              <span>
                Press <kbd className="text-xs border rounded px-1">Enter</kbd> to submit
              </span>
            </div>

            {/* Current session bales table */}
            {currentBales.length > 0 && (
              <div className="table-responsive rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Article</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...currentBales].reverse().map((b, i) => (
                      <TableRow key={b.id} data-testid={`row-scanned-bale-${b.baleId}`}>
                        <TableCell className="text-muted-foreground text-xs">{currentBales.length - i}</TableCell>
                        <TableCell className="font-mono text-sm">{b.baleReference}</TableCell>
                        <TableCell className="text-xs">{b.articleCode || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.productName || "—"}</TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {parseFloat(b.weightKg || "0").toFixed(3)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              activeSessionId &&
                              removeBaleFromSessionMutation.mutate({ sessionId: activeSessionId, baleId: b.baleId })
                            }
                            disabled={removeBaleFromSessionMutation.isPending}
                            data-testid={`button-remove-bale-${b.baleId}`}
                            title="Remove from session"
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Session actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                onClick={() => setCompleteDialogOpen(true)}
                disabled={currentBales.length === 0 || completeSessionMutation.isPending}
                data-testid="button-complete-session"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Complete Loading
              </Button>
              <Button variant="outline" onClick={() => setCancelDialogOpen(true)} data-testid="button-cancel-session">
                <XCircle className="h-4 w-4 mr-1" />
                Cancel Session
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(`/api/factory/invoice-loading-sessions/${activeSessionId}/export/excel`, "_blank")
                  }
                  data-testid="button-export-session-excel"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Session Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(`/api/factory/invoice-loading-sessions/${activeSessionId}/export/pdf`, "_blank")
                  }
                  data-testid="button-export-session-pdf"
                >
                  <FileDown className="h-4 w-4 mr-1" />
                  Session PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Create proforma for remaining bales ── */}
      {!activeSessionId &&
        !isFullyLoaded &&
        summary.totals.remaining > 0 &&
        summary.sessions.some((s) => s.status === "COMPLETED") && (
          <Card className="border-amber-200 dark:border-amber-800">
            <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <FilePlus className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    {summary.totals.remaining} bale{summary.totals.remaining !== 1 ? "s" : ""} not loaded
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Create a new proforma with the remaining items so you can start a new loading.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => createRemainingProformaMutation.mutate()}
                disabled={createRemainingProformaMutation.isPending}
                data-testid="button-create-remaining-proforma"
              >
                <FilePlus className="h-4 w-4 mr-1" />
                {createRemainingProformaMutation.isPending ? "Creating…" : "Create Proforma for Remaining"}
              </Button>
            </CardContent>
          </Card>
        )}

      {/* ── Previous sessions ── */}
      {summary.sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">Loading Sessions</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(`/api/factory/invoices/${invoiceId}/loading-report/export/excel`, "_blank")
                  }
                  data-testid="button-export-report-excel"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Full Report Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`/api/factory/invoices/${invoiceId}/loading-report/export/pdf`, "_blank")}
                  data-testid="button-export-report-pdf"
                >
                  <FileDown className="h-4 w-4 mr-1" />
                  Full Report PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="table-responsive">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Truck / Driver</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="text-right">Bales</TableHead>
                    <TableHead className="text-right w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.sessions.map((s) => (
                    <TableRow
                      key={s.id}
                      data-testid={`row-session-${s.id}`}
                      className={s.id === activeSessionId ? "bg-blue-50 dark:bg-blue-950/40" : ""}
                    >
                      <TableCell className="font-mono text-sm">#{s.id}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.truckNo || s.driverName ? [s.truckNo, s.driverName].filter(Boolean).join(" / ") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtTime(s.startedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtTime(s.completedAt)}
                      </TableCell>
                      <TableCell className="text-right font-medium">{s.totalBales}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {s.status !== "CANCELLED" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewSessionId(s.id)}
                              data-testid={`button-view-session-bales-${s.id}`}
                              title="View & manage bales"
                            >
                              <List className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {s.status === "OPEN" && s.id !== activeSessionId && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActiveSessionId(s.id)}
                              data-testid={`button-resume-session-${s.id}`}
                              title="Resume this session"
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              Resume
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Export session Excel"
                            onClick={() =>
                              window.open(`/api/factory/invoice-loading-sessions/${s.id}/export/excel`, "_blank")
                            }
                            data-testid={`button-session-excel-${s.id}`}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Export session PDF"
                            onClick={() =>
                              window.open(`/api/factory/invoice-loading-sessions/${s.id}/export/pdf`, "_blank")
                            }
                            data-testid={`button-session-pdf-${s.id}`}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── No sessions yet ── */}
      {summary.sessions.length === 0 && !showStartForm && !activeSessionId && (
        <Card>
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No loading sessions yet for this invoice.</p>
            {!isFullyLoaded && (
              <Button onClick={() => setShowStartForm(true)} data-testid="button-show-start-form-empty">
                <Play className="h-4 w-4 mr-1" />
                Start Loading
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Dialogs ── */}
      <AlertDialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete loading session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark session #{activeSessionId} as COMPLETED with {currentBales.length} bale
              {currentBales.length !== 1 ? "s" : ""}. You can start another session later for remaining bales.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-complete-dialog">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCompleteDialogOpen(false);
                completeSessionMutation.mutate();
              }}
              disabled={completeSessionMutation.isPending}
              data-testid="button-confirm-complete"
            >
              {completeSessionMutation.isPending ? "Completing…" : "Complete Session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this loading session?</AlertDialogTitle>
            <AlertDialogDescription>
              Session #{activeSessionId} will be cancelled. Scanned bales will be kept for audit history but will no
              longer count as loaded. Bales can be re-scanned in a new session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-cancel-dialog">Keep Session</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                setCancelDialogOpen(false);
                cancelSessionMutation.mutate();
              }}
              disabled={cancelSessionMutation.isPending}
              data-testid="button-confirm-cancel-session"
            >
              {cancelSessionMutation.isPending ? "Cancelling…" : "Cancel Session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View / Delete session bales dialog */}
      <Dialog
        open={viewSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setViewSessionId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {(() => {
            const session = summary?.sessions.find((s) => s.id === viewSessionId);
            const sessionBales = (summary?.invoiceBales ?? []).filter((b) => b.loadedSessionId === viewSessionId);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base flex flex-wrap items-center gap-2">
                    Session #{viewSessionId}
                    {session && <StatusBadge status={session.status} />}
                    {session?.truckNo && (
                      <span className="font-mono text-sm text-muted-foreground">{session.truckNo}</span>
                    )}
                    {session?.driverName && (
                      <span className="text-sm text-muted-foreground">/ {session.driverName}</span>
                    )}
                  </DialogTitle>
                </DialogHeader>
                {sessionBales.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No bales found in this session.</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {sessionBales.length} bale{sessionBales.length !== 1 ? "s" : ""}. Click the trash icon to remove a
                      bale and return it to unloaded.
                    </p>
                    <div className="table-responsive rounded-md border">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Reference</TableHead>
                            <TableHead>Article</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Weight (kg)</TableHead>
                            <TableHead className="w-8"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sessionBales
                            .sort((a, b) => a.baleReference.localeCompare(b.baleReference))
                            .map((b) => (
                              <TableRow key={b.baleId} data-testid={`row-view-session-bale-${b.baleId}`}>
                                <TableCell className="font-mono text-sm">{b.baleReference}</TableCell>
                                <TableCell className="text-xs">{b.articleCode || "—"}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{b.productName || "—"}</TableCell>
                                <TableCell className="text-right text-sm font-mono">
                                  {parseFloat(b.weightKg || "0").toFixed(3)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={removeBaleFromSessionMutation.isPending}
                                    onClick={() =>
                                      viewSessionId &&
                                      removeBaleFromSessionMutation.mutate({
                                        sessionId: viewSessionId,
                                        baleId: b.baleId,
                                      })
                                    }
                                    data-testid={`button-delete-session-bale-${b.baleId}`}
                                    title="Remove bale and return to unloaded"
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Bale References Dialog */}
      <Dialog
        open={baleRefLine !== null}
        onOpenChange={(open) => {
          if (!open) setBaleRefLine(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {baleRefLine?.name}
              <span className="ml-2 font-mono text-sm text-muted-foreground">({baleRefLine?.code})</span>
            </DialogTitle>
          </DialogHeader>
          {baleRefLine &&
            (() => {
              const bales = (summary?.invoiceBales ?? [])
                .filter((b) => b.articleCode === baleRefLine.code)
                .sort((a, b) => a.baleReference.localeCompare(b.baleReference));
              if (bales.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No bale references found for this item.
                  </p>
                );
              }
              const loaded = bales.filter((b) => b.loaded);
              const pending = bales.filter((b) => !b.loaded);
              return (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    {bales.length} total ·{" "}
                    <span className="text-green-700 dark:text-green-400">{loaded.length} loaded</span>
                    {pending.length > 0 && (
                      <>
                        {" "}
                        · <span className="text-amber-700 dark:text-amber-400">{pending.length} pending</span>
                      </>
                    )}
                  </p>
                  {loaded.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Loaded</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {loaded.map((b) => (
                          <div
                            key={b.baleId}
                            className="rounded-md border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 px-2.5 py-1.5 font-mono text-sm text-center text-green-800 dark:text-green-300"
                          >
                            {b.baleReference}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {pending.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        Not Yet Loaded
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {pending.map((b) => (
                          <div
                            key={b.baleId}
                            className="rounded-md border bg-muted/30 px-2.5 py-1.5 font-mono text-sm text-center"
                          >
                            {b.baleReference}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
