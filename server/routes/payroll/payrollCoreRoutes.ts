import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, desc, sql, ilike, gte, lte, inArray, isNotNull } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  factoryWorkers,
  insertFactoryWorkerSchema,
  factoryDaybookEntries,
  factoryBales,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryWorkerDeductions,
  factoryAttendance,
  ledgerAccounts,
  bankAccounts,
  vouchers,
  voucherEntries,
  companies,
  companySettings,
} from "@shared/schema";

/** Prefer the factory-pinned company ID so cross-tab ERP company switches don't corrupt factory writes. */
function getFactoryCompanyId(req: any): number | undefined {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
}

/** Write a single daybook entry (factory audit log). */
async function writeDaybookEntry(
  dbOrTx: any,
  opts: {
    companyId: number;
    txDate: string;
    txType: string;
    referenceId?: number;
    referenceTable?: string;
    description: string;
    metaJson?: string;
    currencyCode?: string;
    amountCurrency?: number;
    fxRateToUsd?: number;
    amountUsd?: number;
    createdBy?: number;
  }
) {
  const currency = opts.currencyCode || "USD";
  const fxRate = opts.fxRateToUsd || 1;
  const amtCurrency = opts.amountCurrency || 0;
  const amtUsd =
    opts.amountUsd !== undefined ? opts.amountUsd : currency === "USD" ? amtCurrency : amtCurrency * fxRate;
  await dbOrTx.insert(factoryDaybookEntries).values({
    companyId: opts.companyId,
    txDate: opts.txDate,
    txType: opts.txType,
    referenceId: opts.referenceId || null,
    referenceTable: opts.referenceTable || null,
    description: opts.description,
    metaJson: opts.metaJson || null,
    currencyCode: currency,
    amountCurrency: String(amtCurrency),
    fxRateToUsd: String(fxRate),
    amountUsd: String(amtUsd),
    createdBy: opts.createdBy || null,
  });
}

/** Find or create a ledger account by name for a company. Returns the account row. */
async function findOrCreateLedger(companyId: number, name: string, accountType: string): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name)));
  if (existing) return existing;

  const [maxCodeRow] = await db
    .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
  const nextCode = String((parseInt((maxCodeRow as any)?.maxCode || "0") || 0) + 1);

  const [created] = await db
    .insert(ledgerAccounts)
    .values({ companyId, code: nextCode, name, accountType, active: true, isHidden: false })
    .returning({ id: ledgerAccounts.id });
  return created;
}

const workerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(process.cwd(), "uploads", "workers");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
});

