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
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "@/lib/excelHelper";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocation, useSearch } from "wouter";
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
  Upload,
  Download,
  ArrowRight,
  History,
  ChevronDown,
  ChevronUp,
  Pencil,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  bales: OrderBale[];
}

interface BaleRemoval {
  id: number;
  orderId: number;
  baleId: number;
  referenceNumber: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string | null;
  removedByUsername: string | null;
  removedAt: string;
}

export default function FactoryContainerLoadingScan() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [orderDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [loadingNote, setLoadingNote] = useState<string>("");
  const [scanCode, setScanCode] = useState("");
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [showScanSuccessPopup, setShowScanSuccessPopup] = useState(false);
  const [showScanErrorPopup, setShowScanErrorPopup] = useState(false);
  const [pendingBypassBaleRef, setPendingBypassBaleRef] = useState<string | null>(null);
  const [pendingBypassOverloadRef, setPendingBypassOverloadRef] = useState<string | null>(null);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [finalizeDate, setFinalizeDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"detailed" | "condensed">("detailed");
  const [lastScannedRef, setLastScannedRef] = useState<{ baleReference: string; baleName: string; articleCode: string } | null>(null);
  const [showLastScannedPopup, setShowLastScannedPopup] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importMode, setImportMode] = useState<"articleCode" | "refNumber">("articleCode");
  const [importPreview, setImportPreview] = useState<Array<{ articleCode: string; qty: number }>>([]);
  const [importRefNumbers, setImportRefNumbers] = useState<string[]>([]);
  const [showPendingWarning, setShowPendingWarning] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<Array<{ id: number; invoiceNumber: string | null; status: string; totalQtyBales: number }>>([]);
  const [baleToDelete, setBaleToDelete] = useState<{ id: number; baleReference: string } | null>(null);
  const [showRemovalLog, setShowRemovalLog] = useState(false);
  const [selectedProformaId, setSelectedProformaId] = useState<string>("");
  const scannerRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  // Check for ?orderId= resume param using wouter's useSearch (reactive to URL changes)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const resumeOrderId = params.get("orderId");
    if (resumeOrderId) {
      const id = parseInt(resumeOrderId);
      if (!isNaN(id)) {
        setOrderId(id);
        setIsResuming(true);
      }
    }
  }, [search]);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  // Auto-select when there's exactly one location
  useEffect(() => {
    if (orderId) return; // don't override when resuming an existing order
    if (locations.length === 1) {
      setSelectedLocationId(String(locations[0].id));
    }
  }, [locations, orderId]);

  const { data: proformas = [] } = useQuery<Proforma[]>({
    queryKey: [
      `/api/factory/customer-proformas?customerId=${customerId}`,
      customerId,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/factory/customer-proformas?customerId=${customerId}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch proformas");
      return res.json();
    },
    enabled: !!customerId,
  });

  // All starred (active) proformas for this customer
  const activeProformas = useMemo(() => proformas.filter((p) => p.isActive), [proformas]);

  // Auto-select when there's exactly one starred proforma; clear when customer changes
  useEffect(() => {
    if (orderId) return;
    if (activeProformas.length === 1) {
      setSelectedProformaId(String(activeProformas[0].id));
    } else {
      setSelectedProformaId("");
    }
  }, [activeProformas, orderId]);

  const { data: orderDetail } = useQuery<OrderDetail>({
    queryKey: ["/api/factory/customer-orders", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch order");
      return res.json();
    },
    enabled: !!orderId,
    refetchInterval: 15000,
  });

  const { data: baleRemovals = [] } = useQuery<BaleRemoval[]>({
    queryKey: ["/api/factory/customer-orders", orderId, "bale-removals"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}/bale-removals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch removal log");
      return res.json();
    },
    enabled: !!orderId,
  });

  // When resuming: restore customer/location and show last scanned popup
  useEffect(() => {
    if (isResuming && orderDetail && !selectedCustomerId) {
      setSelectedCustomerId(String(orderDetail.customerId));
      setSelectedLocationId(String(orderDetail.locationId || ""));
      setLoadingNote(orderDetail.containerNotes || "");
      const stored = localStorage.getItem(`lastScannedBale_${orderDetail.id}`);
      if (stored) {
        try { setLastScannedRef(JSON.parse(stored)); } catch { setLastScannedRef({ baleReference: stored, baleName: "", articleCode: "" }); }
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
      const res = await modeApiRequest(
        "POST",
        "/api/factory/customer-orders-loading",
        data,
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      setOrderId(data.id);
      toast({
        title: "Loading order created",
        description: "You can now start scanning bales",
      });
      setTimeout(() => scannerRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addBaleMutation = useMutation({
    mutationFn: async (data: { scanCode: string; locationId: number; allowBypassProforma?: boolean; allowBypassOverload?: boolean }) => {
      const res = await modeApiRequest(
        "POST",
        `/api/factory/customer-orders/${orderId}/bales`,
        data,
      );
      return await res.json();
    },
    onSuccess: (data: any, variables: { scanCode: string; locationId: number; allowBypassProforma?: boolean; allowBypassOverload?: boolean }) => {
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
          setTimeout(() => { osc.stop(); ctx.close(); }, 120);
        });
      } catch { /* no audio support */ }
      setTimeout(() => { setScanFlash(null); setShowScanSuccessPopup(false); }, 500);
      if (orderId) {
        const scanned = variables.scanCode;
        const newestForRef = [...(data?.bales || [])].sort((a: any, b: any) => b.id - a.id)[0];
        const lastScanned = { baleReference: newestForRef?.baleReference || scanned, baleName: newestForRef?.baleName || "", articleCode: newestForRef?.articleCode || "" };
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
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/customer-orders", orderId],
      });
      setScanCode("");
    },
    onError: (error: Error, variables: any) => {
      if ((error as any)?._handledGlobally) return;
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
            setTimeout(() => { osc.stop(); ctx.close(); }, 180);
          });
        } catch { /* no audio support */ }
        setTimeout(() => setScanFlash(null), 600);
        setScanCode("");
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
            setTimeout(() => { osc.stop(); ctx.close(); }, 180);
          });
        } catch { /* no audio support */ }
        setTimeout(() => setScanFlash(null), 600);
        setScanCode("");
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
          setTimeout(() => { osc.stop(); ctx.close(); }, 220);
        });
      } catch { /* no audio support */ }
      setTimeout(() => { setScanFlash(null); setShowScanErrorPopup(false); }, 1500);
      toast({
        title: "Scan Error",
        description: error.message,
        variant: "destructive",
      });
      setScanCode("");
    },
  });

  // Restore focus to the scan input whenever the mutation finishes (success or error).
  // Using a useEffect keyed on isPending is more reliable than setTimeout because
  // it fires after React re-enables the input (disabled={isPending}), so focus
  // is never called on a disabled element.
  const wasPending = useRef(false);
  useEffect(() => {
    const justFinished = wasPending.current && !addBaleMutation.isPending;
    wasPending.current = addBaleMutation.isPending;
    if (justFinished && scannerRef.current) {
      scannerRef.current.focus();
    }
  }, [addBaleMutation.isPending]);

  const removeBaleMutation = useMutation({
    mutationFn: async (baleId: number) => {
      await modeApiRequest(
        "DELETE",
        `/api/factory/customer-orders/${orderId}/bales/${baleId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/customer-orders", orderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/factory/customer-orders", orderId, "bale-removals"],
      });
      setBaleToDelete(null);
      toast({ title: "Bale removed" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (payload: { mode: "articleCode"; items: Array<{ articleCode: string; qty: number }> } | { mode: "refNumber"; refNumbers: string[] }) => {
      const body = payload.mode === "refNumber"
        ? { locationId: parseInt(selectedLocationId), refNumbers: payload.refNumbers }
        : { locationId: parseInt(selectedLocationId), items: payload.items };
      const res = await modeApiRequest(
        "POST",
        `/api/factory/customer-orders/${orderId}/bales/bulk-import`,
        body,
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      setShowImportDialog(false);
      setImportPreview([]);
      setImportRefNumbers([]);
      const notFoundMsgs = (data.notFound || []).map((n: any) =>
        `${n.articleCode}: requested ${n.requestedQty}, found ${n.foundQty}`
      );
      const notFoundRefMsgs = (data.notFoundRefs || []).length > 0
        ? `Not found: ${(data.notFoundRefs as string[]).join(", ")}`
        : undefined;
      toast({
        title: `Import complete — ${data.added} bale${data.added === 1 ? "" : "s"} added`,
        description: notFoundMsgs.length > 0 ? `Short: ${notFoundMsgs.join(", ")}` : notFoundRefMsgs,
      });
      setTimeout(() => scannerRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (txDate?: string) => {
      await modeApiRequest(
        "POST",
        `/api/factory/customer-orders/${orderId}/finalize-loading`,
        { txDate },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({
        title: "Loading finalized",
        description: "Loading has been sent for office verification",
      });
      setShowFinalizeDialog(false);
      navigate("/factory/invoicing?tab=invoices");
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      setShowFinalizeDialog(false);
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      await modeApiRequest("PATCH", `/api/factory/customer-orders/${orderId}/loading-note`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      toast({ title: "Note saved" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Failed to save note", description: error.message, variant: "destructive" });
    },
  });

  const handleStartLoading = useCallback(async () => {
    if (!customerId || !selectedLocationId) return;
    const chosenProforma =
      selectedProformaId && selectedProformaId !== "none"
        ? proformas.find((p) => p.id === parseInt(selectedProformaId)) || null
        : null;

    // Check if there are already pending loading orders for this proforma
    if (chosenProforma) {
      try {
        const res = await fetch(
          `/api/factory/customer-orders?customerId=${customerId}&proformaId=${chosenProforma.id}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const allOrders: any[] = await res.json();
          const pending = allOrders.filter((o) =>
            ["LOADING", "DRAFT", "PENDING_VERIFICATION"].includes(o.status)
          );
          if (pending.length > 0) {
            setPendingOrders(pending);
            setShowPendingWarning(true);
            return;
          }
        }
      } catch {
        // If check fails, proceed with creation anyway
      }
    }

    createOrderMutation.mutate({
      customerId,
      proformaIdUsed: chosenProforma?.id || null,
      locationId: parseInt(selectedLocationId),
      orderDate,
      containerNotes: loadingNote.trim() || undefined,
    });
  }, [
    customerId,
    selectedLocationId,
    selectedProformaId,
    proformas,
    orderDate,
    loadingNote,
    createOrderMutation,
  ]);

  const downloadTemplate = useCallback(async (mode: "ref" | "articleCode") => {
    const wb = XLSX.utils.book_new();
    let ws;
    if (mode === "ref") {
      ws = XLSX.utils.aoa_to_sheet([
        ["Ref Number"],
        ["REF00001"],
        ["REF00002"],
        ["REF00003"],
      ]);
      ws["!cols"] = [{ wch: 20 }];
    } else {
      ws = XLSX.utils.aoa_to_sheet([
        ["Article Code", "Qty"],
        ["ART001", 10],
        ["ART002", 5],
      ]);
      ws["!cols"] = [{ wch: 20 }, { wch: 10 }];
    }
    XLSX.utils.book_append_sheet(wb, ws, "Import");
    await XLSX.writeFile(
      wb,
      mode === "ref"
        ? "bale-import-ref-number-template.xlsx"
        : "bale-import-article-code-template.xlsx"
    );
  }, []);

  const handleScan = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (
        e.key !== "Enter" ||
        !scanCode.trim() ||
        !orderId ||
        !selectedLocationId
      )
        return;
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
    [scanCode, orderId, selectedLocationId, pendingBypassBaleRef, pendingBypassOverloadRef, addBaleMutation],
  );

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = await XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);

        // Detect mode: if any row has a "Ref" / "Reference" / "Ref Number" / "Ref Code" column, use ref mode
        const firstRow = rows[0] || {};
        const refKey = Object.keys(firstRow).find((k) =>
          /^ref(erence)?([\s_-]?(number|code|no|num))?$/i.test(k.trim())
        );

        if (refKey) {
          // REF NUMBER / REF CODE MODE
          const refs = rows
            .map((r) => String(r[refKey] ?? "").trim())
            .filter(Boolean);
          if (refs.length === 0) {
            toast({ title: "No valid rows found", description: "Ensure the Ref / Ref Code column has values", variant: "destructive" });
            return;
          }
          setImportMode("refNumber");
          setImportRefNumbers(refs);
          setImportPreview([]);
          setShowImportDialog(true);
        } else {
          // ARTICLE CODE MODE (existing)
          const parsed = rows
            .map((r) => ({
              articleCode: String(
                r["Article Code"] ?? r.articleCode ?? r.article_code ?? r.ArticleCode ?? r.ARTICLECODE ?? ""
              ).trim(),
              qty: parseInt(r.Qty ?? r.qty ?? r.QTY ?? r.Quantity ?? r.quantity ?? 0) || 0,
            }))
            .filter((r) => r.articleCode && r.qty > 0);
          if (parsed.length === 0) {
            toast({ title: "No valid rows found", description: "Ensure columns are Article Code and Qty, or use a Ref Number column for individual bale import", variant: "destructive" });
            return;
          }
          setImportMode("articleCode");
          setImportPreview(parsed);
          setImportRefNumbers([]);
          setShowImportDialog(true);
        }
      } catch (err: any) {
        toast({ title: "Parse error", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, [toast]);

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
    Record<
      string,
      {
        articleCode: string;
        baleName: string;
        bales: OrderBale[];
        totalWeight: number;
      }
    >
  >((acc, bale) => {
    const key = bale.articleCode;
    if (!acc[key]) {
      acc[key] = {
        articleCode: bale.articleCode,
        baleName: bale.baleName,
        bales: [],
        totalWeight: 0,
      };
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

  const totalWeight = bales.reduce(
    (sum, b) => sum + parseFloat(b.weight || "0"),
    0,
  );

  // Stock count query — fetches IN_STOCK bale counts per article code for proforma lines
  const proformaArticleCodesForStock = useMemo(
    () => {
      if (!orderDetail?.proformaIdUsed) return [];
      const pf = proformas.find((p) => p.id === orderDetail.proformaIdUsed) || proformas.find((p) => p.isActive);
      return pf?.lines.map((l: any) => l.articleCode).filter(Boolean) || [];
    },
    [orderDetail?.proformaIdUsed, proformas],
  );
  const stockLocationId = orderDetail?.locationId || (selectedLocationId ? parseInt(selectedLocationId) : null);
  const { data: stockCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/factory/bale-stock-count", proformaArticleCodesForStock.join(","), stockLocationId],
    queryFn: async () => {
      if (proformaArticleCodesForStock.length === 0) return {};
      const params = new URLSearchParams({ articleCodes: proformaArticleCodesForStock.join(",") });
      if (stockLocationId) params.set("locationId", String(stockLocationId));
      const res = await fetch(`/api/factory/bale-stock-count?${params}`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: proformaArticleCodesForStock.length > 0,
    refetchInterval: 30000,
  });

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

  const fulfilledCount = proformaProgress.filter(
    (l) => l.status === "fulfilled" || l.status === "overloaded",
  ).length;
  const totalLines = proformaProgress.length;

  // Extra bales not in proforma
  const proformaArticleCodes = new Set(
    linkedProforma?.lines.map((l) => l.articleCode) || [],
  );
  const extraArticles = Object.keys(loadedByArticle).filter(
    (code) => !proformaArticleCodes.has(code),
  );

  const scanInputClass =
    scanFlash === "success"
      ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950 transition-all"
      : scanFlash === "error"
        ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950 transition-all"
        : "";

  const activeProforma =
    selectedProformaId && selectedProformaId !== "none"
      ? proformas.find((p) => p.id === parseInt(selectedProformaId)) || null
      : null;

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
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center pointer-events-none" style={{ top: "4rem" }}>
          <div className="bg-orange-500 text-white rounded-xl px-12 py-6 shadow-2xl border-4 border-orange-700 text-center">
            <div className="text-3xl font-black tracking-wide">QUANTITY EXCEEDED</div>
            <div className="text-2xl font-bold mt-1">Scan again to bypass</div>
          </div>
        </div>
      )}
      {pendingBypassBaleRef !== null && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center pointer-events-none" style={{ top: "4rem" }}>
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
              variant="secondary"
              className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 no-default-hover-elevate no-default-active-elevate"
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
          <Card className={`flex-1 flex flex-col min-h-0 p-4 transition-colors duration-300 ${scanFlash === "success" ? "ring-4 ring-green-500 bg-green-50 dark:bg-green-950" : scanFlash === "error" ? "ring-2 ring-red-500" : ""}`}>
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2
                className="font-semibold text-lg"
                data-testid="text-bales-header"
              >
                Scanned Bales
              </h2>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="badge-bale-count">
                  {bales.length} bales
                </Badge>
                {bales.length > 0 && (
                  <Badge variant="outline" data-testid="badge-total-weight">{totalWeight.toFixed(2)} kg</Badge>
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
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    <ScanLine className="inline h-4 w-4 mr-1" />
                    Scan Bale
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => importFileRef.current?.click()}
                      data-testid="button-import-excel"
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      Import from Excel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadTemplate("ref")}
                      data-testid="button-template-ref"
                      title="Download Ref Number template"
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleImportFile}
                    data-testid="input-import-file"
                  />
                </div>
                <Input
                  ref={scannerRef}
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={handleScan}
                  placeholder="Scan barcode, ref no., article code, item name (partial ok)…"
                  disabled={
                    !orderId || !selectedLocationId || addBaleMutation.isPending
                  }
                  className={`text-lg h-12 font-mono ${scanInputClass}`}
                  autoFocus
                  data-testid="input-scan-code"
                />
              </div>
            )}

            {viewMode === "detailed" && lastScannedRef && (
              <div className="mb-3 flex items-center gap-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-3 py-2" data-testid="banner-last-scanned">
                <div className="text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wide shrink-0">Last Scanned</div>
                <div className="min-w-0">
                  <div className="font-mono font-bold text-sm text-green-900 dark:text-green-100 truncate">{lastScannedRef.baleReference}</div>
                  {lastScannedRef.baleName && <div className="text-xs text-green-700 dark:text-green-400 truncate">{lastScannedRef.baleName}</div>}
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
                    <div
                      key={group.articleCode}
                      data-testid={`group-article-${group.articleCode}`}
                    >
                      <button
                        type="button"
                        className="w-full flex flex-wrap items-center justify-between gap-2 mb-1 px-1 cursor-pointer rounded-md p-2 hover-elevate"
                        onClick={() => toggleGroup(group.articleCode)}
                        data-testid={`button-toggle-group-${group.articleCode}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            data-testid={`badge-article-${group.articleCode}`}
                          >
                            {group.articleCode}
                          </Badge>
                          <span className="text-sm font-medium">
                            {group.baleName}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>Qty: {group.bales.length}</span>
                          <span>Wt: {group.totalWeight.toFixed(2)} kg</span>
                        </div>
                      </button>
                      {viewMode === "detailed" && (
                        <Table>
                          <TableBody>
                            {[...group.bales].sort((a, b) => b.id - a.id).map((bale) => (
                              <TableRow
                                key={bale.id}
                                data-testid={`row-bale-${bale.id}`}
                              >
                                <TableCell
                                  data-testid={`text-bale-ref-${bale.id}`}
                                >
                                  <div className="font-mono text-sm">{bale.baleReference}</div>
                                  {bale.baleName && (
                                    <div className="text-xs text-muted-foreground mt-0.5">{bale.baleName}</div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                  {parseFloat(bale.weight || "0").toFixed(2)} kg
                                </TableCell>
                                <TableCell className="w-[40px]">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      setBaleToDelete({ id: bale.id, baleReference: bale.baleReference })
                                    }
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

          {/* Removal log — only shown when there are removals */}
          {orderId && baleRemovals.length > 0 && (
            <Card className="p-4">
              <button
                className="w-full flex items-center justify-between gap-2 text-sm font-medium"
                onClick={() => setShowRemovalLog((v) => !v)}
                data-testid="button-toggle-removal-log"
                type="button"
              >
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Removed Bales
                  <Badge variant="secondary" data-testid="badge-removal-count">{baleRemovals.length}</Badge>
                </span>
                {showRemovalLog ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              {showRemovalLog && (
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Article</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead>Removed By</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {baleRemovals.map((r) => (
                      <TableRow key={r.id} data-testid={`row-removal-${r.id}`} className="text-sm text-muted-foreground">
                        <TableCell className="font-mono" data-testid={`text-removal-ref-${r.id}`}>{r.referenceNumber}</TableCell>
                        <TableCell>{r.articleCode || "—"}</TableCell>
                        <TableCell className="text-right">
                          {r.weightKg ? `${parseFloat(r.weightKg).toFixed(2)} kg` : "—"}
                        </TableCell>
                        <TableCell>{r.removedByUsername || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {new Date(r.removedAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}
        </div>

        {/* Right: controls + proforma panel */}
        <div className="lg:w-[40%] flex flex-col gap-4">
          {/* Setup card — hidden once order started and proforma is showing */}
          <Card className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Customer</label>
              <Select
                value={selectedCustomerId}
                onValueChange={setSelectedCustomerId}
                disabled={!!orderId}
              >
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id.toString()}
                      data-testid={`select-customer-option-${c.id}`}
                    >
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
              <Select
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
                disabled={!!orderId}
              >
                <SelectTrigger data-testid="select-location">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem
                      key={loc.id}
                      value={loc.id.toString()}
                      data-testid={`select-location-option-${loc.id}`}
                    >
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {customerId && !orderId && activeProformas.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Proforma</label>
                <Select
                  value={selectedProformaId}
                  onValueChange={setSelectedProformaId}
                  disabled={!!orderId}
                >
                  <SelectTrigger data-testid="select-proforma">
                    <SelectValue placeholder="Select a proforma..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" data-testid="select-proforma-none">
                      No proforma
                    </SelectItem>
                    {activeProformas.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={String(p.id)}
                        data-testid={`select-proforma-option-${p.id}`}
                      >
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {customerId && !orderId && activeProformas.length === 0 && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-no-proforma"
              >
                No active proforma found. Loading will proceed without price
                references.
              </p>
            )}

            {/* Note field — editable before and after loading starts */}
            <div>
              <label className="text-sm font-medium mb-1 block">Note</label>
              {orderId ? (
                <div className="flex gap-2 items-start">
                  <Textarea
                    value={loadingNote}
                    onChange={(e) => setLoadingNote(e.target.value)}
                    placeholder="Add a note for this loading..."
                    className="resize-none text-sm"
                    rows={2}
                    data-testid="input-loading-note"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => saveNoteMutation.mutate(loadingNote)}
                    disabled={saveNoteMutation.isPending}
                    data-testid="button-save-note"
                    title="Save note"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Textarea
                  value={loadingNote}
                  onChange={(e) => setLoadingNote(e.target.value)}
                  placeholder="Optional note (e.g. Rush order, Handle with care)"
                  className="resize-none text-sm"
                  rows={2}
                  data-testid="input-loading-note"
                />
              )}
            </div>

            {!orderId && (
              <Button
                className="w-full"
                onClick={handleStartLoading}
                disabled={
                  !customerId ||
                  !selectedLocationId ||
                  createOrderMutation.isPending
                }
                data-testid="button-start-loading"
              >
                <Play className="mr-2 h-4 w-4" />
                {createOrderMutation.isPending
                  ? "Creating..."
                  : "Start Loading"}
              </Button>
            )}
          </Card>

          {/* Proforma progress panel — shown when order is active and a proforma is linked */}
          {orderId && linkedProforma ? (
            <Card
              className="p-4 flex flex-col gap-3"
              data-testid="card-proforma-progress"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-semibold text-sm">
                    {linkedProforma.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fulfilledCount} / {totalLines} lines fulfilled
                  </p>
                </div>
                <Badge
                  variant={
                    fulfilledCount === totalLines && totalLines > 0
                      ? "default"
                      : "secondary"
                  }
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
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Article</TableHead>
                      <TableHead className="text-xs text-right">Exp</TableHead>
                      <TableHead className="text-xs text-right">
                        Loaded
                      </TableHead>
                      <TableHead className="text-xs text-right">Rem</TableHead>
                      <TableHead className="text-xs text-right">Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extraArticles.map((code) => (
                      <TableRow
                        key={code}
                        className="bg-red-50 dark:bg-red-950/30"
                        data-testid={`row-extra-${code}`}
                      >
                        <TableCell className="text-xs font-mono py-1.5">
                          <div className="text-red-700 dark:text-red-400">
                            {code}
                          </div>
                          <div className="text-red-500 dark:text-red-500 text-[10px]">
                            Not on proforma
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right py-1.5 text-muted-foreground">
                          —
                        </TableCell>
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
                        <TableCell />
                      </TableRow>
                    ))}
                    {[...proformaProgress].sort((a, b) => {
                      const order = { overloaded: 0, short: 1, fulfilled: 2, none: 3 };
                      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
                    }).map((line) => (
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
                            {line.status === "fulfilled" && (
                              <CheckCircle className="h-3 w-3 text-green-600 shrink-0" />
                            )}
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
                          <div className="text-muted-foreground break-words">
                            {line.productName}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5">
                          {line.quantity}
                        </TableCell>
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
                          {line.status === "fulfilled" && (
                            <span className="text-green-600 dark:text-green-400">
                              ✓
                            </span>
                          )}
                          {line.status === "overloaded" && (
                            <span className="text-orange-600 dark:text-orange-400">
                              +{line.excess}
                            </span>
                          )}
                          {line.status === "short" && (
                            <span className="text-amber-600 dark:text-amber-400">
                              {line.remaining}
                            </span>
                          )}
                          {line.status === "none" && (
                            <span className="text-muted-foreground">
                              {line.quantity}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono py-1.5" data-testid={`text-stock-${line.articleCode}`}>
                          {(() => {
                            const inStock = stockCounts[line.articleCode] ?? null;
                            if (inStock === null) return <span className="text-muted-foreground">—</span>;
                            const needsMore = line.status === "short" || line.status === "none";
                            const shortage = needsMore && inStock < line.remaining;
                            const listParams = new URLSearchParams({
                              articleCode: line.articleCode,
                              productName: line.productName,
                              back: window.location.pathname + window.location.search,
                            });
                            if (stockLocationId) listParams.set("locationId", String(stockLocationId));
                            return (
                              <button
                                className={`underline underline-offset-2 cursor-pointer hover-elevate rounded px-0.5 ${shortage ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}
                                onClick={() => navigate(`/factory/stock-bale-list?${listParams}`)}
                                data-testid={`button-stock-detail-${line.articleCode}`}
                              >
                                {inStock}
                              </button>
                            );
                          })()}
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

      {/* Import from Excel Dialog */}
      <Dialog open={showImportDialog} onOpenChange={(open) => { setShowImportDialog(open); if (!open) { setImportPreview([]); setImportRefNumbers([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Bales from Excel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Download template:</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadTemplate("ref")}
                data-testid="button-download-ref-template"
              >
                <Download className="h-3 w-3 mr-1" />
                Ref Number
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadTemplate("articleCode")}
                data-testid="button-download-article-template"
              >
                <Download className="h-3 w-3 mr-1" />
                Article Code
              </Button>
            </div>
            {importMode === "refNumber" ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Each bale will be looked up by its ref number or bale code and added individually.
                </p>
                <div className="border rounded-md overflow-auto max-h-[320px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Ref / Code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importRefNumbers.map((ref, i) => (
                        <TableRow key={i} data-testid={`row-import-ref-${i}`}>
                          <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                          <TableCell className="font-mono text-sm">{ref}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {importRefNumbers.length} bale{importRefNumbers.length !== 1 ? "s" : ""} by ref / bale code
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Bales will be added oldest-first (by production date) for each article code.
                </p>
                {importPreview.length > 0 && (
                  <div className="border rounded-md overflow-auto max-h-[320px]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead>Article Code</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importPreview.map((row, i) => (
                          <TableRow key={i} data-testid={`row-import-preview-${i}`}>
                            <TableCell className="font-mono text-sm">{row.articleCode}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{row.qty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {importPreview.reduce((s, r) => s + r.qty, 0)} total bales across {importPreview.length} article code{importPreview.length !== 1 ? "s" : ""}
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportPreview([]); setImportRefNumbers([]); }} data-testid="button-cancel-import">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (importMode === "refNumber") {
                  bulkImportMutation.mutate({ mode: "refNumber", refNumbers: importRefNumbers });
                } else {
                  bulkImportMutation.mutate({ mode: "articleCode", items: importPreview });
                }
              }}
              disabled={bulkImportMutation.isPending || (importMode === "refNumber" ? importRefNumbers.length === 0 : importPreview.length === 0)}
              data-testid="button-confirm-import"
            >
              {bulkImportMutation.isPending
                ? "Importing…"
                : importMode === "refNumber"
                  ? `Add ${importRefNumbers.length} Bale${importRefNumbers.length !== 1 ? "s" : ""}`
                  : `Add ${importPreview.reduce((s, r) => s + r.qty, 0)} Bales`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Loading Warning Dialog */}
      <Dialog open={showPendingWarning} onOpenChange={setShowPendingWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Proforma Already Being Loaded
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This proforma already has {pendingOrders.length === 1 ? "an active loading order" : `${pendingOrders.length} active loading orders`}. You can continue one of them or start a new loading.
            </p>
            <div className="space-y-2">
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="text-sm">
                    <span className="font-medium">
                      {order.invoiceNumber || `Order #${order.id}`}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      · {order.totalQtyBales} bales · {order.status}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowPendingWarning(false);
                      navigate(`/factory/sales/loading/new?orderId=${order.id}`);
                    }}
                    data-testid={`button-resume-order-${order.id}`}
                  >
                    Resume
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setShowPendingWarning(false)}
              data-testid="button-cancel-pending-warning"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowPendingWarning(false);
                const chosenProforma =
                  selectedProformaId && selectedProformaId !== "none"
                    ? proformas.find((p) => p.id === parseInt(selectedProformaId)) || null
                    : null;
                createOrderMutation.mutate({
                  customerId: customerId!,
                  proformaIdUsed: chosenProforma?.id || null,
                  locationId: parseInt(selectedLocationId),
                  orderDate,
                });
              }}
              data-testid="button-create-new-loading"
            >
              Start New Loading
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <TableHeader>
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
                            <div className="font-mono text-xs">
                              {line.articleCode}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {line.productName}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {line.quantity}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {line.loaded}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.status === "fulfilled" && (
                              <span className="text-green-600 dark:text-green-400 font-semibold">
                                ✓ Done
                              </span>
                            )}
                            {line.status === "overloaded" && (
                              <span className="text-orange-600 dark:text-orange-400 font-semibold flex items-center justify-end gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Over +{line.excess}
                              </span>
                            )}
                            {(line.status === "short" ||
                              line.status === "none") && (
                              <span className="text-amber-600 dark:text-amber-400 flex items-center justify-end gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Short {line.remaining}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {extraArticles.map((code) => (
                        <TableRow
                          key={code}
                          className="bg-red-50 dark:bg-red-950/30"
                        >
                          <TableCell className="text-sm">
                            <div className="font-mono text-xs text-red-700 dark:text-red-400">
                              {code}
                            </div>
                            <div className="text-red-500 text-xs">
                              Not on proforma
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            —
                          </TableCell>
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
                      {
                        proformaProgress.filter((l) => l.status === "fulfilled")
                          .length
                      }{" "}
                      fulfilled
                    </span>
                    {proformaProgress.filter((l) => l.status === "overloaded")
                      .length > 0 && (
                      <span className="text-orange-600 dark:text-orange-400 font-medium">
                        {
                          proformaProgress.filter(
                            (l) => l.status === "overloaded",
                          ).length
                        }{" "}
                        overloaded
                      </span>
                    )}
                    {proformaProgress.filter(
                      (l) => l.status === "short" || l.status === "none",
                    ).length > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        {
                          proformaProgress.filter(
                            (l) => l.status === "short" || l.status === "none",
                          ).length
                        }{" "}
                        short
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
                  This will mark the loading as complete and send it for office
                  verification.
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>Total Bales:</span>
                    <span
                      className="font-mono font-semibold"
                      data-testid="text-dialog-total-bales"
                    >
                      {bales.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Total Weight:</span>
                    <span
                      className="font-mono font-semibold"
                      data-testid="text-dialog-total-weight"
                    >
                      {totalWeight.toFixed(2)} kg
                    </span>
                  </div>
                </div>
              </>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">Loading Date</label>
              <input
                type="date"
                value={finalizeDate}
                onChange={(e) => setFinalizeDate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="input-finalize-date"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowFinalizeDialog(false)}
                data-testid="button-cancel-finalize"
              >
                Cancel
              </Button>
              <Button
                onClick={() => finalizeMutation.mutate(finalizeDate)}
                disabled={finalizeMutation.isPending}
                data-testid="button-confirm-finalize"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {finalizeMutation.isPending
                  ? "Finalizing..."
                  : "Confirm Finalize"}
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
            <div className="bg-muted rounded-md px-4 py-3 font-mono text-lg font-semibold text-center" data-testid="text-last-scanned-ref">
              {lastScannedRef?.baleReference}
              {lastScannedRef?.baleName && <div className="text-sm font-normal text-muted-foreground mt-1">{lastScannedRef.baleName}</div>}
            </div>
            <Button className="w-full" onClick={() => setShowLastScannedPopup(false)} data-testid="button-dismiss-last-scanned">
              Continue Scanning
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bale removal confirmation */}
      <AlertDialog open={!!baleToDelete} onOpenChange={(open) => { if (!open) setBaleToDelete(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-remove-bale">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove bale from loading?</AlertDialogTitle>
            <AlertDialogDescription>
              Bale <span className="font-mono font-semibold">{baleToDelete?.baleReference}</span> will be removed from this loading and returned to stock. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-remove-bale">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-remove-bale"
              onClick={() => {
                if (baleToDelete) {
                  removeBaleMutation.mutate(baleToDelete.id);
                  setBaleToDelete(null);
                }
              }}
            >
              Remove Bale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
