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
async function findOrCreateLedger(companyId: number, name: string, accountType: string): Promise<{ id: number }> {
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
      const [created] = await db
        .insert(ledgerAccounts)
        .values({ companyId, code: nextCode, name, accountType, active: true, isHidden: false })
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

export function registerAdvanceAccountingRoutes(app: Express) {
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

      const [acct] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(400).json({ message: "Cash account not found" });

      // Find all outstanding advances (both Loan and Salary Deduction) for this month
      const outstanding = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.fullyPaid, false),
            sql`to_char(${factoryWorkerAdvances.advanceDate}, 'YYYY-MM') = ${month}`
          )
        );

      if (outstanding.length === 0) {
        return res.status(400).json({ message: "No outstanding advances found for that month" });
      }

      // Load worker names
      const workerIds = [...new Set(outstanding.map((a: any) => a.workerId))];
      const workerRows = await db
        .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(inArray(factoryWorkers.id, workerIds));
      const workerMap: Record<number, string> = Object.fromEntries(workerRows.map((w: any) => [w.id, w.fullName]));

      const result = await db.transaction(async (tx: any) => {
        // Resolve/create the Factory Worker Advances ledger account once
        let [advancesAccount] = await tx
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
        if (!advancesAccount) {
          const maxCodeResult = await tx
            .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [advancesAccount] = await tx
            .insert(ledgerAccounts)
            .values({
              companyId,
              code: nextCode,
              name: "Factory Worker Advances",
              accountType: "Asset",
              active: true,
              isHidden: false,
            })
            .returning();
        }

        let repaidCount = 0;
        let repaidTotal = 0;

        for (const advance of outstanding) {
          const bal = parseFloat(advance.remainingBalance || "0");
          if (bal <= 0) continue;

          const workerName = workerMap[advance.workerId] || `Worker #${advance.workerId}`;
          const narration = `Advance repayment from ${workerName}: $${bal.toFixed(2)} (advance #${advance.id})`;

          const [repayment] = await tx
            .insert(factoryAdvanceRepayments)
            .values({
              companyId,
              advanceId: advance.id,
              workerId: advance.workerId,
              repaymentDate: repayDate,
              amount: bal.toFixed(2),
              cashAccountId,
              notes: req.body.notes || null,
            })
            .returning();

          await tx
            .update(factoryWorkerAdvances)
            .set({
              remainingBalance: "0.00",
              fullyPaid: true,
            })
            .where(eq(factoryWorkerAdvances.id, advance.id));

          // Voucher: DR Cash, CR Factory Worker Advances
          const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
          const [createdVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber,
              voucherType: "Receipt",
              voucherDate: repayDate,
              description: narration,
              totalAmount: bal.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();

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
            companyId,
            txDate: repayDate,
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

      const [acct] = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          openingBalance: ledgerAccounts.openingBalance,
          openingBalanceSide: ledgerAccounts.openingBalanceSide,
        })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      // Some cash entries are stored with bankAccountId (bank-linked), not ledgerAccountId.
      // Find any bankAccounts record whose linkedLedgerId = this ledger account.
      const linkedBanks = await db
        .select({
          id: bankAccounts.id,
          openingBalance: bankAccounts.openingBalance,
          openingBalanceSide: bankAccounts.openingBalanceSide,
        })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.linkedLedgerId, accountId), eq(bankAccounts.companyId, companyId)));

      // Sum entries via ledgerAccountId
      const [ledgerTotals] = await db
        .select({
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
        const [bankTotals] = await db
          .select({
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

      const [cashAcct] = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcct) return res.status(400).json({ message: "Cash account not found" });

      await db.transaction(async (tx: any) => {
        // Resolve or auto-create the contra "Factory Advance Adjustments" account
        let [adjAccount] = await tx
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Advance Adjustments")));
        if (!adjAccount) {
          const maxCodeResult = await tx
            .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [adjAccount] = await tx
            .insert(ledgerAccounts)
            .values({
              companyId,
              code: nextCode,
              name: "Factory Advance Adjustments",
              accountType: "Equity",
              active: true,
              isHidden: false,
            })
            .returning();
        }

        const voucherNumber = `ADJ-CASH-${cashAccountId}-${Date.now()}`;
        const desc = narration || "Cash balance adjustment";

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: "Journal",
            voucherDate: date,
            description: desc,
            totalAmount: amount.toFixed(2),
            currency: "USD",
            sourceModule: "FACTORY",
          })
          .returning();

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

      res.json({
        message: `Cash adjustment posted — ${isCredit ? "CR" : "DR"} ${cashAcct.name} $${amount.toFixed(2)}`,
      });
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
      const allAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        )
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const advanceIds = allAdvances.map((r: any) => r.factory_worker_advances.id);

      // 2. All repayment records for those advances
      const repayments =
        advanceIds.length > 0
          ? await db
              .select()
              .from(factoryAdvanceRepayments)
              .where(
                and(
                  eq(factoryAdvanceRepayments.companyId, companyId),
                  inArray(factoryAdvanceRepayments.advanceId, advanceIds)
                )
              )
          : [];

      // 3. All repayment vouchers for this company (both old RECEIPT-REPAY and new REPAY-SAL patterns)
      const repayVouchers = await db
        .select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`(${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%' OR ${vouchers.voucherNumber} LIKE 'REPAY-SAL-%')`
          )
        );

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
              id: adv.id,
              workerId: adv.workerId,
              workerName: worker.fullName,
              advanceDate: adv.advanceDate,
              amount: adv.amount,
              remainingBalance: adv.remainingBalance,
              fullyPaid: adv.fullyPaid,
              caseType: "no_repayment",
              repayments: [],
              missingVoucherRepayments: [],
            });
          }
        } else {
          const missingVoucherRepays = advRepays.filter((r: any) => !voucheredRepayIds.has(r.id));
          if (missingVoucherRepays.length > 0) {
            auditAdvances.push({
              id: adv.id,
              workerId: adv.workerId,
              workerName: worker.fullName,
              advanceDate: adv.advanceDate,
              amount: adv.amount,
              remainingBalance: adv.remainingBalance,
              fullyPaid: adv.fullyPaid,
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

      const [cashAcct] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!cashAcct) return res.status(400).json({ message: "Cash account not found" });

      // Resolve or auto-create "Factory Workers Salary Payable" as the contra for salary-deduction repayments
      // (DR Salary Payable / CR Factory Worker Advances — salary deductions don't touch cash)
      let [payableAcct] = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Workers Salary Payable")));
      if (!payableAcct) {
        const [maxCodeRow] = await db
          .select({ maxCode: sql<string>`MAX(${ledgerAccounts.code})` })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.companyId, companyId));
        const nextCode = String((parseInt(maxCodeRow?.maxCode || "1000") || 1000) + 1);
        [payableAcct] = await db
          .insert(ledgerAccounts)
          .values({
            companyId,
            code: nextCode,
            name: "Factory Workers Salary Payable",
            accountType: "Accounts Payable",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          })
          .returning({ id: ledgerAccounts.id, name: ledgerAccounts.name });
      }

      // Re-run audit to get fresh list
      const allAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .innerJoin(factoryWorkers, eq(factoryWorkerAdvances.workerId, factoryWorkers.id))
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        );

      const advanceIds = allAdvances.map((r: any) => r.factory_worker_advances.id);
      const repayments =
        advanceIds.length > 0
          ? await db
              .select()
              .from(factoryAdvanceRepayments)
              .where(
                and(
                  eq(factoryAdvanceRepayments.companyId, companyId),
                  inArray(factoryAdvanceRepayments.advanceId, advanceIds)
                )
              )
          : [];

      const repayVouchers = await db
        .select({ voucherNumber: vouchers.voucherNumber })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            sql`(${vouchers.voucherNumber} LIKE 'RECEIPT-REPAY-%' OR ${vouchers.voucherNumber} LIKE 'REPAY-SAL-%')`
          )
        );

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
        let [advancesAccount] = await tx
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
        if (!advancesAccount) {
          const maxCodeResult = await tx
            .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
          const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
          [advancesAccount] = await tx
            .insert(ledgerAccounts)
            .values({
              companyId,
              code: nextCode,
              name: "Factory Worker Advances",
              accountType: "Asset",
              active: true,
              isHidden: false,
            })
            .returning();
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

            const [repayment] = await tx
              .insert(factoryAdvanceRepayments)
              .values({
                companyId,
                advanceId: adv.id,
                workerId: adv.workerId,
                repaymentDate,
                amount: amount.toFixed(2),
                cashAccountId,
                notes: "Auto-created by Repayment Audit",
              })
              .returning();

            const narration = `Salary deduction repayment — ${workerName}: $${amount.toFixed(2)} (advance #${adv.id})`;
            const voucherNumber = `REPAY-SAL-${repayment.id}-${Date.now()}`;
            const [voucher] = await tx
              .insert(vouchers)
              .values({
                companyId,
                voucherNumber,
                voucherType: "Journal",
                voucherDate: repaymentDate,
                description: narration,
                totalAmount: amount.toFixed(2),
                currency: "USD",
                sourceModule: "FACTORY",
              })
              .returning();

            // DR Factory Workers Salary Payable / CR Factory Worker Advances
            // Salary deductions reduce the company's wage obligation — no cash movement
            await tx.insert(voucherEntries).values([
              {
                voucherId: voucher.id,
                ledgerAccountId: payableAcct.id,
                debitAmount: amount.toFixed(2),
                creditAmount: "0",
                narration,
              },
              {
                voucherId: voucher.id,
                ledgerAccountId: advancesAccount.id,
                debitAmount: "0",
                creditAmount: amount.toFixed(2),
                narration,
              },
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
              const [voucher] = await tx
                .insert(vouchers)
                .values({
                  companyId,
                  voucherNumber,
                  voucherType: "Journal",
                  voucherDate: rDate,
                  description: narration,
                  totalAmount: amount.toFixed(2),
                  currency: "USD",
                  sourceModule: "FACTORY",
                })
                .returning();

              await tx.insert(voucherEntries).values([
                {
                  voucherId: voucher.id,
                  ledgerAccountId: payableAcct.id,
                  debitAmount: amount.toFixed(2),
                  creditAmount: "0",
                  narration,
                },
                {
                  voucherId: voucher.id,
                  ledgerAccountId: advancesAccount.id,
                  debitAmount: "0",
                  creditAmount: amount.toFixed(2),
                  narration,
                },
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

      const [advance] = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
      if (!advance) return res.status(404).json({ message: "Advance not found" });

      const repayments = await db
        .select()
        .from(factoryAdvanceRepayments)
        .where(
          and(eq(factoryAdvanceRepayments.advanceId, advanceId), eq(factoryAdvanceRepayments.companyId, companyId))
        )
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

      const [advance] = await db
        .select()
        .from(factoryWorkerAdvances)
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
        return res
          .status(400)
          .json({ message: `Repayment ($${amount.toFixed(2)}) exceeds remaining balance ($${bal.toFixed(2)})` });
      }
      const effectiveAmount = Math.min(amount, bal);

      const repaymentDate = req.body.repaymentDate || getClientDate(req);
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found" });
      }

      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, advance.workerId));

      const result = await db.transaction(async (tx: any) => {
        const [repayment] = await tx
          .insert(factoryAdvanceRepayments)
          .values({
            companyId,
            advanceId,
            workerId: advance.workerId,
            repaymentDate,
            amount: effectiveAmount.toFixed(2),
            cashAccountId,
            notes: req.body.notes || null,
          })
          .returning();

        const newBalance = bal - effectiveAmount;
        const isFullyPaid = newBalance <= 0.005;

        await tx
          .update(factoryWorkerAdvances)
          .set({
            remainingBalance: Math.max(0, newBalance).toFixed(2),
            fullyPaid: isFullyPaid,
          })
          .where(eq(factoryWorkerAdvances.id, advanceId));

        if (cashAccountId) {
          let [advancesAccount] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));

          if (!advancesAccount) {
            const maxCodeResult = await tx
              .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [advancesAccount] = await tx
              .insert(ledgerAccounts)
              .values({
                companyId,
                code: nextCode,
                name: "Factory Worker Advances",
                accountType: "Asset",
                active: true,
                isHidden: false,
              })
              .returning();
          }

          const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
          const narration = `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)}`;

          const [createdVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber,
              voucherType: "Receipt",
              voucherDate: repaymentDate,
              description: narration,
              totalAmount: effectiveAmount.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();

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
          companyId,
          txDate: repaymentDate,
          txType: "ADVANCE_REPAYMENT",
          referenceId: repayment.id,
          referenceTable: "factory_advance_repayments",
          description: `Advance repayment from ${worker?.fullName || "Worker"}: $${effectiveAmount.toFixed(2)} (advance #${advanceId})`,
          amountCurrency: effectiveAmount,
          currencyCode: "USD",
          amountUsd: effectiveAmount,
          createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
        });

        const [updatedAdvance] = await tx
          .select()
          .from(factoryWorkerAdvances)
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
        const [acct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found" });
      }

      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, workerId));
      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const outstandingAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.workerId, workerId),
            eq(factoryWorkerAdvances.repaymentType, "manual_repayment"),
            eq(factoryWorkerAdvances.fullyPaid, false)
          )
        );

      const toRepay = outstandingAdvances.filter((a) => parseFloat(a.remainingBalance || "0") > 0.001);
      if (toRepay.length === 0) {
        return res.status(400).json({ message: "No outstanding manual repayment advances found for this worker" });
      }

      const result = await db.transaction(async (tx: any) => {
        let advancesAccountId: number | null = null;
        if (cashAccountId) {
          let [found] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
          if (!found) {
            const maxCodeResult = await tx
              .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\\d+$'`));
            const nextCode = String((parseInt(maxCodeResult[0]?.maxCode || "0") || 0) + 1);
            [found] = await tx
              .insert(ledgerAccounts)
              .values({
                companyId,
                code: nextCode,
                name: "Factory Worker Advances",
                accountType: "Asset",
                active: true,
                isHidden: false,
              })
              .returning();
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

          const [repayment] = await tx
            .insert(factoryAdvanceRepayments)
            .values({
              companyId,
              advanceId: advance.id,
              workerId,
              repaymentDate: effectiveRepaymentDate,
              amount: effectiveAmount.toFixed(2),
              cashAccountId,
              notes,
            })
            .returning();

          await tx
            .update(factoryWorkerAdvances)
            .set({
              remainingBalance: "0.00",
              fullyPaid: true,
            })
            .where(eq(factoryWorkerAdvances.id, advance.id));

          if (cashAccountId && advancesAccountId) {
            const voucherNumber = `RECEIPT-REPAY-${repayment.id}-${Date.now()}`;
            const narration = `Bulk advance repayment from ${worker.fullName}: $${effectiveAmount.toFixed(2)} (advance #${advance.id})`;
            const [createdVoucher] = await tx
              .insert(vouchers)
              .values({
                companyId,
                voucherNumber,
                voucherType: "Receipt",
                voucherDate: effectiveRepaymentDate,
                description: narration,
                totalAmount: effectiveAmount.toFixed(2),
                currency: "USD",
                sourceModule: "FACTORY",
              })
              .returning();

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
            companyId,
            txDate: effectiveRepaymentDate,
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
}
