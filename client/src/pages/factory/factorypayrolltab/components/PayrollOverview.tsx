import {
  Play,
  CheckCircle2,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Users,
  CalendarDays,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BatchRow } from "./BatchRow";
import type { FactoryPayrollState } from "../useFactoryPayroll";

export function PayrollOverview({ payroll }: { payroll: FactoryPayrollState }) {
  const {
    formatDisplayDate,
    setRunOpen,
    setPayOpen,
    setPayTargetId,
    setPayCashAccountId,
    selectedIds,
    setSelectedIds,
    setBulkPayOpen,
    setUndoTargetId,
    setDeleteBatchGroup,
    showCompletedBatches,
    setShowCompletedBatches,
    projectionPeriod,
    setProjectionPeriod,
    setRepairOpen,
    setRepairResult,
    setFixAcctOpen,
    setFixAcctTargetId,
    setFixAcctCashId,
    expandedGroups,
    isDeveloper,
    payrolls,
    isLoading,
    projectionFetching,
    projectionTotal,
    payrollGroups,
    toggleGroup,
    stats,
    activeGroups,
    completedGroups,
  } = payroll;
  return (
    <>
      {/* Stats pills */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-36 rounded-lg" />
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-52 rounded-lg" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Workers on Payroll</span>
              <span className="font-semibold" data-testid="stat-workers">
                {stats.uniqueWorkers}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Batches</span>
              <span className="font-semibold">{payrollGroups.length}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Pending</span>
              <span className="font-semibold font-mono text-amber-600 dark:text-amber-400" data-testid="stat-pending">
                ${stats.pending.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-muted-foreground">Total Paid</span>
              <span className="font-semibold font-mono text-emerald-600 dark:text-emerald-400" data-testid="stat-paid">
                ${stats.paid.toFixed(2)}
              </span>
            </div>
            <div
              className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm"
              data-testid="stat-projection"
            >
              <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={projectionPeriod} onValueChange={(v) => setProjectionPeriod(v as typeof projectionPeriod)}>
                <SelectTrigger
                  className="h-auto border-0 p-0 shadow-none focus:ring-0 text-muted-foreground text-sm gap-1 min-w-0 w-auto"
                  data-testid="select-projection-period"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">Total</span>
              {projectionFetching ? (
                <span className="font-mono text-muted-foreground/50 text-sm">···</span>
              ) : (
                <span
                  className="font-semibold font-mono text-blue-600 dark:text-blue-400"
                  data-testid="stat-projection-total"
                >
                  ${projectionTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Filter / actions row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-muted-foreground">
          {payrolls?.length || 0} record{payrolls?.length !== 1 ? "s" : ""} · {payrollGroups.length} batch
          {payrollGroups.length !== 1 ? "es" : ""}
        </p>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button variant="outline" onClick={() => setBulkPayOpen(true)} data-testid="button-bulk-pay">
              <DollarSign className="h-4 w-4 mr-2" />
              Pay {selectedIds.size} Selected
            </Button>
          )}
          {isDeveloper && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setRepairResult(null);
                setRepairOpen(true);
              }}
              data-testid="button-repair-ledger"
              title="Repair Ledger — remove stale entries from undone payrolls"
            >
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          <Button onClick={() => setRunOpen(true)} data-testid="button-run-payroll">
            <Play className="h-4 w-4 mr-2" />
            Run Payroll
          </Button>
        </div>
      </div>

      {/* Records list */}
      <div className="border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : payrollGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No payroll records yet</p>
            <p className="text-xs text-muted-foreground">Click "Run Payroll" to generate records for your workers</p>
          </div>
        ) : (
          <div>
            {/* ── Active batches (any pending records) ── */}
            {activeGroups.length === 0 && completedGroups.length > 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                All batches are fully paid — see completed batches below.
              </div>
            )}
            <div className="divide-y">
              {activeGroups.map((group) => (
                <BatchRow
                  key={group.key}
                  group={group}
                  expanded={expandedGroups}
                  toggleGroup={toggleGroup}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                  setPayTargetId={setPayTargetId}
                  setPayCashAccountId={setPayCashAccountId}
                  setPayOpen={setPayOpen}
                  setFixAcctTargetId={setFixAcctTargetId}
                  setFixAcctCashId={setFixAcctCashId}
                  setFixAcctOpen={setFixAcctOpen}
                  setUndoTargetId={setUndoTargetId}
                  setDeleteBatchGroup={setDeleteBatchGroup}
                  formatDisplayDate={formatDisplayDate}
                  isDeveloper={isDeveloper}
                />
              ))}
            </div>

            {/* ── Completed batches (all paid) ── */}
            {completedGroups.length > 0 && (
              <div className={activeGroups.length > 0 ? "border-t" : ""}>
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover-elevate"
                  onClick={() => setShowCompletedBatches((v) => !v)}
                  data-testid="toggle-completed-batches"
                >
                  {showCompletedBatches ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {completedGroups.length} completed batch{completedGroups.length !== 1 ? "es" : ""}
                </button>
                {showCompletedBatches && (
                  <div className="divide-y bg-muted/20">
                    {completedGroups.map((group) => (
                      <BatchRow
                        key={group.key}
                        group={group}
                        expanded={expandedGroups}
                        toggleGroup={toggleGroup}
                        selectedIds={selectedIds}
                        setSelectedIds={setSelectedIds}
                        setPayTargetId={setPayTargetId}
                        setPayCashAccountId={setPayCashAccountId}
                        setPayOpen={setPayOpen}
                        setFixAcctTargetId={setFixAcctTargetId}
                        setFixAcctCashId={setFixAcctCashId}
                        setFixAcctOpen={setFixAcctOpen}
                        setUndoTargetId={setUndoTargetId}
                        setDeleteBatchGroup={setDeleteBatchGroup}
                        formatDisplayDate={formatDisplayDate}
                        condensed
                        isDeveloper={isDeveloper}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
