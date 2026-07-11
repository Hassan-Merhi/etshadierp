import { useState, useRef, useMemo, useEffect } from "react";
import { addDays, format } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAdminOverride } from "@/hooks/use-admin-override";
import {
  Printer,
  Trash2,
  Search,
  Package,
  CheckSquare,
  RefreshCw,
  Pencil,
  Check,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Undo2,
  AlertTriangle,
  Lock,
  XCircle,
  ShieldAlert,
  FileSpreadsheet,
  Upload,
  CheckCircle,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
import { buildZplBatch } from "@/lib/zplBuilder";
import { LabelPrintSettings, getPaperFormat } from "@/components/LabelPrintSettings";
import {
  generateCombinedLabelsHtml,
  generateA5LabelsHtml,
  generateStickerLabelsHtml,
  prefetchBannersForPrint,
  formatLabelNum,
  type LabelData,
  type A4DesignColor,
} from "@/lib/labelHtml";
import { useLabelDesignColors } from "@/hooks/useLabelDesignColors";
import type { FactoryMixBatch, FactoryBaleProduct } from "@shared/schema";
import { BaleWeightEditDialog, type WeightEditBale } from "@/components/BaleWeightEditDialog";

const STATUS_COLORS: Record<string, string> = {
  PENDING_PRESSING: "outline",
  LABEL_PRINTED: "secondary",
  PRESSED: "default",
  FINALIZED: "default",
  IN_STOCK: "default",
  RESERVED: "outline",
  SOLD: "destructive",
  REPACKED: "secondary",
};

export default function BalesHistory() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exportLoading, setExportLoading] = useState(false);
  const { colors: designColors } = useLabelDesignColors();

  const [searchTerm, setSearchTerm] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [designPickerOpen, setDesignPickerOpen] = useState(false);
  const [pendingReprintLabels, setPendingReprintLabels] = useState<LabelData[] | null>(null);
  const [repackConfirm, setRepackConfirm] = useState<any>(null);
  const [returnToStockBale, setReturnToStockBale] = useState<any>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<HTMLInputElement>(null);
  const reimportFileRef = useRef<HTMLInputElement>(null);
  const namesFileRef = useRef<HTMLInputElement>(null);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [supervisorUsername, setSupervisorUsername] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [authError, setAuthError] = useState("");
  const [importingNames, setImportingNames] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [weightEditBale, setWeightEditBale] = useState<WeightEditBale | null>(null);

  // Keyboard +/- date navigation
  useEffect(() => {
    const fmt = "yyyy-MM-dd";
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "-") {
        e.preventDefault();
        setDateFilter((prev) => (prev ? format(addDays(new Date(prev + "T00:00:00"), -1), fmt) : prev));
      } else if (e.key === "+" || (e.key === "=" && e.shiftKey)) {
        e.preventDefault();
        setDateFilter((prev) => (prev ? format(addDays(new Date(prev + "T00:00:00"), 1), fmt) : prev));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const params = new URLSearchParams();
      if (exportFrom) params.set("from", exportFrom);
      if (exportTo) params.set("to", exportTo);
      const url = `/api/factory/bales/stock-register.xlsx${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `stock_register${exportFrom && exportTo ? `_${exportFrom}_to_${exportTo}` : "_all"}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      setShowExportDialog(false);
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hiddenCost = myAccess?.hiddenCostFields ?? [];

  const { data: balesData, isLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/bales", dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      // Lite mode: slim product/mixBatch payloads; skips lastPrintedAt lookup.
      params.set("lite", "1");
      const path = `/api/factory/bales?${params.toString()}`;
      const res = await modeApiRequest("GET", path);
      if (!res.ok) throw new Error("Failed to fetch bales");
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev: any) => prev,
  });

  const { data: mixBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
  });

  const deleteBale = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/factory/bales/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      toast({ title: "Bale deleted" });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error deleting bale", description: error.message, variant: "destructive" });
      setDeleteConfirm(null);
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return await modeApiRequest("PATCH", `/api/factory/bales/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Status updated" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateStatus = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      return await modeApiRequest("PATCH", "/api/factory/bales/bulk-status", { ids, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      setSelectedIds(new Set());
      setBulkStatus("");
      toast({ title: "Bulk status updated" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    },
  });

  const updateProductName = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await modeApiRequest("PATCH", `/api/factory/bales/${id}/product-name`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      setEditingNameId(null);
      toast({ title: "Product name updated" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error updating name", description: error.message, variant: "destructive" });
    },
  });

  const { data: returnToStockOrderInfo, isLoading: orderInfoLoading } = useQuery<any>({
    queryKey: ["/api/factory/bales", returnToStockBale?.bale?.id, "order-info"],
    queryFn: async () => {
      if (!returnToStockBale) return null;
      const res = await modeApiRequest("GET", `/api/factory/bales/${returnToStockBale.bale.id}/order-info`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!returnToStockBale,
  });

  const returnToStockMutation = useMutation({
    mutationFn: async (baleId: number) => {
      const res = await modeApiRequest("POST", `/api/factory/bales/${baleId}/return-to-stock`, {});
      if (!res.ok) {
        const err = await res.json();
        throw Object.assign(new Error(err.message || "Failed to return bale to stock"), { isLastBale: err.isLastBale });
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setReturnToStockBale(null);
      const invoiceMsg = data.invoiceNumber
        ? ` Invoice ${data.invoiceNumber} updated to $${parseFloat(data.newGrandTotal || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      toast({ title: "Bale returned to stock", description: `Bale removed from order.${invoiceMsg}` });
    },
    onError: (err: any) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const repackBale = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("POST", `/api/factory/bales/${id}/repack`, {});
    },
    onSuccess: async (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      setRepackConfirm(null);
      const data = await response.json();
      toast({ title: "Bale repacked", description: `New reference: ${data.newRefNum}` });

      const label: LabelData = {
        referenceNumber: data.newBale.referenceNumber || data.newRefNum,
        articleCode: data.newBale.articleCode || data.newBale.category || "",
        pieces: data.newBale.quantity || 1,
        approxWeightKg: data.newBale.weightKg || "0",
        productName: data.newBale.productName || data.newBale.category || "",
      };
      openBrowserReprint([label]);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error repacking bale", description: error.message, variant: "destructive" });
      setRepackConfirm(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({
      ids,
      supervisorUsername,
      supervisorPassword,
      reason,
    }: {
      ids: number[];
      supervisorUsername: string;
      supervisorPassword: string;
      reason: string;
    }) => {
      const response = await modeApiRequest("POST", "/api/factory/stock-entry/remove", {
        baleIds: ids,
        supervisorUsername,
        supervisorPassword,
        reason,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to remove bales");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      toast({ title: "Bales Removed", description: `${result.removed} bale(s) removed from stock` });
      setSelectedIds(new Set());
      setRemoveDialogOpen(false);
    },
    onError: (error: Error) => {
      if (error?._handledGlobally) return;
      setAuthError(error.message);
    },
  });

  const bulkUpdateNamesMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/factory/bales/bulk-update-names", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Names updated",
        description: `Updated ${data.updated} bale${data.updated !== 1 ? "s" : ""}, skipped ${data.skipped}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setImportingNames(false),
  });

  const reimportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/factory/bales/reimport", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Reimport failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Bales reimported",
        description: `Successfully reimported ${data.imported} bale(s) (${parseFloat(data.totalWeight).toFixed(1)} kg).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-entry/in-stock"] });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Reimport failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setReimporting(false),
  });

  const startEditName = (baleId: number, currentName: string) => {
    setEditingNameId(baleId);
    setEditingNameValue(currentName);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const saveEditName = (baleId: number) => {
    if (editingNameValue.trim()) {
      wrapAdminAction(
        () => updateProductName.mutate({ id: baleId, name: editingNameValue.trim() }),
        "Update Bale Name"
      );
    } else {
      setEditingNameId(null);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (filteredItems: any[]) => {
    const filteredIds = filteredItems.map((r: any) => r.bale.id);
    const allSelected = filteredIds.every((id: number) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredIds));
    }
  };

  const handleReprint = async (baleRow: any) => {
    const label: LabelData = {
      referenceNumber: baleRow.bale.referenceNumber || baleRow.bale.baleCode,
      articleCode: baleRow.product?.articleCode || baleRow.bale.articleCode || baleRow.bale.category || "",
      pieces: baleRow.bale.quantity || 1,
      approxWeightKg: baleRow.bale.weightKg || "0",
      productName: baleRow.bale.productName || baleRow.product?.name || baleRow.bale.category || "",
    };

    try {
      await modeApiRequest("POST", "/api/bale-label-prints/reprint", { baleId: baleRow.bale.id });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
    } catch {}

    if (isZebraMode()) {
      try {
        const zpl = buildZplBatch([label], true);
        await printRawZpl(zpl);
        toast({ title: "Label sent to Zebra printer" });
      } catch (err: any) {
        toast({
          title: "Zebra print failed — falling back to browser",
          description: err.message,
          variant: "destructive",
        });
        openBrowserReprint([label]);
      }
    } else {
      openBrowserReprint([label]);
    }
  };

  const openBrowserReprint = (labels: LabelData[], designColor?: A4DesignColor) => {
    prefetchBannersForPrint();
    const fmt = getPaperFormat();
    if (fmt === "A4" && !designColor) {
      setPendingReprintLabels(labels);
      setDesignPickerOpen(true);
      return;
    }
    const paperHtml = fmt === "A5" ? generateA5LabelsHtml(labels) : generateCombinedLabelsHtml(labels, designColor);
    const stickerHtml = generateStickerLabelsHtml(labels);

    const w1 = window.open("", "_blank", "width=800,height=900");
    if (w1) {
      w1.document.write(paperHtml);
      w1.document.close();
      w1.focus();
      setTimeout(() => w1.print(), 500);
    }

    const w2 = window.open("", "_blank", "width=400,height=600");
    if (w2) {
      w2.document.write(stickerHtml);
      w2.document.close();
      w2.focus();
      const imgs = w2.document.images;
      let loaded = 0;
      const total = imgs.length;
      const tryPrint = () => {
        loaded++;
        if (loaded >= total) setTimeout(() => w2.print(), 300);
      };
      if (total === 0) {
        setTimeout(() => w2.print(), 300);
      } else {
        for (let i = 0; i < total; i++) {
          if (imgs[i].complete) tryPrint();
          else imgs[i].onload = imgs[i].onerror = tryPrint;
        }
      }
    }

    if (!w1 && !w2) {
      toast({ title: "Warning", description: "Please allow pop-ups to print labels", variant: "destructive" });
    }
  };

  const filtered = (balesData || []).filter((row: any) => {
    const bale = row.bale;
    const product = row.product;
    const batch = row.mixBatch;

    // Always hide deleted bales
    if (bale.status === "REMOVED" || bale.status === "DELETED") return false;

    if (batchFilter !== "all" && String(bale.mixBatchId) !== batchFilter) return false;
    if (statusFilter !== "all" && bale.status !== statusFilter) return false;

    // When the user is actively searching by text, skip the date filter so
    // bales from any date are included (e.g. searching an old reference number).
    if (dateFilter && !searchTerm) {
      // Prefer stockEntryDate (set on all stock-entry/waste-dispatch bales) so
      // backdated entries appear on the correct day. Fall back to createdAt for
      // pressing-batch bales that don't carry a stockEntryDate.
      const baleDate = bale.stockEntryDate
        ? bale.stockEntryDate
        : bale.createdAt
        ? new Date(bale.createdAt).toLocaleDateString("en-CA")
        : null;
      if (baleDate !== dateFilter) return false;
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchFields = [
        bale.baleCode,
        bale.referenceNumber,
        bale.barcodeValue,
        bale.category,
        product?.name,
        product?.articleCode,
        batch?.name,
      ]
        .filter(Boolean)
        .map((s: string) => s.toLowerCase());
      if (!searchFields.some((f) => f.includes(term))) return false;
    }

    return true;
  });

  const totalWeight = filtered.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);
  const totalBales = filtered.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);

  const groupedFiltered = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        productName: string;
        articleCode: string;
        sellingPrice: string | null;
        totalQty: number;
        totalWeightKg: number;
        rows: any[];
      }
    >();
    for (const row of filtered) {
      const { bale, product } = row;
      const name = product?.name || bale.productName || bale.category || "-";
      const article = product?.articleCode || bale.category || "-";
      const key = `${name}|||${article}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          productName: name,
          articleCode: article,
          sellingPrice: product?.sellingPrice ?? null,
          totalQty: 0,
          totalWeightKg: 0,
          rows: [],
        });
      }
      const g = map.get(key)!;
      g.rows.push(row);
      g.totalQty += bale.quantity || 1;
      g.totalWeightKg += parseFloat(bale.weightKg || "0");
    }
    return Array.from(map.values());
  }, [filtered]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const todayStr = new Date().toLocaleDateString("en-CA");
  const summaryDate = dateFilter || todayStr;
  const todayInStock = (balesData || []).filter((row: any) => {
    const bale = row.bale;
    if (bale.status !== "IN_STOCK") return false;
    const baleDate = bale.stockEntryDate
      ? bale.stockEntryDate
      : bale.createdAt
      ? new Date(bale.createdAt).toLocaleDateString("en-CA")
      : null;
    return baleDate === summaryDate;
  });

  // Robust classification: check category → productName → product.name with includes() matching
  // so "Garbage Bales", "GARBAGE", " garbage " and "wiper"/"WIPERS" all classify correctly
  const getBaleClassification = (row: any): "garbage" | "wipers" | "regular" => {
    const candidates = [row.bale?.category, row.bale?.productName, row.product?.name]
      .filter((v: any) => v && typeof v === "string")
      .map((v: string) => v.toLowerCase().trim());

    for (const c of candidates) {
      if (c.includes("garbage")) return "garbage";
      if (c.includes("wiper")) return "wipers";
    }
    return "regular";
  };

  const todayGarbage = todayInStock.filter((row: any) => getBaleClassification(row) === "garbage");
  const todayWipers = todayInStock.filter((row: any) => getBaleClassification(row) === "wipers");
  const todayRegular = todayInStock.filter((row: any) => getBaleClassification(row) === "regular");
  const regularQty = todayRegular.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);
  const regularKg = todayRegular.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);
  const garbageQty = todayGarbage.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);
  const garbageKg = todayGarbage.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);
  const wipersQty = todayWipers.reduce((sum: number, row: any) => sum + (row.bale.quantity || 1), 0);
  const wipersKg = todayWipers.reduce((sum: number, row: any) => sum + parseFloat(row.bale.weightKg || "0"), 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const inStockSelectedCount = Array.from(selectedIds).filter((id) =>
    (balesData || []).some((r: any) => r.bale.id === id && r.bale.status === "IN_STOCK")
  ).length;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/30 to-emerald-600/10 border border-emerald-500/25 shrink-0">
            <Package className="h-4.5 w-4.5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Bales</h1>
            <p className="text-xs text-muted-foreground leading-tight">Stock history, status management and removal</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" data-testid="badge-total-bales" className="font-mono">
            {totalBales} bales
          </Badge>
          <Badge variant="outline" data-testid="badge-total-weight" className="font-mono">
            {formatLabelNum(totalWeight)} kg
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowExportDialog(true)}
            data-testid="button-export-stock-register"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Register
          </Button>
        </div>
      </div>

      {/* ── Date stats strip ── */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center gap-4 px-4 py-2.5 flex-wrap">
          <Input
            type="date"
            value={summaryDate}
            onChange={(e) => setDateFilter(e.target.value || todayStr)}
            className="h-7 w-36 text-xs"
            data-testid="input-summary-date"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">In Stock</span>
            <span className="text-sm font-bold font-mono tabular-nums" data-testid="text-today-qty">
              {regularQty}
            </span>
            <span className="text-xs text-muted-foreground font-mono" data-testid="text-today-kg">
              {formatLabelNum(regularKg)} kg
            </span>
          </div>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Garbage</span>
            <span className="text-sm font-bold font-mono tabular-nums" data-testid="text-today-garbage-qty">
              {garbageQty}
            </span>
            <span className="text-xs text-muted-foreground font-mono" data-testid="text-today-garbage-kg">
              {formatLabelNum(garbageKg)} kg
            </span>
          </div>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Wipers</span>
            <span className="text-sm font-bold font-mono tabular-nums" data-testid="text-today-wipers-qty">
              {wipersQty}
            </span>
            <span className="text-xs text-muted-foreground font-mono" data-testid="text-today-wipers-kg">
              {formatLabelNum(wipersKg)} kg
            </span>
          </div>
        </div>
      </div>

      {/* ── Main table card ── */}
      <div className="rounded-xl border overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/20 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by ref #, code, product, batch..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-bales-search"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() =>
                setDateFilter((prev) => (prev ? format(addDays(new Date(prev + "T00:00:00"), -1), "yyyy-MM-dd") : prev))
              }
              disabled={!dateFilter}
              data-testid="button-prev-date"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-[140px] h-8 text-sm"
              data-testid="input-date-filter"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() =>
                setDateFilter((prev) => (prev ? format(addDays(new Date(prev + "T00:00:00"), 1), "yyyy-MM-dd") : prev))
              }
              disabled={!dateFilter}
              data-testid="button-next-date"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {dateFilter && (
              <Button variant="ghost" size="sm" onClick={() => setDateFilter("")} data-testid="button-clear-date">
                Clear
              </Button>
            )}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px] h-8 text-sm" data-testid="select-status-filter">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
              <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
              <SelectItem value="PRESSED">Pressed</SelectItem>
              <SelectItem value="FINALIZED">Finalized</SelectItem>
              <SelectItem value="IN_STOCK">In Stock</SelectItem>
              <SelectItem value="RESERVED">Reserved</SelectItem>
              <SelectItem value="SOLD">Sold</SelectItem>
              <SelectItem value="REPACKED">Repacked</SelectItem>
            </SelectContent>
          </Select>
          <LabelPrintSettings />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-tools-menu">
                Tools
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export / Import</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  const exportDate = dateFilter || new Date().toLocaleDateString("en-CA");
                  window.open(`/api/factory/bales/export-full.xlsx?date=${exportDate}`, "_blank");
                }}
                data-testid="button-export-bales-full"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export Bales ({dateFilter || "Today"})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => reimportFileRef.current?.click()}
                disabled={reimportMutation.isPending || reimporting}
                data-testid="button-reimport-bales"
              >
                <Upload className="h-4 w-4 mr-2" />
                {reimportMutation.isPending ? "Reimporting..." : "Reimport Bales"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => window.open("/api/factory/bales/export-names.xlsx", "_blank")}
                data-testid="button-export-bale-names"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Names
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => namesFileRef.current?.click()}
                disabled={bulkUpdateNamesMutation.isPending || importingNames}
                data-testid="button-import-bale-names"
              >
                <Upload className="h-4 w-4 mr-2" />
                {bulkUpdateNamesMutation.isPending ? "Importing..." : "Import Names"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={reimportFileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setReimporting(true);
                reimportMutation.mutate(file);
                e.target.value = "";
              }
            }}
            data-testid="input-reimport-bales"
          />
          <input
            ref={namesFileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setImportingNames(true);
                bulkUpdateNamesMutation.mutate(file);
                e.target.value = "";
              }
            }}
            data-testid="input-import-bale-names"
          />
        </div>

        {/* Selection action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/40 flex-wrap">
            <CheckSquare className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="w-[170px] h-7 text-xs" data-testid="select-bulk-status">
                <SelectValue placeholder="Change status to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
                <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                <SelectItem value="PRESSED">Pressed</SelectItem>
                <SelectItem value="FINALIZED">Finalized</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
                <SelectItem value="REPACKED">Repacked</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!bulkStatus || bulkUpdateStatus.isPending}
              onClick={() =>
                wrapAdminAction(
                  () => bulkUpdateStatus.mutate({ ids: Array.from(selectedIds), status: bulkStatus }),
                  "Bulk Update Status"
                )
              }
              data-testid="button-bulk-update"
            >
              {bulkUpdateStatus.isPending ? "Updating..." : "Apply"}
            </Button>
            {inStockSelectedCount > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setRemoveDialogOpen(true);
                  setSupervisorUsername("");
                  setSupervisorPassword("");
                  setRemovalReason("");
                  setAuthError("");
                }}
                data-testid="button-remove-bales"
              >
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Remove ({inStockSelectedCount})
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedIds(new Set());
                setBulkStatus("");
              }}
              data-testid="button-clear-selection"
            >
              Clear
            </Button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No bales found</p>
            {searchTerm && <p className="text-xs mt-1">Try a different search term</p>}
          </div>
        ) : (
          <div>
            <Table wrapperClassName="max-h-[calc(100vh-380px)] overflow-auto">
              <TableHeader className="sticky top-0 z-30 bg-muted border-b-2 border-border/60">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filtered.length > 0 && filtered.every((r: any) => selectedIds.has(r.bale.id))}
                      onCheckedChange={() => toggleSelectAll(filtered)}
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Ref #
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Product
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Article
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Qty
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Weight (kg)
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Status
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Last Printed
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedFiltered.map((group) => {
                  const isExpanded = expandedGroups.has(group.key);
                  const allGroupSelected = group.rows.every((r: any) => selectedIds.has(r.bale.id));
                  const someGroupSelected = group.rows.some((r: any) => selectedIds.has(r.bale.id));
                  const uniqueStatuses = [...new Set(group.rows.map((r: any) => r.bale.status as string))];

                  return [
                    // ── Group summary row ──
                    <TableRow
                      key={`group-${group.key}`}
                      className="bg-muted/20 hover-elevate cursor-pointer"
                      data-testid={`row-group-${group.key}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={allGroupSelected}
                          data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                          onCheckedChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (allGroupSelected) group.rows.forEach((r: any) => next.delete(r.bale.id));
                              else group.rows.forEach((r: any) => next.add(r.bale.id));
                              return next;
                            });
                          }}
                          data-testid={`checkbox-group-${group.key}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        <Badge variant="outline" className="text-xs font-mono">
                          {group.rows.length} bale{group.rows.length !== 1 ? "s" : ""}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <button
                          className="flex items-center gap-1.5 text-left font-medium hover:underline"
                          onClick={() => toggleGroup(group.key)}
                          data-testid={`button-toggle-group-${group.key}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          {group.productName}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{group.articleCode}</TableCell>
                      <TableCell className="text-right font-semibold">{group.totalQty}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatLabelNum(group.totalWeightKg)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {uniqueStatuses.map((s) => (
                            <Badge key={s} variant={(STATUS_COLORS[s] || "secondary") as any} className="text-xs">
                              {s.replace(/_/g, " ")}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>,

                    // ── Expanded individual bale rows ──
                    ...(isExpanded
                      ? group.rows.map((row: any) => {
                          const bale = row.bale;
                          const product = row.product;
                          return (
                            <TableRow key={bale.id} className="bg-background" data-testid={`row-bale-${bale.id}`}>
                              <TableCell className="pl-6">
                                <Checkbox
                                  checked={selectedIds.has(bale.id)}
                                  onCheckedChange={() => toggleSelect(bale.id)}
                                  data-testid={`checkbox-bale-${bale.id}`}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs pl-6">
                                {bale.referenceNumber || bale.baleCode || "-"}
                              </TableCell>
                              <TableCell className="pl-8">
                                {editingNameId === bale.id ? (
                                  <div className="flex items-center gap-1">
                                    <Input
                                      ref={nameInputRef}
                                      value={editingNameValue}
                                      onChange={(e) => setEditingNameValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEditName(bale.id);
                                        if (e.key === "Escape") setEditingNameId(null);
                                      }}
                                      className="h-7 text-xs w-[160px]"
                                      data-testid={`input-edit-name-${bale.id}`}
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => saveEditName(bale.id)}
                                      data-testid={`button-save-name-${bale.id}`}
                                    >
                                      <Check className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setEditingNameId(null)}
                                      data-testid={`button-cancel-name-${bale.id}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div
                                    className="flex items-center gap-1 group cursor-pointer text-sm text-muted-foreground"
                                    onClick={() => startEditName(bale.id, product?.name || bale.productName || "")}
                                    data-testid={`text-product-name-${bale.id}`}
                                  >
                                    <span>{product?.name || bale.productName || "-"}</span>
                                    <Pencil className="h-3 w-3 text-muted-foreground visible md:invisible md:group-hover:visible" />
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {product?.articleCode || bale.category || "-"}
                              </TableCell>
                              <TableCell className="text-right">{bale.quantity}</TableCell>
                              <TableCell className="text-right font-mono">
                                <button
                                  className="group flex items-center gap-1 ml-auto hover:text-foreground"
                                  onClick={(e) => { e.stopPropagation(); setWeightEditBale({ id: bale.id, referenceNumber: bale.referenceNumber, weightKg: bale.weightKg }); }}
                                  title="Correct weight"
                                >
                                  {formatLabelNum(bale.weightKg)}
                                  <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
                                </button>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={bale.status}
                                  onValueChange={(val) =>
                                    wrapAdminAction(
                                      () => updateStatus.mutate({ id: bale.id, status: val }),
                                      "Update Bale Status"
                                    )
                                  }
                                >
                                  <SelectTrigger
                                    className="w-[140px] h-8 text-xs"
                                    data-testid={`select-status-${bale.id}`}
                                  >
                                    <Badge
                                      variant={(STATUS_COLORS[bale.status] || "secondary") as any}
                                      className="text-xs"
                                    >
                                      {bale.status.replace(/_/g, " ")}
                                    </Badge>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="PENDING_PRESSING">Pending Pressing</SelectItem>
                                    <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                                    <SelectItem value="PRESSED">Pressed</SelectItem>
                                    <SelectItem value="FINALIZED">Finalized</SelectItem>
                                    <SelectItem value="IN_STOCK">In Stock</SelectItem>
                                    <SelectItem value="RESERVED">Reserved</SelectItem>
                                    <SelectItem value="SOLD">Sold</SelectItem>
                                    <SelectItem value="REPACKED">Repacked</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell
                                className="text-xs text-muted-foreground"
                                data-testid={`text-last-printed-${bale.id}`}
                              >
                                {row.lastPrintedAt ? new Date(row.lastPrintedAt).toLocaleString() : "Never"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {(bale.status === "RESERVED_FOR_ORDER" ||
                                    bale.status === "RESERVED" ||
                                    bale.status === "SOLD") && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setReturnToStockBale(row)}
                                      title="Return bale to stock"
                                      data-testid={`button-return-to-stock-${bale.id}`}
                                    >
                                      <Undo2 className="h-4 w-4 text-blue-500" />
                                    </Button>
                                  )}
                                  {myAccess?.fullAccess && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setRepackConfirm(row)}
                                      disabled={bale.status === "REPACKED" || bale.status === "SOLD"}
                                      title="Repack bale"
                                      data-testid={`button-repack-${bale.id}`}
                                    >
                                      <RefreshCw className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleReprint(row)}
                                    data-testid={`button-reprint-${bale.id}`}
                                  >
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                  {myAccess?.fullAccess && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setDeleteConfirm(bale.id)}
                                      data-testid={`button-delete-${bale.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      : []),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Remove from Stock Dialog ── */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Supervisor Authorization Required
            </DialogTitle>
            <DialogDescription>
              Removing {inStockSelectedCount} IN STOCK bale(s) requires supervisor credentials. This action will be
              logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Supervisor Username</p>
              <Input
                value={supervisorUsername}
                onChange={(e) => {
                  setSupervisorUsername(e.target.value);
                  setAuthError("");
                }}
                placeholder="Enter supervisor username..."
                data-testid="input-supervisor-username"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Supervisor Password</p>
              <Input
                type="password"
                value={supervisorPassword}
                onChange={(e) => {
                  setSupervisorPassword(e.target.value);
                  setAuthError("");
                }}
                placeholder="Enter supervisor password..."
                data-testid="input-supervisor-password"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Reason for Removal</p>
              <Input
                value={removalReason}
                onChange={(e) => setRemovalReason(e.target.value)}
                placeholder="Entered by mistake, damaged, etc..."
                data-testid="input-removal-reason"
              />
            </div>
            {authError && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <XCircle className="h-4 w-4" />
                {authError}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRemoveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!supervisorUsername || !supervisorPassword || removeMutation.isPending}
              onClick={() => {
                const idsToRemove = Array.from(selectedIds).filter((id) =>
                  (balesData || []).some((r: any) => r.bale.id === id && r.bale.status === "IN_STOCK")
                );
                removeMutation.mutate({
                  ids: idsToRemove,
                  supervisorUsername,
                  supervisorPassword,
                  reason: removalReason,
                });
              }}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending ? "Removing..." : "Remove from Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Bale</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this bale? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteBale.mutate(deleteConfirm)}
              disabled={deleteBale.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteBale.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={repackConfirm !== null} onOpenChange={() => setRepackConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Repack Bale</DialogTitle>
            <DialogDescription>
              {repackConfirm && (
                <>
                  Repack bale <span className="font-mono font-semibold">{repackConfirm.bale.referenceNumber}</span> (
                  {repackConfirm.product?.name || repackConfirm.bale.productName || "Unknown"})? This will mark the
                  original bale as REPACKED and create a new bale with a new reference code. Labels will be printed for
                  the new bale.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepackConfirm(null)} data-testid="button-cancel-repack">
              Cancel
            </Button>
            <Button
              onClick={() =>
                wrapAdminAction(() => repackConfirm && repackBale.mutate(repackConfirm.bale.id), "Repack Bale")
              }
              disabled={repackBale.isPending}
              data-testid="button-confirm-repack"
            >
              {repackBale.isPending ? "Repacking..." : "Repack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={designPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDesignPickerOpen(false);
            setPendingReprintLabels(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose Label Design</DialogTitle>
            <DialogDescription>Select a brand color for the A4 label header banner.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {designColors.map((opt) => (
              <button
                key={opt.value}
                data-testid={`button-design-${opt.value}`}
                className="flex flex-col items-center gap-2 p-3 rounded-md border hover-elevate cursor-pointer"
                onClick={() => {
                  setDesignPickerOpen(false);
                  if (pendingReprintLabels) {
                    const labels = pendingReprintLabels;
                    setPendingReprintLabels(null);
                    openBrowserReprint(labels, opt.value);
                  }
                }}
              >
                <img src={opt.previewUrl} className="w-full h-16 rounded-md object-cover" alt={opt.label} />
                <span className="text-sm font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDesignPickerOpen(false);
                setPendingReprintLabels(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              data-testid="button-design-none"
              onClick={() => {
                setDesignPickerOpen(false);
                if (pendingReprintLabels) {
                  const labels = pendingReprintLabels;
                  setPendingReprintLabels(null);
                  prefetchBannersForPrint();
                  const paperHtml = generateCombinedLabelsHtml(labels);
                  const stickerHtml = generateStickerLabelsHtml(labels);
                  const w1 = window.open("", "_blank", "width=800,height=900");
                  if (w1) {
                    w1.document.write(paperHtml);
                    w1.document.close();
                    w1.focus();
                    setTimeout(() => w1.print(), 500);
                  }
                  const w2 = window.open("", "_blank", "width=400,height=600");
                  if (w2) {
                    w2.document.write(stickerHtml);
                    w2.document.close();
                    w2.focus();
                    const imgs = w2.document.images;
                    let loaded = 0;
                    const total = imgs.length;
                    const tryPrint = () => {
                      loaded++;
                      if (loaded >= total) setTimeout(() => w2.print(), 300);
                    };
                    if (total === 0) {
                      setTimeout(() => w2.print(), 300);
                    } else {
                      for (let i = 0; i < total; i++) {
                        if (imgs[i].complete) tryPrint();
                        else imgs[i].onload = imgs[i].onerror = tryPrint;
                      }
                    }
                  }
                }
              }}
            >
              No Banner (Blank)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Stock Register Export Dialog ── */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export Stock Register</DialogTitle>
            <DialogDescription>
              Exports all bales (all statuses) to Excel with reference numbers, article codes, product names, weights,
              dates and more. Leave dates blank to export everything.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">From Date</p>
                <Input
                  type="date"
                  value={exportFrom}
                  onChange={(e) => setExportFrom(e.target.value)}
                  data-testid="input-export-from"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground mb-1">To Date</p>
                <Input
                  type="date"
                  value={exportTo}
                  onChange={(e) => setExportTo(e.target.value)}
                  data-testid="input-export-to"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)} disabled={exportLoading}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={exportLoading} data-testid="button-confirm-export">
              <Download className="h-4 w-4 mr-2" />
              {exportLoading ? "Exporting..." : "Download Excel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Return to Stock Dialog */}
      <Dialog
        open={!!returnToStockBale}
        onOpenChange={(open) => {
          if (!open) setReturnToStockBale(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-blue-500" />
              Return Bale to Stock
            </DialogTitle>
            <DialogDescription>
              Bale <span className="font-mono font-semibold">{returnToStockBale?.bale?.referenceNumber}</span>
              {returnToStockBale?.product?.name || returnToStockBale?.bale?.productName
                ? ` — ${returnToStockBale?.product?.name || returnToStockBale?.bale?.productName}`
                : ""}{" "}
              ({returnToStockBale?.bale?.weightKg} kg)
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {orderInfoLoading ? (
              <div className="text-sm text-muted-foreground py-2">Loading order details...</div>
            ) : returnToStockOrderInfo ? (
              <>
                <div className="rounded-md border p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order status</span>
                    <Badge variant="secondary" className="text-xs">
                      {returnToStockOrderInfo.status}
                    </Badge>
                  </div>
                  {returnToStockOrderInfo.invoiceNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Invoice</span>
                      <span className="font-mono font-semibold">{returnToStockOrderInfo.invoiceNumber}</span>
                    </div>
                  )}
                  {returnToStockOrderInfo.customerName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer</span>
                      <span>{returnToStockOrderInfo.customerName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current total</span>
                    <span className="font-mono">
                      $
                      {parseFloat(returnToStockOrderInfo.grandTotal || "0").toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bales in order</span>
                    <span>{returnToStockOrderInfo.totalBalesInOrder}</span>
                  </div>
                </div>

                {returnToStockOrderInfo.totalBalesInOrder <= 1 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>This is the last bale in the order. You must cancel the entire order instead.</p>
                  </div>
                )}

                {returnToStockOrderInfo.status === "FINALIZED" && returnToStockOrderInfo.totalBalesInOrder > 1 && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>
                      This order is <strong>finalized</strong>. Removing this bale will reduce invoice{" "}
                      <strong>{returnToStockOrderInfo.invoiceNumber}</strong> and update the customer's balance. The
                      invoice number will not change. Admin authorisation required.
                    </p>
                  </div>
                )}

                {!["FINALIZED"].includes(returnToStockOrderInfo.status) &&
                  returnToStockOrderInfo.totalBalesInOrder > 1 && (
                    <p className="text-sm text-muted-foreground">
                      The bale will be removed from this order and returned to stock. Order totals will be recalculated.
                    </p>
                  )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No order linked to this bale — it will simply be returned to stock.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setReturnToStockBale(null)}
              data-testid="button-cancel-return-to-stock"
            >
              Cancel
            </Button>
            <Button
              disabled={
                returnToStockMutation.isPending || orderInfoLoading || returnToStockOrderInfo?.totalBalesInOrder <= 1
              }
              onClick={() => {
                if (!returnToStockBale) return;
                const isFinalized = returnToStockOrderInfo?.status === "FINALIZED";
                const doIt = () => returnToStockMutation.mutate(returnToStockBale.bale.id);
                if (isFinalized) {
                  wrapAdminAction(doIt, "Return Bale to Stock (Finalized Order)");
                } else {
                  doIt();
                }
              }}
              data-testid="button-confirm-return-to-stock"
            >
              {returnToStockMutation.isPending ? "Processing..." : "Return to Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {AdminDialog}

      <BaleWeightEditDialog
        bale={weightEditBale}
        onClose={() => setWeightEditBale(null)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
          setWeightEditBale(null);
        }}
      />
    </div>
  );
}
