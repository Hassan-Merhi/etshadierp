import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ScanSearch,
  Wrench,
  Undo2,
  Users,
  Building2,
} from "lucide-react";

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface EmpDiscrepancy {
  id: number;
  name: string;
  storedBalance: number;
  computedBalance: number;
  storedDeposits: number;
  computedDeposits: number;
  storedWithdrawals: number;
  computedWithdrawals: number;
  diff: number;
}

interface LedgerDiscrepancy {
  id: number;
  contractId: number;
  year: number;
  month: number;
  storedPaid: number;
  computedPaid: number;
  diff: number;
}

interface ScanResult {
  employeeDiscrepancies: EmpDiscrepancy[];
  ledgerDiscrepancies: LedgerDiscrepancy[];
  totalDiscrepancies: number;
}

interface EmpSnapshot {
  id: number;
  name: string;
  oldBalance: number;
  oldDeposits: number;
  oldWithdrawals: number;
  newBalance: number;
  newDeposits: number;
  newWithdrawals: number;
}

interface LedgerSnapshot {
  id: number;
  contractId: number;
  year: number;
  month: number;
  oldPaidAmount: number;
  newPaidAmount: number;
}

interface ApplySnapshot {
  employeeSnapshots: EmpSnapshot[];
  ledgerSnapshots: LedgerSnapshot[];
}

type Phase = "idle" | "scanning" | "scanned" | "applying" | "applied" | "undoing";

