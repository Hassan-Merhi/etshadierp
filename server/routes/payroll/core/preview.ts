/**
 * payrollCoreRoutes: PayrollPreview endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { factoryWorkers, factoryWorkerAdvances, factoryWorkerDeductions, factoryAttendance } from "@shared/schema";
import { computeMonthlyPay, computeMonthlyPayFromAttendance, getFactoryCompanyId } from "./_helpers";

export function registerPayrollPreviewRoutes(app: Express) {
  // POST /api/factory/payrolls/preview - Preview payroll calculation with attendance breakdown (no DB writes)
  app.post("/api/factory/payrolls/preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker, transportOverrides } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });

      const days = daysCount
        ? parseInt(daysCount)
        : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db
          .select()
          .from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db
          .select()
          .from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      // Fetch all attendance records for the period in one query
      const workerIdList = targetWorkers.map((w: any) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db
            .select()
            .from(factoryAttendance)
            .where(
              and(
                eq(factoryAttendance.companyId, companyId),
                gte(factoryAttendance.attendanceDate, periodStart),
                lte(factoryAttendance.attendanceDate, periodEnd),
                inArray(factoryAttendance.workerId, workerIdList)
              )
            )
        : [];

      const attendanceByWorker = new Map<number, any[]>();
      for (const att of attendanceRecords) {
        const list = attendanceByWorker.get(att.workerId) || [];
        list.push(att);
        attendanceByWorker.set(att.workerId, list);
      }

      // Outstanding advances — all unpaid (both salary_deduction and manual_repayment/loan)
      const allAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.fullyPaid, false)))
        .orderBy(factoryWorkerAdvances.advanceDate);
      // Separate salary-deduction advances (auto-deducted from pay) from loans (informational only)
      const advanceByWorker: Record<number, number> = {};
      const advanceListByWorker: Record<number, typeof allAdvances> = {};
      const loanListByWorker: Record<number, typeof allAdvances> = {};
      const loanBalByWorker: Record<number, number> = {};
      for (const adv of allAdvances) {
        if (adv.repaymentType === "salary_deduction") {
          advanceByWorker[adv.workerId] =
            (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
          if (!advanceListByWorker[adv.workerId]) advanceListByWorker[adv.workerId] = [];
          advanceListByWorker[adv.workerId].push(adv);
        } else {
          loanBalByWorker[adv.workerId] =
            (loanBalByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
          if (!loanListByWorker[adv.workerId]) loanListByWorker[adv.workerId] = [];
          loanListByWorker[adv.workerId].push(adv);
        }
      }

      // Pending one-time salary deductions (factoryWorkerDeductions table)
      const allPendingDeductions = await db
        .select()
        .from(factoryWorkerDeductions)
        .where(and(eq(factoryWorkerDeductions.companyId, companyId), eq(factoryWorkerDeductions.applied, false)));
      const pendingDeductionByWorker: Record<number, number> = {};
      const pendingDeductionRecordsByWorker: Record<
        number,
        { id: number; amount: string; reason: string | null; deductionDate: string }[]
      > = {};
      for (const ded of allPendingDeductions) {
        pendingDeductionByWorker[ded.workerId] =
          (pendingDeductionByWorker[ded.workerId] || 0) + parseFloat(ded.amount || "0");
        if (!pendingDeductionRecordsByWorker[ded.workerId]) pendingDeductionRecordsByWorker[ded.workerId] = [];
        pendingDeductionRecordsByWorker[ded.workerId].push({
          id: ded.id,
          amount: ded.amount,
          reason: ded.reason,
          deductionDate: ded.deductionDate,
        });
      }

      // Transport denominator = total days in the MONTH of periodStart.
      // This ensures two half-month runs (e.g. Apr 1-15 + Apr 16-30) add up to
      // exactly the full monthly transport allowance for a fully-present worker.
      // e.g. for April (30 days): daily rate = $80/30 = $2.67 → 15d = $40
      const transportMonthDays = (() => {
        const d = new Date(periodStart);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      })();

      const result = targetWorkers.map((worker: any) => {
        const baseSal = parseFloat(worker.baseSalary || "0");
        const freq = worker.payFrequency || worker.salaryType || "Monthly";
        let base: number;
        if (freq === "Weekly") base = (days / 7) * baseSal;
        else if (freq === "Bi-Weekly") base = (days / 14) * baseSal;
        else if (freq === "Daily" || worker.salaryType === "Daily") base = days * baseSal;
        else {
          // Monthly: use attendance-based calculation if records exist
          const workerAttRecords = attendanceByWorker.get(worker.id) || [];
          if (workerAttRecords.length === 0) {
            base = computeMonthlyPay(baseSal, periodStart, periodEnd);
          } else {
            base = computeMonthlyPayFromAttendance(baseSal, periodStart, workerAttRecords);
          }
        }

        // Transport allowance — prorated by attendance
        const workerAttRecs = attendanceByWorker.get(worker.id) || [];
        let presentDays = 0;
        let absentDays = 0;
        const presentDates: { date: string; status: string }[] = [];
        const absentDates: { date: string; status: string }[] = [];
        const halfDayDates: { date: string; status: string }[] = [];

        for (const att of workerAttRecs) {
          const entry = { date: att.attendanceDate, status: att.status };
          if (att.status === "Present" || att.status === "Late" || att.status === "Leave") {
            presentDays += 1;
            presentDates.push(entry);
          } else if (att.status === "Half Day") {
            presentDays += 0.5;
            absentDays += 0.5;
            halfDayDates.push(entry);
          } else if (att.status === "Absent") {
            absentDays += 1;
            absentDates.push(entry);
          }
        }

        presentDates.sort((a, b) => a.date.localeCompare(b.date));
        absentDates.sort((a, b) => a.date.localeCompare(b.date));
        halfDayDates.sort((a, b) => a.date.localeCompare(b.date));

        const workerTransportDefault = parseFloat((worker as any).transportAllowance || "0");
        const transportOverrideAmt = transportOverrides
          ? parseFloat(transportOverrides[String(worker.id)] ?? "-1")
          : -1;
        const transportMonthly = transportOverrideAmt >= 0 ? transportOverrideAmt : workerTransportDefault;

        let transport = 0;
        if (transportMonthly > 0) {
          if (workerAttRecs.length > 0 && transportMonthDays > 0) {
            // dailyRate = monthlyRate / daysInMonth
            // transport = dailyRate * presentDays
            transport = (presentDays / transportMonthDays) * transportMonthly;
          } else {
            transport = transportMonthly;
          }
        }

        const totalAdvanceBalance = advanceByWorker[worker.id] || 0;
        const advanceDeduction = Math.min(totalAdvanceBalance, base + bonus + transport);
        const pendingDeductions = pendingDeductionByWorker[worker.id] || 0;
        const pendingDeductionRecords = pendingDeductionRecordsByWorker[worker.id] || [];
        const net = base + bonus + transport - advanceDeduction - pendingDeductions;
        const pendingAdvances = (advanceListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
          repaymentType: a.repaymentType,
        }));
        const outstandingLoans = (loanListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
          repaymentType: a.repaymentType,
        }));
        const totalLoanBalance = loanBalByWorker[worker.id] || 0;

        return {
          id: worker.id,
          name: worker.fullName,
          position: worker.position || null,
          base,
          bonus,
          transport,
          transportMonthly,
          advanceDeduction,
          totalAdvanceBalance,
          pendingAdvances,
          pendingDeductions,
          pendingDeductionRecords,
          outstandingLoans,
          totalLoanBalance,
          net,
          totalWorkingDays: transportMonthDays, // full month days — denominator used for proration
          presentDays,
          absentDays,
          presentDates,
          absentDates,
          halfDayDates,
        };
      });

      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
