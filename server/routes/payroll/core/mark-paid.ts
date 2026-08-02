/**
 * payrollCoreRoutes: PayrollMarkPaid endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { getClientDate } from "../../../lib/dateUtils";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import {
  factoryWorkers,
  factoryPayrolls,
  factoryAttendance,
  ledgerAccounts,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { findOrCreateLedger, getFactoryCompanyId, normUsd, writeDaybookEntry } from "./_helpers";

export function registerPayrollMarkPaidRoutes(app: Express) {
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
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
          referenceTable: "factory_payrolls",
          description: `Payroll paid: ${workerName} – ${parseFloat(payroll.netSalary || "0").toFixed(2)} (${payroll.periodStart} – ${payroll.periodEnd})`,
          amountCurrency: parseFloat(payroll.netSalary || "0"),
          amountUsd: parseFloat(payroll.netSalary || "0"),
        });

        return payroll;
      });

      res.json(updated);
    } catch (error: unknown) {
      if (getErrorMessage(error) === "Payroll record not found")
        return res.status(404).json({ message: getErrorMessage(error) });
      res.status(500).json({ message: getErrorMessage(error) });
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
