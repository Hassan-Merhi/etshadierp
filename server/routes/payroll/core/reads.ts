/**
 * payrollCoreRoutes: PayrollCoreRead endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { getClientDate } from "../../../lib/dateUtils";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import {
  factoryWorkers,
  factoryPayrolls,
  factoryWorkerAdvances,
  factoryAttendance,
  ledgerAccounts,
} from "@shared/schema";
import { computeMonthlyPay, getFactoryCompanyId } from "./_helpers";

export function registerPayrollCoreReadRoutes(app: Express) {
  app.get("/api/factory/cash-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accounts = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name, code: ledgerAccounts.code })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.companyId, companyId))
        .orderBy(ledgerAccounts.name);
      res.json(accounts);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET /api/factory/payrolls - All payroll records for company with worker info
  app.get("/api/factory/payrolls", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(eq(factoryPayrolls.companyId, companyId))
        .orderBy(desc(factoryPayrolls.periodEnd));
      // Attach worker names
      const workerIds = [...new Set(payrolls.map((p: any) => p.workerId))];
      const workers = workerIds.length
        ? await db
            .select({
              id: factoryWorkers.id,
              fullName: factoryWorkers.fullName,
              employeeCode: factoryWorkers.employeeCode,
              position: factoryWorkers.position,
            })
            .from(factoryWorkers)
            .where(inArray(factoryWorkers.id, workerIds))
        : [];
      const workerMap = new Map(workers.map((w: any) => [w.id, w]));
      const result = payrolls.map((p: any) => ({ ...p, worker: workerMap.get(p.workerId) || null }));
      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET /api/factory/workers/amount-due
  // Returns a "owed till today" snapshot for every active worker.
  // Uses calendar-day proration then deducts explicitly recorded Absent / Half Day
  // entries from the attendance table — consistent with the full payroll calculation.
  // Period start = day after last PAID payroll's periodEnd, or 1st of current month.
  // Only salary_deduction advances are auto-deducted (same rule as payroll preview).
  app.get("/api/factory/workers/amount-due", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Use the client's local date (from X-Client-Date header) so the
      // period boundary is correct across timezone offsets. Falls back to
      // UTC today when the header is absent.
      const todayStr = getClientDate(req);
      const today = new Date(todayStr + "T00:00:00");
      const pad = (n: number) => String(n).padStart(2, "0");

      // Helper: days in the month containing dateStr
      const getDIM = (dateStr: string) => {
        const d = new Date(dateStr + "T00:00:00");
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      };

      // All active workers for this company
      const workers = await db
        .select({
          id: factoryWorkers.id,
          baseSalary: factoryWorkers.baseSalary,
          transportAllowance: factoryWorkers.transportAllowance,
          salaryType: factoryWorkers.salaryType,
        })
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      if (workers.length === 0) return res.json({});

      const workerIds = workers.map((w) => w.id);

      // Most-recent PAID payroll per worker (to determine where the new period starts)
      const paidPayrolls = await db
        .select({ workerId: factoryPayrolls.workerId, periodEnd: factoryPayrolls.periodEnd })
        .from(factoryPayrolls)
        .where(
          and(
            eq(factoryPayrolls.companyId, companyId),
            inArray(factoryPayrolls.workerId, workerIds),
            eq(factoryPayrolls.status, "PAID")
          )
        )
        .orderBy(desc(factoryPayrolls.periodEnd));

      const lastPaidEnd: Record<number, string> = {};
      for (const p of paidPayrolls) {
        if (!lastPaidEnd[p.workerId]) lastPaidEnd[p.workerId] = p.periodEnd;
      }

      // Pre-compute period start for every worker so we can do a bulk attendance query
      const periodStarts: Record<number, string> = {};
      for (const w of workers) {
        if (lastPaidEnd[w.id]) {
          const d = new Date(lastPaidEnd[w.id] + "T00:00:00");
          d.setDate(d.getDate() + 1);
          periodStarts[w.id] = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        } else {
          periodStarts[w.id] = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
        }
      }

      // Earliest period start across all workers (lower bound for attendance query)
      const allStarts = Object.values(periodStarts);
      const minPeriodStart = allStarts.length > 0 ? allStarts.reduce((a, b) => (a < b ? a : b)) : todayStr;

      // Pending salary_deduction advances per worker
      const advanceRows = await db
        .select({
          workerId: factoryWorkerAdvances.workerId,
          remaining: factoryWorkerAdvances.remainingBalance,
        })
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            inArray(factoryWorkerAdvances.workerId, workerIds),
            eq(factoryWorkerAdvances.fullyPaid, false),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        );

      const advanceMap: Record<number, number> = {};
      for (const a of advanceRows) {
        advanceMap[a.workerId] = (advanceMap[a.workerId] || 0) + parseFloat(a.remaining || "0");
      }

      // Bulk-fetch attendance records for all workers covering their unpaid periods
      const attendanceRows = await db
        .select({
          workerId: factoryAttendance.workerId,
          attendanceDate: factoryAttendance.attendanceDate,
          status: factoryAttendance.status,
        })
        .from(factoryAttendance)
        .where(
          and(
            eq(factoryAttendance.companyId, companyId),
            inArray(factoryAttendance.workerId, workerIds),
            gte(factoryAttendance.attendanceDate, minPeriodStart),
            lte(factoryAttendance.attendanceDate, todayStr)
          )
        );

      // Group attendance by workerId for O(1) lookup
      const attendanceByWorker: Record<number, Array<{ date: string; status: string }>> = {};
      for (const att of attendanceRows) {
        if (!attendanceByWorker[att.workerId]) attendanceByWorker[att.workerId] = [];
        attendanceByWorker[att.workerId].push({
          date: att.attendanceDate,
          status: att.status ?? "Present",
        });
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;

      const result: Record<
        number,
        {
          periodStart: string;
          periodEnd: string;
          base: number;
          transport: number;
          absenceDeducted: number;
          advanceDeducted: number;
          net: number;
          lastPaidThrough: string | null;
        }
      > = {};

      for (const w of workers) {
        const baseSal = parseFloat(w.baseSalary || "0");
        const transport = parseFloat(w.transportAllowance || "0");
        const periodStart = periodStarts[w.id];

        // Nothing owed if already paid through today or beyond
        if (periodStart > todayStr) {
          result[w.id] = {
            periodStart,
            periodEnd: todayStr,
            base: 0,
            transport: 0,
            absenceDeducted: 0,
            advanceDeducted: 0,
            net: 0,
            lastPaidThrough: lastPaidEnd[w.id] || null,
          };
          continue;
        }

        // Calendar-day gross
        const grossBase = computeMonthlyPay(baseSal, periodStart, todayStr);
        const grossTransport = computeMonthlyPay(transport, periodStart, todayStr);

        // Deduct for each explicitly recorded Absent or Half Day in this period.
        // Days with no attendance record are NOT deducted (calendar proration stands).
        let absDeductBase = 0;
        let absDeductTransport = 0;
        for (const att of attendanceByWorker[w.id] ?? []) {
          if (att.date < periodStart || att.date > todayStr) continue;
          const dim = getDIM(att.date);
          if (att.status === "Absent") {
            absDeductBase += baseSal / dim;
            absDeductTransport += transport / dim;
          } else if (att.status === "Half Day") {
            absDeductBase += (baseSal / dim) * 0.5;
            absDeductTransport += (transport / dim) * 0.5;
          }
        }

        const base = Math.max(0, grossBase - absDeductBase);
        const transportDue = Math.max(0, grossTransport - absDeductTransport);
        const absenceDeducted = absDeductBase + absDeductTransport;

        const advanceBalance = advanceMap[w.id] || 0;
        const advanceDeducted = Math.min(advanceBalance, base + transportDue);
        const net = Math.max(0, base + transportDue - advanceDeducted);

        result[w.id] = {
          periodStart,
          periodEnd: todayStr,
          base: round2(base),
          transport: round2(transportDue),
          absenceDeducted: round2(absenceDeducted),
          advanceDeducted: round2(advanceDeducted),
          net: round2(net),
          lastPaidThrough: lastPaidEnd[w.id] || null,
        };
      }

      res.json(result);
    } catch (err: unknown) {
      logger.error("GET /api/factory/workers/amount-due error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // GET /api/factory/workers/:id/payrolls - Payroll history for one worker
  app.get("/api/factory/workers/:id/payrolls", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.workerId, id), eq(factoryPayrolls.companyId, companyId)))
        .orderBy(desc(factoryPayrolls.periodEnd));
      res.json(payrolls);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
