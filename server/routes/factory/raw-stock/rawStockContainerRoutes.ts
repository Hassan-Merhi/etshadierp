import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import { cascadeContainerCostChange } from "../../../services/factory/rawStockCostCascade";
import { computeCorrectContainerCost } from "../../../services/factory/rawStockRecalc";
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

      const oldDutyAmount = container.dutyAmount;
      const newDutyAmount = parseFloat(dutyAmount);

      await db.insert(factoryDutyAuditLog).values({
        companyId,
        containerId,
        oldDutyAmount: oldDutyAmount || "0",
        newDutyAmount: String(newDutyAmount),
        oldDutyStatus: container.dutyStatus,
        newDutyStatus: "CONFIRMED",
        notes: dutyNotes || null,
        updatedByUserId: userId,
      });

      // 1. Persist the confirmed duty fields only. The shared landed-cost helper
      //    will compute the full inclusive cost using all charges + this duty.
      await db
        .update(factoryContainers)
        .set({
          dutyAmount: String(newDutyAmount),
          dutyStatus: "CONFIRMED",
          dutyNotes: dutyNotes || container.dutyNotes,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      // 2. Load the updated container (now with dutyStatus=CONFIRMED) and its
      //    charges so the shared helper reads the correct, complete cost picture.
      const [updatedContainer] = await db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.id, containerId));

      const additionalChargesRows = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        );

      const commissionRows = await db
        .select()
        .from(factoryContainerCommissions)
        .where(
          and(
            eq(factoryContainerCommissions.containerId, containerId),
            eq(factoryContainerCommissions.companyId, companyId)
          )
        );
      const commissionRecord = commissionRows.sort((a: any, b: any) => b.id - a.id)[0] || null;

      // 3. Use the single authoritative landed-cost helper — same formula as the
      //    offload route, post-offload-charges route, and the recalc tool. Avoids
      //    a stale/simplified inline duplicate that can drift.
      const next = computeCorrectContainerCost(updatedContainer, additionalChargesRows, commissionRecord);
      if (next.fxUnresolved) {
        return res.status(400).json({
          message: new UnresolvedExchangeRateError(container.currencyCode || "USD").message,
        });
      }

      // 4. Persist the recalculated financials.
      await db
        .update(factoryContainers)
        .set({
          finalPayableAmount: String(next.totalCost),
          ratePerKgUsd: String(next.costPerKgUsd),
          finalPayableAmountUsd: String(next.totalUsd),
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      // 5. Propagate the updated cost to raw stock and to any still-OPEN mix batch
      //    sources/batches/bales that drew from this container, via the same shared,
      //    tested cascade used by the post-offload-charges route — this guarantees
      //    CLOSED/COMPLETED batches (and their pressed bales) are never rewritten and
      //    the supplier's locked rate is nudged consistently rather than duplicated
      //    inline logic drifting from that behavior.
      await db.transaction(async (tx: any) => {
        await cascadeContainerCostChange(tx, {
          companyId,
          containerId,
          newCostPerKg: next.costPerKg,
          newCostPerKgUsd: next.costPerKgUsd,
        });
      });

      const { fxRate } = resolveStoredFxRate(
        container.currencyCode,
        (updatedContainer as any).fxRateToUsdOffload || updatedContainer.fxRateToUsd,
        (updatedContainer as any).fxRateConfirmed
      );
      const today = req.body.txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "DUTY",
        referenceId: containerId,
        description: `Duty confirmed for container ${container.containerNumber}: ${newDutyAmount.toFixed(2)}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: newDutyAmount,
        fxRateToUsd: fxRate,
      });

      res.json({ message: "Duty confirmed and costs recalculated", newCostPerKg: next.costPerKg });
    } catch (error: any) {
      console.error("Error confirming duty:", error);
      res.status(500).json({ message: error.message });
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
      // Use offload-time FX rate — same source as computeCorrectContainerCost uses.
      const { fxRate, looksSet: pocFxLooksSet } = resolveStoredFxRate(
        containerCcy,
        (container as any).fxRateToUsdOffload || container.fxRateToUsd,
        (container as any).fxRateConfirmed
      );
      if (!pocFxLooksSet) {
        return res.status(400).json({ message: new UnresolvedExchangeRateError(containerCcy).message });
      }
      const actualKg = parseFloat(container.actualReceivedKg || "0");
      if (actualKg <= 0) return res.status(400).json({ message: "Container has no received weight" });

      // Guard: raw-stock row must exist — the cascade needs it to compute value deltas.
      const rawStockCheck = await db
        .select({ id: factoryRawStock.id })
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
      if (rawStockCheck.length === 0) {
        return res.status(400).json({
          message:
            "Cannot add post-offload charge because this offloaded container has no linked raw-stock record.",
        });
      }

      // Pre-compute per-charge voucher context — getOrCreateLedgerAccount uses the
      // raw db connection and MUST NOT run inside a transaction.
      type ChargeCtx = { voucherCompanyId: number; chargesPayableAcctId: number };
      const chargeCtxs: ChargeCtx[] = [];
      for (const charge of validCharges) {
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
          console.log(
            `[POC diag] chargeDesc="${charge.description}" ledgerAccountId=${lid} acctCompanyId=${acctRow?.companyId ?? "NOT FOUND"} voucherCompanyId=${voucherCompanyId} chargesPayableAcctId=${cpAcctId} container=${container.containerNumber}`
          );
          chargeCtxs.push({ voucherCompanyId, chargesPayableAcctId: cpAcctId });
        } else if (charge.supplierId) {
          const cpAcctId = await getOrCreateLedgerAccount(
            companyId,
            "FACTORY_CHARGES_PAYABLE",
            "Factory Charges Payable"
          );
          chargeCtxs.push({ voucherCompanyId: companyId, chargesPayableAcctId: cpAcctId });
        } else {
          chargeCtxs.push({ voucherCompanyId: companyId, chargesPayableAcctId: 0 });
        }
      }

      // Fetch existing additional charges for inclusion in cost recalculation
      const existingCharges = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        );

      // Resolve FX for each new charge BEFORE the transaction (may hit external API).
      // Rules: USD → 1, same CCY as container → container offload rate, other → fetch.
      const resolvedChargeFxRates: number[] = [];
      for (const charge of validCharges) {
        const chargeCcy = charge.currencyCode || "USD";
        let chargeFx: number;
        if (chargeCcy === "USD") {
          chargeFx = 1;
        } else if (chargeCcy === containerCcy) {
          chargeFx = fxRate;
        } else {
          const fetched = await getOrFetchFxRateToUsd(companyId, chargeCcy, txDate);
          const fetchedNum = parseFloat(fetched as any);
          if (!fetchedNum || fetchedNum <= 0) {
            return res.status(400).json({
              message: `Cannot resolve FX rate for charge currency ${chargeCcy} on ${txDate}. Add an FX rate for this currency first.`,
            });
          }
          chargeFx = fetchedNum;
        }
        resolvedChargeFxRates.push(chargeFx);
      }

      const oldContainerCostPerKgUsd = parseFloat((container as any).ratePerKgUsd || "0");
      const oldContainerTotalUsd = parseFloat((container as any).finalPayableAmountUsd || "0");
      let newContainerCostPerKgUsd = 0;
      let newContainerTotalUsd = 0;
      let newRawStock: any;
      let cascadeResult: any;
      let supplierLockedRateOld: number | null = null;
      let supplierLockedRateNew: number | null = null;

      await db.transaction(async (tx) => {
        // 1. Insert new charge rows with correctly resolved FX rates
        const insertedCharges: any[] = [];
        for (let i = 0; i < validCharges.length; i++) {
          const charge = validCharges[i];
          const chargeCcy = charge.currencyCode || "USD";
          const chargeFx = resolvedChargeFxRates[i];
          const [inserted] = await tx
            .insert(factoryOffloadAdditionalCharges)
            .values({
              companyId,
              containerId,
              description: charge.description || "Post-offload charge",
              amount: String(parseFloat(charge.amount)),
              currencyCode: chargeCcy,
              fxRateToUsd: String(chargeFx),
              ledgerAccountId: charge.ledgerAccountId ? parseInt(charge.ledgerAccountId) : null,
              supplierId: charge.supplierId ? parseInt(charge.supplierId) : null,
            })
            .returning();
          insertedCharges.push(inserted);
        }

        // 2. Load commission record (authoritative source for commission cost/currency)
        const commissionRecords = await tx
          .select()
          .from(factoryContainerCommissions)
          .where(
            and(
              eq(factoryContainerCommissions.containerId, containerId),
              eq(factoryContainerCommissions.companyId, companyId)
            )
          );
        const commissionRecord = commissionRecords.sort((a: any, b: any) => b.id - a.id)[0] || null;

        // 3. Use the single authoritative landed-cost calculator — avoids duplicating
        //    the formula and ensures identical results with the recalc tool.
        const allCharges = [...existingCharges, ...insertedCharges];
        const next = computeCorrectContainerCost(container, allCharges, commissionRecord);
        if (next.fxUnresolved) {
          throw new Error(`FX rate is unresolved for container ${container.containerNumber}`);
        }
        newContainerCostPerKgUsd = next.costPerKgUsd;
        newContainerTotalUsd = next.totalUsd;

        // 4. Update container landed totals (never touches ratePerKg — the purchase rate)
        await tx
          .update(factoryContainers)
          .set({
            finalPayableAmount: String(next.totalCost),
            ratePerKgUsd: String(next.costPerKgUsd),
            finalPayableAmountUsd: String(next.totalUsd),
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));

        // Capture supplier locked rate BEFORE cascade so we can report old vs. new
        if (container.supplierId) {
          const [supBefore] = await tx
            .select({ rate: factorySuppliers.currentRawMaterialCostPerKgUsd })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
          supplierLockedRateOld = supBefore ? parseFloat(supBefore.rate || "0") : null;
        }

        // 5. Cascade: raw-stock update → supplier locked-rate adjustment →
        //    mix-batch source corrections → batch weighted-average recompute → bale updates.
        //    IMPORTANT: do NOT update raw-stock before calling this — the cascade reads
        //    the current (old) cost first to compute the supplier-rate value delta.
        //    includeCompletedBatches: true because post-offload charges are explicitly retroactive.
        cascadeResult = await cascadeContainerCostChange(
          tx,
          {
            companyId,
            containerId,
            newCostPerKg: next.costPerKg,
            newCostPerKgUsd: next.costPerKgUsd,
          },
          { includeCompletedBatches: true }
        );

        // Capture supplier locked rate AFTER cascade
        if (container.supplierId) {
          const [supAfter] = await tx
            .select({ rate: factorySuppliers.currentRawMaterialCostPerKgUsd })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
          supplierLockedRateNew = supAfter ? parseFloat(supAfter.rate || "0") : null;
        }

        // Expose updated raw-stock row for response
        const freshRawStockRows = await tx
          .select()
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
        if (freshRawStockRows.length > 0) {
          newRawStock = freshRawStockRows[0];
        }

        // 6. Daybook entries + vouchers for each new charge (accounting is unchanged)
        for (let ci = 0; ci < insertedCharges.length; ci++) {
          const charge = insertedCharges[ci];
          const chargeAmt = parseFloat(charge.amount || "0");
          if (chargeAmt <= 0) continue;
          const chargeCcy = charge.currencyCode || "USD";
          const chargeFx = resolveStoredFxRateOrThrow(chargeCcy, charge.fxRateToUsd, (charge as any).fxRateConfirmed);
          await writeDaybookEntry(tx, {
            companyId,
            txDate,
            txType: "OTHER_CHARGE",
            referenceId: containerId,
            description: `${charge.description} (post-offload) — container ${container.containerNumber}`,
            currencyCode: chargeCcy,
            amountCurrency: chargeAmt,
            fxRateToUsd: chargeFx,
            metaJson: JSON.stringify({ containerId, sourceType: "POST_OFFLOAD_ADDITIONAL", chargeId: charge.id }),
          });
          if (charge.ledgerAccountId || charge.supplierId) {
            const { voucherCompanyId, chargesPayableAcctId: voucherChargesPayableAcctId } = chargeCtxs[ci];
            const voucherNum = `FACTORY-POC-${containerId}-${charge.id}-${Date.now()}`;
            console.log(
              `[POC diag] inserting voucher chargeId=${charge.id} voucherCompanyId=${voucherCompanyId} chargesPayableAcctId=${voucherChargesPayableAcctId} container=${container.containerNumber}`
            );
            const [voucher] = await tx
              .insert(vouchers)
              .values({
                companyId: voucherCompanyId,
                voucherType: "Journal",
                voucherNumber: voucherNum,
                voucherDate: txDate,
                description: `${charge.description} (post-offload) — container ${container.containerNumber}`,
                totalAmount: String(chargeAmt),
                currency: chargeCcy,
                exchangeRate: String(chargeFx),
                sourceModule: "FACTORY",
              })
              .returning();
            console.log(`[POC diag] voucherId=${voucher.id} inserted`);
            await tx.insert(voucherEntries).values({
              voucherId: voucher.id,
              ledgerAccountId: voucherChargesPayableAcctId,
              debitAmount: String(chargeAmt),
              creditAmount: "0",
              narration: `${charge.description} payable — container ${container.containerNumber}`,
            });
            if (charge.ledgerAccountId) {
              await tx.insert(voucherEntries).values({
                voucherId: voucher.id,
                ledgerAccountId: charge.ledgerAccountId,
                debitAmount: "0",
                creditAmount: String(chargeAmt),
                narration: `${charge.description} — container ${container.containerNumber}`,
              });
            } else if (charge.supplierId) {
              await tx.insert(voucherEntries).values({
                voucherId: voucher.id,
                factorySupplierId: charge.supplierId,
                debitAmount: "0",
                creditAmount: String(chargeAmt),
                narration: `${charge.description} — container ${container.containerNumber}`,
              });
            }
          }
        }
      });

      res.json({
        message: "Post-offload charges added and costs recalculated",
        containerId,
        oldContainerCostPerKgUsd,
        newContainerCostPerKgUsd,
        oldContainerTotalUsd,
        newContainerTotalUsd,
        rawStockRowsUpdated: cascadeResult?.rawStockRowsUpdated ?? 0,
        supplierLockedRateOld,
        supplierLockedRateNew,
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
