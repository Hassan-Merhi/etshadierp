/**
 * BatchRow — extracted sub-component.
 *
 * Extracted from FactoryPayrollTab.tsx during the Phase 4 god-file split.
 */
import { ChevronDown, ChevronRight, Trash2, RotateCcw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BatchRowProps } from "../types";
import { STATUS_CONFIG, fmt, fmtDate } from "../utils";
import { useFactoryText } from "@/i18n/modules/factory";

export function BatchRow({
  group,
  expanded,
  toggleGroup,
  selectedIds,
  setSelectedIds,
  setPayTargetId,
  setPayCashAccountId,
  setPayOpen,
  setFixAcctTargetId,
  setFixAcctCashId,
  setFixAcctOpen,
  setUndoTargetId,
  setDeleteBatchGroup,
  formatDisplayDate,
  condensed,
  isDeveloper,
}: BatchRowProps) {
  const tUi = useFactoryText();
  const isExpanded = expanded.has(group.key);
  const total = group.records.reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
  const paidCount = group.records.filter((p) => p.status === "PAID").length;
  const unpaidCount = group.records.length - paidCount;
  const groupUnpaid = group.records.filter((p) => p.status !== "PAID");
  const allGroupSelected = groupUnpaid.length > 0 && groupUnpaid.every((p) => selectedIds.has(p.id));

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
        onClick={() => toggleGroup(group.key)}
        data-testid={`group-${group.key}`}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${condensed ? "text-xs" : "text-sm"}`}>
            {fmtDate(group.periodStart, formatDisplayDate)} – {fmtDate(group.periodEnd, formatDisplayDate)}
          </p>
          <p className="text-xs text-muted-foreground">
            {group.records.length} worker{group.records.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className={`font-semibold font-mono ${condensed ? "text-xs" : "text-sm"}`}>${total.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {paidCount > 0 && <span className="text-green-600 dark:text-green-400">{paidCount} paid</span>}
              {paidCount > 0 && unpaidCount > 0 && " · "}
              {unpaidCount > 0 && <span className="text-amber-600 dark:text-amber-400">{unpaidCount} pending</span>}
            </p>
          </div>
          {groupUnpaid.length > 0 && (
            <Checkbox
              checked={allGroupSelected}
              onCheckedChange={(v) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  groupUnpaid.forEach((p) => (v ? next.add(p.id) : next.delete(p.id)));
                  return next;
                });
              }}
              onClick={(e) => e.stopPropagation()}
              data-testid={`checkbox-group-${group.key}`}
            />
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteBatchGroup(group);
            }}
            data-testid={`button-delete-batch-${group.key}`}
            title={tUi("delete.batch.reverses.all.payments.and.accountin")}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 pl-8 text-xs h-9 font-semibold"></TableHead>
                <TableHead className="text-xs h-9 font-semibold">{tUi("worker")}</TableHead>
                <TableHead className="text-center text-xs h-9 font-semibold">{tUi("present")}</TableHead>
                <TableHead className="text-center text-xs h-9 font-semibold">{tUi("absent")}</TableHead>
                <TableHead className="text-right text-xs h-9 font-semibold">{tUi("deductions.2")}</TableHead>
                <TableHead className="text-right text-xs h-9 font-semibold">{tUi("advances")}</TableHead>
                <TableHead className="text-right text-xs h-9 font-semibold">Net</TableHead>
                <TableHead className="text-xs h-9 font-semibold">{tUi("status")}</TableHead>
                <TableHead className="text-xs h-9 font-semibold">{tUi("paid.on")}</TableHead>
                <TableHead className="text-xs h-9"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.records.map((p) => {
                const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.DRAFT;
                const canPay = p.status !== "PAID";
                return (
                  <TableRow key={p.id} data-testid={`row-payroll-${p.id}`}>
                    <TableCell className="pl-8">
                      {canPay && (
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() =>
                            setSelectedIds((prev) => {
                              const n = new Set(prev);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            })
                          }
                          data-testid={`checkbox-payroll-${p.id}`}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{p.worker?.fullName || `Worker #${p.workerId}`}</p>
                        {p.worker?.position && <p className="text-xs text-muted-foreground">{p.worker.position}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm" data-testid={`text-present-${p.id}`}>
                      {p.presentDays != null
                        ? Number(p.presentDays) % 1 === 0
                          ? Number(p.presentDays).toFixed(0)
                          : p.presentDays
                        : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm" data-testid={`text-absent-${p.id}`}>
                      {p.absentDays != null
                        ? Number(p.absentDays) % 1 === 0
                          ? Number(p.absentDays).toFixed(0)
                          : p.absentDays
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-deductions-${p.id}`}>
                      {parseFloat(p.deductions || "0") > 0 ? (
                        <span className="text-destructive">-${fmt(p.deductions)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm" data-testid={`text-advances-${p.id}`}>
                      {parseFloat(p.advances || "0") > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">-${fmt(p.advances)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">${fmt(p.netSalary)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs no-default-active-elevate ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.paidAt ? fmtDate(p.paidAt, formatDisplayDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canPay && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPayTargetId(p.id);
                              setPayCashAccountId("");
                              setPayOpen(true);
                            }}
                            data-testid={`button-pay-${p.id}`}
                          >
                            Pay
                          </Button>
                        )}
                        {isDeveloper && (p.status === "PAID" || p.status === "APPROVED") && !p.cashAccountId && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setFixAcctTargetId(p.id);
                              setFixAcctCashId("");
                              setFixAcctOpen(true);
                            }}
                            data-testid={`button-fix-acct-${p.id}`}
                            title={tUi("generate.missing.accounting.entry")}
                          >
                            <Wrench className="h-4 w-4 text-amber-500" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setUndoTargetId(p.id)}
                          data-testid={`button-undo-payroll-${p.id}`}
                          title={tUi("undo.reverses.all.accounting.entries")}
                        >
                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
