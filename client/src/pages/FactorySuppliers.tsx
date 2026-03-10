import { useState } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Users, Phone, Mail, MapPin,
  FileText, Package, Weight, Calendar, ArrowLeft,
  ChevronRight, ChevronDown, Clock, X, GitBranch, DollarSign
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

interface SupplierWithBalance extends FactorySupplier {
  totalContainers: number;
  totalKg: string;
  totalValue: string;
  pendingContainers: number;
  receivedContainers: number;
  lastContainerDate: string | null;
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

interface StatementResponse {
  supplier: FactorySupplier;
  statement: StatementEntry[];
  obCommissions: ObCommission[];
  payments: SupplierPayment[];
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
  const [formData, setFormData] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
    parentId: null as number | null,
  });
  const { toast } = useToast();

  const { data: suppliers, isLoading } = useQuery<SupplierWithBalance[]>({
    queryKey: ["/api/factory/suppliers/with-balances"],
  });

  const { data: statementData, isLoading: statementLoading } = useQuery<StatementResponse>({
    queryKey: ["/api/factory/suppliers", statementSupplierId, "statement"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", `/api/factory/suppliers/${statementSupplierId}/statement`);
      return res.json();
    },
    enabled: !!statementSupplierId,
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

  const resetForm = () => {
    setFormData({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "", parentId: null });
    setCreateSubAccountParentId(null);
  };

  const openEdit = (s: FactorySupplier) => {
    setEditingSupplier(s);
    setFormData({
      name: s.name,
      contactPerson: s.contactPerson || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      notes: s.notes || "",
      parentId: (s as any).parentId ?? null,
    });
  };

  const openCreateSubAccount = (parentSupplier: SupplierWithBalance) => {
    resetForm();
    setFormData(prev => ({ ...prev, parentId: parentSupplier.id }));
    setCreateSubAccountParentId(parentSupplier.id);
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
  const displayedTopLevel = showInactive ? topLevelSuppliers : topLevelSuppliers.filter((s) => s.isActive);
  // Sub-accounts by parentId
  const subAccountsByParent: Record<number, SupplierWithBalance[]> = {};
  for (const s of allSuppliers) {
    const pid = (s as any).parentId;
    if (pid) {
      if (!subAccountsByParent[pid]) subAccountsByParent[pid] = [];
      subAccountsByParent[pid].push(s);
    }
  }

  const activeTopLevel = topLevelSuppliers.filter((s) => s.isActive);
  const totalBalance = activeTopLevel.reduce((sum, s) => sum + parseFloat(s.totalValue || "0"), 0);
  const totalContainers = activeTopLevel.reduce((sum, s) => sum + (s.totalContainers || 0), 0);

  // ── Parent Supplier Overview ──────────────────────────────────────────────
  if (parentViewSupplierId && !statementSupplierId) {
    const parentSup = allSuppliers.find(s => s.id === parentViewSupplierId);
    const children = subAccountsByParent[parentViewSupplierId] || [];

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
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-parent-supplier-name">
              {parentSup?.name || "Loading..."}
            </h1>
            <p className="text-muted-foreground text-sm">
              {children.length} sub-account{children.length !== 1 ? "s" : ""}
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
              Own Statement
            </Button>
          )}
        </div>

        {/* Parent totals card */}
        {parentSup && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total Balance (approx. USD)</div>
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
                <div className="text-xs text-muted-foreground">Sub-accounts</div>
                <div className="text-2xl font-bold mt-1">
                  {children.length}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Sub-accounts list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              Sub-accounts &amp; Commission Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {children.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No sub-accounts yet</p>
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
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Balance</div>
                        <div className="text-base font-bold tabular-nums" data-testid={`text-child-balance-${child.id}`}>
                          ~${formatNum(child.totalValue)}
                        </div>
                        <div className="text-xs text-muted-foreground">approx. USD</div>
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
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-statement-supplier-name">
              {statementData?.supplier?.name || "Loading..."}
            </h1>
            <p className="text-muted-foreground text-sm">Full Supplier Statement</p>
          </div>
        </div>

        {statementLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
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

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Container History</CardTitle>
              </CardHeader>
              <CardContent>
                {statementData.statement.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Container</TableHead>
                          <TableHead>Origin</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Declared Kg</TableHead>
                          <TableHead className="text-right">Actual Kg</TableHead>
                          <TableHead className="text-right">Diff</TableHead>
                          <TableHead className="text-right">Rate/Kg</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.statement.map((entry, idx) => {
                          const runningTotal = statementData.statement
                            .slice(0, idx + 1)
                            .reduce((sum, e) => sum + parseFloat(e.value), 0);

                          return (
                            <TableRow key={entry.id} data-testid={`row-statement-${entry.id}`}>
                              <TableCell className="whitespace-nowrap text-sm">
                                {formatDate(entry.date)}
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {entry.containerNumber}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {entry.origin || "-"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={statusColor(entry.status)} className="text-xs">
                                  {entry.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {formatKg(entry.declaredKg)}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {formatKg(entry.actualReceivedKg || entry.totalKg)}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {entry.differenceKg && parseFloat(entry.differenceKg) !== 0 ? (
                                  <span className={parseFloat(entry.differenceKg) < 0 ? "text-destructive" : ""}>
                                    {formatKg(entry.differenceKg)}
                                  </span>
                                ) : "-"}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {entry.ratePerKg ? `$${parseFloat(entry.ratePerKg).toFixed(4)}` : "-"}
                              </TableCell>
                              <TableCell className="text-right text-sm font-medium tabular-nums">
                                ${formatNum(entry.value)}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums text-destructive">
                                {parseFloat(entry.totalCommission) > 0 ? `$${formatNum(entry.totalCommission)}` : "-"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-32 truncate">
                                {entry.notes || "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={4}>TOTAL</TableCell>
                          <TableCell className="text-right tabular-nums">-</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatKg(statementData.summary.totalKg)}
                          </TableCell>
                          <TableCell>-</TableCell>
                          <TableCell>-</TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${formatNum(statementData.summary.totalValue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive">
                            {parseFloat(statementData.summary.totalCommissions) > 0
                              ? `$${formatNum(statementData.summary.totalCommissions)}`
                              : "-"}
                          </TableCell>
                          <TableCell>-</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-lg font-medium">No containers from this supplier</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {statementData.obCommissions && statementData.obCommissions.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Opening Balance Commissions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Person</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Amount (USD)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.obCommissions.map((oc) => (
                          <TableRow key={oc.rawStockId}>
                            <TableCell className="text-sm whitespace-nowrap">{formatDate(oc.date)}</TableCell>
                            <TableCell className="text-sm font-mono">{oc.containerNumber}</TableCell>
                            <TableCell className="text-sm">{oc.personName || "-"}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {oc.currencyCode !== "USD" ? `${oc.currencyCode} ` : "$"}{formatNum(oc.amount)}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              ${formatNum(oc.amountUsd)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={3}>Total Commissions</TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            ${formatNum(statementData.summary.totalObCommissions)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {statementData.payments && statementData.payments.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Payments</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">USD Amount</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statementData.payments.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-sm whitespace-nowrap">{formatDate(p.date)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{p.notes || "-"}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {p.currencyCode !== "USD" ? `${p.currencyCode} ` : "$"}{formatNum(p.amount)}
                              {p.currencyCode !== "USD" && p.fxRateToUsd && (
                                <span className="text-xs text-muted-foreground ml-1">@ {formatNum(p.fxRateToUsd)}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              ${formatNum(p.amountUsd)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { if (confirm("Delete this payment?")) deletePaymentMutation.mutate(p.id); }}
                                data-testid={`button-delete-payment-${p.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="border-t-2 font-bold">
                          <TableCell colSpan={2}>Total Paid</TableCell>
                          <TableCell />
                          <TableCell className="text-right tabular-nums">
                            ${formatNum(statementData.summary.totalPayments)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

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
          <h1 className="text-3xl font-bold tracking-tight">Factory Suppliers</h1>
          <p className="text-muted-foreground mt-1">
            {activeSuppliers.length} active supplier{activeSuppliers.length !== 1 ? "s" : ""}
            {inactiveSuppliers.length > 0 && ` / ${inactiveSuppliers.length} inactive`}
          </p>
        </div>
        <div className="flex gap-2">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Active Suppliers</div>
            <div className="text-2xl font-bold mt-1" data-testid="text-total-suppliers">
              {activeSuppliers.length}
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
            <div className="text-xs text-muted-foreground">Total Balance</div>
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
                          {isChild && <Badge variant="outline" className="text-xs">Sub-account</Badge>}
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
                          <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${sup.id}`}>
                            {isParent ? "~" : ""}${formatNum(sup.totalValue)}
                          </div>
                          {isParent && (
                            <div className="text-xs text-muted-foreground">approx. USD</div>
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
                              title="Add Sub-Account"
                              data-testid={`button-add-subaccount-${sup.id}`}
                            >
                              <GitBranch className="h-4 w-4" />
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
                        {paymentDialogSupplier.name} (main)
                      </SelectItem>
                      {children.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} (sub-account)
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
              {editingSupplier ? "Edit Supplier" : createSubAccountParentId ? "Add Sub-Account" : "Add Factory Supplier"}
            </DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? "Update supplier details"
                : createSubAccountParentId
                  ? `Sub-account under: ${allSuppliers.find(s => s.id === createSubAccountParentId)?.name || ""}`
                  : "Create a new factory supplier"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
    </div>
  );
}
