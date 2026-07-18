import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth, requireRole } from "../../../auth";
import {
  applyPostOffloadChargeMutation,
  type AccountingContext,
} from "../../../services/factory/postOffloadChargeMutation";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import Decimal from "decimal.js";
import { cascadeContainerCostChange } from "../../../services/factory/rawStockCostCascade";
import { computeCorrectContainerCost } from "../../../services/factory/rawStockRecalc";
import { getAuthoritativeSupplierRemainingKg } from "../../../services/factory/rawStockLockedRate";
import { resolveStoredFxRate, resolveStoredFxRateOrThrow, UnresolvedExchangeRateError } from "../../../services/factory/currencyConversion";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
} from "../_helpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
  factorySupplierCategories,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

const ADMIN_ROLES = ["Admin", "Developer"] as const;

/**
 * Resolve FX rate for a post-offload charge (create or edit).
 * Always returns fxRateConfirmed: true.
 * Rules:
 *  A) USD charge                   → fxRateToUsd = 1,   fxRateDate = txDate
 *  B) Same CCY as container        → use confirmed container offload FX
 *  C) Third currency               → fetch via getOrFetchFxRateToUsd, must be > 0
 */
async function resolvePostOffloadChargeFx(opts: {
  chargeCcy: string;
  containerCcy: string;
  containerFxRate: number;
  containerFxRateDateOffload: string | null;
  containerFxConfirmed: boolean;
  txDate: string;
  companyId: number;
}): Promise<{ fxRateToUsd: number; fxRateConfirmed: boolean; fxRateDate: string }> {
  const { chargeCcy, containerCcy, containerFxRate, containerFxRateDateOffload, containerFxConfirmed, txDate, companyId } = opts;
  if (chargeCcy === "USD") {
    return { fxRateToUsd: 1, fxRateConfirmed: true, fxRateDate: txDate };
  }
  if (chargeCcy === containerCcy) {
    if (!containerFxConfirmed) {
      throw new Error(`Container FX rate for ${containerCcy} is not confirmed. Confirm the container FX rate first.`);
    }
    return { fxRateToUsd: containerFxRate, fxRateConfirmed: true, fxRateDate: containerFxRateDateOffload || txDate };
  }
  // Third currency — fetch independently
  const fetched = await getOrFetchFxRateToUsd(companyId, chargeCcy, txDate);
  const rate = parseFloat(fetched as any);
  if (!rate || rate <= 0) {
    throw new Error(
      `Cannot resolve FX rate for charge currency ${chargeCcy} on ${txDate}. Add an FX rate for this currency first.`
    );
  }
  return { fxRateToUsd: rate, fxRateConfirmed: true, fxRateDate: txDate };
}

