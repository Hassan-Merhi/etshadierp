// LEGACY — Stock Allocation V3. Superseded by FactoryStockAllocationV5. Kept as fallback only. Route: /factory/stock-allocation-v3 (not in sidebar).
import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Package,
  ScanLine,
  Play,
  CheckCircle,
  XCircle,
  Eye,
  Trash2,
  Plus,
  Container,
  BarChart3,
  Clock,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";

// ─────────────────────── Types ───────────────────────

interface StockRow {
  articleCode: string;
  productName: string;
  inStockBales: number;
  inStockKg: string;
  expectedToLoadBales: number;
  expectedToLoadKg: string;
  loadingBales: number;
  loadingKg: string;
  ftpBales: number;
  ftpKg: string;
}

interface V3Load {
  id: number;
  proformaId: number;
  proformaName: string;
  customerName: string;
  customerId: number;
  loadName: string;
  expectedLoadDate: string;
  notes: string | null;
  status: string;
  createdByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  cancelledAt: string | null;
  totalBales: number;
  scannedBales: number;
  totalWeightKg: string;
  scannedWeightKg: string;
}

interface LoadBale {
  id: number;
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  phase: string;
  addedByName: string | null;
  addedAt: string;
  removedByName: string | null;
  removedAt: string | null;
  baleStatus: string;
}

interface ProformaLine {
  articleCode: string;
  productName: string;
  quantity: number;
}

interface LoadDetail extends V3Load {
  bales: LoadBale[];
  proformaLines: ProformaLine[];
}

interface Proforma {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  customerId: number;
  customerName: string;
  lineCount: number;
  totalQty: number;
  v3LoadCount: number;
  v3ActiveCount: number;
}

// ─────────────────────── Helpers ───────────────────────