function computeMonthlyPay(salary: number, startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  let total = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const monthLastDay = new Date(year, month + 1, 0);
    const daysInThisMonth = monthLastDay.getDate();
    const segStart = new Date(Math.max(cur.getTime(), start.getTime()));
    const segEnd = new Date(Math.min(monthLastDay.getTime(), end.getTime()));
    const daysInSeg = Math.floor((segEnd.getTime() - segStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    total += salary * (daysInSeg / daysInThisMonth);
    cur = new Date(year, month + 1, 1);
  }
  return total;
}

// Helper: Compute monthly pay from actual attendance records.
// Monthly payroll uses attendance-based calculation (Present/Late = 1 day, Half Day = 0.5 day)
// rather than calendar-day proration to match actual work performed.
function computeMonthlyPayFromAttendance(baseSalary: number, periodStart: string, attendanceRows: any[]): number {
  const daysInMonth = (dateStr: string) => {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  };

  // Count actual days worked: Present/Late = 1 full day, Half Day = 0.5
  let attendedDays = 0;
  for (const row of attendanceRows) {
    const s = row.status || "Absent";
    if (s === "Present" || s === "Late") attendedDays += 1;
    else if (s === "Half Day") attendedDays += 0.5;
  }

  // Daily rate: salary / days in the month of periodStart
  const daysInStartMonth = daysInMonth(periodStart);
  const dailyRate = baseSalary / daysInStartMonth;
  return attendedDays * dailyRate;
}

export function registerPayrollCoreRoutes(app: Express) {
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.fullyPaid, false)
          )
        )
        .orderBy(factoryWorkerAdvances.advanceDate);
      // Separate salary-deduction advances (auto-deducted from pay) from loans (informational only)
      const advanceByWorker: Record<number, number> = {};
      const advanceListByWorker: Record<number, typeof allAdvances> = {};
      const loanListByWorker: Record<number, typeof allAdvances> = {};
      const loanBalByWorker: Record<number, number> = {};
      for (const adv of allAdvances) {
        if (adv.repaymentType === "salary_deduction") {
          advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
          if (!advanceListByWorker[adv.workerId]) advanceListByWorker[adv.workerId] = [];
          advanceListByWorker[adv.workerId].push(adv);
        } else {
          loanBalByWorker[adv.workerId] = (loanBalByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
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
      const pendingDeductionRecordsByWorker: Record<number, { id: number; amount: string; reason: string | null; deductionDate: string }[]> = {};
      for (const ded of allPendingDeductions) {
        pendingDeductionByWorker[ded.workerId] = (pendingDeductionByWorker[ded.workerId] || 0) + parseFloat(ded.amount || "0");
        if (!pendingDeductionRecordsByWorker[ded.workerId]) pendingDeductionRecordsByWorker[ded.workerId] = [];
        pendingDeductionRecordsByWorker[ded.workerId].push({ id: ded.id, amount: ded.amount, reason: ded.reason, deductionDate: ded.deductionDate });
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
        let base = 0;
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
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payrolls/generate-bulk - Generate draft payrolls for multiple workers
  app.post("/api/factory/payrolls/generate-bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const {
        workerIds,
        periodStart,
        periodEnd,
        daysCount,
        bonusPerWorker,
        cashAccountId,
        notes,
        advanceOverrides,
        transportOverrides,
      } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });
      // advanceOverrides: { [workerId: string]: number } — user-approved deduction per worker

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

      const daysInMonth = (d: string) => {
        const dt = new Date(d);
        return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
      };

      // Fetch all attendance records for the period (for monthly attendance-based calculation)
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

      const allOutstandingAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.fullyPaid, false),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        );
      const advanceByWorker: Record<number, number> = {};
      for (const adv of allOutstandingAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
      }

      // Fetch pending (unapplied) deductions per worker
      const allPendingDeductions = await db
        .select()
        .from(factoryWorkerDeductions)
        .where(and(eq(factoryWorkerDeductions.companyId, companyId), eq(factoryWorkerDeductions.applied, false)));
      const deductionByWorker: Record<number, number[]> = {};
      for (const ded of allPendingDeductions) {
        if (!deductionByWorker[ded.workerId]) deductionByWorker[ded.workerId] = [];
        deductionByWorker[ded.workerId].push(ded.id);
      }
      const deductionAmtByWorker: Record<number, number> = {};
      for (const ded of allPendingDeductions) {
        deductionAmtByWorker[ded.workerId] = (deductionAmtByWorker[ded.workerId] || 0) + parseFloat(ded.amount || "0");
      }

      // Pre-resolve city-specific ledger accounts OUTSIDE the transaction
      const uniqueCityKeys = [...new Set(targetWorkers.map((w: any) => (w.city as string | null)?.trim() || ""))];
      const [payableAccGen, advancesAccGen] = await Promise.all([
        findOrCreateLedger(companyId, "Payroll Payable", "Liability"),
        findOrCreateLedger(companyId, "Factory Worker Advances", "Asset"),
      ]);
      // Map: cityKey → { salaryId, bonusId }. Empty key = no city → legacy "Factory Worker Payroll"
      const cityAccCache = new Map<string, { salaryId: number; bonusId: number }>();
      for (const ck of uniqueCityKeys) {
        if (ck) {
          const capCity = ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase();
          const [sa, ba] = await Promise.all([
            findOrCreateLedger(companyId, `Salary Expense - ${capCity}`, "Expense"),
            findOrCreateLedger(companyId, `Bonus Expense - ${capCity}`, "Expense"),
          ]);
          cityAccCache.set(ck, { salaryId: sa.id, bonusId: ba.id });
        } else {
          const fa = await findOrCreateLedger(companyId, "Factory Worker Payroll", "Expense");
          cityAccCache.set("", { salaryId: fa.id, bonusId: fa.id });
        }
      }

      const created = await db.transaction(async (tx: any) => {
        let count = 0;
        let totalNet = 0;
        let totalAdvanceDeductions = 0;
        // Track salary and bonus expense per city for split accounting
        const salaryByCity = new Map<string, number>();
        const bonusByCity = new Map<string, number>();
        for (const worker of targetWorkers) {
          const baseSal = parseFloat(worker.baseSalary || "0");
          const freq = (worker as any).payFrequency || worker.salaryType || "Monthly";
          let base = 0;
          if (freq === "Weekly") base = (days / 7) * parseFloat((worker as any).weeklySalary || baseSal.toString());
          else if (freq === "Bi-Weekly")
            base = (days / 14) * parseFloat((worker as any).biWeeklySalary || baseSal.toString());
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
          // Transport allowance — prorated by: (presentDays / daysInMonth) * monthlyRate
          // Using the full month days (not period days) as denominator so two
          // half-month runs add up to exactly the monthly allowance.
          const workerAttRecs2 = attendanceByWorker.get(worker.id) || [];
          let presentDays2 = 0;
          for (const att of workerAttRecs2) {
            if (att.status === "Present" || att.status === "Late" || att.status === "Leave") presentDays2 += 1;
            else if (att.status === "Half Day") presentDays2 += 0.5;
          }

          const monthDaysForTransport = daysInMonth(periodStart);
          const workerTransportDefault2 = parseFloat((worker as any).transportAllowance || "0");
          const transportOverrideAmt2 = transportOverrides
            ? parseFloat(transportOverrides[String(worker.id)] ?? "-1")
            : -1;
          const transportMonthly2 = transportOverrideAmt2 >= 0 ? transportOverrideAmt2 : workerTransportDefault2;
          let transport = 0;
          if (transportMonthly2 > 0) {
            if (workerAttRecs2.length > 0 && monthDaysForTransport > 0) {
              transport = (presentDays2 / monthDaysForTransport) * transportMonthly2;
            } else {
              transport = transportMonthly2;
            }
          }

          const workerAdvanceBalance = advanceByWorker[worker.id] || 0;
          // Use user-approved override if provided, otherwise auto-deduct full balance
          const overrideAmt = advanceOverrides ? parseFloat(advanceOverrides[String(worker.id)] ?? "-1") : -1;
          const advanceDeduction =
            overrideAmt >= 0
              ? Math.min(overrideAmt, base + bonus + transport, workerAdvanceBalance)
              : Math.min(workerAdvanceBalance, base + bonus + transport);
          // Include pending worker deductions
          const workerPendingDeductions = deductionAmtByWorker[worker.id] || 0;
          const net = base + bonus + transport - advanceDeduction - workerPendingDeductions;
          // Accumulate per-city expense amounts for split accounting
          const cityKey = (worker.city as string | null)?.trim() || "";
          salaryByCity.set(cityKey, (salaryByCity.get(cityKey) || 0) + base + transport - workerPendingDeductions);
          bonusByCity.set(cityKey, (bonusByCity.get(cityKey) || 0) + bonus);
          const [newPayroll] = await tx
            .insert(factoryPayrolls)
            .values({
              companyId,
              workerId: worker.id,
              periodStart,
              periodEnd,
              baseSalary: base.toFixed(2),
              bonuses: bonus.toFixed(2),
              transport: transport.toFixed(2),
              baleEarnings: "0",
              kgEarnings: "0",
              overtimePay: "0",
              deductions: workerPendingDeductions.toFixed(2),
              advances: advanceDeduction.toFixed(2),
              netSalary: net.toFixed(2),
              balesCount: 0,
              kgProcessed: "0",
              overtimeHours: "0",
              status: "DRAFT",
              notes: notes || null,
              cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
            } as any)
            .returning({ id: factoryPayrolls.id });
          // Mark pending deductions as applied
          if (deductionByWorker[worker.id]?.length) {
            await tx
              .update(factoryWorkerDeductions)
              .set({ applied: true, payrollId: newPayroll.id } as any)
              .where(inArray(factoryWorkerDeductions.id, deductionByWorker[worker.id]));
          }
          // Settle advances immediately at generate time so remaining balance updates right away
          await settleAdvancesForPayroll(tx, companyId, worker.id, advanceDeduction);
          totalNet += net;
          totalAdvanceDeductions += advanceDeduction;
          count++;
        }
        // Accounting: Dr city-split Salary/Bonus Expense / Cr Payroll Payable (net) / Cr Factory Worker Advances
        const totalGross = totalNet + totalAdvanceDeductions;
        if (totalGross > 0) {
          const desc = `Payroll expense: ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`;
          const [genVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber: `PAYROLL-GEN-${Date.now()}`,
              voucherType: "Journal",
              voucherDate: periodStart,
              description: desc,
              totalAmount: totalGross.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();
          const journalEntries: any[] = [];
          // DR entries per city (salary and bonus split by city)
          for (const [ck, salAmt] of salaryByCity) {
            const bonAmt = bonusByCity.get(ck) || 0;
            const accs = cityAccCache.get(ck) ?? cityAccCache.get("")!;
            if (ck) {
              const capCity = ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase();
              if (salAmt > 0) {
                journalEntries.push({
                  voucherId: genVoucher.id,
                  ledgerAccountId: accs.salaryId,
                  debitAmount: salAmt.toFixed(2),
                  creditAmount: "0",
                  narration: `Salary expense - ${capCity} (${periodStart} – ${periodEnd})`,
                });
              }
              if (bonAmt > 0) {
                journalEntries.push({
                  voucherId: genVoucher.id,
                  ledgerAccountId: accs.bonusId,
                  debitAmount: bonAmt.toFixed(2),
                  creditAmount: "0",
                  narration: `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})`,
                });
              }
            } else {
              // Workers with no city: combine into legacy "Factory Worker Payroll" account
              const totalForCity = salAmt + bonAmt;
              if (totalForCity > 0) {
                journalEntries.push({
                  voucherId: genVoucher.id,
                  ledgerAccountId: accs.salaryId,
                  debitAmount: totalForCity.toFixed(2),
                  creditAmount: "0",
                  narration: desc,
                });
              }
            }
          }
          // Handle cities present only in bonusByCity (edge case: bonus with no salary)
          for (const [ck, bonAmt] of bonusByCity) {
            if (!salaryByCity.has(ck) && bonAmt > 0) {
              const accs = cityAccCache.get(ck) ?? cityAccCache.get("")!;
              const capCity = ck ? ck.charAt(0).toUpperCase() + ck.slice(1).toLowerCase() : "";
              journalEntries.push({
                voucherId: genVoucher.id,
                ledgerAccountId: ck ? accs.bonusId : accs.salaryId,
                debitAmount: bonAmt.toFixed(2),
                creditAmount: "0",
                narration: ck ? `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})` : desc,
              });
            }
          }
          if (totalNet > 0) {
            journalEntries.push({
              voucherId: genVoucher.id,
              ledgerAccountId: payableAccGen.id,
              debitAmount: "0",
              creditAmount: totalNet.toFixed(2),
              narration: desc,
            });
          }
          // Credit Factory Worker Advances to reduce the asset as deductions are settled
          if (totalAdvanceDeductions > 0) {
            journalEntries.push({
              voucherId: genVoucher.id,
              ledgerAccountId: advancesAccGen.id,
              debitAmount: "0",
              creditAmount: totalAdvanceDeductions.toFixed(2),
              narration: `Advance deductions settled - ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`,
            });
          }
          await tx.insert(voucherEntries).values(journalEntries);
        }
        await writeDaybookEntry(tx, {
          companyId,
          txDate: periodStart,
          txType: "PAYROLL_GENERATED",
          description: `Payroll generated: ${count} worker${count !== 1 ? "s" : ""} for period ${periodStart} – ${periodEnd}`,
          amountCurrency: totalNet,
          amountUsd: totalNet,
        });
        return count;
      });
      res.json({ created });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/payrolls/:id/detail - Full payroll detail with per-day attendance
  app.get("/api/factory/payrolls/:id/detail", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [payroll] = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));
      if (!payroll) return res.status(404).json({ message: "Payroll not found" });

      const attendanceRows = await db
        .select()
        .from(factoryAttendance)
        .where(
          and(
            eq(factoryAttendance.companyId, companyId),
            eq(factoryAttendance.workerId, payroll.workerId),
            gte(factoryAttendance.attendanceDate, payroll.periodStart),
            lte(factoryAttendance.attendanceDate, payroll.periodEnd)
          )
        )
        .orderBy(factoryAttendance.attendanceDate);

      res.json({ payroll, attendance: attendanceRows });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/payrolls/:id/mark-paid - Mark single payroll as paid
  app.patch("/api/factory/payrolls/:id/mark-paid", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;
      const paymentDate = req.body.paymentDate || getClientDate(req);

      // Pre-resolve ledger OUTSIDE the transaction to prevent concurrent insert conflicts
      const payableAccSingle = cashAccountId
        ? await findOrCreateLedger(companyId, "Payroll Payable", "Liability")
        : null;

      const updated = await db.transaction(async (tx: any) => {
        const [payroll] = await tx
          .update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(paymentDate), cashAccountId } as any)
          .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)))
          .returning();
        if (!payroll) throw new Error("Payroll record not found");

        const [prWorker] = await tx
          .select({ fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(eq(factoryWorkers.id, payroll.workerId));
        const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
        const prToday = paymentDate;

        if (cashAccountId) {
          // Accounting: Dr Payroll Payable / Cr Cash (settling the liability created at run time)
          const payableAcc = payableAccSingle!;

          const netAmt = parseFloat(payroll.netSalary || "0");
          const narration = `Payroll payment: ${workerName} (${payroll.periodStart} – ${payroll.periodEnd})`;

          const [pVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber: `PAYMENT-PAY-${payroll.id}-${Date.now()}`,
              voucherType: "Payment",
              voucherDate: prToday,
              description: narration,
              totalAmount: netAmt.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: pVoucher.id,
              ledgerAccountId: payableAcc.id,
              debitAmount: netAmt.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: pVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: netAmt.toFixed(2),
              narration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: prToday,
          txType: "PAYROLL_PAYMENT",
          referenceId: payroll.id,
          description: `Payroll paid: ${workerName} – ${parseFloat(payroll.netSalary || "0").toFixed(2)} (${payroll.periodStart} – ${payroll.periodEnd})`,
          amountCurrency: parseFloat(payroll.netSalary || "0"),
          amountUsd: parseFloat(payroll.netSalary || "0"),
        });

        return payroll;
      });

      res.json(updated);
    } catch (error: any) {
      if (error.message === "Payroll record not found") return res.status(404).json({ message: error.message });
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/payrolls/:id/fix-accounting - generate missing accounting entry for already-PAID payrolls
  app.patch("/api/factory/payrolls/:id/fix-accounting", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;
      if (!cashAccountId) return res.status(400).json({ message: "cashAccountId is required" });

      const [payroll] = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));
      if (!payroll) return res.status(404).json({ message: "Payroll not found" });
      if (!["PAID", "APPROVED"].includes(payroll.status))
        return res.status(400).json({ message: "Payroll must be in PAID or APPROVED status" });
      if (payroll.cashAccountId)
        return res.status(400).json({ message: "Accounting entry already exists for this payroll" });

      const [cashAcc] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcc) return res.status(400).json({ message: "Cash account not found" });

      const payableAcc = await findOrCreateLedger(companyId, "Payroll Payable", "Liability");

      const [prWorker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, payroll.workerId));
      const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
      const paidDate = payroll.paidAt ? new Date(payroll.paidAt).toISOString().split("T")[0] : getClientDate(req);

      const netAmt = parseFloat(payroll.netSalary || "0");
      const narration = `Payroll payment (backdated): ${workerName} (${payroll.periodStart} – ${payroll.periodEnd})`;

      const [pVoucher] = await db
        .insert(vouchers)
        .values({
          companyId,
          voucherNumber: `PAYMENT-PAY-${payroll.id}-${Date.now()}`,
          voucherType: "Payment",
          voucherDate: paidDate,
          description: narration,
          totalAmount: netAmt.toFixed(2),
          currency: "USD",
          sourceModule: "FACTORY",
        })
        .returning();

      await db.insert(voucherEntries).values([
        {
          voucherId: pVoucher.id,
          ledgerAccountId: payableAcc.id,
          debitAmount: netAmt.toFixed(2),
          creditAmount: "0",
          narration,
        },
        {
          voucherId: pVoucher.id,
          ledgerAccountId: cashAccountId,
          debitAmount: "0",
          creditAmount: netAmt.toFixed(2),
          narration,
        },
      ]);

      // Update payroll to record which account was used
      await db
        .update(factoryPayrolls)
        .set({ cashAccountId } as any)
        .where(eq(factoryPayrolls.id, id));

      res.json({ message: "Accounting entry generated", voucherId: pVoucher.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  async function settleAdvancesForPayroll(tx: any, companyId: number, workerId: number, advanceAmount: number) {
    if (advanceAmount <= 0) return;
    const outstanding = await tx
      .select()
      .from(factoryWorkerAdvances)
      .where(
        and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.workerId, workerId),
          eq(factoryWorkerAdvances.fullyPaid, false),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
        )
      )
      .orderBy(factoryWorkerAdvances.advanceDate);
    let remaining = advanceAmount;
    for (const adv of outstanding) {
      if (remaining <= 0) break;
      const bal = parseFloat(adv.remainingBalance || "0");
      const reduce = Math.min(bal, remaining);
      const newBal = bal - reduce;
      await tx
        .update(factoryWorkerAdvances)
        .set({
          remainingBalance: newBal.toFixed(2),
          fullyPaid: newBal <= 0,
        })
        .where(eq(factoryWorkerAdvances.id, adv.id));
      remaining -= reduce;
    }
  }

  // POST /api/factory/payrolls/mark-paid-bulk - Mark multiple payrolls as paid
  app.post("/api/factory/payrolls/mark-paid-bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { payrollIds, cashAccountId } = req.body;
      if (!payrollIds?.length) return res.status(400).json({ message: "payrollIds required" });
      const cashId = cashAccountId ? parseInt(cashAccountId) : null;
      const bulkPrToday = req.body.paymentDate || getClientDate(req);

      // Pre-resolve ledger OUTSIDE the transaction to prevent concurrent insert conflicts
      const payableAccBulk = cashId ? await findOrCreateLedger(companyId, "Payroll Payable", "Liability") : null;

      await db.transaction(async (tx: any) => {
        const payrollsToMark = await tx
          .select()
          .from(factoryPayrolls)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        await tx
          .update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(bulkPrToday), cashAccountId: cashId } as any)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        // Accounting: Dr Payroll Payable / Cr Cash (settling liability created at run time)
        const payableAcc = payableAccBulk;

        const workerIds = [...new Set(payrollsToMark.map((p: any) => p.workerId))];
        const workerRows = await tx
          .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(inArray(factoryWorkers.id, workerIds));
        const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

        for (const pr of payrollsToMark) {
          if (cashId && payableAcc) {
            const netAmt = parseFloat(pr.netSalary || "0");
            const workerName = (workerMap.get(pr.workerId) as string)?.trim() || `Worker #${pr.workerId}`;
            const narration = `Payroll payment: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;

            const [pVoucher] = await tx
              .insert(vouchers)
              .values({
                companyId,
                voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
                voucherType: "Payment",
                voucherDate: bulkPrToday,
                description: narration,
                totalAmount: netAmt.toFixed(2),
                currency: "USD",
                sourceModule: "FACTORY",
              })
              .returning();

            await tx.insert(voucherEntries).values([
              {
                voucherId: pVoucher.id,
                ledgerAccountId: payableAcc.id,
                debitAmount: netAmt.toFixed(2),
                creditAmount: "0",
                narration,
              },
              {
                voucherId: pVoucher.id,
                ledgerAccountId: cashId,
                debitAmount: "0",
                creditAmount: netAmt.toFixed(2),
                narration,
              },
            ]);
          }
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: bulkPrToday,
          txType: "PAYROLL_PAYMENT",
          description: `Payroll bulk paid: ${payrollIds.length} worker${payrollIds.length !== 1 ? "s" : ""}`,
        });
      });

      res.json({ updated: payrollIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payrolls/payment-summary-pdf - Compact payment summary PDF
  app.post("/api/factory/payrolls/payment-summary-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { payrollIds } = req.body;
      if (!payrollIds?.length) return res.status(400).json({ message: "payrollIds required" });

      const payrollRows = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));
      if (!payrollRows.length) return res.status(404).json({ message: "No payroll records found" });

      const workerIdList = [...new Set(payrollRows.map((p: any) => p.workerId))];
      const workerRows = await db
        .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIdList));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const [companyRow] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
      const companyName = companyRow?.name || "Company";

      const PDFDocument = (await import("pdfkit")).default;
      const pathMod = await import("path");

      // Arabic / Unicode font setup
      const psumFontDir = pathMod.join(process.cwd(), "server", "fonts");
      const psumArabicFontPath = pathMod.join(psumFontDir, "Amiri-Regular.ttf");
      const psumHasArabicFont = fs.existsSync(psumArabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (psumHasArabicFont) doc.registerFont("Arabic", psumArabicFontPath);

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="payment-summary.pdf"`);
        res.send(pdf);
      });

      // Arabic reshaping helpers
      let psumConvertArabic: ((t: string) => string) | null = null;
      let psumBidi: {
        getEmbeddingLevels: (t: string, d: string) => any;
        getReorderedString: (t: string, l: any) => string;
      } | null = null;
      try {
        psumConvertArabic = (require("arabic-reshaper") as any).convertArabic;
        psumBidi = (require("bidi-js") as any)();
      } catch {}

      const psumContainsArabic = (text: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const psumShapeText = (text: string): string => {
        if (!text || !psumConvertArabic) return text;
        try {
          const reshaped = psumConvertArabic(text);
          if (psumBidi) {
            const levels = psumBidi.getEmbeddingLevels(reshaped, "rtl");
            return psumBidi.getReorderedString(reshaped, levels);
          }
          return reshaped;
        } catch {
          return text;
        }
      };

      // Render text with automatic Arabic/Unicode font switching
      const psumRenderText = (
        text: string,
        x: number,
        yPos: number,
        w: number,
        align: "left" | "right" | "center",
        size = 8
      ) => {
        const hasAr = psumHasArabicFont && psumContainsArabic(text);
        doc
          .font(hasAr ? "Arabic" : "Helvetica")
          .fontSize(size)
          .text(hasAr ? psumShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header logo
      const hmdLogoPathPay = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(hmdLogoPathPay)) {
        try {
          doc.image(hmdLogoPathPay, (doc.page.width - 220) / 2, doc.y, { width: 220 });
          doc.moveDown(0.5);
        } catch {}
      }
      doc.fontSize(10).font("Helvetica").text("Payment Summary", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor("#666666").text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
      doc.moveDown(0.8);

      // Period range
      const periods = [...new Set(payrollRows.map((p: any) => `${p.periodStart} – ${p.periodEnd}`))];
      doc
        .fontSize(8)
        .fillColor("#333333")
        .text(`Period: ${periods.join(", ")}`);
      doc.moveDown(0.5);

      // Table layout — 5 columns: Name | Present | Absent | Amount | Signature
      // Total table: x=40 to x=555 = 515px wide
      const COL = { name: 40, present: 265, absent: 313, amount: 368, signature: 445 };
      const COL_W = { name: 215, present: 40, absent: 40, amount: 70, signature: 110 };
      const rowH = 20;
      const tableTop = doc.y;

      // Table header row
      doc.rect(40, tableTop, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
      doc.text("Worker Name", COL.name, tableTop + 6, { width: COL_W.name });
      doc.text("Present", COL.present, tableTop + 6, { width: COL_W.present, align: "center" });
      doc.text("Absent", COL.absent, tableTop + 6, { width: COL_W.absent, align: "center" });
      doc.text("Amount", COL.amount, tableTop + 6, { width: COL_W.amount, align: "right" });
      doc.text("Signature", COL.signature, tableTop + 6, { width: COL_W.signature, align: "center" });

      let y = tableTop + rowH;
      let totalAmt = 0;

      payrollRows.forEach((p: any, i: number) => {
        const name = (workerMap.get(p.workerId) as string) || `Worker #${p.workerId}`;
        const present = p.presentDays != null ? Number(p.presentDays) : "—";
        const absent = p.absentDays != null ? Number(p.absentDays) : "—";
        const net = parseFloat(p.netSalary || "0");
        totalAmt += net;

        if (i % 2 === 1) doc.rect(40, y, 515, rowH).fill("#f5f7fa");
        doc.fillColor("#000000");

        // Worker name — supports Arabic/Unicode
        psumRenderText(name, COL.name, y + 6, COL_W.name, "left");

        doc.font("Helvetica").fontSize(8);
        doc.text(
          typeof present === "number" ? (present % 1 === 0 ? present.toFixed(0) : present.toFixed(1)) : "—",
          COL.present,
          y + 6,
          { width: COL_W.present, align: "center" }
        );
        doc.text(
          typeof absent === "number" ? (absent % 1 === 0 ? absent.toFixed(0) : absent.toFixed(1)) : "—",
          COL.absent,
          y + 6,
          { width: COL_W.absent, align: "center" }
        );
        doc.text(net.toFixed(2), COL.amount, y + 6, { width: COL_W.amount, align: "right" });

        // Signature box — a horizontal line for the worker to sign
        const sigLineY = y + rowH - 5;
        doc
          .moveTo(COL.signature + 8, sigLineY)
          .lineTo(COL.signature + COL_W.signature - 8, sigLineY)
          .strokeColor("#aaaaaa")
          .lineWidth(0.5)
          .stroke();

        y += rowH;
      });

      // Footer total row
      doc.rect(40, y + 2, 515, rowH).fill("#1F3864");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      doc.text("Total Amount Paid", COL.name, y + 7, { width: COL_W.name + COL_W.present + COL_W.absent + 8 });
      doc.text(totalAmt.toFixed(2), COL.amount, y + 7, { width: COL_W.amount, align: "right" });

      doc.end();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/stats - Get worker productivity stats

  // POST /api/factory/payroll/migrate-city-split
  // One-time migration: splits historical "Factory Worker Payroll" expense entries by city,
  // and creates missing accounting entries for paid worker bonuses.
  app.post("/api/factory/payroll/migrate-city-split", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // --- Step 1: Resolve city-specific accounts ---
      const cities = await db.execute(sql`
        SELECT DISTINCT TRIM(city) as city
        FROM factory_workers
        WHERE company_id = ${companyId} AND city IS NOT NULL AND TRIM(city) <> ''
      `);
      const cityRows = cities.rows as { city: string }[];

      const salaryAccByCity = new Map<string, number>();
      const bonusAccByCity = new Map<string, number>();
      for (const { city } of cityRows) {
        const capCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
        const [sa, ba] = await Promise.all([
          findOrCreateLedger(companyId, `Salary Expense - ${capCity}`, "Expense"),
          findOrCreateLedger(companyId, `Bonus Expense - ${capCity}`, "Expense"),
        ]);
        salaryAccByCity.set(city.trim(), sa.id);
        bonusAccByCity.set(city.trim(), ba.id);
      }
      const legacyAcc = await findOrCreateLedger(companyId, "Factory Worker Payroll", "Expense");

      // --- Step 2: Migrate PAYROLL-GEN-* vouchers ---
      const genVouchers = await db.execute(sql`
        SELECT v.id, v.voucher_date, v.description, ve.id as entry_id, ve.debit_amount
        FROM vouchers v
        JOIN voucher_entries ve ON ve.voucher_id = v.id
        WHERE v.company_id = ${companyId}
          AND v.voucher_number LIKE 'PAYROLL-GEN-%'
          AND ve.ledger_account_id = ${legacyAcc.id}
          AND CAST(ve.debit_amount AS numeric) > 0
      `);

      let vouchersUpdated = 0;
      for (const row of genVouchers.rows as any[]) {
        const voucherDate = row.voucher_date as string;
        // Parse period end from description: "Payroll expense: N workers (YYYY-MM-DD – YYYY-MM-DD)"
        const periodMatch = (row.description as string).match(/\((\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})\)/);
        if (!periodMatch) continue;
        const periodStart = periodMatch[1];
        const periodEnd = periodMatch[2];

        // Find factory_payrolls for this period
        const payrollData = await db.execute(sql`
          SELECT fp.base_salary, fp.bonuses, fp.transport, fp.deductions,
                 fw.city
          FROM factory_payrolls fp
          JOIN factory_workers fw ON fw.id = fp.worker_id
          WHERE fp.company_id = ${companyId}
            AND fp.period_start = ${periodStart}
            AND fp.period_end = ${periodEnd}
        `);

        if (payrollData.rows.length === 0) continue;

        // Aggregate by city
        const salByCity = new Map<string, number>();
        const bonByCity = new Map<string, number>();
        for (const pr of payrollData.rows as any[]) {
          const city = (pr.city as string | null)?.trim() || "";
          const sal = parseFloat(pr.base_salary || "0") + parseFloat(pr.transport || "0") - parseFloat(pr.deductions || "0");
          const bon = parseFloat(pr.bonuses || "0");
          salByCity.set(city, (salByCity.get(city) || 0) + sal);
          bonByCity.set(city, (bonByCity.get(city) || 0) + bon);
        }

        // Delete the old single-city debit entry
        await db.execute(sql`DELETE FROM voucher_entries WHERE id = ${row.entry_id}`);

        // Insert new split entries
        const newEntries: any[] = [];
        const allCities = new Set([...salByCity.keys(), ...bonByCity.keys()]);
        for (const city of allCities) {
          const salAmt = salByCity.get(city) || 0;
          const bonAmt = bonByCity.get(city) || 0;
          if (city) {
            const capCity = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
            if (salAmt > 0) {
              const salAccId = salaryAccByCity.get(city) ?? legacyAcc.id;
              newEntries.push({
                voucherId: row.id,
                ledgerAccountId: salAccId,
                debitAmount: salAmt.toFixed(2),
                creditAmount: "0",
                narration: `Salary expense - ${capCity} (${periodStart} – ${periodEnd})`,
              });
            }
            if (bonAmt > 0) {
              const bonAccId = bonusAccByCity.get(city) ?? legacyAcc.id;
              newEntries.push({
                voucherId: row.id,
                ledgerAccountId: bonAccId,
                debitAmount: bonAmt.toFixed(2),
                creditAmount: "0",
                narration: `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})`,
              });
            }
          } else {
            const total = salAmt + bonAmt;
            if (total > 0) {
              newEntries.push({
                voucherId: row.id,
                ledgerAccountId: legacyAcc.id,
                debitAmount: total.toFixed(2),
                creditAmount: "0",
                narration: `Payroll expense (no city) (${periodStart} – ${periodEnd})`,
              });
            }
          }
        }
        if (newEntries.length > 0) {
          await db.insert(voucherEntries).values(newEntries);
        }
        vouchersUpdated++;
      }

      // --- Step 3: Create missing accounting for paid worker bonuses ---
      const paidBonuses = await db.execute(sql`
        SELECT wb.id, wb.worker_id, wb.bonus_date, wb.amount, wb.notes,
               wb.cash_account_id, wb.paid_date,
               fw.city, fw.full_name
        FROM worker_bonuses wb
        JOIN factory_workers fw ON fw.id = wb.worker_id
        WHERE wb.company_id = ${companyId}
          AND wb.status = 'paid'
          AND wb.cash_account_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM vouchers v
            WHERE v.company_id = ${companyId}
              AND v.voucher_number LIKE 'WBONUS-' || wb.id || '-%'
          )
      `);

      let bonusesRecorded = 0;
      for (const wb of paidBonuses.rows as any[]) {
        const amt = parseFloat(wb.amount || "0");
        if (amt <= 0) continue;
        const city = (wb.city as string | null)?.trim() || "";
        const capCity = city ? city.charAt(0).toUpperCase() + city.slice(1).toLowerCase() : "";
        const expAccId = city ? (bonusAccByCity.get(city) ?? legacyAcc.id) : legacyAcc.id;
        const paidDate = wb.paid_date || wb.bonus_date;
        const narration = wb.notes || `Bonus for ${wb.full_name}`;

        const [bVoucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber: `WBONUS-${wb.id}-${Date.now()}`,
            voucherType: "Journal",
            voucherDate: paidDate,
            description: narration,
            totalAmount: amt.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          })
          .returning();

        await db.insert(voucherEntries).values([
          {
            voucherId: bVoucher.id,
            ledgerAccountId: expAccId,
            debitAmount: amt.toFixed(2),
            creditAmount: "0",
            narration: city ? `Bonus expense - ${capCity}: ${narration}` : narration,
          },
          {
            voucherId: bVoucher.id,
            ledgerAccountId: parseInt(wb.cash_account_id),
            debitAmount: "0",
            creditAmount: amt.toFixed(2),
            narration,
          },
        ]);
        bonusesRecorded++;
      }

      res.json({
        message: "Migration complete",
        vouchersUpdated,
        bonusEntriesCreated: bonusesRecorded,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
