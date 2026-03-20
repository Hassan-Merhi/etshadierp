import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Search, ChevronDown, ChevronRight, DollarSign, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  department: string | null;
  employeeType: string;
  monthlySalary: string | null;
  active: boolean;
}

interface WorkerGroup {
  id: number;
  name: string;
  members: { id: number }[];
}

interface LedgerAccount {
  id: number;
  name: string;
  code: string;
  accountType: string;
}

export default function ERPRunPayroll() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<number | string, boolean>>({});
  const [selectedWorkers, setSelectedWorkers] = useState<Set<number>>(new Set());
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payAccountId, setPayAccountId] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const { data: allEmployees, isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: workerGroupsRaw = [], isLoading: groupsLoading } = useQuery<WorkerGroup[]>({
    queryKey: ["/api/worker-groups/with-members"],
    queryFn: async () => {
      const res = await fetch("/api/worker-groups/with-members", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/ledger-accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const cashAccounts = useMemo(
    () => ledgerAccounts.filter((a) => a.accountType === "Cash"),
    [ledgerAccounts],
  );

  const workers = useMemo(
    () => (allEmployees || []).filter((e) => e.employeeType === "Worker" && e.active),
    [allEmployees],
  );

  const workerGroups = useMemo(
    () => workerGroupsRaw.filter((g: any) => {
      const type = g.groupType || g.group_type;
      return !type || type === "Worker";
    }),
    [workerGroupsRaw],
  );

  const workerMemberships = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const g of workerGroups) {
      for (const m of g.members || []) {
        if (!map[m.id]) map[m.id] = [];
        map[m.id].push(g.id);
      }
    }
    return map;
  }, [workerGroups]);

  const ungroupedWorkers = useMemo(
    () => workers.filter((w) => !(workerMemberships[w.id]?.length)),
    [workers, workerMemberships],
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return new Set(workers.map((w) => w.id));
    const q = searchQuery.toLowerCase();
    return new Set(
      workers
        .filter((w) => `${w.firstName} ${w.lastName}`.toLowerCase().includes(q) || w.code?.toLowerCase().includes(q) || (w.department || "").toLowerCase().includes(q))
        .map((w) => w.id),
    );
  }, [workers, searchQuery]);

  const workerById = useMemo(() => {
    const map: Record<number, Employee> = {};
    for (const w of workers) map[w.id] = w;
    return map;
  }, [workers]);

  function toggleGroup(key: number | string) {
    setExpandedGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  function toggleWorker(id: number) {
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
    setAmounts((prev) => {
      if (prev[id]) return prev;
      const w = workerById[id];
      return { ...prev, [id]: w?.monthlySalary || "" };
    });
  }

  function toggleGroupSelection(memberIds: number[]) {
    const visibleIds = memberIds.filter((id) => filtered.has(id));
    const allSelected = visibleIds.every((id) => selectedWorkers.has(id));
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (allSelected) { visibleIds.forEach((id) => next.delete(id)); }
      else {
        visibleIds.forEach((id) => {
          next.add(id);
          if (!amounts[id]) {
            const w = workerById[id];
            setAmounts((pa) => ({ ...pa, [id]: w?.monthlySalary || "" }));
          }
        });
      }
      return next;
    });
  }

  function openPayDialog() {
    const updated: Record<number, string> = { ...amounts };
    for (const id of selectedWorkers) {
      if (!updated[id]) {
        const w = workerById[id];
        updated[id] = w?.monthlySalary || "";
      }
    }
    setAmounts(updated);
    setPayDialogOpen(true);
  }

  const totalPayable = useMemo(() => {
    return Array.from(selectedWorkers).reduce((s, id) => s + parseFloat(amounts[id] || "0"), 0);
  }, [selectedWorkers, amounts]);

  const payMutation = useMutation({
    mutationFn: async () => {
      const payments = Array.from(selectedWorkers)
        .map((id) => ({ workerId: id, amount: amounts[id] || "0" }))
        .filter((p) => parseFloat(p.amount) > 0);
      if (!payAccountId) throw new Error("Please select a payment account");
      if (payments.length === 0) throw new Error("No workers with valid amounts");
      const res = await apiRequest("POST", "/api/payroll/bulk-pay-workers", {
        payments,
        paymentAccountId: parseInt(payAccountId),
        date: payDate,
        notes: payNotes || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to process payroll");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/worker-payments-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({ title: "Payroll processed", description: `${selectedWorkers.size} worker(s) paid successfully` });
      setPayDialogOpen(false);
      setSelectedWorkers(new Set());
      setAmounts({});
      setPayNotes("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isLoading = empLoading || groupsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-md" />)}
        </div>
      </div>
    );
  }

  function renderWorkerCard(worker: Employee) {
    if (!filtered.has(worker.id)) return null;
    const fullName = `${worker.firstName} ${worker.lastName}`.trim();
    const isSelected = selectedWorkers.has(worker.id);
    return (
      <div
        key={worker.id}
        className={`cursor-pointer rounded-md transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
        onClick={() => toggleWorker(worker.id)}
        data-testid={`card-worker-${worker.id}`}
      >
        <Card className={`hover-elevate h-full ${isSelected ? "bg-primary/5" : ""}`}>
          <CardContent className="p-4 flex flex-col h-full">
            <div className="flex items-start justify-between mb-3">
              <Avatar className={`h-12 w-12 text-sm font-semibold ${getAvatarColor(fullName)}`}>
                <AvatarFallback className={getAvatarColor(fullName)}>
                  {getInitials(fullName)}
                </AvatarFallback>
              </Avatar>
              <Badge
                variant={worker.active ? "default" : "secondary"}
                className="text-xs no-default-active-elevate"
                data-testid={`badge-status-${worker.id}`}
              >
                {worker.active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm leading-tight" data-testid={`text-name-${worker.id}`}>
                {fullName}
              </p>
              {worker.department && (
                <p className="text-xs text-muted-foreground mt-0.5">{worker.department}</p>
              )}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground font-mono" data-testid={`text-code-${worker.id}`}>
                {worker.code || "—"}
              </span>
              {worker.monthlySalary && (
                <span className="text-xs font-medium text-muted-foreground">
                  {formatAmount(parseFloat(worker.monthlySalary))}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderGroup(label: string, memberIds: number[], groupKey: number | string) {
    const visibleMembers = memberIds.filter((id) => filtered.has(id) && workerById[id]);
    if (visibleMembers.length === 0) return null;
    const isExpanded = expandedGroups[groupKey] ?? true;
    const allSelected = visibleMembers.every((id) => selectedWorkers.has(id));
    const someSelected = visibleMembers.some((id) => selectedWorkers.has(id));
    return (
      <div key={groupKey} className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleGroup(groupKey)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
            data-testid={`group-toggle-${groupKey}`}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {label}
            <span className="text-xs font-normal text-muted-foreground">({visibleMembers.length})</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-6 px-2"
            onClick={() => toggleGroupSelection(memberIds)}
            data-testid={`group-select-all-${groupKey}`}
          >
            {allSelected ? "Deselect all" : someSelected ? "Select rest" : "Select all"}
          </Button>
        </div>
        {isExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleMembers.map((id) => renderWorkerCard(workerById[id]))}
          </div>
        )}
      </div>
    );
  }

  const hasResults = workers.some((w) => filtered.has(w.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-workers"
          />
        </div>
        <div className="flex items-center gap-2">
          {selectedWorkers.size > 0 && (
            <span className="text-sm text-muted-foreground">
              {selectedWorkers.size} selected — {formatAmount(totalPayable)}
            </span>
          )}
          <Button
            onClick={openPayDialog}
            disabled={selectedWorkers.size === 0}
            data-testid="button-run-payroll"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Pay Selected ({selectedWorkers.size})
          </Button>
        </div>
      </div>

      {!hasResults ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="mx-auto h-10 w-10 mb-3 opacity-40" />
          <p className="font-medium">
            {searchQuery ? "No workers match your search" : "No active workers found"}
          </p>
          <p className="text-sm mt-1">
            {searchQuery ? "Try adjusting your search" : "Add workers from the Workers tab"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {workerGroups.map((group) =>
            renderGroup(
              group.name,
              (group.members || []).map((m) => m.id),
              group.id,
            ),
          )}
          {ungroupedWorkers.filter((w) => filtered.has(w.id)).length > 0 &&
            renderGroup("Ungrouped", ungroupedWorkers.map((w) => w.id), "ungrouped")}
        </div>
      )}

      <Dialog open={payDialogOpen} onOpenChange={(open) => { if (!open) setPayDialogOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-run-payroll">
          <DialogHeader>
            <DialogTitle>Process Payroll</DialogTitle>
            <DialogDescription>
              Review and confirm payment for {selectedWorkers.size} worker(s). Total: {formatAmount(totalPayable)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  data-testid="input-pay-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Account</Label>
                <Select value={payAccountId} onValueChange={setPayAccountId}>
                  <SelectTrigger data-testid="select-pay-account">
                    <SelectValue placeholder="Select cash account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.length === 0 ? (
                      <SelectItem value="__none" disabled>No cash accounts found</SelectItem>
                    ) : cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="e.g. March 2026 payroll"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="resize-none"
                rows={2}
                data-testid="input-pay-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>Workers & Amounts</Label>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead>Dept.</TableHead>
                      <TableHead className="w-40">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(selectedWorkers).map((id) => {
                      const w = workerById[id];
                      if (!w) return null;
                      const fullName = `${w.firstName} ${w.lastName}`.trim();
                      return (
                        <TableRow key={id} data-testid={`row-pay-worker-${id}`}>
                          <TableCell className="font-medium">{fullName}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{w.department || "—"}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              className="h-8 text-sm"
                              value={amounts[id] || ""}
                              onChange={(e) => setAmounts((prev) => ({ ...prev, [id]: e.target.value }))}
                              data-testid={`input-amount-${id}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground text-right">
                Total: <span className="font-semibold">{formatAmount(totalPayable)}</span>
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayDialogOpen(false)} data-testid="button-cancel-pay">
              Cancel
            </Button>
            <Button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending || !payAccountId || totalPayable <= 0}
              data-testid="button-confirm-pay"
            >
              {payMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
              ) : (
                <><DollarSign className="h-4 w-4 mr-2" />Process Payroll</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
