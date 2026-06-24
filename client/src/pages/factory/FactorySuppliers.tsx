import { useState, useEffect } from "react";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Phone,
  Mail,
  MapPin,
  Package,
  Weight,
  Calendar,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  GitBranch,
  DollarSign,
  ArrowRightLeft,
  BookOpen,
  Building2,
  Link2,
  Globe,
  MoreVertical,
  Layers,
  AlertTriangle,
  Info,
  Eye,
  EyeOff,
  TrendingUp,
  FileText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { enqueueRequest } from "@/lib/offlineQueue";
import { cacheBulkFxData, getCachedBulkFxData, computeBulkFxPreview } from "@/lib/bulkFxOffline";
import type { FactorySupplier } from "@shared/schema";

import {
  CurrencyBalance,
  SupplierWithBalance,
  StatementResponse,
  BulkFxPreview,
} from "./factory-suppliers/factorySupplierTypes";
import { BrokerOverviewPanel } from "./factory-suppliers/BrokerOverviewPanel";
import { SupplierStatement } from "./factory-suppliers/SupplierStatement";
import { SupplierDialogs } from "./factory-suppliers/SupplierDialogs";

export default function FactorySuppliers() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { formatDisplayDate } = useDateFormat();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<FactorySupplier | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<number | null>(() => {
    const id = new URLSearchParams(window.location.search).get("supplierId");
    return id ? Number(id) : null;
  });
  const [statementReturnToParent, setStatementReturnToParent] = useState(false);
  const [statDateFilter, setStatDateFilter] = useState<"all" | "today" | "yesterday" | "this_month" | "this_year">(
    "all"
  );
  const [parentViewSupplierId, setParentViewSupplierId] = useState<number | null>(null);

  useEscapeBack(
    statementSupplierId
      ? () => {
          setStatementSupplierId(null);
          setStatementReturnToParent(false);
        }
      : parentViewSupplierId
        ? () => setParentViewSupplierId(null)
        : null
  );

  const [showInactive, setShowInactive] = useState(false);
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<number>>(new Set());
  const [createSubAccountParentId, setCreateSubAccountParentId] = useState<number | null>(null);
  type SupplierFilter =
    | "all"
    | "brokers"
    | "standalone"
    | "with-balance"
    | "zero-balance"
    | "has-foreign"
    | "has-recent";
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
  const [formRole, setFormRole] = useState<"broker" | "standalone" | "linked">("standalone");
  const { toast } = useToast();

  const [listIncludeOtw, setListIncludeOtw] = useState(false);
  const { data: suppliers, isLoading } = useQuery<SupplierWithBalance[]>({
    queryKey: ["/api/factory/suppliers/with-balances", listIncludeOtw],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", `/api/factory/suppliers/with-balances?includeOtw=${listIncludeOtw}`);
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
  });

  const [supplierIncludeOtw, setSupplierIncludeOtw] = useState(false);
  const {
    data: statementData,
    isLoading: statementLoading,
    isError: statementError,
  } = useQuery<StatementResponse>({
    queryKey: ["/api/factory/suppliers", statementSupplierId, "statement", supplierIncludeOtw],
    queryFn: async () => {
      const res = await factoryApiRequest(
        "GET",
        `/api/factory/suppliers/${statementSupplierId}/statement?includeOtw=${supplierIncludeOtw}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to load statement" }));
        throw new Error(err.message || "Failed to load statement");
      }
      return res.json();
    },
    enabled: !!statementSupplierId,
    retry: 1,
  });

  const [collapsedStmtSections, setCollapsedStmtSections] = useState<Set<string>>(
    new Set(["supplierDetails", "currencyPools"])
  );
  const toggleStmtSection = (key: string) =>
    setCollapsedStmtSections((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const [brokerIncludeOtw, setBrokerIncludeOtw] = useState(false);

  const { data: brokerOverviewStatement, isLoading: brokerOverviewLoading } = useQuery<any>({
    queryKey: ["/api/factory/suppliers", parentViewSupplierId, "broker-statement", brokerIncludeOtw],
    queryFn: async () => {
      const res = await factoryApiRequest(
        "GET",
        `/api/factory/suppliers/${parentViewSupplierId}/broker-statement?includeOtw=${brokerIncludeOtw}`
      );
      if (!res.ok) throw new Error("Failed to load broker overview");
      return res.json();
    },
    enabled: !!parentViewSupplierId && !statementSupplierId,
  });

  const isBrokerStatement = !!statementData?.linkedSupplierGroups?.length;
  const today = new Date().toLocaleDateString("en-CA");
  const [paymentDialogSupplier, setPaymentDialogSupplier] = useState<SupplierWithBalance | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    supplierId: 0,
    date: today,
    amount: "",
    currencyCode: "USD",
    fxRateToUsd: "1",
    paidFromAccountId: "",
    notes: "",
    effectiveDate: "",
  });

  const { data: ledgerAccounts } = useQuery<{ id: number; name: string; code: string }[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const [fxConversionOpen, setFxConversionOpen] = useState(false);
  type FxSourceType = "supplier" | "commission" | "both";
  const [fxSourceType, setFxSourceType] = useState<FxSourceType>("supplier");
  const [obEditSupplier, setObEditSupplier] = useState<{ id: number; name: string; currentBalance: string } | null>(
    null
  );
  const [obEditValue, setObEditValue] = useState("");
  const [fxConversionForm, setFxConversionForm] = useState({
    fromSupplierId: 0,
    toSupplierId: 0,
    selectedCurrency: "",
    amount: "",
    availableBalance: "",
    supplierBalance: "",
    commissionBalance: "",
    fxRateToUsd: "",
    date: today,
    notes: "",
    effectiveDate: "",
  });

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
  const [bulkFxPreview, setBulkFxPreview] = useState<null | BulkFxPreview>(null);

  const bulkFxPreviewMutation = useMutation({
    mutationFn: async () => {
      if (!bulkFxBrokerId) throw new Error("No broker selected");
      const res = await factoryApiRequest("POST", `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-settlement`, {
        ...bulkFxForm,
        dryRun: true,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Preview failed");
      }
      return res.json() as Promise<BulkFxPreview>;
    },
    onSuccess: (data) => setBulkFxPreview(data),
  });

  const bulkFxMutation = useMutation({
    mutationFn: async () => {
      if (!bulkFxBrokerId) throw new Error("No broker selected");
      const res = await factoryApiRequest(
        "POST",
        `/api/factory/suppliers/${bulkFxBrokerId}/bulk-fx-settlement`,
        bulkFxForm
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to record bulk settlement");
      }
      return res.json();
    },
    onSuccess: () => {
      setBulkFxOpen(false);
      setBulkFxPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      toast({ title: "Bulk FX Settlement recorded" });
    },
  });

  const fxConversionMutation = useMutation({
    mutationFn: async (data: any) => {
      const displayRate = parseFloat(data.fxRateToUsd) || 0;
      const amt = parseFloat(data.amount) || 0;
      const toAmountUsd = amt * displayRate;
      const storedRate = (1 / displayRate).toFixed(6);
      const payload = {
        fromSupplierId: data.fromSupplierId,
        toSupplierId: data.toSupplierId,
        fromCurrencyCode: data.selectedCurrency,
        fromAmount: data.amount,
        fxRateToUsd: storedRate,
        toAmountUsd: toAmountUsd.toFixed(4),
        date: data.date,
        notes: data.notes || null,
        sourceType: data.sourceType || "supplier",
        effectiveDate: data.effectiveDate || null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/supplier-fx-transfers", payload);
      if (!res.ok) throw new Error("Failed to record FX transfer");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      setFxConversionOpen(false);
      toast({ title: "FX Transfer recorded" });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (data: any) => {
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
        effectiveDate: data.effectiveDate || null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/supplier-payments", payload);
      if (!res.ok) throw new Error("Failed to record payment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      setPaymentDialogSupplier(null);
      toast({ title: "Payment recorded" });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("DELETE", `/api/factory/supplier-payments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const deleteFxTransferMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("DELETE", `/api/factory/supplier-fx-transfers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const deleteObCommissionMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("DELETE", `/api/factory/raw-stock/opening-balance/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => factoryApiRequest("POST", "/api/factory/suppliers", data),
    onSuccess: () => {
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => factoryApiRequest("PATCH", `/api/factory/suppliers/${data.id}`, data),
    onSuccess: () => {
      setEditingSupplier(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
    },
  });

  const obEditMutation = useMutation({
    mutationFn: async (data: any) =>
      factoryApiRequest("PATCH", `/api/factory/suppliers/${data.id}/opening-balance`, {
        openingBalance: data.openingBalance,
      }),
    onSuccess: () => {
      setObEditSupplier(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("POST", `/api/factory/suppliers/${id}/deactivate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("POST", `/api/factory/suppliers/${id}/reactivate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: number) => factoryApiRequest("DELETE", `/api/factory/suppliers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] }),
  });

  const [editObComm, setEditObComm] = useState<null | {
    rawStockId: number;
    amount: string;
    currencyCode: string;
    personName: string;
    notes: string;
  }>(null);
  const updateObCommissionMutation = useMutation({
    mutationFn: async (data: any) =>
      factoryApiRequest("PATCH", `/api/factory/raw-stock/opening-balance/${data.rawStockId}`, data),
    onSuccess: () => {
      setEditObComm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
    },
  });

  const [dueDialogSupplier, setDueDialogSupplier] = useState<any | null>(null);

  const formatNum = (v: string) =>
    parseFloat(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatDate = (d: string) => formatDisplayDate(d);
  const formatKg = (v: string) =>
    parseFloat(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " kg";

  const allSuppliers = suppliers || [];
  const activeSuppliers = allSuppliers.filter((s) => s.isActive);
  const inactiveSuppliers = allSuppliers.filter((s) => !s.isActive);
  const subAccountsByParent = allSuppliers.reduce(
    (acc, s) => {
      if (s.parentId) {
        acc[s.parentId] = acc[s.parentId] || [];
        acc[s.parentId].push(s);
      }
      return acc;
    },
    {} as Record<number, SupplierWithBalance[]>
  );

  const displayedTopLevel = (showInactive ? allSuppliers : activeSuppliers).filter((s) => !s.parentId);
  const brokerCount = displayedTopLevel.filter((s) => subAccountsByParent[s.id]?.length).length;
  const standaloneCount = displayedTopLevel.length - brokerCount;
  const totalContainers = allSuppliers.reduce((sum, s) => sum + (s.totalContainers || 0), 0);
  const totalUsdOwed = allSuppliers.reduce((sum, s) => {
    const val = parseFloat(s.totalValue || "0");
    return val > 0 ? sum + val : sum;
  }, 0);
  const totalUsdOverpaid = allSuppliers.reduce((sum, s) => {
    const val = parseFloat(s.totalValue || "0");
    return val < 0 ? sum + Math.abs(val) : sum;
  }, 0);

  const resetForm = () => {
    setFormData({
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      parentId: createSubAccountParentId,
    });
    setFormRole(createSubAccountParentId ? "linked" : "standalone");
  };

  const statusColor = (s: string) => (s === "OFFLOADED" ? "secondary" : s === "OTW" ? "outline" : "default");
  const statusDisplayLabel = (s: string) => (s === "OTW" ? "On the Way" : s.charAt(0) + s.slice(1).toLowerCase());
  const typeBadge = (t: string) => (
    <Badge variant="outline" className="text-[10px] uppercase font-bold">
      {t}
    </Badge>
  );

  if (statementSupplierId) {
    const rows = statementData?.statement || [];
    const pmts = statementData?.payments || [];
    const fxts = statementData?.fxTransfers || [];
    const obcs = statementData?.obCommissions || [];
    const allRows: any[] = [];
    rows.forEach((r) =>
      allRows.push({
        key: `c-${r.id}`,
        date: r.date,
        type: "purchase",
        ref: r.containerNumber,
        amount: formatNum(r.value),
        amountVal: parseFloat(r.value),
        rowCc: "USD",
        status: r.status,
      })
    );
    pmts.forEach((p) =>
      allRows.push({
        key: `p-${p.id}`,
        date: p.date,
        type: "payment",
        ref: `Payment (${p.currencyCode})`,
        amount: formatNum(p.amount),
        amountVal: parseFloat(p.amountUsd),
        rowCc: "USD",
        onEdit: () => {},
        onDelete: () => wrapAdminAction(() => deletePaymentMutation.mutate(p.id), "Delete Payment"),
      })
    );
    fxts.forEach((f) =>
      allRows.push({
        key: `f-${f.id}`,
        date: f.date,
        type: "fx",
        ref: "FX Settlement",
        amount: formatNum(f.toAmountUsd),
        amountVal: parseFloat(f.toAmountUsd),
        rowCc: "USD",
      })
    );
    obcs.forEach((o) =>
      allRows.push({
        key: `o-${o.rawStockId}`,
        date: o.date,
        type: "commission",
        ref: `OB: ${o.containerNumber}`,
        amount: formatNum(o.amount),
        amountVal: parseFloat(o.amountUsd),
        rowCc: "USD",
        onEdit: () => setEditObComm(o),
        onDelete: () => wrapAdminAction(() => deleteObCommissionMutation.mutate(o.rawStockId), "Delete OB Commission"),
      })
    );
    allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const balanceByKey: Record<string, { bal: number; cc: string }> = {};
    const currencyTotals: Record<string, number> = {};

    return (
      <SupplierStatement
        statementSupplierId={statementSupplierId}
        statementData={statementData}
        statementLoading={statementLoading}
        statementError={statementError}
        supplierIncludeOtw={supplierIncludeOtw}
        setSupplierIncludeOtw={setSupplierIncludeOtw}
        collapsedStmtSections={collapsedStmtSections}
        toggleStmtSection={toggleStmtSection}
        isBrokerStatement={isBrokerStatement}
        statementReturnToParent={statementReturnToParent}
        setStatementSupplierId={setStatementSupplierId}
        setStatementReturnToParent={setStatementReturnToParent}
        openFxConversionDialog={(f, t, c, n, tc) => {
          setFxConversionForm({
            fromSupplierId: f,
            toSupplierId: t,
            selectedCurrency: c,
            amount: n,
            availableBalance: n,
            supplierBalance: n,
            commissionBalance: tc || "0",
            fxRateToUsd: "",
            date: today,
            notes: "",
            effectiveDate: "",
          });
          setFxConversionOpen(true);
        }}
        formatNum={formatNum}
        formatDate={formatDate}
        formatKg={formatKg}
        today={today}
        fxConversionOpen={fxConversionOpen}
        setFxConversionOpen={setFxConversionOpen}
        fxConversionForm={fxConversionForm}
        setFxConversionForm={setFxConversionForm}
        fxSourceType={fxSourceType}
        setFxSourceType={setFxSourceType}
        allSuppliers={allSuppliers}
        subAccountsByParent={subAccountsByParent}
        wrapAdminAction={wrapAdminAction}
        deleteFxTransferMutation={deleteFxTransferMutation}
        statDateFilter={statDateFilter}
        setStatDateFilter={setStatDateFilter}
        onEditPayment={() => {}}
        onDeletePayment={(id) => wrapAdminAction(() => deletePaymentMutation.mutate(id), "Delete Payment")}
        setEditObComm={setEditObComm}
        statusColor={statusColor}
        statusDisplayLabel={statusDisplayLabel}
        typeBadge={typeBadge}
        displayedRows={allRows}
        balanceByKey={balanceByKey}
        sfTotalPurchases={0}
        sfTotalPayments={0}
        sfPurchasesQty={0}
        sfTxCount={allRows.length}
        currencyTotals={currencyTotals}
        primaryCc="USD"
      />
    );
  }

  if (parentViewSupplierId) {
    return (
      <BrokerOverviewPanel
        parentViewSupplierId={parentViewSupplierId}
        allSuppliers={allSuppliers}
        subAccountsByParent={subAccountsByParent}
        brokerOverviewStatement={brokerOverviewStatement}
        brokerOverviewLoading={brokerOverviewLoading}
        brokerIncludeOtw={brokerIncludeOtw}
        setBrokerIncludeOtw={setBrokerIncludeOtw}
        setParentViewSupplierId={setParentViewSupplierId}
        openChildStatement={(id) => {
          setStatementSupplierId(id);
          setStatementReturnToParent(true);
        }}
        openPaymentDialog={(s) => {
          setPaymentDialogSupplier(s);
          setPaymentForm({ ...paymentForm, supplierId: s.id });
        }}
        formatNum={formatNum}
        formatDate={formatDate}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Brokers & Suppliers" />
          <p className="text-muted-foreground mt-1">
            {brokerCount} brokers · {standaloneCount} standalone
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Brokers</div>
          <div className="text-2xl font-bold mt-1">{brokerCount}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Standalone</div>
          <div className="text-2xl font-bold mt-1">{standaloneCount}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Total USD Owed</div>
          <div className="text-2xl font-bold mt-1">${formatNum(String(totalUsdOwed))}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-xs text-muted-foreground">Overpaid</div>
          <div className="text-2xl font-bold mt-1 text-green-600">${formatNum(String(totalUsdOverpaid))}</div>
        </div>
      </div>

      <div className="rounded-xl border divide-y">
        {displayedTopLevel.map((s) => (
          <div key={s.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold flex items-center gap-2">
                {s.name}
                {subAccountsByParent[s.id]?.length > 0 && <Badge variant="secondary">Broker</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">
                {s.totalContainers} containers · Last: {s.lastContainerDate ? formatDate(s.lastContainerDate) : "—"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (subAccountsByParent[s.id]?.length) setParentViewSupplierId(s.id);
                  else setStatementSupplierId(s.id);
                }}
              >
                View
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingSupplier(s);
                      setFormData({
                        name: s.name,
                        contactPerson: s.contactPerson || "",
                        phone: s.phone || "",
                        email: s.email || "",
                        address: s.address || "",
                        notes: s.notes || "",
                        parentId: s.parentId,
                      });
                      setFormRole(s.parentId ? "linked" : subAccountsByParent[s.id]?.length ? "broker" : "standalone");
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  {s.isActive ? (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => wrapAdminAction(() => deactivateMutation.mutate(s.id), "Deactivate Supplier")}
                    >
                      <EyeOff className="h-4 w-4 mr-2" />
                      Deactivate
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => wrapAdminAction(() => reactivateMutation.mutate(s.id), "Reactivate Supplier")}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Reactivate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setPendingDelete(() => () => permanentDeleteMutation.mutate(s.id))}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Permanently
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>

      <SupplierDialogs
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        editingSupplier={editingSupplier}
        setEditingSupplier={setEditingSupplier}
        formData={formData}
        setFormData={setFormData}
        formRole={formRole}
        setFormRole={setFormRole}
        allSuppliers={allSuppliers}
        createSubAccountParentId={createSubAccountParentId}
        setCreateSubAccountParentId={setCreateSubAccountParentId}
        createMutation={createMutation as any}
        updateMutation={updateMutation as any}
        resetForm={resetForm}
        paymentDialogSupplier={paymentDialogSupplier}
        setPaymentDialogSupplier={setPaymentDialogSupplier}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        ledgerAccounts={ledgerAccounts}
        paymentMutation={paymentMutation as any}
        paymentAmtUsd={0}
        paymentBalanceUsd={0}
        isOverpayment={false}
        overpaymentUsd={0}
        fxConversionOpen={fxConversionOpen}
        setFxConversionOpen={setFxConversionOpen}
        fxConversionForm={fxConversionForm}
        setFxConversionForm={setFxConversionForm}
        fxSourceType={fxSourceType}
        setFxSourceType={setFxSourceType}
        fxConversionMutation={fxConversionMutation as any}
        wrapAdminAction={wrapAdminAction}
        bulkFxOpen={bulkFxOpen}
        setBulkFxOpen={setBulkFxOpen}
        bulkFxBrokerId={bulkFxBrokerId}
        bulkFxBrokerName={bulkFxBrokerName}
        bulkFxForm={bulkFxForm}
        setBulkFxForm={setBulkFxForm}
        bulkFxPreview={bulkFxPreview}
        setBulkFxPreview={setBulkFxPreview}
        bulkFxPreviewMutation={bulkFxPreviewMutation as any}
        bulkFxMutation={bulkFxMutation as any}
        obEditSupplier={obEditSupplier}
        setObEditSupplier={setObEditSupplier}
        obEditValue={obEditValue}
        setObEditValue={setObEditValue}
        obEditMutation={obEditMutation as any}
        dueDialogSupplier={dueDialogSupplier}
        setDueDialogSupplier={setDueDialogSupplier}
        formatDate={formatDate}
        formatNum={formatNum}
        editObComm={editObComm}
        setEditObComm={setEditObComm}
        updateObCommissionMutation={updateObCommissionMutation as any}
      />

      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        onConfirm={() => {
          pendingDelete?.();
          setPendingDelete(null);
        }}
      />
      {AdminDialog}
    </div>
  );
}