export function registerRawStockContainerRoutes(app: Express) {
  app.patch("/api/factory/containers/:id/confirm-duty", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const { dutyAmount, dutyNotes } = req.body;
      const userId = String((req.session as any).userId || (req.user as any)?.id || "system");

      if (!dutyAmount || parseFloat(dutyAmount) <= 0) {
        return res.status(400).json({ message: "Valid duty amount is required" });
      }

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.dutyStatus !== "PENDING") {
        return res.status(400).json({ message: "Only containers with PENDING duty can be confirmed" });
      }

      const newDutyAmount = parseFloat(dutyAmount);
      let resultCostPerKg: number | null = null;

      // ── Single atomic transaction: all reads + writes happen together ─────────
      // Locking the container FOR UPDATE prevents concurrent duty confirmations or
      // offload mutations from racing this route. All financial writes (duty fields,
      // financials, cascade, daybook) are inside one transaction — a partial failure
      // rolls everything back.
      await db.transaction(async (tx: any) => {
        // 1. Lock container FOR UPDATE — authoritative source for all reads below.
        const [lockedContainer] = await tx
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)))
          .for("update");

        if (!lockedContainer) throw Object.assign(new Error("Container not found"), { status: 404 });
        if (lockedContainer.dutyStatus !== "PENDING") {
          throw Object.assign(
            new Error("Only containers with PENDING duty can be confirmed"),
            { status: 400 }
          );
        }

        // 2. Load charges and commission inside the transaction.
        const additionalChargesRows = await tx
          .select()
          .from(factoryOffloadAdditionalCharges)
          .where(
            and(
              eq(factoryOffloadAdditionalCharges.containerId, containerId),
              eq(factoryOffloadAdditionalCharges.companyId, companyId)
            )
          );

        const commissionRows = await tx
          .select()
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.containerId, containerId),
              eq(factoryContainerCommissions.companyId, companyId)
            )
          );
        const commissionRecord = commissionRows.sort((a: any, b: any) => b.id - a.id)[0] || null;

        // 3. Build in-memory snapshot with the confirmed duty so the helper sees the
        //    correct, complete cost picture without a second round-trip.
        const containerSnapshot = {
          ...lockedContainer,
          dutyAmount: String(newDutyAmount),
          dutyStatus: "CONFIRMED" as string,
          dutyNotes: dutyNotes || lockedContainer.dutyNotes,
        };

        // 4. Compute new inclusive landed cost — pure computation, no db calls.
        const next = computeCorrectContainerCost(
          containerSnapshot as any,
          additionalChargesRows,
          commissionRecord
        );
        if (next.fxUnresolved) {
          throw Object.assign(
            new Error(new UnresolvedExchangeRateError(lockedContainer.currencyCode || "USD").message),
            { status: 400 }
          );
        }
        resultCostPerKg = next.costPerKg;

        // 5. Insert duty audit log — atomic with the update.
        await tx.insert(factoryDutyAuditLog).values({
          companyId,
          containerId,
          oldDutyAmount: lockedContainer.dutyAmount || "0",
          newDutyAmount: String(newDutyAmount),
          oldDutyStatus: lockedContainer.dutyStatus,
          newDutyStatus: "CONFIRMED",
          notes: dutyNotes || null,
          updatedByUserId: userId,
        });

        // 6. Persist confirmed duty + recalculated financials in one UPDATE.
        await tx
          .update(factoryContainers)
          .set({
            dutyAmount: String(newDutyAmount),
            dutyStatus: "CONFIRMED",
            dutyNotes: dutyNotes || lockedContainer.dutyNotes,
            finalPayableAmount: String(next.totalCost),
            ratePerKgUsd: String(next.costPerKgUsd),
            finalPayableAmountUsd: String(next.totalUsd),
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));

        // 7. Cascade the updated cost to raw stock and any still-OPEN mix batches.
        await cascadeContainerCostChange(tx, {
          companyId,
          containerId,
          newCostPerKg: next.costPerKg,
          newCostPerKgUsd: next.costPerKgUsd,
        });

        // 8. Daybook entry for the duty confirmation.
        const { fxRate } = resolveStoredFxRate(
          lockedContainer.currencyCode,
          (lockedContainer as any).fxRateToUsdOffload || lockedContainer.fxRateToUsd,
          (lockedContainer as any).fxRateConfirmed
        );
        const today = req.body.txDate || getClientDate(req);
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "DUTY",
          referenceId: containerId,
          description: `Duty confirmed for container ${lockedContainer.containerNumber}: ${newDutyAmount.toFixed(2)}`,
          currencyCode: lockedContainer.currencyCode || "USD",
          amountCurrency: newDutyAmount,
          fxRateToUsd: fxRate,
        });
      });

      res.json({ message: "Duty confirmed and costs recalculated", newCostPerKg: resultCostPerKg });
    } catch (error: any) {
      console.error("Error confirming duty:", error);
      res.status((error as any).status || 500).json({ message: error.message });
    }
  });

  // ── Post-offload charges: add duties/charges after a container has been offloaded ──
  app.post("/api/factory/containers/:id/post-offload-charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const { charges, txDate: reqTxDate } = req.body;
      if (!Array.isArray(charges) || charges.length === 0) {
        return res.status(400).json({ message: "At least one charge is required" });
      }

      const validCharges = charges.filter((c: any) => parseFloat(c.amount || "0") > 0);
      if (validCharges.length === 0) {
        return res.status(400).json({ message: "All charge amounts are zero" });
      }

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.status !== "OFFLOADED" && container.status !== "PARTIALLY_RECEIVED") {
        return res.status(400).json({ message: "Can only add post-offload charges to offloaded containers" });
      }

      const txDate = reqTxDate || getClientDate(req);
      const containerCcy = container.currencyCode || "USD";
      const { fxRate: containerFxRate, looksSet: pocFxLooksSet } = resolveStoredFxRate(
        containerCcy,
        (container as any).fxRateToUsdOffload || container.fxRateToUsd,
        (container as any).fxRateConfirmed
      );
      if (!pocFxLooksSet) {
        return res.status(400).json({ message: new UnresolvedExchangeRateError(containerCcy).message });
      }
      if (parseFloat(container.actualReceivedKg || "0") <= 0) {
        return res.status(400).json({ message: "Container has no received weight" });
      }

      // Guard: raw-stock row must exist
      const rawStockCheck = await db
        .select({ id: factoryRawStock.id })
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
      if (rawStockCheck.length === 0) {
        return res.status(400).json({
          message: "Cannot add post-offload charge because this offloaded container has no linked raw-stock record.",
        });
      }

      const userId = String((req.session as any).userId || (req.user as any)?.id || "system");

      // Resolve FX and accounting context BEFORE transaction (may call external APIs)
      const resolvedChargeInputs: Array<{
        fxRateToUsd: number;
        fxRateConfirmed: boolean;
        fxRateDate: string;
        accountingCtx: AccountingContext;
      }> = [];

      for (const charge of validCharges) {
        const chargeCcy = charge.currencyCode || "USD";
        let fxResolved: { fxRateToUsd: number; fxRateConfirmed: boolean; fxRateDate: string };
        try {
          fxResolved = await resolvePostOffloadChargeFx({
            chargeCcy,
            containerCcy,
            containerFxRate,
            containerFxRateDateOffload: (container as any).fxRateDateOffload || null,
            containerFxConfirmed: !!(container as any).fxRateConfirmed,
            txDate,
            companyId,
          });
        } catch (e: any) {
          return res.status(400).json({ message: e.message });
        }

        let acctCtx: AccountingContext = { voucherCompanyId: companyId, chargesPayableAcctId: 0 };
        if (charge.ledgerAccountId) {
          const lid = parseInt(charge.ledgerAccountId);
          const [acctRow] = await db
            .select({ companyId: ledgerAccounts.companyId })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, lid));
          const voucherCompanyId = acctRow?.companyId ?? companyId;
          const cpAcctId = await getOrCreateLedgerAccount(
            voucherCompanyId,
            "FACTORY_CHARGES_PAYABLE",
            "Factory Charges Payable"
          );
          acctCtx = { voucherCompanyId, chargesPayableAcctId: cpAcctId };
        } else if (charge.supplierId) {
          const cpAcctId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
          acctCtx = { voucherCompanyId: companyId, chargesPayableAcctId: cpAcctId };
        }

        resolvedChargeInputs.push({ ...fxResolved, accountingCtx: acctCtx });
      }

      const oldContainerCostPerKgUsd = parseFloat((container as any).ratePerKgUsd || "0");
      const oldContainerTotalUsd = parseFloat((container as any).finalPayableAmountUsd || "0");

      let lastResult: any = null;
      let allCascadeResults: any[] = [];

      await db.transaction(async (tx) => {
        for (let i = 0; i < validCharges.length; i++) {
          const charge = validCharges[i];
          const { fxRateToUsd, fxRateConfirmed, fxRateDate, accountingCtx } = resolvedChargeInputs[i];

          const mutResult = await applyPostOffloadChargeMutation(tx, {
            action: "CREATE",
            companyId,
            containerId,
            txDate,
            userId,
            chargeData: {
              description: charge.description || "Post-offload charge",
              amount: parseFloat(charge.amount),
              currencyCode: charge.currencyCode || "USD",
              fxRateToUsd,
              fxRateConfirmed,
              fxRateDate,
              ledgerAccountId: charge.ledgerAccountId ? parseInt(charge.ledgerAccountId) : null,
              supplierId: charge.supplierId ? parseInt(charge.supplierId) : null,
            },
            accountingCtx,
          });

          lastResult = mutResult;
          if (mutResult.cascadeResult) allCascadeResults.push(mutResult.cascadeResult);
        }
      });

      const cascadeResult = allCascadeResults[allCascadeResults.length - 1] || null;
      const r = lastResult!;

      // Fetch updated raw-stock row for response
      const [newRawStock] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      res.json({
        message: "Post-offload charges added and costs recalculated",
        containerId,
        oldContainerCostPerKgUsd,
        newContainerCostPerKgUsd: r.newContainerCostPerKgUsd,
        oldContainerTotalUsd,
        newContainerTotalUsd: parseFloat(String((await db.select({ v: factoryContainers.finalPayableAmountUsd }).from(factoryContainers).where(eq(factoryContainers.id, containerId)))[0]?.v || "0")),
        rawStockRowsUpdated: cascadeResult?.rawStockRowsUpdated ?? 0,
        supplierLockedRateOld: r.supplierLockedRateBefore ? parseFloat(r.supplierLockedRateBefore) : null,
        supplierLockedRateNew: r.supplierLockedRateAfter ? parseFloat(r.supplierLockedRateAfter) : null,
        supplierRemainingKg: r.supplierRemainingKg,
        containerReceivedKg: r.containerReceivedKg,
        containerRemainingKg: r.containerRemainingKg,
        remainingFraction: parseFloat(r.remainingFraction),
        fullContainerValueDeltaUsd: r.fullContainerValueDeltaUsd,
        supplierInventoryValueDeltaUsd: r.supplierInventoryValueDeltaUsd,
        supplierValueBeforeUsd: r.supplierValueBeforeUsd,
        supplierValueAfterUsd: r.supplierValueAfterUsd,
        supplierLockedRateOldExact: r.supplierLockedRateBefore,
        supplierLockedRateNewExact: r.supplierLockedRateAfter,
        rawStockRateWasStale: false,
        affectedBatches: (cascadeResult?.affectedBatches ?? []).map((b: any) => ({
          batchId: b.batchId,
          batchCode: b.batchCode,
          status: b.status ?? null,
          wasCompleted: b.wasCompleted,
          weightKgFromContainer: b.weightKgFromContainer,
          oldCostPerKg: b.oldCostPerKg,
          newCostPerKg: b.newCostPerKg,
        })),
        affectedBalesCount: cascadeResult?.affectedBales?.length ?? 0,
        rawStock: newRawStock,
      });
    } catch (error: any) {
      console.error("Error adding post-offload charges:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── GET /api/factory/containers/:id/post-offload-charges ─────────────────────
  // Returns charge history (active + undone) for a container, newest first.
  app.get("/api/factory/containers/:id/post-offload-charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const rows = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        )
        .orderBy(desc(factoryOffloadAdditionalCharges.createdAt));

      res.json(rows);
    } catch (error: any) {
      console.error("Error fetching post-offload charge history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── PATCH /api/factory/containers/:id/post-offload-charges/:chargeId ─────────
  // Edit an existing charge in-place. Admin only.
  app.patch(
    "/api/factory/containers/:id/post-offload-charges/:chargeId",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const containerId = parseId(req.params.id);
        const chargeId = parseId(req.params.chargeId);
        if (containerId === null || chargeId === null) return res.status(400).json({ message: "Invalid id" });

        const {
          description,
          amount,
          currencyCode,
          ledgerAccountId,
          supplierId,
          txDate: reqTxDate,
          expectedVersion,
          legacyBaselineRate,
        } = req.body;

        if (!amount || parseFloat(amount) <= 0) {
          return res.status(400).json({ message: "amount must be > 0" });
        }

        const [container] = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
        if (!container) return res.status(404).json({ message: "Container not found" });

        const txDate = reqTxDate || getClientDate(req);
        const containerCcy = container.currencyCode || "USD";
        const chargeCcy = currencyCode || "USD";
        const { fxRate: containerFxRate, looksSet: pocFxLooksSet } = resolveStoredFxRate(
          containerCcy,
          (container as any).fxRateToUsdOffload || container.fxRateToUsd,
          (container as any).fxRateConfirmed
        );
        if (!pocFxLooksSet) {
          return res.status(400).json({ message: new UnresolvedExchangeRateError(containerCcy).message });
        }

        // Resolve FX + accounting context before transaction
        let fxResolved: { fxRateToUsd: number; fxRateConfirmed: boolean; fxRateDate: string };
        try {
          fxResolved = await resolvePostOffloadChargeFx({
            chargeCcy,
            containerCcy,
            containerFxRate,
            containerFxRateDateOffload: (container as any).fxRateDateOffload || null,
            containerFxConfirmed: !!(container as any).fxRateConfirmed,
            txDate,
            companyId,
          });
        } catch (e: any) {
          return res.status(400).json({ message: e.message });
        }

        let acctCtx: AccountingContext = { voucherCompanyId: companyId, chargesPayableAcctId: 0 };
        if (ledgerAccountId) {
          const lid = parseInt(ledgerAccountId);
          const [acctRow] = await db
            .select({ companyId: ledgerAccounts.companyId })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, lid));
          const voucherCompanyId = acctRow?.companyId ?? companyId;
          const cpAcctId = await getOrCreateLedgerAccount(
            voucherCompanyId,
            "FACTORY_CHARGES_PAYABLE",
            "Factory Charges Payable"
          );
          acctCtx = { voucherCompanyId, chargesPayableAcctId: cpAcctId };
        } else if (supplierId) {
          const cpAcctId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
          acctCtx = { voucherCompanyId: companyId, chargesPayableAcctId: cpAcctId };
        }

        const userId = String((req.session as any).userId || (req.user as any)?.id || "system");
        let mutResult: any;

        try {
          await db.transaction(async (tx) => {
            mutResult = await applyPostOffloadChargeMutation(tx, {
              action: "EDIT",
              companyId,
              containerId,
              chargeId,
              txDate,
              userId,
              expectedVersion: expectedVersion !== undefined ? parseInt(expectedVersion) : undefined,
              legacyBaselineRate: legacyBaselineRate !== undefined ? parseFloat(legacyBaselineRate) : undefined,
              chargeData: {
                description: description || "Post-offload charge",
                amount: parseFloat(amount),
                currencyCode: chargeCcy,
                fxRateToUsd: fxResolved.fxRateToUsd,
                fxRateConfirmed: fxResolved.fxRateConfirmed,
                fxRateDate: fxResolved.fxRateDate,
                ledgerAccountId: ledgerAccountId ? parseInt(ledgerAccountId) : null,
                supplierId: supplierId ? parseInt(supplierId) : null,
              },
              accountingCtx: acctCtx,
            });
          });
        } catch (err: any) {
          if (err.status === 409) return res.status(409).json({ message: err.message });
          throw err;
        }

        res.json({
          message: "Post-offload charge updated",
          ...mutResult,
          supplierLockedRateOldExact: mutResult.supplierLockedRateBefore,
          supplierLockedRateNewExact: mutResult.supplierLockedRateAfter,
          affectedBatches: (mutResult.cascadeResult?.affectedBatches ?? []).map((b: any) => ({
            batchId: b.batchId,
            batchCode: b.batchCode,
            status: b.status ?? null,
            wasCompleted: b.wasCompleted,
            weightKgFromContainer: b.weightKgFromContainer,
            oldCostPerKg: b.oldCostPerKg,
            newCostPerKg: b.newCostPerKg,
          })),
          affectedBalesCount: mutResult.cascadeResult?.affectedBales?.length ?? 0,
          rawStockRowsUpdated: mutResult.cascadeResult?.rawStockRowsUpdated ?? 0,
        });
      } catch (error: any) {
        console.error("Error editing post-offload charge:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ── DELETE /api/factory/containers/:id/post-offload-charges/:chargeId ────────
  // Undo (soft-delete) a charge and reverse accounting. Admin only.
  app.delete(
    "/api/factory/containers/:id/post-offload-charges/:chargeId",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const containerId = parseId(req.params.id);
        const chargeId = parseId(req.params.chargeId);
        if (containerId === null || chargeId === null) return res.status(400).json({ message: "Invalid id" });

        const { expectedVersion, undoDate, legacyBaselineRate } = req.body || {};

        const [container] = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
        if (!container) return res.status(404).json({ message: "Container not found" });

        const txDate = undoDate || getClientDate(req);
        const userId = String((req.session as any).userId || (req.user as any)?.id || "system");
        let mutResult: any;

        try {
          await db.transaction(async (tx) => {
            mutResult = await applyPostOffloadChargeMutation(tx, {
              action: "UNDO",
              companyId,
              containerId,
              chargeId,
              txDate,
              userId,
              expectedVersion: expectedVersion !== undefined ? parseInt(expectedVersion) : undefined,
              legacyBaselineRate: legacyBaselineRate !== undefined ? parseFloat(legacyBaselineRate) : undefined,
            });
          });
        } catch (err: any) {
          if (err.status === 409) return res.status(409).json({ message: err.message });
          throw err;
        }

        if (mutResult.alreadyUndone) {
          return res.json({ message: "Charge was already undone", alreadyUndone: true, chargeId });
        }

        res.json({
          message: "Post-offload charge undone and accounting reversed",
          ...mutResult,
          supplierLockedRateOldExact: mutResult.supplierLockedRateBefore,
          supplierLockedRateNewExact: mutResult.supplierLockedRateAfter,
          affectedBatches: (mutResult.cascadeResult?.affectedBatches ?? []).map((b: any) => ({
            batchId: b.batchId,
            batchCode: b.batchCode,
            status: b.status ?? null,
            wasCompleted: b.wasCompleted,
            weightKgFromContainer: b.weightKgFromContainer,
            oldCostPerKg: b.oldCostPerKg,
            newCostPerKg: b.newCostPerKg,
          })),
          affectedBalesCount: mutResult.cascadeResult?.affectedBales?.length ?? 0,
          rawStockRowsUpdated: mutResult.cascadeResult?.rawStockRowsUpdated ?? 0,
        });
      } catch (error: any) {
        console.error("Error undoing post-offload charge:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  // ── PATCH /api/factory/containers/:id/post-offload-charges/:chargeId/legacy-rebuild
  // Rebuild supplier rate for a legacy charge (supplierLockedRateBefore IS NULL). Admin only.
  app.patch(
    "/api/factory/containers/:id/post-offload-charges/:chargeId/legacy-rebuild",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const containerId = parseId(req.params.id);
        const chargeId = parseId(req.params.chargeId);
        if (containerId === null || chargeId === null) return res.status(400).json({ message: "Invalid id" });

        const { legacyBaselineRate, expectedVersion } = req.body || {};
        if (!legacyBaselineRate || parseFloat(legacyBaselineRate) <= 0) {
          return res.status(400).json({ message: "legacyBaselineRate is required and must be > 0" });
        }

        const [container] = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
        if (!container) return res.status(404).json({ message: "Container not found" });

        const userId = String((req.session as any).userId || (req.user as any)?.id || "system");
        let mutResult: any;

        try {
          await db.transaction(async (tx) => {
            mutResult = await applyPostOffloadChargeMutation(tx, {
              action: "LEGACY_REBUILD",
              companyId,
              containerId,
              chargeId,
              txDate: getClientDate(req),
              userId,
              legacyBaselineRate: parseFloat(legacyBaselineRate),
              expectedVersion: expectedVersion !== undefined ? parseInt(expectedVersion) : undefined,
            });
          });
        } catch (err: any) {
          if (err.status === 409) return res.status(409).json({ message: err.message });
          throw err;
        }

        res.json({
          message: "Legacy charge supplier rate rebuilt successfully",
          ...mutResult,
          supplierLockedRateOldExact: mutResult.supplierLockedRateBefore,
          supplierLockedRateNewExact: mutResult.supplierLockedRateAfter,
        });
      } catch (error: any) {
        console.error("Error rebuilding legacy post-offload charge:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );

  app.get("/api/factory/containers/:id/duty-audit-log", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.id);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const logs = await db
        .select()
        .from(factoryDutyAuditLog)
        .where(and(eq(factoryDutyAuditLog.companyId, companyId), eq(factoryDutyAuditLog.containerId, containerId)))
        .orderBy(desc(factoryDutyAuditLog.createdAt));

      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching duty audit log:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/container-commissions/:containerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseId(req.params.containerId);

      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      const results = await db
        .select()
        .from(factoryContainerCommissions)
        .where(
          and(
            eq(factoryContainerCommissions.companyId, companyId),
            eq(factoryContainerCommissions.containerId, containerId)
          )
        );

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
