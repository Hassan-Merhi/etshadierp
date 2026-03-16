import { useState, useEffect } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Users, Phone, Mail, MapPin,
  FileText, Package, Weight, Calendar, ArrowLeft,
  ChevronRight, ChevronDown, Clock, X, GitBranch, DollarSign, ArrowRightLeft, BookOpen, Building2, Link2, Globe
} from "lucide-react";
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
  date: string;
  fromCurrencyCode: string;
  fromAmount: string;
  fxRateToUsd: string;
  toAmountUsd: string;
  notes: string | null;
  sourceType: string | null;
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
  const { formatDisplayDate } = useDateFormat();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<FactorySupplier | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<number | null>(null);
  const [statementReturnToParent, setStatementReturnToParent] = useState(false);
  const [parentViewSupplierId, setParentViewSupplierId] = useState<number | null>(null);
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

  // Payment state
  const today = new Date().toISOString().slice(0, 10);
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
      toast({ title: "FX Transfer recorded", description: `${fxConversionForm.selectedCurrency} balance transferred to parent USD` });
      setFxConversionOpen(false);
    },
    onError: (err: Error) => {
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

  // Auto-expand all broker (parent) suppliers when data loads
  useEffect(() => {
    if (allSuppliers.length > 0) {
      const parentIds = new Set<number>();
      for (const s of allSuppliers) {
        const pid = (s as any).parentId;
        if (pid) parentIds.add(pid);
      }
      if (parentIds.size > 0) {
        setExpandedSupplierIds(prev => {
          const next = new Set(prev);
          parentIds.forEach(id => next.add(id));
          return next;
        });
      }
    }
  }, [suppliers]);

  const activeTopLevel = topLevelSuppliers.filter((s) => s.isActive);
  const brokerCount = activeTopLevel.filter(isBroker).length;
  const standaloneCount = activeTopLevel.filter((s) => !isBroker(s)).length;
  const totalBalance = activeTopLevel.reduce((sum, s) => sum + parseFloat(s.totalValue || "0"), 0);
  const totalContainers = activeTopLevel.reduce((sum, s) => sum + (s.totalContainers || 0), 0);

  // ── Broker Overview ──────────────────────────────────────────────────────
  if (parentViewSupplierId && !statementSupplierId) {
    const parentSup = allSuppliers.find(s => s.id === parentViewSupplierId);
    const children = subAccountsByParent[parentViewSupplierId] || [];
    const foreignCurrencies = children.flatMap(c => (c.currencyBalances || []).filter(b => b.currencyCode !== "USD" && b.balance > 0));
    const hasFX = foreignCurrencies.length > 0;

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
          {parentSup && (
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

        {/* Broker summary cards */}
        {parentSup && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Owed (approx. USD)</div>
                <div className="text-2xl font-bold mt-1 tabular-nums" data-testid="text-parent-total-balance">
                  ~${formatNum(parentSup.totalValue)}
                </div>
              </CardContent>
            </Card>
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
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Foreign Currency Pending</div>
                <div className="text-2xl font-bold mt-1">
                  {hasFX ? (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <Globe className="h-5 w-5" />
                      {[...new Set(foreignCurrencies.map(b => b.currencyCode))].join(", ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-base">None</span>
                  )}
                </div>
              </CardContent>
            </Card>
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
                      <div className="text-right min-w-[90px]">
                        <div className="text-xs text-muted-foreground mb-0.5">Balance</div>
                        {child.currencyBalances && child.currencyBalances.some(b => b.currencyCode !== "USD" && b.balance > 0) ? (
                          <div className="space-y-0.5" data-testid={`text-child-balance-${child.id}`}>
                            {child.currencyBalances.filter(b => b.balance > 0).map(b => (
                              <div key={b.currencyCode} className="text-sm font-bold tabular-nums">
                                {b.currencyCode !== "USD" ? (
                                  <span className="text-amber-600 dark:text-amber-400">{b.currencyCode} {formatNum(b.balance.toFixed(2))}</span>
                                ) : (
                                  <span>${formatNum(b.balance.toFixed(2))}</span>
                                )}
                              </div>
                            ))}
                            <div className="text-xs text-muted-foreground">~${formatNum(child.totalValue)} USD</div>
                          </div>
                        ) : (
                          <>
                            <div className="text-base font-bold tabular-nums" data-testid={`text-child-balance-${child.id}`}>
                              {parseFloat(child.totalValue || "0") > 0 ? `$${formatNum(child.totalValue)}` : <span className="text-muted-foreground text-sm">Settled</span>}
                            </div>
                            {parseFloat(child.totalValue || "0") > 0 && <div className="text-xs text-muted-foreground">USD</div>}
                          </>
                        )}
                      </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total Containers</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-statement-total-containers">
                    {statementData.summary.totalContainers}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total Weight</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-statement-total-kg">
                    {formatKg(statementData.summary.totalKg)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Gross Value</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-statement-total-value">
                    ${formatNum(statementData.summary.totalValue)}
                  </div>
                </CardContent>
              </Card>
              {parseFloat(statementData.summary.totalDirectCommissions || "0") > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">Commission Owed</div>
                    <div className="text-xl font-bold mt-1 text-amber-600 dark:text-amber-400" data-testid="text-statement-direct-commissions">
                      ${formatNum(statementData.summary.totalDirectCommissions)}
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Total Owed</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-statement-total-owed">
                    ${formatNum(statementData.summary.totalOwed || statementData.summary.totalValue)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {statementData.supplier && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Supplier Details</CardTitle>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            )}

            {statementData.currencyGroups && (statementData.currencyGroups.length > 1 || (statementData.currencyGroups.length === 1 && statementData.currencyGroups[0].currencyCode !== "USD")) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Currency Pools
                    </span>
                    {statementData.supplier.parentId && statementData.currencyGroups.some(g => g.currencyCode !== "USD" && parseFloat(g.netPayable) > 0) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const firstNonUsd = statementData.currencyGroups.find(g => g.currencyCode !== "USD" && parseFloat(g.netPayable) > 0);
                          if (firstNonUsd && statementSupplierId && statementData.supplier.parentId) {
                            setFxSourceType("supplier");
                            openFxConversionDialog(statementSupplierId, statementData.supplier.parentId, firstNonUsd.currencyCode, firstNonUsd.netPayable, firstNonUsd.totalCommission);
                          }
                        }}
                        data-testid="button-fx-convert"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                        Settle FX to Broker
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
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
                        {statementData.currencyGroups.map((group) => (
                          <TableRow key={group.currencyCode}>
                            <TableCell className="font-semibold">
                              <Badge variant="outline">{group.currencyCode}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{group.containers.length}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatKg(group.totalKg)}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-medium">
                              {group.currencyCode !== "USD" ? `${group.currencyCode} ` : "$"}{formatNum(group.totalValue)}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-destructive">
                              {parseFloat(group.totalCommission) > 0 ? (
                                <span>
                                  {group.currencyCode !== "USD" ? `${group.currencyCode} ` : "$"}{formatNum(group.remainingCommission ?? group.totalCommission)}
                                  {group.remainingCommission != null && parseFloat(group.remainingCommission) < parseFloat(group.totalCommission) && (
                                    <span className="text-xs text-muted-foreground ml-1 line-through">
                                      {formatNum(group.totalCommission)}
                                    </span>
                                  )}
                                </span>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-bold">
                              {group.currencyCode !== "USD" ? `${group.currencyCode} ` : "$"}{formatNum(group.netPayable)}
                              {group.currencyCode !== "USD" && parseFloat(group.netPayable) > 0 && statementData.supplier.parentId && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="ml-2 h-6 px-2 text-xs"
                                  onClick={() => { setFxSourceType("supplier"); statementSupplierId && statementData.supplier.parentId && openFxConversionDialog(statementSupplierId, statementData.supplier.parentId, group.currencyCode, group.netPayable, group.totalCommission); }}
                                  data-testid={`button-convert-${group.currencyCode}`}
                                >
                                  Settle
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Phase 2: Broker linked supplier container groups */}
            {statementData.linkedSupplierGroups && statementData.linkedSupplierGroups.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    Linked Supplier Containers
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {statementData.linkedSupplierGroups.map(group => (
                    <div key={group.supplierId} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs"><Link2 className="h-3 w-3 mr-1" />{group.supplierName}</Badge>
                        <span className="text-xs text-muted-foreground">{group.containerCount} container{group.containerCount !== 1 ? "s" : ""}</span>
                      </div>
                      {group.currencyGroups.map(cg => (
                        <div key={cg.currencyCode} className="pl-4 border-l-2 border-muted space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{cg.currencyCode} · {cg.containerCount} containers</span>
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              <span>Total: {cg.currencyCode} {formatNum(cg.totalValue)}</span>
                              <span>Paid: {cg.currencyCode} {formatNum(cg.totalPaid)}</span>
                              <span className={parseFloat(cg.netPayable) > 0 ? "font-medium text-foreground" : "text-green-600 dark:text-green-400"}>
                                Balance: {parseFloat(cg.netPayable) > 0 ? `${cg.currencyCode} ${formatNum(cg.netPayable)}` : "Settled"}
                              </span>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8 text-xs">Date</TableHead>
                                  <TableHead className="h-8 text-xs">Container</TableHead>
                                  <TableHead className="h-8 text-xs">Status</TableHead>
                                  <TableHead className="h-8 text-xs text-right">Value ({cg.currencyCode})</TableHead>
                                  <TableHead className="h-8 text-xs text-right">Commission</TableHead>
                                  <TableHead className="h-8 text-xs">Notes</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {cg.containers.map((c: any) => (
                                  <TableRow key={c.id} className="text-xs">
                                    <TableCell className="py-1 whitespace-nowrap">{formatDate(c.date)}</TableCell>
                                    <TableCell className="py-1 font-medium">{c.containerNumber}</TableCell>
                                    <TableCell className="py-1">
                                      <Badge variant={statusColor(c.status)} className="text-xs">{c.status}</Badge>
                                    </TableCell>
                                    <TableCell className="py-1 text-right tabular-nums">{formatNum(c.value)}</TableCell>
                                    <TableCell className="py-1 text-right tabular-nums text-destructive">
                                      {parseFloat(c.commissionAmount || "0") > 0 ? `${c.commissionCurrencyCode} ${formatNum(c.commissionAmount)}` : "—"}
                                    </TableCell>
                                    <TableCell className="py-1 text-muted-foreground max-w-[100px] truncate">{c.notes || "—"}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Unified Activity Ledger — Phase 4: merges Containers, Payments, FX Settlements, Commissions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Activity Ledger
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  type RowType = "purchase" | "payment" | "fx" | "commission";
                  const srcLabel: Record<string, string> = { supplier: "Balance", commission: "Commission", both: "Both" };
                  const allRows: Array<{
                    key: string; date: string | null; type: RowType;
                    ref: string; detail: string; amount: string; amountIsNeg: boolean;
                    status?: string; notes?: string | null; onDelete?: () => void;
                  }> = [
                    ...statementData.statement.map(e => ({
                      key: `c-${e.id}`,
                      date: e.date,
                      type: "purchase" as RowType,
                      ref: e.containerNumber,
                      detail: [e.origin, e.currencyCode !== "USD" ? `${e.currencyCode} ${formatNum(e.value)} @ ${formatNum(e.fxRateToUsd)}` : ""].filter(Boolean).join(" · "),
                      amount: `$${formatNum(e.value)}`,
                      amountIsNeg: false,
                      status: e.status,
                      notes: [e.notes, (parseFloat((e as any).commissionAmount || "0") > 0 ? `Commission: ${(e as any).commissionCurrencyCode || "USD"} ${formatNum((e as any).commissionAmount)}` : "")].filter(Boolean).join(" · ") || null,
                    })),
                    ...statementData.payments.map(p => ({
                      key: `p-${p.id}`,
                      date: p.date,
                      type: "payment" as RowType,
                      ref: "Payment",
                      detail: p.currencyCode !== "USD" ? `${p.currencyCode} ${formatNum(p.amount)} @ ${formatNum(p.fxRateToUsd || "1")}` : "",
                      amount: `$${formatNum(p.amountUsd)}`,
                      amountIsNeg: false,
                      notes: p.notes,
                      onDelete: () => { if (confirm("Delete this payment?")) deletePaymentMutation.mutate(p.id); },
                    })),
                    ...(statementData.fxTransfers || []).map(t => {
                      const isOut = t.fromSupplierId === statementSupplierId;
                      return {
                        key: `f-${t.id}`,
                        date: t.date,
                        type: "fx" as RowType,
                        ref: isOut ? `FX → Broker` : `FX ← Linked`,
                        detail: isOut ? `${t.fromCurrencyCode} ${formatNum(t.fromAmount)} → $${formatNum(t.toAmountUsd)}${t.sourceType ? ` · ${srcLabel[t.sourceType] || t.sourceType}` : ""}` : `+$${formatNum(t.toAmountUsd)} received`,
                        amount: isOut ? `${t.fromCurrencyCode} ${formatNum(t.fromAmount)}` : `$${formatNum(t.toAmountUsd)}`,
                        amountIsNeg: isOut,
                        notes: t.notes,
                      };
                    }),
                    ...(statementData.obCommissions || []).map(oc => ({
                      key: `oc-${oc.rawStockId}`,
                      date: oc.date,
                      type: "commission" as RowType,
                      ref: oc.containerNumber,
                      detail: oc.personName || "",
                      amount: `${oc.currencyCode !== "USD" ? `${oc.currencyCode} ${formatNum(oc.amount)}` : `$${formatNum(oc.amount)}`}`,
                      amountIsNeg: true,
                      notes: null,
                      onDelete: () => { if (confirm("Delete this opening balance commission entry? This cannot be undone.")) deleteObCommissionMutation.mutate(oc.rawStockId); },
                    })),
                  ].sort((a, b) => {
                    const da = a.date ? new Date(a.date).getTime() : 0;
                    const db = b.date ? new Date(b.date).getTime() : 0;
                    return db - da;
                  });

                  const typeBadge = (type: RowType) => {
                    if (type === "purchase") return <Badge variant="outline" className="text-xs font-normal">Purchase</Badge>;
                    if (type === "payment") return <Badge variant="secondary" className="text-xs font-normal">Payment</Badge>;
                    if (type === "fx") return <Badge className="text-xs font-normal bg-blue-500 dark:bg-blue-600">FX</Badge>;
                    return <Badge variant="destructive" className="text-xs font-normal">Commission</Badge>;
                  };

                  if (allRows.length === 0) return (
                    <div className="text-center py-8 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p className="text-lg font-medium">No activity yet</p>
                    </div>
                  );

                  return (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Detail</TableHead>
                            <TableHead className="text-right">Amount (USD)</TableHead>
                            <TableHead>Notes</TableHead>
                            <TableHead className="w-8" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allRows.map(row => (
                            <TableRow key={row.key} data-testid={row.type === "purchase" ? `row-statement-${row.key}` : undefined}>
                              <TableCell className="whitespace-nowrap text-sm">{formatDate(row.date || "")}</TableCell>
                              <TableCell>{typeBadge(row.type)}</TableCell>
                              <TableCell className="text-sm font-medium">
                                <span>{row.ref}</span>
                                {row.status && <Badge variant={statusColor(row.status)} className="text-xs ml-1">{row.status}</Badge>}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{row.detail || "—"}</TableCell>
                              <TableCell className={`text-right text-sm tabular-nums font-medium ${row.type === "payment" ? "text-green-600 dark:text-green-400" : row.amountIsNeg ? "text-destructive" : ""}`}>
                                {row.amountIsNeg && row.type !== "payment" ? "−" : row.type === "payment" ? "−" : ""}{row.amount}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[140px] truncate">{row.notes || "—"}</TableCell>
                              <TableCell>
                                {row.onDelete && (
                                  <Button variant="ghost" size="icon" onClick={row.onDelete}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {parseFloat(statementData.summary.totalPayments || "0") > 0 && (
              <Card className="border-primary/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Net Balance (after payments)</span>
                    <span className="text-xl font-bold tabular-nums text-primary" data-testid="text-statement-net-balance">
                      ${formatNum(statementData.summary.netPayable)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}

        {/* FX Settlement Dialog — internal settlement: linked supplier foreign currency → broker USD bucket */}
        <Dialog open={fxConversionOpen} onOpenChange={(open) => { if (!open) setFxConversionOpen(false); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4" />
                FX Settlement to Broker (USD)
              </DialogTitle>
              <DialogDescription>
                Internal settlement: converts this linked supplier's foreign currency balance into the broker's USD pool. Not a voucher payment.
              </DialogDescription>
            </DialogHeader>
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
                  return (
                    <p className={`text-xs mt-1 ${exceeds ? "text-destructive" : "text-muted-foreground"}`}>
                      Available: {avail.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxConversionForm.selectedCurrency}
                      {exceeds && " — exceeds available balance"}
                    </p>
                  );
                })()}
              </div>

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
                onClick={() => {
                  fxConversionMutation.mutate({
                    ...fxConversionForm,
                    sourceType: fxSourceType,
                  } as any);
                }}
                disabled={
                  !fxConversionForm.amount ||
                  !fxConversionForm.fxRateToUsd ||
                  parseFloat(fxConversionForm.amount) <= 0 ||
                  parseFloat(fxConversionForm.fxRateToUsd) <= 0 ||
                  (!!fxConversionForm.availableBalance && parseFloat(fxConversionForm.amount) > parseFloat(fxConversionForm.availableBalance) + 0.005) ||
                  fxConversionMutation.isPending
                }
                data-testid="button-submit-fx-conversion"
              >
                {fxConversionMutation.isPending ? "Recording..." : "Record Settlement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Brokers &amp; Suppliers</h1>
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
      <div className="flex gap-2 flex-wrap">
        {(["all", "brokers", "standalone", "with-balance", "zero-balance", "has-foreign", "has-recent"] as const).map(f => {
          const labels: Record<string, string> = {
            all: "All",
            brokers: "Brokers",
            standalone: "Standalone",
            "with-balance": "With Balance",
            "zero-balance": "Zero Balance",
            "has-foreign": "Has Foreign Currency",
            "has-recent": "Recent Activity",
          };
          return (
            <Button
              key={f}
              variant={activeFilter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(f)}
              data-testid={`filter-${f}`}
            >
              {labels[f]}
            </Button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Total Balance (USD)</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-balance">
              ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: totalBalance % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}
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
                          <div className="text-xs text-muted-foreground">Balance</div>
                          {isChild && sup.currencyBalances && sup.currencyBalances.length > 0 && sup.currencyBalances[0].currencyCode !== "USD" ? (
                            <>
                              <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                {sup.currencyBalances[0].currencyCode} {formatNum(sup.currencyBalances[0].balance.toFixed(2))}
                              </div>
                              <div className="text-xs text-muted-foreground">~${formatNum(sup.totalValue)} USD</div>
                            </>
                          ) : (
                            <>
                              <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                                {isParent ? "~" : ""}${formatNum(sup.totalValue)}
                              </div>
                              {isParent && (
                                <div className="text-xs text-muted-foreground">approx. USD</div>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          {sup.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); openPaymentDialog(sup); }}
                              title="Record Payment"
                              data-testid={`button-pay-supplier-${sup.id}`}
                            >
                              <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                            </Button>
                          )}
                          {sup.isActive && !isChild && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); openCreateSubAccount(sup); }}
                              title="Add Linked Supplier"
                              data-testid={`button-add-subaccount-${sup.id}`}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          )}
                          {sup.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit Opening Balance"
                              onClick={(e) => {
                                e.stopPropagation();
                                setObEditSupplier({ id: sup.id, name: sup.name, currentBalance: (sup as any).openingBalance || "0" });
                                setObEditValue((sup as any).openingBalance || "0");
                              }}
                              data-testid={`button-ob-edit-supplier-${sup.id}`}
                            >
                              <BookOpen className="h-4 w-4" />
                            </Button>
                          )}
                          {sup.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); openEdit(sup); }}
                              data-testid={`button-edit-supplier-${sup.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {sup.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(sup.id); }}
                              data-testid={`button-delete-supplier-${sup.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                          {!sup.isActive && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); if (confirm(`Permanently delete "${sup.name}"? This cannot be undone.`)) permanentDeleteMutation.mutate(sup.id); }}
                              data-testid={`button-permanent-delete-supplier-${sup.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
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
              <Label>Paid From Account (optional)</Label>
              <Select
                value={paymentForm.paidFromAccountId}
                onValueChange={(v) => setPaymentForm(prev => ({ ...prev, paidFromAccountId: v }))}
              >
                <SelectTrigger data-testid="select-payment-from-account">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogSupplier(null)}>Cancel</Button>
            <Button
              onClick={() => paymentMutation.mutate(paymentForm)}
              disabled={!paymentForm.amount || !paymentForm.date || paymentMutation.isPending}
              data-testid="button-submit-payment"
            >
              {paymentMutation.isPending ? "Saving..." : "Record Payment"}
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
              onClick={handleSubmit}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-supplier"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingSupplier ? "Update" : "Create"}
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
              onClick={() => obEditSupplier && obEditMutation.mutate({ id: obEditSupplier.id, openingBalance: obEditValue })}
              disabled={obEditMutation.isPending || !obEditValue}
              data-testid="button-ob-edit-save"
            >
              {obEditMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
