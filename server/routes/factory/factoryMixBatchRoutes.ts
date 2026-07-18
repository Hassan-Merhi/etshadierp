import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
} from "./_helpers";
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
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getStableSupplierCost } from "../../services/factory/rawStockStableCost";
import { getLockedSupplierRate, getLockedSupplierRateReadOnly } from "../../services/factory/rawStockLockedRate";
import Decimal from "decimal.js";

export function registerFactoryMixBatchRoutes(app: Express) {
  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt)))
        .orderBy(desc(factoryMixBatches.createdAt));

      // ── Display-blend calculation (read-only, no DB writes) ──
      const batchIds = results.map((b: any) => b.id);
      let sourceRows: any[] = [];
      if (batchIds.length > 0) {
        sourceRows = await db
          .select()
          .from(factoryMixBatchSources)
          .where(inArray(factoryMixBatchSources.mixBatchId, batchIds));
      }

      // Collect unique supplier IDs referenced by any source row
      const uniqueSupplierIds = [
        ...new Set(sourceRows.filter((s: any) => s.supplierId != null).map((s: any) => s.supplierId as number)),
      ];

      // Load current locked USD raw-material rate for each supplier (read-only)
      const supplierRateMap = new Map<number, number>();
      for (const supplierId of uniqueSupplierIds) {
        const { rate } = await getLockedSupplierRateReadOnly(db, companyId, supplierId);
        supplierRateMap.set(supplierId, rate);
      }

      // Group source rows by mixBatchId
      const sourcesByBatch = new Map<number, any[]>();
      for (const src of sourceRows) {
        if (!sourcesByBatch.has(src.mixBatchId)) sourcesByBatch.set(src.mixBatchId, []);
        sourcesByBatch.get(src.mixBatchId)!.push(src);
      }

      const enriched = results.map((b: any) => {
        const total = parseFloat(b.totalWeightKg) || 0;
        const used = parseFloat(b.usedKg) || 0;

        // Compute display totals using the same source rules as EditMixBatchDialog:
        //   A. sourceBatchId exists → use source row's stored costPerKg
        //   B. supplierId exists (incl. FIFO rows with containerId+supplierId) → current locked rate
        //   C. neither → fall back to source row's stored costPerKg
        const sources = sourcesByBatch.get(b.id) || [];
        let displayTotalWeightKg = new Decimal(0);
        let displayTotalCost = new Decimal(0);
        for (const src of sources) {
          const w = new Decimal(src.weightKg || 0);
          let effectiveCostPerKg: Decimal;
          if (src.sourceBatchId != null) {
            effectiveCostPerKg = new Decimal(src.costPerKg || 0);
          } else if (src.supplierId != null) {
            effectiveCostPerKg = new Decimal(supplierRateMap.get(src.supplierId) || 0);
          } else {
            effectiveCostPerKg = new Decimal(src.costPerKg || 0);
          }
          displayTotalWeightKg = displayTotalWeightKg.plus(w);
          displayTotalCost = displayTotalCost.plus(w.times(effectiveCostPerKg));
        }

        let displayCostPerKg: Decimal;
        if (displayTotalWeightKg.gt(0)) {
          displayCostPerKg = displayTotalCost.dividedBy(displayTotalWeightKg);
        } else {
          // No source rows → fall back to stored batch values
          displayTotalWeightKg = new Decimal(b.totalWeightKg || 0);
          displayTotalCost = new Decimal(b.totalCost || 0);
          displayCostPerKg = new Decimal(b.costPerKg || 0);
        }

        return {
          ...b,
          remainingKg: (total - used).toFixed(3),
          displayTotalWeightKg: displayTotalWeightKg.toFixed(3),
          displayTotalCost: displayTotalCost.toFixed(6),
          displayCostPerKg: displayCostPerKg.toFixed(6),
        };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const total = parseFloat(batch.totalWeightKg) || 0;
      const used = parseFloat(batch.usedKg) || 0;
      res.json({ ...batch, remainingKg: (total - used).toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { name, notes, batchDate, supplierSources, batchSources } = req.body;

      // If no source data provided → simple name/notes update only
      const hasSourceUpdate = supplierSources !== undefined || batchSources !== undefined;

      if (!hasSourceUpdate) {
        const [batch] = await db
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));
        if (!batch) return res.status(404).json({ message: "Mix batch not found" });
        const updates: any = {};
        if (name !== undefined) updates.name = name?.trim() || null;
        if (notes !== undefined) updates.notes = notes?.trim() || null;
        if (batchDate !== undefined) updates.batchDate = batchDate || null;
        const [updated] = await db
          .update(factoryMixBatches)
          .set(updates)
          .where(eq(factoryMixBatches.id, id))
          .returning();
        return res.json(updated);
      }

      // Full source edit: reverse old consumption, apply new
      const result = await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)))
          .for("update");
        if (!batch) throw new Error("Mix batch not found");

        const usedKg = parseFloat(batch.usedKg || "0");

        // ── 1. Reverse all existing sources ──
        const oldSources = await tx
          .select()
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        for (const src of oldSources) {
          if (src.containerId) {
            const [rsRow] = await tx
              .select()
              .from(factoryRawStock)
              .where(eq(factoryRawStock.containerId, src.containerId));
            if (rsRow) {
              const newUsed = Math.max(0, parseFloat(rsRow.usedKg) - parseFloat(src.weightKg));
              await tx
                .update(factoryRawStock)
                .set({ usedKg: newUsed.toFixed(3) })
                .where(eq(factoryRawStock.id, rsRow.id));
            }
          } else if (src.supplierId && !src.sourceBatchId) {
            // Legacy supplier-only source: FIFO reverse
            const supplierRawStocks = await tx
              .select({
                id: factoryRawStock.id,
                usedKg: factoryRawStock.usedKg,
              })
              .from(factoryRawStock)
              .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
              .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryContainers.supplierId, src.supplierId)))
              .orderBy(desc(factoryRawStock.offloadedAt), desc(factoryRawStock.id));
            let toRestore = parseFloat(src.weightKg);
            for (const rs of supplierRawStocks) {
              if (toRestore <= 0.001) break;
              const usedNow = parseFloat(rs.usedKg);
              if (usedNow <= 0) continue;
              const restore = Math.min(toRestore, usedNow);
              await tx
                .update(factoryRawStock)
                .set({ usedKg: Math.max(0, usedNow - restore).toFixed(3) })
                .where(eq(factoryRawStock.id, rs.id));
              toRestore -= restore;
            }
          } else if (src.sourceBatchId) {
            const [srcBatch] = await tx
              .select()
              .from(factoryMixBatches)
              .where(eq(factoryMixBatches.id, src.sourceBatchId));
            if (srcBatch) {
              const newUsed = Math.max(0, parseFloat(srcBatch.usedKg) - parseFloat(src.weightKg));
              await tx
                .update(factoryMixBatches)
                .set({ usedKg: newUsed.toFixed(3), status: "ACTIVE" })
                .where(eq(factoryMixBatches.id, src.sourceBatchId));
            }
          }
        }

        // ── 2. Delete old source records ──
        await tx.delete(factoryMixBatchSources).where(eq(factoryMixBatchSources.mixBatchId, id));

        // ── 3. Apply new sources ──
        let totalWeightKg = 0;
        let totalCost = 0;
        const sourceRecords: any[] = [];

        for (const source of supplierSources || []) {
          // costPerKg from the client is NEVER trusted for a real supplier.
          const { supplierId, weightKg } = source;
          const weight = parseFloat(weightKg);

          // Locked, offload-time moving-average rate — never derived from remaining/
          // available kg or all-time received kg, so it doesn't shift depending on
          // which container FIFO happens to draw from.
          const [costPerKg, { rows: supplierRawStocks }] = await Promise.all([
            getLockedSupplierRate(tx, companyId, supplierId, { forUpdate: true }),
            getStableSupplierCost(tx, companyId, supplierId, { forUpdate: true }),
          ]);

          // FIFO allocation of usedKg only — this determines WHICH container rows get
          // debited, never the cost rate itself (that's fixed above).
          const perRsDeductions: Array<{ containerId: number; deduct: number }> = [];
          let remaining = weight;
          for (const rs of supplierRawStocks) {
            if (remaining <= 0.001) break;
            const avail = rs.receivedKg - rs.usedKg;
            if (avail <= 0) continue;
            const deduct = Math.min(remaining, avail);
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${deduct}` })
              .where(eq(factoryRawStock.id, rs.id));
            perRsDeductions.push({ containerId: rs.containerId, deduct });
            remaining -= deduct;
          }
          if (remaining > 0.001 && supplierRawStocks.length > 0) {
            const lastRs = supplierRawStocks[supplierRawStocks.length - 1];
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${remaining}` })
              .where(eq(factoryRawStock.id, lastRs.id));
            const ex = perRsDeductions.find((d) => d.containerId === lastRs.containerId);
            if (ex) ex.deduct += remaining;
            else perRsDeductions.push({ containerId: lastRs.containerId, deduct: remaining });
          }

          totalWeightKg += weight;
          totalCost += weight * costPerKg;
          if (supplierRawStocks.length === 0) {
            if (costPerKg <= 0) {
              throw new Error(
                `Supplier has no established raw-material rate yet. Record a container offload or opening-balance/ADD adjustment before using it as a mix-batch source.`
              );
            }
            sourceRecords.push({
              supplierId,
              weightKg: String(weight),
              costPerKg: String(costPerKg),
              totalCost: String(weight * costPerKg),
            });
          }
          for (const d of perRsDeductions) {
            sourceRecords.push({
              supplierId,
              containerId: d.containerId,
              weightKg: String(d.deduct),
              costPerKg: String(costPerKg),
              totalCost: String(d.deduct * costPerKg),
            });
          }
        }

        for (const bSource of batchSources || []) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");
          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);
          const batchRemaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > batchRemaining + 0.001)
            throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${batchRemaining.toFixed(3)} kg`);
          const cost = parseFloat(srcBatch.costPerKg);
          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));
          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({
            sourceBatchId,
            weightKg: String(weight),
            costPerKg: String(cost),
            totalCost: String(weight * cost),
          });
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        // ── 5. Update batch totals ──
        const batchUpdates: any = {
          totalWeightKg: String(totalWeightKg),
          costPerKg: String(blendedCostPerKg),
          totalCost: String(totalCost),
          updatedAt: new Date(),
        };
        if (name !== undefined) batchUpdates.name = name?.trim() || null;
        if (notes !== undefined) batchUpdates.notes = notes?.trim() || null;
        if (batchDate !== undefined) batchUpdates.batchDate = batchDate || null;

        const [updated] = await tx
          .update(factoryMixBatches)
          .set(batchUpdates)
          .where(eq(factoryMixBatches.id, id))
          .returning();

        // ── 6. Insert new source records ──
        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: id,
            containerId: sr.containerId || null,
            supplierId: sr.supplierId || null,
            sourceBatchId: sr.sourceBatchId || null,
            sourceType: sr.sourceBatchId ? "BATCH" : sr.supplierId ? (sr.containerId ? "SUPPLIER_FIFO" : "SUPPLIER") : "CONTAINER_DIRECT",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return updated;
      });

      // Update daybook entry
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "MIX_BATCH_CREATED"),
            eq(factoryDaybookEntries.referenceId, id)
          )
        );
      const mbTxDate = batchDate || result.batchDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: mbTxDate,
        txType: "MIX_BATCH_CREATED",
        referenceId: result.id,
        description: `Mix batch edited: ${result.batchCode}${result.name ? ` – ${result.name}` : ""} (${parseFloat(result.totalWeightKg || "0").toFixed(1)} kg)`,
        amountCurrency: parseFloat(result.totalCost || "0"),
        amountUsd: parseFloat(result.totalCost || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error updating mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Finalize a mix batch (mark as fully consumed/completed) ──
  app.post("/api/factory/mix-batches/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      if (batch.status === "COMPLETED" || batch.status === "CLOSED") {
        return res.status(400).json({ message: "Batch is already finalized" });
      }

      const [updated] = await db
        .update(factoryMixBatches)
        .set({
          usedKg: batch.totalWeightKg,
          status: "COMPLETED",
          updatedAt: new Date(),
        })
        .where(eq(factoryMixBatches.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error finalizing mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      // Soft-delete: also reverse the usedKg this batch consumed from its sources
      // (raw stock containers and/or upstream batches) so the material becomes
      // available again in Raw Materials stock. Previously this reversal never
      // happened, so deleting a batch permanently "lost" its consumed stock.
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(factoryMixBatches)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(factoryMixBatches.id, id),
              eq(factoryMixBatches.companyId, companyId),
              isNull(factoryMixBatches.deletedAt)
            )
          )
          .returning({ id: factoryMixBatches.id });

        if (!updated) return null;

        const batchSourceRows = await tx
          .select({
            containerId: factoryMixBatchSources.containerId,
            sourceBatchId: factoryMixBatchSources.sourceBatchId,
            weightKg: factoryMixBatchSources.weightKg,
          })
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        for (const src of batchSourceRows) {
          const weight = parseFloat(src.weightKg) || 0;
          if (weight <= 0) continue;
          if (src.containerId) {
            // Reverse consumption on the underlying raw-stock container. Scoped to
            // companyId too so a corrupted/cross-tenant containerId can never
            // mutate another company's raw stock. GREATEST(...,0) is a defensive
            // floor only — the restore path in deletedItemsRoutes.ts re-adds the
            // same `weight` (not a clamped value), so a normal delete→restore
            // round trip is exact as long as usedKg wasn't already corrupted below
            // this batch's own contribution.
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`GREATEST(${factoryRawStock.usedKg} - ${weight}, 0)` })
              .where(and(eq(factoryRawStock.containerId, src.containerId), eq(factoryRawStock.companyId, companyId)));
          } else if (src.sourceBatchId) {
            // Reverse consumption on the upstream batch this batch topped up from.
            await tx
              .update(factoryMixBatches)
              .set({ usedKg: sql`GREATEST(${factoryMixBatches.usedKg} - ${weight}, 0)`, updatedAt: new Date() })
              .where(
                and(eq(factoryMixBatches.id, src.sourceBatchId), eq(factoryMixBatches.companyId, companyId))
              );
          }
        }

        return updated;
      });

      if (!result) return res.status(404).json({ message: "Mix batch not found" });
      res.json({ id: result.id, message: "Mix batch moved to Deleted Items" });
    } catch (error: any) {
      console.error("Error deleting mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        supplierSources = [],
        openingBatchId,
        name,
        notes,
        sources = [],
        batchSources = [],
        operatorUser,
        batchDate,
      } = req.body;

      const hasSupplierSources = supplierSources.length > 0;
      const hasOpeningBatch = openingBatchId && openingBatchId !== "none";
      const hasLegacySources = sources.length > 0 || batchSources.length > 0;

      if (!hasSupplierSources && !hasOpeningBatch && !hasLegacySources) {
        return res.status(400).json({ message: "At least one source is required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const year = new Date().getFullYear();
        const existingBatches = await tx
          .select({ batchCode: factoryMixBatches.batchCode })
          .from(factoryMixBatches)
          .where(
            and(
              eq(factoryMixBatches.companyId, companyId),
              sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`
            )
          );

        let nextNum = 1;
        for (const b of existingBatches) {
          const parts = b.batchCode.split("-");
          const num = parseInt(parts[2]) || 0;
          if (num >= nextNum) nextNum = num + 1;
        }
        const batchCode = `FMB-${year}-${String(nextNum).padStart(4, "0")}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const sourceRecords: any[] = [];

        if (hasOpeningBatch) {
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, openingBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Opening batch not found`);

          const remaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          if (remaining <= 0.001) throw new Error(`Opening batch has no remaining stock`);

          const cost = parseFloat(srcBatch.costPerKg);

          await tx
            .update(factoryMixBatches)
            .set({
              usedKg: srcBatch.totalWeightKg,
              status: "CLOSED",
              updatedAt: new Date(),
            })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          totalWeightKg += remaining;
          totalCost += remaining * cost;
          sourceRecords.push({
            sourceBatchId: srcBatch.id,
            weightKg: String(remaining),
            costPerKg: String(cost),
            totalCost: String(remaining * cost),
          });
        }

        for (const source of supplierSources) {
          // costPerKg from the client is NEVER trusted for a real supplier — the
          // authoritative locked rate is always read server-side.
          const { supplierId, weightKg } = source;
          const weight = parseFloat(weightKg);

          // Locked, offload-time moving-average rate — this NEVER shifts from mix
          // batch operations. FIFO row selection (which container gets debited)
          // is independent of the rate and still comes from getStableSupplierCost's
          // row listing.
          const [costPerKg, { rows: supplierRawStocks }] = await Promise.all([
            getLockedSupplierRate(tx, companyId, supplierId, { forUpdate: true }),
            getStableSupplierCost(tx, companyId, supplierId, { forUpdate: true }),
          ]);

          // FIFO allocation of usedKg only — this determines WHICH container rows get
          // debited, never the cost rate itself (that's fixed above).
          const perRsDeductions: Array<{ containerId: number; deduct: number }> = [];
          let remaining = weight;
          for (const rs of supplierRawStocks) {
            if (remaining <= 0.001) break;
            const avail = rs.receivedKg - rs.usedKg;
            if (avail <= 0) continue;

            const deduct = Math.min(remaining, avail);
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${deduct}` })
              .where(eq(factoryRawStock.id, rs.id));

            perRsDeductions.push({ containerId: rs.containerId, deduct });
            remaining -= deduct;
          }

          if (remaining > 0.001 && supplierRawStocks.length > 0) {
            const lastRs = supplierRawStocks[supplierRawStocks.length - 1];
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${remaining}` })
              .where(eq(factoryRawStock.id, lastRs.id));
            // Add to the last deduction entry if it already exists, otherwise push a new one
            const existing = perRsDeductions.find((d) => d.containerId === lastRs.containerId);
            if (existing) existing.deduct += remaining;
            else perRsDeductions.push({ containerId: lastRs.containerId, deduct: remaining });
          }

          totalWeightKg += weight;
          totalCost += weight * costPerKg;

          if (supplierRawStocks.length === 0) {
            // MANUAL supplier — no container raw-stock rows to deduct from. Still
            // must use the supplier's locked rate (e.g. set by a prior ADD/OB), never
            // a client-supplied value; reject if no rate has ever been established.
            if (costPerKg <= 0) {
              throw new Error(
                `Supplier has no established raw-material rate yet. Record a container offload or opening-balance/ADD adjustment before using it as a mix-batch source.`
              );
            }
            sourceRecords.push({
              supplierId,
              weightKg: String(weight),
              costPerKg: String(costPerKg),
              totalCost: String(weight * costPerKg),
            });
          } else {
            // Push one source record per raw stock container so deletion can correctly reverse each one
            for (const d of perRsDeductions) {
              sourceRecords.push({
                supplierId,
                containerId: d.containerId,
                weightKg: String(d.deduct),
                costPerKg: String(costPerKg),
                totalCost: String(d.deduct * costPerKg),
              });
            }
          }
        }

        for (const source of sources) {
          // Container-linked source: the rate is that specific container's own
          // persisted landed cost — client-supplied costPerKg is always ignored.
          const { containerId, weightKg } = source;
          const [rawStock] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStock) throw new Error(`Raw stock not found for container ${containerId}`);

          const weight = parseFloat(weightKg);

          const costUsd = parseFloat(rawStock.costPerKgUsd) || parseFloat(rawStock.costPerKg) || 0;

          // Allow over-use: usedKg may exceed receivedKg, driving stock negative
          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStock.id));

          totalWeightKg += weight;
          totalCost += weight * costUsd;
          sourceRecords.push({
            containerId,
            weightKg: String(weight),
            costPerKg: String(costUsd),
            totalCost: String(weight * costUsd),
          });
        }

        for (const bSource of batchSources) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);

          const batchRemaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > batchRemaining + 0.001) {
            throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${batchRemaining.toFixed(3)} kg`);
          }

          const cost = parseFloat(srcBatch.costPerKg);

          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({
            sourceBatchId,
            weightKg: String(weight),
            costPerKg: String(cost),
            totalCost: String(weight * cost),
          });
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        const [mixBatch] = await tx
          .insert(factoryMixBatches)
          .values({
            companyId,
            batchCode,
            batchNumber: batchCode,
            name: name || null,
            totalWeightKg: String(totalWeightKg),
            usedKg: String(totalWeightKg),
            costPerKg: String(blendedCostPerKg),
            totalCost: String(totalCost),
            notes: notes || null,
            operatorUser: operatorUser || null,
            batchDate: batchDate || null,
            status: "COMPLETED",
          } as any)
          .returning();

        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: mixBatch.id,
            containerId: sr.containerId || null,
            supplierId: sr.supplierId || null,
            sourceBatchId: sr.sourceBatchId || null,
            sourceType: sr.sourceBatchId ? "BATCH" : sr.supplierId ? (sr.containerId ? "SUPPLIER_FIFO" : "SUPPLIER") : "CONTAINER_DIRECT",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return mixBatch;
      });

      const mbToday = getClientDate(req);
      const mbTxDate = batchDate || mbToday;
      await writeDaybookEntry(db, {
        companyId,
        txDate: mbTxDate,
        txType: "MIX_BATCH_CREATED",
        referenceId: result.id,
        description: `Mix batch created: ${result.batchCode}${result.name ? ` – ${result.name}` : ""} (${parseFloat(result.totalWeightKg || "0").toFixed(1)} kg)`,
        amountCurrency: parseFloat(result.totalCost || "0"),
        amountUsd: parseFloat(result.totalCost || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating mix batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Top-up an existing mix batch with additional sources
  app.post("/api/factory/mix-batches/:id/top-up", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });

      const { supplierSources = [], sources = [], batchSources = [], txDate } = req.body;
      const hasAnySources = supplierSources.length > 0 || sources.length > 0 || batchSources.length > 0;
      if (!hasAnySources) return res.status(400).json({ message: "At least one source is required" });

      const result = await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)))
          .for("update");

        if (!batch) throw new Error("Batch not found");

        const existingTotalKg = parseFloat(batch.totalWeightKg);
        const existingTotalCost = parseFloat(batch.totalCost);
        let addedWeightKg = 0;
        let addedCost = 0;
        const sourceRecords: any[] = [];

        for (const source of supplierSources) {
          // costPerKg from the client is NEVER trusted for a real supplier.
          const { supplierId, weightKg } = source;
          const weight = parseFloat(weightKg);

          // Locked, offload-time moving-average rate — never derived from remaining/
          // available kg, so it doesn't shift depending on which container FIFO
          // happens to draw from.
          const [stableCostPerKg, { rows: supplierRawStocks }] = await Promise.all([
            getLockedSupplierRate(tx, companyId, supplierId, { forUpdate: true }),
            getStableSupplierCost(tx, companyId, supplierId, { forUpdate: true }),
          ]);

          const isManualSupplier = supplierRawStocks.length === 0;

          if (isManualSupplier) {
            // MANUAL supplier — no container raw-stock rows to update. Still must use
            // the supplier's locked rate; reject if none has ever been established.
            if (stableCostPerKg <= 0) {
              throw new Error(
                `Supplier has no established raw-material rate yet. Record a container offload or opening-balance/ADD adjustment before using it as a mix-batch source.`
              );
            }
            addedWeightKg += weight;
            addedCost += weight * stableCostPerKg;
            sourceRecords.push({
              supplierId,
              weightKg: String(weight),
              costPerKg: String(stableCostPerKg),
              totalCost: String(weight * stableCostPerKg),
            });
          } else {
            // FIFO deduction of usedKg only — this determines WHICH container rows get
            // debited, never the cost rate itself (that's fixed above). Allow over-use:
            // any leftover after FIFO drains all rows is pushed onto the last row,
            // driving its usedKg above receivedKg (negative stock).
            let toDeduct = weight;
            for (const rs of supplierRawStocks) {
              if (toDeduct <= 0.001) break;
              const avail = Math.max(0, rs.receivedKg - rs.usedKg);
              if (avail <= 0) continue;
              const take = Math.min(toDeduct, avail);
              await tx
                .update(factoryRawStock)
                .set({ usedKg: sql`${factoryRawStock.usedKg} + ${take}` })
                .where(eq(factoryRawStock.id, rs.id));
              toDeduct -= take;
            }
            // If there's still remaining kg (over-use), push it onto the last raw stock row
            if (toDeduct > 0.001 && supplierRawStocks.length > 0) {
              const lastRs = supplierRawStocks[supplierRawStocks.length - 1];
              await tx
                .update(factoryRawStock)
                .set({ usedKg: sql`${factoryRawStock.usedKg} + ${toDeduct}` })
                .where(eq(factoryRawStock.id, lastRs.id));
            }

            // Cost is always the supplier's locked rate — client-supplied cost is
            // never trusted, regardless of which raw-stock rows FIFO happened to hit.
            addedWeightKg += weight;
            addedCost += weight * stableCostPerKg;
            sourceRecords.push({
              supplierId,
              weightKg: String(weight),
              costPerKg: String(stableCostPerKg),
              totalCost: String(weight * stableCostPerKg),
            });
          }
        }

        for (const source of sources) {
          // Container-linked source: rate is that container's own persisted landed
          // cost — client-supplied costPerKg is always ignored.
          const { containerId, weightKg } = source;
          const [rawStockRow] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStockRow) throw new Error(`Raw stock not found for container ${containerId}`);

          const weight = parseFloat(weightKg);

          const costUsd = parseFloat(rawStockRow.costPerKgUsd) || parseFloat(rawStockRow.costPerKg) || 0;

          // Allow over-use: usedKg may exceed receivedKg, driving stock negative
          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStockRow.id));

          addedWeightKg += weight;
          addedCost += weight * costUsd;
          sourceRecords.push({
            containerId,
            weightKg: String(weight),
            costPerKg: String(costUsd),
            totalCost: String(weight * costUsd),
          });
        }

        for (const bSource of batchSources) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);

          const batchRemaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > batchRemaining + 0.001) {
            throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${batchRemaining.toFixed(3)} kg`);
          }

          const cost = parseFloat(srcBatch.costPerKg);
          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          addedWeightKg += weight;
          addedCost += weight * cost;
          sourceRecords.push({
            sourceBatchId,
            weightKg: String(weight),
            costPerKg: String(cost),
            totalCost: String(weight * cost),
          });
        }

        const newTotalKg = existingTotalKg + addedWeightKg;
        const newTotalCost = existingTotalCost + addedCost;
        const newCostPerKg = newTotalKg > 0 ? newTotalCost / newTotalKg : 0;

        const [updated] = await tx
          .update(factoryMixBatches)
          .set({
            totalWeightKg: String(newTotalKg),
            totalCost: String(newTotalCost),
            costPerKg: String(newCostPerKg),
            status: "ACTIVE",
            updatedAt: new Date(),
          })
          .where(eq(factoryMixBatches.id, id))
          .returning();

        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: id,
            containerId: sr.containerId || null,
            supplierId: sr.supplierId || null,
            sourceBatchId: sr.sourceBatchId || null,
            sourceType: sr.sourceBatchId ? "BATCH" : sr.supplierId ? (sr.containerId ? "SUPPLIER_FIFO" : "SUPPLIER") : "CONTAINER_DIRECT",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return updated;
      });

      const tuTxDate = txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: tuTxDate,
        txType: "MIX_BATCH_TOPUP",
        referenceId: result.id,
        description: `Mix batch top-up: ${result.batchCode}${result.name ? ` – ${result.name}` : ""}`,
        amountCurrency: parseFloat(result.totalCost || "0"),
        amountUsd: parseFloat(result.totalCost || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error topping up mix batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Assign existing (unlinked) bales to a mix batch
  app.post("/api/factory/mix-batches/:id/assign-bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const mixBatchId = parseId(req.params.id);

      if (mixBatchId === null) return res.status(400).json({ message: "Invalid id" });
      const { baleIds } = req.body as { baleIds: number[] };

      if (!Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds must be a non-empty array" });
      }

      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const bales = await db
        .select({ id: factoryBales.id, weightKg: factoryBales.weightKg, mixBatchId: factoryBales.mixBatchId })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

      if (bales.length !== baleIds.length) {
        return res.status(400).json({ message: "One or more bale IDs are invalid" });
      }
      const alreadyLinked = bales.filter((b) => b.mixBatchId !== null);
      if (alreadyLinked.length > 0) {
        return res.status(400).json({ message: `${alreadyLinked.length} bale(s) are already linked to a mix batch` });
      }

      const totalKg = bales.reduce((sum, b) => sum + parseFloat(b.weightKg as string), 0);
      const availableKg = parseFloat(batch.totalWeightKg as string) - parseFloat(batch.usedKg as string);

      if (totalKg > availableKg + 0.001) {
        return res.status(400).json({
          message: `Not enough remaining kg in this batch (need ${totalKg.toFixed(3)}, have ${availableKg.toFixed(3)})`,
        });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(factoryBales).set({ mixBatchId, updatedAt: now }).where(inArray(factoryBales.id, baleIds));

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalKg.toFixed(3)}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));
      });

      res.json({ success: true, balesUpdated: baleIds.length, totalKg });
    } catch (error: any) {
      console.error("Error assigning bales to mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id/sources", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const results = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          supplierId: factoryMixBatchSources.supplierId,
          sourceBatchId: factoryMixBatchSources.sourceBatchId,
          sourceType: factoryMixBatchSources.sourceType,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
          containerNumber: factoryContainers.containerNumber,
          supplierName: factorySuppliers.name,
          sourceBatchCode: sql<string>`(SELECT batch_code FROM factory_mix_batches WHERE id = ${factoryMixBatchSources.sourceBatchId})`,
        })
        .from(factoryMixBatchSources)
        .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryMixBatchSources.supplierId, factorySuppliers.id))
        .where(eq(factoryMixBatchSources.mixBatchId, id));

      // For any source row with a stored costPerKg of 0 (or null), look up the
      // actual weighted-average cost from factoryRawStock so the breakdown
      // display always shows a meaningful number.
      const enriched = await Promise.all(
        results.map(async (src) => {
          const storedCost = parseFloat(src.costPerKg) || 0;
          if (storedCost > 0) return src;

          // Try to find a raw stock cost via containerId first, then supplierId.
          // Uses the same stable receipt-weighted rate as the write paths (getStableSupplierCost)
          // so the display fallback can never disagree with what was actually costed.
          let fallbackCost = 0;
          if (src.containerId) {
            const rows = await db
              .select({
                costPerKgUsd: factoryRawStock.costPerKgUsd,
                costPerKg: factoryRawStock.costPerKg,
                receivedKg: factoryRawStock.receivedKg,
              })
              .from(factoryRawStock)
              .where(and(eq(factoryRawStock.containerId, src.containerId), eq(factoryRawStock.companyId, companyId)));
            let wSum = 0,
              wWeight = 0;
            for (const r of rows) {
              const kg = parseFloat(r.receivedKg) || 0;
              const c = parseFloat(r.costPerKgUsd || "0") || parseFloat(r.costPerKg || "0") || 0;
              wSum += kg * c;
              wWeight += kg;
            }
            fallbackCost = wWeight > 0 ? wSum / wWeight : 0;
          } else if (src.supplierId) {
            const stable = await getStableSupplierCost(db, companyId, src.supplierId);
            fallbackCost = stable.costPerKgUsd;
          }

          if (fallbackCost <= 0) return src;
          const weightKg = parseFloat(src.weightKg) || 0;
          return {
            ...src,
            costPerKg: String(fallbackCost),
            totalCost: String(weightKg * fallbackCost),
          };
        })
      );

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching mix batch sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6b. Mix Batch Daily Consumption
  // ───────────────────────────────────────────────

  app.post("/api/factory/mix-batches/consume", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { usages, operatorUser, usedDate } = req.body as {
        usages: Array<{ batchId: number; kgUsed: number; notes?: string }>;
        operatorUser?: string;
        usedDate: string;
      };

      if (!Array.isArray(usages) || usages.length === 0) {
        return res.status(400).json({ message: "usages array is required" });
      }
      if (!usedDate) return res.status(400).json({ message: "usedDate is required" });

      const results: any[] = [];
      await db.transaction(async (tx: any) => {
        for (const u of usages) {
          const { batchId, kgUsed, notes } = u;
          if (!batchId || !(kgUsed > 0)) continue;

          const [batch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, batchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");
          if (!batch) throw new Error(`Batch ${batchId} not found`);

          const total = parseFloat(batch.totalWeightKg) || 0;
          const alreadyUsed = parseFloat(batch.usedKg) || 0;
          const remaining = total - alreadyUsed;

          if (kgUsed > remaining + 0.001) {
            throw new Error(
              `Cannot consume ${kgUsed} kg from batch ${batch.batchCode}: only ${remaining.toFixed(3)} kg remaining`
            );
          }

          const now = new Date();
          await tx.insert(factoryDailyUsages).values({
            companyId,
            mixBatchId: batchId,
            kgUsed: String(kgUsed),
            operatorUser: operatorUser || null,
            usedDate,
            notes: notes || null,
          } as any);

          const isFullyConsumed = kgUsed >= remaining - 0.001;

          if (isFullyConsumed) {
            await tx
              .update(factoryMixBatches)
              .set({ usedKg: batch.totalWeightKg, status: "CLOSED", updatedAt: now })
              .where(eq(factoryMixBatches.id, batchId));
            results.push({ batchId, action: "closed", carryForwardId: null });
          } else {
            const leftoverKg = remaining - kgUsed;
            const costPerKg = parseFloat(batch.costPerKg) || 0;
            const leftoverCost = leftoverKg * costPerKg;

            await tx
              .update(factoryMixBatches)
              .set({ usedKg: String(total), status: "CLOSED", updatedAt: now })
              .where(eq(factoryMixBatches.id, batchId));

            const year = new Date().getFullYear();
            const existingBatches = await tx
              .select({ batchCode: factoryMixBatches.batchCode })
              .from(factoryMixBatches)
              .where(
                and(
                  eq(factoryMixBatches.companyId, companyId),
                  sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`
                )
              );
            let nextNum = 1;
            for (const b of existingBatches) {
              const parts = b.batchCode.split("-");
              const num = parseInt(parts[2]) || 0;
              if (num >= nextNum) nextNum = num + 1;
            }
            const newBatchCode = `FMB-${year}-${String(nextNum).padStart(4, "0")}`;

            const [cfBatch] = await tx
              .insert(factoryMixBatches)
              .values({
                companyId,
                batchCode: newBatchCode,
                batchNumber: newBatchCode,
                name: batch.name || null,
                totalWeightKg: String(leftoverKg),
                costPerKg: String(costPerKg),
                totalCost: String(leftoverCost),
                notes: batch.notes || null,
                operatorUser: operatorUser || batch.operatorUser || null,
                batchDate: usedDate || null,
                carryForwardFromId: batchId,
                status: "CARRY_FORWARD",
              } as any)
              .returning();

            results.push({
              batchId,
              action: "carry_forward",
              carryForwardId: cfBatch.id,
              carryForwardCode: cfBatch.batchCode,
              leftoverKg,
            });
          }
        }
      });

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error consuming mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/:id/mix-batch-history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const supplierId = parseId(req.params.id);
      if (supplierId === null) return res.status(400).json({ message: "Invalid id" });

      const rows = await db
        .select({
          batchId: factoryMixBatches.id,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          batchDate: factoryMixBatches.batchDate,
          batchStatus: factoryMixBatches.status,
          deletedAt: factoryMixBatches.deletedAt,
          batchCreatedAt: factoryMixBatches.createdAt,
          sourceId: factoryMixBatchSources.id,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          sourceCreatedAt: factoryMixBatchSources.createdAt,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(
          and(
            eq(factoryMixBatchSources.supplierId, supplierId),
            eq(factoryMixBatches.companyId, companyId)
          )
        )
        .orderBy(desc(factoryMixBatches.createdAt));

      res.json(rows);
    } catch (error: any) {
      console.error("Error fetching supplier mix batch history:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
