import { useState, useEffect } from "react";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  Plus, Pencil, Trash2, Users, Phone, Mail, MapPin,
  FileText, Package, Weight, Calendar, ArrowLeft,
  ChevronRight, ChevronDown, Clock, X, GitBranch, DollarSign, ArrowRightLeft, BookOpen, Building2, Link2, Globe, MoreVertical, Layers, AlertTriangle, Info, Eye, TrendingUp,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { enqueueRequest } from "@/lib/offlineQueue";
import { cacheBulkFxData, getCachedBulkFxData, computeBulkFxPreview } from "@/lib/bulkFxOffline";
import type { FactorySupplier } from "@shared/schema";

interface CurrencyBalance {
  currencyCode: string;
  balance: number;
}

interface CurrencyGroup {
  currencyCode: string;
  containers: StatementEntry[];
  totalKg: string;
  totalValue: string;
  totalCommission: string;
  remainingCommission: string;
  totalDirectCommission: string;
  netPayable: string;
  totalOwed: string;
}

interface SupplierWithBalance extends FactorySupplier {
  totalContainers: number;
  totalKg: string;
  totalValue: string;
  pendingContainers: number;
  receivedContainers: number;
  lastContainerDate: string | null;
  currencyBalances?: CurrencyBalance[];
  totalCommissionUsd?: string;
  approxFxRate?: string | null;
  /** Broker-only: per-linked-supplier exposure (informational, NOT broker-owned) */
  linkedSupplierExposure?: Array<{
    supplierId: number;
    supplierName: string;
    currencyBalances: CurrencyBalance[];
  }>;
  /** Broker-only: aggregated exposure totals across all linked suppliers */
  exposureCurrencyBalances?: CurrencyBalance[];
}


interface StatementEntry {
  id: number;
  containerNumber: string;
  date: string;
  origin: string | null;
  status: string;
  declaredKg: string | null;
  actualReceivedKg: string | null;
  totalKg: string | null;
  ratePerKg: string | null;
  differenceKg: string | null;
  value: string;
  finalPayableAmount: string | null;
  commissions: any[];
  totalCommission: string;
  notes: string | null;
}

interface ObCommission {
  rawStockId: number;
  containerId: number;
  containerNumber: string;
  date: string;
  personName: string;
  amount: string;
  currencyCode: string;
  fxRateToUsd: string;
  amountUsd: string;
  ledgerAccountId: number | null;
}

interface SupplierPayment {
  id: number;
  supplierId: number;
  date: string;
  amount: string;
  currencyCode: string;
  fxRateToUsd: string;
  amountUsd: string;
  paidFromAccountId: number | null;
  notes: string | null;
}

interface FxTransfer {
  id: number;
  fromSupplierId: number;
  toSupplierId: number;
  fromSupplierName?: string;
  toSupplierName?: string;
  date: string;
  fromCurrencyCode: string;
  fromAmount: string;
  fxRateToUsd: string;
  toAmountUsd: string;
  notes: string | null;
  sourceType: string | null;
  containerRefs?: Array<{ containerNumber: string; allocatedAmount: string }>;
}

interface StatementResponse {
  supplier: FactorySupplier;
  statement: StatementEntry[];
  currencyGroups: CurrencyGroup[];
  obCommissions: ObCommission[];
  payments: SupplierPayment[];
  fxTransfers: FxTransfer[];
  linkedSupplierGroups: Array<{
    supplierId: number;
    supplierName: string;
    containerCount: number;
    lastActivity: string | null;
    currencyGroups: Array<{
      currencyCode: string;
      containers: any[];
      totalValue: string;
      totalCommission: string;
      totalPaid: string;
      netPayable: string;
      containerCount: number;
    }>;
  }>;
  summary: {
    totalContainers: number;
    totalKg: string;
    totalValue: string;
    totalCommissions: string;
    totalDirectCommissions: string;
    totalObCommissions: string;
    totalPayments: string;
    netPayable: string;
    totalOwed: string;
  };
}

