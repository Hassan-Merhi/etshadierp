import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Plus, Trash2, RotateCcw, Banknote, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
}

interface AdvanceRecord {
  id: number;
  employeeId: number;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  cashAccountId: number | null;
  cashAccountName: string | null;
  notes: string | null;
  fullyPaid: boolean;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

interface RepaymentRecord {
  id: number;
  advanceId: number;
  employeeId: number;
  repaymentDate: string;
  amount: string;
  notes: string | null;
  firstName: string;
  lastName: string;
}

interface CashAccount { id: number; name: string; code: string; }

function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const today = () => new Date().toLocaleDateString('en-CA');

export default function FactoryEmployeeAdvancesTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "paid">("open");
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState<AdvanceRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AdvanceRecord | null>(null);

  const [addForm, setAddForm] = useState({ employeeId: "", advanceDate: today(), amount: "", cashAccountId: "", notes: "" });
  const [repayForm, setRepayForm] = useState({ repaymentDate: today(), amount: "", cashAccountId: "", notes: "" });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/factory/employees"],
    queryFn: async () => {
      const res = await fetch("/api/factory/employees", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: cashAccounts = [] } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/factory/cash-accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const qKey = useMemo(() => ["/api/factory/employee-advances", statusFilter, empFilter], [statusFilter, empFilter]);

  const { data: advances = [], isLoading } = useQuery<AdvanceRecord[]>({
    queryKey: qKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (empFilter !== "all") params.set("employeeId", empFilter);
      const res = await fetch(`/api/factory/employee-advances?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: repayments = [] } = useQuery<RepaymentRecord[]>({
    queryKey: ["/api/factory/employee-advance-repayments"],
    queryFn: async () => {
      const res = await fetch("/api/factory/employee-advance-repayments", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/factory/employee-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeId: parseInt(addForm.employeeId),
          advanceDate: addForm.advanceDate,
          amount: addForm.amount,
          cashAccountId: addForm.cashAccountId || null,
          notes: addForm.notes || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Advance recorded" });
      setAddOpen(false);
      setAddForm({ employeeId: "", advanceDate: today(), amount: "", cashAccountId: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employee-advances"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const repayMutation = useMutation({
    mutationFn: async () => {
      if (!repayOpen) return;
      const res = await fetch(`/api/factory/employee-advances/${repayOpen.id}/repay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          repaymentDate: repayForm.repaymentDate,
          amount: repayForm.amount,
          cashAccountId: repayForm.cashAccountId || null,
          notes: repayForm.notes || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Repayment recorded" });
      setRepayOpen(null);
      setRepayForm({ repaymentDate: today(), amount: "", cashAccountId: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employee-advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employee-advance-repayments"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/employee-advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Advance deleted" });
      setDeleteConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employee-advances"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalOutstanding = useMemo(() =>
    advances.filter((a) => !a.fullyPaid).reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0)
  , [advances]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Employee</Label>
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger className="w-44" data-testid="select-emp-filter">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="paid">Fully Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => setAddOpen(true)} data-testid="button-add-advance">
          <Plus className="h-4 w-4 mr-2" /> Add Advance
        </Button>
      </div>

      {!isLoading && advances.some((a) => !a.fullyPaid) && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <Banknote className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            Outstanding advances: <strong>{fmt(totalOutstanding)}</strong>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : advances.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No advances found.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="hidden sm:block rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((adv) => (
                  <TableRow key={adv.id} data-testid={`row-advance-${adv.id}`}>
                    <TableCell className="font-medium">{adv.firstName} {adv.lastName}</TableCell>
                    <TableCell className="text-sm">{adv.advanceDate}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(adv.amount)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {adv.fullyPaid ? <span className="text-muted-foreground">—</span> : fmt(adv.remainingBalance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={adv.fullyPaid ? "outline" : "secondary"}>
                        {adv.fullyPaid ? "Paid" : "Open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-32 truncate">{adv.notes || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {!adv.fullyPaid && (
                          <Button size="sm" variant="outline" onClick={() => { setRepayOpen(adv); setRepayForm({ repaymentDate: today(), amount: adv.remainingBalance, cashAccountId: "", notes: "" }); }} data-testid={`button-repay-${adv.id}`}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Repay
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => setDeleteConfirm(adv)} data-testid={`button-delete-advance-${adv.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="sm:hidden space-y-2">
            {advances.map((adv) => (
              <Card key={adv.id} data-testid={`card-advance-${adv.id}`}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{adv.firstName} {adv.lastName}</p>
                      <p className="text-xs text-muted-foreground">{adv.advanceDate}</p>
                    </div>
                    <Badge variant={adv.fullyPaid ? "outline" : "secondary"} className="shrink-0">
                      {adv.fullyPaid ? "Paid" : "Open"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono text-right">{fmt(adv.amount)}</span>
                    {!adv.fullyPaid && (
                      <>
                        <span className="text-muted-foreground">Remaining</span>
                        <span className="font-mono text-right text-amber-600">{fmt(adv.remainingBalance)}</span>
                      </>
                    )}
                  </div>
                  {adv.notes && <p className="text-xs text-muted-foreground">{adv.notes}</p>}
                  <div className="flex gap-2 pt-1">
                    {!adv.fullyPaid && (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => { setRepayOpen(adv); setRepayForm({ repaymentDate: today(), amount: adv.remainingBalance, cashAccountId: "", notes: "" }); }}>
                        <RotateCcw className="h-3 w-3 mr-1" /> Repay
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => setDeleteConfirm(adv)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Employee Advance</DialogTitle>
            <DialogDescription>Record an advance paid to an employee.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Employee</Label>
              <Select value={addForm.employeeId} onValueChange={(v) => setAddForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger data-testid="select-add-employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={addForm.advanceDate} onChange={(e) => setAddForm((f) => ({ ...f, advanceDate: e.target.value }))} data-testid="input-advance-date" />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={addForm.amount} onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))} data-testid="input-advance-amount" />
              </div>
            </div>
            <div>
              <Label>Cash Account (optional)</Label>
              <Select value={addForm.cashAccountId} onValueChange={(v) => setAddForm((f) => ({ ...f, cashAccountId: v }))}>
                <SelectTrigger data-testid="select-cash-account">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes..." value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-advance-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !addForm.employeeId || !addForm.amount} data-testid="button-confirm-add-advance">
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!repayOpen} onOpenChange={(o) => !o && setRepayOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Repayment</DialogTitle>
            <DialogDescription>
              {repayOpen && `Advance of ${fmt(repayOpen.amount)} — Remaining: ${fmt(repayOpen.remainingBalance)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={repayForm.repaymentDate} onChange={(e) => setRepayForm((f) => ({ ...f, repaymentDate: e.target.value }))} data-testid="input-repay-date" />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={repayForm.amount} onChange={(e) => setRepayForm((f) => ({ ...f, amount: e.target.value }))} data-testid="input-repay-amount" />
              </div>
            </div>
            <div>
              <Label>Cash Account (optional)</Label>
              <Select value={repayForm.cashAccountId} onValueChange={(v) => setRepayForm((f) => ({ ...f, cashAccountId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes..." value={repayForm.notes} onChange={(e) => setRepayForm((f) => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-repay-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepayOpen(null)}>Cancel</Button>
            <Button onClick={() => repayMutation.mutate()} disabled={repayMutation.isPending || !repayForm.amount} data-testid="button-confirm-repay">
              {repayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Record Repayment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Advance</DialogTitle>
            <DialogDescription>
              This will permanently delete the advance of {deleteConfirm && fmt(deleteConfirm.amount)} for {deleteConfirm?.firstName} {deleteConfirm?.lastName} along with all repayments. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)} disabled={deleteMutation.isPending} data-testid="button-confirm-delete-advance">
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
