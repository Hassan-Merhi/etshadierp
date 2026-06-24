import { parseId, parseOptionalId } from "../../../lib/parseId";
import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
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

      const actualKg = parseFloat(container.actualReceivedKg || "0");
      const baseRate = parseFloat(container.ratePerKg || "0");
      const basePayable = actualKg * baseRate;
      const freightVal = parseFloat(container.freight || "0");
      const otherChargesVal = parseFloat(container.otherCharges || "0");
      const commissionVal = parseFloat(container.commissionAmount || "0");

      const additionalChargesRows = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        );
      const additionalChargesTotal = additionalChargesRows.reduce(
        (sum: number, c: any) => sum + parseFloat(c.amount || "0"),
        0
      );

      const totalCost =
        basePayable + freightVal + otherChargesVal + additionalChargesTotal + commissionVal + newDutyAmount;
      const newInclusiveCostPerKg = actualKg > 0 ? totalCost / actualKg : 0;
      const fxRate = parseFloat(container.fxRateToUsd || "1");
      const costPerKgUsd =
        (container.currencyCode || "USD") === "USD" ? newInclusiveCostPerKg : newInclusiveCostPerKg * fxRate;
      const finalPayableAmountUsd = String(actualKg * costPerKgUsd);

      await db
        .update(factoryContainers)
        .set({
          dutyAmount: String(newDutyAmount),
          dutyStatus: "CONFIRMED",
          dutyNotes: dutyNotes || container.dutyNotes,
          finalPayableAmount: String(totalCost),
          ratePerKgUsd: String(costPerKgUsd),
          finalPayableAmountUsd,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const [rawStock] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (rawStock) {
        await db
          .update(factoryRawStock)
          .set({
            costPerKg: String(newInclusiveCostPerKg),
            costPerKgUsd: String(costPerKgUsd),
          })
          .where(eq(factoryRawStock.id, rawStock.id));
      }

      // Propagate the updated cost to any mix batch sources that drew from this container,
      // then recalculate the weighted-average costPerKg on the parent mix batches.
      const containerMixSources = await db
        .select()
        .from(factoryMixBatchSources)
        .where(eq(factoryMixBatchSources.containerId, containerId));

      if (containerMixSources.length > 0) {
        for (const src of containerMixSources) {
          const newSourceTotalCost = parseFloat(src.weightKg) * newInclusiveCostPerKg;
          await db
            .update(factoryMixBatchSources)
            .set({
              costPerKg: String(newInclusiveCostPerKg),
              totalCost: String(newSourceTotalCost.toFixed(2)),
            })
            .where(eq(factoryMixBatchSources.id, src.id));
        }

        // Recalculate the weighted cost for every affected mix batch
        const affectedBatchIds = [...new Set(containerMixSources.map((s: any) => s.mixBatchId))];
        for (const batchId of affectedBatchIds) {
          const allSources = await db
            .select()
            .from(factoryMixBatchSources)
            .where(eq(factoryMixBatchSources.mixBatchId, batchId));
          const batchTotalCost = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.totalCost || "0"), 0);
          const batchTotalWeight = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
          const batchCostPerKg = batchTotalWeight > 0 ? batchTotalCost / batchTotalWeight : 0;
          await db
            .update(factoryMixBatches)
            .set({
              costPerKg: String(batchCostPerKg.toFixed(4)),
              totalCost: String(batchTotalCost.toFixed(2)),
              updatedAt: new Date(),
            })
            .where(eq(factoryMixBatches.id, batchId));
        }
      }

      const today = req.body.txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "DUTY",
        referenceId: containerId,
        description: `Duty confirmed for container ${container.containerNumber}: $${newDutyAmount.toFixed(2)}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: newDutyAmount,
        fxRateToUsd: fxRate,
      });

      res.json({ message: "Duty confirmed and costs recalculated", newCostPerKg: newInclusiveCostPerKg });
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
      const fxRate = parseFloat(container.fxRateToUsd || "1");
      const actualKg = parseFloat(container.actualReceivedKg || "0");
      if (actualKg <= 0) return res.status(400).json({ message: "Container has no received weight" });

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

      // Fetch existing additional charges to include in full recalculation
      const existingCharges = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(
          and(
            eq(factoryOffloadAdditionalCharges.containerId, containerId),
            eq(factoryOffloadAdditionalCharges.companyId, companyId)
          )
        );

      let newRawStock: any;
      const affectedBatches: {
        batchId: number;
        batchCode: string;
        oldCostPerKg: number;
        newCostPerKg: number;
        weightKg: number;
      }[] = [];

      await db.transaction(async (tx) => {
        // 1. Insert new additional charge rows
        const insertedCharges: any[] = [];
        for (const charge of validCharges) {
          const chargeCcy = charge.currencyCode || "USD";
          const chargeFx = parseFloat(charge.fxRateToUsd || (chargeCcy === "USD" ? "1" : String(fxRate)));
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

        // 2. Recompute inclusive cost per kg using ALL charges (existing + new)
        const allCharges = [...existingCharges, ...insertedCharges];
        const baseRate = parseFloat(container.ratePerKg || "0");
        const basePayable = actualKg * baseRate;
        const freightVal = parseFloat(container.freight || "0");
        const freightCcy = (container as any).freightCurrencyCode || containerCcy;
        const freightFxVal = parseFloat((container as any).fxRateToUsdOffload || String(fxRate));
        const freightUsd = freightCcy === "USD" ? freightVal : freightVal * freightFxVal;
        const freightInContainerCcy =
          freightCcy === containerCcy ? freightVal : fxRate > 0 ? freightUsd / fxRate : freightVal;
        const ocVal = parseFloat(container.otherCharges || "0");
        const commissionVal = parseFloat(container.commissionAmount || "0");
        const dutyVal = container.dutyStatus === "CONFIRMED" ? parseFloat(container.dutyAmount || "0") : 0;

        const additionalTotal = allCharges.reduce((sum: number, c: any) => {
          const amt = parseFloat(c.amount || "0");
          const ccy = c.currencyCode || containerCcy;
          const cfx = parseFloat(c.fxRateToUsd || String(fxRate));
          if (ccy === containerCcy) return sum + amt;
          const amtUsd = ccy === "USD" ? amt : amt * cfx;
          return sum + (containerCcy === "USD" ? amtUsd : fxRate > 0 ? amtUsd / fxRate : amtUsd);
        }, 0);

        const totalCost = basePayable + freightInContainerCcy + ocVal + commissionVal + dutyVal + additionalTotal;
        const newInclusiveCostPerKg = totalCost / actualKg;
        const newCostPerKgUsd = containerCcy === "USD" ? newInclusiveCostPerKg : newInclusiveCostPerKg * fxRate;
        const newFinalPayableAmountUsd = String(actualKg * newCostPerKgUsd);

        // 3. Update container financials
        await tx
          .update(factoryContainers)
          .set({
            finalPayableAmount: String(totalCost),
            ratePerKgUsd: String(newCostPerKgUsd),
            finalPayableAmountUsd: newFinalPayableAmountUsd,
            updatedAt: new Date(),
          })
          .where(eq(factoryContainers.id, containerId));

        // 4. Update raw stock cost — update ALL rows for this container (not just the first)
        const rawStockRows = await tx
          .select()
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
        for (const rawStockRow of rawStockRows) {
          await tx
            .update(factoryRawStock)
            .set({ costPerKg: String(newInclusiveCostPerKg), costPerKgUsd: String(newCostPerKgUsd) })
            .where(eq(factoryRawStock.id, rawStockRow.id));
        }
        // Expose first row in response (for UI feedback)
        if (rawStockRows.length > 0) {
          newRawStock = {
            ...rawStockRows[0],
            costPerKg: String(newInclusiveCostPerKg),
            costPerKgUsd: String(newCostPerKgUsd),
          };
        }

        // 5. Cascade to mix batch sources → recalculate affected batch weighted averages → cascade to bales
        const mixSources = await tx
          .select()
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.containerId, containerId));

        if (mixSources.length > 0) {
          for (const src of mixSources) {
            const newSourceTotalCost = parseFloat(src.weightKg) * newInclusiveCostPerKg;
            await tx
              .update(factoryMixBatchSources)
              .set({ costPerKg: String(newInclusiveCostPerKg), totalCost: String(newSourceTotalCost.toFixed(2)) })
              .where(eq(factoryMixBatchSources.id, src.id));
          }

          const affectedBatchIds = [...new Set(mixSources.map((s: any) => s.mixBatchId))];
          for (const batchId of affectedBatchIds) {
            const [batch] = await tx.select().from(factoryMixBatches).where(eq(factoryMixBatches.id, batchId));
            const oldCostPerKg = batch ? parseFloat(batch.costPerKg || "0") : 0;
            const allSources = await tx
              .select()
              .from(factoryMixBatchSources)
              .where(eq(factoryMixBatchSources.mixBatchId, batchId));
            const batchTotalCost = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.totalCost || "0"), 0);
            const batchTotalWeight = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
            const batchCostPerKg = batchTotalWeight > 0 ? batchTotalCost / batchTotalWeight : 0;
            await tx
              .update(factoryMixBatches)
              .set({
                costPerKg: String(batchCostPerKg.toFixed(4)),
                totalCost: String(batchTotalCost.toFixed(2)),
                updatedAt: new Date(),
              })
              .where(eq(factoryMixBatches.id, batchId));
            const srcWeight = mixSources
              .filter((s: any) => s.mixBatchId === batchId)
              .reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
            affectedBatches.push({
              batchId,
              batchCode: batch?.batchCode || `#${batchId}`,
              oldCostPerKg,
              newCostPerKg: batchCostPerKg,
              weightKg: srcWeight,
            });

            // 5b. Cascade blended cost down to all bales already pressed from this batch
            const balesInBatch = await tx
              .select({ id: factoryBales.id, weightKg: factoryBales.weightKg })
              .from(factoryBales)
              .where(
                and(
                  eq(factoryBales.mixBatchId, batchId),
                  eq(factoryBales.companyId, companyId),
                  sql`${factoryBales.status} NOT IN ('DELETED','REMOVED')`
                )
              );
            for (const bale of balesInBatch) {
              const baleWt = parseFloat(bale.weightKg as string) || 0;
              await tx
                .update(factoryBales)
                .set({
                  costPerKg: String(batchCostPerKg.toFixed(4)),
                  totalCost: String((baleWt * batchCostPerKg).toFixed(2)),
                  updatedAt: new Date(),
                })
                .where(eq(factoryBales.id, bale.id));
            }
          }
        }

        // 6. Daybook entries + vouchers for each new charge
        // chargeCtxs[ci] is pre-computed outside the transaction (index-aligned with validCharges / insertedCharges).
        for (let ci = 0; ci < insertedCharges.length; ci++) {
          const charge = insertedCharges[ci];
          const chargeAmt = parseFloat(charge.amount || "0");
          if (chargeAmt <= 0) continue;
          const chargeCcy = charge.currencyCode || "USD";
          const chargeFx = parseFloat(charge.fxRateToUsd || "1");
          await writeDaybookEntry(tx, {
            companyId,
            txDate,
            txType: "OTHER_CHARGE",
            referenceId: containerId,
            description: `${charge.description} (post-offload) — container ${container.containerNumber}`,
            currencyCode: chargeCcy,
            amountCurrency: chargeAmt,
            fxRateToUsd: chargeCcy === "USD" ? 1 : chargeFx,
            metaJson: JSON.stringify({ containerId, sourceType: "POST_OFFLOAD_ADDITIONAL", chargeId: charge.id }),
          });
          if (charge.ledgerAccountId || charge.supplierId) {
            // Use the pre-computed context — voucherCompanyId is derived from the ledger
            // account's own companyId so the voucher appears in the correct ledger view.
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
        affectedBatches,
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