export default function BalanceRepair() {
  const { toast } = useToast();
  const [phase, setPhase]             = useState<Phase>("idle");
  const [scan, setScan]               = useState<ScanResult | null>(null);
  const [snapshot, setSnapshot]       = useState<ApplySnapshot | null>(null);
  const [appliedCounts, setApplied]   = useState<{ emps: number; rows: number } | null>(null);

  async function runScan() {
    setPhase("scanning");
    setScan(null);
    setSnapshot(null);
    setApplied(null);
    try {
      const res  = await apiRequest("GET", "/api/admin/repair-balances/scan");
      const data: ScanResult = await res.json();
      setScan(data);
      setPhase("scanned");
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
      const data = await res.json();
      setSnapshot(data.snapshot);
      setApplied({ emps: data.employeesFixed, rows: data.ledgerRowsFixed });
      setScan(null);
      setPhase("applied");
      toast({
        title:       "Fixes applied",
        description: `Fixed ${data.employeesFixed} employee balance(s) and ${data.ledgerRowsFixed} rent ledger row(s).`,
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
      const data = await res.json();
      setSnapshot(null);
      setApplied(null);
      setScan(null);
      setPhase("idle");
      toast({
        title:       "Undo complete",
        description: `Restored ${data.employeesRestored} employee balance(s) and ${data.ledgerRowsRestored} rent ledger row(s).`,
      });
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
      setPhase("applied");
    }
  }

  const busy = phase === "scanning" || phase === "applying" || phase === "undoing";

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Balance Repair Tool"
        subtitle="Scans stored balances against live voucher data and corrects any drift. Supports one-click undo."
      />

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          This tool checks two areas: <strong>employee advance balances</strong> (stored in the employee record)
          and <strong>property rent ledger paid amounts</strong> (stored per month per contract).
          It compares each stored value against the actual voucher entries and payment records,
          then lets you apply corrections and undo them if needed.
        </AlertDescription>
      </Alert>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Run Balance Audit</CardTitle>
          <CardDescription>
            Scan first to preview discrepancies, then apply fixes. An undo snapshot is saved automatically
            so you can reverse the repair in one click.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={runScan}
            disabled={busy}
            data-testid="button-scan-balances"
          >
            {phase === "scanning" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />}
            Scan for Discrepancies
          </Button>

          {phase === "scanned" && scan && scan.totalDiscrepancies > 0 && (
            <Button
              onClick={applyFixes}
              disabled={busy}
              data-testid="button-apply-fixes"
            >
              {phase === "applying" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
              Apply {scan.totalDiscrepancies} Fix{scan.totalDiscrepancies === 1 ? "" : "es"}
            </Button>
          )}

          {phase === "applied" && snapshot && (
            <Button
              variant="outline"
              onClick={undoFixes}
              disabled={busy}
              data-testid="button-undo-repair"
            >
              {phase === "undoing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
              Undo Repair
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Applied summary */}
      {phase === "applied" && appliedCounts && snapshot && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              Repair Applied
            </CardTitle>
            <CardDescription>
              {appliedCounts.emps} employee balance{appliedCounts.emps !== 1 ? "s" : ""} corrected &middot;&nbsp;
              {appliedCounts.rows} rent ledger row{appliedCounts.rows !== 1 ? "s" : ""} corrected.
              An undo snapshot has been saved — click <strong>Undo Repair</strong> above to revert.
            </CardDescription>
          </CardHeader>

          {snapshot.employeeSnapshots.length > 0 && (
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                Employee Balances Fixed
              </div>
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
                  {snapshot.employeeSnapshots.map((s) => (
                    <TableRow key={s.id} data-testid={`row-emp-repair-${s.id}`}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(s.oldBalance)}</TableCell>
                      <TableCell className="text-right">{fmt(s.newBalance)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.newBalance > s.oldBalance ? "default" : "secondary"}>
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
              <div className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4" />
                Rent Ledger Rows Fixed
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contract ID</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Old Paid</TableHead>
                    <TableHead className="text-right">New Paid</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.ledgerSnapshots.map((s) => (
                    <TableRow key={s.id} data-testid={`row-ledger-repair-${s.id}`}>
                      <TableCell className="text-muted-foreground">#{s.contractId}</TableCell>
                      <TableCell>{MONTHS[s.month - 1]} {s.year}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmt(s.oldPaidAmount)}</TableCell>
                      <TableCell className="text-right">{fmt(s.newPaidAmount)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.newPaidAmount > s.oldPaidAmount ? "default" : "secondary"}>
                          {s.newPaidAmount >= s.oldPaidAmount ? "+" : ""}{fmt(s.newPaidAmount - s.oldPaidAmount)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}

      {/* Scan preview — no discrepancies */}
      {phase === "scanned" && scan && scan.totalDiscrepancies === 0 && (
        <Card>
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-sm">
              All balances are in sync. No discrepancies detected across employee records or property rent ledger rows.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Scan preview — discrepancies found */}
      {phase === "scanned" && scan && scan.totalDiscrepancies > 0 && (
        <>
          {scan.employeeDiscrepancies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Employee Balance Discrepancies
                  <Badge variant="destructive" className="ml-1">{scan.employeeDiscrepancies.length}</Badge>
                </CardTitle>
                <CardDescription>
                  The stored <code>currentBalance</code> on these employees differs from what their voucher entries compute.
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
                    {scan.employeeDiscrepancies.map((d) => (
                      <TableRow key={d.id} data-testid={`row-emp-scan-${d.id}`}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmt(d.storedBalance)}</TableCell>
                        <TableCell className="text-right">{fmt(d.computedBalance)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmt(d.storedDeposits)}</TableCell>
                        <TableCell className="text-right">{fmt(d.computedDeposits)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmt(d.storedWithdrawals)}</TableCell>
                        <TableCell className="text-right">{fmt(d.computedWithdrawals)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive">{fmt(d.diff)}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {scan.ledgerDiscrepancies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Property Rent Ledger Discrepancies
                  <Badge variant="destructive" className="ml-1">{scan.ledgerDiscrepancies.length}</Badge>
                </CardTitle>
                <CardDescription>
                  The stored <code>paid_amount</code> on these monthly ledger rows differs from the sum of actual payment records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract ID</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Stored Paid</TableHead>
                      <TableHead className="text-right">Computed Paid</TableHead>
                      <TableHead className="text-right">Drift</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scan.ledgerDiscrepancies.map((d) => (
                      <TableRow key={d.id} data-testid={`row-ledger-scan-${d.id}`}>
                        <TableCell className="text-muted-foreground">#{d.contractId}</TableCell>
                        <TableCell>{MONTHS[d.month - 1]} {d.year}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmt(d.storedPaid)}</TableCell>
                        <TableCell className="text-right">{fmt(d.computedPaid)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="destructive">{fmt(d.diff)}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