export default function FactorySuppliers() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { formatDisplayDate } = useDateFormat();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<FactorySupplier | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<number | null>(null);
  const [statementReturnToParent, setStatementReturnToParent] = useState(false);
  const [parentViewSupplierId, setParentViewSupplierId] = useState<number | null>(null);
  useEscapeBack(
    statementSupplierId
      ? () => { setStatementSupplierId(null); setStatementReturnToParent(false); }
      : parentViewSupplierId
      ? () => setParentViewSupplierId(null)
      : null
  );
  const [showInactive, setShowInactive] = useState(false);
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<number>>(new Set());
  const [createSubAccountParentId, setCreateSubAccountParentId] = useState<number | null>(null);
  type SupplierFilter = "all" | "brokers" | "standalone" | "with-balance" | "zero-balance" | "has-foreign" | "has-recent";
  const [activeFilter, setActiveFilter] = useState<SupplierFilter>("all");
  const [formData, setFormData] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    parentId: null as number | null,
  });
  // "role" in create form: "broker" | "standalone" | "linked"
  const [formRole, setFormRole] = useState<"broker" | "standalone" | "linked">("standalone");
  const { toast } = useToast();

  const { data: suppliers, isLoading } = useQuery<SupplierWithBalance[]>({
    queryKey: ["/api/factory/suppliers/with-balances"],
  });

  const { data: statementData, isLoading: statementLoading, isError: statementError } = useQuery<StatementResponse>({
    queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", `/api/factory/suppliers/${statementSupplierId}/statement`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to load statement" }));
        throw new Error(err.message || "Failed to load statement");
      }
      return res.json();
    },
    enabled: !!statementSupplierId,
    retry: 1,
  });

  const [collapsedStmtSections, setCollapsedStmtSections] = useState<Set<string>>(new Set(["supplierDetails", "currencyPools"]));
  const toggleStmtSection = (key: string) =>
    setCollapsedStmtSections(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Broker overview pool balances query (fires when viewing broker overview page)
  const { data: brokerOverviewStatement, isLoading: brokerOverviewLoading } = useQuery<any>({
    queryKey: ["/api/factory/suppliers", parentViewSupplierId, "broker-statement"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", `/api/factory/suppliers/${parentViewSupplierId}/broker-statement`);
      if (!res.ok) throw new Error("Failed to load broker overview");
      return res.json();
    },
    enabled: !!parentViewSupplierId && !statementSupplierId,
    staleTime: 30000,
  });

  // Broker consolidated statement query (fires when viewing a broker's own statement)
  const isBrokerStatement = !!(statementData?.linkedSupplierGroups?.length);
  const { data: brokerStatement, isLoading: brokerStatementLoading } = useQuery<any>({
    queryKey: ["/api/factory/suppliers", statementSupplierId, "broker-statement"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", `/api/factory/suppliers/${statementSupplierId}/broker-statement`);
      if (!res.ok) throw new Error("Failed to load broker statement");
      return res.json();
    },
    enabled: !!statementSupplierId && isBrokerStatement,
  });

  // Payment state
  const today = new Date().toLocaleDateString('en-CA');
  const [paymentDialogSupplier, setPaymentDialogSupplier] = useState<SupplierWithBalance | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    supplierId: 0,
    date: today,
    amount: "",
    currencyCode: "USD",
    fxRateToUsd: "1",
    paidFromAccountId: "",
    notes: "",
  });

  const { data: ledgerAccounts } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  // FX Transfer state (internal settlement: linked supplier foreign currency → broker USD bucket)
  const [fxConversionOpen, setFxConversionOpen] = useState(false);
  type FxSourceType = "supplier" | "commission" | "both";
  const [fxSourceType, setFxSourceType] = useState<FxSourceType>("supplier");
  const [obEditSupplier, setObEditSupplier] = useState<{ id: number; name: string; currentBalance: string } | null>(null);
  const [obEditValue, setObEditValue] = useState("");
  const [fxConversionForm, setFxConversionForm] = useState({
    fromSupplierId: 0,
    toSupplierId: 0,
    selectedCurrency: "",
    amount: "",
    availableBalance: "",     // shown in dialog — recalculated on source type change
    supplierBalance: "",      // netPayable (supplier net after commission)
    commissionBalance: "",    // totalCommission for this currency
    fxRateToUsd: "",
    date: today,
    notes: "",
  });

  // Bulk FX Settlement state (broker-level: settle all linked suppliers in one go)
  const [bulkFxOpen, setBulkFxOpen] = useState(false);
  const [bulkFxBrokerId, setBulkFxBrokerId] = useState<number | null>(null);
  const [bulkFxBrokerName, setBulkFxBrokerName] = useState("");
  const [bulkFxForm, setBulkFxForm] = useState({
    fromCurrencyCode: "EUR",
    totalAmount: "",
    fxRateToUsd: "",
    date: today,
    notes: "",
    order: "oldest" as "oldest" | "newest",
  });

  useEffect(() => {
    if (!bulkFxOpen || !bulkFxBrokerId || !navigator.onLine) return;
    factoryApiRequest("GET", `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-prefetch?currency=${bulkFxForm.fromCurrencyCode}`)
      .then(r => r.json())
      .then((data: { suppliers: any[] }) => {
        if (data?.suppliers) cacheBulkFxData(bulkFxBrokerId, bulkFxForm.fromCurrencyCode, data.suppliers);
      })
      .catch(() => {});
  }, [bulkFxOpen, bulkFxBrokerId, bulkFxForm.fromCurrencyCode]);
  type BulkFxPreview = {
    transfers: Array<{ supplierId: number; supplierName: string; allocated: string; toAmountUsd: string }>;
    totalAllocated: string;
    totalUsd: string;
    remaining: string;
  };
  const [bulkFxPreview, setBulkFxPreview] = useState<null | BulkFxPreview>(null);

  const openBulkFxDialog = (brokerId: number, brokerName: string) => {
    setBulkFxBrokerId(brokerId);
    setBulkFxBrokerName(brokerName);
    setBulkFxForm({ fromCurrencyCode: "EUR", totalAmount: "", fxRateToUsd: "", date: today, notes: "", order: "oldest" });
    setBulkFxPreview(null);
    setBulkFxOpen(true);
  };

  const bulkFxPreviewMutation = useMutation({
    mutationFn: async () => {
      if (!bulkFxBrokerId) throw new Error("No broker selected");
      const res = await factoryApiRequest("POST", `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-settlement`, {
        fromCurrencyCode: bulkFxForm.fromCurrencyCode,
        totalAmount: bulkFxForm.totalAmount,
        fxRateToUsd: bulkFxForm.fxRateToUsd,
        date: bulkFxForm.date,
        notes: bulkFxForm.notes || null,
        order: bulkFxForm.order,
        dryRun: true,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Preview failed"); }
      return res.json() as Promise<BulkFxPreview>;
    },
    onSuccess: (data) => {
      setBulkFxPreview(data);
      if (bulkFxBrokerId && data?.transfers) {
        cacheBulkFxData(bulkFxBrokerId, bulkFxForm.fromCurrencyCode,
          data.transfers.map((t: any) => ({
            id: t.supplierId, name: t.supplierName,
            available: parseFloat(t.allocated),
            oldestDate: null, newestDate: null,
          }))
        ).catch(() => {});
      }
    },
    onError: async (err: Error) => {
      if (err?._handledGlobally) return;
      if (!navigator.onLine && bulkFxBrokerId) {
        const cached = await getCachedBulkFxData(bulkFxBrokerId, bulkFxForm.fromCurrencyCode);
        if (cached) {
          const result = computeBulkFxPreview(
            cached.suppliers,
            parseFloat(bulkFxForm.totalAmount) || 0,
            parseFloat(bulkFxForm.fxRateToUsd) || 0,
            bulkFxForm.order
          );
          if (result) {
            setBulkFxPreview(result as any);
            toast({ title: "Preview (offline)", description: "Using cached supplier balances — amounts may differ slightly if data changed since last sync." });
            return;
          }
        }
        toast({
          title: "Preview unavailable offline",
          description: "No cached data found. Enter your amounts and confirm to queue the settlement.",
        });
        return;
      }
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkFxMutation = useMutation({
    mutationFn: async () => {
      if (!bulkFxBrokerId) throw new Error("No broker selected");
      const res = await factoryApiRequest("POST", `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-settlement`, {
        fromCurrencyCode: bulkFxForm.fromCurrencyCode,
        totalAmount: bulkFxForm.totalAmount,
        fxRateToUsd: bulkFxForm.fxRateToUsd,
        date: bulkFxForm.date,
        notes: bulkFxForm.notes || null,
        order: bulkFxForm.order,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to record bulk settlement");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBulkFxOpen(false);
      setBulkFxPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "broker-statement"] });
      }
      if (bulkFxBrokerId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", bulkFxBrokerId, "statement"] });
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", bulkFxBrokerId, "broker-statement"] });
      }
      toast({ title: "Bulk FX Settlement recorded", description: `${data.transfers?.length} transfer(s) created, ${bulkFxForm.fromCurrencyCode} ${parseFloat(data.totalAllocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} settled` });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      if (!navigator.onLine && bulkFxBrokerId) {
        enqueueRequest(
          `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-settlement`,
          "POST",
          JSON.stringify({
            fromCurrencyCode: bulkFxForm.fromCurrencyCode,
            totalAmount: bulkFxForm.totalAmount,
            fxRateToUsd: bulkFxForm.fxRateToUsd,
            date: bulkFxForm.date,
            notes: bulkFxForm.notes || null,
            order: bulkFxForm.order,
          }),
          "Bulk FX Settlement"
        );
        setBulkFxOpen(false);
        setBulkFxPreview(null);
        toast({
          title: "Bulk FX Settlement queued",
          description: "Will be recorded automatically when back online.",
        });
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openFxConversionDialog = (fromSupplierId: number, toSupplierId: number, currencyCode: string, netPayable: string, totalCommission = "0") => {
    setFxConversionForm({
      fromSupplierId,
      toSupplierId,
      selectedCurrency: currencyCode,
      amount: netPayable,
      availableBalance: netPayable,
      supplierBalance: netPayable,
      commissionBalance: totalCommission,
      fxRateToUsd: "",
      date: today,
      notes: "",
    });
    setFxSourceType("supplier");
    setFxConversionOpen(true);
  };

  const fxConversionMutation = useMutation({
    mutationFn: async (data: typeof fxConversionForm) => {
      const fxRate = parseFloat(data.fxRateToUsd) || 0;
      const amt = parseFloat(data.amount) || 0;
      if (amt <= 0 || fxRate <= 0) throw new Error("Amount and rate must be greater than zero");
      if (!data.toSupplierId) throw new Error("No parent supplier found for this transfer");
      const toAmountUsd = amt / fxRate;
      const payload = {
        fromSupplierId: data.fromSupplierId,
        toSupplierId: data.toSupplierId,
        fromCurrencyCode: data.selectedCurrency,
        fromAmount: data.amount,
        fxRateToUsd: data.fxRateToUsd,
        toAmountUsd: toAmountUsd.toFixed(4),
        date: data.date,
        notes: data.notes || null,
        sourceType: (data as any).sourceType || "supplier",
      };
      const res = await factoryApiRequest("POST", "/api/factory/supplier-fx-transfers", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to record FX transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      }
      // Also invalidate parent statement if different
      if (fxConversionForm.toSupplierId && fxConversionForm.toSupplierId !== statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", fxConversionForm.toSupplierId, "statement"] });
      }
      const isSelfSettle = fxConversionForm.toSupplierId === fxConversionForm.fromSupplierId;
      toast({ title: "FX Transfer recorded", description: isSelfSettle ? `${fxConversionForm.selectedCurrency} balance settled to USD` : `${fxConversionForm.selectedCurrency} balance transferred to parent USD` });
      setFxConversionOpen(false);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: typeof paymentForm) => {
      const fxRate = parseFloat(data.fxRateToUsd) || 1;
      const amt = parseFloat(data.amount) || 0;
      const amountUsd = data.currencyCode === "USD" ? amt : amt / fxRate;
      const payload = {
        supplierId: data.supplierId,
        date: data.date,
        amount: data.amount,
        currencyCode: data.currencyCode,
        fxRateToUsd: data.fxRateToUsd,
        amountUsd: amountUsd.toFixed(4),
        paidFromAccountId: data.paidFromAccountId ? parseInt(data.paidFromAccountId) : null,
        notes: data.notes || null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/supplier-payments", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to record payment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      }
      toast({ title: "Payment recorded", description: "Supplier balance updated" });
      setPaymentDialogSupplier(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/supplier-payments/${id}`);
      if (!res.ok) throw new Error("Failed to delete payment");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      }
      toast({ title: "Payment deleted" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteObCommissionMutation = useMutation({
    mutationFn: async (rawStockId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/raw-stock/opening-balance/${rawStockId}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete OB commission"); }
    },
    onSuccess: () => {
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      }
      toast({ title: "OB commission deleted" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteFxTransferMutation = useMutation({
    mutationFn: async (transferId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/supplier-fx-transfers/${transferId}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to reverse FX settlement"); }
    },
    onSuccess: (_data, transferId) => {
      // Invalidate the current supplier's statement
      if (statementSupplierId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      }
      // Invalidate the parent broker's statement (if current is a child)
      if (statementData?.supplier?.parentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementData.supplier.parentId, "statement"] });
      }
      // Invalidate the supplier list so KPI cards (currency totals) refresh
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "FX settlement reversed" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [editObComm, setEditObComm] = useState<null | { rawStockId: number; amount: string; currencyCode: string; personName: string; notes: string }>(null);

  const updateObCommissionMutation = useMutation({
    mutationFn: async (data: { rawStockId: number; commissionAmount: string; commissionCurrencyCode: string; commissionPersonName: string; commissionNotes: string }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/raw-stock/opening-balance/${data.rawStockId}`, {
        commissionAmount: data.commissionAmount,
        commissionCurrencyCode: data.commissionCurrencyCode,
        commissionPersonName: data.commissionPersonName,
        commissionNotes: data.commissionNotes,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to update"); }
    },
    onSuccess: () => {
      if (statementSupplierId) queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"] });
      setEditObComm(null);
      toast({ title: "Commission updated" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openPaymentDialog = (sup: SupplierWithBalance) => {
    setPaymentDialogSupplier(sup);
    setPaymentForm({
      supplierId: sup.id,
      date: today,
      amount: "",
      currencyCode: "USD",
      fxRateToUsd: "1",
      paidFromAccountId: "",
      notes: "",
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await factoryApiRequest("POST", "/api/factory/suppliers", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      toast({ title: "Created", description: "Supplier added successfully" });
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
      const res = await factoryApiRequest("PATCH", `/api/factory/suppliers/${id}`, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      toast({ title: "Updated", description: "Supplier updated successfully" });
      resetForm();
      setEditingSupplier(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/suppliers/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      toast({ title: "Deleted", description: "Supplier deactivated" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/suppliers/${id}/permanent`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to permanently delete supplier");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      toast({ title: "Deleted", description: "Supplier permanently removed" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const obEditMutation = useMutation({
    mutationFn: async ({ id, openingBalance }: { id: number; openingBalance: string }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/suppliers/${id}/opening-balance`, { openingBalance });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update opening balance");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      setObEditSupplier(null);
      setObEditValue("");
      toast({ title: "Saved", description: "Opening balance updated." });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "", parentId: null });
    setCreateSubAccountParentId(null);
    setFormRole("standalone");
  };

  const openEdit = (s: FactorySupplier) => {
    setEditingSupplier(s);
    const pid = (s as any).parentId ?? null;
    const hasChildren = allSuppliers.some((c: any) => c.parentId === s.id);
    setFormRole(pid ? "linked" : hasChildren ? "broker" : "standalone");
    setFormData({
      name: s.name,
      contactPerson: s.contactPerson || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      notes: s.notes || "",
      parentId: pid,
    });
  };

  const openCreateSubAccount = (parentSupplier: SupplierWithBalance) => {
    resetForm();
    setFormData(prev => ({ ...prev, parentId: parentSupplier.id }));
    setCreateSubAccountParentId(parentSupplier.id);
    setFormRole("linked");
    setCreateOpen(true);
  };

  const toggleExpanded = (id: number) => {
    setExpandedSupplierIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const formatNum = (val: string | null | undefined) => {
    if (!val || val === "0" || val === "0.00" || val === "0.000") return "-";
    const n = parseFloat(val); return n.toLocaleString(undefined, { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  };

  const formatKg = (val: string | null | undefined) => {
    if (!val || val === "0" || val === "0.000") return "-";
    return parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 }) + " kg";
  };

  const formatDate = (val: string | null | undefined) => {
    if (!val) return "-";
    return formatDisplayDate(val);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "RECEIVED":
      case "OFFLOADED":
        return "default";
      case "PENDING":
        return "secondary";
      case "IN_TRANSIT":
        return "outline";
      case "PARTIALLY_RECEIVED":
        return "secondary";
      default:
        return "secondary";
    }
  };

  const allSuppliers = suppliers || [];
  const activeSuppliers = allSuppliers.filter((s) => s.isActive);
  const inactiveSuppliers = allSuppliers.filter((s) => !s.isActive);
  // Top-level: no parentId
  const topLevelSuppliers = allSuppliers.filter((s) => !(s as any).parentId);
  // Linked suppliers (have parentId) grouped by broker
  const subAccountsByParent: Record<number, SupplierWithBalance[]> = {};
  for (const s of allSuppliers) {
    const pid = (s as any).parentId;
    if (pid) {
      if (!subAccountsByParent[pid]) subAccountsByParent[pid] = [];
      subAccountsByParent[pid].push(s);
    }
  }

  // Determine broker vs standalone for each top-level
  const isBroker = (s: SupplierWithBalance) => !!(subAccountsByParent[s.id]?.length);
  const hasRecentActivity = (s: SupplierWithBalance) => {
    if (!s.lastContainerDate) return false;
    const days = (Date.now() - new Date(s.lastContainerDate).getTime()) / (1000 * 86400);
    return days <= 60;
  };
  const hasForeignCurrency = (s: SupplierWithBalance) =>
    !!(s.currencyBalances?.some((b) => b.currencyCode !== "USD" && b.balance > 0));

  // Apply filter
  const activeTopLevelBase = topLevelSuppliers.filter((s) => showInactive ? true : s.isActive);
  const displayedTopLevel = activeTopLevelBase.filter((s) => {
    switch (activeFilter) {
      case "brokers": return isBroker(s);
      case "standalone": return !isBroker(s);
      case "with-balance": return parseFloat(s.totalValue || "0") > 0;
      case "zero-balance": return parseFloat(s.totalValue || "0") <= 0;
      case "has-foreign": return hasForeignCurrency(s);
      case "has-recent": return hasRecentActivity(s);
      default: return true;
    }
  });

  // Due containers dialog
  const [dueDialogSupplier, setDueDialogSupplier] = useState<{ name: string; containers: any[] } | null>(null);

  const activeTopLevel = topLevelSuppliers.filter((s) => s.isActive);
  const brokerCount = activeTopLevel.filter(isBroker).length;
  const standaloneCount = activeTopLevel.filter((s) => !isBroker(s)).length;
  const totalContainers = activeTopLevel.reduce((sum, s) => sum + (s.totalContainers || 0), 0);

  // ── Broker Overview ──────────────────────────────────────────────────────
  if (parentViewSupplierId && !statementSupplierId) {
    const parentSup = allSuppliers.find(s => s.id === parentViewSupplierId);
    const children = subAccountsByParent[parentViewSupplierId] || [];

    // Pool balances from broker activity ledger (all currencies, net balance per currency section)
    const brokerOwnBalances: { currencyCode: string; balance: number; isBrokerPool: boolean }[] =
      (brokerOverviewStatement?.currencyLedgers || [])
        .map((section: any) => ({ currencyCode: section.currencyCode, balance: parseFloat(section.netBalance || "0"), isBrokerPool: !!section.isBrokerPool }))
        .filter((b: any) => Math.abs(b.balance) > 0.001);

    // Linked Supplier Exposure — from server's linkedSupplierExposure or children's own currencyBalances
    // Server returns exposureCurrencyBalances (aggregate) and linkedSupplierExposure (per-supplier)
    const exposureBalances: CurrencyBalance[] = parentSup?.exposureCurrencyBalances
      ?? (() => {
        const map: Record<string, number> = {};
        for (const child of children) {
          for (const b of (child.currencyBalances || [])) {
            if (b.balance > 0) map[b.currencyCode] = (map[b.currencyCode] || 0) + b.balance;
          }
        }
        return Object.entries(map).map(([currencyCode, balance]) => ({ currencyCode, balance }));
      })();
    const activeExposure = exposureBalances.filter(b => b.balance > 0.001)
      .sort((a, b) => a.currencyCode === "USD" ? 1 : -1);

    const openChildStatement = (childId: number) => {
      setStatementReturnToParent(true);
      setStatementSupplierId(childId);
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setParentViewSupplierId(null)}
            data-testid="button-back-from-parent-view"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-parent-supplier-name">
                {parentSup?.name || "Loading..."}
              </h1>
              <Badge variant="secondary" className="text-xs">
                <Building2 className="h-3 w-3 mr-1" />
                Broker
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {children.length} linked supplier{children.length !== 1 ? "s" : ""}
            </p>
          </div>
          {parentSup && import.meta.env.DEV && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openChildStatement(parentSup.id)}
              data-testid="button-parent-own-statement"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Broker Statement
            </Button>
          )}
        </div>

        {/* ── Broker KPIs ───────────────────────────────────────────── */}
        {parentSup && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Containers</div>
                <div className="text-2xl font-bold mt-1" data-testid="text-parent-total-containers">
                  {parentSup.totalContainers}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Linked Suppliers</div>
                <div className="text-2xl font-bold mt-1">
                  {children.length}
                </div>
              </CardContent>
            </Card>
            {brokerOverviewLoading ? (
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Pool Balance</div>
                  <div className="text-2xl font-bold mt-1 text-muted-foreground animate-pulse">—</div>
                </CardContent>
              </Card>
            ) : brokerOwnBalances.map((b) => (
              <Card key={b.currencyCode}>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">
                    {b.isBrokerPool ? "Pool Balance" : "Net Balance"} ({b.currencyCode})
                  </div>
                  <div
                    className={`text-2xl font-bold mt-1 tabular-nums ${b.balance > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                    data-testid={`text-pool-balance-${b.currencyCode}`}
                  >
                    {b.currencyCode === "USD" ? "$" : `${b.currencyCode} `}{formatNum(Math.abs(b.balance).toFixed(2))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {b.isBrokerPool
                      ? (b.balance > 0 ? "Received" : b.balance < 0 ? "Owed" : "Settled")
                      : (b.balance > 0 ? "Payable to suppliers" : b.balance < 0 ? "Overpaid" : "Settled")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Linked Suppliers list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Linked Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {children.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No linked suppliers yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {children.map(child => (
                  <div
                    key={child.id}
                    className="flex items-center justify-between gap-3 p-4"
                    data-testid={`row-child-supplier-${child.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <button
                          onClick={() => openChildStatement(child.id)}
                          className="font-semibold hover:underline text-left"
                          data-testid={`link-child-statement-${child.id}`}
                        >
                          {child.name}
                        </button>
                        {!child.isActive && (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Package className="h-3.5 w-3.5" />
                          {child.totalContainers} container{child.totalContainers !== 1 ? "s" : ""}
                        </span>
                        {child.pendingContainers > 0 && (
                          <span className="flex items-center gap-1 text-amber-500">
                            <Clock className="h-3.5 w-3.5" />
                            {child.pendingContainers} OTW
                          </span>
                        )}
                        {child.lastContainerDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            Last: {formatDate(child.lastContainerDate)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {child.isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openPaymentDialog(child)}
                          title="Record Payment"
                          data-testid={`button-pay-child-${child.id}`}
                        >
                          <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openChildStatement(child.id)}
                        data-testid={`button-view-child-statement-${child.id}`}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Statement View ────────────────────────────────────────────────────────
  if (statementSupplierId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setStatementSupplierId(null);
              if (statementReturnToParent) {
                setStatementReturnToParent(false);
                // parentViewSupplierId is already set — stay in parent view
              }
            }}
            data-testid="button-back-suppliers"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-statement-supplier-name">
                {statementData?.supplier?.name || allSuppliers.find(s => s.id === statementSupplierId)?.name || "Supplier Statement"}
              </h1>
              {statementData?.supplier?.parentId ? (
                <Badge variant="outline" className="text-xs">
                  <Link2 className="h-3 w-3 mr-1" />
                  Linked Supplier
                </Badge>
              ) : statementData?.supplier && !statementData.supplier.parentId && subAccountsByParent[statementData.supplier.id]?.length ? (
                <Badge variant="secondary" className="text-xs">
                  <Building2 className="h-3 w-3 mr-1" />
                  Broker
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">Settlement Statement</p>
          </div>
        </div>

        {statementLoading ? (
          <div className="space-y-4">
            <div className="text-center py-8 text-muted-foreground">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Loading statement...</p>
            </div>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : statementError ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">Could not load statement</p>
              <p className="text-sm mt-1">Please go back and try again</p>
            </CardContent>
          </Card>
        ) : statementData ? (
          <>
            {(() => {
              const activeSt = (statementData.statement || []).filter((c: any) => c.status !== "OFFLOADED");
              const activeContainerCount = activeSt.length;
              const activeKg = activeSt.reduce((sum: number, c: any) => sum + parseFloat(c.actualReceivedKg || c.totalKg || "0"), 0);
              const currencyGroups: any[] = statementData.currencyGroups || [];

              // Broker: aggregate linked supplier net balances by currency
              const linkedGroups: any[] = statementData.linkedSupplierGroups || [];
              const linkedBalMap: Record<string, number> = {};
              if (isBrokerStatement) {
                for (const lg of linkedGroups) {
                  for (const cg of (lg.currencyGroups || [])) {
                    const val = parseFloat(cg.netPayable || "0");
                    if (Math.abs(val) > 0.005) {
                      linkedBalMap[cg.currencyCode] = (linkedBalMap[cg.currencyCode] || 0) + val;
                    }
                  }
                }
              }

              // Own currency net balances
              const ownMap: Record<string, { own: number; totalFreight: number }> = {};
              for (const g of currencyGroups) {
                const cc = g.currencyCode;
                if (!ownMap[cc]) ownMap[cc] = { own: 0, totalFreight: 0 };
                ownMap[cc].own += parseFloat(g.netPayable || "0");
                ownMap[cc].totalFreight += parseFloat(g.totalFreight || "0");
              }

              // KPI entries for the "Broker Net Balance" primary section
              const ownKpiEntries = Object.entries(ownMap).filter(([, v]) => Math.abs(v.own) > 0.005);
              // KPI entries for "Linked Exposure" secondary section
              const linkedKpiEntries = Object.entries(linkedBalMap).filter(([, v]) => Math.abs(v) > 0.005);

              // Issues
              const issues: Array<{ kind: "warn" | "info"; msg: string }> = [];
              if (isBrokerStatement) {
                for (const lg of linkedGroups) {
                  for (const cg of (lg.currencyGroups || [])) {
                    const bal = parseFloat(cg.netPayable || "0");
                    if (bal > 0.005) {
                      const pfx = cg.currencyCode !== "USD" ? `${cg.currencyCode} ` : "$";
                      issues.push({ kind: "warn", msg: `${lg.supplierName}: ${pfx}${formatNum(String(bal.toFixed(2)))} unsettled` });
                    }
                  }
                }
              }
              for (const g of currencyGroups) {
                const bal = parseFloat(g.netPayable || "0");
                if (bal > 0.005) {
                  const cc = g.currencyCode;
                  const pfx = cc !== "USD" ? `${cc} ` : "$";
                  issues.push({ kind: "warn", msg: `Broker ${cc} pool: ${pfx}${formatNum(String(bal.toFixed(2)))} unsettled` });
                }
              }

              const renderBalCard = (cc: string, bal: number, label: string, testId: string, freight?: number) => {
                const isOverpaid = bal < -0.005;
                const isSettled = Math.abs(bal) <= 0.005;
                const ccPrefix = cc !== "USD" ? `${cc} ` : "$";
                return (
                  <Card key={`${testId}-${cc}`}>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground font-medium">{cc} {label}</div>
                      <div
                        className={`text-xl font-bold mt-1 tabular-nums ${isSettled ? "text-muted-foreground" : isOverpaid ? "text-green-600 dark:text-green-400" : ""}`}
                        data-testid={`${testId}-${cc}`}
                      >
                        {isSettled ? (
                          <>{ccPrefix}— <span className="text-sm font-normal">Settled</span></>
                        ) : isOverpaid ? (
                          <>{ccPrefix}{formatNum(String(Math.abs(bal).toFixed(2)))} <span className="text-sm font-normal">CR</span></>
                        ) : (
                          <>{ccPrefix}{formatNum(String(bal.toFixed(2)))}</>
                        )}
                      </div>
                      {freight && freight > 0.005 && (
                        <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                          incl. {ccPrefix}{formatNum(String(freight.toFixed(2)))} freight
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              };

              return (
                <>

                  {/* Non-broker: simple KPI grid */}
                  {!isBrokerStatement && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-xs text-muted-foreground">Active Containers</div>
                          <div className="text-xl font-bold mt-1" data-testid="text-statement-total-containers">
                            {activeContainerCount}
                            {statementData.summary.totalContainers > activeContainerCount && (
                              <span className="text-sm font-normal text-muted-foreground ml-1">/ {statementData.summary.totalContainers} total</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <div className="text-xs text-muted-foreground">Active Weight</div>
                          <div className="text-xl font-bold mt-1" data-testid="text-statement-total-kg">
                            {formatKg(String(activeKg.toFixed(3)))}
                          </div>
                        </CardContent>
                      </Card>
                      {Object.entries(ownMap).filter(([, v]) => Math.abs(v.own) > 0.005).length === 0 ? (
                        <Card>
                          <CardContent className="p-4">
                            <div className="text-xs text-muted-foreground">Net Balance</div>
                            <div className="text-xl font-bold mt-1 text-muted-foreground" data-testid="text-statement-total-owed">
                              $— <span className="text-sm font-normal">Settled</span>
                            </div>
                          </CardContent>
                        </Card>
                      ) : (
                        Object.entries(ownMap).filter(([, v]) => Math.abs(v.own) > 0.005).map(([cc, v]) =>
                          renderBalCard(cc, v.own, "Net Balance", "text-statement-balance", v.totalFreight)
                        )
                      )}
                    </div>
                  )}


                </>
              );
            })()}

            {statementData.supplier && !isBrokerStatement && (
              <Card>
                <CardHeader className="pb-2 cursor-pointer hover-elevate rounded-t-md" onClick={() => toggleStmtSection("supplierDetails")}>
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>Supplier Details</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsedStmtSections.has("supplierDetails") ? "" : "rotate-180"}`} />
                  </CardTitle>
                </CardHeader>
                {!collapsedStmtSections.has("supplierDetails") && <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    {statementData.supplier.contactPerson && (
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span>{statementData.supplier.contactPerson}</span>
                      </div>
                    )}
                    {statementData.supplier.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span>{statementData.supplier.phone}</span>
                      </div>
                    )}
                    {statementData.supplier.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span>{statementData.supplier.email}</span>
                      </div>
                    )}
                    {statementData.supplier.address && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span>{statementData.supplier.address}</span>
                      </div>
                    )}
                    {statementData.supplier.notes && (
                      <div className="flex items-start gap-2 sm:col-span-2">
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{statementData.supplier.notes}</span>
                      </div>
                    )}
                  </div>
                </CardContent>}
              </Card>
            )}

            {statementData.currencyGroups && (statementData.currencyGroups.length > 1 || (statementData.currencyGroups.length === 1 && statementData.currencyGroups[0].currencyCode !== "USD")) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className="flex items-center gap-2 cursor-pointer hover-elevate rounded px-1 py-0.5 flex-1"
                      onClick={() => toggleStmtSection("currencyPools")}
                    >
                      <Globe className="h-4 w-4" />
                      Currency Pools
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsedStmtSections.has("currencyPools") ? "" : "rotate-180"}`} />
                    </span>
                    {statementData.currencyGroups.some(g => g.currencyCode !== "USD" && (parseFloat(g.netPayable) > 0 || parseFloat(g.totalCommission) > 0)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const firstNonUsd = statementData.currencyGroups.find(g => g.currencyCode !== "USD" && (parseFloat(g.netPayable) > 0 || parseFloat(g.totalCommission) > 0));
                          if (firstNonUsd && statementSupplierId) {
                            const hasBalance = parseFloat(firstNonUsd.netPayable) > 0;
                            setFxSourceType(hasBalance ? "supplier" : "commission");
                            const toId = statementData.supplier.parentId || statementSupplierId;
                            openFxConversionDialog(statementSupplierId, toId, firstNonUsd.currencyCode, hasBalance ? firstNonUsd.netPayable : "0", firstNonUsd.totalCommission);
                          }
                        }}
                        data-testid="button-fx-convert"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                        {statementData.supplier.parentId ? "Settle FX to Broker" : "Settle FX to USD"}
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                {!collapsedStmtSections.has("currencyPools") && <CardContent className="p-0">
                  <div className="table-responsive">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead>Currency</TableHead>
                          <TableHead className="text-right">Containers</TableHead>
                          <TableHead className="text-right">Total Weight</TableHead>
                          <TableHead className="text-right">Gross Value</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead className="text-right">Net Payable</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.currencyGroups.map((group) => {
                          const hasFreight = parseFloat(group.totalFreight || "0") > 0.005;
                          const hasCommission = parseFloat(group.totalCommission) > 0.005;
                          const noContainers = group.containers.length === 0;
                          const isCommissionOnly = noContainers && hasCommission && !hasFreight;
                          const isFreightOnly = noContainers && hasFreight && !hasCommission;
                          const isCrossFreightPool = noContainers && hasFreight; // freight ± commission, no containers
                          const netPay = parseFloat(group.netPayable);
                          const isOverpaid = netPay < -0.005;
                          const ccPrefix = group.currencyCode !== "USD" ? `${group.currencyCode} ` : "$";
                          // Auto-settled: cross-currency freight already reflected in parent broker's pool
                          const autoSettledFreight = parseFloat((group as any).autoSettledFreight || "0");
                          const isAutoSettled = autoSettledFreight > 0.005 && Math.abs(netPay) <= 0.005;
                          return (
                          <TableRow key={group.currencyCode}>
                            <TableCell className="font-semibold">
                              <Badge variant="outline">{group.currencyCode}</Badge>
                              {isCommissionOnly && <span className="ml-2 text-xs text-muted-foreground">Commission</span>}
                              {isFreightOnly && !isAutoSettled && <span className="ml-2 text-xs text-muted-foreground">Freight</span>}
                              {isCrossFreightPool && hasCommission && !isAutoSettled && <span className="ml-2 text-xs text-muted-foreground">Freight + Commission</span>}
                              {isAutoSettled && <span className="ml-2 text-xs text-muted-foreground">Freight · In broker pool</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{isCrossFreightPool ? "—" : group.containers.length}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{isCrossFreightPool ? "—" : formatKg(group.totalKg)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-medium">
                              {isCrossFreightPool ? (() => {
                                const totalFreight = parseFloat(group.totalFreight || "0");
                                if (isAutoSettled) {
                                  return <span className="text-muted-foreground">{ccPrefix}{formatNum(String(totalFreight.toFixed(2)))}</span>;
                                }
                                const remComm = parseFloat(group.remainingCommission || group.totalCommission || "0");
                                const remainingFreight = Math.max(0, netPay - remComm);
                                const freightSettled = remainingFreight < totalFreight - 0.005;
                                return (
                                  <span className="text-orange-600 dark:text-orange-400">
                                    {freightSettled ? (
                                      <>
                                        {ccPrefix}{formatNum(String(remainingFreight.toFixed(2)))}
                                        <span className="text-xs text-muted-foreground ml-1 line-through">
                                          {formatNum(String(totalFreight.toFixed(2)))}
                                        </span>
                                      </>
                                    ) : (
                                      <>{ccPrefix}{formatNum(String(totalFreight.toFixed(2)))}</>
                                    )}
                                  </span>
                                );
                              })() : `${ccPrefix}${formatNum(group.totalValue)}`}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-destructive">
                              {parseFloat(group.totalCommission) > 0 ? (
                                <span>
                                  {ccPrefix}{formatNum(group.remainingCommission ?? group.totalCommission)}
                                  {group.remainingCommission != null && parseFloat(group.remainingCommission) < parseFloat(group.totalCommission) && (
                                    <span className="text-xs text-muted-foreground ml-1 line-through">
                                      {formatNum(group.totalCommission)}
                                    </span>
                                  )}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-bold">
                              {isAutoSettled ? (
                                <span className="text-muted-foreground text-sm font-normal">In broker pool</span>
                              ) : isOverpaid ? (
                                <span className="text-green-600 dark:text-green-400">{ccPrefix}{formatNum(String(Math.abs(netPay)))} CR</span>
                              ) : (
                                <>{ccPrefix}{formatNum(group.netPayable)}</>
                              )}
                              {!isAutoSettled && (group.currencyCode !== "USD" || isCommissionOnly || isCrossFreightPool) && (netPay > 0 || hasCommission) && statementData.supplier.parentId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="ml-2 h-6 px-2 text-xs"
                                  onClick={() => {
                                    const hasBalance = netPay > 0;
                                    const netPayStr = hasBalance ? group.netPayable : "0";
                                    let form: Record<string, any>;
                                    let sourceType: string;
                                    if (isCrossFreightPool) {
                                      // Freight (± commission) pool: full netPayable is the available balance
                                      form = {
                                        fromSupplierId: statementSupplierId!,
                                        toSupplierId: statementData.supplier.parentId!,
                                        selectedCurrency: group.currencyCode,
                                        amount: netPayStr,
                                        availableBalance: netPayStr,
                                        supplierBalance: netPayStr,
                                        commissionBalance: group.totalCommission,
                                        fxRateToUsd: group.currencyCode === "USD" ? "1" : "",
                                        date: today,
                                        notes: hasCommission ? "Freight + commission settlement" : "Freight settlement",
                                      };
                                      sourceType = hasCommission ? "both" : "supplier";
                                    } else {
                                      form = {
                                        fromSupplierId: statementSupplierId!,
                                        toSupplierId: statementData.supplier.parentId!,
                                        selectedCurrency: group.currencyCode,
                                        amount: group.totalCommission,
                                        availableBalance: group.totalCommission,
                                        supplierBalance: hasBalance ? group.netPayable : "0",
                                        commissionBalance: group.totalCommission,
                                        fxRateToUsd: group.currencyCode === "USD" ? "1" : "",
                                        date: today,
                                        notes: "",
                                      };
                                      sourceType = "commission";
                                    }
                                    setFxConversionForm(form);
                                    setFxSourceType(sourceType);
                                    setFxConversionOpen(true);
                                  }}
                                  data-testid={`button-convert-${group.currencyCode}`}
                                >
                                  {isFreightOnly ? "Settle Freight" : isCommissionOnly ? "Settle Commission" : isCrossFreightPool ? "Settle" : "Settle"}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>}
              </Card>
            )}

            {/* ── Broker Activity Ledger (consolidated) ── */}
            {isBrokerStatement && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className="flex items-center gap-2 cursor-pointer hover-elevate rounded px-1 py-0.5 flex-1"
                      onClick={() => toggleStmtSection("brokerActivityLedger")}
                    >
                      <BookOpen className="h-4 w-4" />
                      Broker Activity Ledger
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsedStmtSections.has("brokerActivityLedger") ? "" : "rotate-180"}`} />
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const url = `/api/factory/suppliers/${statementSupplierId}/broker-statement/export`;
                        window.open(url, "_blank");
                      }}
                      data-testid="button-export-broker-statement"
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      Export Excel
                    </Button>
                  </CardTitle>
                  {!collapsedStmtSections.has("brokerActivityLedger") && (
                    <p className="text-xs text-muted-foreground">
                      All transactions affecting the broker's own balance — containers, settlements, FX transfers received, and commissions.
                      Grouped by currency. Does not include linked supplier activity.
                    </p>
                  )}
                </CardHeader>
                {!collapsedStmtSections.has("brokerActivityLedger") && <CardContent className="space-y-6 pt-0">
                  {brokerStatementLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                  ) : brokerStatement?.currencyLedgers?.length > 0 ? (
                    brokerStatement.currencyLedgers.map((section: any) => {
                      const typeLabel: Record<string, string> = {
                        container: "Container", payment: "Payment",
                        fx_out: "FX Out", fx_in: "FX In", commission: "Commission", other_charge: "Other Charge",
                        freight: "Freight", opening_balance: "Opening Bal",
                      };
                      const typeBadgeVariant = (t: string): "outline"|"secondary"|"default"|"destructive" => {
                        if (t === "payment") return "secondary";
                        if (t === "fx_out" || t === "fx_in") return "default";
                        if (t === "commission") return "destructive";
                        return "outline";
                      };
                      const typeColor = (t: string) => {
                        if (t === "payment") return "text-green-600 dark:text-green-400";
                        if (t === "fx_out") return "text-amber-600 dark:text-amber-400";
                        if (t === "fx_in") return "text-blue-600 dark:text-blue-400";
                        if (t === "commission") return "text-destructive";
                        if (t === "other_charge") return "text-purple-600 dark:text-purple-400";
                        if (t === "freight") return "text-orange-600 dark:text-orange-400";
                        return "";
                      };
                      const ledgerKey = `ledger-${section.currencyCode}`;
                      const ledgerCollapsed = collapsedStmtSections.has(ledgerKey);
                      return (
                        <div key={section.currencyCode} className="space-y-2">
                          <button
                            className="flex items-center gap-2 w-full text-left hover-elevate rounded-md px-1 py-0.5"
                            onClick={() => toggleStmtSection(ledgerKey)}
                            data-testid={`button-ledger-toggle-${section.currencyCode}`}
                          >
                            <Badge variant={section.isBrokerPool ? "default" : "secondary"} className="text-sm px-3 py-1 font-bold">
                              {section.currencyCode}
                            </Badge>
                            {section.isBrokerPool ? (
                              <span className="text-xs text-muted-foreground flex-1">Broker USD Pool — received from FX settlements &amp; transfers</span>
                            ) : (
                              <span className="text-xs text-muted-foreground flex-1">
                                {section.totalContainers} container{section.totalContainers !== 1 ? "s" : ""}
                              </span>
                            )}
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0 ${ledgerCollapsed ? "" : "rotate-180"}`} />
                          </button>
                          {!ledgerCollapsed && <div className="table-responsive rounded-md border">
                            <Table>
                              <TableHeader className="sticky top-0 z-30 bg-background">
                                <TableRow className="bg-muted/50">
                                  <TableHead className="text-xs h-8">Date</TableHead>
                                  <TableHead className="text-xs h-8">Type</TableHead>
                                  <TableHead className="text-xs h-8">Description</TableHead>
                                  <TableHead className="text-xs h-8 text-right">Amount ({section.currencyCode})</TableHead>
                                  <TableHead className="text-xs h-8 text-right">{section.isBrokerPool ? "Pool Balance" : "Balance"}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {section.rows.map((row: any, idx: number) => {
                                  const balVal = row.runningBalance;
                                  const balPositive = balVal > 0;
                                  const balNegative = balVal < 0;
                                  const balColor = section.isBrokerPool
                                    ? (balPositive ? "text-green-600 dark:text-green-400" : balNegative ? "text-red-600 dark:text-red-400" : "text-muted-foreground")
                                    : (balPositive ? "text-red-600 dark:text-red-400" : balNegative ? "text-green-600 dark:text-green-400" : "text-muted-foreground");
                                  const balLabel = section.isBrokerPool
                                    ? (balPositive ? "Rcvd" : balNegative ? "Owed" : "")
                                    : (balPositive ? "CR" : balNegative ? "DR" : "");
                                  return (
                                  <TableRow key={`${row.ref}-${idx}`} className="text-xs">
                                    <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">
                                      {row.date ? formatDate(row.date) : "—"}
                                    </TableCell>
                                    <TableCell className="py-1.5">
                                      <Badge variant={typeBadgeVariant(row.type)} className="text-xs py-0 font-normal">
                                        {typeLabel[row.type] || row.type}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="py-1.5 max-w-[220px] truncate font-medium">
                                      {row.description}
                                    </TableCell>
                                    <TableCell className={`py-1.5 text-right tabular-nums font-medium ${typeColor(row.type)}`}>
                                      {row.amount < 0 ? "−" : ""}{section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(String(Math.abs(row.amount).toFixed(2)))}
                                    </TableCell>
                                    <TableCell className={`py-1.5 text-right tabular-nums font-medium text-xs ${balColor}`}>
                                      {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(String(Math.abs(balVal).toFixed(2)))}
                                      <span className="ml-1 opacity-70">{balLabel}</span>
                                    </TableCell>
                                  </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>}
                          {/* Section totals — always visible */}
                          <div className="flex justify-end">
                            <div className="text-xs space-y-0.5 text-right min-w-56 pr-1">
                              {!section.isBrokerPool && parseFloat(section.totalValue) > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>Gross Value</span>
                                  <span className="tabular-nums font-medium text-foreground">
                                    {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(section.totalValue)}
                                  </span>
                                </div>
                              )}
                              {parseFloat(section.totalOtherCharges || "0") > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>Other Charges</span>
                                  <span className="tabular-nums text-purple-600 dark:text-purple-400">
                                    {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(section.totalOtherCharges)}
                                  </span>
                                </div>
                              )}
                              {parseFloat(section.totalFreight || "0") > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>Freight</span>
                                  <span className="tabular-nums text-orange-600 dark:text-orange-400">
                                    {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(section.totalFreight)}
                                  </span>
                                </div>
                              )}
                              {parseFloat(section.totalPaid) > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>Paid</span>
                                  <span className="tabular-nums text-green-600 dark:text-green-400">
                                    − {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(section.totalPaid)}
                                  </span>
                                </div>
                              )}
                              {parseFloat(section.totalFxOut) > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>FX Out</span>
                                  <span className="tabular-nums text-amber-600 dark:text-amber-400">
                                    − {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(section.totalFxOut)}
                                  </span>
                                </div>
                              )}
                              {parseFloat(section.totalFxIn) > 0 && (
                                <div className="flex justify-between gap-6 text-muted-foreground">
                                  <span>FX In {section.isBrokerPool ? "(Received)" : ""}</span>
                                  <span className="tabular-nums text-blue-600 dark:text-blue-400">
                                    + ${formatNum(String(parseFloat(section.totalFxIn).toFixed(2)))}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between gap-6 border-t pt-1">
                                <span className="font-semibold">{section.isBrokerPool ? "Pool Balance" : "Net Balance"}</span>
                                {section.isBrokerPool ? (
                                  <span className={`tabular-nums font-bold ${parseFloat(section.netBalance) > 0 ? "text-green-600 dark:text-green-400" : parseFloat(section.netBalance) < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                                    ${formatNum(String(Math.abs(parseFloat(section.netBalance)).toFixed(2)))}
                                    <span className="ml-1 font-normal opacity-80">{parseFloat(section.netBalance) > 0 ? "Rcvd" : parseFloat(section.netBalance) < 0 ? "Owed" : ""}</span>
                                  </span>
                                ) : (
                                  <span className={`tabular-nums font-bold ${parseFloat(section.netBalance) > 0 ? "text-red-600 dark:text-red-400" : parseFloat(section.netBalance) < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                    {section.currencyCode !== "USD" ? `${section.currencyCode} ` : "$"}{formatNum(String(Math.abs(parseFloat(section.netBalance)).toFixed(2)))}
                                    <span className="ml-1 font-normal opacity-80">{parseFloat(section.netBalance) > 0 ? "CR" : parseFloat(section.netBalance) < 0 ? "DR" : ""}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">No data found for this broker.</p>
                  )}
                </CardContent>}
              </Card>
            )}

            {/* Unified Activity Ledger — Phase 4: merges Containers, Payments, FX Settlements, Commissions */}
            {!isBrokerStatement && <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span
                    className="flex items-center gap-2 cursor-pointer hover-elevate rounded px-1 py-0.5 flex-1"
                    onClick={() => toggleStmtSection("activityLedger")}
                  >
                    <Package className="h-4 w-4" />
                    Activity Ledger
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsedStmtSections.has("activityLedger") ? "" : "rotate-180"}`} />
                  </span>
                </CardTitle>
              </CardHeader>
              {!collapsedStmtSections.has("activityLedger") && <CardContent>
                {(() => {
                  type RowType = "purchase" | "payment" | "fx" | "commission" | "other_charge" | "freight";
                  const srcLabel: Record<string, string> = { supplier: "Balance", commission: "Commission", both: "Both" };

                  // Determine the supplier's primary currency from their containers
                  const stmts: any[] = statementData.statement || [];
                  const primaryCc = (() => {
                    if (stmts.length === 0) return "USD";
                    const counts: Record<string, number> = {};
                    for (const s of stmts) { const c = s.currencyCode || "USD"; counts[c] = (counts[c] || 0) + 1; }
                    const nonUsd = Object.entries(counts).filter(([c]) => c !== "USD").sort((a, b) => b[1] - a[1]);
                    return nonUsd.length > 0 ? nonUsd[0][0] : "USD";
                  })();

                  // Weighted-average FX rate (primary currency → USD) from container data
                  const avgFxRate = (() => {
                    const relevant = stmts.filter((s: any) => (s.currencyCode || "USD") === primaryCc && parseFloat(s.fxRateToUsd || "0") > 0);
                    if (relevant.length === 0) return 1;
                    const totalVal = relevant.reduce((s: number, r: any) => s + parseFloat(r.value || "0"), 0);
                    if (totalVal === 0) return parseFloat(relevant[0].fxRateToUsd || "1");
                    return relevant.reduce((s: number, r: any) => s + parseFloat(r.value || "0") * parseFloat(r.fxRateToUsd || "1"), 0) / totalVal;
                  })();

                  // Convert any amount in any currency to primary currency for running balance
                  const toNative = (amount: number, currencyCode: string, fxToUsd: number = 1): number => {
                    if (currencyCode === primaryCc) return amount;
                    const usd = currencyCode === "USD" ? amount : amount * fxToUsd;
                    return primaryCc === "USD" ? usd : usd / avgFxRate;
                  };

                  const allRows: Array<{
                    key: string; date: string | null; type: RowType;
                    ref: string; detail: string; amount: string; amountIsNeg: boolean;
                    status?: string; notes?: string | null; optional?: boolean; onDelete?: () => void; onEdit?: () => void;
                    nativeImpact: number;
                    rowCc: string; rowNativeAmt: number;
                  }> = [
                    ...stmts.flatMap((e: any) => {
                      const rawVal = parseFloat(e.value || "0");
                      const fxRate = parseFloat(e.fxRateToUsd || "1") || 1;
                      const cc = e.currencyCode || "USD";
                      const freightAmt = parseFloat(e.freight || "0");
                      const freightCc = e.freightCurrencyCode || cc;
                      const sameCcFreight = freightAmt > 0 && freightCc === cc;
                      // Goods-only value (server's `value` includes same-currency freight — subtract it for the purchase row)
                      const goodsVal = sameCcFreight ? rawVal - freightAmt : rawVal;
                      const dispGoodsAmt = cc !== "USD" ? `${cc} ${formatNum(String(goodsVal.toFixed(2)))}` : `$${formatNum(String(goodsVal.toFixed(2)))}`;
                      const commAmt = parseFloat((e as any).commissionAmount || "0");
                      const commCc = (e as any).commissionCurrencyCode || cc;
                      const purchaseRow = {
                        key: `c-${e.id}`,
                        date: e.date,
                        type: "purchase" as RowType,
                        ref: e.containerNumber,
                        detail: e.origin || "",
                        amount: dispGoodsAmt,
                        amountIsNeg: false,
                        status: e.status,
                        notes: e.notes || null,
                        nativeImpact: toNative(goodsVal, cc, fxRate),
                        rowCc: cc, rowNativeAmt: goodsVal,
                      };
                      const rows: typeof purchaseRow[] = [purchaseRow];
                      // Same-currency freight → separate Freight row in child's ledger
                      if (sameCcFreight) {
                        const dispFreightAmt = freightCc !== "USD" ? `${freightCc} ${formatNum(String(freightAmt.toFixed(2)))}` : `$${formatNum(String(freightAmt.toFixed(2)))}`;
                        rows.push({
                          key: `f-${e.id}`,
                          date: e.date,
                          type: "freight" as RowType,
                          ref: e.containerNumber,
                          detail: "",
                          amount: dispFreightAmt,
                          amountIsNeg: false,
                          status: undefined,
                          notes: null,
                          nativeImpact: toNative(freightAmt, freightCc, fxRate),
                          rowCc: freightCc, rowNativeAmt: freightAmt,
                        });
                      }
                      // Commission → its own row (attributable to the supplier's balance)
                      if (commAmt > 0) {
                        const dispCommAmt = commCc !== "USD" ? `${commCc} ${formatNum(String(commAmt.toFixed(2)))}` : `$${formatNum(String(commAmt.toFixed(2)))}`;
                        rows.push({
                          key: `comm-${e.id}`,
                          date: e.date,
                          type: "commission" as RowType,
                          ref: e.containerNumber,
                          detail: "",
                          amount: dispCommAmt,
                          amountIsNeg: false,
                          status: undefined,
                          notes: null,
                          nativeImpact: toNative(commAmt, commCc, fxRate),
                          rowCc: commCc, rowNativeAmt: commAmt,
                        });
                      }
                      return rows;
                    }),
                    ...(statementData.payments || []).map((p: any) => {
                      const cc = p.currencyCode || "USD";
                      const amt = parseFloat(p.amount || "0");
                      const fxRate = parseFloat(p.fxRateToUsd || "1") || 1;
                      const dispAmt = cc !== "USD" ? `${cc} ${formatNum(String(amt.toFixed(2)))}` : `$${formatNum(String(amt.toFixed(2)))}`;
                      return {
                        key: `p-${p.id}`,
                        date: p.date,
                        type: "payment" as RowType,
                        ref: "Payment",
                        detail: "",
                        amount: dispAmt,
                        amountIsNeg: false,
                        notes: p.notes,
                        onDelete: () => { wrapAdminAction(() => setPendingDelete(() => () => deletePaymentMutation.mutate(p.id)), "Delete Payment"); },
                        nativeImpact: -toNative(amt, cc, fxRate),
                        rowCc: cc, rowNativeAmt: -amt,
                      };
                    }),
                    ...(statementData.ledger || [])
                      .filter((e: any) => e.type === "payment" && typeof e.key === "string" && e.key.startsWith("vp-"))
                      .map((vp: any) => {
                        const rawAmt = String(vp.amount || "0").replace(/[^0-9.]/g, "");
                        const usdAmt = parseFloat(rawAmt) || 0;
                        const isOptional = !!vp.optional;
                        return {
                          key: vp.key,
                          date: vp.date,
                          type: "payment" as RowType,
                          ref: vp.ref || "Voucher Payment",
                          detail: vp.detail || "Payment Voucher",
                          amount: `$${formatNum(String(usdAmt))}`,
                          amountIsNeg: !isOptional,
                          optional: isOptional,
                          notes: vp.notes || null,
                          nativeImpact: isOptional ? 0 : -toNative(usdAmt, "USD"),
                          rowCc: "USD", rowNativeAmt: isOptional ? 0 : -usdAmt,
                        };
                      }),
                    ...(statementData.fxTransfers || []).map((t: any) => {
                      const isOut = t.fromSupplierId === statementSupplierId;
                      const isSelf = t.fromSupplierId === t.toSupplierId;
                      const counterparty = isOut ? (t.toSupplierName || "Broker") : (t.fromSupplierName || "Linked");
                      const fromAmt = parseFloat(t.fromAmount || "0");
                      const fromCc = t.fromCurrencyCode || "USD";
                      const toUsd = parseFloat(t.toAmountUsd || "0");
                      return {
                        key: `f-${t.id}`,
                        date: t.date,
                        type: "fx" as RowType,
                        ref: isSelf ? `FX Settlement` : (isOut ? `FX → ${counterparty}` : `FX ← ${counterparty}`),
                        detail: isOut
                          ? `${fromCc !== "USD" ? `${fromCc} ` : "$"}${formatNum(String(fromAmt))} → $${formatNum(String(toUsd.toFixed(2)))}${t.sourceType ? ` · ${srcLabel[t.sourceType] || t.sourceType}` : ""}`
                          : `+$${formatNum(String(toUsd.toFixed(2)))}`,
                        amount: isOut
                          ? `${fromCc !== "USD" ? `${fromCc} ` : "$"}${formatNum(String(fromAmt))}`
                          : `$${formatNum(String(toUsd.toFixed(2)))}`,
                        amountIsNeg: isOut,
                        notes: t.notes,
                        nativeImpact: isOut ? -toNative(fromAmt, fromCc, toUsd / (fromAmt || 1)) : 0,
                        rowCc: isOut ? fromCc : "USD", rowNativeAmt: isOut ? -fromAmt : toUsd,
                        onDelete: () => { wrapAdminAction(() => setPendingDelete(() => () => deleteFxTransferMutation.mutate(t.id)), "Delete FX Transfer"); },
                      };
                    }),
                    ...(statementData.offloadCharges || []).map((oc: any) => {
                      const cc = oc.currencyCode || "USD";
                      const amt = parseFloat(oc.amount || "0");
                      const fxRate = parseFloat(oc.fxRateToUsd || "1");
                      return {
                        key: `oac-${oc.id}`,
                        date: oc.createdAt ? new Date(oc.createdAt).toLocaleDateString('en-CA') : null,
                        type: "other_charge" as RowType,
                        ref: "Other Charge",
                        detail: oc.description || "",
                        amount: cc !== "USD" ? `${cc} ${formatNum(String(amt))}` : `$${formatNum(String(amt))}`,
                        amountIsNeg: false,
                        notes: null,
                        nativeImpact: toNative(amt, cc, fxRate),
                        rowCc: cc, rowNativeAmt: amt,
                      };
                    }),
                    ...(statementData.obCommissions || []).map((oc: any) => ({
                      key: `oc-${oc.rawStockId}`,
                      date: oc.date,
                      type: "commission" as RowType,
                      ref: oc.containerNumber,
                      detail: oc.personName || "",
                      amount: `${oc.currencyCode !== "USD" ? `${oc.currencyCode} ${formatNum(oc.amount)}` : `$${formatNum(oc.amount)}`}`,
                      amountIsNeg: true,
                      notes: null,
                      onEdit: () => setEditObComm({ rawStockId: oc.rawStockId, amount: oc.amount, currencyCode: oc.currencyCode, personName: oc.personName || "", notes: "" }),
                      onDelete: () => { wrapAdminAction(() => setPendingDelete(() => () => deleteObCommissionMutation.mutate(oc.rawStockId)), "Delete Commission"); },
                      nativeImpact: -toNative(parseFloat(oc.amount || "0"), oc.currencyCode || "USD"),
                      rowCc: oc.currencyCode || "USD", rowNativeAmt: -parseFloat(oc.amount || "0"),
                    })),
                  ].sort((a, b) => {
                    const da = a.date ? new Date(a.date).getTime() : 0;
                    const db = b.date ? new Date(b.date).getTime() : 0;
                    return db - da;
                  });

                  // Compute per-row running balance in each row's native currency (oldest → newest)
                  const balanceByKey: Record<string, { cc: string; bal: number }> = {};
                  const currencyRunning: Record<string, number> = {};
                  for (const r of [...allRows].reverse()) {
                    const cc = r.rowCc;
                    currencyRunning[cc] = (currencyRunning[cc] || 0) + r.rowNativeAmt;
                    balanceByKey[r.key] = { cc, bal: currencyRunning[cc] };
                  }
                  // Final per-currency totals (for summary rows at bottom)
                  const currencyTotals = { ...currencyRunning };

                  const typeBadge = (type: RowType) => {
                    if (type === "purchase") return <Badge variant="outline" className="text-xs font-normal">Purchase</Badge>;
                    if (type === "payment") return <Badge variant="secondary" className="text-xs font-normal">Payment</Badge>;
                    if (type === "fx") return <Badge className="text-xs font-normal bg-blue-500 dark:bg-blue-600">FX</Badge>;
                    if (type === "other_charge") return <Badge className="text-xs font-normal bg-purple-500 dark:bg-purple-700">Other Charge</Badge>;
                    if (type === "freight") return <Badge className="text-xs font-normal bg-orange-500 dark:bg-orange-600">Freight</Badge>;
                    if (type === "commission") return <Badge className="text-xs font-normal bg-indigo-500 dark:bg-indigo-600">Commission</Badge>;
                    return <Badge variant="outline" className="text-xs font-normal">{type}</Badge>;
                  };

                  if (allRows.length === 0) return (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-lg font-medium">No activity yet</p>
                    </div>
                  );

                  const fmtCcAmt = (cc: string, amt: number) =>
                    cc !== "USD" ? `${cc} ${formatNum(String(Math.abs(amt).toFixed(2)))}` : `$${formatNum(String(Math.abs(amt).toFixed(2)))}`;

                  return (
                    <div className="table-responsive">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead className="w-8" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allRows.map(row => {
                            const balEntry = balanceByKey[row.key];
                            const balCc = balEntry?.cc ?? row.rowCc;
                            const bal = balEntry?.bal ?? 0;
                            return (
                            <TableRow key={row.key} data-testid={row.type === "purchase" ? `row-statement-${row.key}` : undefined}>
                              <TableCell className="whitespace-nowrap text-sm">{formatDate(row.date || "")}</TableCell>
                              <TableCell>{typeBadge(row.type)}</TableCell>
                              <TableCell className="text-sm font-medium">
                                <span>{row.ref}</span>
                                {row.status && <Badge variant={statusColor(row.status)} className="text-xs ml-1">{row.status}</Badge>}
                              </TableCell>
                              <TableCell className={`text-right text-sm tabular-nums font-medium ${row.optional ? "text-muted-foreground line-through" : row.type === "payment" ? "text-green-600 dark:text-green-400" : row.type === "purchase" || row.type === "freight" || row.type === "commission" ? "text-red-600 dark:text-red-400" : row.amountIsNeg ? "text-destructive" : ""}`}>
                                {row.type !== "payment" && row.type !== "purchase" && row.type !== "freight" && row.type !== "commission" && row.amountIsNeg ? "−" : ""}{row.amount}
                                {!row.optional && (row.type === "purchase" || row.type === "freight" || row.type === "commission") && <span className="ml-1 text-xs font-normal opacity-70">CR</span>}
                                {!row.optional && row.type === "payment" && <span className="ml-1 text-xs font-normal opacity-70">DR</span>}
                                {row.optional && <span className="ml-1 text-xs font-normal opacity-70">(Optional)</span>}
                              </TableCell>
                              <TableCell className={`text-right text-sm tabular-nums font-medium ${bal > 0 ? "text-red-600 dark:text-red-400" : bal < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                {fmtCcAmt(balCc, bal)}{bal > 0 ? " CR" : bal < 0 ? " DR" : ""}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {row.onEdit && (
                                    <Button variant="ghost" size="icon" onClick={row.onEdit}>
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                  )}
                                  {row.onDelete && (
                                    <Button variant="ghost" size="icon" onClick={row.onDelete}>
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ); })}
                          {/* Currency totals summary rows */}
                          {Object.entries(currencyTotals).filter(([, v]) => v !== 0).map(([cc, total]) => (
                            <TableRow key={`total-${cc}`} className="border-t-2 bg-muted/30">
                              <TableCell colSpan={3} className="text-sm font-semibold text-muted-foreground">
                                {cc} Total
                              </TableCell>
                              <TableCell />
                              <TableCell className={`text-right text-sm tabular-nums font-bold ${total > 0 ? "text-red-600 dark:text-red-400" : total < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                {fmtCcAmt(cc, total)}{total > 0 ? " CR" : total < 0 ? " DR" : ""}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()}
              </CardContent>}
            </Card>}

          </>
        ) : null}

        {/* FX Settlement Dialog — internal settlement: linked supplier foreign currency → broker USD bucket */}
        <Dialog open={fxConversionOpen} onOpenChange={(open) => { if (!open) setFxConversionOpen(false); }}>
          <DialogContent className="max-w-md">
            {(() => {
              const isSelf = fxConversionForm.toSupplierId === fxConversionForm.fromSupplierId;
              return (
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    {fxConversionForm.selectedCurrency === "USD"
                      ? (parseFloat(fxConversionForm.commissionBalance || "0") > 0
                          ? (isSelf ? "Settle Commission to USD" : "Transfer Commission to Broker")
                          : (isSelf ? "Settle Freight to USD" : "Transfer Freight to Broker"))
                      : (isSelf ? `FX Settlement to USD` : "FX Settlement to Broker (USD)")}
                  </DialogTitle>
                  <DialogDescription>
                    {fxConversionForm.selectedCurrency === "USD"
                      ? parseFloat(fxConversionForm.commissionBalance || "0") > 0
                        ? (isSelf
                            ? "Direct USD settlement: records this commission as settled at 1:1. Not a voucher payment."
                            : "Direct USD transfer: moves this commission from the linked supplier to the broker's USD pool at 1:1 rate. Not a voucher payment.")
                        : (isSelf
                            ? "Direct USD settlement: records this freight obligation as settled at 1:1. Not a voucher payment."
                            : "Direct USD transfer: moves this freight obligation from the linked supplier to the broker's USD pool at 1:1 rate. Not a voucher payment.")
                      : (isSelf
                          ? "Internal settlement: converts this supplier's foreign currency balance to its USD equivalent. Not a voucher payment."
                          : "Internal settlement: converts this linked supplier's foreign currency balance into the broker's USD pool. Not a voucher payment.")}
                  </DialogDescription>
                </DialogHeader>
              );
            })()}
            <div className="space-y-4">
              {/* Source type selector */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Settlement Source</Label>
                <div className="flex gap-2">
                  {(["supplier", "commission", "both"] as const).map(t => {
                    const labels: Record<string, string> = { supplier: "Supplier Balance", commission: "Commission", both: "Both" };
                    const getAvail = (src: string) => {
                      const s = parseFloat(fxConversionForm.supplierBalance || "0");
                      const c = parseFloat(fxConversionForm.commissionBalance || "0");
                      if (src === "supplier") return s.toFixed(2);
                      if (src === "commission") return c.toFixed(2);
                      return (s + c).toFixed(2);
                    };
                    return (
                      <Button
                        key={t}
                        type="button"
                        variant={fxSourceType === t ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFxSourceType(t);
                          const newAvail = getAvail(t);
                          setFxConversionForm(prev => ({ ...prev, availableBalance: newAvail, amount: newAvail }));
                        }}
                        data-testid={`fx-source-${t}`}
                      >
                        {labels[t]}
                      </Button>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                  <span>Supplier net: <span className="font-medium text-foreground">{parseFloat(fxConversionForm.supplierBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxConversionForm.selectedCurrency}</span></span>
                  <span>Commission: <span className="font-medium text-foreground">{parseFloat(fxConversionForm.commissionBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxConversionForm.selectedCurrency}</span></span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
                <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium">{fxConversionForm.selectedCurrency} balance being settled</span>
              </div>

              <div>
                <Label>Amount ({fxConversionForm.selectedCurrency})</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={fxConversionForm.amount}
                  onChange={(e) => setFxConversionForm(prev => ({ ...prev, amount: e.target.value }))}
                  data-testid="input-fx-amount"
                />
                {(() => {
                  const avail = parseFloat(fxConversionForm.availableBalance || "0");
                  const entered = parseFloat(fxConversionForm.amount || "0");
                  const exceeds = entered > avail + 0.005;
                  const remaining = avail - entered;
                  return (
                    <p className="text-xs mt-1 text-muted-foreground">
                      Balance: {avail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxConversionForm.selectedCurrency}
                      {exceeds && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          — overpayment of {Math.abs(remaining).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxConversionForm.selectedCurrency} (remaining will show as CR)
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>

              {fxConversionForm.selectedCurrency === "USD" ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                  <span>Rate: <span className="font-medium text-foreground">1 USD = 1 USD</span> (direct transfer, no FX conversion)</span>
                </div>
              ) : (
                <div>
                  <Label>Exchange Rate (units of {fxConversionForm.selectedCurrency} per 1 USD)</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 0.91 for EUR (EUR per 1 USD)"
                    value={fxConversionForm.fxRateToUsd}
                    onChange={(e) => setFxConversionForm(prev => ({ ...prev, fxRateToUsd: e.target.value }))}
                    data-testid="input-fx-rate"
                  />
                  {fxConversionForm.amount && fxConversionForm.fxRateToUsd && parseFloat(fxConversionForm.fxRateToUsd) > 0 && parseFloat(fxConversionForm.amount) > 0 && (
                    <p className="text-sm font-medium mt-1.5 text-primary">
                      = ${(parseFloat(fxConversionForm.amount) / parseFloat(fxConversionForm.fxRateToUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  )}
                </div>
              )}

              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={fxConversionForm.date}
                  onChange={(e) => setFxConversionForm(prev => ({ ...prev, date: e.target.value }))}
                  data-testid="input-fx-date"
                />
              </div>

              <div>
                <Label>Notes</Label>
                <Input
                  placeholder="Conversion note"
                  value={fxConversionForm.notes}
                  onChange={(e) => setFxConversionForm(prev => ({ ...prev, notes: e.target.value }))}
                  data-testid="input-fx-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFxConversionOpen(false)}>Cancel</Button>
              <Button
                onClick={() => wrapAdminAction(() => {
                  fxConversionMutation.mutate({
                    ...fxConversionForm,
                    sourceType: fxSourceType,
                  } as any);
                }, "Record FX Conversion")}
                disabled={
                  !fxConversionForm.amount ||
                  !fxConversionForm.fxRateToUsd ||
                  parseFloat(fxConversionForm.amount) <= 0 ||
                  parseFloat(fxConversionForm.fxRateToUsd) <= 0 ||
                  fxConversionMutation.isPending
                }
                data-testid="button-submit-fx-conversion"
              >
                {fxConversionMutation.isPending ? "Recording..." : fxConversionForm.selectedCurrency === "USD" ? "Record Transfer" : "Record Settlement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation for FX transfers (must live inside this early-return block) */}
        <DeleteConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
          onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Overpayment computation for the payment dialog
  const _payFxR = parseFloat(paymentForm.fxRateToUsd) || 1;
  const _payAmt = parseFloat(paymentForm.amount) || 0;
  const paymentAmtUsd = paymentForm.currencyCode === "USD" ? _payAmt : _payAmt / _payFxR;
  const paymentSelectedSup = paymentDialogSupplier
    ? (paymentForm.supplierId === paymentDialogSupplier.id
        ? paymentDialogSupplier
        : (suppliers || []).find((s: any) => s.id === paymentForm.supplierId) ?? paymentDialogSupplier)
    : null;
  const paymentBalanceUsd = parseFloat(paymentSelectedSup?.totalValue || "0");
  const isOverpayment = _payAmt > 0 && paymentAmtUsd > paymentBalanceUsd + 0.005;
  const overpaymentUsd = isOverpayment ? paymentAmtUsd - paymentBalanceUsd : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Brokers &amp; Suppliers" />
          <p className="text-muted-foreground mt-1">
            {brokerCount > 0 && `${brokerCount} broker${brokerCount !== 1 ? "s" : ""}`}
            {brokerCount > 0 && standaloneCount > 0 && " · "}
            {standaloneCount > 0 && `${standaloneCount} standalone`}
            {inactiveSuppliers.length > 0 && ` · ${inactiveSuppliers.length} inactive`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {inactiveSuppliers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive(!showInactive)}
              data-testid="button-toggle-inactive"
            >
              {showInactive ? "Hide Inactive" : "Show Inactive"}
            </Button>
          )}
          <Button
            onClick={() => { resetForm(); setCreateOpen(true); }}
            data-testid="button-add-factory-supplier"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as SupplierFilter)}>
        <SelectTrigger className="w-44" data-testid="filter-dropdown">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="brokers">Brokers</SelectItem>
          <SelectItem value="standalone">Standalone</SelectItem>
          <SelectItem value="with-balance">With Balance</SelectItem>
          <SelectItem value="zero-balance">Zero Balance</SelectItem>
          <SelectItem value="has-foreign">Has Foreign Currency</SelectItem>
          <SelectItem value="has-recent">Recent Activity</SelectItem>
        </SelectContent>
      </Select>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Brokers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-broker-count">
              {brokerCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Standalone Suppliers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-suppliers">
              {standaloneCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Containers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-containers">
              {totalContainers}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {displayedTopLevel.length > 0 ? (
            <div className="divide-y">
              {displayedTopLevel.map((s) => {
                const childAccounts = subAccountsByParent[s.id] || [];
                const hasChildren = childAccounts.length > 0;
                const isExpanded = expandedSupplierIds.has(s.id);

                const SupplierRow = ({ sup, isChild }: { sup: SupplierWithBalance; isChild?: boolean }) => {
                  const isParent = !isChild && hasChildren;
                  const handleOpen = () => {
                    if (isParent) {
                      setParentViewSupplierId(sup.id);
                    } else {
                      setStatementReturnToParent(false);
                      setStatementSupplierId(sup.id);
                    }
                  };
                  return (
                  <div
                    className={`p-4 ${!sup.isActive ? "opacity-60" : ""} ${isChild ? "bg-muted/30 pl-8 border-t" : ""}`}
                    data-testid={`row-factory-supplier-${sup.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isChild && <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                          <button
                            onClick={handleOpen}
                            className="text-base font-semibold hover:underline text-left"
                            data-testid={`link-supplier-statement-${sup.id}`}
                          >
                            {sup.name}
                          </button>
                          {!sup.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          {!isChild && isParent && <Badge variant="secondary" className="text-xs"><Building2 className="h-3 w-3 mr-1" />Broker</Badge>}
                          {isChild && <Badge variant="outline" className="text-xs"><Link2 className="h-3 w-3 mr-1" />Linked Supplier</Badge>}
                          {sup.pendingContainers > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {sup.pendingContainers} pending
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                          {sup.contactPerson && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {sup.contactPerson}
                            </span>
                          )}
                          {sup.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3.5 w-3.5" />
                              {sup.phone}
                            </span>
                          )}
                          {sup.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5" />
                              {sup.email}
                            </span>
                          )}
                          {sup.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {sup.address}
                            </span>
                          )}
                        </div>

                        {sup.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{sup.notes}</p>
                        )}

                        <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                          <span className="flex items-center gap-1" data-testid={`text-supplier-containers-${sup.id}`}>
                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                            {sup.totalContainers} container{sup.totalContainers !== 1 ? "s" : ""}
                          </span>
                          {sup.pendingContainers > 0 && (
                            <span className="flex items-center gap-1 text-amber-500" data-testid={`text-supplier-otw-${sup.id}`}>
                              <Clock className="h-3.5 w-3.5" />
                              {sup.pendingContainers} OTW
                            </span>
                          )}
                          {(sup as any).dueContainersCount > 0 && (
                            <button
                              className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold hover:underline"
                              onClick={(e) => { e.stopPropagation(); setDueDialogSupplier({ name: sup.name, containers: (sup as any).dueContainers || [] }); }}
                              data-testid={`text-supplier-due-${sup.id}`}
                            >
                              <Clock className="h-3.5 w-3.5" />
                              {(sup as any).dueContainersCount} due
                            </button>
                          )}
                          <span className="flex items-center gap-1" data-testid={`text-supplier-kg-${sup.id}`}>
                            <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatKg(sup.totalKg)}
                          </span>
                          {sup.lastContainerDate && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-3.5 w-3.5" />
                              Last: {formatDate(sup.lastContainerDate)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">{isParent ? "Pool Balance" : "Balance"}</div>
                          {isParent ? (
                            <div className="text-sm text-muted-foreground italic" data-testid={`text-supplier-balance-${sup.id}`}>
                              Click to view
                            </div>
                          ) : isChild && sup.currencyBalances && sup.currencyBalances.length > 0 && sup.currencyBalances[0].currencyCode !== "USD" ? (
                            <>
                              <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                {sup.currencyBalances[0].currencyCode} {formatNum(sup.currencyBalances[0].balance.toFixed(2))}
                              </div>
                              <div className="text-xs text-muted-foreground">~${formatNum(sup.totalValue)} USD</div>
                            </>
                          ) : (
                            <>
                              <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                ${formatNum(sup.totalValue)}
                              </div>
                            </>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`button-actions-${sup.id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => openPaymentDialog(sup)}
                                data-testid={`button-pay-supplier-${sup.id}`}
                              >
                                <DollarSign className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
                                Record Payment
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && isParent && (
                              <DropdownMenuItem
                                onClick={() => openBulkFxDialog(sup.id, sup.name)}
                                data-testid={`button-bulk-fx-${sup.id}`}
                              >
                                <Layers className="h-4 w-4 mr-2 text-blue-500" />
                                Bulk FX Settlement
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && !isChild && (
                              <DropdownMenuItem
                                onClick={() => openCreateSubAccount(sup)}
                                data-testid={`button-add-subaccount-${sup.id}`}
                              >
                                <Link2 className="h-4 w-4 mr-2" />
                                Add Linked Supplier
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setObEditSupplier({ id: sup.id, name: sup.name, currentBalance: (sup as any).openingBalance || "0" });
                                  setObEditValue((sup as any).openingBalance || "0");
                                }}
                                data-testid={`button-ob-edit-supplier-${sup.id}`}
                              >
                                <BookOpen className="h-4 w-4 mr-2" />
                                Edit Opening Balance
                              </DropdownMenuItem>
                            )}
                            {sup.isActive && (
                              <DropdownMenuItem
                                onClick={() => openEdit(sup)}
                                data-testid={`button-edit-supplier-${sup.id}`}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit Supplier
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => { wrapAdminAction(() => setPendingDelete(() => () => permanentDeleteMutation.mutate(sup.id)), "Delete Supplier"); }}
                              data-testid={`button-delete-supplier-${sup.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleOpen}
                          data-testid={`button-view-statement-${sup.id}`}
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  );
                };

                return (
                  <div key={s.id}>
                    <div className="relative">
                      <SupplierRow sup={s} />
                      {hasChildren && (
                        <button
                          onClick={() => toggleExpanded(s.id)}
                          className="absolute top-4 left-4 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                          data-testid={`button-expand-supplier-${s.id}`}
                        >
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    {isExpanded && childAccounts.map((child) => (
                      <SupplierRow key={child.id} sup={child} isChild />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No factory suppliers yet</p>
              <p className="text-sm mt-1">Add your first factory supplier to get started</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={!!paymentDialogSupplier} onOpenChange={(open) => { if (!open) setPaymentDialogSupplier(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {paymentDialogSupplier
                ? `Pay to: ${paymentDialogSupplier.name} — Balance: $${formatNum(paymentDialogSupplier.totalValue)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Sub-account selector: if this supplier has children, show them as options */}
            {paymentDialogSupplier && (() => {
              const children = (suppliers || []).filter((s: any) => s.parentId === paymentDialogSupplier.id);
              if (children.length === 0) return null;
              return (
                <div>
                  <Label>Pay to (account)</Label>
                  <Select
                    value={String(paymentForm.supplierId)}
                    onValueChange={(v) => setPaymentForm(prev => ({ ...prev, supplierId: parseInt(v) }))}
                  >
                    <SelectTrigger data-testid="select-payment-target">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(paymentDialogSupplier.id)}>
                        {paymentDialogSupplier.name} (broker)
                      </SelectItem>
                      {children.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} (linked supplier)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={paymentForm.date}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, date: e.target.value }))}
                data-testid="input-payment-date"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                  data-testid="input-payment-amount"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select
                  value={paymentForm.currencyCode}
                  onValueChange={(v) => setPaymentForm(prev => ({
                    ...prev,
                    currencyCode: v,
                    fxRateToUsd: v === "USD" ? "1" : prev.fxRateToUsd,
                  }))}
                >
                  <SelectTrigger data-testid="select-payment-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="LBP">LBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="TRY">TRY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {paymentForm.currencyCode !== "USD" && (
              <div>
                <Label>FX Rate (units of {paymentForm.currencyCode} per 1 USD)</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="e.g. 89000 for LBP"
                  value={paymentForm.fxRateToUsd}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, fxRateToUsd: e.target.value }))}
                  data-testid="input-payment-fx-rate"
                />
                {paymentForm.amount && paymentForm.fxRateToUsd && parseFloat(paymentForm.fxRateToUsd) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    = ${(parseFloat(paymentForm.amount || "0") / parseFloat(paymentForm.fxRateToUsd)).toFixed(2)} USD
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>Paid From Account <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Select
                value={paymentForm.paidFromAccountId || "__none__"}
                onValueChange={(v) => setPaymentForm(prev => ({ ...prev, paidFromAccountId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-payment-from-account">
                  <SelectValue placeholder="Skip (no account)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Skip (no account)</SelectItem>
                  {(ledgerAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.code ? `${a.code} — ` : ""}{a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g. Bank transfer ref #123"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, notes: e.target.value }))}
                data-testid="input-payment-notes"
              />
            </div>

            {isOverpayment && (
              <div
                className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-0.5"
                data-testid="alert-overpayment"
              >
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Overpayment — ${formatNum(overpaymentUsd.toFixed(2))} USD over current balance
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Outstanding balance: ${formatNum(paymentBalanceUsd.toFixed(2))} USD.
                  The excess will create a credit balance on this supplier.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogSupplier(null)}>Cancel</Button>
            <Button
              onClick={() => wrapAdminAction(() => paymentMutation.mutate(paymentForm), "Record Payment")}
              disabled={!paymentForm.amount || !paymentForm.date || paymentMutation.isPending}
              variant={isOverpayment ? "destructive" : "default"}
              data-testid="button-submit-payment"
            >
              {paymentMutation.isPending ? "Saving..." : isOverpayment ? "Record Overpayment" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen || !!editingSupplier} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingSupplier(null); resetForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? "Edit Supplier" : formRole === "linked" ? "Add Linked Supplier" : "Add Broker / Supplier"}
            </DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? "Update supplier details"
                : formRole === "linked"
                  ? `Linked to: ${allSuppliers.find(s => s.id === formData.parentId)?.name || ""}`
                  : "Create a new broker or standalone supplier"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Role selector — only for new entries that aren't pre-set as linked */}
            {!editingSupplier && !createSubAccountParentId && (
              <div>
                <Label>Role</Label>
                <div className="flex gap-2 mt-1">
                  {(["broker", "standalone"] as const).map(r => {
                    const roleLabel: Record<string, string> = { broker: "Broker", standalone: "Standalone Supplier" };
                    const roleIcon = r === "broker"
                      ? <Building2 className="h-3.5 w-3.5 mr-1" />
                      : <Globe className="h-3.5 w-3.5 mr-1" />;
                    return (
                      <Button
                        key={r}
                        type="button"
                        variant={formRole === r ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFormRole(r);
                          setFormData(prev => ({ ...prev, parentId: null }));
                        }}
                        data-testid={`role-btn-${r}`}
                      >
                        {roleIcon}
                        {roleLabel[r]}
                      </Button>
                    );
                  })}
                </div>
                {formRole === "broker" && (
                  <p className="text-xs text-muted-foreground mt-1.5">A Broker groups linked suppliers; payments can be made at the broker or supplier level.</p>
                )}
              </div>
            )}
            {/* Broker selector — if role = linked and no parent pre-set */}
            {(formRole === "linked" && !createSubAccountParentId && !editingSupplier) && (
              <div>
                <Label>Parent Broker *</Label>
                <Select
                  value={formData.parentId ? String(formData.parentId) : ""}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, parentId: parseInt(v) }))}
                >
                  <SelectTrigger data-testid="select-parent-broker">
                    <SelectValue placeholder="Select broker..." />
                  </SelectTrigger>
                  <SelectContent>
                    {topLevelSuppliers.filter(s => s.isActive).map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Supplier name"
                data-testid="input-supplier-name"
              />
            </div>
            <div>
              <Label>Contact Person</Label>
              <Input
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="Contact person name"
                data-testid="input-supplier-contact"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Phone number"
                  data-testid="input-supplier-phone"
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Email address"
                  data-testid="input-supplier-email"
                />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Address"
                data-testid="input-supplier-address"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes"
                data-testid="input-supplier-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingSupplier(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(handleSubmit, editingSupplier ? "Update Supplier" : "Create Supplier")}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-supplier"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OB Commission Edit Dialog */}
      <Dialog open={!!editObComm} onOpenChange={(open) => { if (!open) setEditObComm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Edit OB Commission
            </DialogTitle>
            <DialogDescription>Update the opening balance commission entry.</DialogDescription>
          </DialogHeader>
          {editObComm && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input type="number" step="0.01" value={editObComm.amount} onChange={e => setEditObComm(p => p ? { ...p, amount: e.target.value } : null)} />
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Input value={editObComm.currencyCode} onChange={e => setEditObComm(p => p ? { ...p, currencyCode: e.target.value.toUpperCase() } : null)} maxLength={10} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Person / Broker</Label>
                <Input value={editObComm.personName} onChange={e => setEditObComm(p => p ? { ...p, personName: e.target.value } : null)} placeholder="Name (optional)" />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input value={editObComm.notes} onChange={e => setEditObComm(p => p ? { ...p, notes: e.target.value } : null)} placeholder="Notes (optional)" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditObComm(null)}>Cancel</Button>
            <Button
              disabled={updateObCommissionMutation.isPending || !editObComm?.amount}
              onClick={() => wrapAdminAction(() => editObComm && updateObCommissionMutation.mutate({
                rawStockId: editObComm.rawStockId,
                commissionAmount: editObComm.amount,
                commissionCurrencyCode: editObComm.currencyCode,
                commissionPersonName: editObComm.personName,
                commissionNotes: editObComm.notes,
              }), "Save Commission")}
            >
              {updateObCommissionMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!obEditSupplier} onOpenChange={(open) => { if (!open) { setObEditSupplier(null); setObEditValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Edit Opening Balance
            </DialogTitle>
            <DialogDescription>
              Overwrite the opening balance for <span className="font-semibold">{obEditSupplier?.name}</span>.
              Current value: <span className="font-mono">{obEditSupplier?.currentBalance}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Opening Balance (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={obEditValue}
                onChange={(e) => setObEditValue(e.target.value)}
                data-testid="input-ob-edit-value"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setObEditSupplier(null); setObEditValue(""); }} data-testid="button-ob-edit-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => wrapAdminAction(() => obEditSupplier && obEditMutation.mutate({ id: obEditSupplier.id, openingBalance: obEditValue }), "Save Opening Balance")}
              disabled={obEditMutation.isPending || !obEditValue}
              data-testid="button-ob-edit-save"
            >
              {obEditMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Due Containers Dialog ── */}
      <Dialog open={!!dueDialogSupplier} onOpenChange={(open) => { if (!open) setDueDialogSupplier(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Clock className="h-5 w-5" />
              Payment Due — {dueDialogSupplier?.name}
            </DialogTitle>
            <DialogDescription>
              These containers were offloaded more than 30 days ago and still have an outstanding balance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {dueDialogSupplier?.containers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No due containers</p>
            ) : (
              <div className="rounded-md border divide-y text-sm">
                {(dueDialogSupplier?.containers || [])
                  .slice()
                  .sort((a: any, b: any) => new Date(a.offloadDate).getTime() - new Date(b.offloadDate).getTime())
                  .map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                      <div>
                        <div className="font-medium">{c.containerNumber}</div>
                        <div className="text-xs text-muted-foreground">Offloaded: {formatDate(c.offloadDate)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="tabular-nums font-medium">{c.currencyCode} {parseFloat(c.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                          {c.daysPastDue > 0 ? `${c.daysPastDue}d overdue` : "Due today"}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setDueDialogSupplier(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk FX Settlement Dialog ── */}
      <Dialog open={bulkFxOpen} onOpenChange={(open) => { if (!open) { setBulkFxOpen(false); setBulkFxPreview(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-blue-500" />
              Bulk FX Settlement — {bulkFxBrokerName}
            </DialogTitle>
            <DialogDescription>
              {bulkFxPreview
                ? "Review the breakdown below. Each supplier's account will be debited by the amount shown."
                : "Enter a total amount in a foreign currency. It will be split across all linked suppliers, capped at each supplier's outstanding balance."}
            </DialogDescription>
          </DialogHeader>

          {bulkFxPreview ? (
            /* ── Preview step (before committing) ── */
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2 bg-muted/40">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total to settle</span>
                  <span className="font-semibold tabular-nums">{bulkFxForm.fromCurrencyCode} {parseFloat(bulkFxPreview.totalAllocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">≈ USD equivalent</span>
                  <span className="font-semibold tabular-nums text-green-600 dark:text-green-400">${parseFloat(bulkFxPreview.totalUsd || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account deductions</p>
                <div className="rounded-md border divide-y text-sm max-h-64 overflow-y-auto">
                  {bulkFxPreview.transfers.map((t) => {
                    const overpaid = parseFloat(t.overpayment || "0") > 0.01;
                    return (
                    <div key={t.supplierId} className="flex justify-between items-center px-3 py-2">
                      <div>
                        <div className="font-medium">{t.supplierName}</div>
                        {overpaid && (
                          <div className="text-xs text-amber-600 dark:text-amber-400">
                            incl. {bulkFxForm.fromCurrencyCode} {parseFloat(t.overpayment).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} overpayment (will show as CR)
                          </div>
                        )}
                      </div>
                      <div className="text-right space-y-0.5">
                        <div className="tabular-nums font-medium">{bulkFxForm.fromCurrencyCode} {parseFloat(t.allocated).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="text-xs text-muted-foreground">≈ ${parseFloat(t.toAmountUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setBulkFxPreview(null)} disabled={bulkFxMutation.isPending}>
                  Back to Edit
                </Button>
                <Button
                  onClick={() => wrapAdminAction(() => bulkFxMutation.mutate(), "Record Bulk FX Settlement")}
                  disabled={bulkFxMutation.isPending}
                  data-testid="button-bulk-fx-confirm"
                >
                  {bulkFxMutation.isPending ? "Recording..." : "Confirm & Record Settlement"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            /* ── Form step ── */
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <Input
                    value={bulkFxForm.fromCurrencyCode}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, fromCurrencyCode: e.target.value.toUpperCase() }))}
                    maxLength={10}
                    placeholder="EUR"
                    data-testid="input-bulk-fx-currency"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Total Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={bulkFxForm.totalAmount}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, totalAmount: e.target.value }))}
                    placeholder="e.g. 50000"
                    data-testid="input-bulk-fx-amount"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>1 {bulkFxForm.fromCurrencyCode || "CCY"} = X USD (rate)</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={bulkFxForm.fxRateToUsd}
                    onChange={(e) => { setBulkFxForm((f) => ({ ...f, fxRateToUsd: e.target.value })); }}
                    placeholder="e.g. 1.08"
                    data-testid="input-bulk-fx-rate"
                  />
                  {bulkFxForm.totalAmount && bulkFxForm.fxRateToUsd && parseFloat(bulkFxForm.fxRateToUsd) > 0 && parseFloat(bulkFxForm.totalAmount) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      ≈ ${(parseFloat(bulkFxForm.totalAmount) * parseFloat(bulkFxForm.fxRateToUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={bulkFxForm.date}
                    onChange={(e) => setBulkFxForm((f) => ({ ...f, date: e.target.value }))}
                    data-testid="input-bulk-fx-date"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Container Priority</Label>
                <Select value={bulkFxForm.order} onValueChange={(v: "oldest" | "newest") => setBulkFxForm((f) => ({ ...f, order: v }))}>
                  <SelectTrigger data-testid="select-bulk-fx-order">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oldest">Oldest containers first</SelectItem>
                    <SelectItem value="newest">Newest containers first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Notes (optional)</Label>
                <Input
                  value={bulkFxForm.notes}
                  onChange={(e) => setBulkFxForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. March 2026 batch settlement"
                  data-testid="input-bulk-fx-notes"
                />
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setBulkFxOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => bulkFxPreviewMutation.mutate()}
                  disabled={
                    bulkFxPreviewMutation.isPending ||
                    !bulkFxForm.fromCurrencyCode ||
                    !bulkFxForm.totalAmount ||
                    parseFloat(bulkFxForm.totalAmount) <= 0 ||
                    !bulkFxForm.fxRateToUsd ||
                    parseFloat(bulkFxForm.fxRateToUsd) <= 0
                  }
                  data-testid="button-bulk-fx-preview"
                >
                  {bulkFxPreviewMutation.isPending ? "Loading preview..." : "Preview Settlement"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />
      {AdminDialog}
    </div>
  );
}
