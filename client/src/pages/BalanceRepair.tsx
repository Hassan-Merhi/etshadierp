import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Loader2, AlertTriangle, CheckCircle2,
  ScanSearch, Wrench, Undo2, Users, Building2, ShieldCheck,
} from "lucide-react";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Types ──────────────────────────────────────────────────────────────────
interface EmpDiscrepancy {
  id: number; name: string;
  storedBalance: number; computedBalance: number;
  storedDeposits: number; computedDeposits: number;
  storedWithdrawals: number; computedWithdrawals: number;
  diff: number;
}
interface LedgerDiscrepancy {
  id: number; contractId: number; year: number; month: number;
  module: string; storedPaid: number; computedPaid: number; diff: number;
}
interface DepositDiscrepancy {
  contractId: number; tenantName: string; unitLabel: string;
  module: string; guaranteeAmount: number;
  flagValue: boolean; voucherExists: boolean;
  issue: "STALE_FLAG" | "MISSING_FLAG";
}
interface ScanResult {
  employeeDiscrepancies: EmpDiscrepancy[];
  ledgerDiscrepancies:   LedgerDiscrepancy[];
  depositDiscrepancies:  DepositDiscrepancy[];
  totalDiscrepancies:    number;
}
interface EmpSnapshot {
  id: number; name: string;
  oldBalance: number; oldDeposits: number; oldWithdrawals: number;
  newBalance: number; newDeposits: number; newWithdrawals: number;
}
interface LedgerSnapshot {
  id: number; contractId: number; year: number; month: number;
  module: string; oldPaidAmount: number; newPaidAmount: number;
}
interface DepositSnapshot {
  contractId: number; tenantName: string; unitLabel: string;
  module: string; guaranteeAmount: number;
  oldFlag: boolean; newFlag: boolean;
  oldPostedAmount: number; newPostedAmount: number;
  issue: "STALE_FLAG" | "MISSING_FLAG";
}
interface ApplySnapshot {
  employeeSnapshots: EmpSnapshot[];
  ledgerSnapshots:   LedgerSnapshot[];
  depositSnapshots:  DepositSnapshot[];
}

type Phase = "idle" | "scanning" | "scanned" | "applying" | "applied" | "undoing";

// ── Module badge helper ────────────────────────────────────────────────────
function ModuleBadge({ module }: { module: string }) {
  const label = module === "ERP" ? "ERP Shops" : module === "FACTORY" ? "Factory" : "Properties";
  return <Badge variant="secondary">{label}</Badge>;
}

