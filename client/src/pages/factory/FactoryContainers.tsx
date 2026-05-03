import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { Plus, Pencil, Container, Trash2, Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle2, Search, ArrowDown, AlertTriangle, RotateCcw, CheckSquare, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { factoryApiRequest } from "@/lib/factoryApi";
import { enqueueRequest } from "@/lib/offlineQueue";
import { formatNumber } from "@/lib/formatNumber";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FactoryContainer, FactorySupplier } from "@shared/schema";

interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

export default function FactoryContainers() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContainer, setEditingContainer] = useState<ContainerWithSupplier | null>(null);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set(["__all__"]));
  const [viewContainer, setViewContainer] = useState<ContainerWithSupplier | null>(null);
  const [formData, setFormData] = useState({
    containerNumber: "",
    supplierId: "",
    origin: "",
    totalKg: "",
    ratePerKg: "",
    arrivalDate: "",
    notes: "",
    status: "PENDING",
    commissionAmount: "",
    commissionCurrencyCode: "USD",
    commissionAccountId: "",
    commissionSupplierId: "",
    commissionNotes: "",
    freight: "",
    freightCurrencyCode: "USD",
    freightAccountId: "",
    otherCharges: "",
    otherChargesAccountId: "",
  });
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [fxRateSource, setFxRateSource] = useState<"auto" | "manual">("auto");
  const [fxEffectiveDate, setFxEffectiveDate] = useState("");

  type OtherChargeLine = { amount: string; currencyCode: string; ledgerAccountId: string };
  const [otherChargeLines, setOtherChargeLines] = useState<OtherChargeLine[]>([]);

  const updateOtherChargeLine = (idx: number, field: keyof OtherChargeLine, value: string) => {
    setOtherChargeLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const removeOtherChargeLine = (idx: number) => {
    setOtherChargeLines(prev => prev.filter((_, i) => i !== idx));
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (currency === "USD") {
      setFxRate("1");
      setFxEffectiveDate("");
      return;
    }
    fetch(`/api/factory/fx-rates/latest/${currency}`)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("No rate found");
      })
      .then((data) => {
        if (data?.rate) {
          setFxRate(String(data.rate));
          setFxEffectiveDate(data.effectiveDate || "");
        }
      })
      .catch(() => {});
  }, [currency]);

  // Sync commission currency with container currency in create mode
  useEffect(() => {
    if (!editingContainer) {
      setFormData(f => ({ ...f, commissionCurrencyCode: currency }));
    }
  }, [currency, editingContainer]);

  const { data: containers, isLoading } = useQuery<ContainerWithSupplier[]>({
    queryKey: ["/api/factory/containers"],
  });

  const { data: suppliers } = useQuery<FactorySupplier[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  // Auto-fill broker (commissionSupplierId) when supplier changes
  useEffect(() => {
    if (!formData.supplierId) {
      setFormData(f => ({ ...f, commissionSupplierId: "" }));
      return;
    }
    const sup = suppliers?.find(s => s.id === parseInt(formData.supplierId));
    if (sup?.parentId) {
      setFormData(f => ({ ...f, commissionSupplierId: String(sup.parentId) }));
    } else if (!formData.commissionSupplierId) {
      setFormData(f => ({ ...f, commissionSupplierId: "" }));
    }
  }, [formData.supplierId, suppliers]);

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: viewContainerCharges = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/containers", viewContainer?.id, "other-charges"],
    queryFn: async () => {
      if (!viewContainer) return [];
      const res = await factoryApiRequest("GET", `/api/factory/containers/${viewContainer.id}/other-charges`);
      return res.ok ? res.json() : [];
    },
    enabled: !!viewContainer,
  });

  useEffect(() => {
    if (!editingContainer) {
      setOtherChargeLines([]);
      return;
    }
    const containerCcy = (editingContainer as any).currencyCode || "USD";
    factoryApiRequest("GET", `/api/factory/containers/${editingContainer.id}/other-charges`)
      .then(res => res.ok ? res.json() : [])
      .then((charges: any[]) => {
        setOtherChargeLines(charges.map((c: any) => ({
          amount: c.amount || "",
          currencyCode: c.currencyCode || containerCcy,
          ledgerAccountId: c.ledgerAccountId ? String(c.ledgerAccountId) : "",
        })));
      })
      .catch(() => setOtherChargeLines([]));
  }, [editingContainer?.id]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency,
        fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource,
        commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null,
        freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        otherCharges: "0",
        otherChargesAccountId: null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/containers", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create container");
      }
      const container = await res.json();
      await factoryApiRequest("POST", `/api/factory/containers/${container.id}/other-charges/sync`, {
        charges: otherChargeLines
          .filter(l => parseFloat(l.amount || "0") > 0)
          .map(l => ({
            description: "Other Charge",
            amount: l.amount,
            currencyCode: l.currencyCode || currency,
            ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
          })),
      });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      const hasCommission = parseFloat(vars.commissionAmount || "0") > 0;
      toast({
        title: "Container saved",
        description: hasCommission ? "Broker commission added." : "Container created successfully.",
      });
      resetForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency,
        fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource,
        commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null,
        freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        // Preserve offload-set values — do NOT hardcode 0/null here
        otherCharges: data.otherCharges || "0",
        otherChargesAccountId: data.otherChargesAccountId ? parseInt(data.otherChargesAccountId) : null,
      };
      const validCharges = otherChargeLines
        .filter(l => parseFloat(l.amount || "0") > 0)
        .map(l => ({
          description: "Other Charge",
          amount: l.amount,
          currencyCode: l.currencyCode || currency,
          ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
        }));
      let container: any;
      try {
        const res = await factoryApiRequest("PATCH", `/api/factory/containers/${id}`, payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to update container");
        }
        container = await res.json();
      } catch (err: any) {
        if (err?.name === "OfflineQueued" && validCharges.length > 0) {
          enqueueRequest(
            `/api/factory/containers/${id}/other-charges/sync`,
            "POST",
            JSON.stringify({ charges: validCharges }),
            "Container Charges"
          );
        }
        throw err;
      }
      await factoryApiRequest("POST", `/api/factory/containers/${id}/other-charges/sync`, {
        charges: validCharges,
      });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      const hasCommission = parseFloat(vars.data.commissionAmount || "0") > 0;
      toast({
        title: "Container saved",
        description: hasCommission ? "Commission linked." : "Container updated.",
      });
      resetForm();
      setEditingContainer(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/containers/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete container");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Deleted", description: "Container removed" });
      setPendingDeleteId(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reverseOffloadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/${id}/reverse-offload`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to reverse offload");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setReversingContainer(null);
      toast({ title: "Offload Reversed", description: "Container is back to RECEIVED status. Raw stock, accounting vouchers, and daybook entries have all been removed." });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/backfill-import-credits`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Backfill failed");
      }
      return res.json() as Promise<{ created: number; skipped: number; total: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({
        title: "Backfill complete",
        description: `${data.created} supplier credit entries created, ${data.skipped} already had entries.`,
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[]; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reversingContainer, setReversingContainer] = useState<ContainerWithSupplier | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const importMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/containers/import-excel", { rows });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      setImportResult(data);
      toast({
        title: "Import Complete",
        description: `${data.imported} of ${data.total} containers imported${data.errors.length > 0 ? ` (${data.errors.length} errors)` : ""}`,
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const XLSX = await import("@/lib/excelHelper");
    const data = await file.arrayBuffer();
    const wb = await XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const mapped = jsonRows.map((row: any) => {
      const get = (keys: string[]) => {
        for (const k of keys) {
          const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
          if (val !== undefined && val !== "") return String(val).trim();
        }
        return "";
      };
      return {
        containerNumber: get(["Container Number", "Container #", "ContainerNumber", "container_number", "Container"]),
        supplierName: get(["Supplier", "Supplier Name", "SupplierName", "supplier_name"]),
        origin: get(["Origin", "Country", "origin"]),
        totalKg: get(["Total Kg", "TotalKg", "Weight", "total_kg", "KG", "Kg"]),
        ratePerKg: get(["Rate/Kg", "Rate Per Kg", "RatePerKg", "rate_per_kg", "Rate", "Price"]),
        currencyCode: get(["Currency", "CurrencyCode", "currency_code"]) || "USD",
        fxRateToUsd: get(["FX Rate", "FxRate", "fx_rate_to_usd", "Exchange Rate"]) || "",
        fxSource: get(["FX Source", "FxSource", "fx_source"]) || "",
        arrivalDate: get(["Arrival Date", "ArrivalDate", "arrival_date", "Date"]),
        notes: get(["Notes", "notes", "Remarks"]),
        status: get(["Status", "status"]) || "PENDING",
        commissionAmount: get(["Commission Amount", "CommissionAmount", "commission_amount", "Commission"]) || "",
        commissionCurrencyCode: get(["Commission Currency", "CommissionCurrency", "commission_currency_code", "Comm Currency"]) || "USD",
      };
    }).filter((r: any) => r.containerNumber);

    setImportPreview(mapped);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/containers/bulk-delete", { ids });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Bulk delete failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: "Deleted", description: `${data.deleted} container${data.deleted !== 1 ? "s" : ""} and all linked data removed successfully.` });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  const exportContainers = async (rows: ContainerWithSupplier[]) => {
    const XLSX = await import("@/lib/excelHelper");
    const headers = [
      "Container Number", "Supplier", "Broker / Commission To", "Origin",
      "Total Kg", "Rate/Kg", "Currency", "FX Rate", "FX Source", "Arrival Date", "Status", "Notes",
      "Commission Amount", "Commission Currency", "Commission Notes",
      "Freight Amount", "Freight Currency",
      "Other Charges (legacy)",
    ];
    const dataRows = rows.map((c: any) => {
      const brokerSupId = c.commissionSupplierId;
      const brokerName = brokerSupId ? (suppliers?.find((s: any) => s.id === brokerSupId)?.name ?? "") : "";
      return [
        c.containerNumber,
        c.supplierName || "",
        brokerName,
        c.origin || "",
        c.totalKg || "",
        c.ratePerKg || "",
        c.currencyCode || "USD",
        c.fxRateToUsd || "1",
        c.fxRateSource || "auto",
        c.arrivalDate || "",
        c.status,
        c.notes || "",
        c.commissionAmount || "",
        c.commissionCurrencyCode || "USD",
        c.commissionNotes || "",
        c.freight || "",
        c.freightCurrencyCode || "USD",
        c.otherCharges || "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    // Column widths
    ws["!cols"] = [20,20,20,12,10,10,8,8,8,12,12,30,12,10,30,12,10,12].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Containers");
    await XLSX.writeFile(wb, `factory_containers_export_${new Date().toLocaleDateString('en-CA')}.xlsx`);
  };

  const downloadTemplate = async () => {
    const XLSX = await import("@/lib/excelHelper");

    // Sheet 1: Template with sample data
    const headers = [
      "Container Number", "Supplier", "Origin", "Total Kg", "Rate/Kg",
      "Currency", "FX Rate", "FX Source", "Arrival Date", "Status", "Notes",
      "Commission Amount", "Commission Currency",
    ];
    const sample1 = ["CNTR-2024-001", "ABC Trading Co", "Australia", 20000, 0.50, "AUD", "", "AUTO", "2024-06-01", "PENDING", "First container", 1000, "USD"];
    const sample2 = ["CNTR-2024-002", "XYZ Suppliers", "China", 15000, 1.20, "USD", "1", "MANUAL", "2024-06-15", "IN_TRANSIT", "Second container - manual FX", "", "USD"];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample1, sample2]);
    ws["!cols"] = [18,18,12,10,10,8,8,8,12,12,25,14,14].map(w => ({ wch: w }));

    // Sheet 2: Instructions
    const instructions = [
      ["FACTORY CONTAINERS IMPORT — INSTRUCTIONS"],
      [""],
      ["HOW TO USE THIS TEMPLATE"],
      ["1. Fill in the 'Containers' sheet with your data. Do NOT change column headers."],
      ["2. Each row = one container. Container Number is required; all other fields are optional."],
      ["3. Save as .xlsx and upload via the Import Excel button in Factory Containers."],
      ["4. When re-importing, status is forced to PENDING regardless of what you enter."],
      [""],
      ["COLUMN GUIDE"],
      ["Column", "Required", "Example", "Notes"],
      ["Container Number", "YES", "CNTR-2024-001", "Must be unique"],
      ["Supplier", "No", "ABC Trading Co", "Exact name match or new supplier created automatically"],
      ["Origin", "No", "Australia", "Country or city of origin"],
      ["Total Kg", "No", "20000", "Total weight in kg"],
      ["Rate/Kg", "No", "0.50", "Price per kg in the chosen currency"],
      ["Currency", "No", "AUD", "USD / EUR / AUD / LBP / GBP (default: USD)"],
      ["FX Rate", "No", "1.55", "Leave blank for auto (fetched from FX API)"],
      ["FX Source", "No", "AUTO", "AUTO or MANUAL (default: AUTO)"],
      ["Arrival Date", "No", "2024-06-01", "YYYY-MM-DD format"],
      ["Status", "No", "PENDING", "PENDING / IN_TRANSIT / AVAILABLE / OFFLOADED"],
      ["Notes", "No", "Any text", "Free-form notes"],
      ["Commission Amount", "No", "1000", "Commission charged to broker, in commission currency"],
      ["Commission Currency", "No", "USD", "Currency of the commission amount (default: USD)"],
      [""],
      ["TIPS FOR RE-IMPORTING AFTER BULK DELETE"],
      ["• Export your containers first using the 'Export All' button — this gives you the exact data."],
      ["• Delete the containers using 'Select All → Delete Selected' — this removes ALL linked data."],
      ["• Then import the exported file. Containers come back as PENDING with all financial details intact."],
      ["• After importing, re-do offloads manually for containers that had been processed."],
      [""],
      ["VALID CURRENCIES: USD, EUR, AUD, LBP, GBP, XOF, XAF, CFA"],
      ["VALID STATUSES: PENDING, IN_TRANSIT, AVAILABLE, OFFLOADED"],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr["!cols"] = [40, 12, 20, 50].map(w => ({ wch: w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Containers");
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");
    await XLSX.writeFile(wb, "factory_containers_template.xlsx");
  };

  const resetForm = () => {
    setFormData({
      containerNumber: "",
      supplierId: "",
      origin: "",
      totalKg: "",
      ratePerKg: "",
      arrivalDate: "",
      notes: "",
      status: "PENDING",
      commissionAmount: "",
      commissionCurrencyCode: "USD",
      commissionAccountId: "",
      commissionSupplierId: "",
      commissionNotes: "",
      freight: "",
      freightCurrencyCode: "USD",
      freightAccountId: "",
      otherCharges: "",
      otherChargesAccountId: "",
    });
    setOtherChargeLines([]);
    setCurrency("USD");
    setFxRate("1");
    setFxRateSource("auto");
    setFxEffectiveDate("");
  };

  const openEdit = (c: ContainerWithSupplier) => {
    setEditingContainer(c);
    setFormData({
      containerNumber: c.containerNumber,
      supplierId: c.supplierId?.toString() || "",
      origin: c.origin || "",
      totalKg: c.totalKg || "",
      ratePerKg: c.ratePerKg || "",
      arrivalDate: c.arrivalDate || "",
      notes: c.notes || "",
      status: c.status,
      commissionAmount: (c as any).commissionAmount || "",
      commissionCurrencyCode: (c as any).commissionCurrencyCode || "USD",
      commissionAccountId: (c as any).commissionAccountId ? String((c as any).commissionAccountId) : "",
      commissionSupplierId: (c as any).commissionSupplierId ? String((c as any).commissionSupplierId) : "",
      commissionNotes: (c as any).commissionNotes || "",
      freight: (c as any).freight || "",
      freightCurrencyCode: (c as any).freightCurrencyCode || "USD",
      freightAccountId: (c as any).freightAccountId ? String((c as any).freightAccountId) : "",
      otherCharges: (c as any).otherCharges || "",
      otherChargesAccountId: (c as any).otherChargesAccountId ? String((c as any).otherChargesAccountId) : "",
    });
    setCurrency((c as any).currencyCode || "USD");
    setFxRate((c as any).fxRateToUsd || "1");
    setFxRateSource((c as any).fxRateSource || "auto");
    setFxEffectiveDate((c as any).fxRateDateImport || "");
  };

  const handleSubmit = () => {
    if (editingContainer) {
      wrapAdminAction(
        () => updateMutation.mutate({ id: editingContainer.id, data: formData }),
        "Update Container",
      );
    } else {
      createMutation.mutate(formData);
    }
  };

  const activeSuppliers = suppliers?.filter((s) => s.isActive) ?? [];

  // Suppliers filtered by selected broker
  const brokerIdNum = formData.commissionSupplierId ? parseInt(formData.commissionSupplierId) : null;
  const filteredSupplierList = brokerIdNum
    ? activeSuppliers.filter(s => s.parentId === brokerIdNum || !s.parentId)
    : activeSuppliers;

  // Selected supplier for mismatch detection
  const selectedSupplier = formData.supplierId
    ? activeSuppliers.find(s => s.id === parseInt(formData.supplierId)) ?? null
    : null;

  const brokerMismatch =
    selectedSupplier?.parentId &&
    formData.commissionSupplierId &&
    selectedSupplier.parentId !== parseInt(formData.commissionSupplierId);

  const filteredContainers = containers?.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchesNumber = c.containerNumber?.toLowerCase().includes(q);
      const matchesSupplier = c.supplierName?.toLowerCase().includes(q);
      const matchesOrigin = c.origin?.toLowerCase().includes(q);
      if (!matchesNumber && !matchesSupplier && !matchesOrigin) return false;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Factory Containers" subtitle="Track incoming containers (separate from ERP containers)" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected ({selectedIds.size})
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-import-export-menu">
                <ArrowDown className="h-4 w-4 mr-2" />
                Import / Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportContainers(containers || [])} data-testid="button-export-containers">
                <Download className="h-4 w-4 mr-2" />
                Export All
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setImportOpen(true); setImportPreview([]); setImportResult(null); }}
                data-testid="button-import-containers"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => navigate("/factory/containers/new")}
            data-testid="button-add-factory-container"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Container
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Container className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">
                Containers ({filteredContainers?.length || 0}{filteredContainers?.length !== containers?.length ? ` of ${containers?.length}` : ""})
              </CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search containers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-containers"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredContainers && filteredContainers.length > 0 ? (() => {
            // Group containers by supplier name
            const groups: { supplierKey: string; supplierName: string; containers: typeof filteredContainers }[] = [];
            const seenKeys = new Map<string, number>();
            for (const c of filteredContainers) {
              const key = c.supplierName || "__none__";
              if (!seenKeys.has(key)) {
                seenKeys.set(key, groups.length);
                groups.push({ supplierKey: key, supplierName: c.supplierName || "No Supplier", containers: [] });
              }
              groups[seenKeys.get(key)!].containers.push(c);
            }
            const toggleSupplier = (key: string) => {
              setExpandedSuppliers(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            };
            // Helper: render charge breakdown for a container using actual currencies
            const renderCharges = (c: any) => {
              const ccy = c.currencyCode || "USD";
              const freightAmt = parseFloat(c.freight || "0");
              const freightCcy = c.freightCurrencyCode || ccy;
              const freightSameCcy = freightCcy === ccy;
              const legacyOtherAmt = parseFloat(c.otherCharges || "0");
              const additionalAmt = parseFloat(c.additionalChargesSum || "0");
              // Parse per-currency other charges (actual currencies, not converted)
              let chargesByCcy: { currencyCode: string; amount: number }[] = [];
              try {
                const raw = typeof c.preRegisteredChargesByCurrency === "string"
                  ? JSON.parse(c.preRegisteredChargesByCurrency)
                  : (c.preRegisteredChargesByCurrency || []);
                chargesByCcy = Array.isArray(raw)
                  ? raw.map((x: any) => ({ currencyCode: x.currencyCode || "USD", amount: parseFloat(x.amount || "0") }))
                  : [];
              } catch {}
              const hasCharges = freightAmt > 0 || legacyOtherAmt > 0 || chargesByCcy.some(x => x.amount > 0) || additionalAmt > 0;
              if (!hasCharges) return <span className="text-muted-foreground">—</span>;
              // Build display lines grouped by currency
              const ccyTotals = new Map<string, number>();
              if (freightSameCcy && freightAmt > 0) ccyTotals.set(freightCcy, (ccyTotals.get(freightCcy) || 0) + freightAmt);
              if (legacyOtherAmt > 0) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + legacyOtherAmt);
              for (const ch of chargesByCcy) {
                if (ch.amount > 0) ccyTotals.set(ch.currencyCode, (ccyTotals.get(ch.currencyCode) || 0) + ch.amount);
              }
              if (additionalAmt > 0) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + additionalAmt);
              return (
                <div className="space-y-0.5">
                  <div className="font-mono text-sm">
                    {Array.from(ccyTotals.entries()).map(([cc, amt]) => (
                      <div key={cc}>{cc} {formatNumber(amt)}</div>
                    ))}
                    {!freightSameCcy && freightAmt > 0 && (
                      <div>{freightCcy} {formatNumber(freightAmt)}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0">
                    {freightAmt > 0 && <div>Freight: {freightCcy} {formatNumber(freightAmt)}</div>}
                    {(legacyOtherAmt > 0 || chargesByCcy.some(x => x.amount > 0)) && (
                      <div>
                        Other:{" "}
                        {(() => {
                          const parts: string[] = [];
                          if (legacyOtherAmt > 0) parts.push(`${ccy} ${formatNumber(legacyOtherAmt)}`);
                          for (const ch of chargesByCcy) {
                            if (ch.amount > 0) parts.push(`${ch.currencyCode} ${formatNumber(ch.amount)}`);
                          }
                          return parts.join(" + ");
                        })()}
                      </div>
                    )}
                    {additionalAmt > 0 && <div>Additional: {ccy} {formatNumber(additionalAmt)}</div>}
                  </div>
                </div>
              );
            };
            return (
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredContainers.length > 0 && filteredContainers.every(c => selectedIds.has(c.id))}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedIds(new Set(filteredContainers.map(c => c.id)));
                          else setSelectedIds(new Set());
                        }}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Container #</TableHead>
                    <TableHead>Broker</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead>Total Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(({ supplierKey, supplierName, containers: groupContainers }) => {
                    const isExpanded = expandedSuppliers.has(supplierKey);
                    // Compute aggregate count and container count
                    const count = groupContainers.length;
                    // Aggregate total values by currency
                    const groupTotals = new Map<string, number>();
                    for (const c of groupContainers) {
                      const ccy = (c as any).currencyCode || "USD";
                      const baseValue = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
                      const freightAmt = parseFloat((c as any).freight || "0");
                      const freightCcy = (c as any).freightCurrencyCode || ccy;
                      const freightSameCcy = freightCcy === ccy;
                      const legacyOtherAmt = parseFloat((c as any).otherCharges || "0");
                      const preRegisteredAmt = parseFloat((c as any).preRegisteredChargesSum || "0");
                      const additionalAmt = parseFloat((c as any).additionalChargesSum || "0");
                      const totalInCcy = baseValue + (freightSameCcy ? freightAmt : 0) + legacyOtherAmt + preRegisteredAmt + additionalAmt;
                      groupTotals.set(ccy, (groupTotals.get(ccy) || 0) + totalInCcy);
                    }
                    return [
                      // Supplier header row
                      <TableRow
                        key={`supplier-${supplierKey}`}
                        className="bg-muted/30 hover-elevate cursor-pointer"
                        onClick={() => toggleSupplier(supplierKey)}
                        data-testid={`row-supplier-group-${supplierKey}`}
                      >
                        <TableCell className="w-10">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell colSpan={3}>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{supplierName}</span>
                            <Badge variant="outline" className="text-xs">{count} container{count !== 1 ? "s" : ""}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">
                          {Array.from(groupTotals.entries()).map(([cc, amt]) => (
                            <div key={cc}>{cc} {formatNumber(amt)}</div>
                          ))}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>,
                      // Container rows (only when expanded)
                      ...(isExpanded ? groupContainers.map((c) => {
                        const commAmt = parseFloat((c as any).commissionAmount || "0");
                        const commCcy = (c as any).commissionCurrencyCode || "USD";
                        const brokerSupId = (c as any).commissionSupplierId;
                        const brokerName = brokerSupId
                          ? suppliers?.find(s => s.id === brokerSupId)?.name ?? null
                          : null;
                        const ccy = (c as any).currencyCode || "USD";
                        const baseValue = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
                        const freightAmt = parseFloat((c as any).freight || "0");
                        const freightCcy = (c as any).freightCurrencyCode || ccy;
                        const freightSameCcy = freightCcy === ccy;
                        const legacyOtherAmt = parseFloat((c as any).otherCharges || "0");
                        const preRegisteredAmt = parseFloat((c as any).preRegisteredChargesSum || "0");
                        const additionalAmt = parseFloat((c as any).additionalChargesSum || "0");
                        const totalValue = baseValue + (freightSameCcy ? freightAmt : 0) + legacyOtherAmt + preRegisteredAmt + additionalAmt;
                        return (
                          <TableRow key={c.id} data-testid={`row-factory-container-${c.id}`} className={selectedIds.has(c.id) ? "bg-muted/50" : ""}>
                            <TableCell className="w-10 pl-6">
                              <Checkbox
                                checked={selectedIds.has(c.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (checked) next.add(c.id);
                                    else next.delete(c.id);
                                    return next;
                                  });
                                }}
                                data-testid={`checkbox-container-${c.id}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium font-mono">
                              <button
                                className="hover:underline text-left cursor-pointer text-foreground"
                                onClick={() => setViewContainer(c)}
                                data-testid={`button-view-container-${c.id}`}
                              >
                                {c.containerNumber}
                              </button>
                            </TableCell>
                            <TableCell>
                              {brokerName
                                ? <span className="text-sm text-muted-foreground">{brokerName}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {commAmt > 0 ? `${commCcy} ${formatNumber(commAmt)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono text-sm font-medium">
                              {totalValue > 0 ? `${ccy} ${formatNumber(totalValue)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.status === "AVAILABLE" ? "default" : "secondary"}>
                                {c.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {c.status !== "OFFLOADED" && c.status !== "PARTIALLY_RECEIVED" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={() => navigate("/factory/raw-stock")} data-testid={`button-offload-container-${c.id}`}>
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Offload to Production</TooltipContent>
                                  </Tooltip>
                                )}
                                {(c.status === "OFFLOADED" || c.status === "PARTIALLY_RECEIVED") && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={() => setReversingContainer(c)} data-testid={`button-reverse-offload-${c.id}`}>
                                        <RotateCcw className="h-4 w-4 text-amber-500" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Reverse Offload</TooltipContent>
                                  </Tooltip>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => openEdit(c)} data-testid={`button-edit-container-${c.id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setPendingDeleteId(c.id)} data-testid={`button-delete-container-${c.id}`}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }) : []),
                    ];
                  })}
                </TableBody>
              </Table>
            );
          })() : (
            <div className="text-center py-8 text-muted-foreground">
              <Container className="h-12 w-12 mx-auto mb-3 opacity-50" />
              {containers && containers.length > 0 ? (
                <>
                  <p className="text-lg font-medium">No matching containers</p>
                  <p className="text-sm mt-1">Try adjusting your search or filter</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">No factory containers yet</p>
                  <p className="text-sm mt-1">Add your first container to start tracking arrivals</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen || !!editingContainer} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingContainer(null); resetForm(); }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingContainer ? "Edit Container" : "Add Factory Container"}</DialogTitle>
            <DialogDescription>
              {editingContainer ? "Update container details" : "Track a new incoming factory container"}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-y-auto space-y-6 pr-1">
            {/* ── Section 1: Basic ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Basic</p>
                <Separator className="flex-1" />
              </div>
              <div>
                <Label>Container Number *</Label>
                <Input
                  value={formData.containerNumber}
                  onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value })}
                  placeholder="e.g., CNTR-2024-001"
                  data-testid="input-container-number"
                />
              </div>
              <div>
                <Label>Origin</Label>
                <Input
                  value={formData.origin}
                  onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                  placeholder="Country/city of origin"
                  data-testid="input-container-origin"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Arrival Date</Label>
                  <Input
                    type="date"
                    value={formData.arrivalDate}
                    onChange={(e) => setFormData({ ...formData, arrivalDate: e.target.value })}
                    data-testid="input-container-arrival"
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
                    <SelectTrigger data-testid="select-container-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                      <SelectItem value="AVAILABLE">Available</SelectItem>
                      <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes"
                  data-testid="input-container-notes"
                />
              </div>
            </div>

            {/* ── Section 2: Supplier & Broker ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Supplier &amp; Broker</p>
                <Separator className="flex-1" />
              </div>

              {/* Broker first so supplier list can filter */}
              <div>
                <Label>Broker / Commission To <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <Select
                  value={formData.commissionSupplierId || "__none__"}
                  onValueChange={(val) => {
                    const newBroker = val === "__none__" ? "" : val;
                    setFormData(f => ({
                      ...f,
                      commissionSupplierId: newBroker,
                      // If current supplier doesn't belong to new broker, clear it
                      supplierId: (() => {
                        if (!newBroker || !f.supplierId) return f.supplierId;
                        const sup = activeSuppliers.find(s => s.id === parseInt(f.supplierId));
                        if (sup?.parentId && sup.parentId !== parseInt(newBroker)) return "";
                        return f.supplierId;
                      })(),
                    }));
                  }}
                >
                  <SelectTrigger data-testid="select-container-broker">
                    <SelectValue placeholder="Select broker..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {activeSuppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Purchase Supplier</Label>
                <Select
                  value={formData.supplierId || "__none__"}
                  onValueChange={(val) => setFormData({ ...formData, supplierId: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-container-supplier">
                    <SelectValue placeholder="Select supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {filteredSupplierList.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                        {s.parentId ? " (linked)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.commissionSupplierId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Showing suppliers linked to broker + standalone suppliers
                  </p>
                )}
              </div>

              {/* Auto-linked helper */}
              {selectedSupplier?.parentId && !brokerMismatch && formData.commissionSupplierId && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Linked to Broker:{" "}
                  <span className="font-medium text-foreground">
                    {activeSuppliers.find(s => s.id === selectedSupplier.parentId)?.name ?? `#${selectedSupplier.parentId}`}
                  </span>
                </div>
              )}

              {/* Mismatch warning */}
              {brokerMismatch && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    This supplier belongs to <strong>{activeSuppliers.find(s => s.id === selectedSupplier?.parentId)?.name ?? `Broker #${selectedSupplier?.parentId}`}</strong>, not the selected broker. Please fix the mismatch before saving.
                  </span>
                </div>
              )}
            </div>

            {/* ── Section 3: Money & Commission ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Money &amp; Commission</p>
                <Separator className="flex-1" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Total Kg</Label>
                  <Input
                    type="number"
                    value={formData.totalKg}
                    onChange={(e) => setFormData({ ...formData, totalKg: e.target.value })}
                    placeholder="0.000"
                    data-testid="input-container-total-kg"
                  />
                </div>
                <div>
                  <Label>Rate per Kg</Label>
                  <Input
                    type="number"
                    value={formData.ratePerKg}
                    onChange={(e) => setFormData({ ...formData, ratePerKg: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-container-rate"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={(val) => setCurrency(val)}>
                    <SelectTrigger data-testid="select-container-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>FX Rate {currency !== "USD" ? (fxRateSource === "auto" ? `(Auto${fxEffectiveDate ? ` — ${fxEffectiveDate}` : ""})` : "(Manual)") : ""}</Label>
                    {currency !== "USD" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => setFxRateSource(fxRateSource === "auto" ? "manual" : "auto")}
                        data-testid="button-toggle-fx-source"
                      >
                        {fxRateSource === "auto" ? "Switch to Manual" : "Switch to Auto"}
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    disabled={currency === "USD" || fxRateSource === "auto"}
                    readOnly={currency !== "USD" && fxRateSource === "auto"}
                    placeholder="1"
                    data-testid="input-container-fx-rate"
                  />
                </div>
              </div>

              {currency !== "USD" && fxRate && parseFloat(fxRate) > 0 && (
                <div className="text-sm text-muted-foreground">
                  1 {currency} = {formatNumber(parseFloat(fxRate))} USD
                  &nbsp;&nbsp;·&nbsp;&nbsp;
                  1 USD = {formatNumber(1 / parseFloat(fxRate))} {currency}
                  {formData.ratePerKg && (
                    <span> &nbsp;&nbsp;·&nbsp;&nbsp; Rate/Kg ≈ {formatNumber(parseFloat(formData.ratePerKg) * parseFloat(fxRate))} USD</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Commission Amount</Label>
                  <Input
                    type="number"
                    value={formData.commissionAmount}
                    onChange={(e) => setFormData({ ...formData, commissionAmount: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-container-commission"
                  />
                </div>
                <div>
                  <Label>Commission Currency</Label>
                  <Select
                    value={formData.commissionCurrencyCode}
                    onValueChange={(val) => setFormData({ ...formData, commissionCurrencyCode: val })}
                  >
                    <SelectTrigger data-testid="select-commission-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Commission Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <Input
                  value={formData.commissionNotes}
                  onChange={(e) => setFormData({ ...formData, commissionNotes: e.target.value })}
                  placeholder="e.g. Commission for container facilitation"
                  data-testid="input-commission-notes"
                />
              </div>

              <div>
                <Label>ERP Commission Account <span className="text-muted-foreground text-xs font-normal">(optional — for ERP bookkeeping only)</span></Label>
                <Select
                  value={formData.commissionAccountId || "__none__"}
                  onValueChange={(val) => setFormData({ ...formData, commissionAccountId: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-commission-account">
                    <SelectValue placeholder="None (leave empty)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {ledgerAccounts.map((acc: any) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name}{acc.code ? ` (${acc.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Commission flows into the broker's balance automatically via the "Broker / Commission To" field above.
                </p>
              </div>
            </div>

            {/* ── Section 4: Freight & Other Charges ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Freight &amp; Other Charges</p>
                <Separator className="flex-1" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Freight Amount <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Input
                    type="number"
                    value={formData.freight}
                    onChange={(e) => setFormData({ ...formData, freight: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-container-freight"
                  />
                </div>
                <div>
                  <Label>Freight Currency</Label>
                  <Select
                    value={formData.freightCurrencyCode}
                    onValueChange={(val) => setFormData({ ...formData, freightCurrencyCode: val })}
                  >
                    <SelectTrigger data-testid="select-freight-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Freight Account <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Select
                    value={formData.freightAccountId || "__none__"}
                    onValueChange={(val) => setFormData({ ...formData, freightAccountId: val === "__none__" ? "" : val })}
                  >
                    <SelectTrigger data-testid="select-freight-account">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {ledgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name}{acc.code ? ` (${acc.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Other Charges <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setOtherChargeLines(prev => [...prev, { amount: "", currencyCode: currency, ledgerAccountId: "" }])}
                    data-testid="button-add-other-charge"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Line
                  </Button>
                </div>
                {otherChargeLines.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">No other charges. Click "Add Line" to add one.</p>
                )}
                {otherChargeLines.length > 0 && (
                  <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-x-2 gap-y-1 items-center">
                    <div className="text-xs text-muted-foreground font-medium">Amount</div>
                    <div className="text-xs text-muted-foreground font-medium">CCY</div>
                    <div className="text-xs text-muted-foreground font-medium">Account</div>
                    <div />
                    {otherChargeLines.map((line, idx) => (
                      <>
                        <Input
                          key={`amt-${idx}`}
                          type="number"
                          value={line.amount}
                          onChange={(e) => updateOtherChargeLine(idx, "amount", e.target.value)}
                          placeholder="0.00"
                          data-testid={`input-other-charge-amount-${idx}`}
                        />
                        <Select
                          key={`ccy-${idx}`}
                          value={line.currencyCode || currency}
                          onValueChange={(val) => updateOtherChargeLine(idx, "currencyCode", val)}
                        >
                          <SelectTrigger className="w-20" data-testid={`select-other-charge-currency-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="AUD">AUD</SelectItem>
                            <SelectItem value="LBP">LBP</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          key={`acc-${idx}`}
                          value={line.ledgerAccountId || "__none__"}
                          onValueChange={(val) => updateOtherChargeLine(idx, "ledgerAccountId", val === "__none__" ? "" : val)}
                        >
                          <SelectTrigger data-testid={`select-other-charge-account-${idx}`}>
                            <SelectValue placeholder="No account" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No account</SelectItem>
                            {ledgerAccounts.map((acc: any) => (
                              <SelectItem key={acc.id} value={String(acc.id)}>
                                {acc.name}{acc.code ? ` (${acc.code})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          key={`del-${idx}`}
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeOtherChargeLine(idx)}
                          data-testid={`button-remove-other-charge-${idx}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ))}
                  </div>
                )}
                {otherChargeLines.length > 0 && (
                  <div className="text-xs text-muted-foreground text-right pt-1 space-y-0.5">
                    {(() => {
                      const totals: Record<string, number> = {};
                      for (const l of otherChargeLines) {
                        const cc = l.currencyCode || currency;
                        const v = parseFloat(l.amount || "0");
                        if (v > 0) totals[cc] = (totals[cc] || 0) + v;
                      }
                      return Object.entries(totals).map(([cc, amt]) => (
                        <div key={cc}>Additional {cc} {formatNumber(amt)}</div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingContainer(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !formData.containerNumber ||
                !!brokerMismatch ||
                createMutation.isPending ||
                updateMutation.isPending
              }
              data-testid="button-save-container"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingContainer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) { setImportOpen(false); setImportPreview([]); setImportResult(null); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Containers from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx) to bulk-import containers. New suppliers will be created automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-download-template">
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <div className="text-sm text-muted-foreground">
                Expected columns: Container Number, Supplier, Origin, Total Kg, Rate/Kg, Currency, FX Rate (optional), FX Source (AUTO/MANUAL), Arrival Date, Status, Notes
              </div>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground cursor-pointer"
                data-testid="input-import-file"
              />
            </div>

            {importPreview.length > 0 && !importResult && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium">{importPreview.length} rows ready to import</p>
                  <Button
                    onClick={() => importMutation.mutate(importPreview)}
                    disabled={importMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    {importMutation.isPending ? "Importing..." : `Import ${importPreview.length} Containers`}
                  </Button>
                </div>
                <div className="border rounded-md overflow-auto max-h-64">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Container #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">Rate/Kg</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.map((row, i) => (
                        <TableRow key={i} data-testid={`row-import-preview-${i}`}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono font-medium">{row.containerNumber}</TableCell>
                          <TableCell>{row.supplierName || "-"}</TableCell>
                          <TableCell>{row.origin || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{row.totalKg || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{row.ratePerKg || "-"}</TableCell>
                          <TableCell>{row.currencyCode}</TableCell>
                          <TableCell><Badge variant="secondary">{row.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="font-medium">
                    {importResult.imported} of {importResult.total} containers imported successfully
                  </p>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="border border-destructive/30 rounded-md p-3 space-y-1">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      {importResult.errors.length} error(s):
                    </p>
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-sm text-muted-foreground">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportPreview([]); setImportResult(null); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete {selectedIds.size} Container{selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This action is <strong>permanent and cannot be undone</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 text-sm text-muted-foreground">
            <p>For each selected container, all of the following will be permanently removed:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Daybook / journal entries</li>
              <li>Vouchers and accounting entries</li>
              <li>FX allocation records</li>
              <li>Mix batch source links</li>
              <li>Offload charges (additional and pre-registered)</li>
              <li>Commission records</li>
              <li>Raw stock entries</li>
            </ul>
            <p className="text-destructive font-medium pt-1">Tip: Export All first if you need a backup.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => wrapAdminAction(() => bulkDeleteMutation.mutate(Array.from(selectedIds)), "Bulk Delete Containers")}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selectedIds.size} Container${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Container Delete Confirmation */}
      <Dialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Container?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the container and all its linked records — accounting entries, vouchers, FX allocations, mix batch links, offload charges, and raw stock. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDeleteId(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => wrapAdminAction(() => { if (pendingDeleteId !== null) deleteMutation.mutate(pendingDeleteId); }, "Delete Container")}
              data-testid="button-confirm-delete-container"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Container"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Container Detail Dialog */}
      <Dialog open={!!viewContainer} onOpenChange={(open) => { if (!open) setViewContainer(null); }}>
        <DialogContent className="max-w-lg">
          {viewContainer && (() => {
            const vc = viewContainer as any;
            const ccy = vc.currencyCode || "USD";
            const totalKg = parseFloat(vc.totalKg || "0");
            const ratePerKg = parseFloat(vc.ratePerKg || "0");
            const baseValue = totalKg * ratePerKg;
            const freightAmt = parseFloat(vc.freight || "0");
            const freightCcy = vc.freightCurrencyCode || ccy;
            const commAmt = parseFloat(vc.commissionAmount || "0");
            const commCcy = vc.commissionCurrencyCode || "USD";
            const brokerSupId = vc.commissionSupplierId;
            const brokerName = brokerSupId ? suppliers?.find(s => s.id === brokerSupId)?.name ?? null : null;
            const freightAccName = vc.freightAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.freightAccountId)?.name ?? `Account #${vc.freightAccountId}`
              : null;
            const commAccName = vc.commissionAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.commissionAccountId)?.name ?? `Account #${vc.commissionAccountId}`
              : null;
            const legacyOtherAmt = parseFloat(vc.otherCharges || "0");
            const legacyOtherAccName = vc.otherChargesAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.otherChargesAccountId)?.name ?? `Account #${vc.otherChargesAccountId}`
              : null;
            const fxRate = parseFloat(vc.fxRateToUsd || "1");
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 font-mono">
                    <Container className="h-5 w-5" />
                    {viewContainer.containerNumber}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-2 pt-1">
                    <Badge variant={viewContainer.status === "AVAILABLE" ? "default" : "secondary"}>{viewContainer.status}</Badge>
                    {viewContainer.supplierName && <span className="text-muted-foreground">{viewContainer.supplierName}</span>}
                    {viewContainer.arrivalDate && <span className="text-muted-foreground">· Arrived {viewContainer.arrivalDate}</span>}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {/* Base Value */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goods</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Weight</span>
                      <span className="font-mono text-right">{formatNumber(totalKg)} kg</span>
                      <span className="text-muted-foreground">Rate</span>
                      <span className="font-mono text-right">{ccy} {formatNumber(ratePerKg)} / kg</span>
                      {ccy !== "USD" && fxRate !== 1 && (
                        <>
                          <span className="text-muted-foreground">FX Rate</span>
                          <span className="font-mono text-right">1 {ccy} = {fxRate} USD</span>
                        </>
                      )}
                      <span className="text-muted-foreground font-medium">Base Value</span>
                      <span className="font-mono font-semibold text-right">{ccy} {formatNumber(baseValue)}</span>
                    </div>
                  </div>
                  <Separator />
                  {/* Freight */}
                  {freightAmt > 0 && (
                    <>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freight</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="font-mono text-right">{freightCcy} {formatNumber(freightAmt)}</span>
                          {freightAccName && (
                            <>
                              <span className="text-muted-foreground">Account</span>
                              <span className="text-right truncate">{freightAccName}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}
                  {/* Other Charges */}
                  {(legacyOtherAmt > 0 || viewContainerCharges.length > 0) && (
                    <>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Other Charges</p>
                        <div className="space-y-2">
                          {legacyOtherAmt > 0 && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                              <span className="text-muted-foreground">Other Charges (legacy)</span>
                              <span className="font-mono text-right">{ccy} {formatNumber(legacyOtherAmt)}</span>
                              {legacyOtherAccName && (
                                <>
                                  <span className="text-muted-foreground">Account</span>
                                  <span className="text-right truncate">{legacyOtherAccName}</span>
                                </>
                              )}
                            </div>
                          )}
                          {viewContainerCharges.map((ch: any) => {
                            const accName = ch.ledgerAccountId
                              ? ledgerAccounts.find((a: any) => a.id === ch.ledgerAccountId)?.name ?? `Account #${ch.ledgerAccountId}`
                              : null;
                            return (
                              <div key={ch.id} className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                <span className="text-muted-foreground">{ch.description || "Charge"}</span>
                                <span className="font-mono text-right">{ch.currencyCode || ccy} {formatNumber(parseFloat(ch.amount || "0"))}</span>
                                {accName && (
                                  <>
                                    <span className="text-muted-foreground pl-3">↳ Account</span>
                                    <span className="text-right truncate text-xs text-muted-foreground">{accName}</span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}
                  {/* Commission */}
                  {commAmt > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-mono text-right">{commCcy} {formatNumber(commAmt)}</span>
                        {brokerName && (
                          <>
                            <span className="text-muted-foreground">Broker</span>
                            <span className="text-right">{brokerName}</span>
                          </>
                        )}
                        {commAccName && (
                          <>
                            <span className="text-muted-foreground">Account</span>
                            <span className="text-right truncate">{commAccName}</span>
                          </>
                        )}
                        {vc.commissionNotes && (
                          <>
                            <span className="text-muted-foreground">Notes</span>
                            <span className="text-right">{vc.commissionNotes}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setViewContainer(null)}>Close</Button>
                  <Button variant="ghost" onClick={() => { setViewContainer(null); openEdit(viewContainer); }}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Reverse Offload Confirmation */}
      <Dialog open={!!reversingContainer} onOpenChange={(open) => { if (!open) setReversingContainer(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse Offload</DialogTitle>
            <DialogDescription>
              This will permanently undo the offload for container <strong>{reversingContainer?.containerNumber}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 text-sm text-muted-foreground">
            <p>The following offload data will be permanently removed:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Raw stock entry from Raw Production</li>
              <li>Commission record and daybook entry</li>
              <li>Freight, other charges, and additional charge entries (fields cleared to zero)</li>
              <li>Duty amount and status (reset to NONE)</li>
              <li>Mix-batch source allocations linked to this container</li>
              <li>All accounting journal vouchers (freight, other charges, commission)</li>
              <li>All related daybook entries (OFFLOAD_RAW_STOCK, FREIGHT, OTHER_CHARGE, DUTY, COMMISSION)</li>
            </ul>
            <p className="text-foreground font-medium pt-1">
              The container returns to <strong>RECEIVED</strong> status. Supplier import voucher and any payments made are <em>not</em> removed.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReversingContainer(null)} data-testid="button-cancel-reverse-offload">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => wrapAdminAction(() => reversingContainer && reverseOffloadMutation.mutate(reversingContainer.id), "Reverse Offload")}
              disabled={reverseOffloadMutation.isPending}
              data-testid="button-confirm-reverse-offload"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {reverseOffloadMutation.isPending ? "Reversing..." : "Reverse Offload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </div>
  );
}
