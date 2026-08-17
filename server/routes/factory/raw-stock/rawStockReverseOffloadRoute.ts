import Decimal from "decimal.js";
import type { Express } from "express";
import { eq, and, or, sql, inArray, ilike, isNull } from "drizzle-orm";

import {
  factorySuppliers,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryContainerCommissions,
  voucherEntries,
  factoryDaybookEntries,
  factoryOffloadAdditionalCharges,
  vouchers,
  factoryContainerReceipts,
} from "@shared/schema";

import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { logAudit } from "../../helpers/auditHelpers";
import { logger } from "../../../lib/logger";
import { parseId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import { getErrorMessage } from "../../../lib/httpHandlers";
import {
  getAuthoritativeSupplierRemainingKg,
  getLockedSupplierRate,
} from "../../../services/factory/rawStockLockedRate";

/**
 * POST /api/factory/containers/:id/reverse-offload — undoes an offload,
 * unwinding the raw stock, its receipts, commissions, additional charges and
 * every voucher and daybook entry the offload posted.
 *
 * It is the inverse of the offload handler rather than part of it: the two
 * shared a file but no code. Registered from the same point in the same order,
 * so config/route-manifest.json is unchanged.
 */
export function registerRawStockReverseOffloadRoute(app: Express) {
  app.post("/api/factory/containers/:id/reverse-offload", requireAuth, async (req, res) => {
    try {
      // factoryCompanyId is not declared on SessionData; the cast stays until it is.
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.status !== "OFFLOADED" && container.status !== "PARTIALLY_RECEIVED") {
        return res.status(400).json({ message: "Only OFFLOADED or PARTIALLY_RECEIVED containers can be reversed" });
      }

      // Safety guard: block reversal if this container's raw stock has already been
      // consumed in a mix batch that has production usage (daily usage or pressing batches recorded).
      const mixSourceLinks = await db
        .select({ mixBatchId: factoryMixBatchSources.mixBatchId })
        .from(factoryMixBatchSources)
        .where(eq(factoryMixBatchSources.containerId, containerId));

      if (mixSourceLinks.length > 0) {
        const linkedBatchIds = [...new Set(mixSourceLinks.map((s) => s.mixBatchId))];
        const usedBatches = await db
          .select({
            id: factoryMixBatches.id,
            batchCode: factoryMixBatches.batchCode,
            usedKg: factoryMixBatches.usedKg,
          })
          .from(factoryMixBatches)
          .where(
            and(
              eq(factoryMixBatches.companyId, companyId),
              inArray(factoryMixBatches.id, linkedBatchIds),
              sql`${factoryMixBatches.usedKg}::numeric > 0`,
              // A soft-deleted batch no longer holds live production usage — its
              // consumption of this container's stock was already reversed by the
              // delete route (factoryMixBatchRoutes.ts). Without this filter, a
              // deleted batch's stale, never-reset usedKg field permanently blocks
              // reversing the offload even though nothing is actually consuming
              // the stock anymore.
              isNull(factoryMixBatches.deletedAt)
            )
          );

        if (usedBatches.length > 0) {
          const codes = usedBatches.map((b) => b.batchCode).join(", ");
          return res.status(400).json({
            message: `Cannot reverse offload: stock from this container has already been consumed in mix batch(es) ${codes}. Remove it from those batches first before reversing.`,
          });
        }
      }

      await db.transaction(async (tx) => {
        // 1. Find the raw stock entry for this container (fetch full cost fields
        //    so we can compute the supplier locked-rate correction below).
        const [rawStockRow] = await tx
          .select({
            id: factoryRawStock.id,
            receivedKg: factoryRawStock.receivedKg,
            usedKg: factoryRawStock.usedKg,
            costPerKgUsd: factoryRawStock.costPerKgUsd,
          })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

        // 2. Find commission records for this container
        const commissionRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              eq(factoryContainerCommissions.containerId, containerId)
            )
          );
        const commissionIds = commissionRows.map((r) => r.id);
        const _hadOffloadCommission = commissionRows.length > 0;

        // 3. Delete daybook entries tied to this offload:
        //    - OFFLOAD_RAW_STOCK referencing the raw stock row id
        //    - COMMISSION referencing each commission record id
        //    - FREIGHT / OTHER_CHARGE / DUTY referencing the container id
        if (rawStockRow) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
                eq(factoryDaybookEntries.referenceId, rawStockRow.id)
              )
            );
        }
        if (commissionIds.length > 0) {
          await tx
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "COMMISSION"),
                inArray(factoryDaybookEntries.referenceId, commissionIds)
              )
            );
        }
        // FREIGHT, OTHER_CHARGE, DUTY entries all reference containerId directly
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              inArray(factoryDaybookEntries.txType, ["FREIGHT", "OTHER_CHARGE", "DUTY"]),
              eq(factoryDaybookEntries.referenceId, containerId)
            )
          );

        // 4. Delete all double-entry accounting vouchers created at or after offload for this container:
        //    FACTORY-COMM-{id}-*   commission vouchers (from offload or pre-registration)
        //    FACTORY-FREIGHT-{id}-*  freight vouchers
        //    FACTORY-OC-{id}-*       other-charge and additional-charge vouchers
        //    (FACTORY-IMPORT-{id}-* and FACTORY-PAY-* are intentionally preserved)
        const containerVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              or(
                ilike(vouchers.voucherNumber, `FACTORY-COMM-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-OC-${containerId}-%`)
              )
            )
          );
        if (containerVouchers.length > 0) {
          const vIds = containerVouchers.map((v) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }

        // 4b. Correct the supplier's locked rate before removing this container's
        //     stock. The offload moving-average blended this container's cost/kg
        //     into the supplier rate; reversing the offload must undo that blend.
        //
        //     Formula:
        //       supplierRemainingKgBefore = authoritative remaining kg (includes this row)
        //       containerRemainingKg      = rawStock.receivedKg - rawStock.usedKg
        //       supplierValueBefore       = supplierRemainingKgBefore × currentLockedRate
        //       containerRemainingValue   = containerRemainingKg × rawStock.costPerKgUsd
        //       supplierRemainingKgAfter  = supplierRemainingKgBefore − containerRemainingKg
        //       newLockedRate             = (supplierValueBefore − containerRemainingValue)
        //                                    ÷ supplierRemainingKgAfter  (or 0 when denom ≤ 0)
        if (container.supplierId && rawStockRow) {
          const currentLockedRate = await getLockedSupplierRate(tx, companyId, container.supplierId, {
            forUpdate: true,
          });
          const supplierRemainingKgBefore = new Decimal(
            await getAuthoritativeSupplierRemainingKg(tx, companyId, container.supplierId)
          );
          const containerRemainingKg = new Decimal(rawStockRow.receivedKg || "0").minus(
            new Decimal(rawStockRow.usedKg || "0")
          );
          const supplierValueBefore = supplierRemainingKgBefore.times(currentLockedRate);
          const containerRemainingValue = containerRemainingKg.times(new Decimal(rawStockRow.costPerKgUsd || "0"));
          const supplierRemainingKgAfter = supplierRemainingKgBefore.minus(containerRemainingKg);
          let newLockedRate: Decimal;
          if (supplierRemainingKgAfter.lte(0)) {
            newLockedRate = new Decimal(0);
          } else {
            newLockedRate = supplierValueBefore.minus(containerRemainingValue).div(supplierRemainingKgAfter);
            // Clamp tiny floating-point negatives caused by rounding
            if (newLockedRate.lt(0)) newLockedRate = new Decimal(0);
          }
          await tx
            .update(factorySuppliers)
            .set({
              currentRawMaterialCostPerKgUsd: newLockedRate.toDecimalPlaces(8).toFixed(8),
              updatedAt: new Date(),
            })
            .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
        }

        // 4c. Soft-delete all receipt history for this container — marks every
        //     factoryContainerReceipts row as deleted so subsequent receipt queries
        //     (and the available-containers endpoint) see a clean slate. Hard-deletes
        //     of raw stock and commission follow below.
        await tx
          .update(factoryContainerReceipts)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(factoryContainerReceipts.companyId, companyId),
              eq(factoryContainerReceipts.containerId, containerId),
              isNull(factoryContainerReceipts.deletedAt)
            )
          );

        // 5. Delete offload records: raw stock, commission records, additional charges, mix-batch links
        await tx
          .delete(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
        await tx
          .delete(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.companyId, companyId),
              eq(factoryContainerCommissions.containerId, containerId)
            )
          );
        await tx
          .delete(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.companyId, companyId),
              eq(factoryOffloadAdditionalCharges.containerId, containerId)
            )
          );
        // Remove mix-batch source links created during offload for this container
        await tx.delete(factoryMixBatchSources).where(eq(factoryMixBatchSources.containerId, containerId));

        // 6. Restore pre-offload charges and reset container to RECEIVED status.
        //    If a pre-offload snapshot exists (set during offload), restore those values
        //    so that charges entered at container-creation time are preserved.
        //    If no snapshot exists (container was offloaded before this logic was added),
        //    fall back to zeroing out the charges (legacy behaviour).
        const preFreight = container.preOffloadFreight;
        const hasSnapshot = preFreight !== null && preFreight !== undefined;
        const restoredFreight = hasSnapshot ? String(preFreight || "0") : "0";
        const restoredFreightAccountId = hasSnapshot ? container.preOffloadFreightAccountId || null : null;
        const restoredFreightSupplierId = hasSnapshot ? container.preOffloadFreightSupplierId || null : null;
        const restoredFreightCurrencyCode = hasSnapshot
          ? container.preOffloadFreightCurrencyCode || container.currencyCode || "USD"
          : container.currencyCode || "USD";
        const restoredOtherCharges = hasSnapshot ? String(container.preOffloadOtherCharges || "0") : "0";
        const restoredOtherChargesAccountId = hasSnapshot ? container.preOffloadOtherChargesAccountId || null : null;
        const restoredOtherChargesSupplierId = hasSnapshot ? container.preOffloadOtherChargesSupplierId || null : null;

        // Re-post the original creation-time FACTORY-FREIGHT voucher if one existed before offload
        const restoredFreightAmt = parseFloat(restoredFreight || "0");
        if (restoredFreightAmt > 0 && restoredFreightAccountId) {
          const restoredFreightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
          const [restoredFreightVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Journal",
              voucherNumber: restoredFreightVoucherNum,
              voucherDate: container.arrivalDate || getClientDate(req),
              description: `Freight on container ${container.containerNumber}`,
              totalAmount: String(restoredFreightAmt),
              currency: restoredFreightCurrencyCode,
              // This re-posts a voucher that already existed pre-offload, using the
              // exact rate the original offload already booked its financials with —
              // it is not a new forward-going financial decision, so we reuse the
              // container's stored rate as-is rather than requiring it to be
              // "confirmed" (which would incorrectly block reversing legacy
              // containers offloaded before the fxRateConfirmed flag existed).
              exchangeRate: String(container.fxRateToUsd ?? "1"),
              sourceModule: "FACTORY",
            })
            .returning();
          // Dr Freight Expense
          await tx.insert(voucherEntries).values({
            voucherId: restoredFreightVoucher.id,
            ledgerAccountId: restoredFreightAccountId,
            debitAmount: String(restoredFreightAmt),
            creditAmount: "0",
            narration: `Freight expense - container ${container.containerNumber}`,
          });
          // Cr: supplier when pre-offload freight was supplier-paid;
          //     own account when it was own-account paid (never fall back
          //     to container.supplierId — that would silently debit the
          //     material supplier for freight they didn't owe).
          if (restoredFreightSupplierId) {
            await tx.insert(voucherEntries).values({
              voucherId: restoredFreightVoucher.id,
              factorySupplierId: restoredFreightSupplierId,
              debitAmount: "0",
              creditAmount: String(restoredFreightAmt),
              narration: `Freight payable to supplier - container ${container.containerNumber}`,
            });
          } else if (container.freightOwnAccountId) {
            await tx.insert(voucherEntries).values({
              voucherId: restoredFreightVoucher.id,
              ledgerAccountId: container.freightOwnAccountId,
              debitAmount: "0",
              creditAmount: String(restoredFreightAmt),
              narration: `Freight paid via own account - container ${container.containerNumber}`,
            });
          }
        }

        // Restore pre-offload commission snapshot (if one was saved)
        const preCommAmt = container.preOffloadCommissionAmount;
        const hasCommSnapshot = preCommAmt !== null && preCommAmt !== undefined;
        const restoredCommissionAmount = hasCommSnapshot ? String(preCommAmt || "0") : "0";
        const restoredCommissionCurrencyCode = hasCommSnapshot
          ? container.preOffloadCommissionCurrencyCode || "USD"
          : "USD";
        const restoredCommissionAccountId = hasCommSnapshot ? container.preOffloadCommissionAccountId || null : null;
        const restoredCommissionSupplierId = hasCommSnapshot ? container.preOffloadCommissionSupplierId || null : null;
        const restoredCommissionNotes = hasCommSnapshot ? container.preOffloadCommissionNotes || null : null;

        // Restore pre-offload status (fallback to "ARRIVED" for legacy containers without snapshot)
        const restoredStatus = container.preOffloadStatus || "ARRIVED";

        await tx
          .update(factoryContainers)
          .set({
            status: restoredStatus,
            actualReceivedKg: null,
            differenceKg: null,
            declaredKg: null,
            // Restore pre-offload freight (or zero if no snapshot)
            freight: restoredFreight,
            freightCurrencyCode: restoredFreightCurrencyCode,
            freightAccountId: restoredFreightAccountId,
            freightSupplierId: restoredFreightSupplierId,
            // Restore pre-offload other charges (or zero if no snapshot)
            otherCharges: restoredOtherCharges,
            otherChargesAccountId: restoredOtherChargesAccountId,
            otherChargesSupplierId: restoredOtherChargesSupplierId,
            // Restore pre-offload commission
            commissionAmount: restoredCommissionAmount,
            commissionCurrencyCode: restoredCommissionCurrencyCode,
            commissionAccountId: restoredCommissionAccountId,
            commissionSupplierId: restoredCommissionSupplierId,
            commissionNotes: restoredCommissionNotes,
            // Clear duty (always offload-specific)
            dutyAmount: null,
            dutyAccountId: null,
            dutyStatus: "NONE",
            dutyNotes: null,
            // Clear computed financials
            finalPayableAmount: null,
            finalPayableAmountUsd: null,
            ratePerKgUsd: null,
            fxRateToUsdOffload: null,
            fxRateDateOffload: null,
            // Clear the pre-offload snapshot columns
            preOffloadFreight: null,
            preOffloadFreightCurrencyCode: null,
            preOffloadFreightAccountId: null,
            preOffloadFreightSupplierId: null,
            preOffloadOtherCharges: null,
            preOffloadOtherChargesAccountId: null,
            preOffloadOtherChargesSupplierId: null,
            preOffloadStatus: null,
            preOffloadCommissionAmount: null,
            preOffloadCommissionCurrencyCode: null,
            preOffloadCommissionAccountId: null,
            preOffloadCommissionSupplierId: null,
            preOffloadCommissionNotes: null,
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));
      });

      await logAudit({
        userId: req.session.userId!,
        username: req.session.username || req.session.userId!,
        companyId,
        action: "reverse",
        tableName: "production_raw_stock",
        recordId: containerId,
        recordIdentifier: `Container #${containerId} offload reversed`,
        changes: null,
      });
      res.json({ message: "Offload reversed successfully. Container is back to its previous status." });
    } catch (error: unknown) {
      logger.error("Error reversing offload:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
