/**
 * factoryPayrollRoutes: FactoryPayrollGenerate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { logAudit } from "../helpers/auditHelpers";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { getClientDate } from "../../lib/dateUtils";
import { checkFactoryAdmin } from "../factory/_helpers";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  factoryWorkers,
  factoryPayrolls,
  factoryBales,
  factoryAttendance,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
} from "@shared/schema";

import {
  computeMonthlyPay,
  computeMonthlyPayFromAttendance,
  countWeekdays,
  daysInMonth,
  daysInPeriod,
  writeDaybookEntry,
} from "./_helpers";

export function registerFactoryPayrollGenerateRoutes(app: Express, requireAuth: any, db: any) {
  app.post("/api/factory/payroll/generate", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const workers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      if (workers.length === 0) {
        return res.status(400).json({ message: "No active workers found for this company" });
      }

      const workerIds = workers.map((w: any) => w.id);

      const balesInRange = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            inArray(factoryBales.status, ["IN_STOCK", "FINALIZED", "SOLD"]),
            gte(factoryBales.createdAt, new Date(startDate)),
            lte(factoryBales.createdAt, new Date(endDate + "T23:59:59.999Z"))
          )
        );

      const balesByWorker = new Map<number, any[]>();
      for (const bale of balesInRange) {
        if (bale.finalizedBy) {
          const existing = balesByWorker.get(bale.finalizedBy) || [];
          existing.push(bale);
          balesByWorker.set(bale.finalizedBy, existing);
        }
      }

      // Fetch attendance records for the period
      const attendanceInRange = await db
        .select()
        .from(factoryAttendance)
        .where(
          and(
            eq(factoryAttendance.companyId, companyId),
            gte(factoryAttendance.attendanceDate, startDate),
            lte(factoryAttendance.attendanceDate, endDate)
          )
        );
      const attendanceByWorker = new Map<number, any[]>();
      for (const att of attendanceInRange) {
        const existing = attendanceByWorker.get(att.workerId) || [];
        existing.push(att);
        attendanceByWorker.set(att.workerId, existing);
      }

      // Outstanding salary-deduction advances (deduct from payroll)
      const outstandingAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.fullyPaid, false),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        );
      const advancesByWorker = new Map<number, any[]>();
      for (const adv of outstandingAdvances) {
        const existing = advancesByWorker.get(adv.workerId) || [];
        existing.push(adv);
        advancesByWorker.set(adv.workerId, existing);
      }

      const periodDays = daysInPeriod(startDate, endDate);
      const weekdays = countWeekdays(startDate, endDate);
      const monthDays = daysInMonth(startDate);
      const payrollRecords: any[] = [];

      for (const worker of workers) {
        let basePay = 0;
        let baleEarnings = 0;
        let kgEarnings = 0;
        let balesCount = 0;
        let kgProcessed = 0;

        const workerBaseSalary = parseFloat(worker.baseSalary || "0");
        const workerPerBaleRate = parseFloat(worker.perBaleRate || "0");
        const workerPerKgRate = parseFloat(worker.perKgRate || "0");
        const workerOvertimeRate = parseFloat(worker.overtimeRate || "0");
        const workerBales = balesByWorker.get(worker.id) || [];

        // Calculate attendance metrics
        const workerAttendance = attendanceByWorker.get(worker.id) || [];
        const hasAttendance = workerAttendance.length > 0;
        let presentDays = 0;
        let absentDays = 0;
        const totalWorkingDays = weekdays;

        if (hasAttendance) {
          for (const att of workerAttendance) {
            if (att.status === "Present" || att.status === "Late" || att.status === "Leave") {
              presentDays += 1;
            } else if (att.status === "Half Day") {
              presentDays += 0.5;
              absentDays += 0.5;
            } else if (att.status === "Absent") {
              absentDays += 1;
            }
          }
        }

        switch (worker.salaryType) {
          case "Monthly":
            if (hasAttendance) {
              basePay = computeMonthlyPayFromAttendance(workerBaseSalary, startDate, workerAttendance);
            } else {
              basePay = computeMonthlyPay(workerBaseSalary, startDate, endDate);
            }
            break;
          case "Daily":
            if (hasAttendance) {
              basePay = workerBaseSalary * presentDays;
            } else {
              basePay = workerBaseSalary * weekdays;
            }
            break;
          case "Per Bale":
            balesCount = workerBales.length;
            baleEarnings = balesCount * workerPerBaleRate;
            break;
          case "Per KG":
            kgProcessed = workerBales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);
            kgEarnings = kgProcessed * workerPerKgRate;
            break;
        }

        const overtimeHours = 0;
        const overtimePay = overtimeHours * workerOvertimeRate;
        const bonuses = 0;
        const deductions = 0;
        const workerAdvances = advancesByWorker.get(worker.id) || [];
        // Deduct remaining balances (not original amounts) — but only up to the gross pay
        const grossPay = basePay + baleEarnings + kgEarnings + overtimePay + bonuses;
        let advancesRemaining = 0;
        for (const a of workerAdvances) {
          advancesRemaining += parseFloat(a.remainingBalance || "0");
        }
        const advances = Math.min(advancesRemaining, grossPay);
        const netSalary = grossPay - deductions - advances;

        const [record] = await db
          .insert(factoryPayrolls)
          .values({
            companyId,
            workerId: worker.id,
            periodStart: startDate,
            periodEnd: endDate,
            baseSalary: String(basePay.toFixed(2)),
            baleEarnings: String(baleEarnings.toFixed(2)),
            kgEarnings: String(kgEarnings.toFixed(2)),
            overtimePay: String(overtimePay.toFixed(2)),
            bonuses: String(bonuses.toFixed(2)),
            deductions: String(deductions.toFixed(2)),
            advances: String(advances.toFixed(2)),
            netSalary: String(netSalary.toFixed(2)),
            balesCount,
            kgProcessed: String(kgProcessed.toFixed(3)),
            overtimeHours: String(overtimeHours.toFixed(2)),
            totalWorkingDays,
            presentDays: String(presentDays.toFixed(1)),
            absentDays: String(absentDays.toFixed(1)),
            status: "DRAFT",
          })
          .returning();

        // Settle advances: reduce remaining balances, create repayment records
        if (advances > 0) {
          let toSettle = advances;
          for (const adv of workerAdvances) {
            if (toSettle <= 0) break;
            const bal = parseFloat(adv.remainingBalance || "0");
            const reduce = Math.min(bal, toSettle);
            const newBal = bal - reduce;
            await db
              .update(factoryWorkerAdvances)
              .set({
                remainingBalance: newBal.toFixed(2),
                fullyPaid: newBal <= 0,
              })
              .where(eq(factoryWorkerAdvances.id, adv.id));
            await db.insert(factoryAdvanceRepayments).values({
              companyId,
              advanceId: adv.id,
              workerId: worker.id,
              payrollId: record.id,
              repaymentDate: startDate,
              amount: reduce.toFixed(2),
              notes: `Payroll deduction for ${startDate} – ${endDate}`,
            });
            toSettle -= reduce;
          }
        }

        // Write a per-worker PAYROLL_GENERATED entry with referenceId so undo can clean it up
        const today = getClientDate(req);
        await writeDaybookEntry(db, {
          companyId,
          txDate: today,
          txType: "PAYROLL_GENERATED",
          referenceId: record.id,
          referenceTable: "factory_payrolls",
          description: `Payroll generated — Worker #${worker.id} (${worker.fullName || worker.employeeCode || ""}). Period: ${startDate} to ${endDate}. Net: $${netSalary.toFixed(2)}`,
          amountCurrency: netSalary,
          amountUsd: netSalary,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        payrollRecords.push(record);
      }

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId: parseInt(companyId),
          action: "create",
          tableName: "factory_payrolls",
          recordId: null,
          recordIdentifier: `Payroll generated — ${payrollRecords.length} worker(s), ${startDate} to ${endDate}`,
          changes: null,
        });
      } catch (auditErr) {
        logger.error("[payroll generate audit] non-fatal:", { error: auditErr });
      }

      res.json(payrollRecords);
    } catch (error: unknown) {
      logger.error("Error generating payroll:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