// ── Issue badge ────────────────────────────────────────────────────────────
function IssueBadge({ issue }: { issue: "STALE_FLAG" | "MISSING_FLAG" }) {
  return (
    <Badge variant="destructive">
      {issue === "STALE_FLAG" ? "Flag stale — no voucher" : "Voucher exists — flag missing"}
    </Badge>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function BalanceRepair() {
  const { toast } = useToast();
  const [phase, setPhase]           = useState<Phase>("idle");
  const [scan, setScan]             = useState<ScanResult | null>(null);
  const [snapshot, setSnapshot]     = useState<ApplySnapshot | null>(null);
  const [applied, setApplied]       = useState<{ emps: number; rows: number; deps: number } | null>(null);

  async function runScan() {
    setPhase("scanning"); setScan(null); setSnapshot(null); setApplied(null);
    try {
      const res  = await apiRequest("GET", "/api/admin/repair-balances/scan");
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const data: ScanResult = await res.json();
      setScan(data); setPhase("scanned");
      toast({
        title:       "Scan complete",
        description: data.totalDiscrepancies === 0
          ? "No discrepancies found — everything is balanced."
          : `Found ${data.totalDiscrepancies} discrepanc${data.totalDiscrepancies === 1 ? "y" : "ies"}.`,
      });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
      setPhase("idle");
    }
  }

  async function applyFixes() {
    setPhase("applying");
    try {
      const res  = await apiRequest("POST", "/api/admin/repair-balances/apply", {});
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const data = await res.json();
      setSnapshot(data.snapshot);
      setApplied({ emps: data.employeesFixed, rows: data.ledgerRowsFixed, deps: data.depositsFixed });
      setScan(null); setPhase("applied");
      toast({
        title:       "Fixes applied",
        description: `Fixed ${data.employeesFixed} employee balance(s), ${data.ledgerRowsFixed} rent ledger row(s), and ${data.depositsFixed} deposit flag(s).`,
      });
    } catch (e: any) {
      toast({ title: "Repair failed", description: e.message, variant: "destructive" });
      setPhase("scanned");
    }
  }

  async function undoFixes() {
    if (!snapshot) return;
    setPhase("undoing");
    try {
      const res  = await apiRequest("POST", "/api/admin/repair-balances/undo", { snapshot });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const data = await res.json();
      setSnapshot(null); setApplied(null); setScan(null); setPhase("idle");
      toast({
        title:       "Undo complete",
        description: `Restored ${data.employeesRestored} employee balance(s), ${data.ledgerRowsRestored} rent row(s), and ${data.depositsRestored} deposit flag(s).`,
      });
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
      setPhase("applied");
    }
  }

  const busy = phase === "scanning" || phase === "applying" || phase === "undoing";
  const total = scan?.totalDiscrepancies ?? 0;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Balance Repair Tool"
        subtitle="Scans stored balances and deposit flags against live voucher data. Corrects drift across all modules with one-click undo."
      />

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This tool checks three areas for the current company:
          {" "}<strong>employee advance balances</strong>,{" "}
          <strong>property rent ledger paid amounts</strong>, and{" "}
          <strong>tenant guarantee deposit flags</strong> across all shops (Properties, ERP, Factory).
          Scan first to preview, then apply to fix.
        </AlertDescription>
      </Alert>

      {/* ── Actions ── */}
      <Card>
        <CardHeader>
          <CardTitle>Run Balance Audit</CardTitle>
          <CardDescription>
            Scan first to preview discrepancies, then apply fixes. An undo snapshot is saved automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={runScan} disabled={busy} data-testid="button-scan-balances">
            {phase === "scanning"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ScanSearch className="mr-2 h-4 w-4" />}
            Scan for Discrepancies
          </Button>

          {phase === "scanned" && total > 0 && (
            <Button onClick={applyFixes} disabled={busy} data-testid="button-apply-fixes">
              {phase === "applying"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Wrench className="mr-2 h-4 w-4" />}
              Apply {total} Fix{total === 1 ? "" : "es"}
            </Button>
          )}

          {phase === "applied" && snapshot && (
            <Button variant="outline" onClick={undoFixes} disabled={busy} data-testid="button-undo-repair">
              {phase === "undoing"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Undo2 className="mr-2 h-4 w-4" />}
              Undo Repair
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Applied summary ── */}
      {phase === "applied" && applied && snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              Repair Applied
            </CardTitle>
            <CardDescription>
              {applied.emps} employee balance{applied.emps !== 1 ? "s" : ""} &middot; {applied.rows} rent ledger row{applied.rows !== 1 ? "s" : ""} &middot; {applied.deps} deposit flag{applied.deps !== 1 ? "s" : ""} corrected.
              Click <strong>Undo Repair</strong> above to revert all changes.
            </CardDescription>
          </CardHeader>

          {snapshot.employeeSnapshots.length > 0 && (
            <CardContent className="space-y-3">
              <p className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4" />Employee Balances Fixed</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Old Balance</TableHead>
                    <TableHead className="text-right">New Balance</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.employeeSnapshots.map(s => (
                    <TableRow key={s.id} data-testid={`row-emp-repair-${s.id}`}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(s.oldBalance)}</TableCell>
                      <TableCell className="text-right">{fmt(s.newBalance)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.newBalance >= s.oldBalance ? "default" : "secondary"}>
                          {s.newBalance >= s.oldBalance ? "+" : ""}{fmt(s.newBalance - s.oldBalance)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}

          {snapshot.ledgerSnapshots.length > 0 && (
            <CardContent className="space-y-3 pt-0">
              <p className="text-sm font-medium flex items-center gap-2"><Building2 className="h-4 w-4" />Rent Ledger Rows Fixed</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Contract</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Old Paid</TableHead>
                    <TableHead className="text-right">New Paid</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.ledgerSnapshots.map(s => (
                    <TableRow key={s.id} data-testid={`row-ledger-repair-${s.id}`}>
                      <TableCell><ModuleBadge module={s.module} /></TableCell>
                      <TableCell className="text-muted-foreground">#{s.contractId}</TableCell>
                      <TableCell>{MONTHS[s.month - 1]} {s.year}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(s.oldPaidAmount)}</TableCell>
                      <TableCell className="text-right">{fmt(s.newPaidAmount)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.newPaidAmount >= s.oldPaidAmount ? "default" : "secondary"}>
                          {s.newPaidAmount >= s.oldPaidAmount ? "+" : ""}{fmt(s.newPaidAmount - s.oldPaidAmount)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}

          {snapshot.depositSnapshots.length > 0 && (
            <CardContent className="space-y-3 pt-0">
              <p className="text-sm font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Tenant Deposit Flags Fixed</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead className="text-right">Deposit Amount</TableHead>
                    <TableHead className="text-right">Old Flag</TableHead>
                    <TableHead className="text-right">New Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.depositSnapshots.map(s => (
                    <TableRow key={s.contractId} data-testid={`row-deposit-repair-${s.contractId}`}>
                      <TableCell><ModuleBadge module={s.module} /></TableCell>
                      <TableCell className="font-medium">{s.unitLabel}</TableCell>
                      <TableCell>{s.tenantName}</TableCell>
                      <TableCell><IssueBadge issue={s.issue} /></TableCell>
                      <TableCell className="text-right">{fmt(s.guaranteeAmount)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.oldFlag ? "default" : "secondary"}>{s.oldFlag ? "Posted" : "Unposted"}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.newFlag ? "default" : "secondary"}>{s.newFlag ? "Posted" : "Unposted"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Scan: all clear ── */}
      {phase === "scanned" && scan && total === 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-sm">
              All balances and deposit flags are in sync. No discrepancies detected.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Scan: employee discrepancies ── */}
      {phase === "scanned" && scan && scan.employeeDiscrepancies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employee Balance Discrepancies
              <Badge variant="destructive" className="ml-1">{scan.employeeDiscrepancies.length}</Badge>
            </CardTitle>
            <CardDescription>
              The stored balance on these employees differs from what their voucher entries compute.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Stored Balance</TableHead>
                  <TableHead className="text-right">Computed Balance</TableHead>
                  <TableHead className="text-right">Stored Deposits</TableHead>
                  <TableHead className="text-right">Computed Deposits</TableHead>
                  <TableHead className="text-right">Stored Withdrawals</TableHead>
                  <TableHead className="text-right">Computed Withdrawals</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scan.employeeDiscrepancies.map(d => (
                  <TableRow key={d.id} data-testid={`row-emp-scan-${d.id}`}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(d.storedBalance)}</TableCell>
                    <TableCell className="text-right">{fmt(d.computedBalance)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(d.storedDeposits)}</TableCell>
                    <TableCell className="text-right">{fmt(d.computedDeposits)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(d.storedWithdrawals)}</TableCell>
                    <TableCell className="text-right">{fmt(d.computedWithdrawals)}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{fmt(d.diff)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Scan: rent ledger discrepancies ── */}
      {phase === "scanned" && scan && scan.ledgerDiscrepancies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Rent Ledger Discrepancies
              <Badge variant="destructive" className="ml-1">{scan.ledgerDiscrepancies.length}</Badge>
            </CardTitle>
            <CardDescription>
              The stored paid amount on these monthly rows differs from the sum of actual payment records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Contract</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Stored Paid</TableHead>
                  <TableHead className="text-right">Computed Paid</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scan.ledgerDiscrepancies.map(d => (
                  <TableRow key={d.id} data-testid={`row-ledger-scan-${d.id}`}>
                    <TableCell><ModuleBadge module={d.module} /></TableCell>
                    <TableCell className="text-muted-foreground">#{d.contractId}</TableCell>
                    <TableCell>{MONTHS[d.month - 1]} {d.year}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(d.storedPaid)}</TableCell>
                    <TableCell className="text-right">{fmt(d.computedPaid)}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{fmt(d.diff)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Scan: deposit flag discrepancies ── */}
      {phase === "scanned" && scan && scan.depositDiscrepancies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Tenant Deposit Flag Discrepancies
              <Badge variant="destructive" className="ml-1">{scan.depositDiscrepancies.length}</Badge>
            </CardTitle>
            <CardDescription>
              These contracts have a mismatch between the "deposit posted" flag and whether an actual
              guarantee voucher exists. Covers all modules — Properties, ERP Shops, and Factory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">Deposit Amount</TableHead>
                  <TableHead className="text-right">Current Flag</TableHead>
                  <TableHead className="text-right">Will Become</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scan.depositDiscrepancies.map(d => (
                  <TableRow key={d.contractId} data-testid={`row-deposit-scan-${d.contractId}`}>
                    <TableCell><ModuleBadge module={d.module} /></TableCell>
                    <TableCell className="font-medium">{d.unitLabel}</TableCell>
                    <TableCell>{d.tenantName}</TableCell>
                    <TableCell><IssueBadge issue={d.issue} /></TableCell>
                    <TableCell className="text-right">{fmt(d.guaranteeAmount)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={d.flagValue ? "default" : "secondary"}>
                        {d.flagValue ? "Posted" : "Unposted"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={!d.flagValue ? "default" : "secondary"}>
                        {!d.flagValue ? "Posted" : "Unposted"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
