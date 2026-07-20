import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { eq, and, desc, sql, ilike, gte, lte, inArray, isNotNull, isNull } from "drizzle-orm";
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
import { normalizeVoucherEntryAmounts } from "../../services/accounting/currencyAmounts";

/** Normalize a USD voucher entry (IDENTITY convention). Returns dual-currency fields spread-ready. */
function normUsd(debit: string | number, credit: string | number) {
  const norm = normalizeVoucherEntryAmounts({
    transactionCurrency: "USD",
    baseCurrency: "USD",
    transactionDebitAmount: String(debit),
    transactionCreditAmount: String(credit),
    historicalRate: "1",
  });
  return {
    transactionCurrency: norm.transactionCurrency,
    transactionDebitAmount: norm.transactionDebitAmount,
    transactionCreditAmount: norm.transactionCreditAmount,
    baseDebitAmount: norm.baseDebitAmount,
    baseCreditAmount: norm.baseCreditAmount,
    historicalExchangeRate: norm.historicalExchangeRate,
    rateConvention: norm.rateConvention,
    debitAmount: norm.debitAmount,
    creditAmount: norm.creditAmount,
  };
}

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

/** Find or create a ledger account by name for a company. Returns the account row.
 *  Skips soft-deleted accounts and handles race-condition unique-constraint failures. */
