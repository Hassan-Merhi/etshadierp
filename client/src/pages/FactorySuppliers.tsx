import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Users, Phone, Mail, MapPin,
  FileText, Package, Weight, DollarSign, Calendar, ArrowLeft,
  ChevronRight, Clock, X
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

interface StatementResponse {
  supplier: FactorySupplier;
  statement: StatementEntry[];
  summary: {
    totalContainers: number;
    totalKg: string;
    totalValue: string;
    totalCommissions: string;
    netPayable: string;
  };
}

export default function FactorySuppliers() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<FactorySupplier | null>(null);
  const [statementSupplierId, setStatementSupplierId] = useState<number | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
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

  const resetForm = () => {
    setFormData({ name: "", contactPerson: "", phone: "", email: "", address: "", notes: "" });
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
    return new Date(val).toLocaleDateString();
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

  const activeSuppliers = suppliers?.filter((s) => s.isActive) || [];
  const inactiveSuppliers = suppliers?.filter((s) => !s.isActive) || [];
  const displayedSuppliers = showInactive ? suppliers || [] : activeSuppliers;

  const totalBalance = activeSuppliers.reduce((sum, s) => sum + parseFloat(s.totalValue || "0"), 0);
  const totalContainers = activeSuppliers.reduce((sum, s) => sum + (s.totalContainers || 0), 0);

  if (statementSupplierId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setStatementSupplierId(null)}
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
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Commissions</div>
                  <div className="text-xl font-bold mt-1 text-destructive" data-testid="text-statement-commissions">
                    ${formatNum(statementData.summary.totalCommissions)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Net Payable</div>
                  <div className="text-xl font-bold mt-1" data-testid="text-statement-net-payable">
                    ${formatNum(statementData.summary.netPayable)}
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
          {displayedSuppliers.length > 0 ? (
            <div className="divide-y">
              {displayedSuppliers.map((s) => (
                <div
                  key={s.id}
                  className={`p-4 ${!s.isActive ? "opacity-60" : ""}`}
                  data-testid={`row-factory-supplier-${s.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => setStatementSupplierId(s.id)}
                          className="text-base font-semibold hover:underline text-left"
                          data-testid={`link-supplier-statement-${s.id}`}
                        >
                          {s.name}
                        </button>
                        {!s.isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                        {s.pendingContainers > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {s.pendingContainers} pending
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                        {s.contactPerson && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            {s.contactPerson}
                          </span>
                        )}
                        {s.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {s.phone}
                          </span>
                        )}
                        {s.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" />
                            {s.email}
                          </span>
                        )}
                        {s.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {s.address}
                          </span>
                        )}
                      </div>

                      {s.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{s.notes}</p>
                      )}

                      <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                        <span className="flex items-center gap-1" data-testid={`text-supplier-containers-${s.id}`}>
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                          {s.totalContainers} container{s.totalContainers !== 1 ? "s" : ""}
                        </span>
                        <span className="flex items-center gap-1" data-testid={`text-supplier-kg-${s.id}`}>
                          <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                          {formatKg(s.totalKg)}
                        </span>
                        {s.lastContainerDate && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            Last: {formatDate(s.lastContainerDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Balance</div>
                        <div className="text-lg font-bold tabular-nums" data-testid={`text-supplier-balance-${s.id}`}>
                          ${formatNum(s.totalValue)}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                          data-testid={`button-edit-supplier-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {s.isActive && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(s.id); }}
                            data-testid={`button-delete-supplier-${s.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setStatementSupplierId(s.id)}
                        data-testid={`button-view-statement-${s.id}`}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
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

      <Dialog open={createOpen || !!editingSupplier} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingSupplier(null); resetForm(); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Edit Supplier" : "Add Factory Supplier"}</DialogTitle>
            <DialogDescription>
              {editingSupplier ? "Update supplier details" : "Create a new factory supplier"}
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
