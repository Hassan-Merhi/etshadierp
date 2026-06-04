import { parseId, parseOptionalId } from "../lib/parseId";
import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
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
async function writeDaybookEntry(dbOrTx: any, opts: {
  companyId: number; txDate: string; txType: string;
  referenceId?: number; referenceTable?: string; description: string;
  metaJson?: string; currencyCode?: string; amountCurrency?: number;
  fxRateToUsd?: number; amountUsd?: number; createdBy?: number;
}) {
  const currency = opts.currencyCode || "USD";
  const fxRate = opts.fxRateToUsd || 1;
  const amtCurrency = opts.amountCurrency || 0;
  const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
  await dbOrTx.insert(factoryDaybookEntries).values({
    companyId: opts.companyId, txDate: opts.txDate, txType: opts.txType,
    referenceId: opts.referenceId || null, referenceTable: opts.referenceTable || null,
    description: opts.description, metaJson: opts.metaJson || null,
    currencyCode: currency, amountCurrency: String(amtCurrency),
    fxRateToUsd: String(fxRate), amountUsd: String(amtUsd), createdBy: opts.createdBy || null,
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
  const end   = new Date(endStr   + "T00:00:00");
  let total = 0;
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const year  = cur.getFullYear();
    const month = cur.getMonth();
    const monthLastDay    = new Date(year, month + 1, 0);
    const daysInThisMonth = monthLastDay.getDate();
    const segStart = new Date(Math.max(cur.getTime(), start.getTime()));
    const segEnd   = new Date(Math.min(monthLastDay.getTime(), end.getTime()));
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

export function registerFactoryWorkerPayrollRoutes(app: Express) {
  app.get("/api/factory/cash-accounts", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accounts = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, code: ledgerAccounts.code })
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
      const payrolls = await db.select().from(factoryPayrolls)
        .where(eq(factoryPayrolls.companyId, companyId))
        .orderBy(desc(factoryPayrolls.periodEnd));
      // Attach worker names
      const workerIds = [...new Set(payrolls.map((p: any) => p.workerId))];
      const workers = workerIds.length ? await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName, employeeCode: factoryWorkers.employeeCode, position: factoryWorkers.position })
        .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds)) : [];
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
      const payrolls = await db.select().from(factoryPayrolls)
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
        targetWorkers = await db.select().from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db.select().from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      // Fetch all attendance records for the period in one query
      const workerIdList = targetWorkers.map((w: any) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db.select().from(factoryAttendance).where(
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

      // Outstanding advances (salary deduction type)
      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.fullyPaid, false),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
        ))
        .orderBy(factoryWorkerAdvances.advanceDate);
      const advanceByWorker: Record<number, number> = {};
      const advanceListByWorker: Record<number, typeof allAdvances> = {};
      for (const adv of allAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
        if (!advanceListByWorker[adv.workerId]) advanceListByWorker[adv.workerId] = [];
        advanceListByWorker[adv.workerId].push(adv);
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
        const transportOverrideAmt = transportOverrides ? parseFloat(transportOverrides[String(worker.id)] ?? "-1") : -1;
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
        const net = base + bonus + transport - advanceDeduction;
        const pendingAdvances = (advanceListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
        }));

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
          net,
          totalWorkingDays: transportMonthDays,   // full month days — denominator used for proration
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
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker, cashAccountId, notes, advanceOverrides, transportOverrides } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });
      // advanceOverrides: { [workerId: string]: number } — user-approved deduction per worker

      const days = daysCount ? parseInt(daysCount) : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db.select().from(factoryWorkers).where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      const daysInMonth = (d: string) => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); };

      // Fetch all attendance records for the period (for monthly attendance-based calculation)
      const workerIdList = targetWorkers.map((w: any) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db.select().from(factoryAttendance).where(
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

      const allOutstandingAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.fullyPaid, false), eq(factoryWorkerAdvances.repaymentType, "salary_deduction")));
      const advanceByWorker: Record<number, number> = {};
      for (const adv of allOutstandingAdvances) {
        advanceByWorker[adv.workerId] = (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
      }

      // Fetch pending (unapplied) deductions per worker
      const allPendingDeductions = await db.select().from(factoryWorkerDeductions)
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

      // Pre-resolve ledger accounts OUTSIDE the transaction to prevent concurrent insert conflicts
      const [expenseAcc, payableAccGen, advancesAccGen] = await Promise.all([
        findOrCreateLedger(companyId, "Factory Worker Payroll", "Expense"),
        findOrCreateLedger(companyId, "Payroll Payable", "Liability"),
        findOrCreateLedger(companyId, "Factory Worker Advances", "Asset"),
      ]);

      const created = await db.transaction(async (tx: any) => {
        let count = 0;
        let totalNet = 0;
        let totalAdvanceDeductions = 0;
        for (const worker of targetWorkers) {
          const baseSal = parseFloat(worker.baseSalary || "0");
          const freq = (worker as any).payFrequency || worker.salaryType || "Monthly";
          let base = 0;
          if (freq === "Weekly") base = (days / 7) * parseFloat((worker as any).weeklySalary || baseSal.toString());
          else if (freq === "Bi-Weekly") base = (days / 14) * parseFloat((worker as any).biWeeklySalary || baseSal.toString());
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
          const transportOverrideAmt2 = transportOverrides ? parseFloat(transportOverrides[String(worker.id)] ?? "-1") : -1;
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
          const advanceDeduction = overrideAmt >= 0
            ? Math.min(overrideAmt, base + bonus + transport, workerAdvanceBalance)
            : Math.min(workerAdvanceBalance, base + bonus + transport);
          // Include pending worker deductions
          const workerPendingDeductions = deductionAmtByWorker[worker.id] || 0;
          const net = base + bonus + transport - advanceDeduction - workerPendingDeductions;
          const [newPayroll] = await tx.insert(factoryPayrolls).values({
            companyId, workerId: worker.id, periodStart, periodEnd,
            baseSalary: base.toFixed(2), bonuses: bonus.toFixed(2),
            transport: transport.toFixed(2),
            baleEarnings: "0", kgEarnings: "0", overtimePay: "0",
            deductions: workerPendingDeductions.toFixed(2),
            advances: advanceDeduction.toFixed(2),
            netSalary: net.toFixed(2), balesCount: 0, kgProcessed: "0", overtimeHours: "0",
            status: "DRAFT", notes: notes || null,
            cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
          } as any).returning({ id: factoryPayrolls.id });
          // Mark pending deductions as applied
          if (deductionByWorker[worker.id]?.length) {
            await tx.update(factoryWorkerDeductions)
              .set({ applied: true, payrollId: newPayroll.id } as any)
              .where(inArray(factoryWorkerDeductions.id, deductionByWorker[worker.id]));
          }
          // Settle advances immediately at generate time so remaining balance updates right away
          await settleAdvancesForPayroll(tx, companyId, worker.id, advanceDeduction);
          totalNet += net;
          totalAdvanceDeductions += advanceDeduction;
          count++;
        }
        // Accounting: Dr Payroll Expense (gross) / Cr Payroll Payable (net) / Cr Factory Worker Advances (deductions)
        const totalGross = totalNet + totalAdvanceDeductions;
        if (totalGross > 0) {
          const payableAcc = payableAccGen;
          const desc = `Payroll expense: ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})`;
          const [genVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `PAYROLL-GEN-${Date.now()}`,
            voucherType: "Journal",
            voucherDate: periodStart,
            description: desc,
            totalAmount: totalGross.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();
          const journalEntries: any[] = [
            { voucherId: genVoucher.id, ledgerAccountId: expenseAcc.id, debitAmount: totalGross.toFixed(2), creditAmount: "0", narration: desc },
          ];
          if (totalNet > 0) {
            journalEntries.push({ voucherId: genVoucher.id, ledgerAccountId: payableAcc.id, debitAmount: "0", creditAmount: totalNet.toFixed(2), narration: desc });
          }
          // Credit Factory Worker Advances to reduce the asset as deductions are settled
          if (totalAdvanceDeductions > 0) {
            journalEntries.push({ voucherId: genVoucher.id, ledgerAccountId: advancesAccGen.id, debitAmount: "0", creditAmount: totalAdvanceDeductions.toFixed(2), narration: `Advance deductions settled - ${count} worker${count !== 1 ? "s" : ""} (${periodStart} – ${periodEnd})` });
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

      const [payroll] = await db.select().from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));
      if (!payroll) return res.status(404).json({ message: "Payroll not found" });

      const attendanceRows = await db.select().from(factoryAttendance)
        .where(and(
          eq(factoryAttendance.companyId, companyId),
          eq(factoryAttendance.workerId, payroll.workerId),
          gte(factoryAttendance.attendanceDate, payroll.periodStart),
          lte(factoryAttendance.attendanceDate, payroll.periodEnd),
        ))
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
        const [payroll] = await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(paymentDate), cashAccountId } as any)
          .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)))
          .returning();
        if (!payroll) throw new Error("Payroll record not found");

        const [prWorker] = await tx.select({ fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(eq(factoryWorkers.id, payroll.workerId));
        const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
        const prToday = paymentDate;

        if (cashAccountId) {
          // Accounting: Dr Payroll Payable / Cr Cash (settling the liability created at run time)
          const payableAcc = payableAccSingle!;

          const netAmt = parseFloat(payroll.netSalary || "0");
          const narration = `Payroll payment: ${workerName} (${payroll.periodStart} – ${payroll.periodEnd})`;

          const [pVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber: `PAYMENT-PAY-${payroll.id}-${Date.now()}`,
            voucherType: "Payment",
            voucherDate: prToday,
            description: narration,
            totalAmount: netAmt.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

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

      const [payroll] = await db.select().from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));
      if (!payroll) return res.status(404).json({ message: "Payroll not found" });
      if (!["PAID", "APPROVED"].includes(payroll.status)) return res.status(400).json({ message: "Payroll must be in PAID or APPROVED status" });
      if (payroll.cashAccountId) return res.status(400).json({ message: "Accounting entry already exists for this payroll" });

      const [cashAcc] = await db.select().from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcc) return res.status(400).json({ message: "Cash account not found" });

      const payableAcc = await findOrCreateLedger(companyId, "Payroll Payable", "Liability");

      const [prWorker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, payroll.workerId));
      const workerName = prWorker?.fullName?.trim() || `Worker #${payroll.workerId}`;
      const paidDate = payroll.paidAt
        ? new Date(payroll.paidAt).toISOString().split("T")[0]
        : getClientDate(req);

      const netAmt = parseFloat(payroll.netSalary || "0");
      const narration = `Payroll payment (backdated): ${workerName} (${payroll.periodStart} – ${payroll.periodEnd})`;

      const [pVoucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber: `PAYMENT-PAY-${payroll.id}-${Date.now()}`,
        voucherType: "Payment",
        voucherDate: paidDate,
        description: narration,
        totalAmount: netAmt.toFixed(2),
        currency: "USD",
        sourceModule: "FACTORY",
      }).returning();

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
      await db.update(factoryPayrolls).set({ cashAccountId } as any)
        .where(eq(factoryPayrolls.id, id));

      res.json({ message: "Accounting entry generated", voucherId: pVoucher.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  async function settleAdvancesForPayroll(tx: any, companyId: number, workerId: number, advanceAmount: number) {
    if (advanceAmount <= 0) return;
    const outstanding = await tx.select().from(factoryWorkerAdvances)
      .where(and(
        eq(factoryWorkerAdvances.companyId, companyId),
        eq(factoryWorkerAdvances.workerId, workerId),
        eq(factoryWorkerAdvances.fullyPaid, false),
        eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
      ))
      .orderBy(factoryWorkerAdvances.advanceDate);
    let remaining = advanceAmount;
    for (const adv of outstanding) {
      if (remaining <= 0) break;
      const bal = parseFloat(adv.remainingBalance || "0");
      const reduce = Math.min(bal, remaining);
      const newBal = bal - reduce;
      await tx.update(factoryWorkerAdvances).set({
        remainingBalance: newBal.toFixed(2),
        fullyPaid: newBal <= 0,
      }).where(eq(factoryWorkerAdvances.id, adv.id));
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
      const payableAccBulk = cashId
        ? await findOrCreateLedger(companyId, "Payroll Payable", "Liability")
        : null;

      await db.transaction(async (tx: any) => {
        const payrollsToMark = await tx.select().from(factoryPayrolls)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));

        await tx.update(factoryPayrolls)
          .set({ status: "PAID", paidAt: new Date(bulkPrToday), cashAccountId: cashId } as any)
          .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));


        // Accounting: Dr Payroll Payable / Cr Cash (settling liability created at run time)
        const payableAcc = payableAccBulk;

        const workerIds = [...new Set(payrollsToMark.map((p: any) => p.workerId))];
        const workerRows = await tx.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(inArray(factoryWorkers.id, workerIds));
        const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

        for (const pr of payrollsToMark) {
          if (cashId && payableAcc) {
            const netAmt = parseFloat(pr.netSalary || "0");
            const workerName = (workerMap.get(pr.workerId) as string)?.trim() || `Worker #${pr.workerId}`;
            const narration = `Payroll payment: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;

            const [pVoucher] = await tx.insert(vouchers).values({
              companyId,
              voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
              voucherType: "Payment",
              voucherDate: bulkPrToday,
              description: narration,
              totalAmount: netAmt.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            }).returning();

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

      const payrollRows = await db.select().from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.companyId, companyId), inArray(factoryPayrolls.id, payrollIds)));
      if (!payrollRows.length) return res.status(404).json({ message: "No payroll records found" });

      const workerIdList = [...new Set(payrollRows.map((p: any) => p.workerId))];
      const workerRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIdList));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const [companyRow] = await db.select({ name: companies.name })
        .from(companies).where(eq(companies.id, companyId));
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
      let psumBidi: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
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
        } catch { return text; }
      };

      // Render text with automatic Arabic/Unicode font switching
      const psumRenderText = (text: string, x: number, yPos: number, w: number, align: "left" | "right" | "center", size = 8) => {
        const hasAr = psumHasArabicFont && psumContainsArabic(text);
        doc.font(hasAr ? "Arabic" : "Helvetica").fontSize(size)
          .text(hasAr ? psumShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header logo
      const hmdLogoPathPay = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(hmdLogoPathPay)) {
        try { doc.image(hmdLogoPathPay, (doc.page.width - 220) / 2, doc.y, { width: 220 }); doc.moveDown(0.5); } catch {}
      }
      doc.fontSize(10).font("Helvetica").text("Payment Summary", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(8).fillColor("#666666")
        .text(`Generated: ${new Date().toLocaleDateString()}`, { align: "center" });
      doc.moveDown(0.8);

      // Period range
      const periods = [...new Set(payrollRows.map((p: any) => `${p.periodStart} – ${p.periodEnd}`))];
      doc.fontSize(8).fillColor("#333333").text(`Period: ${periods.join(", ")}`);
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
        doc.text(typeof present === "number" ? (present % 1 === 0 ? present.toFixed(0) : present.toFixed(1)) : "—", COL.present, y + 6, { width: COL_W.present, align: "center" });
        doc.text(typeof absent === "number" ? (absent % 1 === 0 ? absent.toFixed(0) : absent.toFixed(1)) : "—", COL.absent, y + 6, { width: COL_W.absent, align: "center" });
        doc.text(net.toFixed(2), COL.amount, y + 6, { width: COL_W.amount, align: "right" });

        // Signature box — a horizontal line for the worker to sign
        const sigLineY = y + rowH - 5;
        doc.moveTo(COL.signature + 8, sigLineY).lineTo(COL.signature + COL_W.signature - 8, sigLineY)
          .strokeColor("#aaaaaa").lineWidth(0.5).stroke();

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
  app.get("/api/factory/workers/:id/stats", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [worker] = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)));

      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.finalizedBy, id), eq(factoryBales.companyId, companyId)));

      const totalBales = bales.length;
      const totalKg = bales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);

      let estimatedEarnings = 0;
      const salaryType = worker.salaryType || "Monthly";

      if (salaryType === "Per Bale") {
        estimatedEarnings = totalBales * parseFloat(worker.perBaleRate || "0");
      } else if (salaryType === "Per KG") {
        estimatedEarnings = totalKg * parseFloat(worker.perKgRate || "0");
      } else if (salaryType === "Monthly" || salaryType === "Daily") {
        estimatedEarnings = parseFloat(worker.baseSalary || "0");
      }

      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.workerId, id), eq(factoryPayrolls.companyId, companyId)))
        .orderBy(desc(factoryPayrolls.periodEnd));

      const totalPaid = payrolls.reduce((sum: number, p: any) => sum + parseFloat(p.netSalary || "0"), 0);

      res.json({
        workerId: id,
        workerName: worker.fullName,
        salaryType,
        totalBales,
        totalKg: totalKg.toFixed(3),
        estimatedEarnings: estimatedEarnings.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        payrollCount: payrolls.length,
        recentPayrolls: payrolls.slice(0, 5),
      });
    } catch (error: any) {
      console.error("Error fetching worker stats:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── FACTORY WORKER ADVANCES ─────────────────────────────────────────

  // GET /api/factory/advance-repayments - List all repayments company-wide
  app.get("/api/factory/advance-repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(factoryAdvanceRepayments.companyId, companyId)];
      if (req.query.workerId) conditions.push(eq(factoryAdvanceRepayments.workerId, parseOptionalId(req.query.workerId)));

      const repayments = await db
        .select({
          id: factoryAdvanceRepayments.id,
          advanceId: factoryAdvanceRepayments.advanceId,
          workerId: factoryAdvanceRepayments.workerId,
          repaymentDate: factoryAdvanceRepayments.repaymentDate,
          amount: factoryAdvanceRepayments.amount,
          cashAccountId: factoryAdvanceRepayments.cashAccountId,
          notes: factoryAdvanceRepayments.notes,
          createdAt: factoryAdvanceRepayments.createdAt,
          advanceDate: factoryWorkerAdvances.advanceDate,
          advanceAmount: factoryWorkerAdvances.amount,
          advanceRemainingBalance: factoryWorkerAdvances.remainingBalance,
          workerName: factoryWorkers.fullName,
          cashAccountName: ledgerAccounts.name,
        })
        .from(factoryAdvanceRepayments)
        .innerJoin(factoryWorkerAdvances, eq(factoryAdvanceRepayments.advanceId, factoryWorkerAdvances.id))
        .innerJoin(factoryWorkers, eq(factoryAdvanceRepayments.workerId, factoryWorkers.id))
        .leftJoin(ledgerAccounts, eq(factoryAdvanceRepayments.cashAccountId, ledgerAccounts.id))
        .where(and(...conditions))
        .orderBy(desc(factoryAdvanceRepayments.repaymentDate));

      res.json(repayments);
    } catch (error: any) {
      console.error("Error fetching advance repayments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances - List all advances for company
  app.get("/api/factory/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(factoryWorkerAdvances.companyId, companyId)];
      if (req.query.workerId) conditions.push(eq(factoryWorkerAdvances.workerId, parseOptionalId(req.query.workerId)));
      if (req.query.status === "outstanding") conditions.push(eq(factoryWorkerAdvances.fullyPaid, false));
      if (req.query.status === "paid") conditions.push(eq(factoryWorkerAdvances.fullyPaid, true));

      const advances = await db.select().from(factoryWorkerAdvances)
        .where(and(...conditions))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const workerIds = [...new Set(advances.map((a: any) => a.workerId))];
      let workerMap: Record<number, string> = {};
      if (workerIds.length > 0) {
        const workers = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds));
        workerMap = Object.fromEntries(workers.map((w: any) => [w.id, w.fullName]));
      }

      const enriched = advances.map((a: any) => ({ ...a, workerName: workerMap[a.workerId] || `Worker #${a.workerId}` }));
      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/advances - List advances for a specific worker
  app.get("/api/factory/workers/:id/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });

      const advances = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.workerId, workerId)))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      res.json(advances);
    } catch (error: any) {
      console.error("Error fetching worker advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/advances - Record a new advance
  app.post("/api/factory/workers/:id/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });

      const amount = parseFloat(req.body.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: "Amount must be positive" });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const advanceDate = req.body.advanceDate || getClientDate(req);
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const repaymentType = req.body.repaymentType === "manual_repayment" ? "manual_repayment" : "salary_deduction";

      const result = await db.transaction(async (tx: any) => {
        const [advance] = await tx.insert(factoryWorkerAdvances).values({
          companyId, workerId, advanceDate,
          amount: amount.toFixed(2),
          remainingBalance: amount.toFixed(2),
          cashAccountId,
          notes: req.body.notes || null,
          repaymentType,
        }).returning();

        let voucherId: number | null = null;

        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.name, "Factory Worker Advances"),
            ));

          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);

            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId,
              code: nextCode,
              name: "Factory Worker Advances",
              accountType: "Asset",
              active: true,
              isHidden: false,
            }).returning();
          }

          const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
          const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: advanceDate,
            description: narration,
            totalAmount: amount.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          voucherId = createdVoucher.id;

          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: amount.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: amount.toFixed(2),
              narration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId,
          txDate: advanceDate,
          txType: "ADVANCE_GIVEN",
          referenceId: advance.id,
          referenceTable: "factory_worker_advances",
          description: `Advance given to ${worker.fullName}: $${amount.toFixed(2)}`,
          amountCurrency: amount,
          amountUsd: amount,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        return { ...advance, voucherId, workerName: worker.fullName };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Worker Deductions CRUD ───────────────────────────────────────────────

  // GET /api/factory/workers/:id/deductions
  app.get("/api/factory/workers/:id/deductions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      const deductions = await db.select().from(factoryWorkerDeductions)
        .where(and(eq(factoryWorkerDeductions.companyId, companyId), eq(factoryWorkerDeductions.workerId, workerId)))
        .orderBy(desc(factoryWorkerDeductions.createdAt));
      res.json(deductions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/workers/:id/deductions
  app.post("/api/factory/workers/:id/deductions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      const { amount, reason, deductionDate } = req.body;
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!deductionDate) return res.status(400).json({ message: "Deduction date is required" });
      const [deduction] = await db.insert(factoryWorkerDeductions).values({
        companyId,
        workerId,
        amount: parseFloat(amount).toFixed(2),
        reason: reason || null,
        deductionDate,
        applied: false,
      } as any).returning();
      res.json(deduction);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/workers/:workerId/deductions/:id
  app.delete("/api/factory/workers/:workerId/deductions/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const deductionId = parseId(req.params.id);
      const [existing] = await db.select().from(factoryWorkerDeductions)
        .where(and(eq(factoryWorkerDeductions.id, deductionId), eq(factoryWorkerDeductions.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Deduction not found" });
      if (existing.applied) return res.status(400).json({ message: "Cannot delete an already-applied deduction" });
      await db.delete(factoryWorkerDeductions).where(eq(factoryWorkerDeductions.id, deductionId));
      res.json({ message: "Deduction deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/bulk - Record advances for multiple workers at once
  app.post("/api/factory/advances/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items, advanceDate, cashAccountId: rawCashAccountId, repaymentType: rawRepaymentType, notes } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      const advDate = advanceDate || getClientDate(req);
      const cashAccountId = rawCashAccountId ? parseInt(rawCashAccountId) : null;
      const repaymentType = rawRepaymentType === "manual_repayment" ? "manual_repayment" : "salary_deduction";

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const results = await db.transaction(async (tx: any) => {
        // Resolve or create the "Factory Worker Advances" ledger account once
        let advancesAccountId: number | null = null;
        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId, code: nextCode, name: "Factory Worker Advances",
              accountType: "Asset", active: true, isHidden: false,
            }).returning();
          }
          advancesAccountId = advancesAccount.id;
        }

        const created: any[] = [];
        for (const item of items) {
          const workerId = parseInt(item.workerId);
          const amount = parseFloat(item.amount);
          if (!workerId || !amount || amount <= 0) continue;

          const [worker] = await tx.select({ fullName: factoryWorkers.fullName }).from(factoryWorkers)
            .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
          if (!worker) continue;

          const [advance] = await tx.insert(factoryWorkerAdvances).values({
            companyId, workerId, advanceDate: advDate,
            amount: amount.toFixed(2),
            remainingBalance: amount.toFixed(2),
            cashAccountId,
            notes: notes || null,
            repaymentType,
          }).returning();

          if (cashAccountId && advancesAccountId) {
            const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;
            const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
            const [createdVoucher] = await tx.insert(vouchers).values({
              companyId, voucherNumber, voucherType: "Payment",
              voucherDate: advDate, description: narration,
              totalAmount: amount.toFixed(2), currency: "USD", sourceModule: "FACTORY",
            }).returning();
            await tx.insert(voucherEntries).values([
              { voucherId: createdVoucher.id, ledgerAccountId: advancesAccountId, debitAmount: amount.toFixed(2), creditAmount: "0", narration },
              { voucherId: createdVoucher.id, ledgerAccountId: cashAccountId, debitAmount: "0", creditAmount: amount.toFixed(2), narration },
            ]);
          }

          await writeDaybookEntry(tx, {
            companyId, txDate: advDate, txType: "ADVANCE_GIVEN",
            referenceId: advance.id, referenceTable: "factory_worker_advances",
            description: `Advance given to ${worker.fullName}: $${amount.toFixed(2)}`,
            amountCurrency: amount, amountUsd: amount,
            createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
          });

          created.push({ ...advance, workerName: worker.fullName });
        }
        return created;
      });

      res.json({ created: results.length, advances: results });
    } catch (error: any) {
      console.error("Error creating bulk advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/advances/:id - Edit advance (admin/owner only)
  app.patch("/api/factory/advances/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can edit advances" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const updates: any = {};
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.advanceDate) updates.advanceDate = req.body.advanceDate;

      const [updated] = await db.update(factoryWorkerAdvances).set(updates)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Advance not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances/reconcile/preview - Dry-run reconciliation, returns what would change
  app.get("/api/factory/advances/reconcile/preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
        ))
        .orderBy(factoryWorkerAdvances.workerId, factoryWorkerAdvances.advanceDate);

      const allPayrolls = await db.select({
        workerId: factoryPayrolls.workerId,
        advances: factoryPayrolls.advances,
        periodStart: factoryPayrolls.periodStart,
      }).from(factoryPayrolls)
        .where(eq(factoryPayrolls.companyId, companyId))
        .orderBy(factoryPayrolls.workerId, factoryPayrolls.periodStart);

      const allRepayments = await db.select().from(factoryAdvanceRepayments)
        .where(eq(factoryAdvanceRepayments.companyId, companyId))
        .orderBy(factoryAdvanceRepayments.advanceId, factoryAdvanceRepayments.repaymentDate);

      // Worker names
      const workerIds = [...new Set(allAdvances.map((a: any) => a.workerId))];
      let workerMap: Record<number, string> = {};
      if (workerIds.length > 0) {
        const wRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds));
        workerMap = Object.fromEntries(wRows.map((w: any) => [w.id, w.fullName]));
      }

      const advancesByWorker = new Map<number, typeof allAdvances>();
      for (const adv of allAdvances) {
        const list = advancesByWorker.get(adv.workerId) || [];
        list.push(adv);
        advancesByWorker.set(adv.workerId, list);
      }

      const payrollDeductionByWorker = new Map<number, number>();
      for (const pr of allPayrolls) {
        const amt = parseFloat(pr.advances || "0");
        if (amt > 0) payrollDeductionByWorker.set(pr.workerId, (payrollDeductionByWorker.get(pr.workerId) || 0) + amt);
      }

      const manualRepaymentByAdvance = new Map<number, number>();
      for (const rep of allRepayments) {
        manualRepaymentByAdvance.set(rep.advanceId, (manualRepaymentByAdvance.get(rep.advanceId) || 0) + parseFloat(rep.amount || "0"));
      }

      const changes: any[] = [];
      for (const [workerId, advances] of advancesByWorker) {
        const balances: { id: number; bal: number }[] = [];
        for (const adv of advances) {
          const original = parseFloat(adv.amount || "0");
          const manualPaid = manualRepaymentByAdvance.get(adv.id) || 0;
          balances.push({ id: adv.id, bal: Math.max(0, original - manualPaid) });
        }
        let remaining = payrollDeductionByWorker.get(workerId) || 0;
        for (const entry of balances) {
          if (remaining <= 0) break;
          const deduct = Math.min(entry.bal, remaining);
          entry.bal = entry.bal - deduct;
          remaining -= deduct;
        }
        for (let i = 0; i < advances.length; i++) {
          const adv = advances[i];
          const newBal = Math.max(0, balances[i].bal);
          const newBal2dp = newBal.toFixed(2);
          const newFullyPaid = newBal <= 0.001;
          const currentBal = parseFloat(adv.remainingBalance || "0");
          const changed = adv.remainingBalance !== newBal2dp || adv.fullyPaid !== newFullyPaid;
          changes.push({
            advanceId: adv.id,
            workerId,
            workerName: workerMap[workerId] || `Worker #${workerId}`,
            advanceDate: adv.advanceDate,
            originalAmount: adv.amount,
            currentBalance: currentBal.toFixed(2),
            newBalance: newBal2dp,
            currentFullyPaid: adv.fullyPaid,
            newFullyPaid,
            changed,
          });
        }
      }

      res.json({ changes, totalAdvances: allAdvances.length });
    } catch (e: any) {
      console.error("Advance reconcile preview error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/factory/advances/reconcile - Recalculate all advance remaining balances from historical payrolls
  app.post("/api/factory/advances/reconcile", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Load all salary-deduction advances for company (oldest first)
      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
        ))
        .orderBy(factoryWorkerAdvances.workerId, factoryWorkerAdvances.advanceDate);

      // Load all payrolls that have advance deductions
      const allPayrolls = await db.select({
        workerId: factoryPayrolls.workerId,
        advances: factoryPayrolls.advances,
        periodStart: factoryPayrolls.periodStart,
      }).from(factoryPayrolls)
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
        ))
        .orderBy(factoryPayrolls.workerId, factoryPayrolls.periodStart);

      // Load all manual repayments (linked to specific advance IDs)
      const allRepayments = await db.select().from(factoryAdvanceRepayments)
        .where(eq(factoryAdvanceRepayments.companyId, companyId))
        .orderBy(factoryAdvanceRepayments.advanceId, factoryAdvanceRepayments.repaymentDate);

      // Group by worker
      const advancesByWorker = new Map<number, typeof allAdvances>();
      for (const adv of allAdvances) {
        const list = advancesByWorker.get(adv.workerId) || [];
        list.push(adv);
        advancesByWorker.set(adv.workerId, list);
      }

      const payrollDeductionByWorker = new Map<number, number>();
      for (const pr of allPayrolls) {
        const amt = parseFloat(pr.advances || "0");
        if (amt > 0) {
          payrollDeductionByWorker.set(pr.workerId, (payrollDeductionByWorker.get(pr.workerId) || 0) + amt);
        }
      }

      // Manual repayments keyed by advanceId
      const manualRepaymentByAdvance = new Map<number, number>();
      for (const rep of allRepayments) {
        manualRepaymentByAdvance.set(rep.advanceId, (manualRepaymentByAdvance.get(rep.advanceId) || 0) + parseFloat(rep.amount || "0"));
      }

      let updatedCount = 0;
      await db.transaction(async (tx: any) => {
        for (const [workerId, advances] of advancesByWorker) {
          // Step 1: Reset each advance to its original amount minus manual repayments
          const balances: { id: number; bal: number }[] = [];
          for (const adv of advances) {
            const original = parseFloat(adv.amount || "0");
            const manualPaid = manualRepaymentByAdvance.get(adv.id) || 0;
            balances.push({ id: adv.id, bal: Math.max(0, original - manualPaid) });
          }

          // Step 2: Apply total payroll deductions oldest-first
          let remaining = payrollDeductionByWorker.get(workerId) || 0;
          for (const entry of balances) {
            if (remaining <= 0) break;
            const deduct = Math.min(entry.bal, remaining);
            entry.bal = entry.bal - deduct;
            remaining -= deduct;
          }

          // Step 3: Persist updated balances
          for (let i = 0; i < advances.length; i++) {
            const newBal = Math.max(0, balances[i].bal);
            const newBal2dp = newBal.toFixed(2);
            const fullyPaid = newBal <= 0.001;
            const adv = advances[i];
            if (adv.remainingBalance !== newBal2dp || adv.fullyPaid !== fullyPaid) {
              await tx.update(factoryWorkerAdvances)
                .set({ remainingBalance: newBal2dp, fullyPaid })
                .where(eq(factoryWorkerAdvances.id, adv.id));
              updatedCount++;
            }
          }
        }
      });

      res.json({ message: `Reconciliation complete — ${updatedCount} advance record(s) updated` });
    } catch (e: any) {
      console.error("Advance reconcile error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  // DELETE /api/factory/advances/:id - Delete advance (admin/owner only)
  app.delete("/api/factory/advances/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can delete advances" });
      }
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, advance.workerId));

      const today = getClientDate(req);

      await db.transaction(async (tx: any) => {
        const repayments = await tx.select().from(factoryAdvanceRepayments)
          .where(eq(factoryAdvanceRepayments.advanceId, id));

        if (repayments.length > 0) {
          await tx.delete(factoryAdvanceRepayments)
            .where(eq(factoryAdvanceRepayments.advanceId, id));
        }

        // Delete the advance payment voucher (PAYMENT-ADV-{id}-*) and its entries.
        // These were created when the advance was given with a cash account:
        //   DR Factory Worker Advances / CR Cash.
        const advanceVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              sql`${vouchers.voucherNumber} LIKE ${'PAYMENT-ADV-' + id + '-%'}`,
            )
          );
        if (advanceVouchers.length > 0) {
          const vIds = advanceVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }

        await tx.delete(factoryWorkerAdvances)
          .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));

        const repayNote = repayments.length > 0 ? ` (${repayments.length} repayment(s) also removed)` : "";
        const voucherNote = advanceVouchers.length > 0 ? "; voucher reversed" : "";
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "ADVANCE_DELETED",
          referenceId: id,
          referenceTable: "factory_worker_advances",
          description: `Advance deleted for ${worker?.fullName || "Unknown"}: $${parseFloat(advance.amount).toFixed(2)}${repayNote}${voucherNote}`,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });
      });

      res.json({ message: "Advance deleted" });
    } catch (error: any) {
      console.error("Error deleting advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/:id/reverse - Reverse a paid advance (restore to outstanding)
  app.post("/api/factory/advances/:id/reverse", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin, Owner, or Developer can reverse advances" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, advance.workerId));

      const today = getClientDate(req);

      await db.transaction(async (tx: any) => {
        // Delete all repayment records for this advance
        const repayments = await tx.select().from(factoryAdvanceRepayments)
          .where(eq(factoryAdvanceRepayments.advanceId, id));

        if (repayments.length > 0) {
          await tx.delete(factoryAdvanceRepayments)
            .where(eq(factoryAdvanceRepayments.advanceId, id));
        }

        // Reset advance back to outstanding
        await tx.update(factoryWorkerAdvances)
          .set({ fullyPaid: false, remainingBalance: advance.amount })
          .where(eq(factoryWorkerAdvances.id, id));

        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "ADVANCE_REVERSED",
          referenceId: id,
          referenceTable: "factory_worker_advances",
          description: `Advance reversed for ${worker?.fullName || "Unknown"}: $${parseFloat(advance.amount).toFixed(2)} restored to outstanding (${repayments.length} repayment(s) removed)`,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });
      });

      res.json({ message: "Advance reversed and restored to outstanding" });
    } catch (error: any) {
      console.error("Error reversing advance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/advances/unvouchered", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allAdvances = await db.select({
        id: factoryWorkerAdvances.id,
        workerId: factoryWorkerAdvances.workerId,
        advanceDate: factoryWorkerAdvances.advanceDate,
        amount: factoryWorkerAdvances.amount,
        remainingBalance: factoryWorkerAdvances.remainingBalance,
        cashAccountId: factoryWorkerAdvances.cashAccountId,
        notes: factoryWorkerAdvances.notes,
        repaymentType: factoryWorkerAdvances.repaymentType,
        workerName: factoryWorkers.fullName,
      })
        .from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(eq(factoryWorkerAdvances.companyId, companyId))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const existingVoucherAdvanceIds = await db.select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`,
        ));

      const voucheredIds = new Set<number>();
      for (const v of existingVoucherAdvanceIds) {
        const match = v.voucherNumber.match(/^PAYMENT-ADV-(\d+)-/);
        if (match) voucheredIds.add(parseInt(match[1]));
      }

      const unvouchered = allAdvances.filter((a) => !voucheredIds.has(a.id) || a.cashAccountId === null);

      res.json(unvouchered);
    } catch (error: any) {
      console.error("Error fetching unvouchered advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/advances/post-accounting", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can post accounting" });
      }
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;
      if (!cashAccountId) return res.status(400).json({ message: "Cash account is required" });

      const [acct] = await db.select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });

      const result = await db.transaction(async (tx: any) => {
        const allAdvances = await tx.select({
          id: factoryWorkerAdvances.id,
          amount: factoryWorkerAdvances.amount,
          advanceDate: factoryWorkerAdvances.advanceDate,
          workerId: factoryWorkerAdvances.workerId,
          cashAccountId: factoryWorkerAdvances.cashAccountId,
          workerName: factoryWorkers.fullName,
        })
          .from(factoryWorkerAdvances)
          .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
          .where(eq(factoryWorkerAdvances.companyId, companyId));

        const existingVouchers = await tx.select({ voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`,
          ));
        const alreadyPostedIds = new Set<number>();
        for (const v of existingVouchers) {
          const match = v.voucherNumber.match(/^PAYMENT-ADV-(\d+)-/);
          if (match) alreadyPostedIds.add(parseInt(match[1]));
        }

        const eligible = allAdvances.filter((a: any) => !alreadyPostedIds.has(a.id) || a.cashAccountId === null);
        const eligibleIds = new Set(eligible.map((a: any) => a.id));

        if (eligibleIds.size === 0) {
          return { posted: 0, skipped: 0 };
        }

        let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.name, "Factory Worker Advances"),
          ));

        if (!advancesAccount) {
          const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);

          [advancesAccount] = await tx.insert(ledgerAccounts).values({
            companyId,
            code: nextCode,
            name: "Factory Worker Advances",
            accountType: "Asset",
            active: true,
            isHidden: false,
          }).returning();
        }

        let posted = 0;
        let skipped = 0;
        for (const adv of eligible) {
          if (alreadyPostedIds.has(adv.id)) {
            if (adv.cashAccountId === null) {
              await tx.update(factoryWorkerAdvances)
                .set({ cashAccountId: cashAccountId })
                .where(eq(factoryWorkerAdvances.id, adv.id));
            }
            skipped++;
            continue;
          }

          const amount = parseFloat(adv.amount);
          const voucherNumber = `PAYMENT-ADV-${adv.id}-${Date.now()}`;
          const narration = `Advance to ${adv.workerName}: $${amount.toFixed(2)} (retroactive)`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: adv.advanceDate,
            description: narration,
            totalAmount: amount.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: amount.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: "0",
              creditAmount: amount.toFixed(2),
              narration,
            },
          ]);

          await tx.update(factoryWorkerAdvances)
            .set({ cashAccountId: cashAccountId })
            .where(eq(factoryWorkerAdvances.id, adv.id));

          posted++;
        }

        return { posted, skipped };
      });

      res.json({ message: `Posted accounting for ${result.posted} advance(s)${result.skipped ? ` (${result.skipped} already posted, skipped)` : ""}`, posted: result.posted, skipped: result.skipped });
    } catch (error: any) {
      console.error("Error posting advance accounting:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/advance-balance - Get total outstanding advance balance
  app.get("/api/factory/workers/:id/advance-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });

      const outstanding = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.workerId, workerId),
          eq(factoryWorkerAdvances.fullyPaid, false),
        ));

      const totalBalance = outstanding.reduce((s: number, a: any) => s + parseFloat(a.remainingBalance || "0"), 0);
      res.json({ totalBalance: totalBalance.toFixed(2), count: outstanding.length });
    } catch (error: any) {
      console.error("Error fetching advance balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/repay-by-month - Bulk repay all outstanding advances for a given month
  app.post("/api/factory/advances/repay-by-month", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { month, repaymentDate, cashAccountId: rawCashAccountId } = req.body;
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ message: "month must be YYYY-MM" });
      }
      const cashAccountId = rawCashAccountId ? parseInt(rawCashAccountId) : null;
      if (!cashAccountId) return res.status(400).json({ message: "cashAccountId is required" });

      const repayDate = repaymentDate || getClientDate(req);

      const [acct] = await db.select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(400).json({ message: "Cash account not found" });

      // Find all outstanding advances (both Loan and Salary Deduction) for this month
      const outstanding = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.fullyPaid, false),
          sql`to_char(${factoryWorkerAdvances.advanceDate}, 'YYYY-MM') = ${month}`,
        ));

      if (outstanding.length === 0) {
        return res.status(400).json({ message: "No outstanding advances found for that month" });
      }

      // Load worker names
      const workerIds = [...new Set(outstanding.map((a: any) => a.workerId))];
      const workerRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(inArray(factoryWorkers.id, workerIds));
      const workerMap: Record<number, string> = Object.fromEntries(workerRows.map((w: any) => [w.id, w.fullName]));

      const result = await db.transaction(async (tx: any) => {
        // Resolve/create the Factory Worker Advances ledger account once
        let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
        if (!advancesAccount) {
          const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [advancesAccount] = await tx.insert(ledgerAccounts).values({
            companyId, code: nextCode, name: "Factory Worker Advances",
            accountType: "Asset", active: true, isHidden: false,
          }).returning();
        }

        let repaidCount = 0;
        let repaidTotal = 0;

        for (const advance of outstanding) {
          const bal = parseFloat(advance.remainingBalance || "0");
          if (bal <= 0) continue;

          const workerName = workerMap[advance.workerId] || `Worker #${advance.workerId}`;
          const narration = `Advance repayment from ${workerName}: $${bal.toFixed(2)} (advance #${advance.id})`;

          const [repayment] = await tx.insert(factoryAdvanceRepayments).values({
            companyId,
            advanceId: advance.id,
            workerId: advance.workerId,
            repaymentDate: repayDate,
            amount: bal.toFixed(2),
            cashAccountId,
            notes: req.body.notes || null,
          }).returning();

          await tx.update(factoryWorkerAdvances).set({
            remainingBalance: "0.00",
            fullyPaid: true,
          }).where(eq(factoryWorkerAdvances.id, advance.id));

          // Voucher: DR Cash, CR Factory Worker Advances
          const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId, voucherNumber, voucherType: "Receipt",
            voucherDate: repayDate, description: narration,
            totalAmount: bal.toFixed(2), currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: bal.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: "0",
              creditAmount: bal.toFixed(2),
              narration,
            },
          ]);

          await writeDaybookEntry(tx, {
            companyId, txDate: repayDate,
            txType: "ADVANCE_REPAYMENT",
            referenceId: repayment.id,
            referenceTable: "factory_advance_repayments",
            description: narration,
            amountCurrency: bal,
            currencyCode: "USD",
            amountUsd: bal,
            createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
          });

          repaidCount++;
          repaidTotal += bal;
        }

        return { repaid: repaidCount, total: repaidTotal };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error in repay-by-month:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/cash-account-balance/:id — current DR-CR balance for a ledger account
  app.get("/api/factory/cash-account-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseId(req.params.id);
      if (accountId === null) return res.status(400).json({ message: "Invalid id" });

      const [acct] = await db.select({
        id: ledgerAccounts.id, name: ledgerAccounts.name,
        openingBalance: ledgerAccounts.openingBalance,
        openingBalanceSide: ledgerAccounts.openingBalanceSide,
      })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      // Some cash entries are stored with bankAccountId (bank-linked), not ledgerAccountId.
      // Find any bankAccounts record whose linkedLedgerId = this ledger account.
      const linkedBanks = await db.select({ id: bankAccounts.id, openingBalance: bankAccounts.openingBalance, openingBalanceSide: bankAccounts.openingBalanceSide })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.linkedLedgerId, accountId), eq(bankAccounts.companyId, companyId)));

      // Sum entries via ledgerAccountId
      const [ledgerTotals] = await db.select({
        totalDebit: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)`,
      })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(voucherEntries.ledgerAccountId, accountId), eq(vouchers.companyId, companyId)));

      let totalDebit = parseFloat(ledgerTotals.totalDebit);
      let totalCredit = parseFloat(ledgerTotals.totalCredit);
      let openingBal = parseFloat(acct.openingBalance || "0");
      const openingSign = acct.openingBalanceSide === "Cr" ? -1 : 1;
      openingBal = openingBal * openingSign;

      // Also sum entries via bankAccountId for each linked bank account
      for (const bank of linkedBanks) {
        const [bankTotals] = await db.select({
          totalDebit: sql<string>`COALESCE(SUM(${voucherEntries.debitAmount}::numeric), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${voucherEntries.creditAmount}::numeric), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(eq(voucherEntries.bankAccountId, bank.id), eq(vouchers.companyId, companyId)));
        totalDebit += parseFloat(bankTotals.totalDebit);
        totalCredit += parseFloat(bankTotals.totalCredit);
        // Add bank's own opening balance
        const bOB = parseFloat(bank.openingBalance || "0");
        const bSign = bank.openingBalanceSide === "Cr" ? -1 : 1;
        openingBal += bOB * bSign;
      }

      const balance = openingBal + totalDebit - totalCredit;
      res.json({ accountId, name: acct.name, balance: balance.toFixed(2) });
    } catch (error: any) {
      console.error("Error fetching account balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/cash-adjustment — post a correcting journal entry on a cash account
  app.post("/api/factory/advances/cash-adjustment", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { cashAccountId: rawAcctId, amount: rawAmount, direction, date, narration } = req.body;
      const cashAccountId = parseInt(rawAcctId);
      if (!cashAccountId || isNaN(cashAccountId)) return res.status(400).json({ message: "cashAccountId is required" });
      const amount = parseFloat(rawAmount);
      if (!amount || amount <= 0) return res.status(400).json({ message: "amount must be a positive number" });
      if (!date) return res.status(400).json({ message: "date is required" });
      const isCredit = direction !== "debit"; // default credit (reduces cash)

      const [cashAcct] = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcct) return res.status(400).json({ message: "Cash account not found" });

      await db.transaction(async (tx: any) => {
        // Resolve or auto-create the contra "Factory Advance Adjustments" account
        let [adjAccount] = await tx.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Advance Adjustments")));
        if (!adjAccount) {
          const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [adjAccount] = await tx.insert(ledgerAccounts).values({
            companyId, code: nextCode, name: "Factory Advance Adjustments",
            accountType: "Equity", active: true, isHidden: false,
          }).returning();
        }

        const voucherNumber = `ADJ-CASH-${cashAccountId}-${Date.now()}`;
        const desc = narration || "Cash balance adjustment";

        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: desc,
          totalAmount: amount.toFixed(2),
          currency: "USD",
          sourceModule: "FACTORY",
        }).returning();

        // isCredit = true  → CR Cash / DR Adjustments  (reduces cash balance)
        // isCredit = false → DR Cash / CR Adjustments  (increases cash balance)
        await tx.insert(voucherEntries).values([
          {
            voucherId: voucher.id,
            ledgerAccountId: adjAccount.id,
            debitAmount: isCredit ? amount.toFixed(2) : "0",
            creditAmount: isCredit ? "0" : amount.toFixed(2),
            narration: desc,
          },
          {
            voucherId: voucher.id,
            ledgerAccountId: cashAccountId,
            debitAmount: isCredit ? "0" : amount.toFixed(2),
            creditAmount: isCredit ? amount.toFixed(2) : "0",
            narration: desc,
          },
        ]);
      });

      res.json({ message: `Cash adjustment posted — ${isCredit ? "CR" : "DR"} ${cashAcct.name} $${amount.toFixed(2)}` });
    } catch (error: any) {
      console.error("Error posting cash adjustment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances/repayment-audit — find salary deduction advances missing cash vouchers
  app.get("/api/factory/advances/repayment-audit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. All salary_deduction advances
      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
        ))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const advanceIds = allAdvances.map((r: any) => r.factory_worker_advances.id);

      // 2. All repayment records for those advances
      const repayments = advanceIds.length > 0
        ? await db.select().from(factoryAdvanceRepayments)
            .where(and(
              eq(factoryAdvanceRepayments.companyId, companyId),
              inArray(factoryAdvanceRepayments.advanceId, advanceIds),
            ))
        : [];

      // 3. All repayment vouchers for this company (both old RECEIPT-REPAY and new REPAY-SAL patterns)
      const repayVouchers = await db.select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`(${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%' OR ${vouchers.voucherNumber} LIKE 'REPAY-SAL-%')`,
        ));

      const voucheredRepayIds = new Set<number>();
      for (const v of repayVouchers) {
        const m = v.voucherNumber.match(/^(?:RECEIPT-REPAY|REPAY-SAL)-(\d+)-/);
        if (m) voucheredRepayIds.add(parseInt(m[1]));
      }

      // 4. Build repayments map by advanceId
      const repaysByAdvId = new Map<number, typeof repayments>();
      for (const r of repayments) {
        const list = repaysByAdvId.get(r.advanceId) || [];
        list.push(r);
        repaysByAdvId.set(r.advanceId, list);
      }

      // 5. Categorize
      const auditAdvances: any[] = [];
      for (const row of allAdvances) {
        const adv = row.factory_worker_advances;
        const worker = row.factory_workers;
        const advRepays = repaysByAdvId.get(adv.id) || [];
        const isPaid = adv.fullyPaid || parseFloat(adv.remainingBalance || "0") <= 0.005;

        if (advRepays.length === 0) {
          if (isPaid) {
            auditAdvances.push({
              id: adv.id, workerId: adv.workerId, workerName: worker.fullName,
              advanceDate: adv.advanceDate, amount: adv.amount,
              remainingBalance: adv.remainingBalance, fullyPaid: adv.fullyPaid,
              caseType: "no_repayment",
              repayments: [],
              missingVoucherRepayments: [],
            });
          }
        } else {
          const missingVoucherRepays = advRepays.filter((r: any) => !voucheredRepayIds.has(r.id));
          if (missingVoucherRepays.length > 0) {
            auditAdvances.push({
              id: adv.id, workerId: adv.workerId, workerName: worker.fullName,
              advanceDate: adv.advanceDate, amount: adv.amount,
              remainingBalance: adv.remainingBalance, fullyPaid: adv.fullyPaid,
              caseType: "missing_voucher",
              repayments: advRepays,
              missingVoucherRepayments: missingVoucherRepays,
            });
          }
        }
      }

      res.json({
        advances: auditAdvances,
        summary: {
          total: allAdvances.length,
          ok: allAdvances.length - auditAdvances.length,
          missingVoucher: auditAdvances.filter((a: any) => a.caseType === "missing_voucher").length,
          noRepayment: auditAdvances.filter((a: any) => a.caseType === "no_repayment").length,
        },
      });
    } catch (error: any) {
      console.error("Error in repayment-audit:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/advances/post-repayment-vouchers — fix missing repayment accounting
  app.post("/api/factory/advances/post-repayment-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { cashAccountId: rawAcctId, repaymentDate } = req.body;
      const cashAccountId = parseInt(rawAcctId);
      if (!cashAccountId || isNaN(cashAccountId)) return res.status(400).json({ message: "cashAccountId is required" });
      if (!repaymentDate) return res.status(400).json({ message: "repaymentDate is required" });

      const [cashAcct] = await db.select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcct) return res.status(400).json({ message: "Cash account not found" });

      // Resolve or auto-create "Factory Workers Salary Payable" as the contra for salary-deduction repayments
      // (DR Salary Payable / CR Factory Worker Advances — salary deductions don't touch cash)
      let [payableAcct] = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Workers Salary Payable")));
      if (!payableAcct) {
        const [maxCodeRow] = await db.select({ maxCode: sql<string>`MAX(${ledgerAccounts.code})` })
          .from(ledgerAccounts).where(eq(ledgerAccounts.companyId, companyId));
        const nextCode = String((parseInt(maxCodeRow?.maxCode || "1000") || 1000) + 1);
        [payableAcct] = await db.insert(ledgerAccounts).values({
          companyId, code: nextCode, name: "Factory Workers Salary Payable",
          accountType: "Accounts Payable", openingBalance: "0", openingBalanceSide: "Cr",
        }).returning({ id: ledgerAccounts.id, name: ledgerAccounts.name });
      }

      // Re-run audit to get fresh list
      const allAdvances = await db.select().from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
        ));

      const advanceIds = allAdvances.map((r: any) => r.factory_worker_advances.id);
      const repayments = advanceIds.length > 0
        ? await db.select().from(factoryAdvanceRepayments)
            .where(and(
              eq(factoryAdvanceRepayments.companyId, companyId),
              inArray(factoryAdvanceRepayments.advanceId, advanceIds),
            ))
        : [];

      const repayVouchers = await db.select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          sql`(${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%' OR ${vouchers.voucherNumber} LIKE 'REPAY-SAL-%')`,
        ));

      const voucheredRepayIds = new Set<number>();
      for (const v of repayVouchers) {
        const m = v.voucherNumber.match(/^(?:RECEIPT-REPAY|REPAY-SAL)-(\d+)-/);
        if (m) voucheredRepayIds.add(parseInt(m[1]));
      }

      const repaysByAdvId = new Map<number, typeof repayments>();
      for (const r of repayments) {
        const list = repaysByAdvId.get(r.advanceId) || [];
        list.push(r);
        repaysByAdvId.set(r.advanceId, list);
      }

      const result = await db.transaction(async (tx: any) => {
        // Resolve/create Factory Worker Advances ledger account once
        let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
        if (!advancesAccount) {
          const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [advancesAccount] = await tx.insert(ledgerAccounts).values({
            companyId, code: nextCode, name: "Factory Worker Advances",
            accountType: "Asset", active: true, isHidden: false,
          }).returning();
        }

        let posted = 0;

        for (const row of allAdvances) {
          const adv = row.factory_worker_advances;
          const worker = row.factory_workers;
          const advRepays = repaysByAdvId.get(adv.id) || [];
          const isPaid = adv.fullyPaid || parseFloat(adv.remainingBalance || "0") <= 0.005;
          const workerName = worker.fullName || `Worker #${adv.workerId}`;

          if (advRepays.length === 0 && isPaid) {
            // Case B: no repayment record — create one + voucher
            const amount = parseFloat(adv.amount || "0");
            if (amount <= 0) continue;

            const [repayment] = await tx.insert(factoryAdvanceRepayments).values({
              companyId, advanceId: adv.id, workerId: adv.workerId,
              repaymentDate, amount: amount.toFixed(2),
              cashAccountId, notes: "Auto-created by Repayment Audit",
            }).returning();

            const narration = `Salary deduction repayment — ${workerName}: $${amount.toFixed(2)} (advance #${adv.id})`;
            const voucherNumber = `REPAY-SAL-${repayment.id}-${Date.now()}`;
            const [voucher] = await tx.insert(vouchers).values({
              companyId, voucherNumber, voucherType: "Journal",
              voucherDate: repaymentDate, description: narration,
              totalAmount: amount.toFixed(2), currency: "USD", sourceModule: "FACTORY",
            }).returning();

            // DR Factory Workers Salary Payable / CR Factory Worker Advances
            // Salary deductions reduce the company's wage obligation — no cash movement
            await tx.insert(voucherEntries).values([
              { voucherId: voucher.id, ledgerAccountId: payableAcct.id, debitAmount: amount.toFixed(2), creditAmount: "0", narration },
              { voucherId: voucher.id, ledgerAccountId: advancesAccount.id, debitAmount: "0", creditAmount: amount.toFixed(2), narration },
            ]);
            posted++;

          } else {
            // Case A: repayment records exist, re-create missing vouchers
            const missingRepays = advRepays.filter((r: any) => !voucheredRepayIds.has(r.id));
            for (const repay of missingRepays) {
              const amount = parseFloat(repay.amount || "0");
              if (amount <= 0) continue;
              const rDate = repay.repaymentDate || repaymentDate;
              const narration = `Salary deduction repayment — ${workerName}: $${amount.toFixed(2)} (advance #${adv.id})`;
              const voucherNumber = `REPAY-SAL-${repay.id}-${Date.now()}`;
              const [voucher] = await tx.insert(vouchers).values({
                companyId, voucherNumber, voucherType: "Journal",
                voucherDate: rDate, description: narration,
                totalAmount: amount.toFixed(2), currency: "USD", sourceModule: "FACTORY",
              }).returning();

              await tx.insert(voucherEntries).values([
                { voucherId: voucher.id, ledgerAccountId: payableAcct.id, debitAmount: amount.toFixed(2), creditAmount: "0", narration },
                { voucherId: voucher.id, ledgerAccountId: advancesAccount.id, debitAmount: "0", creditAmount: amount.toFixed(2), narration },
              ]);
              posted++;
            }
          }
        }

        return posted;
      });

      res.json({ message: `Posted ${result} missing repayment voucher(s) successfully.`, posted: result });
    } catch (error: any) {
      console.error("Error in post-repayment-vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── ADVANCE REPAYMENTS ─────────────────────────────────────────

  app.get("/api/factory/advances/:id/repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const advanceId = parseId(req.params.id);
      if (advanceId === null) return res.status(400).json({ message: "Invalid id" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const repayments = await db.select().from(factoryAdvanceRepayments)
        .where(and(eq(factoryAdvanceRepayments.advanceId, advanceId), eq(factoryAdvanceRepayments.companyId, companyId)))
        .orderBy(desc(factoryAdvanceRepayments.repaymentDate));

      res.json(repayments);
    } catch (error: any) {
      console.error("Error fetching advance repayments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/advances/:id/repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const advanceId = parseId(req.params.id);
      if (advanceId === null) return res.status(400).json({ message: "Invalid id" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });
      if (advance.repaymentType !== "manual_repayment") {
        return res.status(400).json({ message: "Only manual repayment advances can receive repayments" });
      }
      if (advance.fullyPaid) {
        return res.status(400).json({ message: "This advance is already fully paid" });
      }

      const amount = parseFloat(req.body.amount);
      if (!amount || amount <= 0) return res.status(400).json({ message: "Amount must be positive" });

      const bal = parseFloat(advance.remainingBalance || "0");
      if (amount > bal + 0.01) {
        return res.status(400).json({ message: `Repayment ($${amount.toFixed(2)}) exceeds remaining balance ($${bal.toFixed(2)})` });
      }
      const effectiveAmount = Math.min(amount, bal);

      const repaymentDate = req.body.repaymentDate || getClientDate(req);
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found" });
      }

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, advance.workerId));

      const result = await db.transaction(async (tx: any) => {
        const [repayment] = await tx.insert(factoryAdvanceRepayments).values({
          companyId,
          advanceId,
          workerId: advance.workerId,
          repaymentDate,
          amount: effectiveAmount.toFixed(2),
          cashAccountId,
          notes: req.body.notes || null,
        }).returning();

        const newBalance = bal - effectiveAmount;
        const isFullyPaid = newBalance <= 0.005;

        await tx.update(factoryWorkerAdvances).set({
          remainingBalance: Math.max(0, newBalance).toFixed(2),
          fullyPaid: isFullyPaid,
        }).where(eq(factoryWorkerAdvances.id, advanceId));

        if (cashAccountId) {
          let [advancesAccount] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.name, "Factory Worker Advances"),
            ));

          if (!advancesAccount) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [advancesAccount] = await tx.insert(ledgerAccounts).values({
              companyId, code: nextCode, name: "Factory Worker Advances",
              accountType: "Asset", active: true, isHidden: false,
            }).returning();
          }

          const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
          const narration = `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)}`;

          const [createdVoucher] = await tx.insert(vouchers).values({
            companyId, voucherNumber, voucherType: "Receipt",
            voucherDate: repaymentDate, description: narration,
            totalAmount: effectiveAmount.toFixed(2), currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          const repayNarration = `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)}`;
          await tx.insert(voucherEntries).values([
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: cashAccountId,
              debitAmount: effectiveAmount.toFixed(2),
              creditAmount: "0",
              narration: repayNarration,
            },
            {
              voucherId: createdVoucher.id,
              ledgerAccountId: advancesAccount.id,
              debitAmount: "0",
              creditAmount: effectiveAmount.toFixed(2),
              narration: repayNarration,
            },
          ]);
        }

        await writeDaybookEntry(tx, {
          companyId, txDate: repaymentDate,
          txType: "ADVANCE_REPAYMENT",
          referenceId: repayment.id,
          referenceTable: "factory_advance_repayments",
          description: `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)} (advance #${advanceId})`,
          amountCurrency: effectiveAmount,
          currencyCode: "USD",
          amountUsd: effectiveAmount,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        const [updatedAdvance] = await tx.select().from(factoryWorkerAdvances)
          .where(eq(factoryWorkerAdvances.id, advanceId));

        return { repayment, advance: updatedAdvance };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error recording advance repayment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/workers/:id/bulk-repay-advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });

      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;
      const repaymentDate = req.body.repaymentDate || getClientDate(req);
      const notes = req.body.notes || null;
      // Per-advance repayment dates sent from the frontend preview (each loan on its own month)
      const perAdvanceDates: Record<number, string> = {};
      if (Array.isArray(req.body.advances)) {
        for (const a of req.body.advances) {
          if (a.id && a.repaymentDate) perAdvanceDates[parseInt(a.id)] = a.repaymentDate;
        }
      }

      if (cashAccountId) {
        const [acct] = await db.select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found" });
      }

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, workerId));
      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const outstandingAdvances = await db.select().from(factoryWorkerAdvances)
        .where(and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.workerId, workerId),
          eq(factoryWorkerAdvances.repaymentType, "manual_repayment"),
          eq(factoryWorkerAdvances.fullyPaid, false),
        ));

      const toRepay = outstandingAdvances.filter((a) => parseFloat(a.remainingBalance || "0") > 0.001);
      if (toRepay.length === 0) {
        return res.status(400).json({ message: "No outstanding manual repayment advances found for this worker" });
      }

      const result = await db.transaction(async (tx: any) => {
        let advancesAccountId: number | null = null;
        if (cashAccountId) {
          let [found] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
          if (!found) {
            const maxCodeResult = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [found] = await tx.insert(ledgerAccounts).values({
              companyId, code: nextCode, name: "Factory Worker Advances",
              accountType: "Asset", active: true, isHidden: false,
            }).returning();
          }
          advancesAccountId = found.id;
        }

        const repaymentResults = [];
        let totalRepaid = 0;

        for (const advance of toRepay) {
          const effectiveAmount = parseFloat(advance.remainingBalance || "0");
          if (effectiveAmount <= 0) continue;

          // Use per-advance date if provided (each loan on its own month), else fall back to global date
          const effectiveRepaymentDate = perAdvanceDates[advance.id] || repaymentDate;

          const [repayment] = await tx.insert(factoryAdvanceRepayments).values({
            companyId,
            advanceId: advance.id,
            workerId,
            repaymentDate: effectiveRepaymentDate,
            amount: effectiveAmount.toFixed(2),
            cashAccountId,
            notes,
          }).returning();

          await tx.update(factoryWorkerAdvances).set({
            remainingBalance: "0.00",
            fullyPaid: true,
          }).where(eq(factoryWorkerAdvances.id, advance.id));

          if (cashAccountId && advancesAccountId) {
            const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
            const narration = `Bulk advance repayment from ${worker.fullName}: $${effectiveAmount.toFixed(2)} (advance #${advance.id})`;
            const [createdVoucher] = await tx.insert(vouchers).values({
              companyId, voucherNumber, voucherType: "Receipt",
              voucherDate: effectiveRepaymentDate, description: narration,
              totalAmount: effectiveAmount.toFixed(2), currency: "USD",
              sourceModule: "FACTORY",
            }).returning();

            await tx.insert(voucherEntries).values([
              {
                voucherId: createdVoucher.id,
                ledgerAccountId: cashAccountId,
                debitAmount: effectiveAmount.toFixed(2),
                creditAmount: "0",
                narration,
              },
              {
                voucherId: createdVoucher.id,
                ledgerAccountId: advancesAccountId,
                debitAmount: "0",
                creditAmount: effectiveAmount.toFixed(2),
                narration,
              },
            ]);
          }

          await writeDaybookEntry(tx, {
            companyId, txDate: effectiveRepaymentDate,
            txType: "ADVANCE_REPAYMENT",
            referenceId: repayment.id,
            referenceTable: "factory_advance_repayments",
            description: `Bulk advance repayment from ${worker.fullName}: $${effectiveAmount.toFixed(2)} (advance #${advance.id})`,
            amountCurrency: effectiveAmount,
            currencyCode: "USD",
            amountUsd: effectiveAmount,
            createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
          });

          repaymentResults.push(repayment);
          totalRepaid += effectiveAmount;
        }

        return { count: repaymentResults.length, totalRepaid, repayments: repaymentResults };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error bulk repaying advances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/advance-repayments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can delete repayments" });
      }
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const repaymentId = parseId(req.params.id);
      if (repaymentId === null) return res.status(400).json({ message: "Invalid id" });

      const [repayment] = await db.select().from(factoryAdvanceRepayments)
        .where(and(eq(factoryAdvanceRepayments.id, repaymentId), eq(factoryAdvanceRepayments.companyId, companyId)));
      if (!repayment) return res.status(404).json({ message: "Repayment not found" });

      const [advance] = await db.select().from(factoryWorkerAdvances)
        .where(eq(factoryWorkerAdvances.id, repayment.advanceId));

      const repayAmt = parseFloat(repayment.amount || "0");
      const currentBal = parseFloat(advance?.remainingBalance || "0");
      const restoredBal = currentBal + repayAmt;

      await db.transaction(async (tx: any) => {
        await tx.delete(factoryAdvanceRepayments)
          .where(eq(factoryAdvanceRepayments.id, repaymentId));

        if (advance) {
          await tx.update(factoryWorkerAdvances).set({
            remainingBalance: restoredBal.toFixed(2),
            fullyPaid: false,
          }).where(eq(factoryWorkerAdvances.id, advance.id));
        }
      });

      const [worker] = await db.select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers).where(eq(factoryWorkers.id, repayment.workerId));

      await writeDaybookEntry(db, {
        companyId, txDate: getClientDate(req),
        txType: "ADVANCE_REPAYMENT_DELETED",
        referenceId: repaymentId,
        referenceTable: "factory_advance_repayments",
        description: `Repayment deleted for ${worker?.fullName || "Worker"}: $${repayAmt.toFixed(2)} (advance #${repayment.advanceId})`,
        amountCurrency: repayAmt,
        currencyCode: "USD",
        amountUsd: repayAmt,
        createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
      });

      res.json({ message: "Repayment deleted", restoredBalance: restoredBal.toFixed(2) });
    } catch (error: any) {
      console.error("Error deleting repayment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/backfill-payroll-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can run backfill" });
      }

      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const paidPayrolls = await db.select({
        id: factoryPayrolls.id,
        companyId: factoryPayrolls.companyId,
        workerId: factoryPayrolls.workerId,
        netSalary: factoryPayrolls.netSalary,
        cashAccountId: factoryPayrolls.cashAccountId,
        periodStart: factoryPayrolls.periodStart,
        periodEnd: factoryPayrolls.periodEnd,
        paidAt: factoryPayrolls.paidAt,
      }).from(factoryPayrolls)
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
          eq(factoryPayrolls.status, "PAID"),
          isNotNull(factoryPayrolls.cashAccountId),
        ));

      const existingVouchers = await db.select({
        voucherNumber: vouchers.voucherNumber,
      }).from(vouchers)
        .where(and(
          eq(vouchers.sourceModule, "FACTORY"),
          eq(vouchers.voucherType, "Payment"),
          sql`${vouchers.voucherNumber} LIKE 'PAYMENT-PAY-%'`,
        ));

      const existingPayrollIds = new Set(
        existingVouchers.map((v: any) => {
          const parts = v.voucherNumber.split("-");
          return parseInt(parts[2]);
        }).filter((id: number) => !isNaN(id))
      );

      const toBackfill = paidPayrolls.filter((p: any) => {
        const net = parseFloat(p.netSalary || "0");
        return net > 0 && !existingPayrollIds.has(p.id);
      });

      const skipped = paidPayrolls.filter((p: any) => {
        const net = parseFloat(p.netSalary || "0");
        return net <= 0 || existingPayrollIds.has(p.id);
      }).map((p: any) => p.id);

      if (toBackfill.length === 0) {
        return res.json({ message: "No payrolls need backfill", found: paidPayrolls.length, backfilled: 0, skipped });
      }

      const companyIds = [...new Set(toBackfill.map((p: any) => p.companyId))];
      const workerIds = [...new Set(toBackfill.map((p: any) => p.workerId))];

      const workerRows = await db.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIds));
      const workerMap = new Map(workerRows.map((w: any) => [w.id, w.fullName]));

      const backfilledIds: number[] = [];

      await db.transaction(async (tx: any) => {
        const payrollAccountCache = new Map<number, number>();

        for (const cid of companyIds) {
          let [found] = await tx.select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, cid), eq(ledgerAccounts.name, "Factory Worker Payroll")));

          if (!found) {
            const [maxCode] = await tx.select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, cid), sql`code ~ '^\d+$'`));
            const nextCode = String((parseInt(maxCode?.maxCode || "0") || 0) + 1);
            [found] = await tx.insert(ledgerAccounts).values({
              companyId: cid, code: nextCode,
              name: "Factory Worker Payroll",
              accountType: "Expense",
              active: true, isHidden: false,
            }).returning();
          }
          payrollAccountCache.set(cid, found.id);
        }

        for (const pr of toBackfill) {
          const netAmt = parseFloat(pr.netSalary || "0");
          const cashAcctId = pr.cashAccountId!;
          const payrollAcctId = payrollAccountCache.get(pr.companyId)!;
          const workerName = ((workerMap.get(pr.workerId) as string) || "").trim() || `Worker #${pr.workerId}`;
          const narration = `Payroll backfill: ${workerName} (${pr.periodStart} – ${pr.periodEnd})`;
          const voucherDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : getClientDate(req);

          const [pVoucher] = await tx.insert(vouchers).values({
            companyId: pr.companyId,
            voucherNumber: `PAYMENT-PAY-${pr.id}-${Date.now()}`,
            voucherType: "Payment",
            voucherDate,
            description: narration,
            totalAmount: netAmt.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          }).returning();

          await tx.insert(voucherEntries).values([
            {
              voucherId: pVoucher.id,
              ledgerAccountId: payrollAcctId,
              debitAmount: netAmt.toFixed(2),
              creditAmount: "0",
              narration,
            },
            {
              voucherId: pVoucher.id,
              ledgerAccountId: cashAcctId,
              debitAmount: "0",
              creditAmount: netAmt.toFixed(2),
              narration,
            },
          ]);

          backfilledIds.push(pr.id);
        }
      });

      res.json({
        message: `Backfilled ${backfilledIds.length} payroll(s)`,
        found: paidPayrolls.length,
        backfilled: backfilledIds.length,
        backfilledPayrollIds: backfilledIds,
        skippedPayrollIds: skipped,
      });
    } catch (error: any) {
      console.error("Error backfilling payroll vouchers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/workers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(workerId)) return res.status(400).json({ message: "Invalid worker ID" });

      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query;

      const advanceConditions: any[] = [
        eq(factoryWorkerAdvances.workerId, workerId),
        eq(factoryWorkerAdvances.companyId, companyId),
      ];
      if (startDate) advanceConditions.push(sql`${factoryWorkerAdvances.advanceDate} >= ${startDate}`);
      if (endDate) advanceConditions.push(sql`${factoryWorkerAdvances.advanceDate} <= ${endDate}`);

      const advances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(...advanceConditions))
        .orderBy(factoryWorkerAdvances.advanceDate);

      const payrollConditions: any[] = [
        eq(factoryPayrolls.workerId, workerId),
        eq(factoryPayrolls.companyId, companyId),
        eq(factoryPayrolls.status, "PAID"),
      ];
      if (startDate) payrollConditions.push(sql`${factoryPayrolls.paidAt}::date >= ${startDate}`);
      if (endDate) payrollConditions.push(sql`${factoryPayrolls.paidAt}::date <= ${endDate}`);

      const payrolls = await db
        .select()
        .from(factoryPayrolls)
        .where(and(...payrollConditions))
        .orderBy(factoryPayrolls.paidAt);

      const entries: any[] = [];

      for (const adv of advances) {
        entries.push({
          entryId: adv.id,
          voucherId: adv.id,
          date: adv.advanceDate,
          debitAmount: adv.amount,
          creditAmount: "0",
          narration: adv.notes || "Advance payment",
          voucherNumber: `ADV-${adv.id}`,
          voucherType: "Advance",
          voucherDate: adv.advanceDate,
          voucherDescription: adv.notes || "Advance payment",
          currency: "USD",
        });
      }

      for (const pr of payrolls) {
        const paidDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : pr.periodEnd;
        entries.push({
          entryId: 100000 + pr.id,
          voucherId: 100000 + pr.id,
          date: paidDate,
          debitAmount: "0",
          creditAmount: pr.netSalary || "0",
          narration: `Payroll ${pr.periodStart} to ${pr.periodEnd}`,
          voucherNumber: `PAY-${pr.id}`,
          voucherType: "Payroll",
          voucherDate: paidDate,
          voucherDescription: `Payroll ${pr.periodStart} to ${pr.periodEnd}`,
          currency: "USD",
        });
      }

      entries.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let runningBalance = 0;
      for (const entry of entries) {
        runningBalance += parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        entry.runningBalance = runningBalance;
      }

      res.json(entries);
    } catch (error: any) {
      console.error("Error fetching factory worker statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Worker Statement PDF ──────────────────────────────────────────
  app.get("/api/factory/workers/:id/statement-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(workerId)) return res.status(400).json({ message: "Invalid worker ID" });
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      // Worker info
      const [worker] = await db.select().from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const workerName = worker.fullName || `Worker #${workerId}`;

      // Advances
      const advConds: any[] = [eq(factoryWorkerAdvances.workerId, workerId), eq(factoryWorkerAdvances.companyId, companyId)];
      if (startDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} >= ${startDate}`);
      if (endDate) advConds.push(sql`${factoryWorkerAdvances.advanceDate} <= ${endDate}`);
      const advances = await db.select().from(factoryWorkerAdvances).where(and(...advConds)).orderBy(factoryWorkerAdvances.advanceDate);

      // Payrolls
      const payConds: any[] = [eq(factoryPayrolls.workerId, workerId), eq(factoryPayrolls.companyId, companyId), eq(factoryPayrolls.status, "PAID")];
      if (startDate) payConds.push(sql`${factoryPayrolls.paidAt}::date >= ${startDate}`);
      if (endDate) payConds.push(sql`${factoryPayrolls.paidAt}::date <= ${endDate}`);
      const payrolls = await db.select().from(factoryPayrolls).where(and(...payConds)).orderBy(factoryPayrolls.paidAt);

      // Build entries
      const entries: any[] = [];
      for (const adv of advances) {
        entries.push({ date: adv.advanceDate, type: "Advance", description: adv.notes || "Advance payment", debit: parseFloat(adv.amount || "0"), credit: 0 });
      }
      for (const pr of payrolls) {
        const paidDate = pr.paidAt ? new Date(pr.paidAt).toISOString().split("T")[0] : pr.periodEnd;
        entries.push({ date: paidDate, type: "Payroll", description: `Payroll ${pr.periodStart} to ${pr.periodEnd}`, debit: 0, credit: parseFloat(pr.netSalary || "0") });
      }
      entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let running = 0;
      const rowsWithBalance = entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, runningBalance: running };
      });

      // Company info
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [sett] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);
      const companyName = (co as any)?.name ?? "Company";
      const logoUrl: string | null = (sett as any)?.logoUrl ?? null;
      const baseCurrency = (co as any)?.baseCurrency ?? "USD";
      const currMap: Record<string, string> = { USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", AED: "AED " };
      const sym = currMap[baseCurrency.toUpperCase()] ?? (baseCurrency + " ");
      const fmtAmt = (n: number) => sym + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const fmtDate = (s: string) => new Date(s.split("T")[0] + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const periodStr = startDate && endDate ? `${fmtDate(startDate)} — ${fmtDate(endDate)}` : startDate ? `From ${fmtDate(startDate)}` : endDate ? `Up to ${fmtDate(endDate)}` : "All Time";
      const generatedStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

      const PDFDocument = (await import("pdfkit")).default;
      const pathMod = await import("path");

      // Arabic font setup — always register so Arabic names render correctly
      const fontDir = pathMod.join(process.cwd(), "server", "fonts");
      const arabicFontPath = pathMod.join(fontDir, "Amiri-Regular.ttf");
      const hasArabicFont = fs.existsSync(arabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (hasArabicFont) doc.registerFont("Arabic", arabicFontPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${workerName.replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      // Arabic reshaping helpers — always loaded
      let wConvertArabic: ((t: string) => string) | null = null;
      let wBidiInst: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
      try {
        const reshaperMod = require("arabic-reshaper") as { convertArabic: (t: string) => string };
        wConvertArabic = reshaperMod.convertArabic;
        const bidiFactory = require("bidi-js") as () => typeof wBidiInst;
        wBidiInst = (bidiFactory as any)();
      } catch {}

      const wContainsArabic = (text: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const wShapeText = (text: string): string => {
        if (!text || !wConvertArabic) return text;
        try {
          const reshaped = wConvertArabic(text);
          if (wBidiInst) {
            const levels = wBidiInst.getEmbeddingLevels(reshaped, "rtl");
            return wBidiInst.getReorderedString(reshaped, levels);
          }
          return reshaped;
        } catch { return text; }
      };

      // Render text with automatic Arabic font switching per cell
      const wRenderText = (text: string, x: number, yPos: number, w: number, align: "left"|"right") => {
        const hasAr = hasArabicFont && wContainsArabic(text);
        doc.font(hasAr ? "Arabic" : "Helvetica").fontSize(7.5)
          .text(hasAr ? wShapeText(text) : text, x, yPos, { width: w, align: hasAr ? "right" : align });
      };

      // Header
      const wHmdLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(wHmdLogoPath)) {
        try { doc.image(wHmdLogoPath, (doc.page.width - 220) / 2, 20, { width: 220 }); } catch {}
      }
      const wNameHasAr = hasArabicFont && wContainsArabic(workerName);
      doc.fontSize(10).font(wNameHasAr ? "Arabic" : "Helvetica").fillColor("#555555")
        .text(wNameHasAr ? `كشف حساب: ${wShapeText(workerName)}` : `Account Statement: ${workerName}`, 40, 102, { width: 515, align: wNameHasAr ? "right" : "center" });

      const headerBottom = 110;
      doc.moveTo(40, headerBottom + 4).lineTo(555, headerBottom + 4).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      const metaY = headerBottom + 10;
      doc.fillColor("#444444").fontSize(8).font("Helvetica");
      doc.text(`Period: ${periodStr}`, 40, metaY);
      doc.text(`Generated: ${generatedStr}`, 40, doc.y + 2);
      doc.moveDown(0.5);

      const PAGE_H = 841.89;
      const MARGIN_BOTTOM = 60;
      const colX = [40, 110, 205, 370, 435, 500];
      const colW = [70, 95, 165, 65, 65, 55];
      const colHdr = ["DATE", "TYPE", "PARTICULARS", "DEBIT", "CREDIT", "BALANCE"];
      const colAln: Array<"left" | "right"> = ["left", "left", "left", "right", "right", "right"];
      const ROW_H = 14;
      const HDR_H = 15;

      const drawHdr = (yh: number) => {
        doc.rect(40, yh, 515, HDR_H).fill("#1F3864");
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
        colHdr.forEach((h, i) => doc.text(h, colX[i] + 2, yh + 3.5, { width: colW[i] - 4, align: colAln[i] }));
        doc.fillColor("#000000").font("Helvetica").fontSize(7.5);
      };

      let tableY = doc.y + 4;
      drawHdr(tableY);
      let y = tableY + HDR_H;

      // Opening row
      doc.rect(40, y, 515, ROW_H).fill("#F0F4FF");
      doc.fillColor("#000000").font("Helvetica").fontSize(7.5);
      doc.text("Opening Balance", colX[2] + 2, y + 3, { width: colW[2] - 4, align: "left" });
      doc.text("-", colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
      doc.text("-", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
      doc.text(`${sym}0.00 Dr`, colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
      y += ROW_H;

      // Rows
      rowsWithBalance.forEach((row, idx) => {
        if (y + ROW_H > PAGE_H - MARGIN_BOTTOM) { doc.addPage(); y = 40; drawHdr(y); y += HDR_H; }
        if (idx % 2 === 1) { doc.rect(40, y, 515, ROW_H).fill("#F8F8F8"); doc.fillColor("#000000"); }
        const bal = row.runningBalance;
        const balSide = bal >= 0 ? "Dr" : "Cr";
        wRenderText(fmtDate(row.date), colX[0] + 2, y + 3, colW[0] - 4, "left");
        wRenderText(row.type, colX[1] + 2, y + 3, colW[1] - 4, "left");
        wRenderText(row.description, colX[2] + 2, y + 3, colW[2] - 4, "left");
        doc.font("Helvetica").fontSize(7.5);
        doc.text(row.debit > 0 ? fmtAmt(row.debit) : "-", colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        doc.text(row.credit > 0 ? fmtAmt(row.credit) : "-", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        doc.text(`${fmtAmt(bal)} ${balSide}`, colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
        y += ROW_H;
      });

      // Footer
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 5;
      const totD = rowsWithBalance.reduce((s, r) => s + r.debit, 0);
      const totC = rowsWithBalance.reduce((s, r) => s + r.credit, 0);
      const closing = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].runningBalance : 0;
      const closingSide = closing >= 0 ? "Dr" : "Cr";

      if (y + 52 > PAGE_H - 20) { doc.addPage(); y = 40; }
      doc.rect(40, y, 515, 16).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      doc.text("Current Period Total", colX[2] + 2, y + 4, { width: colW[2] - 4, align: "left" });
      doc.text(fmtAmt(totD), colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      doc.text(fmtAmt(totC), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      y += 17;
      doc.rect(40, y, 515, 16).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance", colX[2] + 2, y + 4, { width: colW[2] - 4, align: "left" });
      doc.text(`${fmtAmt(closing)} ${closingSide}`, colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });

      doc.end();
    } catch (err: any) {
      console.error("Worker statement PDF error:", err);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // DELETE /api/factory/workers/:id - Permanently delete a factory worker
  app.delete("/api/factory/workers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid worker ID" });

      // Check if the worker has any bale entries
      const baleCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM factory_bales WHERE worker_id = ${id} AND company_id = ${companyId} AND status NOT IN ('REMOVED','DELETED')`);
      const baleCount = parseInt((baleCheck.rows[0] as any)?.cnt || "0");
      if (baleCount > 0) {
        return res.status(400).json({ message: `Cannot delete: this worker has ${baleCount} bale entries. Remove all bale entries first.` });
      }

      // Check for payroll entries
      const payrollCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM factory_payrolls WHERE worker_id = ${id} AND company_id = ${companyId}`);
      const payrollCount = parseInt((payrollCheck.rows[0] as any)?.cnt || "0");
      if (payrollCount > 0) {
        return res.status(400).json({ message: `Cannot delete: this worker has ${payrollCount} payroll record(s).` });
      }

      const [deleted] = await db.delete(factoryWorkers)
        .where(and(eq(factoryWorkers.id, id), eq(factoryWorkers.companyId, companyId)))
        .returning({ id: factoryWorkers.id });

      if (!deleted) return res.status(404).json({ message: "Worker not found" });
      res.json({ message: "Worker deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting factory worker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/repair-orphaned-vouchers
  // Finds and deletes vouchers that were created for payroll/advance events that have
  // since been undone or deleted, leaving stale ledger entries (wrong cash balance etc).
  app.post("/api/factory/repair-orphaned-vouchers", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (!["Admin", "Owner", "Developer"].includes(currentRole)) {
        return res.status(403).json({ message: "Only Admin, Owner, or Developer can run ledger repair" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let deletedPayrollVouchers = 0;
      let deletedAdvanceVouchers = 0;

      await db.transaction(async (tx: any) => {
        // ── PAYMENT-PAY-{payrollId}-{ts} ────────────────────────────────────────
        // Should exist only when the referenced payroll is in PAID status.
        // If the payroll is DRAFT, APPROVED, or deleted → the voucher is orphaned.
        const payVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} LIKE 'PAYMENT-PAY-%'`,
          ));

        const orphanedPayVoucherIds: number[] = [];
        for (const v of payVouchers) {
          const parts = v.voucherNumber.split("-");
          const payrollId = parseInt(parts[2]);
          if (!payrollId || isNaN(payrollId)) {
            orphanedPayVoucherIds.push(v.id);
            continue;
          }
          const [payroll] = await tx
            .select({ status: factoryPayrolls.status })
            .from(factoryPayrolls)
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));
          if (!payroll || payroll.status !== "PAID") {
            orphanedPayVoucherIds.push(v.id);
          }
        }

        if (orphanedPayVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedPayVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedPayVoucherIds));
          deletedPayrollVouchers = orphanedPayVoucherIds.length;
        }

        // ── PAYMENT-ADV-{advanceId}-{ts} ────────────────────────────────────────
        // Should exist only when the referenced advance still exists in the table.
        // If the advance was deleted → the voucher is orphaned.
        const advVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} LIKE 'PAYMENT-ADV-%'`,
          ));

        const orphanedAdvVoucherIds: number[] = [];
        for (const v of advVouchers) {
          const parts = v.voucherNumber.split("-");
          const advanceId = parseInt(parts[2]);
          if (!advanceId || isNaN(advanceId)) {
            orphanedAdvVoucherIds.push(v.id);
            continue;
          }
          const [advance] = await tx
            .select({ id: factoryWorkerAdvances.id })
            .from(factoryWorkerAdvances)
            .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
          if (!advance) {
            orphanedAdvVoucherIds.push(v.id);
          }
        }

        if (orphanedAdvVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedAdvVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedAdvVoucherIds));
          deletedAdvanceVouchers = orphanedAdvVoucherIds.length;
        }

        // ── REPAY-SAL-{repaymentId}-{ts} and RECEIPT-REPAY-{repaymentId}-{ts} ──
        // Orphaned when the repayment record was deleted (e.g. via Reverse Advance)
        // but the voucher was not removed. Clean them up now.
        let deletedRepayVouchers = 0;
        const repayVouchers = await tx
          .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            sql`(${vouchers.voucherNumber} LIKE 'REPAY-SAL-%' OR ${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%')`,
          ));

        const orphanedRepayVoucherIds: number[] = [];
        for (const v of repayVouchers) {
          const m = v.voucherNumber.match(/^(?:REPAY-SAL|RECEIPT-REPAY)-(\d+)-/);
          if (!m) { orphanedRepayVoucherIds.push(v.id); continue; }
          const repaymentId = parseInt(m[1]);
          const [repayment] = await tx
            .select({ id: factoryAdvanceRepayments.id })
            .from(factoryAdvanceRepayments)
            .where(eq(factoryAdvanceRepayments.id, repaymentId));
          if (!repayment) {
            orphanedRepayVoucherIds.push(v.id);
          }
        }

        if (orphanedRepayVoucherIds.length > 0) {
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, orphanedRepayVoucherIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, orphanedRepayVoucherIds));
          deletedRepayVouchers = orphanedRepayVoucherIds.length;
        }
      });

      res.json({
        message: "Ledger repair complete",
        deletedPayrollVouchers,
        deletedAdvanceVouchers,
        total: deletedPayrollVouchers + deletedAdvanceVouchers,
      });
    } catch (error: any) {
      console.error("Repair orphaned vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
