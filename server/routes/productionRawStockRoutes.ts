/**
 * Production raw-stock & mix-batch routes.
 *
 * Raw-stock listing/offload/available-containers and mix-batch CRUD plus
 * mix-batch source management. Extracted from baleRoutes.ts as a
 * sub-registrar; behaviour is unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import {
  productionRawStock,
  mixBatches,
  mixBatchSources,
  containers,
  suppliers,
  insertMixBatchSourceSchema,
} from "@shared/schema";

export function registerProductionRawStockRoutes(app: Express) {
  // Production Raw Stock API Routes
  app.get("/api/production-raw-stock", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockRows = await db
        .select({
          id: productionRawStock.id,
          companyId: productionRawStock.companyId,
          containerId: productionRawStock.containerId,
          receivedKg: productionRawStock.receivedKg,
          usedKg: productionRawStock.usedKg,
          costPerKg: productionRawStock.costPerKg,
          offloadedAt: productionRawStock.offloadedAt,
          containerNumber: containers.containerNumber,
          supplierId: containers.supplierId,
          supplierName: suppliers.legalName,
        })
        .from(productionRawStock)
        .leftJoin(containers, eq(productionRawStock.containerId, containers.id))
        .leftJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(eq(productionRawStock.companyId, companyId))
        .orderBy(desc(productionRawStock.offloadedAt));

      const result = rawStockRows.map((row) => {
        const received = parseFloat(row.receivedKg);
        const used = parseFloat(row.usedKg);
        const remaining = received - used;
        const cost = parseFloat(row.costPerKg);
        return {
          ...row,
          remainingKg: remaining.toFixed(3),
          valueRemaining: (remaining * cost).toFixed(2),
        };
      });

      res.json(result);
    } catch (error: any) {
      logger.error("Error fetching production raw stock:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/production-raw-stock/offload", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { containerId } = req.body;
      if (!containerId) {
        return res.status(400).json({ message: "Missing required field: containerId" });
      }

      const container = await storage.getContainerById(parseInt(containerId));
      if (!container || container.companyId !== companyId) {
        return res.status(404).json({ message: "Container not found" });
      }

      const finalReceivedKg = req.body.receivedKg || container.totalKg || null;
      const finalCostPerKg = req.body.costPerKg || container.ratePerKg || null;

      if (!finalReceivedKg || parseFloat(finalReceivedKg) <= 0) {
        return res
          .status(400)
          .json({ message: "Received weight is required. Container has no saved Total KG - please provide a value." });
      }
      if (!finalCostPerKg || parseFloat(finalCostPerKg) <= 0) {
        return res
          .status(400)
          .json({ message: "Cost per kg is required. Container has no saved Rate per KG - please provide a value." });
      }

      const existing = await db
        .select()
        .from(productionRawStock)
        .where(
          and(eq(productionRawStock.companyId, companyId), eq(productionRawStock.containerId, parseInt(containerId)))
        );

      if (existing.length > 0) {
        return res.status(409).json({ message: "Container already offloaded to production raw stock" });
      }

      const [record] = await db
        .insert(productionRawStock)
        .values({
          companyId,
          containerId: parseInt(containerId),
          receivedKg: finalReceivedKg.toString(),
          costPerKg: finalCostPerKg.toString(),
          usedKg: "0",
        })
        .returning();

      res.json(record);
    } catch (error: any) {
      logger.error("Error offloading container:", { error: error });
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/production-raw-stock/available-containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const offloadedIds = await db
        .select({ containerId: productionRawStock.containerId })
        .from(productionRawStock)
        .where(eq(productionRawStock.companyId, companyId));

      const offloadedIdList = offloadedIds.map((r) => r.containerId);

      const allContainers = await db
        .select()
        .from(containers)
        .where(and(eq(containers.companyId, companyId), eq(containers.status, "AVAILABLE")));

      const available = allContainers.filter((c) => !offloadedIdList.includes(c.id));
      res.json(available);
    } catch (error: any) {
      logger.error("Error fetching available containers:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Mix Batches API Routes
  app.get("/api/mix-batches", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const batches = await storage.getAllMixBatches(companyId);
      res.json(batches);
    } catch (error: any) {
      logger.error("Error fetching mix batches:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mix-batches/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      const batch = await storage.getMixBatchById(id, companyId);

      if (!batch) {
        return res.status(404).json({ message: "Mix batch not found" });
      }

      res.json(batch);
    } catch (error: any) {
      logger.error("Error fetching mix batch:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mix-batches", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId = req.session.userId;
      if (!companyId || !userId) return res.status(400).json({ message: "No company or user session" });

      const { sources, batchSources, name, ...batchData } = req.body;

      const hasSources = sources && Array.isArray(sources) && sources.length > 0;
      const hasBatchSources = batchSources && Array.isArray(batchSources) && batchSources.length > 0;

      if (!hasSources && !hasBatchSources) {
        return res.status(400).json({ message: "At least one container or batch source is required" });
      }

      const result = await db.transaction(async (tx) => {
        const year = new Date().getFullYear();
        const existingBatches = await tx
          .select({ id: mixBatches.id })
          .from(mixBatches)
          .where(eq(mixBatches.companyId, companyId));
        const batchNum = existingBatches.length + 1;
        const batchCode = batchData.batchCode || `MB-${year}-${String(batchNum).padStart(3, "0")}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const validatedSources: Array<{
          containerId?: number;
          sourceBatchId?: number;
          weightKg: number;
          costPerKg: number;
          totalCost: number;
        }> = [];

        // Process container sources
        if (hasSources) {
          for (const source of sources) {
            const cId = parseInt(source.containerId);
            const wKg = parseFloat(source.weightKg);
            const cPKg = parseFloat(source.costPerKg);

            if (isNaN(cId) || isNaN(wKg) || isNaN(cPKg) || wKg <= 0) {
              throw new Error("Invalid container source data");
            }

            const [rawStock] = await tx
              .select()
              .from(productionRawStock)
              .where(and(eq(productionRawStock.companyId, companyId), eq(productionRawStock.containerId, cId)))
              .for("update");

            if (!rawStock) {
              throw new Error(`Container ${cId} not found in production raw stock. Offload it first.`);
            }

            const remaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
            if (wKg > remaining + 0.001) {
              throw new Error(
                `Container ${rawStock.containerId} only has ${remaining.toFixed(3)} kg remaining, requested ${wKg}`
              );
            }

            const newUsed = parseFloat(rawStock.usedKg) + wKg;
            await tx
              .update(productionRawStock)
              .set({ usedKg: newUsed.toFixed(3) })
              .where(eq(productionRawStock.id, rawStock.id));

            const sCost = wKg * cPKg;
            totalWeightKg += wKg;
            totalCost += sCost;
            validatedSources.push({ containerId: cId, weightKg: wKg, costPerKg: cPKg, totalCost: sCost });
          }
        }

        // Process existing batch sources
        if (hasBatchSources) {
          for (const bSrc of batchSources) {
            const srcBatchId = parseInt(bSrc.sourceBatchId);
            const wKg = parseFloat(bSrc.weightKg);

            if (isNaN(srcBatchId) || isNaN(wKg) || wKg <= 0) {
              throw new Error("Invalid batch source data");
            }

            const [srcBatch] = await tx
              .select()
              .from(mixBatches)
              .where(and(eq(mixBatches.id, srcBatchId), eq(mixBatches.companyId, companyId)))
              .for("update");

            if (!srcBatch) {
              throw new Error(`Source batch ${srcBatchId} not found`);
            }

            const srcTotal = parseFloat(srcBatch.totalWeightKg);
            const srcUsed = parseFloat(srcBatch.usedKg);
            const srcRemaining = srcTotal - srcUsed;

            if (wKg > srcRemaining + 0.001) {
              throw new Error(
                `Batch ${srcBatch.batchCode} only has ${srcRemaining.toFixed(3)} kg remaining, requested ${wKg}`
              );
            }

            // Deduct from source batch's usedKg
            const newUsed = srcUsed + wKg;
            await tx
              .update(mixBatches)
              .set({
                usedKg: newUsed.toFixed(3),
                status: newUsed >= srcTotal - 0.001 ? "COMPLETED" : srcBatch.status,
              })
              .where(eq(mixBatches.id, srcBatchId));

            const srcCostPerKg = parseFloat(srcBatch.costPerKg);
            const sCost = wKg * srcCostPerKg;
            totalWeightKg += wKg;
            totalCost += sCost;
            validatedSources.push({
              sourceBatchId: srcBatchId,
              weightKg: wKg,
              costPerKg: srcCostPerKg,
              totalCost: sCost,
            });
          }
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        const [batch] = await tx
          .insert(mixBatches)
          .values({
            companyId,
            batchCode,
            name: name || batchCode,
            totalWeightKg: totalWeightKg.toFixed(3),
            usedKg: "0",
            costPerKg: blendedCostPerKg.toFixed(4),
            totalCost: totalCost.toFixed(2),
            notes: batchData.notes || null,
            status: "ACTIVE",
          })
          .returning();

        for (const src of validatedSources) {
          await tx.insert(mixBatchSources).values({
            mixBatchId: batch.id,
            containerId: src.containerId || null,
            sourceBatchId: src.sourceBatchId || null,
            weightKg: src.weightKg.toFixed(3),
            costPerKg: src.costPerKg.toFixed(4),
            totalCost: src.totalCost.toFixed(2),
          });
        }

        return batch;
      });

      res.json(result);
    } catch (error: any) {
      logger.error("Error creating mix batch:", { error: error });
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/mix-batches/:id/sources", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      const sources = await storage.getMixBatchSources(id, companyId);
      res.json(sources);
    } catch (error: any) {
      logger.error("Error fetching mix batch sources:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mix-batches/:id/sources", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const mixBatchId = parseInt(req.params.id);
      if (isNaN(mixBatchId)) {
        return res.status(400).json({ message: "Invalid mix batch ID" });
      }

      // Verify the mix batch belongs to this company
      const batch = await storage.getMixBatchById(mixBatchId, companyId);
      if (!batch) {
        return res.status(404).json({ message: "Mix batch not found" });
      }
      const data = insertMixBatchSourceSchema.parse({
        ...req.body,
        mixBatchId,
      });

      const source = await storage.addMixBatchSource(data);
      res.json(source);
    } catch (error: any) {
      logger.error("Error adding mix batch source:", { error: error });
      res.status(400).json({ message: error.message });
    }
  });
}
