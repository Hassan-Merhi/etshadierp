import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Shield,
  Plus,
  Edit,
  ToggleLeft,
  ToggleRight,
  DollarSign,
  Users,
  UserCheck,
  UserX,
  Loader2,
  FileText,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useDateFormat } from "@/contexts/DateFormatContext";

interface Company {
  id: number;
  name: string;
  code: string;
}

interface InsuranceMember {
  id: number;
  companyId: number;
  name: string;
  nationality: string | null;
  positionWorking: string | null;
  insuranceNumber: string | null;
  startDate: string;
  amount: string;
  dob: string | null;
  notes: string | null;
  active: boolean;
  ledgerAccountId: number | null;
  createdAt: string;
}

interface LedgerEntry {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  description: string | null;
  debitAmount: string | null;
  creditAmount: string | null;
  narration: string | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

// ─── Member Form Dialog ───────────────────────────────────────────────────────
function MemberFormDialog({
  open,
  onClose,
  companyId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  companyId: number;
  existing?: InsuranceMember | null;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [nationality, setNationality] = useState(existing?.nationality ?? "");
  const [positionWorking, setPositionWorking] = useState(existing?.positionWorking ?? "");
  const [insuranceNumber, setInsuranceNumber] = useState(existing?.insuranceNumber ?? "");
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [dob, setDob] = useState(existing?.dob ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (existing) {
        const res = await fetch(`/api/insurance/members/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ...data, companyId }),
        });
        if (!res.ok) throw new Error((await res.json()).message || "Failed");
        return res.json();
      } else {
        const res = await fetch("/api/insurance/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error((await res.json()).message || "Failed");
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/members"] });
      toast({ title: existing ? "Member updated" : "Member added" });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!name.trim() || !startDate || !amount) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      companyId,
      name: name.trim(),
      nationality: nationality || null,
      positionWorking: positionWorking || null,
      insuranceNumber: insuranceNumber || null,
      startDate,
      amount,
      dob: dob || null,
      notes: notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Member" : "Add Insurance Member"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              data-testid="input-member-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nationality</Label>
              <Input
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                placeholder="e.g. Congolese"
                data-testid="input-member-nationality"
              />
            </div>
            <div className="space-y-1">
              <Label>Position / Working</Label>
              <Input
                value={positionWorking}
                onChange={(e) => setPositionWorking(e.target.value)}
                placeholder="e.g. Operator"
                data-testid="input-member-position"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Insurance Number</Label>
            <Input
              value={insuranceNumber}
              onChange={(e) => setInsuranceNumber(e.target.value)}
              placeholder="e.g. INS-00123"
              data-testid="input-member-insurance-number"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Start Date <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-member-startdate"
              />
            </div>
            <div className="space-y-1">
              <Label>Date of Birth</Label>
              <Input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                data-testid="input-member-dob"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Monthly Amount <span className="text-destructive">*</span></Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              data-testid="input-member-amount"
            />
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              className="resize-none"
              rows={2}
              data-testid="input-member-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-member">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saveMutation.isPending}
            data-testid="button-save-member"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {existing ? "Save Changes" : "Add Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Member Statement Drawer ──────────────────────────────────────────────────
function MemberStatementDrawer({
  member,
  companyId,
  onClose,
}: {
  member: InsuranceMember;
  companyId: number;
  onClose: () => void;
}) {
  const { formatDisplayDate } = useDateFormat();

  const { data: entries = [], isLoading } = useQuery<LedgerEntry[]>({
    queryKey: ["/api/insurance/members", member.id, "entries", companyId],
    queryFn: async () => {
      const res = await fetch(
        `/api/insurance/members/${member.id}/entries?companyId=${companyId}`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const runningBalance = useMemo(() => {
    let bal = 0;
    return entries.map((e) => {
      const dr = parseFloat(e.debitAmount || "0");
      const cr = parseFloat(e.creditAmount || "0");
      bal = bal + dr - cr;
      return { ...e, balance: bal };
    });
  }, [entries]);

  const totalCredit = entries.reduce((s, e) => s + parseFloat(e.creditAmount || "0"), 0);
  const totalDebit = entries.reduce((s, e) => s + parseFloat(e.debitAmount || "0"), 0);

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {member.name} — Insurance Statement
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {member.nationality && <span>{member.nationality} · </span>}
            {member.positionWorking && <span>{member.positionWorking} · </span>}
            <span>Started {formatDisplayDate(member.startDate)}</span>
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No entries posted yet for this member.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="pt-3 pb-3">
                    <p className="text-xs text-muted-foreground">Total Credited</p>
                    <p className="text-lg font-bold">${totalCredit.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-3 pb-3">
                    <p className="text-xs text-muted-foreground">Total Debited</p>
                    <p className="text-lg font-bold">${totalDebit.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-3 pb-3">
                    <p className="text-xs text-muted-foreground">Net Balance</p>
                    <p className="text-lg font-bold">${(totalCredit - totalDebit).toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runningBalance.map((e) => (
                    <TableRow key={e.id} data-testid={`row-entry-${e.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {formatDisplayDate(e.voucherDate)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.voucherNumber}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                        {e.narration || e.description || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(e.creditAmount || "0") > 0
                          ? `$${parseFloat(e.creditAmount!).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(e.debitAmount || "0") > 0
                          ? `$${parseFloat(e.debitAmount!).toFixed(2)}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FactoryInsurance() {
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const [, navigate] = useLocation();

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editMember, setEditMember] = useState<InsuranceMember | null>(null);
  const [statementMember, setStatementMember] = useState<InsuranceMember | null>(null);
  const [search, setSearch] = useState("");

  const [showGenDialog, setShowGenDialog] = useState(false);
  const [genMonth, setGenMonth] = useState(new Date().getMonth() + 1);
  const [genYear, setGenYear] = useState(new Date().getFullYear());

  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/user/companies"] });
  const firstCompanyId = companies.length > 0 ? companies[0].id : null;
  const selectedCompanyId = companyId ?? firstCompanyId;

  const { data: members = [], isLoading } = useQuery<InsuranceMember[]>({
    queryKey: ["/api/insurance/members", selectedCompanyId, includeInactive],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const params = new URLSearchParams({
        companyId: String(selectedCompanyId),
        includeInactive: String(includeInactive),
      });
      const res = await fetch(`/api/insurance/members?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const toggleMutation = useMutation({
    mutationFn: async (member: InsuranceMember) => {
      const res = await fetch(`/api/insurance/members/${member.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: member.companyId }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance/members"] });
      toast({ title: "Status updated" });
    },
    onError: (e: any) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/insurance/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, month: genMonth, year: genYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      setShowGenDialog(false);
      toast({
        title: `Insurance entries posted — ${data.period}`,
        description: (
          <span>
            {data.membersCount} member(s) · Total ${parseFloat(data.totalAmount).toFixed(2)}{" "}
            <button
              className="underline font-medium ml-1"
              onClick={() => navigate("/factory/daybook")}
            >
              View in Daybook
            </button>
          </span>
        ) as any,
      });
    },
    onError: (e: any) => {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    },
  });

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.toLowerCase();
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.nationality || "").toLowerCase().includes(q) ||
        (m.positionWorking || "").toLowerCase().includes(q)
    );
  }, [members, search]);

  const stats = useMemo(() => {
    const active = members.filter((m) => m.active);
    const inactive = members.filter((m) => !m.active);
    const totalAmount = active.reduce((s, m) => s + parseFloat(m.amount || "0"), 0);
    return { total: members.length, active: active.length, inactive: inactive.length, totalAmount };
  }, [members]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageHeader
          title="Insurance"
          subtitle="Manage insurance members and generate monthly entries"
        />
        <div className="flex items-center gap-2 flex-wrap">
          {companies.length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Company:</span>
              <Select
                value={selectedCompanyId ? String(selectedCompanyId) : ""}
                onValueChange={(v) => setCompanyId(parseInt(v))}
              >
                <SelectTrigger className="w-44" data-testid="select-company">
                  <SelectValue>
                    {companies.find((c) => c.id === selectedCompanyId)?.name ?? "Select company"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            onClick={() => setShowGenDialog(true)}
            disabled={!selectedCompanyId}
            data-testid="button-generate-entries"
          >
            <DollarSign className="h-4 w-4 mr-1" />
            Generate Entries
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowAddDialog(true)}
            disabled={!selectedCompanyId}
            data-testid="button-add-member"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Member
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Members</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-total">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400" data-testid="stat-active">
              {stats.active}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Inactive</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground" data-testid="stat-inactive">
              {stats.inactive}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Monthly Total</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-amount">
              ${stats.totalAmount.toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search by name, nationality, position..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search"
        />
        <div className="flex items-center gap-2">
          <Switch
            id="show-inactive"
            checked={includeInactive}
            onCheckedChange={setIncludeInactive}
            data-testid="switch-show-inactive"
          />
          <Label htmlFor="show-inactive" className="text-sm cursor-pointer">
            Show inactive
          </Label>
        </div>
      </div>

      {/* Members Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Shield className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">
                {members.length === 0
                  ? "No insurance members yet. Add one to get started."
                  : "No members match your search."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Insurance No.</TableHead>
                  <TableHead>Nationality</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Date of Birth</TableHead>
                  <TableHead className="text-right">Monthly Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((m) => (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer"
                    onClick={() => setStatementMember(m)}
                    data-testid={`row-member-${m.id}`}
                  >
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="font-mono text-sm">{m.insuranceNumber || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{m.nationality || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{m.positionWorking || "—"}</TableCell>
                    <TableCell>{formatDisplayDate(m.startDate)}</TableCell>
                    <TableCell>{m.dob ? formatDisplayDate(m.dob) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(m.amount).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {m.active ? (
                        <Badge
                          variant="secondary"
                          className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          data-testid={`badge-status-${m.id}`}
                        >
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-status-${m.id}`}>
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditMember(m)}
                          title="Edit member"
                          data-testid={`button-edit-${m.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleMutation.mutate(m)}
                          title={m.active ? "Deactivate" : "Activate"}
                          data-testid={`button-toggle-${m.id}`}
                        >
                          {m.active ? (
                            <ToggleRight className="h-4 w-4 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Member Statement Drawer */}
      {statementMember && selectedCompanyId && (
        <MemberStatementDrawer
          member={statementMember}
          companyId={selectedCompanyId}
          onClose={() => setStatementMember(null)}
        />
      )}

      {/* Add / Edit Member Dialog */}
      {(showAddDialog || editMember) && selectedCompanyId && (
        <MemberFormDialog
          open={showAddDialog || !!editMember}
          onClose={() => {
            setShowAddDialog(false);
            setEditMember(null);
          }}
          companyId={selectedCompanyId}
          existing={editMember}
        />
      )}

      {/* Generate Entries Dialog */}
      <Dialog open={showGenDialog} onOpenChange={(v) => !v && setShowGenDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate Insurance Entries</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Posts a journal voucher for all active members: Dr Insurance Expense / Cr each
              member's personal account. Members whose start date falls within the month are
              prorated.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Month</Label>
                <Select
                  value={String(genMonth)}
                  onValueChange={(v) => setGenMonth(parseInt(v))}
                >
                  <SelectTrigger data-testid="select-gen-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Year</Label>
                <Select
                  value={String(genYear)}
                  onValueChange={(v) => setGenYear(parseInt(v))}
                >
                  <SelectTrigger data-testid="select-gen-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenDialog(false)} data-testid="button-cancel-gen">
              Cancel
            </Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-confirm-gen"
            >
              {generateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
