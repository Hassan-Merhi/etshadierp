import { parseId, parseOptionalId } from "../../lib/parseId";
import { logger } from "../../lib/logger";
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

export function registerWorkerStatsAdvancesRoutes(app: Express) {
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
      logger.error("Error fetching worker stats:", { error: error });
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
      const workerId = req.query.workerId ? parseOptionalId(req.query.workerId) : null;
      if (req.query.workerId && workerId === null) {
        return res.status(400).json({ message: "Invalid workerId" });
      }
      if (workerId !== null) conditions.push(eq(factoryAdvanceRepayments.workerId, workerId));

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
      logger.error("Error fetching advance repayments:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances - List all advances for company
  app.get("/api/factory/advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(factoryWorkerAdvances.companyId, companyId)];
      const workerId = req.query.workerId ? parseOptionalId(req.query.workerId) : null;
      if (req.query.workerId && workerId === null) {
        return res.status(400).json({ message: "Invalid workerId" });
      }
      if (workerId !== null) conditions.push(eq(factoryWorkerAdvances.workerId, workerId));
      if (req.query.status === "outstanding") conditions.push(eq(factoryWorkerAdvances.fullyPaid, false));
      if (req.query.status === "paid") conditions.push(eq(factoryWorkerAdvances.fullyPaid, true));

      const advances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(...conditions))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      const workerIds = [...new Set(advances.map((a: any) => a.workerId))];
      let workerMap: Record<number, string> = {};
      if (workerIds.length > 0) {
        const workers = await db
          .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(inArray(factoryWorkers.id, workerIds));
        workerMap = Object.fromEntries(workers.map((w: any) => [w.id, w.fullName]));
      }

      const enriched = advances.map((a: any) => ({
        ...a,
        workerName: workerMap[a.workerId] || `Worker #${a.workerId}`,
      }));
      res.json(enriched);
    } catch (error: any) {
      logger.error("Error fetching advances:", { error: error });
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

      const advances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.workerId, workerId)))
        .orderBy(desc(factoryWorkerAdvances.advanceDate));

      res.json(advances);
    } catch (error: any) {
      logger.error("Error fetching worker advances:", { error: error });
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

      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
      if (!worker) return res.status(404).json({ message: "Worker not found" });

      const advanceDate = req.body.advanceDate || getClientDate(req);
      const cashAccountId = req.body.cashAccountId ? parseInt(req.body.cashAccountId) : null;

      if (cashAccountId) {
        const [acct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const repaymentType = req.body.repaymentType === "manual_repayment" ? "manual_repayment" : "salary_deduction";

      const result = await db.transaction(async (tx: any) => {
        const [advance] = await tx
          .insert(factoryWorkerAdvances)
          .values({
            companyId,
            workerId,
            advanceDate,
            amount: amount.toFixed(2),
            remainingBalance: amount.toFixed(2),
            cashAccountId,
            notes: req.body.notes || null,
            repaymentType,
          })
          .returning();

        let voucherId: number | null = null;

        if (cashAccountId) {
          let [advancesAccount] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));

          if (!advancesAccount) {
            const maxCodeResult = await tx
              .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
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

          const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
          const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;

          const [createdVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherNumber,
              voucherType: "Payment",
              voucherDate: advanceDate,
              description: narration,
              totalAmount: amount.toFixed(2),
              currency: "USD",
              sourceModule: "FACTORY",
            })
            .returning();

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
      logger.error("Error creating advance:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Worker Deductions CRUD ───────────────────────────────────────────────

  // GET /api/factory/worker-deductions - All deductions for company (joined with worker name)
  app.get("/api/factory/worker-deductions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseOptionalId(req.query.companyId) : getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await db
        .select({
          id: factoryWorkerDeductions.id,
          companyId: factoryWorkerDeductions.companyId,
          workerId: factoryWorkerDeductions.workerId,
          workerName: factoryWorkers.fullName,
          amount: factoryWorkerDeductions.amount,
          reason: factoryWorkerDeductions.reason,
          deductionDate: factoryWorkerDeductions.deductionDate,
          applied: factoryWorkerDeductions.applied,
          payrollId: factoryWorkerDeductions.payrollId,
          createdAt: factoryWorkerDeductions.createdAt,
        })
        .from(factoryWorkerDeductions)
        .leftJoin(factoryWorkers, eq(factoryWorkerDeductions.workerId, factoryWorkers.id))
        .where(eq(factoryWorkerDeductions.companyId, companyId))
        .orderBy(desc(factoryWorkerDeductions.createdAt));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/workers/:id/deductions
  app.get("/api/factory/workers/:id/deductions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const workerId = parseId(req.params.id);
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      const deductions = await db
        .select()
        .from(factoryWorkerDeductions)
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
      if (workerId === null) return res.status(400).json({ message: "Invalid id" });
      const { amount, reason, deductionDate } = req.body;
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!deductionDate) return res.status(400).json({ message: "Deduction date is required" });
      const [deduction] = await db
        .insert(factoryWorkerDeductions)
        .values({
          companyId,
          workerId,
          amount: parseFloat(amount).toFixed(2),
          reason: reason || null,
          deductionDate,
          applied: false,
        } as any)
        .returning();
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
      if (deductionId === null) return res.status(400).json({ message: "Invalid id" });
      const [existing] = await db
        .select()
        .from(factoryWorkerDeductions)
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
        const [acct] = await db
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.id, cashAccountId), eq(ledgerAccounts.companyId, companyId)));
        if (!acct) return res.status(400).json({ message: "Cash account not found for this company" });
      }

      const results = await db.transaction(async (tx: any) => {
        // Resolve or create the "Factory Worker Advances" ledger account once
        let advancesAccountId: number | null = null;
        if (cashAccountId) {
          let [advancesAccount] = await tx
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.name, "Factory Worker Advances")));
          if (!advancesAccount) {
            const maxCodeResult = await tx
              .select({ maxCode: sql`MAX(CAST(code AS INTEGER))` })
              .from(ledgerAccounts)
              .where(and(eq(ledgerAccounts.companyId, companyId), sql`code ~ '^\d+$'`));
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
          advancesAccountId = advancesAccount.id;
        }

        const created: any[] = [];
        for (const item of items) {
          const workerId = parseInt(item.workerId);
          const amount = parseFloat(item.amount);
          if (!workerId || !amount || amount <= 0) continue;

          const [worker] = await tx
            .select({ fullName: factoryWorkers.fullName })
            .from(factoryWorkers)
            .where(and(eq(factoryWorkers.id, workerId), eq(factoryWorkers.companyId, companyId)));
          if (!worker) continue;

          const [advance] = await tx
            .insert(factoryWorkerAdvances)
            .values({
              companyId,
              workerId,
              advanceDate: advDate,
              amount: amount.toFixed(2),
              remainingBalance: amount.toFixed(2),
              cashAccountId,
              notes: notes || null,
              repaymentType,
            })
            .returning();

          if (cashAccountId && advancesAccountId) {
            const narration = `Advance to ${worker.fullName}: $${amount.toFixed(2)}`;
            const voucherNumber = `PAYMENT-ADV-${advance.id}-${Date.now()}`;
            const [createdVoucher] = await tx
              .insert(vouchers)
              .values({
                companyId,
                voucherNumber,
                voucherType: "Payment",
                voucherDate: advDate,
                description: narration,
                totalAmount: amount.toFixed(2),
                currency: "USD",
                sourceModule: "FACTORY",
              })
              .returning();
            await tx.insert(voucherEntries).values([
              {
                voucherId: createdVoucher.id,
                ledgerAccountId: advancesAccountId,
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
            txDate: advDate,
            txType: "ADVANCE_GIVEN",
            referenceId: advance.id,
            referenceTable: "factory_worker_advances",
            description: `Advance given to ${worker.fullName}: $${amount.toFixed(2)}`,
            amountCurrency: amount,
            amountUsd: amount,
            createdBy: (req.session as any).userId ? parseInt((req.session as any).userId) : undefined,
          });

          created.push({ ...advance, workerName: worker.fullName });
        }
        return created;
      });

      res.json({ created: results.length, advances: results });
    } catch (error: any) {
      logger.error("Error creating bulk advances:", { error: error });
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

      const [updated] = await db
        .update(factoryWorkerAdvances)
        .set(updates)
        .where(and(eq(factoryWorkerAdvances.id, id), eq(factoryWorkerAdvances.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Advance not found" });
      res.json(updated);
    } catch (error: any) {
      logger.error("Error updating advance:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/advances/reconcile/preview - Dry-run reconciliation, returns what would change
  app.get("/api/factory/advances/reconcile/preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
          )
        )
        .orderBy(factoryWorkerAdvances.workerId, factoryWorkerAdvances.advanceDate);

      const allPayrolls = await db
        .select({
          workerId: factoryPayrolls.workerId,
          advances: factoryPayrolls.advances,
          periodStart: factoryPayrolls.periodStart,
        })
        .from(factoryPayrolls)
        .where(eq(factoryPayrolls.companyId, companyId))
        .orderBy(factoryPayrolls.workerId, factoryPayrolls.periodStart);

      const allRepayments = await db
        .select()
        .from(factoryAdvanceRepayments)
        .where(eq(factoryAdvanceRepayments.companyId, companyId))
        .orderBy(factoryAdvanceRepayments.advanceId, factoryAdvanceRepayments.repaymentDate);

      // Worker names
      const workerIds = [...new Set(allAdvances.map((a: any) => a.workerId))];
      let workerMap: Record<number, string> = {};
      if (workerIds.length > 0) {
        const wRows = await db
          .select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
          .from(factoryWorkers)
          .where(inArray(factoryWorkers.id, workerIds));
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
        manualRepaymentByAdvance.set(
          rep.advanceId,
          (manualRepaymentByAdvance.get(rep.advanceId) || 0) + parseFloat(rep.amount || "0")
        );
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
      logger.error("Advance reconcile preview error:", { error: e });
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/factory/advances/reconcile - Recalculate all advance remaining balances from historical payrolls
}
