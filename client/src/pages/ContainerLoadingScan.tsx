import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Badge } from "@/components/ui/badge";
import { useState, useRef, useCallback, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation } from "wouter";
import {
  ScanLine,
  Trash2,
  Package,
  MapPin,
  Play,
  CheckCircle,
  Clock,
  Save,
  AlertTriangle,
  Rows3,
  AlignJustify,
  StickyNote,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";

interface Customer {
  id: number;
  legalName: string;
}

interface Location {
  id: number;
  name: string;
  code?: string;
}

interface ProformaLine {
  id: number;
  articleCode: string;
  productName: string;
  quantity: number;
  pricePerBale: string;
  weightPerBaleKg?: string | null;
}

interface Proforma {
  id: number;
  customerId: number;
  name: string;
  isActive: boolean;
  lines: ProformaLine[];
}

interface OrderBale {
  id: number;
  baleId: number;
  baleReference: string;
  articleCode: string;
  baleName: string;
  weight: string;
  priceUsed: string;
}

interface OrderDetail {
  id: number;
  customerId: number;
  locationId: number;
  companyId: number;
  orderDate: string;
  status: string;
  proformaIdUsed: number | null;
  totalQtyBales: number;
  containerNotes: string | null;
  bales: OrderBale[];
}

export default function ContainerLoadingScan() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [orderDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [loadingNote, setLoadingNote] = useState<string>("");
  const [scanCode, setScanCode] = useState("");
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"detailed" | "condensed">("detailed");
  const [lastScannedRef, setLastScannedRef] = useState<{
    baleReference: string;
    baleName: string;
    articleCode: string;
  } | null>(null);
  const [showScanSuccessPopup, setShowScanSuccessPopup] = useState(false);
  const [showScanErrorPopup, setShowScanErrorPopup] = useState(false);
  const [pendingBypassBaleRef, setPendingBypassBaleRef] = useState<string | null>(null);
  const [pendingBypassOverloadRef, setPendingBypassOverloadRef] = useState<string | null>(null);
  const [showLastScannedPopup, setShowLastScannedPopup] = useState(false);
  const scannerRef = useRef<HTMLInputElement>(null);

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  // On mount: check for ?orderId= resume param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resumeOrderId = params.get("orderId");
    if (resumeOrderId) {
      const id = parseInt(resumeOrderId);
      if (!isNaN(id)) {
        setOrderId(id);
        setIsResuming(true);
      }
    }
  }, []);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: proformas = [] } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-proformas?customerId=${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!customerId,
  });

  const { data: orderDetail } = useQuery<OrderDetail>({
    queryKey: ["/api/factory/customer-orders", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch order");
      return res.json();
    },
    enabled: !!orderId,
    refetchInterval: 15000,
  });

  // Auto-select location when there is only one option
  useEffect(() => {
    if (!orderId && locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(String(locations[0].id));
    }
  }, [locations, orderId, selectedLocationId]);

  // When resuming: restore customer/location/note and show last scanned popup
  useEffect(() => {
    if (isResuming && orderDetail && !selectedCustomerId) {
      setSelectedCustomerId(String(orderDetail.customerId));
      setSelectedLocationId(String(orderDetail.locationId || ""));
      setLoadingNote(orderDetail.containerNotes || "");
      const stored = localStorage.getItem(`lastScannedBale_${orderDetail.id}`);
      if (stored) {
        try {
          setLastScannedRef(JSON.parse(stored));
        } catch {
          setLastScannedRef({ baleReference: stored, baleName: "", articleCode: "" });
        }
        setShowLastScannedPopup(true);
      }
      setTimeout(() => scannerRef.current?.focus(), 200);
    }
  }, [isResuming, orderDetail, selectedCustomerId]);

  const createOrderMutation = useMutation({
    mutationFn: async (data: {
      customerId: number;
      proformaIdUsed: number | null;
      locationId: number;
      orderDate: string;
      containerNotes?: string;
    }) => {
      const res = await modeApiRequest("POST", "/api/factory/customer-orders-loading", data);
      return await res.json();
    },
    onSuccess: (data: any) => {
      setOrderId(data.id);
      toast({ title: "Loading order created", description: "You can now start scanning bales" });
      setTimeout(() => scannerRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addBaleMutation = useMutation({
    mutationFn: async (data: {
      scanCode: string;
      locationId: number;
      allowBypassProforma?: boolean;
      allowBypassOverload?: boolean;
    }) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/bales`, data);
      return await res.json();
    },
    onSuccess: (
      data: any,
      variables: { scanCode: string; locationId: number; allowBypassProforma?: boolean; allowBypassOverload?: boolean }
    ) => {
      setPendingBypassBaleRef(null);
      setPendingBypassOverloadRef(null);
      setScanFlash("success");
      setShowScanSuccessPopup(true);
      const speechMsg = variables.allowBypassProforma ? "Bypass confirmed. Item added." : "Scanned successfully";
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 1000;
        ctx.resume().then(() => {
          osc.start();
          setTimeout(() => {
            osc.stop();
            ctx.close();
          }, 120);
        });
      } catch {
        /* no audio support */
      }
      setTimeout(() => {
        setScanFlash(null);
        setShowScanSuccessPopup(false);
      }, 500);
      if (orderId) {
        const scanned = variables.scanCode;
        const newestForRef = [...(data?.bales || [])].sort((a: any, b: any) => b.id - a.id)[0];
        const lastScanned = {
          baleReference: newestForRef?.baleReference || scanned,
          baleName: newestForRef?.baleName || "",
          articleCode: newestForRef?.articleCode || "",
        };
        localStorage.setItem(`lastScannedBale_${orderId}`, JSON.stringify(lastScanned));
        setLastScannedRef(lastScanned);
      }
      const newest = [...(data?.bales || [])].sort((a: any, b: any) => b.id - a.id)[0];
      if (newest?.articleCode) {
        setExpandedGroups((prev) => {
          const next = new Set(prev);
          next.add(newest.articleCode);
          return next;
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      setScanCode("");
      scannerRef.current?.focus();
    },
    onError: (error: Error, variables: any) => {
      if ((error as any).overloaded) {
        setPendingBypassOverloadRef(variables.scanCode);
        setPendingBypassBaleRef(null);
        setScanFlash("error");
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.frequency.value = 550;
          ctx.resume().then(() => {
            osc.start();
            setTimeout(() => {
              osc.stop();
              ctx.close();
            }, 180);
          });
        } catch {
          /* no audio support */
        }
        setTimeout(() => setScanFlash(null), 600);
        setScanCode("");
        scannerRef.current?.focus();
        return;
      }
      if ((error as any).notInProforma) {
        setPendingBypassBaleRef(variables.scanCode);
        setPendingBypassOverloadRef(null);
        setScanFlash("error");
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          osc.connect(ctx.destination);
          osc.frequency.value = 600;
          ctx.resume().then(() => {
            osc.start();
            setTimeout(() => {
              osc.stop();
              ctx.close();
            }, 180);
          });
        } catch {
          /* no audio support */
        }
        setTimeout(() => setScanFlash(null), 600);
        setScanCode("");
        scannerRef.current?.focus();
        return;
      }
      setScanFlash("error");
      setShowScanErrorPopup(true);
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.connect(ctx.destination);
        ctx.resume().then(() => {
          osc.frequency.setValueAtTime(700, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.18);
          osc.start();
          setTimeout(() => {
            osc.stop();
            ctx.close();
          }, 220);
        });
      } catch {
        /* no audio support */
      }
      setTimeout(() => {
        setScanFlash(null);
        setShowScanErrorPopup(false);
      }, 1500);
      toast({ title: "Scan Error", description: error.message, variant: "destructive" });
      setScanCode("");
      scannerRef.current?.focus();
    },
  });

  const removeBaleMutation = useMutation({
    mutationFn: async (baleId: number) => {
      await modeApiRequest("DELETE", `/api/factory/customer-orders/${orderId}/bales/${baleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      toast({ title: "Bale removed" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/finalize-loading`);
    },
    onSuccess: () => {
      toast({ title: "Loading finalized", description: "Loading has been sent for office verification" });
      setShowFinalizeDialog(false);
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      navigate("/factory/invoicing?tab=invoices");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setShowFinalizeDialog(false);
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/assign-container`, {
        containerNotes: note,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Note saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders?status=LOADING") });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error saving note", description: error.message, variant: "destructive" });
    },
  });

  const handleStartLoading = useCallback(() => {
    if (!customerId || !selectedLocationId) return;
    const activeProforma = proformas.find((p) => p.isActive) || null;
    createOrderMutation.mutate({
      customerId,
      proformaIdUsed: activeProforma?.id || null,
      locationId: parseInt(selectedLocationId),
      orderDate,
      containerNotes: loadingNote.trim() || undefined,
    });
  }, [customerId, selectedLocationId, proformas, orderDate, loadingNote, createOrderMutation]);

  const handleScan = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" || !scanCode.trim() || !orderId || !selectedLocationId) return;
      e.preventDefault();
      const trimmed = scanCode.trim();
      const isBypassProforma = pendingBypassBaleRef !== null && pendingBypassBaleRef === trimmed;
      const isBypassOverload = pendingBypassOverloadRef !== null && pendingBypassOverloadRef === trimmed;
      if (pendingBypassBaleRef !== null && !isBypassProforma) setPendingBypassBaleRef(null);
      if (pendingBypassOverloadRef !== null && !isBypassOverload) setPendingBypassOverloadRef(null);
      addBaleMutation.mutate({
        scanCode: trimmed,
        locationId: parseInt(selectedLocationId),
        allowBypassProforma: isBypassProforma || undefined,
        allowBypassOverload: isBypassOverload || undefined,
      });
    },
    [scanCode, orderId, selectedLocationId, pendingBypassBaleRef, pendingBypassOverloadRef, addBaleMutation]
  );

  const toggleGroup = useCallback((articleCode: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(articleCode)) next.delete(articleCode);
      else next.add(articleCode);
      return next;
    });
  }, []);

  const bales = orderDetail?.bales || [];

  const groupedBalesMap = bales.reduce<
    Record<string, { articleCode: string; baleName: string; bales: OrderBale[]; totalWeight: number }>
  >((acc, bale) => {
    const key = bale.articleCode;
    if (!acc[key]) {
      acc[key] = { articleCode: bale.articleCode, baleName: bale.baleName, bales: [], totalWeight: 0 };
    }
    acc[key].bales.push(bale);
    acc[key].totalWeight += parseFloat(bale.weight || "0");
    return acc;
  }, {});

  const orderedGroups = Object.values(groupedBalesMap).sort((a, b) => {
    const maxA = Math.max(...a.bales.map((x) => x.id));
    const maxB = Math.max(...b.bales.map((x) => x.id));
    return maxB - maxA;
  });

  const totalWeight = bales.reduce((sum, b) => sum + parseFloat(b.weight || "0"), 0);

  // Linked proforma logic
  const linkedProforma = orderDetail?.proformaIdUsed
    ? proformas.find((p) => p.id === orderDetail.proformaIdUsed)
    : proformas.find((p) => p.isActive) || null;

  const loadedByArticle = bales.reduce<Record<string, number>>((map, b) => {
    map[b.articleCode] = (map[b.articleCode] || 0) + 1;
    return map;
  }, {});

  const proformaProgress =
    linkedProforma?.lines.map((line) => {
      const loaded = loadedByArticle[line.articleCode] || 0;
      const remaining = line.quantity - loaded;
      const status: "fulfilled" | "overloaded" | "short" | "none" =
        loaded === 0
          ? "none"
          : loaded > line.quantity
            ? "overloaded"
            : loaded === line.quantity
              ? "fulfilled"
              : "short";
      return {
        ...line,
        loaded,
        remaining,
        fulfilled: loaded >= line.quantity,
        status,
        excess: Math.max(0, loaded - line.quantity),
      };
    }) || [];

  const fulfilledCount = proformaProgress.filter((l) => l.status === "fulfilled" || l.status === "overloaded").length;
  const totalLines = proformaProgress.length;

  // Extra bales not in proforma
  const proformaArticleCodes = new Set(linkedProforma?.lines.map((l) => l.articleCode) || []);
  const extraArticles = Object.keys(loadedByArticle).filter((code) => !proformaArticleCodes.has(code));

  const scanInputClass =
    scanFlash === "success"
      ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950 transition-all"
      : scanFlash === "error"
        ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950 transition-all"
        : "";

  const activeProforma = proformas.find((p) => p.isActive) || null;

  return (
    <div className="flex flex-col h-full p-4 lg:p-6">
      {showScanSuccessPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-green-500 text-white rounded-xl px-16 py-10 shadow-2xl border-4 border-green-300 text-center">
            <div className="text-5xl font-black tracking-wide drop-shadow-md">SCANNED</div>
            <div className="text-5xl font-black tracking-wide drop-shadow-md">SUCCESSFULLY</div>
          </div>
        </div>
      )}
      {showScanErrorPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-red-600 text-white rounded-xl px-16 py-10 shadow-2xl border-4 border-red-300 text-center">
            <div className="text-5xl font-black tracking-wide drop-shadow-md">SCAN ERROR</div>
            <div className="text-5xl font-black tracking-wide drop-shadow-md">TRY AGAIN</div>
          </div>
        </div>
      )}
      {pendingBypassOverloadRef !== null && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ top: "4rem" }}
        >
          <div className="bg-orange-500 text-white rounded-xl px-12 py-6 shadow-2xl border-4 border-orange-700 text-center">
            <div className="text-3xl font-black tracking-wide">QUANTITY EXCEEDED</div>
            <div className="text-2xl font-bold mt-1">Scan again to bypass</div>
          </div>
        </div>
      )}
      {pendingBypassBaleRef !== null && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ top: "4rem" }}
        >
          <div className="bg-amber-400 text-amber-950 rounded-xl px-12 py-6 shadow-2xl border-4 border-amber-600 text-center">
            <div className="text-3xl font-black tracking-wide">ITEM NOT REQUESTED</div>
            <div className="text-2xl font-bold mt-1">Scan again to bypass</div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <PageHeader title="Container Loading" subtitle="Floor loader bale scanning" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isResuming && orderId && (
            <Badge
              variant="outline"
              className="status-warning no-default-hover-elevate no-default-active-elevate"
              data-testid="badge-resuming"
            >
              <Clock className="h-3 w-3 mr-1" />
              Resuming Loading #{orderId}
            </Badge>
          )}
          {!isResuming && orderId && (
            <Badge variant="secondary" data-testid="badge-loading-order">
              Loading #{orderId}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        {/* Left: scanned bales */}
        <div className="lg:w-[60%] flex flex-col min-h-0">
          <Card
            className={`flex-1 flex flex-col min-h-0 p-4 transition-colors duration-300 ${scanFlash === "success" ? "ring-4 ring-green-500 bg-green-50 dark:bg-green-950" : scanFlash === "error" ? "ring-2 ring-red-500" : ""}`}
          >
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="font-semibold text-lg" data-testid="text-bales-header">
                Scanned Bales
              </h2>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="badge-bale-count">
                  {bales.length} bales
                </Badge>
                {bales.length > 0 && (
                  <Badge variant="outline" data-testid="badge-total-weight">
                    {totalWeight.toFixed(2)} kg
                  </Badge>
                )}
                <Button
                  size="icon"
                  variant={viewMode === "detailed" ? "secondary" : "ghost"}
                  onClick={() => setViewMode(viewMode === "detailed" ? "condensed" : "detailed")}
                  title={viewMode === "detailed" ? "Switch to condensed view" : "Switch to detailed view"}
                  data-testid="button-toggle-view-mode"
                >
                  {viewMode === "detailed" ? <Rows3 className="h-4 w-4" /> : <AlignJustify className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {orderId && (
              <div className="mb-3">
                <label className="text-sm font-medium mb-1 block">
                  <ScanLine className="inline h-4 w-4 mr-1" />
                  Scan Bale
                </label>
                <Input
                  ref={scannerRef}
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={handleScan}
                  placeholder="Scan barcode, ref number, or article code…"
                  disabled={!orderId || !selectedLocationId || addBaleMutation.isPending}
                  className={`text-lg h-12 font-mono ${scanInputClass}`}
                  autoFocus
                  data-testid="input-scan-code"
                />
              </div>
            )}

            {viewMode === "detailed" && lastScannedRef && (
              <div
                className="mb-3 flex items-center gap-3 rounded-md status-success px-3 py-2"
                data-testid="banner-last-scanned"
              >
                <div className="text-xs font-medium uppercase tracking-wide shrink-0 opacity-80">Last Scanned</div>
                <div className="min-w-0">
                  <div className="font-mono font-bold text-sm truncate">{lastScannedRef.baleReference}</div>
                  {lastScannedRef.baleName && (
                    <div className="text-xs opacity-80 truncate">{lastScannedRef.baleName}</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {orderedGroups.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-12 text-muted-foreground"
                  data-testid="text-no-bales"
                >
                  <Package className="h-12 w-12 mb-3 opacity-40" />
                  <p>No bales scanned yet</p>
                  <p className="text-sm mt-1">
                    {!orderId
                      ? "Set up the loading order first, then scan bales"
                      : "Scan bales using the scanner above"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderedGroups.map((group) => (
                    <div key={group.articleCode} data-testid={`group-article-${group.articleCode}`}>
                      <button
                        type="button"
                        className="w-full flex flex-wrap items-center justify-between gap-2 mb-1 px-1 cursor-pointer rounded-md p-2 hover-elevate"
                        onClick={() => toggleGroup(group.articleCode)}
                        data-testid={`button-toggle-group-${group.articleCode}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" data-testid={`badge-article-${group.articleCode}`}>
                            {group.articleCode}
                          </Badge>
                          <span className="text-sm font-medium">{group.baleName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>Qty: {group.bales.length}</span>
                          <span>Wt: {group.totalWeight.toFixed(2)} kg</span>
                        </div>
                      </button>
                      {viewMode === "detailed" && (
                        <Table>
                          <TableBody>
                            {[...group.bales]
                              .sort((a, b) => b.id - a.id)
                              .map((bale) => (
                                <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                                  <TableCell className="font-mono text-sm" data-testid={`text-bale-ref-${bale.id}`}>
                                    {bale.baleReference}
                                  </TableCell>
                                  <TableCell className="text-sm">{bale.baleName}</TableCell>
                                  <TableCell className="text-right text-sm text-muted-foreground">
                                    {parseFloat(bale.weight || "0").toFixed(2)} kg
                                  </TableCell>
                                  <TableCell className="w-[40px]">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => removeBaleMutation.mutate(bale.id)}
                                      disabled={removeBaleMutation.isPending}
                                      data-testid={`button-remove-bale-${bale.id}`}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right: controls + proforma panel */}
        <div className="lg:w-[40%] flex flex-col gap-4">
          {/* Setup card — hidden once order started and proforma is showing */}
          <Card className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Customer</label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId} disabled={!!orderId}>
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-customer-option-${c.id}`}>
                      {c.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                <MapPin className="inline h-3 w-3 mr-1" />
                Loading Location
              </label>
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId} disabled={!!orderId}>
                <SelectTrigger data-testid="select-location">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`select-location-option-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {customerId && activeProforma && !orderId && (
              <div className="flex items-center gap-2">
                <Badge
                  variant="default"
                  className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate"
                  data-testid="badge-active-proforma"
                >
                  {activeProforma.name}
                </Badge>
                <span className="text-sm text-muted-foreground">Active proforma</span>
              </div>
            )}

            {customerId && !activeProforma && proformas.length === 0 && !orderId && (
              <p className="text-sm text-muted-foreground" data-testid="text-no-proforma">
                No active proforma found. Loading will proceed without price references.
              </p>
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">
                <StickyNote className="inline h-3 w-3 mr-1" />
                Note
              </label>
              {!orderId ? (
                <Textarea
                  placeholder="Optional note for this loading..."
                  value={loadingNote}
                  onChange={(e) => setLoadingNote(e.target.value)}
                  className="resize-none text-sm"
                  rows={2}
                  data-testid="textarea-loading-note"
                />
              ) : (
                <div className="flex gap-2 items-start">
                  <Textarea
                    placeholder="Add a note..."
                    value={loadingNote}
                    onChange={(e) => setLoadingNote(e.target.value)}
                    className="resize-none text-sm flex-1"
                    rows={2}
                    data-testid="textarea-loading-note"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => saveNoteMutation.mutate(loadingNote)}
                    disabled={saveNoteMutation.isPending}
                    title="Save note"
                    data-testid="button-save-note"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {!orderId && (
              <Button
                className="w-full"
                onClick={handleStartLoading}
                disabled={!customerId || !selectedLocationId || createOrderMutation.isPending}
                data-testid="button-start-loading"
              >
                <Play className="mr-2 h-4 w-4" />
                {createOrderMutation.isPending ? "Creating..." : "Start Loading"}
              </Button>
            )}
          </Card>

          {/* Proforma progress panel — shown when order is active and a proforma is linked */}
          {orderId && linkedProforma ? (
            <Card className="p-4 flex flex-col gap-3" data-testid="card-proforma-progress">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-semibold text-sm">{linkedProforma.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fulfilledCount} / {totalLines} lines fulfilled
                  </p>
                </div>
                <Badge
                  variant={fulfilledCount === totalLines && totalLines > 0 ? "default" : "secondary"}
                  className={
                    fulfilledCount === totalLines && totalLines > 0
                      ? "bg-green-600 text-white no-default-hover-elevate no-default-active-elevate"
                      : ""
                  }
                  data-testid="badge-proforma-progress"
                >
                  {fulfilledCount}/{totalLines}
                </Badge>
              </div>

              <div className="overflow-y-auto max-h-[340px]">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="text-xs">Article</TableHead>
                      <TableHead className="text-xs text-right">Exp</TableHead>
                      <TableHead className="text-xs text-right">Loaded</TableHead>
                      <TableHead className="text-xs text-right">Rem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proformaProgress.map((line) => (
                      <TableRow
                        key={line.id}
                        className={
                          line.status === "fulfilled"
                            ? "bg-green-50 dark:bg-green-950/40"
                            : line.status === "overloaded"
                              ? "bg-orange-50 dark:bg-orange-950/30"
                              : ""
                        }
                        data-testid={`row-progress-${line.articleCode}`}
                      >
                        <TableCell className="text-xs font-mono py-1.5">
                          <div className="flex items-center gap-1">
                            {line.status === "fulfilled" && <CheckCircle className="h-3 w-3 text-green-600 shrink-0" />}
                            {line.status === "overloaded" && (
                              <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />
                            )}
                            <span
                              className={
                                line.status === "fulfilled"
                                  ? "text-green-700 dark:text-green-400"
                                  : line.status === "overloaded"
                                    ? "text-orange-600 dark:text-orange-400"
                                    : ""
                              }
                            >
                              {line.articleCode}
                            </span>
                          </div>
                          <div className="text-muted-foreground truncate max-w-[100px]">{line.productName}</div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">{line.quantity}</TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">
                          <span
                            className={
                              line.status === "fulfilled"
                                ? "text-green-600 dark:text-green-400 font-semibold"
                                : line.status === "overloaded"
                                  ? "text-orange-600 dark:text-orange-400 font-semibold"
                                  : ""
                            }
                          >
                            {line.loaded}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">
                          {line.status === "fulfilled" && <span className="text-green-600 dark:text-green-400">✓</span>}
                          {line.status === "overloaded" && (
                            <span className="text-orange-600 dark:text-orange-400">+{line.excess}</span>
                          )}
                          {line.status === "short" && (
                            <span className="text-amber-600 dark:text-amber-400">{line.remaining}</span>
                          )}
                          {line.status === "none" && <span className="text-muted-foreground">{line.quantity}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {extraArticles.map((code) => (
                      <TableRow key={code} className="bg-red-50 dark:bg-red-950/30" data-testid={`row-extra-${code}`}>
                        <TableCell className="text-xs font-mono py-1.5">
                          <div className="text-red-700 dark:text-red-400">{code}</div>
                          <div className="text-red-500 dark:text-red-500 text-[10px]">Not on proforma</div>
                        </TableCell>
                        <TableCell className="text-xs text-right py-1.5 text-muted-foreground">—</TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5 text-red-600 dark:text-red-400 font-semibold">
                          {loadedByArticle[code]}
                        </TableCell>
                        <TableCell className="text-xs text-right py-1.5">
                          <Badge
                            variant="destructive"
                            className="text-[10px] px-1 py-0 no-default-hover-elevate no-default-active-elevate"
                          >
                            !
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t pt-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
                <span>
                  {bales.length} bales scanned · {totalWeight.toFixed(1)} kg
                </span>
              </div>
            </Card>
          ) : orderId ? (
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold text-sm">Order Summary</h3>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Total Bales</span>
                <span className="font-mono" data-testid="text-total-bales">
                  {bales.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Total Weight</span>
                <span className="font-mono" data-testid="text-total-weight">
                  {totalWeight.toFixed(2)} kg
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Article Groups</span>
                <span className="font-mono" data-testid="text-article-groups">
                  {Object.keys(groupedBalesMap).length}
                </span>
              </div>
            </Card>
          ) : null}

          {/* Save & Exit + Validate & Finalize */}
          {orderId && (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate("/factory/sales/loading/pending")}
                data-testid="button-save-exit"
              >
                <Save className="mr-2 h-4 w-4" />
                Save &amp; Exit
              </Button>
              <Button
                className="w-full"
                size="lg"
                onClick={() => setShowFinalizeDialog(true)}
                disabled={bales.length === 0 || finalizeMutation.isPending}
                data-testid="button-finalize-loading"
              >
                <CheckCircle className="mr-2 h-5 w-5" />
                Validate &amp; Finalize
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Validate & Finalize Dialog */}
      <Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Validate Loading</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {linkedProforma && proformaProgress.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Review what was loaded vs the proforma before finalizing.
                </p>
                <div className="overflow-y-auto max-h-[340px] border rounded-md">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Article / Product</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">Loaded</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {proformaProgress.map((line) => (
                        <TableRow
                          key={line.id}
                          className={
                            line.status === "fulfilled"
                              ? "bg-green-50 dark:bg-green-950/40"
                              : line.status === "overloaded"
                                ? "bg-orange-50 dark:bg-orange-950/30"
                                : ""
                          }
                        >
                          <TableCell className="text-sm">
                            <div className="font-mono text-xs">{line.articleCode}</div>
                            <div className="text-muted-foreground text-xs">{line.productName}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{line.quantity}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{line.loaded}</TableCell>
                          <TableCell className="text-right text-sm">
                            {line.status === "fulfilled" && (
                              <span className="text-green-600 dark:text-green-400 font-semibold">✓ Done</span>
                            )}
                            {line.status === "overloaded" && (
                              <span className="text-orange-600 dark:text-orange-400 font-semibold flex items-center justify-end gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Over +{line.excess}
                              </span>
                            )}
                            {(line.status === "short" || line.status === "none") && (
                              <span className="text-amber-600 dark:text-amber-400 flex items-center justify-end gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Short {line.remaining}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {extraArticles.map((code) => (
                        <TableRow key={code} className="bg-red-50 dark:bg-red-950/30">
                          <TableCell className="text-sm">
                            <div className="font-mono text-xs text-red-700 dark:text-red-400">{code}</div>
                            <div className="text-red-500 text-xs">Not on proforma</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">—</TableCell>
                          <TableCell className="text-right font-mono text-sm text-red-600 dark:text-red-400 font-semibold">
                            {loadedByArticle[code]}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            <Badge
                              variant="destructive"
                              className="text-xs no-default-hover-elevate no-default-active-elevate"
                            >
                              Not on proforma
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between gap-2 text-sm border-t pt-2 flex-wrap gap-y-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      {proformaProgress.filter((l) => l.status === "fulfilled").length} fulfilled
                    </span>
                    {proformaProgress.filter((l) => l.status === "overloaded").length > 0 && (
                      <span className="text-orange-600 dark:text-orange-400 font-medium">
                        {proformaProgress.filter((l) => l.status === "overloaded").length} overloaded
                      </span>
                    )}
                    {proformaProgress.filter((l) => l.status === "short" || l.status === "none").length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        {proformaProgress.filter((l) => l.status === "short" || l.status === "none").length} short
                      </span>
                    )}
                    {extraArticles.length > 0 && (
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {extraArticles.length} not on proforma
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {bales.length} bales · {totalWeight.toFixed(1)} kg
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This will mark the loading as complete and send it for office verification.
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>Total Bales:</span>
                    <span className="font-mono font-semibold" data-testid="text-dialog-total-bales">
                      {bales.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Total Weight:</span>
                    <span className="font-mono font-semibold" data-testid="text-dialog-total-weight">
                      {totalWeight.toFixed(2)} kg
                    </span>
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowFinalizeDialog(false)}
                data-testid="button-cancel-finalize"
              >
                Cancel
              </Button>
              <Button
                onClick={() => finalizeMutation.mutate()}
                disabled={finalizeMutation.isPending}
                data-testid="button-confirm-finalize"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {finalizeMutation.isPending ? "Finalizing..." : "Confirm Finalize"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLastScannedPopup} onOpenChange={setShowLastScannedPopup}>
        <DialogContent className="max-w-sm" data-testid="dialog-last-scanned">
          <DialogHeader>
            <DialogTitle className="text-base">Resuming Loading</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Last bale scanned in this session:</p>
            <div
              className="bg-muted rounded-md px-4 py-3 font-mono text-lg font-semibold text-center"
              data-testid="text-last-scanned-ref"
            >
              {lastScannedRef?.baleReference}
              {lastScannedRef?.baleName && (
                <div className="text-sm font-normal text-muted-foreground mt-1">{lastScannedRef.baleName}</div>
              )}
            </div>
            <Button
              className="w-full"
              onClick={() => setShowLastScannedPopup(false)}
              data-testid="button-dismiss-last-scanned"
            >
              Continue Scanning
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