async function findOrCreateLedger(
  companyId: number,
  name: string,
  accountType: string,
  opts?: { parentId?: number; subType?: string }
): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt)));
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxCodeRow] = await db
      .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
    const nextCode = String((parseInt((maxCodeRow as any)?.maxCode || "0") || 0) + 1 + attempt);
    try {
      const insertVals: any = { companyId, code: nextCode, name, accountType, active: true, isHidden: false };
      if (opts?.parentId) insertVals.parentId = opts.parentId;
      if (opts?.subType)  insertVals.subType  = opts.subType;
      const [created] = await db
        .insert(ledgerAccounts)
        .values(insertVals)
        .returning({ id: ledgerAccounts.id });
      return created;
    } catch (err: any) {
      if (err?.code === "23505" || err?.message?.includes("unique")) {
        const [nowFound] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, name), isNull(ledgerAccounts.deletedAt)));
        if (nowFound) return nowFound;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Unable to create ledger account "${name}" after multiple attempts`);
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

  // GET /api/factory/workers/amount-due
  // Returns a "owed till today" snapshot for every active worker.
  // Uses calendar-day proration then deducts explicitly recorded Absent / Half Day
  // entries from the attendance table — consistent with the full payroll calculation.
  // Period start = day after last PAID payroll's periodEnd, or 1st of current month.
  // Only salary_deduction advances are auto-deducted (same rule as payroll preview).
  app.get("/api/factory/workers/amount-due", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId
        ? parseOptionalId(req.query.companyId)
        : getFactoryCompanyId(req);
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
            eq(factoryPayrolls.status, "PAID"),
          ),
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
      const minPeriodStart = allStarts.length > 0
        ? allStarts.reduce((a, b) => (a < b ? a : b))
        : todayStr;

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
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
          ),
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
            lte(factoryAttendance.attendanceDate, todayStr),
          ),
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

      const result: Record<number, {
        periodStart: string;
        periodEnd: string;
        base: number;
        transport: number;
        absenceDeducted: number;
        advanceDeducted: number;
        net: number;
        lastPaidThrough: string | null;
      }> = {};

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
        for (const att of (attendanceByWorker[w.id] ?? [])) {
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
    } catch (err: any) {
      console.error("GET /api/factory/workers/amount-due error:", err);
      res.status(500).json({ message: err.message });
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

      // Pre-resolve per-worker ledger accounts OUTSIDE the transaction
      // Sequential calls to avoid simultaneous MAX(code) reads returning the same nextCode
      const payableAccGen  = await findOrCreateLedger(companyId, "Payroll Payable",          "Liability");
      const advancesAccGen = await findOrCreateLedger(companyId, "Factory Worker Advances",   "Asset");
      // Ensure group header accounts exist — worker accounts nest under them in the chart of accounts
      const salaryGroupAcc = await findOrCreateLedger(companyId, "Salary Expense - Workers", "Expense", { subType: "Group" });
      const bonusGroupAcc  = await findOrCreateLedger(companyId, "Bonus Expense - Workers",  "Expense", { subType: "Group" });
      // Map: workerId → { salaryId, bonusId } — each worker gets their own named expense account
      const workerAccCache = new Map<number, { salaryId: number; bonusId: number }>();
      for (const worker of targetWorkers) {
        const workerName = (worker.fullName as string) || `Worker #${worker.id}`;
        const sa = await findOrCreateLedger(companyId, `Salary Expense - ${workerName}`, "Expense", { parentId: salaryGroupAcc.id });
        const ba = await findOrCreateLedger(companyId, `Bonus Expense - ${workerName}`,  "Expense", { parentId: bonusGroupAcc.id });
        workerAccCache.set(worker.id, { salaryId: sa.id, bonusId: ba.id });
      }

      const created = await db.transaction(async (tx: any) => {
        let count = 0;
        let totalNet = 0;
        let totalAdvanceDeductions = 0;
        // Track per-worker expense amounts for accounting
        const workerExpenses: { workerId: number; workerName: string; salAmt: number; bonAmt: number }[] = [];
        for (const worker of targetWorkers) {
          const baseSal = parseFloat(worker.baseSalary || "0");
          const freq = (worker as any).payFrequency || worker.salaryType || "Monthly";
          let base: number;
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
          // Accumulate per-worker expense amounts for accounting
          const workerName = (worker.fullName as string) || `Worker #${worker.id}`;
          workerExpenses.push({ workerId: worker.id, workerName, salAmt: base + transport - workerPendingDeductions, bonAmt: bonus });
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
        // Accounting: Dr per-worker Salary/Bonus Expense / Cr Payroll Payable (net) / Cr Factory Worker Advances
        const totalGross = totalNet + totalAdvanceDeductions;
        if (totalGross > 0) {
          // ── Dedup guard: remove any existing PAYROLL-GEN vouchers for this period ──
          // Prevents duplicate expense vouchers when payroll is regenerated (e.g. after a data pull).
          const staleGenVouchers = await tx
            .select({ id: vouchers.id })
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, companyId),
                sql`${vouchers.voucherNumber} LIKE 'PAYROLL-GEN-%'`,
                eq(vouchers.voucherDate, periodStart),
                sql`${vouchers.description} LIKE ${"%" + periodEnd + "%"}`
              )
            );
          if (staleGenVouchers.length > 0) {
            const vIds = staleGenVouchers.map((v: any) => v.id);
            await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
            await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
          }

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
          // DR entries per worker (one salary line + one bonus line each)
          for (const { workerId, workerName, salAmt, bonAmt } of workerExpenses) {
            const accs = workerAccCache.get(workerId)!;
            if (salAmt > 0) {
              journalEntries.push({
                voucherId: genVoucher.id,
                ledgerAccountId: accs.salaryId,
                ...normUsd(salAmt.toFixed(2), "0"),
                narration: `Salary - ${workerName} (${periodStart} – ${periodEnd})`,
              });
            }
            if (bonAmt > 0) {
              journalEntries.push({
                voucherId: genVoucher.id,
                ledgerAccountId: accs.bonusId,
                ...normUsd(bonAmt.toFixed(2), "0"),
                narration: `Bonus - ${workerName} (${periodStart} – ${periodEnd})`,
              });
            }
          }
          if (totalNet > 0) {
            journalEntries.push({
              voucherId: genVoucher.id,
              ledgerAccountId: payableAccGen.id,
              ...normUsd("0", totalNet.toFixed(2)),
              narration: desc,
            });
          }
          // Credit Factory Worker Advances to reduce the asset as deductions are settled
          if (totalAdvanceDeductions > 0) {
            journalEntries.push({
              voucherId: genVoucher.id,
              ledgerAccountId: advancesAccGen.id,
              ...normUsd("0", totalAdvanceDeductions.toFixed(2)),
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

          if (netAmt > 0) {
            await tx.insert(voucherEntries).values([
              {
                voucherId: pVoucher.id,
                ledgerAccountId: payableAcc.id,
                ...normUsd(netAmt.toFixed(2), "0"),
                narration,
              },
              {
                voucherId: pVoucher.id,
                ledgerAccountId: cashAccountId,
                ...normUsd("0", netAmt.toFixed(2)),
                narration,
              },
            ]);
          }
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

      if (netAmt > 0) {
        await db.insert(voucherEntries).values([
          {
            voucherId: pVoucher.id,
            ledgerAccountId: payableAcc.id,
            ...normUsd(netAmt.toFixed(2), "0"),
            narration,
          },
          {
            voucherId: pVoucher.id,
            ledgerAccountId: cashAccountId,
            ...normUsd("0", netAmt.toFixed(2)),
            narration,
          },
        ]);
      }

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

        const workerIds = Array.from(new Set<number>(payrollsToMark.map((p: any) => p.workerId)));
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

            if (netAmt > 0) {
              await tx.insert(voucherEntries).values([
                {
                  voucherId: pVoucher.id,
                  ledgerAccountId: payableAcc.id,
                  ...normUsd(netAmt.toFixed(2), "0"),
                  narration,
                },
                {
                  voucherId: pVoucher.id,
                  ledgerAccountId: cashId,
                  ...normUsd("0", netAmt.toFixed(2)),
                  narration,
                },
              ]);
            }
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
                ...normUsd(salAmt.toFixed(2), "0"),
                narration: `Salary expense - ${capCity} (${periodStart} – ${periodEnd})`,
              });
            }
            if (bonAmt > 0) {
              const bonAccId = bonusAccByCity.get(city) ?? legacyAcc.id;
              newEntries.push({
                voucherId: row.id,
                ledgerAccountId: bonAccId,
                ...normUsd(bonAmt.toFixed(2), "0"),
                narration: `Bonus expense - ${capCity} (${periodStart} – ${periodEnd})`,
              });
            }
          } else {
            const total = salAmt + bonAmt;
            if (total > 0) {
              newEntries.push({
                voucherId: row.id,
                ledgerAccountId: legacyAcc.id,
                ...normUsd(total.toFixed(2), "0"),
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
            ...normUsd(amt.toFixed(2), "0"),
            narration: city ? `Bonus expense - ${capCity}: ${narration}` : narration,
          },
          {
            voucherId: bVoucher.id,
            ledgerAccountId: parseInt(wb.cash_account_id),
            ...normUsd("0", amt.toFixed(2)),
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

  // POST /api/factory/payroll/migrate-worker-names
  // Migration: replaces city-based expense entries in PAYROLL-GEN-* vouchers with
  // per-worker named entries ("Salary Expense - Ahmad Hassan" instead of "Salary Expense - Beirut").
  // Safe to run multiple times (idempotent per voucher).
  app.post("/api/factory/payroll/migrate-worker-names", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (!["Admin", "Owner", "Developer"].includes(currentRole)) {
        return res.status(403).json({ message: "Only Admin, Owner, or Developer can run this migration" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find all PAYROLL-GEN vouchers for this company
      const genVouchers = await db.execute(sql`
        SELECT v.id, v.voucher_date, v.description
        FROM vouchers v
        WHERE v.company_id = ${companyId}
          AND v.voucher_number LIKE 'PAYROLL-GEN-%'
        ORDER BY v.voucher_date
      `);

      let vouchersUpdated = 0;

      for (const row of genVouchers.rows as any[]) {
        // Parse period dates from description: "Payroll expense: N workers (YYYY-MM-DD – YYYY-MM-DD)"
        const periodMatch = (row.description as string | null)?.match(
          /\((\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})\)/
        );
        const periodStart = row.voucher_date as string;
        const periodEnd = periodMatch ? periodMatch[2] : null;
        if (!periodEnd) continue;

        // Fetch payroll records + worker names for this period
        const payrollData = await db.execute(sql`
          SELECT fp.worker_id, fp.base_salary, fp.transport, fp.bonuses,
                 fp.deductions, fp.advances, fp.net_salary, fw.full_name
          FROM factory_payrolls fp
          JOIN factory_workers fw ON fw.id = fp.worker_id
          WHERE fp.company_id = ${companyId}
            AND fp.period_start = ${periodStart}
            AND fp.period_end = ${periodEnd}
        `);

        if ((payrollData.rows as any[]).length === 0) continue;

        // Resolve per-worker ledger accounts (sequential to avoid nextCode collisions)
        // Ensure group headers exist so worker accounts nest under them in the chart of accounts
        const salGrp = await findOrCreateLedger(companyId, "Salary Expense - Workers", "Expense", { subType: "Group" });
        const bonGrp = await findOrCreateLedger(companyId, "Bonus Expense - Workers",  "Expense", { subType: "Group" });
        // Stamp subType=Group on both headers in case they existed before the Group flag was introduced
        await db.execute(sql`UPDATE ledger_accounts SET sub_type='Group' WHERE id IN (${salGrp.id}, ${bonGrp.id}) AND (sub_type IS NULL OR sub_type <> 'Group')`);
        const workerAccMap = new Map<number, { salaryId: number; bonusId: number }>();
        for (const p of payrollData.rows as any[]) {
          if (workerAccMap.has(p.worker_id)) continue;
          const workerName = (p.full_name as string) || `Worker #${p.worker_id}`;
          const sa = await findOrCreateLedger(companyId, `Salary Expense - ${workerName}`, "Expense", { parentId: salGrp.id });
          const ba = await findOrCreateLedger(companyId, `Bonus Expense - ${workerName}`,  "Expense", { parentId: bonGrp.id });
          // Re-parent in case the account already existed without parentId (pre-fix)
          await db.execute(sql`UPDATE ledger_accounts SET parent_id = ${salGrp.id} WHERE id = ${sa.id} AND (parent_id IS NULL OR parent_id <> ${salGrp.id})`);
          await db.execute(sql`UPDATE ledger_accounts SET parent_id = ${bonGrp.id} WHERE id = ${ba.id} AND (parent_id IS NULL OR parent_id <> ${bonGrp.id})`);
          workerAccMap.set(p.worker_id, { salaryId: sa.id, bonusId: ba.id });
        }

        // Delete existing DR (expense) entries for this voucher — CR entries (payable/advances) are preserved
        await db.execute(sql`
          DELETE FROM voucher_entries
          WHERE voucher_id = ${row.id}
            AND CAST(debit_amount AS numeric) > 0
        `);

        // Insert new per-worker DR entries
        const newEntries: any[] = [];
        for (const p of payrollData.rows as any[]) {
          const workerName = (p.full_name as string) || `Worker #${p.worker_id}`;
          const accs = workerAccMap.get(p.worker_id)!;
          const salAmt =
            parseFloat(p.base_salary || "0") +
            parseFloat(p.transport || "0") -
            parseFloat(p.deductions || "0");
          const bonAmt = parseFloat(p.bonuses || "0");
          if (salAmt > 0) {
            newEntries.push({
              voucherId: row.id,
              ledgerAccountId: accs.salaryId,
              ...normUsd(salAmt.toFixed(2), "0"),
              narration: `Salary - ${workerName} (${periodStart} – ${periodEnd})`,
            });
          }
          if (bonAmt > 0) {
            newEntries.push({
              voucherId: row.id,
              ledgerAccountId: accs.bonusId,
              ...normUsd(bonAmt.toFixed(2), "0"),
              narration: `Bonus - ${workerName} (${periodStart} – ${periodEnd})`,
            });
          }
        }
        if (newEntries.length > 0) {
          await db.insert(voucherEntries).values(newEntries);
        }
        vouchersUpdated++;
      }

      // ── Step 2: delete orphaned Salary/Bonus Expense accounts (no entries left) ──
      // These are the old city-based accounts created by migrate-city-split.
      // Now that all voucher entries point to per-worker accounts, city accounts are empty.
      const orphanedAccounts = await db.execute(sql`
        SELECT la.id
        FROM ledger_accounts la
        WHERE la.company_id = ${companyId}
          AND (la.name LIKE 'Salary Expense - %' OR la.name LIKE 'Bonus Expense - %')
          AND la.sub_type IS DISTINCT FROM 'Group'
          AND la.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM voucher_entries ve WHERE ve.ledger_account_id = la.id
          )
      `);
      let accountsDeleted = 0;
      const orphanRows = (orphanedAccounts.rows as any[]);
      if (orphanRows.length > 0) {
        // Use inArray (drizzle) instead of raw ANY() to avoid parameterization issues
        const orphanIds = orphanRows.map((r: any) => r.id as number);
        await db.delete(ledgerAccounts).where(inArray(ledgerAccounts.id, orphanIds));
        accountsDeleted = orphanIds.length;
      }

      // ── Step 3: ensure group headers exist and re-parent all worker accounts ──
      const salaryGroup = await findOrCreateLedger(companyId, "Salary Expense - Workers", "Expense", { subType: "Group" });
      const bonusGroup  = await findOrCreateLedger(companyId, "Bonus Expense - Workers",  "Expense", { subType: "Group" });
      await db.execute(sql`
        UPDATE ledger_accounts SET sub_type = 'Group'
        WHERE id IN (${salaryGroup.id}, ${bonusGroup.id}) AND (sub_type IS NULL OR sub_type <> 'Group')
      `);
      const salReparent = await db.execute(sql`
        UPDATE ledger_accounts SET parent_id = ${salaryGroup.id}
        WHERE company_id = ${companyId} AND name LIKE 'Salary Expense - %'
          AND id <> ${salaryGroup.id} AND deleted_at IS NULL
      `);
      const bonReparent = await db.execute(sql`
        UPDATE ledger_accounts SET parent_id = ${bonusGroup.id}
        WHERE company_id = ${companyId} AND name LIKE 'Bonus Expense - %'
          AND id <> ${bonusGroup.id} AND deleted_at IS NULL
      `);

      res.json({
        message: "Payroll accounts fixed",
        vouchersUpdated,
        accountsDeleted,
        salaryAccountsReparented: (salReparent as any).rowCount ?? 0,
        bonusAccountsReparented:  (bonReparent as any).rowCount ?? 0,
      });
    } catch (error: any) {
      console.error("migrate-worker-names error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/payroll/migrate-salary-groups
  // Creates "Salary Expense - Workers" and "Bonus Expense - Workers" group header accounts,
  // then re-parents every matching individual worker account under them so the chart of accounts
  // shows an expandable group row instead of a flat list.  Safe to run multiple times.
  app.post("/api/factory/payroll/migrate-salary-groups", requireAuth, async (req: any, res: any) => {
    try {
      const currentRole = (req.session as any).currentRole;
      if (!["Admin", "Owner", "Developer"].includes(currentRole)) {
        return res.status(403).json({ message: "Only Admin, Owner, or Developer can run this migration" });
      }
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // 1. Find or create the two group header accounts
      const salaryGroup = await findOrCreateLedger(companyId, "Salary Expense - Workers", "Expense", { subType: "Group" });
      const bonusGroup  = await findOrCreateLedger(companyId, "Bonus Expense - Workers",  "Expense", { subType: "Group" });

      // 2. Ensure sub_type = 'Group' on both (in case they already existed without it)
      await db.execute(sql`
        UPDATE ledger_accounts
        SET sub_type = 'Group'
        WHERE id IN (${salaryGroup.id}, ${bonusGroup.id})
          AND (sub_type IS NULL OR sub_type <> 'Group')
      `);

      // 3. Re-parent all "Salary Expense - *" accounts under salaryGroup
      const salRes = await db.execute(sql`
        UPDATE ledger_accounts
        SET parent_id = ${salaryGroup.id}
        WHERE company_id = ${companyId}
          AND name LIKE 'Salary Expense - %'
          AND id <> ${salaryGroup.id}
          AND deleted_at IS NULL
      `);

      // 4. Re-parent all "Bonus Expense - *" accounts under bonusGroup
      const bonRes = await db.execute(sql`
        UPDATE ledger_accounts
        SET parent_id = ${bonusGroup.id}
        WHERE company_id = ${companyId}
          AND name LIKE 'Bonus Expense - %'
          AND id <> ${bonusGroup.id}
          AND deleted_at IS NULL
      `);

      res.json({
        message: "Salary groups migration complete",
        salaryGroupId: salaryGroup.id,
        bonusGroupId:  bonusGroup.id,
        salaryAccountsReparented: (salRes as any).rowCount ?? 0,
        bonusAccountsReparented:  (bonRes as any).rowCount ?? 0,
      });
    } catch (error: any) {
      console.error("migrate-salary-groups error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
