/**
 * factoryPayrollRoutes: FactoryPayrollUpdate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { logAudit } from "../helpers/auditHelpers";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import { checkFactoryAdmin } from "../factory/_helpers";
import { eq, and, sql, inArray } from "drizzle-orm";
import { rebuildPayrollGenVoucher } from "../payroll/_payrollAccountingHelper";
import {
  factoryPayrolls,
  factoryDaybookEntries,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  vouchers,
  voucherEntries,
} from "@shared/schema";

import { writeDaybookEntry } from "./_helpers";

export function registerFactoryPayrollUpdateRoutes(app: Express, requireAuth: any, db: any) {
  app.patch("/api/factory/payroll/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const {
        bonuses,
        deductions,
        advances,
        overtimeHours,
        overtimePay,
        notes,
        status,
        paymentSource,
        paymentDate,
        paymentReference,
        effectiveDate,
      } = req.body;

      const [existing] = await db.select().from(factoryPayrolls).where(eq(factoryPayrolls.id, id));

      if (!existing) {
        return res.status(404).json({ message: "Payroll record not found" });
      }

      const updatedBonuses = bonuses !== undefined ? parseFloat(bonuses) : parseFloat(existing.bonuses || "0");
      const updatedDeductions =
        deductions !== undefined ? parseFloat(deductions) : parseFloat(existing.deductions || "0");
      const updatedAdvances = advances !== undefined ? parseFloat(advances) : parseFloat(existing.advances || "0");
      const updatedOvertimeHours =
        overtimeHours !== undefined ? parseFloat(overtimeHours) : parseFloat(existing.overtimeHours || "0");
      const updatedOvertimePay =
        overtimePay !== undefined ? parseFloat(overtimePay) : parseFloat(existing.overtimePay || "0");

      const base = parseFloat(existing.baseSalary || "0");
      const baleEarn = parseFloat(existing.baleEarnings || "0");
      const kgEarn = parseFloat(existing.kgEarnings || "0");
      const netSalary =
        base + baleEarn + kgEarn + updatedOvertimePay + updatedBonuses - updatedDeductions - updatedAdvances;

      const updateData: any = {
        bonuses: String(updatedBonuses.toFixed(2)),
        deductions: String(updatedDeductions.toFixed(2)),
        advances: String(updatedAdvances.toFixed(2)),
        overtimeHours: String(updatedOvertimeHours.toFixed(2)),
        overtimePay: String(updatedOvertimePay.toFixed(2)),
        netSalary: String(netSalary.toFixed(2)),
      };

      if (notes !== undefined) updateData.notes = notes;
      if (status !== undefined) updateData.status = status;

      if (status === "APPROVED") {
        updateData.approvedAt = new Date();
      }

      const [updated] = await db.update(factoryPayrolls).set(updateData).where(eq(factoryPayrolls.id, id)).returning();

      if (status && status !== existing.status) {
        const entryDate = status === "PAID" && paymentDate ? paymentDate : getClientDate(req);

        if (status === "PAID") {
          const source = paymentSource || "Cash";
          const ref = paymentReference ? ` | Ref: ${paymentReference}` : "";
          await writeDaybookEntry(db, {
            companyId: existing.companyId,
            txDate: entryDate,
            txType: "PAYROLL_PAYMENT",
            referenceId: id,
            referenceTable: "factory_payrolls",
            description: `Payroll payment via ${source}${ref} — Payroll #${id}`,
            amountCurrency: netSalary,
            amountUsd: netSalary,
            metaJson: JSON.stringify({ paymentSource: source, paymentReference: paymentReference || null }),
            effectiveDate: (effectiveDate as string) || null,
          });
        } else {
          await writeDaybookEntry(db, {
            companyId: existing.companyId,
            txDate: entryDate,
            txType: "PAYROLL_STATUS_CHANGE",
            referenceId: id,
            referenceTable: "factory_payrolls",
            description: `Payroll #${id} status changed from ${existing.status} to ${status}`,
            amountCurrency: netSalary,
            amountUsd: netSalary,
          });
        }
      }

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId: existing.companyId,
          action: "update",
          tableName: "factory_payrolls",
          recordId: id,
          recordIdentifier: `Payroll #${id} (Worker #${existing.workerId})`,
          changes: {
            ...(bonuses !== undefined
              ? { bonuses: { old: existing.bonuses ?? null, new: String(updatedBonuses.toFixed(2)) } }
              : {}),
            ...(deductions !== undefined
              ? { deductions: { old: existing.deductions ?? null, new: String(updatedDeductions.toFixed(2)) } }
              : {}),
            ...(status !== undefined && status !== existing.status
              ? { status: { old: existing.status, new: status } }
              : {}),
            ...(notes !== undefined ? { notes: { old: existing.notes ?? null, new: notes } } : {}),
          },
        });
      } catch (auditErr) {
        logger.error("[payroll update audit] non-fatal:", { error: auditErr });
      }

      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error updating payroll:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/payroll/:id/undo", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = req.query.companyId
        ? parseOptionalId(req.query.companyId)
        : (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [existing] = await db
        .select()
        .from(factoryPayrolls)
        .where(and(eq(factoryPayrolls.id, id), eq(factoryPayrolls.companyId, companyId)));

      if (!existing) return res.status(404).json({ message: "Payroll record not found" });

      await db.transaction(async (tx: any) => {
        // 1. Reverse repayments tied to this payroll -> restore advance balances
        const advDeducted = parseFloat(existing.advances || "0");
        if (advDeducted > 0) {
          const repayments = await tx
            .select()
            .from(factoryAdvanceRepayments)
            .where(
              and(
                eq(factoryAdvanceRepayments.companyId, companyId),
                eq(factoryAdvanceRepayments.workerId, existing.workerId),
                eq(factoryAdvanceRepayments.payrollId, id)
              )
            );
          for (const rep of repayments) {
            const [adv] = await tx
              .select()
              .from(factoryWorkerAdvances)
              .where(eq(factoryWorkerAdvances.id, rep.advanceId));
            if (!adv) continue;
            const curr = parseFloat(adv.remainingBalance || "0");
            const repAmt = parseFloat(rep.amount || "0");
            const newBal = curr + repAmt;
            await tx
              .update(factoryWorkerAdvances)
              .set({
                remainingBalance: newBal.toFixed(2),
                fullyPaid: false,
              })
              .where(eq(factoryWorkerAdvances.id, adv.id));
          }
          await tx.delete(factoryAdvanceRepayments).where(eq(factoryAdvanceRepayments.payrollId, id));
        }

        // 2. Delete all accounting/daybook entries linked to this payroll
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.referenceId, id),
              eq(factoryDaybookEntries.referenceTable, "factory_payrolls")
            )
          );

        // 2b. Delete the mark-paid voucher (PAYMENT-PAY-{id}-*) and its entries.
        // These are created by the mark-paid endpoint: DR Payroll Payable / CR Cash.
        // Only the payment voucher is reversed here; the generate-time expense voucher
        // (PAYROLL-GEN-*) is a batch voucher shared across workers and is intentionally
        // kept since we only revert to DRAFT (not delete the payroll entirely).
        const paymentVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${"PAYMENT-PAY-" + id + "-%"}`)
          );
        if (paymentVouchers.length > 0) {
          const vIds = paymentVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }

        // 3. If PAID → revert to DRAFT. If DRAFT → delete entirely.
        if (existing.status === "PAID") {
          await tx
            .update(factoryPayrolls)
            .set({
              status: "DRAFT",
              paidAt: null,
              paymentSource: null,
              paymentReference: null,
              approvedAt: null,
            })
            .where(eq(factoryPayrolls.id, id));
          // Rebuild the PAYROLL-GEN expense voucher so any duplicates are collapsed into
          // one clean voucher that still reflects this (now-DRAFT) payroll.
          await rebuildPayrollGenVoucher(tx, companyId, existing.periodStart, existing.periodEnd);
        } else {
          // DRAFT → deleting entirely: remove / rebuild the PAYROLL-GEN expense voucher
          // so the expense account reflects only the payrolls that still exist.
          await rebuildPayrollGenVoucher(tx, companyId, existing.periodStart, existing.periodEnd, id);
          await tx.delete(factoryPayrolls).where(eq(factoryPayrolls.id, id));
        }
      });

      res.json({ message: "Payroll undone successfully", previousStatus: existing.status });
    } catch (error: unknown) {
      logger.error("Error undoing payroll:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
