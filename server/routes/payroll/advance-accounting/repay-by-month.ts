/**
 * advanceAccountingRoutes: AdvanceRepayByMonth endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { getClientDate } from "../../../lib/dateUtils";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  factoryWorkers,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";

import { getFactoryCompanyId, writeDaybookEntry } from "./_helpers";

export function registerAdvanceRepayByMonthRoutes(app: Express) {
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
            createdBy: (req.session as any).userId ?? undefined,
          });

          repaidCount++;
          repaidTotal += bal;
        }

        return { repaid: repaidCount, total: repaidTotal };
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Error in repay-by-month:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