function fmtKg(kg: string | number) {
  return `${parseFloat(String(kg)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

const STATUS_COLORS: Record<string, string> = {
  expected_to_load: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  loading: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  finalized: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<string, string> = {
  expected_to_load: "Expected to Load",
  loading: "Loading",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─────────────────────── Scanning Detail Panel ───────────────────────

function ScanningPanel({ load, onClose }: { load: V3Load; onClose: () => void }) {
  const { toast } = useToast();
  const [scanCode, setScanCode] = useState("");
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [pendingBypass, setPendingBypass] = useState<{ code: string; message: string } | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const scannerRef = useRef<HTMLInputElement>(null);

  const { data: detail, isLoading } = useQuery<LoadDetail>({
    queryKey: ["/api/factory/v3/loads", load.id],
    queryFn: async () => {
      const r = await fetch(`/api/factory/v3/loads/${load.id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch load detail");
      return r.json();
    },
    refetchInterval: 30000,
  });

  const scanMutation = useMutation({
    mutationFn: async ({ code, bypass }: { code: string; bypass?: boolean }) => {
      const r = await fetch(`/api/factory/v3/loads/${load.id}/bales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ scanCode: code, bypass: bypass ?? false }),
      });
      const data = await r.json();
      if (!r.ok) throw { status: r.status, ...data };
      return data;
    },
    onSuccess: () => {
      setScanFlash("success");
      setScanCode("");
      setPendingBypass(null);
      setTimeout(() => setScanFlash(null), 800);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads", load.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
      scannerRef.current?.focus();
    },
    onError: (err: any) => {
      if (err.code === "RESERVED_WARNING" || err.code === "OTHER_V3_LOAD_WARNING") {
        setPendingBypass({ code: scanCode, message: err.message });
        setScanCode("");
        return;
      }
      setScanFlash("error");
      setTimeout(() => setScanFlash(null), 800);
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
      setScanCode("");
      scannerRef.current?.focus();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (lbId: number) => {
      const r = await fetch(`/api/factory/v3/loads/${load.id}/bales/${lbId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to remove bale");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads", load.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/factory/v3/loads/${load.id}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Load finalized", description: `${load.loadName} has been finalized.` });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleScan = useCallback(() => {
    const code = scanCode.trim();
    if (!code) return;
    scanMutation.mutate({ code });
  }, [scanCode, scanMutation]);

  const handleBypass = () => {
    if (!pendingBypass) return;
    scanMutation.mutate({ code: pendingBypass.code, bypass: true });
  };

  const activeBales = detail?.bales.filter((b) => !b.removedAt) ?? [];
  const removedBales = detail?.bales.filter((b) => b.removedAt) ?? [];

  // Build per-article summary: expected (from proforma lines) vs scanned
  const summaryMap = new Map<
    string,
    { productName: string; expectedQty: number; scannedBales: number; scannedKg: number }
  >();
  for (const line of detail?.proformaLines ?? []) {
    summaryMap.set(line.articleCode, {
      productName: line.productName,
      expectedQty: line.quantity,
      scannedBales: 0,
      scannedKg: 0,
    });
  }
  for (const b of activeBales) {
    if (!b.articleCode) continue;
    const row = summaryMap.get(b.articleCode) ?? {
      productName: b.productName ?? b.articleCode,
      expectedQty: 0,
      scannedBales: 0,
      scannedKg: 0,
    };
    row.scannedBales++;
    row.scannedKg += parseFloat(b.weightKg ?? "0");
    summaryMap.set(b.articleCode, row);
  }
  const summaryRows = Array.from(summaryMap.entries()).map(([code, v]) => ({ code, ...v }));

  const totalExpected = summaryRows.reduce((s, r) => s + r.expectedQty, 0);
  const totalScanned = activeBales.length;
  const diff = totalScanned - totalExpected;

  const flashClass =
    scanFlash === "success"
      ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950/20"
      : scanFlash === "error"
        ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950/20"
        : "";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-v3-scan-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{load.loadName}</span>
            <StatusBadge status={load.status} />
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {load.proformaName} · {load.customerName}
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setConfirmFinalize(true)}
          disabled={finalizeMutation.isPending || activeBales.length === 0}
          data-testid="button-v3-finalize"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
          Finalize Load
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Scan input */}
        <Card className={`transition-all duration-150 ${flashClass}`}>
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Scan Bale</p>
            <div className="flex gap-2">
              <Input
                ref={scannerRef}
                autoFocus
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleScan();
                }}
                placeholder="Scan barcode or type reference..."
                className="font-mono text-sm"
                data-testid="input-v3-scan"
              />
              <Button
                onClick={handleScan}
                disabled={scanMutation.isPending || !scanCode.trim()}
                data-testid="button-v3-scan-submit"
              >
                {scanMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Totals strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Expected</p>
              <p className="text-lg font-semibold">{totalExpected}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Scanned</p>
              <p className="text-lg font-semibold text-green-600 dark:text-green-400">{totalScanned}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Difference</p>
              <p
                className={`text-lg font-semibold ${diff < 0 ? "text-orange-500" : diff > 0 ? "text-blue-500" : "text-muted-foreground"}`}
              >
                {diff > 0 ? "+" : ""}
                {diff}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Per-article summary */}
        {summaryRows.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm">Item Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="pl-4 text-xs">Item</TableHead>
                    <TableHead className="text-xs text-right">Expected</TableHead>
                    <TableHead className="text-xs text-right">Scanned</TableHead>
                    <TableHead className="pr-4 text-xs text-right">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryRows.map((r) => {
                    const d = r.scannedBales - r.expectedQty;
                    return (
                      <TableRow key={r.code}>
                        <TableCell className="pl-4 py-2">
                          <p className="text-sm font-medium">{r.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{r.code}</p>
                        </TableCell>
                        <TableCell className="text-right text-sm py-2">{r.expectedQty}</TableCell>
                        <TableCell className="text-right text-sm py-2 text-green-600 dark:text-green-400">
                          {r.scannedBales}
                        </TableCell>
                        <TableCell
                          className={`pr-4 text-right text-sm py-2 font-medium ${d < 0 ? "text-orange-500" : d > 0 ? "text-blue-500" : "text-muted-foreground"}`}
                        >
                          {d > 0 ? "+" : ""}
                          {d}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Scanned bales list */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">Scanned Bales ({activeBales.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>}
            {!isLoading && activeBales.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No bales scanned yet</p>
            )}
            <Table>
              <TableBody>
                {activeBales.map((b) => (
                  <TableRow key={b.id} data-testid={`row-v3-bale-${b.id}`}>
                    <TableCell className="pl-4 py-2">
                      <p className="text-sm font-mono font-medium">{b.baleReference}</p>
                      <p className="text-xs text-muted-foreground">{b.productName ?? b.articleCode ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm py-2 text-muted-foreground">{fmtKg(b.weightKg)}</TableCell>
                    <TableCell className="py-2 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutation.mutate(b.id)}
                        disabled={removeMutation.isPending}
                        data-testid={`button-v3-remove-bale-${b.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Removed bales (collapsed) */}
        {removedBales.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {removedBales.length} bale(s) removed from this load
          </p>
        )}
      </div>

      {/* Bypass warning dialog */}
      <AlertDialog
        open={!!pendingBypass}
        onOpenChange={(open) => {
          if (!open) setPendingBypass(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" /> Warning
            </AlertDialogTitle>
            <AlertDialogDescription>{pendingBypass?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingBypass(null);
                scannerRef.current?.focus();
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleBypass}>Load Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Finalize confirm */}
      <AlertDialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalize Load?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all {activeBales.length} scanned bales as SOLD and close the load. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmFinalize(false);
                finalizeMutation.mutate();
              }}
            >
              Finalize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────── Create Load Dialog ───────────────────────

function CreateLoadDialog({
  proforma,
  open,
  onClose,
}: {
  proforma: Proforma | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [loadName, setLoadName] = useState("");
  const [expectedDate, setExpectedDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [notes, setNotes] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/factory/v3/loads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ proformaId: proforma!.id, loadName, expectedLoadDate: expectedDate, notes }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Load created", description: `"${loadName}" added to Expected to Load.` });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/proformas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
      setLoadName("");
      setNotes("");
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to Expected to Load</DialogTitle>
        </DialogHeader>
        {proforma && proforma.v3ActiveCount > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
            <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
            <p className="text-sm text-orange-700 dark:text-orange-300">
              This proforma already has {proforma.v3ActiveCount} active loading job(s). You can still create another —
              make sure quantities and bales are correct.
            </p>
          </div>
        )}
        <div className="space-y-4 py-1">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Proforma</Label>
            <p className="text-sm font-medium">
              {proforma?.name} · {proforma?.customerName}
            </p>
          </div>
          <div>
            <Label htmlFor="v3-load-name" className="text-xs mb-1 block">
              Load Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="v3-load-name"
              value={loadName}
              onChange={(e) => setLoadName(e.target.value)}
              placeholder="e.g. Container 1, Truck A"
              data-testid="input-v3-load-name"
            />
          </div>
          <div>
            <Label htmlFor="v3-load-date" className="text-xs mb-1 block">
              Expected Load Date <span className="text-red-500">*</span>
            </Label>
            <Input
              id="v3-load-date"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              data-testid="input-v3-load-date"
            />
          </div>
          <div>
            <Label htmlFor="v3-load-notes" className="text-xs mb-1 block">
              Notes
            </Label>
            <Textarea
              id="v3-load-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              data-testid="input-v3-load-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-v3-create-load-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !loadName.trim() || !expectedDate}
            data-testid="button-v3-create-load-submit"
          >
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create Load
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────── Main Page ───────────────────────

const TABS = ["overview", "expected", "loading", "finalized", "proformas"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Stock Overview",
  expected: "Expected to Load",
  loading: "Loading",
  finalized: "Finalized",
  proformas: "Proformas",
};

export default function FactoryStockAllocationV3() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [scanningLoad, setScanningLoad] = useState<V3Load | null>(null);
  const [createLoadProforma, setCreateLoadProforma] = useState<Proforma | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);

  // Queries
  const { data: stockRows = [], isLoading: stockLoading } = useQuery<StockRow[]>({
    queryKey: ["/api/factory/v3/stock-overview"],
  });

  const { data: expectedLoads = [] } = useQuery<V3Load[]>({
    queryKey: ["/api/factory/v3/loads", "expected_to_load"],
    queryFn: () =>
      fetch("/api/factory/v3/loads?status=expected_to_load", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: loadingLoads = [] } = useQuery<V3Load[]>({
    queryKey: ["/api/factory/v3/loads", "loading"],
    queryFn: () => fetch("/api/factory/v3/loads?status=loading", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: finalizedLoads = [] } = useQuery<V3Load[]>({
    queryKey: ["/api/factory/v3/loads", "finalized"],
    queryFn: () => fetch("/api/factory/v3/loads?status=finalized", { credentials: "include" }).then((r) => r.json()),
  });

  const { data: proformas = [] } = useQuery<Proforma[]>({
    queryKey: ["/api/factory/v3/proformas"],
  });

  // KPI totals
  const totalInStock = stockRows.reduce((s, r) => s + (r.inStockBales ?? 0), 0);
  const totalEtl = stockRows.reduce((s, r) => s + (r.expectedToLoadBales ?? 0), 0);
  const totalLoading = stockRows.reduce((s, r) => s + (r.loadingBales ?? 0), 0);
  const totalFtp = stockRows.reduce((s, r) => s + (r.ftpBales ?? 0), 0);

  const startMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/factory/v3/loads/${id}/start`, { method: "PATCH", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: (_, id) => {
      toast({ title: "Loading started" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
      setActiveTab("loading");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/factory/v3/loads/${id}/cancel`, { method: "PATCH", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Load cancelled" });
      setCancelTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/loads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/v3/stock-overview"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // If scanning panel is open, show it full-screen
  if (scanningLoad) {
    return (
      <div className="h-full flex flex-col bg-background">
        <ScanningPanel load={scanningLoad} onClose={() => setScanningLoad(null)} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Page header */}
      <div className="px-6 pt-5 pb-3 border-b shrink-0">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <PageHeader title="Stock Allocation" />
          <Badge className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded">v3.0 TEST</Badge>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Factory 2.0 isolated module — not production
          </span>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Stock in Hand</p>
              <p className="text-2xl font-bold">{totalInStock}</p>
              <p className="text-xs text-muted-foreground">bales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-blue-600 dark:text-blue-400">Expected to Load</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalEtl}</p>
              <p className="text-xs text-muted-foreground">bales reserved</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-orange-600 dark:text-orange-400">Loading</p>
              <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{totalLoading}</p>
              <p className="text-xs text-muted-foreground">bales in progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-green-600 dark:text-green-400">Free to Promise</p>
              <p
                className={`text-2xl font-bold ${totalFtp < 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}
              >
                {totalFtp}
              </p>
              <p className="text-xs text-muted-foreground">bales available</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`button-v3-tab-${tab}`}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-sidebar-accent/40"
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === "expected" && expectedLoads.length > 0 && (
                <span className="ml-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded px-1">
                  {expectedLoads.length}
                </span>
              )}
              {tab === "loading" && loadingLoads.length > 0 && (
                <span className="ml-1.5 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded px-1">
                  {loadingLoads.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* ── Stock Overview ── */}
        {activeTab === "overview" && (
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              Per-article breakdown. FTP = Stock in Hand − Expected to Load − Loading.
            </p>
            {stockLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {!stockLoading && stockRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No stock data available.</p>
            )}
            {stockRows.length > 0 && (
              <div className="rounded-md border table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Product</TableHead>
                      <TableHead className="text-right">Stock in Hand</TableHead>
                      <TableHead className="text-right">Expected to Load</TableHead>
                      <TableHead className="text-right">Loading</TableHead>
                      <TableHead className="text-right pr-4">Free to Promise</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockRows.map((r) => (
                      <TableRow key={r.articleCode} data-testid={`row-v3-stock-${r.articleCode}`}>
                        <TableCell className="pl-4 py-2">
                          <p className="text-sm font-medium">{r.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{r.articleCode}</p>
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <p className="text-sm font-semibold">{r.inStockBales}</p>
                          <p className="text-xs text-muted-foreground">{fmtKg(r.inStockKg)}</p>
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                            {r.expectedToLoadBales}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmtKg(r.expectedToLoadKg)}</p>
                        </TableCell>
                        <TableCell className="text-right py-2">
                          <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">{r.loadingBales}</p>
                          <p className="text-xs text-muted-foreground">{fmtKg(r.loadingKg)}</p>
                        </TableCell>
                        <TableCell className="text-right pr-4 py-2">
                          <p
                            className={`text-sm font-semibold ${r.ftpBales < 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}
                          >
                            {r.ftpBales}
                          </p>
                          <p className="text-xs text-muted-foreground">{fmtKg(r.ftpKg)}</p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* ── Expected to Load ── */}
        {activeTab === "expected" && (
          <div>
            {expectedLoads.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Container className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No loads in Expected to Load.</p>
                <p className="text-xs mt-1">Go to Proformas tab to create one.</p>
              </div>
            )}
            {expectedLoads.length > 0 && (
              <div className="rounded-md border table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Load Name</TableHead>
                      <TableHead>Proforma</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Expected Date</TableHead>
                      <TableHead className="text-right">Bales</TableHead>
                      <TableHead className="pr-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expectedLoads.map((l) => (
                      <TableRow key={l.id} data-testid={`row-v3-expected-${l.id}`}>
                        <TableCell className="pl-4 py-2">
                          <p className="text-sm font-medium">{l.loadName}</p>
                          <p className="text-xs text-muted-foreground">{l.createdByName ?? "—"}</p>
                        </TableCell>
                        <TableCell className="py-2 text-sm">{l.proformaName}</TableCell>
                        <TableCell className="py-2 text-sm">{l.customerName}</TableCell>
                        <TableCell className="py-2 text-sm">{fmtDate(l.expectedLoadDate)}</TableCell>
                        <TableCell className="text-right py-2 text-sm">{l.totalBales}</TableCell>
                        <TableCell className="pr-4 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              onClick={() => startMutation.mutate(l.id)}
                              disabled={startMutation.isPending}
                              data-testid={`button-v3-start-${l.id}`}
                            >
                              <Play className="h-3 w-3 mr-1" />
                              Start Loading
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setCancelTargetId(l.id)}
                              data-testid={`button-v3-cancel-${l.id}`}
                            >
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {activeTab === "loading" && (
          <div>
            {loadingLoads.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No loads currently being loaded.</p>
              </div>
            )}
            {loadingLoads.length > 0 && (
              <div className="space-y-3">
                {loadingLoads.map((l) => (
                  <Card key={l.id} data-testid={`card-v3-loading-${l.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold">{l.loadName}</span>
                            <StatusBadge status={l.status} />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {l.proformaName} · {l.customerName}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">Started: {fmtDateTime(l.startedAt)}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Scanned</p>
                            <p className="text-lg font-bold text-green-600 dark:text-green-400">{l.scannedBales}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Total Bales</p>
                            <p className="text-lg font-bold">{l.totalBales}</p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => setScanningLoad(l)}
                            data-testid={`button-v3-continue-${l.id}`}
                          >
                            <ChevronRight className="h-3.5 w-3.5 mr-1" />
                            Continue
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Finalized ── */}
        {activeTab === "finalized" && (
          <div>
            {finalizedLoads.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No finalized loads yet.</p>
              </div>
            )}
            {finalizedLoads.length > 0 && (
              <div className="rounded-md border table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Load Name</TableHead>
                      <TableHead>Proforma</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Finalized At</TableHead>
                      <TableHead className="text-right">Bales</TableHead>
                      <TableHead className="text-right pr-4">Weight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {finalizedLoads.map((l) => (
                      <TableRow key={l.id} data-testid={`row-v3-finalized-${l.id}`}>
                        <TableCell className="pl-4 py-2">
                          <p className="text-sm font-medium">{l.loadName}</p>
                          <p className="text-xs text-muted-foreground">{l.finalizedByName ?? "—"}</p>
                        </TableCell>
                        <TableCell className="py-2 text-sm">{l.proformaName}</TableCell>
                        <TableCell className="py-2 text-sm">{l.customerName}</TableCell>
                        <TableCell className="py-2 text-sm">{fmtDateTime(l.finalizedAt)}</TableCell>
                        <TableCell className="text-right py-2 text-sm font-semibold">{l.scannedBales}</TableCell>
                        <TableCell className="text-right pr-4 py-2 text-sm text-muted-foreground">
                          {fmtKg(l.scannedWeightKg)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* ── Proformas ── */}
        {activeTab === "proformas" && (
          <div>
            <p className="text-sm text-muted-foreground mb-3">
              Active proformas. Click "Send to Expected to Load" to create a loading job.
            </p>
            {proformas.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No active proformas found.</p>
              </div>
            )}
            {proformas.length > 0 && (
              <div className="rounded-md border table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="pl-4">Proforma</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead>V3 Loads</TableHead>
                      <TableHead className="pr-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proformas.map((p) => (
                      <TableRow key={p.id} data-testid={`row-v3-proforma-${p.id}`}>
                        <TableCell className="pl-4 py-2">
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</p>
                        </TableCell>
                        <TableCell className="py-2 text-sm">{p.customerName}</TableCell>
                        <TableCell className="text-right py-2 text-sm">{p.lineCount}</TableCell>
                        <TableCell className="text-right py-2 text-sm">{p.totalQty}</TableCell>
                        <TableCell className="py-2">
                          {p.v3LoadCount > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{p.v3LoadCount}</span>
                              {p.v3ActiveCount > 0 && (
                                <span className="text-xs text-orange-600 dark:text-orange-400">
                                  ({p.v3ActiveCount} active)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCreateLoadProforma(p)}
                            data-testid={`button-v3-send-etl-${p.id}`}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Send to ETL
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancel confirmation */}
      <AlertDialog
        open={cancelTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTargetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this load?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the expected load. Free to Promise will be restored. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelTargetId && cancelMutation.mutate(cancelTargetId)}>
              Cancel Load
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Load dialog */}
      <CreateLoadDialog
        proforma={createLoadProforma}
        open={!!createLoadProforma}
        onClose={() => setCreateLoadProforma(null)}
      />
    </div>
  );
}
