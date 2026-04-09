import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { classifyNetPositionAccounts } from "../netPositionHelper";
import { adjustInventory } from "../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerFactoryBalesRoutes(app: Express) {
  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId))
        .orderBy(desc(factoryMixBatches.createdAt));

      const enriched = results.map((b: any) => {
        const total = parseFloat(b.totalWeightKg) || 0;
        const used = parseFloat(b.usedKg) || 0;
        return { ...b, remainingKg: (total - used).toFixed(3) };
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

      const id = parseInt(req.params.id);
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

      const id = parseInt(req.params.id);
      const { name, notes, batchDate, supplierSources, batchSources } = req.body;

      // If no source data provided → simple name/notes update only
      const hasSourceUpdate = supplierSources !== undefined || batchSources !== undefined;

      if (!hasSourceUpdate) {
        const [batch] = await db.select().from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));
        if (!batch) return res.status(404).json({ message: "Mix batch not found" });
        const updates: any = {};
        if (name !== undefined) updates.name = name?.trim() || null;
        if (notes !== undefined) updates.notes = notes?.trim() || null;
        if (batchDate !== undefined) updates.batchDate = batchDate || null;
        const [updated] = await db.update(factoryMixBatches).set(updates)
          .where(eq(factoryMixBatches.id, id)).returning();
        return res.json(updated);
      }

      // Full source edit: reverse old consumption, apply new
      const result = await db.transaction(async (tx: any) => {
        const [batch] = await tx.select().from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)))
          .for("update");
        if (!batch) throw new Error("Mix batch not found");

        const usedKg = parseFloat(batch.usedKg || "0");

        // ── 1. Reverse all existing sources ──
        const oldSources = await tx.select().from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        for (const src of oldSources) {
          if (src.containerId) {
            const [rsRow] = await tx.select().from(factoryRawStock)
              .where(eq(factoryRawStock.containerId, src.containerId));
            if (rsRow) {
              const newUsed = Math.max(0, parseFloat(rsRow.usedKg) - parseFloat(src.weightKg));
              await tx.update(factoryRawStock).set({ usedKg: newUsed.toFixed(3) })
                .where(eq(factoryRawStock.id, rsRow.id));
            }
          } else if (src.supplierId && !src.sourceBatchId) {
            // Legacy supplier-only source: FIFO reverse
            const supplierRawStocks = await tx.select({
              id: factoryRawStock.id, usedKg: factoryRawStock.usedKg,
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
              await tx.update(factoryRawStock)
                .set({ usedKg: Math.max(0, usedNow - restore).toFixed(3) })
                .where(eq(factoryRawStock.id, rs.id));
              toRestore -= restore;
            }
          } else if (src.sourceBatchId) {
            const [srcBatch] = await tx.select().from(factoryMixBatches)
              .where(eq(factoryMixBatches.id, src.sourceBatchId));
            if (srcBatch) {
              const newUsed = Math.max(0, parseFloat(srcBatch.usedKg) - parseFloat(src.weightKg));
              await tx.update(factoryMixBatches)
                .set({ usedKg: newUsed.toFixed(3), status: "ACTIVE" })
                .where(eq(factoryMixBatches.id, src.sourceBatchId));
            }
          }
        }

        // ── 2. Delete old source records ──
        await tx.delete(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        // ── 3. Apply new sources ──
        let totalWeightKg = 0;
        let totalCost = 0;
        const sourceRecords: any[] = [];

        for (const source of (supplierSources || [])) {
          const { supplierId, weightKg } = source;
          const weight = parseFloat(weightKg);

          const supplierRawStocks = await tx.select({
            id: factoryRawStock.id,
            receivedKg: factoryRawStock.receivedKg,
            usedKg: factoryRawStock.usedKg,
            costPerKg: factoryRawStock.costPerKg,
            costPerKgUsd: factoryRawStock.costPerKgUsd,
            containerId: factoryRawStock.containerId,
            offloadedAt: factoryRawStock.offloadedAt,
          })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryContainers.supplierId, supplierId)))
            .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id)
            .for("update");

          let weightedCostSum = 0, weightedCostWeight = 0;
          for (const rs of supplierRawStocks) {
            const avail = Math.max(0, parseFloat(rs.receivedKg) - parseFloat(rs.usedKg));
            const rsCost = parseFloat(rs.costPerKgUsd || rs.costPerKg);
            weightedCostSum += avail * rsCost;
            weightedCostWeight += avail;
          }
          const costPerKg = weightedCostWeight > 0 ? weightedCostSum / weightedCostWeight : 0;

          const perRsDeductions: Array<{ containerId: number; deduct: number }> = [];
          let remaining = weight;
          for (const rs of supplierRawStocks) {
            if (remaining <= 0.001) break;
            const avail = parseFloat(rs.receivedKg) - parseFloat(rs.usedKg);
            if (avail <= 0) continue;
            const deduct = Math.min(remaining, avail);
            await tx.update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${deduct}` })
              .where(eq(factoryRawStock.id, rs.id));
            perRsDeductions.push({ containerId: rs.containerId, deduct });
            remaining -= deduct;
          }
          if (remaining > 0.001 && supplierRawStocks.length > 0) {
            const lastRs = supplierRawStocks[supplierRawStocks.length - 1];
            await tx.update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${remaining}` })
              .where(eq(factoryRawStock.id, lastRs.id));
            const ex = perRsDeductions.find(d => d.containerId === lastRs.containerId);
            if (ex) ex.deduct += remaining; else perRsDeductions.push({ containerId: lastRs.containerId, deduct: remaining });
            remaining = 0;
          }

          totalWeightKg += weight;
          totalCost += weight * costPerKg;
          for (const d of perRsDeductions) {
            sourceRecords.push({ supplierId, containerId: d.containerId, weightKg: String(d.deduct), costPerKg: String(costPerKg), totalCost: String(d.deduct * costPerKg) });
          }
        }

        for (const bSource of (batchSources || [])) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx.select().from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");
          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);
          const batchRemaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > batchRemaining + 0.001) throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${batchRemaining.toFixed(3)} kg`);
          const cost = parseFloat(srcBatch.costPerKg);
          await tx.update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));
          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({ sourceBatchId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
        }

        // ── 4. Validate new total >= already used in production ──
        if (totalWeightKg < usedKg - 0.001) {
          throw new Error(`New total (${totalWeightKg.toFixed(3)} kg) is less than already used in production (${usedKg.toFixed(3)} kg). Increase sources or reduce cannot proceed.`);
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

        const [updated] = await tx.update(factoryMixBatches).set(batchUpdates)
          .where(eq(factoryMixBatches.id, id)).returning();

        // ── 6. Insert new source records ──
        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: id,
            containerId: sr.containerId || null,
            supplierId: sr.supplierId || null,
            sourceBatchId: sr.sourceBatchId || null,
            sourceType: sr.sourceBatchId ? "BATCH" : sr.containerId ? "CONTAINER" : "SUPPLIER",
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
      await db.delete(factoryDaybookEntries).where(and(
        eq(factoryDaybookEntries.companyId, companyId),
        eq(factoryDaybookEntries.txType, "MIX_BATCH_CREATED"),
        eq(factoryDaybookEntries.referenceId, id)
      ));
      const mbTxDate = batchDate || result.batchDate || new Date().toISOString().split('T')[0];
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

      const id = parseInt(req.params.id);

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

      const id = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

        if (!batch) throw new Error("Mix batch not found");

        // 1. Unlink bales (set mixBatchId = NULL, preserve bales themselves)
        await tx
          .update(factoryBales)
          .set({ mixBatchId: null })
          .where(and(eq(factoryBales.mixBatchId, id), eq(factoryBales.companyId, companyId)));

        // 2. Reverse used_kg on each source
        const sources = await tx
          .select()
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        for (const src of sources) {
          if (src.containerId) {
            // Reverse used_kg on the raw stock container row
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
            // Legacy: source stored only supplierId (no containerId). Reverse FIFO from supplier's raw stock.
            const supplierRawStocks = await tx
              .select({
                id: factoryRawStock.id,
                usedKg: factoryRawStock.usedKg,
                offloadedAt: factoryRawStock.offloadedAt,
              })
              .from(factoryRawStock)
              .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
              .where(and(
                eq(factoryRawStock.companyId, companyId),
                eq(factoryContainers.supplierId, src.supplierId)
              ))
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
            // Reverse used_kg on source batch and restore to ACTIVE
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

        // 3. Delete sources
        await tx
          .delete(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        // 4. Delete daybook entries for this mix batch
        await tx
          .delete(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "MIX_BATCH_CREATED"),
            eq(factoryDaybookEntries.referenceId, id)
          ));

        // 5. Delete the batch
        await tx
          .delete(factoryMixBatches)
          .where(eq(factoryMixBatches.id, id));
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierSources = [], openingBatchId, name, notes,
              sources = [], batchSources = [], operatorUser, batchDate } = req.body;

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
          .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`));

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
          const { supplierId, weightKg, costPerKg: srcCostPerKg } = source;
          const weight = parseFloat(weightKg);

          const supplierRawStocks = await tx
            .select({
              id: factoryRawStock.id,
              receivedKg: factoryRawStock.receivedKg,
              usedKg: factoryRawStock.usedKg,
              costPerKg: factoryRawStock.costPerKg,
              costPerKgUsd: factoryRawStock.costPerKgUsd,
              containerId: factoryRawStock.containerId,
              offloadedAt: factoryRawStock.offloadedAt,
            })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(and(
              eq(factoryRawStock.companyId, companyId),
              eq(factoryContainers.supplierId, supplierId)
            ))
            .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id)
            .for("update");

          let totalAvailable = 0;
          let weightedCostSum = 0;
          let weightedCostWeight = 0;
          for (const rs of supplierRawStocks) {
            const avail = Math.max(0, parseFloat(rs.receivedKg) - parseFloat(rs.usedKg));
            totalAvailable += avail;
            const rsCost = parseFloat(rs.costPerKgUsd || rs.costPerKg);
            weightedCostSum += avail * rsCost;
            weightedCostWeight += avail;
          }

          const costPerKg = weightedCostWeight > 0 ? weightedCostSum / weightedCostWeight : 0;

          // Track per-raw-stock deductions so we can store containerId in each source record
          const perRsDeductions: Array<{ containerId: number; deduct: number }> = [];
          let remaining = weight;
          for (const rs of supplierRawStocks) {
            if (remaining <= 0.001) break;
            const avail = parseFloat(rs.receivedKg) - parseFloat(rs.usedKg);
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
            const existing = perRsDeductions.find(d => d.containerId === lastRs.containerId);
            if (existing) existing.deduct += remaining;
            else perRsDeductions.push({ containerId: lastRs.containerId, deduct: remaining });
            remaining = 0;
          }

          totalWeightKg += weight;
          totalCost += weight * costPerKg;
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

        for (const source of sources) {
          const { containerId, weightKg, costPerKg: srcCostPerKg } = source;
          const [rawStock] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStock) throw new Error(`Raw stock not found for container ${containerId}`);

          const containerRemaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > containerRemaining + 0.001) {
            throw new Error(`Not enough raw stock for container ${containerId}. Available: ${containerRemaining.toFixed(3)} kg`);
          }

          const costUsd = srcCostPerKg ? parseFloat(srcCostPerKg) : parseFloat(rawStock.costPerKgUsd || rawStock.costPerKg);

          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStock.id));

          totalWeightKg += weight;
          totalCost += weight * costUsd;
          sourceRecords.push({ containerId, weightKg: String(weight), costPerKg: String(costUsd), totalCost: String(weight * costUsd) });
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
          sourceRecords.push({ sourceBatchId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
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
            sourceType: sr.sourceBatchId ? "BATCH" : sr.containerId ? "CONTAINER" : "SUPPLIER",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return mixBatch;
      });

      const mbToday = new Date().toISOString().split('T')[0];
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

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid batch ID" });

      const { supplierSources = [], sources = [], batchSources = [] } = req.body;
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
          const { supplierId, weightKg, costPerKg: srcCostPerKg } = source;
          const weight = parseFloat(weightKg);

          const supplierRawStocks = await tx
            .select({
              id: factoryRawStock.id,
              receivedKg: factoryRawStock.receivedKg,
              usedKg: factoryRawStock.usedKg,
              costPerKg: factoryRawStock.costPerKg,
              costPerKgUsd: factoryRawStock.costPerKgUsd,
              offloadedAt: factoryRawStock.offloadedAt,
            })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryContainers.supplierId, supplierId)))
            .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id)
            .for("update");

          let totalAvailable = 0;
          let weightedCostSum = 0;
          for (const rs of supplierRawStocks) {
            const avail = Math.max(0, parseFloat(rs.receivedKg) - parseFloat(rs.usedKg));
            totalAvailable += avail;
            weightedCostSum += avail * parseFloat(rs.costPerKgUsd || rs.costPerKg || "0");
          }

          if (weight > totalAvailable + 0.001) {
            throw new Error(`Not enough stock from this supplier. Available: ${totalAvailable.toFixed(3)} kg`);
          }

          let toDeduct = weight;
          for (const rs of supplierRawStocks) {
            if (toDeduct <= 0.001) break;
            const avail = Math.max(0, parseFloat(rs.receivedKg) - parseFloat(rs.usedKg));
            if (avail <= 0) continue;
            const take = Math.min(toDeduct, avail);
            await tx.update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${take}` })
              .where(eq(factoryRawStock.id, rs.id));
            toDeduct -= take;
          }

          const costUsed = srcCostPerKg
            ? parseFloat(srcCostPerKg)
            : (totalAvailable > 0 ? weightedCostSum / totalAvailable : 0);

          addedWeightKg += weight;
          addedCost += weight * costUsed;
          sourceRecords.push({ supplierId, weightKg: String(weight), costPerKg: String(costUsed), totalCost: String(weight * costUsed) });
        }

        for (const source of sources) {
          const { containerId, weightKg, costPerKg: srcCostPerKg } = source;
          const [rawStockRow] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStockRow) throw new Error(`Raw stock not found for container ${containerId}`);

          const containerRemaining = parseFloat(rawStockRow.receivedKg) - parseFloat(rawStockRow.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > containerRemaining + 0.001) {
            throw new Error(`Not enough raw stock for container ${containerId}. Available: ${containerRemaining.toFixed(3)} kg`);
          }

          const costUsd = srcCostPerKg
            ? parseFloat(srcCostPerKg)
            : parseFloat(rawStockRow.costPerKgUsd || rawStockRow.costPerKg);

          await tx.update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStockRow.id));

          addedWeightKg += weight;
          addedCost += weight * costUsd;
          sourceRecords.push({ containerId, weightKg: String(weight), costPerKg: String(costUsd), totalCost: String(weight * costUsd) });
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
          await tx.update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          addedWeightKg += weight;
          addedCost += weight * cost;
          sourceRecords.push({ sourceBatchId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
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
            sourceType: sr.sourceBatchId ? "BATCH" : sr.containerId ? "CONTAINER" : "SUPPLIER",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return updated;
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

      const mixBatchId = parseInt(req.params.id);
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
        await tx
          .update(factoryBales)
          .set({ mixBatchId, updatedAt: now })
          .where(inArray(factoryBales.id, baleIds));

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

      const id = parseInt(req.params.id);

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

      res.json(results);
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
            throw new Error(`Cannot consume ${kgUsed} kg from batch ${batch.batchCode}: only ${remaining.toFixed(3)} kg remaining`);
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
              .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`));
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

            results.push({ batchId, action: "carry_forward", carryForwardId: cfBatch.id, carryForwardCode: cfBatch.batchCode, leftoverKg });
          }
        }
      });

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error consuming mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daily-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = req.query.date as string | undefined;
      const allTime = !date || date === "all";

      const whereClause = allTime
        ? eq(factoryDailyUsages.companyId, companyId)
        : and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${date}`);

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(whereClause)
        .orderBy(factoryDailyUsages.usedDate, factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);
      res.json({ date: allTime ? "all" : date, allTime, usages, totalKgUsed: totalKgUsed.toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching daily report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daily-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dateParam = req.query.date as string | undefined;
      const format = (req.query.format as string) || "excel";
      const allTime = !dateParam || dateParam === "all";
      const filenameDate = allTime ? "all-time" : dateParam;

      const whereClause = allTime
        ? eq(factoryDailyUsages.companyId, companyId)
        : and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${dateParam}`);

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(whereClause)
        .orderBy(factoryDailyUsages.usedDate, factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);

      const [fCfgDR] = await db.select({ hideAvgCost: factorySettings.hideAvgCost }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const showCostDR = !fCfgDR?.hideAvgCost;

      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Production Report");

        const drCols: any[] = [
          { header: "Date", key: "date", width: 14 },
          { header: "Batch Code", key: "batchCode", width: 18 },
          { header: "Batch Name", key: "batchName", width: 28 },
          { header: "Operator", key: "operatorUser", width: 20 },
          { header: "KG Used", key: "kgUsed", width: 14 },
        ];
        if (showCostDR) drCols.push({ header: "Cost / KG", key: "costPerKg", width: 14 });
        drCols.push({ header: "Notes", key: "notes", width: 32 });
        sheet.columns = drCols;

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        });

        for (const u of usages) {
          const rowData: any = {
            date: u.usedDate,
            batchCode: u.batchCode,
            batchName: u.batchName || "",
            operatorUser: u.operatorUser || "",
            kgUsed: parseFloat(u.kgUsed || "0"),
            notes: u.notes || "",
          };
          if (showCostDR) rowData.costPerKg = parseFloat(u.costPerKg || "0");
          sheet.addRow(rowData);
        }

        const totalRowData: any = { date: "TOTAL", batchCode: "", batchName: "", operatorUser: "", kgUsed: totalKgUsed, notes: "" };
        if (showCostDR) totalRowData.costPerKg = "";
        const totalRow = sheet.addRow(totalRowData);
        totalRow.eachCell((cell) => { cell.font = { bold: true }; });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.xlsx"`);
        await workbook.xlsx.write(res);
        return res.end();
      }

      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-report-${filenameDate}.pdf"`);
        doc.pipe(res);

        const rpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(rpLogoPath)) {
          try { doc.image(rpLogoPath, (doc.page.width - 220) / 2, doc.y, { width: 220 }); doc.moveDown(0.4); } catch {}
        }
        const title = allTime ? "Raw Production Report — All Time" : "Raw Production Report";
        doc.fontSize(16).font("Helvetica-Bold").text(title, { align: "center" });
        if (!allTime) doc.fontSize(11).font("Helvetica").text(`Date: ${dateParam}`, { align: "center" });
        doc.moveDown();

        // Landscape A4: usable width ~752px (margin 40 each side)
        const colX = [40, 120, 230, 380, 470, 545, 620];
        const colW = [75, 105, 145, 85, 70, 70, 120];
        const headers = ["Date", "Batch Code", "Batch Name", "Operator", "KG Used", "Cost/KG", "Notes"];

        doc.fontSize(9).font("Helvetica-Bold");
        headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < headers.length - 1, width: colW[i] }));
        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(752, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(8);
        for (const u of usages) {
          const y = doc.y;
          const cols = [
            u.usedDate || "—",
            u.batchCode,
            u.batchName || "—",
            u.operatorUser || "—",
            `${parseFloat(u.kgUsed || "0").toFixed(3)} kg`,
            `$${parseFloat(u.costPerKg || "0").toFixed(4)}`,
            u.notes || "—",
          ];
          cols.forEach((c, i) => {
            doc.text(String(c), colX[i], y, { width: colW[i], lineBreak: false });
          });
          doc.moveDown(1);
          if (doc.y > doc.page.height - 80) {
            doc.addPage({ layout: "landscape" });
          }
        }

        doc.moveDown(0.5);
        doc.moveTo(40, doc.y).lineTo(752, doc.y).stroke();
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(10).text(`Total KG Consumed: ${totalKgUsed.toFixed(3)} kg`, { align: "right" });

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format. Use excel or pdf." });
    } catch (error: any) {
      console.error("Error exporting production report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Weekly pivot production report (by supplier × day)
  // ───────────────────────────────────────────────
  app.get("/api/factory/weekly-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const format = (req.query.format as string) || "excel";

      // Helper: ISO week key "YYYY-Www"
      function isoWeekKey(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getUTCDay(); // 0=Sun
        const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() + diff);
        const y = mon.getUTCFullYear();
        const jan4 = new Date(Date.UTC(y, 0, 4));
        const week = Math.ceil(((mon.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
        return `${y}-W${String(week).padStart(2, "0")}`;
      }
      function mondayOfWeek(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getUTCDay();
        const diff = (day === 0 ? -6 : 1) - day;
        d.setUTCDate(d.getUTCDate() + diff);
        return d.toISOString().slice(0, 10);
      }
      const DAY_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
      function dayName(dateStr: string): string {
        const d = new Date(dateStr + "T00:00:00");
        const idx = (d.getUTCDay() + 6) % 7; // 0=Mon
        return DAY_NAMES[idx];
      }
      function fmtDate(dateStr: string): string {
        // "DD/MM" format
        const [, mm, dd] = dateStr.split("-");
        return `${dd}/${mm}`;
      }

      // 1. Current balance per supplier (remaining kg) from raw stock
      const rawStockRows = await db
        .select({
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          offloadedAt: factoryRawStock.offloadedAt,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.companyId, companyId), sql`${factoryContainers.status} != 'DELETED'`));

      // Map: supplierId → { name, currentBalance }
      const supplierBalMap = new Map<number, { name: string; currentBalance: number }>();
      for (const r of rawStockRows) {
        const sid = r.supplierId as number;
        if (!sid) continue;
        const remaining = (parseFloat(r.receivedKg as string) || 0) - (parseFloat(r.usedKg as string) || 0);
        if (supplierBalMap.has(sid)) {
          supplierBalMap.get(sid)!.currentBalance += remaining;
        } else {
          supplierBalMap.set(sid, { name: r.supplierName || "Unknown", currentBalance: remaining });
        }
      }

      // 2. Stock-in per supplier per date (from offloadedAt of raw stock entries)
      // Map: date → supplierId → kg
      const stockInByDate = new Map<string, Map<number, number>>();
      for (const r of rawStockRows) {
        const sid = r.supplierId as number;
        if (!sid) continue;
        const dateStr = (r.offloadedAt as Date).toISOString().slice(0, 10);
        if (!stockInByDate.has(dateStr)) stockInByDate.set(dateStr, new Map());
        const dm = stockInByDate.get(dateStr)!;
        dm.set(sid, (dm.get(sid) || 0) + (parseFloat(r.receivedKg as string) || 0));
      }

      // 3. Get all daily usages for this company
      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          usedDate: factoryDailyUsages.usedDate,
        })
        .from(factoryDailyUsages)
        .where(eq(factoryDailyUsages.companyId, companyId))
        .orderBy(factoryDailyUsages.usedDate);

      // 4. Get mix batch sources for all relevant batch IDs
      const batchIds = [...new Set(usages.map((u: any) => u.mixBatchId))];
      const batchSourceMap = new Map<number, Array<{ supplierId: number; supplierName: string; weightKg: number; fraction: number }>>();

      if (batchIds.length > 0) {
        const sourceRows = await db
          .select({
            mixBatchId: factoryMixBatchSources.mixBatchId,
            supplierId: factoryContainers.supplierId,
            supplierName: factorySuppliers.name,
            weightKg: factoryMixBatchSources.weightKg,
          })
          .from(factoryMixBatchSources)
          .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
          .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
          .where(inArray(factoryMixBatchSources.mixBatchId, batchIds));

        // Aggregate by batch → supplier
        const batchRaw = new Map<number, Map<number, { name: string; weightKg: number }>>();
        for (const r of sourceRows) {
          const bid = r.mixBatchId;
          const sid = (r.supplierId as number) || 0;
          if (!sid) continue;
          if (!batchRaw.has(bid)) batchRaw.set(bid, new Map());
          const sm = batchRaw.get(bid)!;
          const w = parseFloat(r.weightKg as string) || 0;
          if (sm.has(sid)) {
            sm.get(sid)!.weightKg += w;
          } else {
            sm.set(sid, { name: r.supplierName || "Unknown", weightKg: w });
          }
        }

        // Compute fractions
        for (const [bid, srcMap] of batchRaw) {
          const totalW = [...srcMap.values()].reduce((s, v) => s + v.weightKg, 0);
          const sources = [...srcMap.entries()].map(([sid, v]) => ({
            supplierId: sid,
            supplierName: v.name,
            weightKg: v.weightKg,
            fraction: totalW > 0 ? v.weightKg / totalW : 0,
          }));
          batchSourceMap.set(bid, sources);
        }
      }

      // 5. Build consumption map: date → supplierId → kgConsumed
      const consumptionByDate = new Map<string, Map<number, number>>();
      for (const u of usages) {
        const dateStr = u.usedDate as string;
        const kgUsed = parseFloat(u.kgUsed as string) || 0;
        const sources = batchSourceMap.get(u.mixBatchId) || [];
        if (!consumptionByDate.has(dateStr)) consumptionByDate.set(dateStr, new Map());
        const dm = consumptionByDate.get(dateStr)!;
        if (sources.length === 0) continue;
        for (const src of sources) {
          const alloc = kgUsed * src.fraction;
          dm.set(src.supplierId, (dm.get(src.supplierId) || 0) + alloc);
          // Register supplier if not already known
          if (!supplierBalMap.has(src.supplierId)) {
            supplierBalMap.set(src.supplierId, { name: src.supplierName, currentBalance: 0 });
          }
        }
      }

      // 6. Collect all dates with any data (consumption OR stock-in) and group by week
      const allDates = new Set<string>([
        ...consumptionByDate.keys(),
        ...stockInByDate.keys(),
      ]);

      const weekMap = new Map<string, string[]>(); // weekKey → sorted dates
      for (const d of allDates) {
        const wk = isoWeekKey(d);
        if (!weekMap.has(wk)) weekMap.set(wk, []);
        weekMap.get(wk)!.push(d);
      }
      // Sort weeks and days
      const sortedWeekKeys = [...weekMap.keys()].sort();
      for (const wk of sortedWeekKeys) weekMap.get(wk)!.sort();

      // If no data, return an empty report
      if (sortedWeekKeys.length === 0) {
        if (format === "excel") {
          const ExcelJS = (await import("exceljs")).default;
          const wb = new ExcelJS.Workbook();
          const sh = wb.addWorksheet("Weekly Report");
          sh.addRow(["No data found"]);
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.xlsx"`);
          await wb.xlsx.write(res);
          return res.end();
        }
        return res.json({ message: "No data" });
      }

      // 7. Compute opening/closing balance per supplier per week
      // Strategy: work from latest week backwards.
      // currentBalance = balance right now.
      // openingBalance[lastWeek] = currentBalance + consumption[lastWeek] - stockIn[lastWeek]
      // openingBalance[prevWeek] = openingBalance[nextWeek] + consumption[prevWeek] - stockIn[prevWeek]
      // closingBalance[W] = openingBalance[nextWeek]

      const allSupplierIds = [...supplierBalMap.keys()];

      // Compute per-week totals for each supplier
      const weekConsumption = new Map<string, Map<number, number>>(); // weekKey → supplierId → kg
      const weekStockIn = new Map<string, Map<number, number>>();
      for (const wk of sortedWeekKeys) {
        const dates = weekMap.get(wk)!;
        const cMap = new Map<number, number>();
        const sMap = new Map<number, number>();
        for (const d of dates) {
          const cDay = consumptionByDate.get(d) || new Map();
          for (const [sid, kg] of cDay) { cMap.set(sid, (cMap.get(sid) || 0) + kg); }
          const sDay = stockInByDate.get(d) || new Map();
          for (const [sid, kg] of sDay) { sMap.set(sid, (sMap.get(sid) || 0) + kg); }
        }
        weekConsumption.set(wk, cMap);
        weekStockIn.set(wk, sMap);
      }

      // Opening balances: work backwards from current
      const openingBalances = new Map<string, Map<number, number>>(); // weekKey → supplierId → openingBal
      const closingBalances = new Map<string, Map<number, number>>();

      // Closing of last week = current balance
      const lastWk = sortedWeekKeys[sortedWeekKeys.length - 1];
      const lastClosing = new Map<number, number>();
      for (const sid of allSupplierIds) lastClosing.set(sid, supplierBalMap.get(sid)!.currentBalance);
      closingBalances.set(lastWk, lastClosing);

      // Compute opening of last week and backwards
      for (let i = sortedWeekKeys.length - 1; i >= 0; i--) {
        const wk = sortedWeekKeys[i];
        const closing = closingBalances.get(wk)!;
        const cMap = weekConsumption.get(wk)!;
        const sMap = weekStockIn.get(wk)!;
        const opening = new Map<number, number>();
        for (const sid of allSupplierIds) {
          opening.set(sid, (closing.get(sid) || 0) + (cMap.get(sid) || 0) - (sMap.get(sid) || 0));
        }
        openingBalances.set(wk, opening);
        if (i > 0) {
          // closing of previous week = opening of this week
          closingBalances.set(sortedWeekKeys[i - 1], opening);
        }
      }

      // 8. Generate Excel
      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        const sh = wb.addWorksheet("Weekly Report");
        sh.properties.defaultColWidth = 12;

        const BLUE = "FF1E40AF";
        const LIGHT_BLUE = "FFE0EAFF";
        const DARK_GRAY = "FF374151";
        const TOTAL_BG = "FFD1FAE5";
        const BORDER_STYLE: any = { style: "thin", color: { argb: "FFD1D5DB" } };
        const BORDER_ALL = { top: BORDER_STYLE, left: BORDER_STYLE, bottom: BORDER_STYLE, right: BORDER_STYLE };

        let row = 1;

        for (const wk of sortedWeekKeys) {
          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const satDate = dates[dates.length - 1];

          // Full Mon-Sat date list for the week (fill in missing days)
          const weekDays: string[] = [];
          const monD = new Date(monDate + "T00:00:00");
          for (let di = 0; di < 7; di++) {
            const d = new Date(monD);
            d.setUTCDate(monD.getUTCDate() + di);
            const ds = d.toISOString().slice(0, 10);
            weekDays.push(ds);
          }
          // Mon-Sat only (first 6)
          const weekDaysMoSa = weekDays.slice(0, 6);

          // Title row for this week
          const titleRow = sh.getRow(row);
          const titleText = `Week of ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[5])}  |  ${wk}`;
          titleRow.getCell(1).value = titleText;
          titleRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
          titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
          sh.mergeCells(row, 1, row, 3 + weekDaysMoSa.length + 2);
          titleRow.height = 20;
          row++;

          // Column header row
          const colHeaders = ["TYPE", "Balance", "Stock In", ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`), "TOTAL", "REMAINS"];
          const headerRow = sh.getRow(row);
          colHeaders.forEach((h, ci) => {
            const cell = headerRow.getCell(ci + 1);
            cell.value = h;
            cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GRAY } };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            cell.border = BORDER_ALL;
          });
          sh.getColumn(1).width = 22;
          sh.getColumn(2).width = 14;
          sh.getColumn(3).width = 11;
          headerRow.height = 28;
          row++;

          const opening = openingBalances.get(wk)!;
          const cMap = weekConsumption.get(wk)!;
          const sMap = weekStockIn.get(wk)!;

          // Supplier rows — only those with any activity this week or a non-zero balance
          const activeSuppliers = allSupplierIds.filter(sid => {
            const hasCons = [...(weekConsumption.get(wk)?.get(sid) ? [1] : [])].length > 0;
            const hasSI = (sMap.get(sid) || 0) > 0;
            const hasBalance = (opening.get(sid) || 0) > 0;
            return hasCons || hasSI || hasBalance;
          }).sort((a, b) => (supplierBalMap.get(a)?.name || "").localeCompare(supplierBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = weekDaysMoSa.map(() => 0);

          for (const sid of activeSuppliers) {
            const sInfo = supplierBalMap.get(sid)!;
            const openBal = opening.get(sid) || 0;
            const stockIn = sMap.get(sid) || 0;
            const dayVals = weekDaysMoSa.map(d => (consumptionByDate.get(d)?.get(sid) || 0));
            const total = dayVals.reduce((s, v) => s + v, 0);
            const remains = openBal + stockIn - total;

            weekTotalBalance += openBal;
            weekTotalStockIn += stockIn;
            weekTotalTotal += total;
            weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const dataRow = sh.getRow(row);
            const vals = [sInfo.name, openBal, stockIn > 0 ? stockIn : null, ...dayVals.map(v => v > 0.001 ? Math.round(v) : null), Math.round(total) || null, Math.round(remains)];
            vals.forEach((v, ci) => {
              const cell = dataRow.getCell(ci + 1);
              cell.value = v;
              cell.font = { size: 9 };
              cell.border = BORDER_ALL;
              if (ci === 0) {
                cell.font = { size: 9, bold: true };
                cell.alignment = { vertical: "middle" };
              } else {
                cell.alignment = { horizontal: "right", vertical: "middle" };
                cell.numFmt = "#,##0";
              }
              if (ci >= 3 && ci < 3 + weekDaysMoSa.length && typeof v === "number") {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
              }
            });
            dataRow.height = 16;
            row++;
          }

          // Totals row
          const totRow = sh.getRow(row);
          const totVals = ["TOTAL", weekTotalBalance, weekTotalStockIn > 0 ? weekTotalStockIn : null, ...weekTotalByDay.map(v => Math.round(v) || null), Math.round(weekTotalTotal) || null, Math.round(weekTotalRemains)];
          totVals.forEach((v, ci) => {
            const cell = totRow.getCell(ci + 1);
            cell.value = v;
            cell.font = { bold: true, size: 9 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
            cell.border = BORDER_ALL;
            if (ci === 0) { cell.alignment = { vertical: "middle" }; }
            else { cell.alignment = { horizontal: "right", vertical: "middle" }; cell.numFmt = "#,##0"; }
          });
          totRow.height = 18;
          row++;

          // Blank gap row between weeks
          row++;
        }

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.xlsx"`);
        await wb.xlsx.write(res);
        return res.end();
      }

      // PDF format
      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="weekly-production-report.pdf"`);
        doc.pipe(res);

        const pageW = doc.page.width - 60; // usable width
        const rowH = 14;

        const wpLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");

        for (let wi = 0; wi < sortedWeekKeys.length; wi++) {
          const wk = sortedWeekKeys[wi];
          if (wi > 0) doc.addPage({ layout: "landscape" });

          if (wi === 0 && fs.existsSync(wpLogoPath)) {
            try { doc.image(wpLogoPath, (doc.page.width - 220) / 2, 10, { width: 220 }); } catch {}
            doc.moveDown(0.5);
          }

          const dates = weekMap.get(wk)!;
          const monDate = mondayOfWeek(dates[0]);
          const monD = new Date(monDate + "T00:00:00");
          const weekDaysMoSa: string[] = [];
          for (let di = 0; di < 6; di++) {
            const d = new Date(monD); d.setUTCDate(monD.getUTCDate() + di);
            weekDaysMoSa.push(d.toISOString().slice(0, 10));
          }

          // Column layout: TYPE(120) | Balance(65) | StockIn(55) | days(48 each) | TOTAL(58) | REMAINS(65)
          const nDays = 6;
          const fixedW = 120 + 65 + 55 + 58 + 65;
          const dayW = Math.max(40, Math.floor((pageW - fixedW) / nDays));
          const colWidths = [120, 65, 55, ...Array(nDays).fill(dayW), 58, 65];
          const colX: number[] = [30];
          for (let i = 1; i < colWidths.length; i++) colX.push(colX[i - 1] + colWidths[i - 1]);

          // Week title
          const titleText = `Week ${wk}  |  ${fmtDate(monDate)} – ${fmtDate(weekDaysMoSa[5])}`;
          doc.fontSize(11).font("Helvetica-Bold").text(titleText, 30, 30, { width: pageW });
          doc.moveDown(0.3);

          // Draw header
          const headers = ["TYPE", "Balance", "Stock In", ...weekDaysMoSa.map(d => `${dayName(d)}\n${fmtDate(d)}`), "TOTAL", "REMAINS"];
          const hy = doc.y;
          doc.fontSize(7).font("Helvetica-Bold");
          headers.forEach((h, i) => {
            const lines = h.split("\n");
            lines.forEach((line, li) => {
              doc.text(line, colX[i], hy + li * 8, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
          });
          const hh = rowH + (headers.some(h => h.includes("\n")) ? 8 : 0);
          doc.moveDown(0.1);
          const lineY = hy + hh;
          doc.moveTo(30, lineY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), lineY).stroke();

          const opening = openingBalances.get(wk)!;
          const cMap = weekConsumption.get(wk)!;
          const sMap = weekStockIn.get(wk)!;

          const activeSuppliers = allSupplierIds.filter(sid => {
            return (cMap.get(sid) || 0) > 0 || (sMap.get(sid) || 0) > 0 || (opening.get(sid) || 0) > 0;
          }).sort((a, b) => (supplierBalMap.get(a)?.name || "").localeCompare(supplierBalMap.get(b)?.name || ""));

          let weekTotalBalance = 0, weekTotalStockIn = 0, weekTotalTotal = 0, weekTotalRemains = 0;
          const weekTotalByDay = Array(nDays).fill(0);

          let rowY = lineY + 3;
          doc.font("Helvetica").fontSize(7);

          for (const sid of activeSuppliers) {
            const sInfo = supplierBalMap.get(sid)!;
            const openBal = opening.get(sid) || 0;
            const stockIn = sMap.get(sid) || 0;
            const dayVals = weekDaysMoSa.map(d => consumptionByDate.get(d)?.get(sid) || 0);
            const total = dayVals.reduce((s, v) => s + v, 0);
            const remains = openBal + stockIn - total;

            weekTotalBalance += openBal; weekTotalStockIn += stockIn;
            weekTotalTotal += total; weekTotalRemains += remains;
            dayVals.forEach((v, i) => { weekTotalByDay[i] += v; });

            const rowVals = [
              sInfo.name,
              Math.round(openBal).toLocaleString(),
              stockIn > 0.001 ? Math.round(stockIn).toLocaleString() : "-",
              ...dayVals.map(v => v > 0.001 ? Math.round(v).toLocaleString() : "-"),
              total > 0.001 ? Math.round(total).toLocaleString() : "-",
              Math.round(remains).toLocaleString(),
            ];
            rowVals.forEach((v, i) => {
              doc.text(String(v), colX[i], rowY, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
            });
            rowY += rowH;
          }

          // Totals row
          doc.moveTo(30, rowY).lineTo(30 + colWidths.reduce((a, b) => a + b, 0), rowY).strokeColor("#000000").stroke();
          rowY += 3;
          doc.font("Helvetica-Bold").fontSize(7);
          const totVals = [
            "TOTAL",
            Math.round(weekTotalBalance).toLocaleString(),
            weekTotalStockIn > 0.001 ? Math.round(weekTotalStockIn).toLocaleString() : "-",
            ...weekTotalByDay.map(v => v > 0.001 ? Math.round(v).toLocaleString() : "-"),
            weekTotalTotal > 0.001 ? Math.round(weekTotalTotal).toLocaleString() : "-",
            Math.round(weekTotalRemains).toLocaleString(),
          ];
          totVals.forEach((v, i) => {
            doc.text(String(v), colX[i], rowY, { width: colWidths[i] - 2, align: i === 0 ? "left" : "right", lineBreak: false });
          });
        }

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format." });
    } catch (error: any) {
      console.error("Error generating weekly report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 7. Factory Pressing (create-and-print)
  // ───────────────────────────────────────────────

  app.post("/api/factory/pressing/create-and-print", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(5, '0')}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Pressing batch created: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/pressing/create-multi", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required with at least one entry" });
      }

      const result = await db.transaction(async (tx: any) => {
        const totalExpected = items.reduce((sum: number, item: any) => sum + parseInt(item.quantity || item.qty), 0);

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId: items[0].productId,
            expectedCount: totalExpected,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + totalExpected })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + totalExpected,
          });
        }

        const bales: any[] = [];
        let baleIndex = 0;

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty);
          const weight = item.weightPerBale;

          const [product] = await tx
            .select()
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, item.productId), eq(factoryBaleProducts.companyId, companyId)));

          if (!product) throw new Error(`Product ID ${item.productId} not found`);

          for (let i = 0; i < qty; i++) {
            const refNum = `REF${String(nextNumber + baleIndex).padStart(5, '0')}`;
            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                pressingBatchId: pressingBatch.id,
                productId: item.productId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                weightKg: String(weight),
                status: "PENDING_PRESSING",
              })
              .returning();
            bales.push({ ...bale, _product: product });
            baleIndex++;
          }
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Multi-product pressing batch: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating multi-product pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/create-batch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(5, '0')}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating bale batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 8. Factory Pressing Batches
  // ───────────────────────────────────────────────

  app.get("/api/factory/pressing-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batches = await db
        .select({
          id: factoryPressingBatches.id,
          companyId: factoryPressingBatches.companyId,
          mixBatchId: factoryPressingBatches.mixBatchId,
          productId: factoryPressingBatches.productId,
          expectedCount: factoryPressingBatches.expectedCount,
          status: factoryPressingBatches.status,
          notes: factoryPressingBatches.notes,
          createdBy: factoryPressingBatches.createdBy,
          finalizedAt: factoryPressingBatches.finalizedAt,
          finalizedLocationId: factoryPressingBatches.finalizedLocationId,
          createdAt: factoryPressingBatches.createdAt,
          productName: factoryBaleProducts.name,
          productCode: factoryBaleProducts.code,
          articleCode: factoryBaleProducts.articleCode,
        })
        .from(factoryPressingBatches)
        .leftJoin(factoryBaleProducts, eq(factoryPressingBatches.productId, factoryBaleProducts.id))
        .where(eq(factoryPressingBatches.companyId, companyId))
        .orderBy(desc(factoryPressingBatches.createdAt));

      const enriched = await Promise.all(
        batches.map(async (batch: any) => {
          const balesForBatch = await db
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.pressingBatchId, batch.id))
            .orderBy(factoryBales.referenceNumber);

          const pendingCount = balesForBatch.filter((b: any) => b.status === "PENDING_PRESSING").length;
          const finalizedCount = balesForBatch.filter((b: any) => b.status === "FINALIZED").length;

          return { ...batch, pendingCount, finalizedCount, bales: balesForBatch };
        })
      );

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching pressing batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/pressing-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const [batch] = await db
        .select()
        .from(factoryPressingBatches)
        .where(and(eq(factoryPressingBatches.id, id), eq(factoryPressingBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Pressing batch not found" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.pressingBatchId, id))
        .orderBy(factoryBales.referenceNumber);

      res.json({ ...batch, bales });
    } catch (error: any) {
      console.error("Error fetching pressing batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 9. Factory Finalize
  // ───────────────────────────────────────────────

  app.post("/api/factory/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pressingBatchId, scannedBaleIds, erpLocationId, mixBatchId } = req.body;

      if (!pressingBatchId || !scannedBaleIds || !erpLocationId || !mixBatchId) {
        return res.status(400).json({ message: "pressingBatchId, scannedBaleIds, erpLocationId, and mixBatchId are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [pressingBatch] = await tx
          .select()
          .from(factoryPressingBatches)
          .where(and(eq(factoryPressingBatches.id, pressingBatchId), eq(factoryPressingBatches.companyId, companyId)));

        if (!pressingBatch) throw new Error("Pressing batch not found");
        if (pressingBatch.status === "FINALIZED") throw new Error("Pressing batch is already fully finalized");

        const [mixBatch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)))
          .for("update");

        if (!mixBatch) throw new Error("Mix batch not found");

        const mixRemaining = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg);

        const pendingBales = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.pressingBatchId, pressingBatchId), eq(factoryBales.status, "PENDING_PRESSING")));

        const scannedSet = new Set(scannedBaleIds);
        const pendingBaleIds = new Set(pendingBales.map((b: any) => b.id));
        for (const scannedId of scannedBaleIds) {
          if (!pendingBaleIds.has(scannedId)) {
            throw new Error(`Bale ID ${scannedId} is not a valid pending bale for this pressing batch`);
          }
        }

        const balesToFinalize = pendingBales.filter((b: any) => scannedSet.has(b.id));
        const missingBales = pendingBales.filter((b: any) => !scannedSet.has(b.id));

        let totalWeight = 0;
        for (const bale of balesToFinalize) {
          totalWeight += parseFloat(bale.weightKg);
        }

        if (totalWeight > mixRemaining + 0.001) {
          throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
        }

        // Derive bale cost from raw stock source prices (not mix batch blended cost).
        // This ensures duty updates after mix batch creation are reflected in bale costs.
        const mixSources = await tx
          .select({
            weightKg: factoryMixBatchSources.weightKg,
            costPerKg: factoryMixBatchSources.costPerKg,
            containerId: factoryMixBatchSources.containerId,
          })
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, mixBatchId));

        let costPerKg: number;
        if (mixSources.length > 0) {
          const sourceContainerIds = mixSources.map((s: any) => s.containerId).filter(Boolean) as number[];
          const rawStockCostMap: Record<number, number> = {};
          if (sourceContainerIds.length > 0) {
            const rawStockRecs = await tx
              .select({ containerId: factoryRawStock.containerId, costPerKg: factoryRawStock.costPerKg })
              .from(factoryRawStock)
              .where(inArray(factoryRawStock.containerId, sourceContainerIds));
            for (const r of rawStockRecs) {
              rawStockCostMap[r.containerId] = parseFloat(r.costPerKg);
            }
          }
          let sourceTotalCost = 0;
          let sourceTotalWeight = 0;
          for (const src of mixSources) {
            const w = parseFloat(src.weightKg);
            const c = src.containerId && rawStockCostMap[src.containerId] !== undefined
              ? rawStockCostMap[src.containerId]
              : parseFloat(src.costPerKg);
            sourceTotalCost += w * c;
            sourceTotalWeight += w;
          }
          costPerKg = sourceTotalWeight > 0 ? sourceTotalCost / sourceTotalWeight : parseFloat(mixBatch.costPerKg);
        } else {
          costPerKg = parseFloat(mixBatch.costPerKg);
        }

        const now = new Date();
        const updatedBales: any[] = [];

        for (const bale of balesToFinalize) {
          const weight = parseFloat(bale.weightKg);
          const baleTotalCost = weight * costPerKg;

          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "FINALIZED",
              erpLocationId,
              mixBatchId,
              costPerKg: String(costPerKg),
              totalCost: String(baleTotalCost),
              finalizedAt: now,
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          updatedBales.push(updated);
        }

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalWeight}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));

        const isFullyFinalized = missingBales.length === 0;
        await tx
          .update(factoryPressingBatches)
          .set({
            status: isFullyFinalized ? "FINALIZED" : "PARTIALLY_FINALIZED",
            mixBatchId,
            finalizedAt: isFullyFinalized ? now : null,
            finalizedLocationId: erpLocationId,
          })
          .where(eq(factoryPressingBatches.id, pressingBatchId));

        const productIds: number[] = [];
        for (const b of balesToFinalize) {
          if (b.productId && !productIds.includes(b.productId)) productIds.push(b.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];

        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const categoryIdSet = new Set<number>();
        factoryProducts.forEach((p: any) => { if (p.categoryId) categoryIdSet.add(p.categoryId); });
        const categoryIds = Array.from(categoryIdSet);
        const factoryCats = categoryIds.length > 0
          ? await tx.select().from(factoryCategories).where(inArray(factoryCategories.id, categoryIds))
          : [];
        const categoryMap = new Map<number, any>(factoryCats.map((c: any) => [c.id, c]));

        const stockGroupCache = new Map<string, number>();

        const stockItemCache = new Map<string, number>();

        for (const bale of balesToFinalize) {
          const factoryProduct = productMap.get(bale.productId as number);
          if (!factoryProduct) continue;

          const itemCode: string = factoryProduct.articleCode || factoryProduct.code;
          if (!itemCode) continue;

          let stockGroupId: number | null = null;
          if (factoryProduct.categoryId) {
            const cat = categoryMap.get(factoryProduct.categoryId);
            if (cat) {
              const catName = cat.name as string;
              const cached = stockGroupCache.get(catName);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));

                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
              }
            }
          }

          let erpStockItemId: number | undefined = stockItemCache.get(itemCode);

          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
              if (stockGroupId && !existing.stockGroupId) {
                await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
              }
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({
                  companyId,
                  code: itemCode,
                  name: factoryProduct.name as string,
                  uom: "BALE",
                  active: true,
                  ...(stockGroupId ? { stockGroupId } : {}),
                })
                .returning({ id: stockItems.id });
              erpStockItemId = created.id;
            }
            stockItemCache.set(itemCode, erpStockItemId!);
          }

          const weight = parseFloat(bale.weightKg);
          const baleCostPerKg = parseFloat(bale.costPerKg || "0");
          const baleRate = weight * baleCostPerKg;

          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, baleRate);
        }

        return {
          updated: updatedBales.length,
          bales: updatedBales,
          missingBales: missingBales.map((b: any) => ({
            id: b.id,
            referenceNumber: b.referenceNumber,
            productName: b.productName,
            articleCode: b.articleCode,
            weightKg: b.weightKg,
          })),
          isFullyFinalized,
        };
      });

      const today = new Date().toISOString().split('T')[0];
      const [finalizeLocation] = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, erpLocationId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_FINALIZE",
        referenceId: pressingBatchId,
        description: `Finalized ${result.updated} bale${result.updated !== 1 ? "s" : ""} to ${finalizeLocation?.name || `location #${erpLocationId}`}`,
        amountCurrency: 0,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Backfill historical bale costs from raw stock source prices
  app.post("/api/factory/bales/backfill-costs", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const balesWithMix = await db
        .select({
          id: factoryBales.id,
          weightKg: factoryBales.weightKg,
          mixBatchId: factoryBales.mixBatchId,
          articleCode: factoryBales.articleCode,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "FINALIZED"),
          sql`${factoryBales.mixBatchId} IS NOT NULL`
        ));

      if (balesWithMix.length === 0) return res.json({ updated: 0 });

      const uniqueMixIds = [...new Set(balesWithMix.map((b: any) => b.mixBatchId))] as number[];

      const allSources = await db
        .select({
          mixBatchId: factoryMixBatchSources.mixBatchId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          containerId: factoryMixBatchSources.containerId,
        })
        .from(factoryMixBatchSources)
        .where(inArray(factoryMixBatchSources.mixBatchId, uniqueMixIds));

      const allContainerIds = [...new Set(allSources.map((s: any) => s.containerId).filter(Boolean))] as number[];
      const rawStockCostMap: Record<number, number> = {};
      if (allContainerIds.length > 0) {
        const rawStockRecs = await db
          .select({ containerId: factoryRawStock.containerId, costPerKg: factoryRawStock.costPerKg })
          .from(factoryRawStock)
          .where(inArray(factoryRawStock.containerId, allContainerIds));
        for (const r of rawStockRecs) {
          rawStockCostMap[r.containerId] = parseFloat(r.costPerKg);
        }
      }

      const mixCostMap: Record<number, number> = {};
      for (const mixId of uniqueMixIds) {
        const sources = allSources.filter((s: any) => s.mixBatchId === mixId);
        if (sources.length === 0) continue;
        let totalCost = 0, totalWt = 0;
        for (const src of sources) {
          const w = parseFloat(src.weightKg);
          const c = src.containerId && rawStockCostMap[src.containerId] !== undefined
            ? rawStockCostMap[src.containerId]
            : parseFloat(src.costPerKg);
          totalCost += w * c;
          totalWt += w;
        }
        if (totalWt > 0) mixCostMap[mixId] = totalCost / totalWt;
      }

      let updated = 0;
      const now = new Date();
      for (const bale of balesWithMix) {
        const isGarbage = bale.articleCode?.startsWith("HMD16");
        if (isGarbage) continue;
        const newCost = bale.mixBatchId ? mixCostMap[bale.mixBatchId] : undefined;
        if (newCost === undefined) continue;
        const newTotal = parseFloat(bale.weightKg) * newCost;
        await db
          .update(factoryBales)
          .set({ costPerKg: String(newCost), totalCost: String(newTotal), updatedAt: now })
          .where(eq(factoryBales.id, bale.id));
        updated++;
      }

      res.json({ updated, message: `Updated cost for ${updated} finalized bales using raw stock prices.` });
    } catch (error: any) {
      console.error("Error backfilling bale costs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 10. Factory Bales queries
  // ───────────────────────────────────────────────

  app.get("/api/factory/bales/export-full.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { date } = req.query;
      if (!date) return res.status(400).json({ message: "date query parameter is required (YYYY-MM-DD)" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        sql`${factoryBales.finalizedAt}::date = ${date}`,
      ];

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(factoryBales.id);

      if (bales.length === 0) {
        return res.status(404).json({ message: `No bales found for date ${date}` });
      }

      const locIds = [...new Set(bales.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locs = locIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locIds))
        : [];
      const locMap = new Map(locs.map((l: any) => [l.id, l]));

      const [fCfgBale] = await db.select({ hideAvgCost: factorySettings.hideAvgCost }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const showCostBale = !fCfgBale?.hideAvgCost;

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bales");

      const baleCols: any[] = [
        { header: "Reference Number", key: "referenceNumber", width: 22 },
        { header: "Article Code", key: "articleCode", width: 20 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Category", key: "category", width: 18 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (showCostBale) {
        baleCols.push({ header: "Cost Per Kg", key: "costPerKg", width: 14 });
        baleCols.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleCols.push(
        { header: "Location Code", key: "locationCode", width: 16 },
        { header: "Location ID", key: "locationId", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Mix Batch ID", key: "mixBatchId", width: 14 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Finalized At", key: "finalizedAt", width: 22 },
      );
      sheet.columns = baleCols;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      });

      for (const bale of bales) {
        const loc = locMap.get(bale.erpLocationId);
        const baleRowData: any = {
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode ?? "",
          productName: bale.productName ?? "",
          category: bale.category ?? "",
          weightKg: parseFloat(bale.weightKg || "0"),
        };
        if (showCostBale) {
          baleRowData.costPerKg = parseFloat(bale.costPerKg || "0");
          baleRowData.totalCost = parseFloat(bale.totalCost || "0");
        }
        baleRowData.locationCode = loc ? `${loc.code} - ${loc.name}` : "";
        baleRowData.locationId = bale.erpLocationId ?? "";
        baleRowData.status = bale.status ?? "IN_STOCK";
        baleRowData.mixBatchId = bale.mixBatchId ?? "";
        baleRowData.baleCode = bale.baleCode ?? "";
        baleRowData.grade = bale.grade ?? "";
        baleRowData.finalizedAt = bale.finalizedAt ? new Date(bale.finalizedAt).toISOString() : "";
        sheet.addRow(baleRowData);
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bales_export_${date}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting full bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/reimport", requireAuth, async (req: any, res: any) => {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: "File upload error" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) return res.status(400).json({ message: "No worksheet found in file" });

        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber] = String(cell.value || "").trim().toLowerCase();
        });

        const refIdx = headers.findIndex(h => h.includes("reference"));
        const articleIdx = headers.findIndex(h => h.includes("article"));
        const nameIdx = headers.findIndex(h => h.includes("product name"));
        const catIdx = headers.findIndex(h => h.includes("category"));
        const weightIdx = headers.findIndex(h => h.includes("weight"));
        const costPerKgIdx = headers.findIndex(h => h.includes("cost per kg"));
        const totalCostIdx = headers.findIndex(h => h.includes("total cost"));
        const locIdIdx = headers.findIndex(h => h.includes("location id"));
        const statusIdx = headers.findIndex(h => h.includes("status"));
        const mixBatchIdx = headers.findIndex(h => h.includes("mix batch"));
        const baleCodeIdx = headers.findIndex(h => h.includes("bale code"));
        const gradeIdx = headers.findIndex(h => h.includes("grade"));
        const finalizedIdx = headers.findIndex(h => h.includes("finalized"));

        if (refIdx < 0 || nameIdx < 0 || weightIdx < 0) {
          return res.status(400).json({ message: "Excel must have at least: Reference Number, Product Name, Weight (kg) columns" });
        }

        const rows: any[] = [];
        const fileRefSet = new Set<string>();
        const fileDuplicates: string[] = [];

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const refNum = String(row.getCell(refIdx + 1).value || "").trim();
          if (!refNum) return;

          if (fileRefSet.has(refNum)) {
            fileDuplicates.push(refNum);
          }
          fileRefSet.add(refNum);

          rows.push({
            referenceNumber: refNum,
            articleCode: articleIdx >= 0 ? String(row.getCell(articleIdx + 1).value || "").trim() : "",
            productName: nameIdx >= 0 ? String(row.getCell(nameIdx + 1).value || "").trim() : "",
            category: catIdx >= 0 ? String(row.getCell(catIdx + 1).value || "").trim() : "",
            weightKg: weightIdx >= 0 ? String(parseFloat(String(row.getCell(weightIdx + 1).value || "0")) || "0") : "0",
            costPerKg: costPerKgIdx >= 0 ? String(parseFloat(String(row.getCell(costPerKgIdx + 1).value || "0")) || "0") : "0",
            totalCost: totalCostIdx >= 0 ? String(parseFloat(String(row.getCell(totalCostIdx + 1).value || "0")) || "0") : "0",
            erpLocationId: locIdIdx >= 0 ? parseInt(String(row.getCell(locIdIdx + 1).value || "0")) || null : null,
            status: statusIdx >= 0 ? String(row.getCell(statusIdx + 1).value || "IN_STOCK").trim() : "IN_STOCK",
            mixBatchId: mixBatchIdx >= 0 ? parseInt(String(row.getCell(mixBatchIdx + 1).value || "0")) || null : null,
            baleCode: baleCodeIdx >= 0 ? String(row.getCell(baleCodeIdx + 1).value || "").trim() : "",
            grade: gradeIdx >= 0 ? String(row.getCell(gradeIdx + 1).value || "").trim() : "",
            finalizedAt: finalizedIdx >= 0 ? String(row.getCell(finalizedIdx + 1).value || "").trim() : "",
          });
        });

        if (rows.length === 0) {
          return res.status(400).json({ message: "No bale rows found in Excel" });
        }

        if (fileDuplicates.length > 0) {
          return res.status(400).json({ message: `Duplicate reference numbers within the file: ${fileDuplicates.slice(0, 10).join(", ")}` });
        }

        const result = await db.transaction(async (tx: any) => {
          const existingBarcodes = await tx
            .select({ referenceNumber: factoryBales.referenceNumber })
            .from(factoryBales)
            .where(eq(factoryBales.companyId, companyId));
          const existingRefSet = new Set(existingBarcodes.map((b: any) => b.referenceNumber));

          const duplicates = rows.filter(r => existingRefSet.has(r.referenceNumber));
          if (duplicates.length > 0) {
            throw new Error(`These reference numbers already exist: ${duplicates.slice(0, 10).map(d => d.referenceNumber).join(", ")}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ""}`);
          }

          const validLocIds = new Set<number>();
          const allLocs = await tx.select({ id: locations.id }).from(locations).where(eq(locations.companyId, companyId));
          allLocs.forEach((l: any) => validLocIds.add(l.id));

          const invalidLocRows = rows.filter(r => r.erpLocationId && !validLocIds.has(r.erpLocationId));
          if (invalidLocRows.length > 0) {
            throw new Error(`Invalid location IDs found: ${invalidLocRows.map(r => `${r.referenceNumber} (loc ${r.erpLocationId})`).slice(0, 5).join(", ")}`);
          }

          const allProducts = await tx
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByName = new Map(allProducts.map((p: any) => [p.name.toLowerCase(), p]));
          const productByArticle = new Map(allProducts.map((p: any) => [p.articleCode?.toLowerCase(), p]));

          const allCategories = await tx.select().from(factoryCategories).where(eq(factoryCategories.companyId, companyId));
          const categoryByName = new Map(allCategories.map((c: any) => [c.name?.toLowerCase(), c]));

          const createdBales: any[] = [];
          let totalWeight = 0;

          for (const row of rows) {
            let product = (row.articleCode ? productByArticle.get(row.articleCode.toLowerCase()) : null) || productByName.get(row.productName.toLowerCase());
            if (!product) {
              const autoCode = row.articleCode || ("IMP-" + row.productName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 20) + "-" + Date.now().toString(36).slice(-4).toUpperCase());
              const categoryObj = row.category ? categoryByName.get(row.category.toLowerCase()) : null;
              const [newProduct] = await tx.insert(factoryBaleProducts).values({
                companyId,
                code: autoCode,
                articleCode: row.articleCode || autoCode,
                name: row.productName,
                active: true,
                ...(categoryObj ? { categoryId: categoryObj.id } : {}),
              }).returning();
              product = newProduct;
              productByName.set(row.productName.toLowerCase(), product);
              if (row.articleCode) productByArticle.set(row.articleCode.toLowerCase(), product);
            }

            let finalizedAt: Date | null = null;
            if (row.finalizedAt) {
              const parsed = new Date(row.finalizedAt);
              if (!isNaN(parsed.getTime())) finalizedAt = parsed;
            }
            if (!finalizedAt) finalizedAt = new Date();

            const originalStatus = row.status || "IN_STOCK";

            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                productId: product.id,
                erpLocationId: row.erpLocationId,
                baleCode: row.baleCode || product.code,
                referenceNumber: row.referenceNumber,
                articleCode: row.articleCode || product.articleCode,
                productName: row.productName,
                category: row.category || null,
                grade: row.grade || null,
                weightKg: row.weightKg,
                costPerKg: row.costPerKg,
                totalCost: row.totalCost,
                status: originalStatus,
                mixBatchId: row.mixBatchId,
                finalizedAt,
              })
              .returning();

            createdBales.push({ ...bale, _product: product });
            totalWeight += parseFloat(row.weightKg);
          }

          const stockGroupCache = new Map<string, number>();
          const stockItemCache = new Map<string, number>();

          for (const bale of createdBales) {
            if (bale.status === "REMOVED") continue;

            const itemCode: string = bale.articleCode || bale.baleCode;
            if (!itemCode) continue;
            const locId = bale.erpLocationId;
            if (!locId) continue;

            const product = bale._product;
            let stockGroupId: number | null = null;
            if (bale.category) {
              const catName = bale.category as string;
              const cached = stockGroupCache.get(catName);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));
                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
              }
            }

            let erpStockItemId = stockItemCache.get(itemCode);
            if (!erpStockItemId) {
              const [existing] = await tx
                .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
                .from(stockItems)
                .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

              if (existing) {
                erpStockItemId = existing.id;
                if (stockGroupId && !existing.stockGroupId) {
                  await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
                }
              } else {
                const [created] = await tx
                  .insert(stockItems)
                  .values({
                    companyId,
                    code: itemCode,
                    name: bale.productName as string,
                    uom: "BALE",
                    active: true,
                    ...(stockGroupId ? { stockGroupId } : {}),
                  })
                  .returning({ id: stockItems.id });
                erpStockItemId = created.id;
              }
              stockItemCache.set(itemCode, erpStockItemId!);
            }

            const costPerKg = parseFloat(bale.costPerKg || "0");
            const weight = parseFloat(bale.weightKg || "0");
            await adjustInventory(tx, locId, erpStockItemId!, 1, companyId, weight * costPerKg);
          }

          return { count: createdBales.length, totalWeight };
        });

        const today = new Date().toISOString().split("T")[0];
        await writeDaybookEntry(db, {
          companyId,
          txDate: today,
          txType: "BALE_REIMPORT",
          description: `Reimported ${result.count} bale(s) with original reference numbers (${result.totalWeight.toFixed(1)} kg)`,
        });

        res.json({ imported: result.count, totalWeight: result.totalWeight });
      } catch (error: any) {
        console.error("Error reimporting bales:", error);
        res.status(400).json({ message: error.message });
      }
    });
  });

  // GET /api/factory/bales/export-names.xlsx — Export all bales for bulk product-name editing
  app.get("/api/factory/bales/export-names.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId))
        .orderBy(factoryBales.id);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bales");

      sheet.columns = [
        { header: "ID (do not edit)", key: "id", width: 18 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Reference Number", key: "referenceNumber", width: 22 },
        { header: "Category", key: "category", width: 16 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Product Name", key: "productName", width: 30 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
      });
      const idHeaderCell = sheet.getCell("A1");
      idHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B7280" } };

      for (const bale of bales) {
        const row = sheet.addRow({
          id: bale.id,
          baleCode: bale.baleCode,
          referenceNumber: bale.referenceNumber,
          category: bale.category ?? "",
          grade: bale.grade ?? "",
          productName: bale.productName ?? "",
        });
        const idCell = row.getCell("id");
        idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        idCell.font = { color: { argb: "FF6B7280" } };
      }

      sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bale_names_${companyId}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting bale names:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/bulk-update-names — Upload Excel and update product_name in bulk
  app.post("/api/factory/bales/bulk-update-names", requireAuth, async (req: any, res: any) => {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: "File upload error" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const { read: readXlsx, utils } = await import("xlsx");
        const wb = readXlsx(req.file.buffer, { type: "buffer" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = utils.sheet_to_json(sheet, { defval: "" });

        let updated = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const row of rows) {
          const id = parseInt(row["ID (do not edit)"] ?? row["id"] ?? row["ID"]);
          const productName = String(row["Product Name"] ?? row["productName"] ?? "").trim();

          if (!id || isNaN(id)) { skipped++; continue; }
          if (!productName) { skipped++; continue; }

          const [bale] = await db
            .select()
            .from(factoryBales)
            .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

          if (!bale) { errors.push(`Bale ID ${id} not found`); skipped++; continue; }

          if (bale.productId) {
            await db
              .update(factoryBaleProducts)
              .set({ name: productName, updatedAt: new Date() })
              .where(and(eq(factoryBaleProducts.id, bale.productId), eq(factoryBaleProducts.companyId, companyId)));
          }

          await db
            .update(factoryBales)
            .set({ productName, updatedAt: new Date() })
            .where(eq(factoryBales.id, id));

          updated++;
        }

        res.json({ updated, skipped, errors });
      } catch (error: any) {
        console.error("Error bulk-updating bale names:", error);
        res.status(500).json({ message: error.message });
      }
    });
  });

  app.get("/api/factory/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { status, mixBatchId, pressingBatchId, locationId, productId } = req.query;

      const conditions: any[] = [eq(factoryBales.companyId, companyId)];

      if (status) conditions.push(eq(factoryBales.status, status as string));
      if (mixBatchId) conditions.push(eq(factoryBales.mixBatchId, parseInt(mixBatchId as string)));
      if (pressingBatchId) conditions.push(eq(factoryBales.pressingBatchId, parseInt(pressingBatchId as string)));
      if (locationId) conditions.push(eq(factoryBales.erpLocationId, parseInt(locationId as string)));
      if (productId) conditions.push(eq(factoryBales.productId, parseInt(productId as string)));

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.createdAt));

      const productIds: number[] = Array.from(new Set(bales.map((b: any) => b.productId).filter(Boolean)));
      const batchIds: number[] = Array.from(new Set(bales.map((b: any) => b.mixBatchId).filter(Boolean)));

      const products = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
        : [];
      const batches = batchIds.length > 0
        ? await db.select().from(factoryMixBatches).where(inArray(factoryMixBatches.id, batchIds))
        : [];

      const productMap = new Map(products.map((p: any) => [p.id, p]));
      const batchMap = new Map(batches.map((b: any) => [b.id, b]));

      const baleIds = bales.map((b: any) => b.id).filter(Boolean);
      const lastPrintMap = new Map<number, string>();
      if (baleIds.length > 0) {
        const printRows = await db
          .select({
            productionBaleId: baleLabelPrints.productionBaleId,
            lastPrintedAt: sql<string>`MAX(${baleLabelPrints.printedAt})::timestamptz`.as("last_printed_at"),
          })
          .from(baleLabelPrints)
          .where(inArray(baleLabelPrints.productionBaleId, baleIds))
          .groupBy(baleLabelPrints.productionBaleId);
        for (const row of printRows) {
          if (row.productionBaleId) lastPrintMap.set(row.productionBaleId, row.lastPrintedAt);
        }
      }

      const results = bales.map((bale: any) => ({
        bale,
        product: bale.productId ? productMap.get(bale.productId) || null : null,
        mixBatch: bale.mixBatchId ? batchMap.get(bale.mixBatchId) || null : null,
        lastPrintedAt: lastPrintMap.get(bale.id) || null,
      }));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/bulk-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { ids, status } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids must be a non-empty array" });
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = ["PENDING_PRESSING","LABEL_PRINTED","PRESSED","FINALIZED","IN_STOCK","RESERVED","RESERVED_FOR_ORDER","SOLD","REPACKED","REMOVED"];
      if (!ALLOWED.includes(status)) return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      const result = await db
        .update(factoryBales)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, ids.map(Number))))
        .returning({ id: factoryBales.id });

      res.json({ updated: result.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });

      const { status } = req.body;
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = ["PENDING_PRESSING","LABEL_PRINTED","PRESSED","FINALIZED","IN_STOCK","RESERVED","RESERVED_FOR_ORDER","SOLD","REPACKED","REMOVED"];
      if (!ALLOWED.includes(status)) return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      const [updated] = await db
        .update(factoryBales)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)))
        .returning({ id: factoryBales.id, status: factoryBales.status });

      if (!updated) return res.status(404).json({ message: "Bale not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/bales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });

      const [updated] = await db
        .update(factoryBales)
        .set({ status: "REMOVED", updatedAt: new Date() })
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)))
        .returning({ id: factoryBales.id });

      if (!updated) return res.status(404).json({ message: "Bale not found" });
      res.json({ message: "Bale removed" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/product-name", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }

      const [bale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

      if (!bale) return res.status(404).json({ message: "Bale not found" });

      if (bale.productId) {
        await db
          .update(factoryBaleProducts)
          .set({ name: name.trim(), updatedAt: new Date() })
          .where(and(eq(factoryBaleProducts.id, bale.productId), eq(factoryBaleProducts.companyId, companyId)));
      }

      await db
        .update(factoryBales)
        .set({ productName: name.trim(), updatedAt: new Date() })
        .where(eq(factoryBales.id, id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating bale product name:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/assign-worker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { workerId } = req.body;
      if (!workerId) return res.status(400).json({ message: "workerId is required" });
      const [bale] = await db.select().from(factoryBales).where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));
      if (!bale) return res.status(404).json({ message: "Bale not found" });
      if (bale.stockEntryDate && bale.finalizedBy) return res.status(403).json({ message: "Worker assignment is locked for stock-entry bales once a worker has been set." });
      const [updated] = await db.update(factoryBales).set({ finalizedBy: parseInt(workerId), updatedAt: new Date() }).where(eq(factoryBales.id, id)).returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning worker to bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk assign worker to multiple bales (for stock entry history groups) ──
  app.patch("/api/factory/bales/bulk-assign-worker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { baleIds, workerId } = req.body;
      if (!Array.isArray(baleIds) || baleIds.length === 0) return res.status(400).json({ message: "baleIds array is required" });
      if (!workerId) return res.status(400).json({ message: "workerId is required" });
      const numericIds = baleIds.map(Number).filter(n => !isNaN(n));
      const numericWorkerId = parseInt(workerId);
      await db.update(factoryBales)
        .set({ finalizedBy: numericWorkerId, updatedAt: new Date() })
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, numericIds)));
      res.json({ updated: numericIds.length, workerId: numericWorkerId });
    } catch (error: any) {
      console.error("Error bulk-assigning worker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/:id/repack", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const result = await db.transaction(async (tx: any) => {
        const [originalBale] = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

        if (!originalBale) throw new Error("Bale not found");
        if (originalBale.status === "REPACKED") throw new Error("Bale has already been repacked");
        if (originalBale.status === "SOLD") throw new Error("Cannot repack a sold bale");

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + 1 })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100877,
          });
        }

        const newRefNum = `REF${String(nextNumber).padStart(5, '0')}`;

        const [newBale] = await tx
          .insert(factoryBales)
          .values({
            companyId: originalBale.companyId,
            mixBatchId: originalBale.mixBatchId,
            productId: originalBale.productId,
            pressingBatchId: originalBale.pressingBatchId,
            erpLocationId: originalBale.erpLocationId,
            baleCode: originalBale.baleCode,
            referenceNumber: newRefNum,
            articleCode: originalBale.articleCode,
            productName: originalBale.productName,
            category: originalBale.category,
            grade: originalBale.grade,
            quantity: originalBale.quantity,
            weightKg: originalBale.weightKg,
            costPerKg: originalBale.costPerKg,
            totalCost: originalBale.totalCost,
            status: "IN_STOCK",
          })
          .returning();

        await tx
          .update(factoryBales)
          .set({ status: "REPACKED", updatedAt: new Date() })
          .where(eq(factoryBales.id, id));

        return { originalBale, newBale, newRefNum };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error repacking bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/stock-entry-history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, workerId, productId, locationId, status, search, includeUnassigned } = req.query as Record<string, string>;

      const today = new Date().toISOString().split("T")[0];
      const effectiveStart = startDate || today;
      const effectiveEnd = endDate || today;

      const workerFilter = workerId ? sql`AND fb.finalized_by = ${parseInt(workerId)}` : sql``;
      const productFilter = productId ? sql`AND fb.product_id = ${parseInt(productId)}` : sql``;
      const locationFilter = locationId ? sql`AND fb.erp_location_id = ${parseInt(locationId)}` : sql``;
      const statusFilter = status ? sql`AND fb.status = ${status}` : sql``;
      const searchFilter = search ? sql`AND LOWER(fb.reference_number) LIKE ${'%' + search.toLowerCase() + '%'}` : sql``;
      const unassignedFilter = includeUnassigned === 'false' ? sql`AND fb.finalized_by IS NOT NULL` : sql``;

      const rows = await db.execute(sql`
        SELECT
          fb.stock_entry_date::text AS "stockEntryDate",
          fb.erp_location_id AS "erpLocationId",
          COALESCE(l.name, 'Unknown') AS "locationName",
          fb.finalized_by AS "workerId",
          fw.full_name AS "workerName",
          fb.product_id AS "productId",
          fbp.name AS "productName",
          fbp.article_code AS "articleCode",
          COUNT(*)::int AS "baleCount",
          ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
          ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3) AS "avgWeight",
          MIN(fb.finalized_at) AS "firstFinalizedAt",
          MAX(fb.finalized_at) AS "lastFinalizedAt",
          JSON_AGG(JSON_BUILD_OBJECT(
            'id', fb.id,
            'referenceNumber', fb.reference_number,
            'weightKg', fb.weight_kg,
            'status', fb.status,
            'finalizedAt', fb.finalized_at,
            'stockEntryDate', fb.stock_entry_date::text,
            'locationName', COALESCE(l.name, 'Unknown'),
            'workerName', fw.full_name,
            'productName', fbp.name,
            'articleCode', fbp.article_code
          ) ORDER BY fb.finalized_at ASC) AS "bales"
        FROM factory_bales fb
        LEFT JOIN factory_workers fw ON fb.finalized_by = fw.id AND fw.company_id = ${companyId}
        LEFT JOIN factory_bale_products fbp ON fb.product_id = fbp.id AND fbp.company_id = ${companyId}
        LEFT JOIN locations l ON fb.erp_location_id = l.id AND l.company_id = ${companyId}
        WHERE fb.company_id = ${companyId}
          AND fb.stock_entry_date IS NOT NULL
          AND fb.stock_entry_date >= ${effectiveStart}
          AND fb.stock_entry_date <= ${effectiveEnd}
          ${workerFilter}
          ${productFilter}
          ${locationFilter}
          ${statusFilter}
          ${searchFilter}
          ${unassignedFilter}
        GROUP BY fb.stock_entry_date, fb.erp_location_id, l.name, fb.finalized_by, fw.full_name, fb.product_id, fbp.name, fbp.article_code
        ORDER BY fb.stock_entry_date DESC, l.name NULLS LAST, fw.full_name NULLS LAST, fbp.name NULLS LAST
      `);

      res.json(rows.rows);
    } catch (error: any) {
      console.error("Error fetching stock entry history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Stock Entry History: PDF Export ──────────────────────────────────────
  app.get("/api/factory/bales/stock-entry-history/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, workerId, productId, locationId, status, search, includeUnassigned } = req.query as Record<string, string>;

      const today = new Date().toISOString().split("T")[0];
      const effectiveStart = startDate || today;
      const effectiveEnd = endDate || today;

      const workerFilter = workerId ? sql`AND fb.finalized_by = ${parseInt(workerId)}` : sql``;
      const productFilter = productId ? sql`AND fb.product_id = ${parseInt(productId)}` : sql``;
      const locationFilter = locationId ? sql`AND fb.erp_location_id = ${parseInt(locationId)}` : sql``;
      const statusFilter = status ? sql`AND fb.status = ${status}` : sql``;
      const searchFilter = search ? sql`AND LOWER(fb.reference_number) LIKE ${'%' + search.toLowerCase() + '%'}` : sql``;
      const unassignedFilter = includeUnassigned === 'false' ? sql`AND fb.finalized_by IS NOT NULL` : sql``;

      const rows = await db.execute(sql`
        SELECT
          fb.stock_entry_date::text AS "stockEntryDate",
          fb.erp_location_id AS "erpLocationId",
          COALESCE(l.name, 'Unknown') AS "locationName",
          fb.finalized_by AS "workerId",
          fw.full_name AS "workerName",
          fb.product_id AS "productId",
          fbp.name AS "productName",
          fbp.article_code AS "articleCode",
          COUNT(*)::int AS "baleCount",
          ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
          ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3) AS "avgWeight",
          MIN(fb.finalized_at) AS "firstFinalizedAt",
          MAX(fb.finalized_at) AS "lastFinalizedAt",
          JSON_AGG(JSON_BUILD_OBJECT(
            'id', fb.id,
            'referenceNumber', fb.reference_number,
            'weightKg', fb.weight_kg,
            'status', fb.status,
            'finalizedAt', fb.finalized_at,
            'stockEntryDate', fb.stock_entry_date::text,
            'locationName', COALESCE(l.name, 'Unknown'),
            'workerName', fw.full_name,
            'productName', fbp.name,
            'articleCode', fbp.article_code
          ) ORDER BY fb.finalized_at ASC) AS "bales"
        FROM factory_bales fb
        LEFT JOIN factory_workers fw ON fb.finalized_by = fw.id AND fw.company_id = ${companyId}
        LEFT JOIN factory_bale_products fbp ON fb.product_id = fbp.id AND fbp.company_id = ${companyId}
        LEFT JOIN locations l ON fb.erp_location_id = l.id AND l.company_id = ${companyId}
        WHERE fb.company_id = ${companyId}
          AND fb.stock_entry_date IS NOT NULL
          AND fb.stock_entry_date >= ${effectiveStart}
          AND fb.stock_entry_date <= ${effectiveEnd}
          ${workerFilter}
          ${productFilter}
          ${locationFilter}
          ${statusFilter}
          ${searchFilter}
          ${unassignedFilter}
        GROUP BY fb.stock_entry_date, fb.erp_location_id, l.name, fb.finalized_by, fw.full_name, fb.product_id, fbp.name, fbp.article_code
        ORDER BY fb.stock_entry_date DESC, l.name NULLS LAST, fw.full_name NULLS LAST, fbp.name NULLS LAST
      `);

      const groups: any[] = rows.rows;
      const totalBales = groups.reduce((s: number, g: any) => s + (g.baleCount || 0), 0);
      const totalWeight = groups.reduce((s: number, g: any) => s + parseFloat(g.totalWeight || "0"), 0);

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="stock-entry-history-${effectiveStart}-to-${effectiveEnd}.pdf"`);
      doc.pipe(res);

      const fmtN = (v: any, dec = 3) => parseFloat(v || "0").toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const NAVY = "#1F3864";
      const LIGHT_BLUE = "#EFF3FB";
      const STRIPE = "#F8F8F8";
      const GROUP_BG = "#E8ECF4";
      const pageW = 515; // usable width with 40px margin each side

      // ── Logo above header ────────────────────────────────────────────────
      const sehLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(sehLogoPath)) {
        try { doc.image(sehLogoPath, (doc.page.width - 200) / 2, 10, { width: 200 }); } catch {}
      }

      // ── Header bar ──────────────────────────────────────────────────────
      doc.rect(40, 100, pageW, 44).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13)
        .text("Stock Entry History", 44, 105, { width: 340 });
      doc.font("Helvetica").fontSize(8)
        .text("Factory Bales Report", 44, 120, { width: 300 });
      const generatedStr = `Generated: ${new Date().toLocaleDateString("en-GB")}`;
      doc.fontSize(8).text(generatedStr, 400, 120, { width: 155, align: "right" });

      // ── Sub-header: period & summary ─────────────────────────────────────
      const subY = 154;
      doc.fillColor("#000000").font("Helvetica").fontSize(9);
      doc.text(`Period: ${effectiveStart}  →  ${effectiveEnd}`, 40, subY);
      doc.font("Helvetica-Bold")
        .text(`${groups.length} groups   |   ${totalBales} bales   |   ${fmtN(totalWeight, 2)} kg total`, 40, subY + 13);
      if (search) doc.font("Helvetica").fontSize(8).fillColor("#555555").text(`Search filter: "${search}"`, 40, subY + 26);
      doc.fillColor("#000000");

      // ── Column layout ────────────────────────────────────────────────────
      // Date | Location | Worker | Product | Bales | Total KG | Avg KG
      const colX =   [40,   118,  218,  318,  420,  458,  500];
      const colW =   [78,   100,  100,  102,   38,   42,   55];
      const colHdr = ["Date", "Location", "Worker", "Product", "Bales", "Total KG", "Avg KG"];
      const colAln: Array<"left"|"right"> = ["left","left","left","left","right","right","right"];

      const tableTop = subY + (search ? 44 : 32);

      // header row
      doc.rect(40, tableTop, pageW, 14).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAln[i] });
      });

      doc.fillColor("#000000");
      let y = tableTop + 16;

      let rowIdx = 0;
      for (const g of groups) {
        // page break check — need room for group row + at least one bale row
        if (y > 780) { doc.addPage(); y = 40; }

        // group summary row
        doc.rect(40, y, pageW, 14).fill(GROUP_BG);
        doc.fillColor("#000000").font("Helvetica-Bold").fontSize(7.5);
        doc.text(g.stockEntryDate || "—", colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text(g.locationName || "—", colX[1] + 2, y + 3, { width: colW[1] - 4 });
        doc.text(g.workerName || "Unassigned", colX[2] + 2, y + 3, { width: colW[2] - 4 });
        const prodLabel = [g.productName, g.articleCode ? `(${g.articleCode})` : ""].filter(Boolean).join(" ");
        doc.text(prodLabel || "—", colX[3] + 2, y + 3, { width: colW[3] - 4 });
        doc.text(String(g.baleCount || 0), colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        doc.text(fmtN(g.totalWeight, 3), colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
        doc.text(fmtN(g.avgWeight, 3), colX[6] + 2, y + 3, { width: colW[6] - 4, align: "right" });
        y += 14;

        // bale detail rows
        const bales: any[] = g.bales || [];
        for (let bi = 0; bi < bales.length; bi++) {
          if (y > 790) { doc.addPage(); y = 40; }
          const b = bales[bi];
          if (bi % 2 === 1) { doc.rect(40, y, pageW, 12).fill(STRIPE); doc.fillColor("#000000"); }

          // indent indicator stripe on left
          doc.rect(40, y, 3, 12).fill("#9CB2D8");

          doc.font("Helvetica").fontSize(7);
          doc.fillColor("#333333");
          // Reference number in mono-style slot (Date col)
          doc.text(b.referenceNumber || "—", colX[0] + 5, y + 3, { width: colW[0] - 7 });
          // Location (same as group, skip repeat)
          doc.text("", colX[1] + 2, y + 3, { width: colW[1] - 4 });
          // Worker (same as group)
          doc.text("", colX[2] + 2, y + 3, { width: colW[2] - 4 });
          // Status
          doc.text(b.status || "—", colX[3] + 2, y + 3, { width: colW[3] - 4 });
          doc.text("1", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
          doc.text(fmtN(b.weightKg, 3), colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
          doc.fillColor("#000000");
          y += 12;
        }

        rowIdx++;
      }

      // ── Totals footer ─────────────────────────────────────────────────────
      if (y > 770) { doc.addPage(); y = 40; }
      y += 4;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 5;
      doc.rect(40, y, pageW, 16).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("TOTAL", colX[0] + 2, y + 4, { width: 200 });
      doc.text(String(totalBales), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      doc.text(fmtN(totalWeight, 3), colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting stock entry history PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/lookup/:barcode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const barcode = req.params.barcode;
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : null;
      const excludeIdsStr = req.query.excludeIds as string;
      const excludeIds = excludeIdsStr ? excludeIdsStr.split(",").map(Number).filter(n => !isNaN(n)) : [];

      let results: any[] = [];

      const baseConditions: any[] = [
        eq(factoryBales.companyId, companyId),
        or(
          eq(factoryBales.referenceNumber, barcode),
          eq(factoryBales.baleCode, barcode),
          eq(factoryBales.articleCode, barcode)
        ),
      ];
      if (batchId) {
        baseConditions.push(eq(factoryBales.pressingBatchId, batchId));
        baseConditions.push(eq(factoryBales.status, "PENDING_PRESSING"));
      }
      results = await db.select().from(factoryBales)
        .where(and(...baseConditions))
        .orderBy(factoryBales.id);

      if (results.length === 0) {
        const labelResults = await db
          .select()
          .from(baleLabelPrints)
          .where(
            and(
              eq(baleLabelPrints.companyId, companyId),
              eq(baleLabelPrints.referenceNumber, barcode)
            )
          );

        if (labelResults.length > 0 && labelResults[0].productionBaleId) {
          const labelBale = await db
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.id, labelResults[0].productionBaleId));
          if (labelBale.length > 0) {
            if (!batchId || labelBale[0].pressingBatchId === batchId) {
              results = labelBale;
            }
          }
        }
      }

      if (excludeIds.length > 0) {
        results = results.filter((b: any) => !excludeIds.includes(b.id));
      }

      if (results.length === 0) return res.status(404).json({ message: "Bale not found" });
      res.json(results[0]);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 11. Factory Production Summary
  // ───────────────────────────────────────────────

  app.get("/api/factory/production-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allBales = await db
        .select({
          status: factoryBales.status,
          weightKg: factoryBales.weightKg,
        })
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));

      const totalBales = allBales.length;
      let pendingCount = 0;
      let finalizedCount = 0;
      let pendingWeight = 0;
      let finalizedWeight = 0;

      for (const bale of allBales) {
        const weight = parseFloat(bale.weightKg) || 0;
        if (bale.status === "PENDING_PRESSING") {
          pendingCount++;
          pendingWeight += weight;
        } else if (bale.status === "FINALIZED") {
          finalizedCount++;
          finalizedWeight += weight;
        }
      }

      const mixBatches = await db
        .select({
          totalWeightKg: factoryMixBatches.totalWeightKg,
          usedKg: factoryMixBatches.usedKg,
        })
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId));

      let totalMixWeight = 0;
      let totalMixUsed = 0;
      for (const mb of mixBatches) {
        totalMixWeight += parseFloat(mb.totalWeightKg) || 0;
        totalMixUsed += parseFloat(mb.usedKg) || 0;
      }

      res.json({
        totalBales,
        pendingCount,
        finalizedCount,
        pendingWeight: pendingWeight.toFixed(3),
        finalizedWeight: finalizedWeight.toFixed(3),
        totalWeight: (pendingWeight + finalizedWeight).toFixed(3),
        mixBatchUtilization: {
          totalWeightKg: totalMixWeight.toFixed(3),
          usedKg: totalMixUsed.toFixed(3),
          remainingKg: (totalMixWeight - totalMixUsed).toFixed(3),
          utilizationPercent: totalMixWeight > 0 ? ((totalMixUsed / totalMixWeight) * 100).toFixed(1) : "0.0",
        },
      });
    } catch (error: any) {
      console.error("Error fetching production summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Dashboard KPIs
  // ───────────────────────────────────────────────

  app.get("/api/factory/dashboard-kpis", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const rawStockTotals = await db
        .select({
          totalReceived: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg}), 0)`,
          totalUsed: sql<string>`COALESCE(SUM(${factoryRawStock.usedKg}), 0)`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const totalReceived = parseFloat(rawStockTotals[0]?.totalReceived || "0");
      const totalUsed = parseFloat(rawStockTotals[0]?.totalUsed || "0");
      const closingStockKg = totalReceived - totalUsed;

      const todayMixBatches = await db
        .select({ totalWeightKg: factoryMixBatches.totalWeightKg })
        .from(factoryMixBatches)
        .where(
          and(
            eq(factoryMixBatches.companyId, companyId),
            sql`${factoryMixBatches.createdAt} >= ${todayStart}`
          )
        );

      const kgsUsedToday = todayMixBatches.reduce(
        (sum, mb) => sum + (parseFloat(mb.totalWeightKg as string) || 0), 0
      );
      const openingStockKg = closingStockKg + kgsUsedToday;

      const todayBales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          productName: factoryBales.productName,
          category: factoryBales.category,
          weightKg: factoryBales.weightKg,
          pressedAt: factoryBales.pressedAt,
          status: factoryBales.status,
        })
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.pressedAt} >= ${todayStart}`
          )
        );

      const balesPressedToday = todayBales.length;
      const totalBaleWeightToday = todayBales.reduce(
        (sum, b) => sum + (parseFloat(b.weightKg as string) || 0), 0
      );

      const categoryMap: Record<string, { count: number; totalKg: number }> = {};
      for (const bale of todayBales) {
        const name = bale.productName || bale.category || "Unknown";
        if (!categoryMap[name]) categoryMap[name] = { count: 0, totalKg: 0 };
        categoryMap[name].count++;
        categoryMap[name].totalKg += parseFloat(bale.weightKg as string) || 0;
      }
      const categories = Object.entries(categoryMap)
        .map(([name, data]) => ({ name, count: data.count, totalKg: parseFloat(data.totalKg.toFixed(3)) }))
        .sort((a, b) => b.count - a.count);

      res.json({
        openingStockKg: openingStockKg.toFixed(3),
        closingStockKg: closingStockKg.toFixed(3),
        balesPressedToday,
        kgsUsedToday: kgsUsedToday.toFixed(3),
        totalBaleWeightToday: totalBaleWeightToday.toFixed(3),
        categories,
        balesDetail: todayBales.map((b: any) => ({ ...b, quantity: 1 })),
      });
    } catch (error: any) {
      console.error("Error fetching factory dashboard KPIs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Import API Endpoints
  // ───────────────────────────────────────────────

  app.post("/api/factory/import/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { suppliers: supplierList } = req.body;
      if (!Array.isArray(supplierList) || supplierList.length === 0) {
        return res.status(400).json({ message: "No suppliers provided" });
      }

      let imported = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < supplierList.length; i++) {
        const s = supplierList[i];
        try {
          if (!s.name || !s.name.trim()) {
            errors.push(`Row ${i + 1}: Name is required`);
            continue;
          }

          const [existing] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, s.name.trim())));

          if (existing) {
            await db
              .update(factorySuppliers)
              .set({
                openingBalance: s.openingBalance || existing.openingBalance,
                contactPerson: s.contactPerson !== undefined ? s.contactPerson : existing.contactPerson,
                phone: s.phone !== undefined ? s.phone : existing.phone,
                email: s.email !== undefined ? s.email : existing.email,
                updatedAt: new Date(),
              })
              .where(eq(factorySuppliers.id, existing.id));
            updated++;
          } else {
            await db.insert(factorySuppliers).values({
              companyId,
              name: s.name.trim(),
              openingBalance: s.openingBalance || "0",
              contactPerson: s.contactPerson || null,
              phone: s.phone || null,
              email: s.email || null,
            });
            imported++;
          }
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, updated, errors });
    } catch (error: any) {
      console.error("Error importing suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (!item.containerNumber || !item.containerNumber.trim()) {
            errors.push(`Row ${i + 1}: Container number is required`);
            continue;
          }
          if (!item.receivedKg) {
            errors.push(`Row ${i + 1}: Received KG is required`);
            continue;
          }
          if (!item.costPerKg) {
            errors.push(`Row ${i + 1}: Cost per KG is required`);
            continue;
          }

          let supplierId: number | null = null;
          if (item.supplierName && item.supplierName.trim()) {
            const [supplier] = await db
              .select()
              .from(factorySuppliers)
              .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, item.supplierName.trim())));
            if (supplier) {
              supplierId = supplier.id;
            }
          }

          let [container] = await db
            .select()
            .from(factoryContainers)
            .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.containerNumber, item.containerNumber.trim())));

          if (!container) {
            [container] = await db.insert(factoryContainers).values({
              companyId,
              containerNumber: item.containerNumber.trim(),
              supplierId,
              totalKg: item.receivedKg,
              ratePerKg: item.costPerKg,
              arrivalDate: item.arrivalDate || null,
              status: "RECEIVED",
            }).returning();
          } else if (supplierId && !container.supplierId) {
            await db.update(factoryContainers).set({ supplierId }).where(eq(factoryContainers.id, container.id));
          }

          await db.insert(factoryRawStock).values({
            companyId,
            containerId: container.id,
            receivedKg: item.receivedKg,
            usedKg: item.usedKg || "0",
            costPerKg: item.costPerKg,
          });
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { bales } = req.body;
      if (!Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales provided" });
      }

      const maxRef = await db.select({ maxRef: sql`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` }).from(factoryBales).where(eq(factoryBales.companyId, companyId));
      let nextRef = Math.max((maxRef[0]?.maxRef || 0) + 1, 100876);

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < bales.length; i++) {
        const bale = bales[i];
        try {
          if (!bale.baleCode || !bale.baleCode.trim()) {
            errors.push(`Row ${i + 1}: Bale code is required`);
            continue;
          }
          if (!bale.weightKg) {
            errors.push(`Row ${i + 1}: Weight KG is required`);
            continue;
          }

          const referenceNumber = `REF${nextRef}`;
          nextRef++;

          const status = bale.status || "FINALIZED";
          const costPerKg = bale.costPerKg || "0";
          const weight = parseFloat(bale.weightKg);
          const cost = parseFloat(costPerKg);
          const totalCost = (weight * cost).toFixed(2);

          await db.insert(factoryBales).values({
            companyId,
            baleCode: bale.baleCode.trim(),
            referenceNumber,
            articleCode: bale.articleCode || null,
            productName: bale.productName || null,
            category: bale.category || null,
            grade: bale.grade || null,
            quantity: 1,
            weightKg: bale.weightKg,
            costPerKg,
            totalCost,
            status,
            finalizedAt: status === "FINALIZED" ? new Date() : null,
          });
          imported++;
          nextRef++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      // Sync the sequence table so future stock entries don't collide with imported refs
      const [existingSeq] = await db
        .select()
        .from(factoryBaleSequences)
        .where(eq(factoryBaleSequences.companyId, companyId));

      if (existingSeq) {
        if (nextRef > existingSeq.nextNumber) {
          await db
            .update(factoryBaleSequences)
            .set({ nextNumber: nextRef })
            .where(eq(factoryBaleSequences.id, existingSeq.id));
        }
      } else {
        await db.insert(factoryBaleSequences).values({
          companyId,
          nextNumber: nextRef,
        });
      }

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Opening Raw Stock Recalc Helper ────────────────────────────────────────
  // Allocation rule: for each supplierId, sum all factory_mix_batch_sources.weightKg
  // attributed to that supplier, then FIFO-allocate against that supplier's OPENING_BALANCE
  // factory_raw_stock records (ordered by offloadedAt ASC, id ASC).
  // Idempotent: resets usedKg to 0 on all OB records before recalculating.
  // Only OB raw stock (containers with status='OPENING_BALANCE') is touched.
  // Non-OB (container offload) raw stock is never modified.
  async function recalcOpeningStockUsage(companyId: number): Promise<{ suppliersProcessed: number; totalAllocatedKg: number; unmatchedKg: number }> {
    const obRawStocks = await db
      .select({
        id: factoryRawStock.id,
        receivedKg: factoryRawStock.receivedKg,
        supplierId: factoryContainers.supplierId,
        offloadedAt: factoryRawStock.offloadedAt,
      })
      .from(factoryRawStock)
      .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
      .where(and(
        eq(factoryRawStock.companyId, companyId),
        eq(factoryContainers.status, "OPENING_BALANCE")
      ))
      .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id);

    if (obRawStocks.length === 0) return { suppliersProcessed: 0, totalAllocatedKg: 0, unmatchedKg: 0 };

    const obIds = obRawStocks.map((r: any) => r.id);
    await db.update(factoryRawStock)
      .set({ usedKg: "0" })
      .where(inArray(factoryRawStock.id, obIds));

    const consumed = await db
      .select({
        supplierId: factoryMixBatchSources.supplierId,
        totalKg: sql<string>`COALESCE(SUM(${factoryMixBatchSources.weightKg}), '0')`,
      })
      .from(factoryMixBatchSources)
      .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
      .where(and(
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatchSources.supplierId} IS NOT NULL`
      ))
      .groupBy(factoryMixBatchSources.supplierId);

    const consumedBySupplier = new Map<number, number>();
    for (const row of consumed) {
      if (row.supplierId != null) {
        consumedBySupplier.set(row.supplierId, parseFloat(row.totalKg) || 0);
      }
    }

    const obBySupplier = new Map<number, typeof obRawStocks>();
    for (const r of obRawStocks) {
      if (r.supplierId == null) continue;
      if (!obBySupplier.has(r.supplierId)) obBySupplier.set(r.supplierId, []);
      obBySupplier.get(r.supplierId)!.push(r);
    }

    let totalAllocatedKg = 0;
    let unmatchedKg = 0;
    const suppliersProcessed = consumedBySupplier.size;

    for (const [supplierId, totalConsumed] of consumedBySupplier) {
      const records = obBySupplier.get(supplierId) || [];
      let remaining = totalConsumed;

      for (const rec of records) {
        if (remaining <= 0.001) break;
        const cap = parseFloat(rec.receivedKg as string) || 0;
        const deduct = Math.min(remaining, cap);
        await db.update(factoryRawStock)
          .set({ usedKg: String(deduct.toFixed(3)) })
          .where(eq(factoryRawStock.id, rec.id));
        remaining -= deduct;
        totalAllocatedKg += deduct;
      }

      if (remaining > 0.001) unmatchedKg += remaining;
    }

    return { suppliersProcessed, totalAllocatedKg, unmatchedKg };
  }

  app.post("/api/factory/raw-stock/recalc-opening", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const stats = await recalcOpeningStockUsage(companyId);
      res.json(stats);
    } catch (error: any) {
      console.error("Error recalculating opening stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/opening-raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      let imported = 0;
      const errors: string[] = [];

      const existingOBs = await db
        .select({ containerNumber: factoryContainers.containerNumber })
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), sql`${factoryContainers.containerNumber} LIKE ${"OB-%"}`));

      let nextNum = 1;
      for (const c of existingOBs) {
        const parts = c.containerNumber.split("-");
        const num = parseInt(parts[parts.length - 1]) || 0;
        if (num >= nextNum) nextNum = num + 1;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const supplierStr = String(item.supplier || "").trim();
          const kgVal = parseFloat(item.kg);
          const rateVal = parseFloat(item.costPerKg);
          const currency = String(item.currency || "USD").trim();
          const fxRate = parseFloat(item.fxRateToUsd || "1");
          const openingDate = String(item.openingDate || "").trim();

          if (!supplierStr) { errors.push(`Row ${i + 1}: supplier is required`); continue; }
          if (isNaN(kgVal) || kgVal <= 0) { errors.push(`Row ${i + 1}: kg must be > 0`); continue; }
          if (isNaN(rateVal) || rateVal < 0) { errors.push(`Row ${i + 1}: costPerKg must be >= 0`); continue; }
          if (!currency) { errors.push(`Row ${i + 1}: currency is required`); continue; }
          if (isNaN(fxRate) || fxRate <= 0) { errors.push(`Row ${i + 1}: fxRateToUsd must be > 0`); continue; }
          if (!openingDate) { errors.push(`Row ${i + 1}: openingDate is required`); continue; }

          const [supplier] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, supplierStr)));

          if (!supplier) { errors.push(`Row ${i + 1}: supplier "${supplierStr}" not found`); continue; }

          const costPerKgUsd = currency === "USD" ? rateVal : rateVal * fxRate;
          const containerNumber = `OB-${String(nextNum).padStart(4, "0")}`;
          nextNum++;

          const [container] = await db.insert(factoryContainers).values({
            companyId,
            containerNumber,
            supplierId: supplier.id,
            origin: "Opening Import",
            totalKg: String(kgVal),
            ratePerKg: String(rateVal),
            declaredKg: String(kgVal),
            actualReceivedKg: String(kgVal),
            finalPayableAmount: String(kgVal * rateVal),
            differenceKg: "0",
            currencyCode: currency,
            fxRateToUsd: String(fxRate),
            ratePerKgUsd: String(costPerKgUsd),
            finalPayableAmountUsd: String(kgVal * costPerKgUsd),
            notes: String(item.notes || "Opening stock import"),
            status: "OPENING_BALANCE",
          }).returning();

          await db.insert(factoryRawStock).values({
            companyId,
            containerId: container.id,
            receivedKg: String(kgVal),
            usedKg: "0",
            costPerKg: String(rateVal),
            costPerKgUsd: String(costPerKgUsd),
          });

          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      let recalcStats = null;
      if (imported > 0) {
        recalcStats = await recalcOpeningStockUsage(companyId);
      }

      res.json({ imported, errors, recalcStats });
    } catch (error: any) {
      console.error("Error importing opening raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/import/template/:type", requireAuth, async (req: any, res: any) => {
    try {
      const type = req.params.type;
      let csv = "";
      let filename = "";

      switch (type) {
        case "suppliers":
          csv = "name,openingBalance,contactPerson,phone,email";
          filename = "factory_suppliers_template.csv";
          break;
        case "raw-stock":
          csv = "containerNumber,supplierName,receivedKg,usedKg,costPerKg,arrivalDate";
          filename = "factory_raw_stock_template.csv";
          break;
        case "bales":
          csv = "baleCode,articleCode,productName,category,grade,weightKg,costPerKg,status";
          filename = "factory_bales_template.csv";
          break;
        case "opening-raw-stock":
          csv = "supplier,kg,costPerKg,currency,fxRateToUsd,openingDate,notes";
          filename = "factory_opening_raw_stock_template.csv";
          break;
        default:
          return res.status(400).json({ message: "Invalid template type. Use: suppliers, raw-stock, bales, or opening-raw-stock" });
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error generating template:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // HELPER: Recalculate order totals
  // ───────────────────────────────────────────────
  async function recalculateOrderTotals(dbConn: any, orderId: number) {
    const bales = await dbConn.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

    await dbConn.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

    const grouped: Record<string, { articleCode: string; baleName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
    for (const b of bales) {
      const key = b.articleCode || 'UNKNOWN';
      if (!grouped[key]) {
        grouped[key] = { articleCode: key, baleName: b.baleName || key, qty: 0, totalWeight: 0, totalPrice: 0 };
      }
      grouped[key].qty += 1;
      grouped[key].totalWeight += parseFloat(b.weight);
      grouped[key].totalPrice += parseFloat(b.priceUsed);
    }

    for (const line of Object.values(grouped)) {
      await dbConn.insert(customerOrderLines).values({
        orderId,
        articleCode: line.articleCode,
        baleName: line.baleName,
        qty: line.qty,
        weightPerBale: String(line.qty > 0 ? line.totalWeight / line.qty : 0),
        totalWeight: String(line.totalWeight),
        pricePerBale: String(line.qty > 0 ? line.totalPrice / line.qty : 0),
        totalPrice: String(line.totalPrice),
      });
    }

    const charges = await dbConn.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
    const freightAmount = charges.filter((c: any) => c.chargeType === 'FREIGHT').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const otherChargesTotal = charges.filter((c: any) => c.chargeType === 'OTHER').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const subtotalBales = bales.reduce((sum: number, b: any) => sum + parseFloat(b.priceUsed), 0);
    const grandTotal = subtotalBales + freightAmount + otherChargesTotal;

    await dbConn.update(customerOrders).set({
      subtotalBales: String(subtotalBales),
      freightAmount: String(freightAmount),
      otherChargesTotal: String(otherChargesTotal),
      grandTotal: String(grandTotal),
      totalQtyBales: bales.length,
      updatedAt: new Date(),
    }).where(eq(customerOrders.id, orderId));
  }

  // ───────────────────────────────────────────────
  // FX Rates CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { currencyCode } = req.query;
      const conditions: any[] = [eq(factoryFxRates.companyId, companyId)];
      if (currencyCode) conditions.push(eq(factoryFxRates.currencyCode, currencyCode as string));
      const results = await db.select().from(factoryFxRates).where(and(...conditions)).orderBy(desc(factoryFxRates.effectiveDate));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/latest/:currencyCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const today = new Date().toISOString().split("T")[0];
      try {
        const rate = await getOrFetchFxRateToUsd(companyId, currency, today);
        res.json({ rate, effectiveDate: today });
      } catch (err: any) {
        const [fallback] = await db.select().from(factoryFxRates)
          .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, currency)))
          .orderBy(desc(factoryFxRates.effectiveDate))
          .limit(1);
        if (fallback) {
          res.json({ rate: fallback.rateToUsd, effectiveDate: fallback.effectiveDate });
        } else {
          res.status(404).json({ message: err.message });
        }
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/:currencyCode/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const dateISO = req.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return res.status(400).json({ message: "Date must be YYYY-MM-DD format" });
      }
      const rate = await getOrFetchFxRateToUsd(companyId, currency, dateISO);
      res.json({ rate, effectiveDate: dateISO });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertFactoryFxRateSchema.parse({ ...req.body, companyId });
      const [rate] = await db.insert(factoryFxRates).values(parsed).returning();
      res.json(rate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/fx-rates/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const [deleted] = await db.delete(factoryFxRates)
        .where(and(eq(factoryFxRates.id, parseInt(req.params.id)), eq(factoryFxRates.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Rate not found" });
      res.json(deleted);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Daybook
  // ───────────────────────────────────────────────

}
