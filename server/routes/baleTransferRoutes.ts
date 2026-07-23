/**
 * Bale-transfer routes.
 *
 * Inter-location bale transfers (list, create, detail, complete, delete,
 * update). Extracted from baleRoutes.ts as a sub-registrar; behaviour is
 * unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import {
  baleTransfers,
  baleTransferItems,
  baleProducts,
  productionBales,
  factorySettings as fSettings,
  factoryDaybookEntries as fde,
} from "@shared/schema";

export function registerBaleTransferRoutes(app: Express) {
  // Bale Transfer Routes
  app.get("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const transfers = await db
        .select({
          id: baleTransfers.id,
          companyId: baleTransfers.companyId,
          sourceLocationId: baleTransfers.sourceLocationId,
          destinationLocationId: baleTransfers.destinationLocationId,
          transferDate: baleTransfers.transferDate,
          notes: baleTransfers.notes,
          createdBy: baleTransfers.createdBy,
          updatedBy: baleTransfers.updatedBy,
          status: baleTransfers.status,
          createdAt: baleTransfers.createdAt,
          updatedAt: baleTransfers.updatedAt,
          sourceLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.sourceLocationId})`,
          destinationLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.destinationLocationId})`,
          itemCount: sql<number>`(SELECT COUNT(*) FROM bale_transfer_items WHERE transfer_id = ${baleTransfers.id})::int`,
        })
        .from(baleTransfers)
        .where(eq(baleTransfers.companyId, companyId))
        .orderBy(desc(baleTransfers.createdAt));

      res.json(transfers);
    } catch (error: any) {
      logger.error("Error fetching bale transfers:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bale-transfers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { sourceLocationId, destinationLocationId, transferDate, notes, items } = req.body;

      if (
        !sourceLocationId ||
        !destinationLocationId ||
        !transferDate ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          message: "Missing required fields: sourceLocationId, destinationLocationId, transferDate, and items array",
        });
      }
      const createdBy = (req.session as any).username || "system";

      const result = await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(baleTransfers)
          .values({
            companyId,
            sourceLocationId,
            destinationLocationId,
            transferDate,
            notes: notes || null,
            createdBy,
            status: "PENDING",
          })
          .returning();

        for (const item of items) {
          await tx.insert(baleTransferItems).values({
            transferId: transfer.id,
            productionBaleId: item.productionBaleId,
            quantity: item.quantity || 1,
            weightKg: item.weightKg.toString(),
            costPerKg: item.costPerKg.toString(),
            totalCost: item.totalCost.toString(),
          });

          await tx
            .update(productionBales)
            .set({
              locationId: destinationLocationId,
              status: "IN_STOCK",
              updatedAt: sql`now()`,
            })
            .where(eq(productionBales.id, item.productionBaleId));
        }

        return transfer;
      });

      // Write to factory daybook if this company has factory settings
      try {
        const [fSetting] = await db.select().from(fSettings).where(eq(fSettings.companyId, companyId));
        if (fSetting) {
          const totalCost = items.reduce((s: number, it: any) => s + parseFloat(it.totalCost || "0"), 0);
          await db.insert(fde).values({
            companyId,
            txDate: transferDate,
            txType: "BALE_TRANSFER",
            referenceId: result.id,
            referenceTable: "bale_transfers",
            description: notes || `Bale transfer #${result.id}`,
            currencyCode: "USD",
            amountCurrency: String(totalCost),
            fxRateToUsd: "1",
            amountUsd: String(totalCost),
            createdBy: null,
          });
        }
      } catch (dbErr) {
        logger.error("Factory daybook write failed (non-fatal):", { error: dbErr });
      }

      res.json({ success: true, transferId: result.id, transfer: result });
    } catch (error: any) {
      logger.error("Error creating bale transfer:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db
        .select({
          id: baleTransfers.id,
          companyId: baleTransfers.companyId,
          sourceLocationId: baleTransfers.sourceLocationId,
          destinationLocationId: baleTransfers.destinationLocationId,
          transferDate: baleTransfers.transferDate,
          notes: baleTransfers.notes,
          createdBy: baleTransfers.createdBy,
          updatedBy: baleTransfers.updatedBy,
          status: baleTransfers.status,
          createdAt: baleTransfers.createdAt,
          updatedAt: baleTransfers.updatedAt,
          sourceLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.sourceLocationId})`,
          destinationLocationName: sql<string>`(SELECT name FROM locations WHERE id = ${baleTransfers.destinationLocationId})`,
        })
        .from(baleTransfers)
        .where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      const items = await db
        .select({
          id: baleTransferItems.id,
          transferId: baleTransferItems.transferId,
          productionBaleId: baleTransferItems.productionBaleId,
          quantity: baleTransferItems.quantity,
          weightKg: baleTransferItems.weightKg,
          costPerKg: baleTransferItems.costPerKg,
          totalCost: baleTransferItems.totalCost,
          createdAt: baleTransferItems.createdAt,
          baleCode: productionBales.baleCode,
          barcodeValue: productionBales.barcodeValue,
          baleCategory: productionBales.category,
          baleGrade: productionBales.grade,
          baleStatus: productionBales.status,
          productName: baleProducts.name,
          productCode: baleProducts.code,
        })
        .from(baleTransferItems)
        .leftJoin(productionBales, eq(baleTransferItems.productionBaleId, productionBales.id))
        .leftJoin(baleProducts, eq(productionBales.productId, baleProducts.id))
        .where(eq(baleTransferItems.transferId, transferId));

      res.json({ ...transfer, items });
    } catch (error: any) {
      logger.error("Error fetching bale transfer:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bale-transfers/:id/complete", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db.select().from(baleTransfers).where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      const [updated] = await db
        .update(baleTransfers)
        .set({
          status: "COMPLETED",
          updatedBy: (req.session as any).username || "system",
          updatedAt: sql`now()`,
        })
        .where(eq(baleTransfers.id, transferId))
        .returning();

      res.json({ success: true, transfer: updated });
    } catch (error: any) {
      logger.error("Error completing bale transfer:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const transferId = parseInt(req.params.id);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      const [transfer] = await db.select().from(baleTransfers).where(eq(baleTransfers.id, transferId));

      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      if (transfer.status !== "PENDING") {
        return res.status(400).json({ message: "Only PENDING transfers can be deleted" });
      }

      await db.transaction(async (tx) => {
        const items = await tx.select().from(baleTransferItems).where(eq(baleTransferItems.transferId, transferId));

        for (const item of items) {
          await tx
            .update(productionBales)
            .set({
              locationId: transfer.sourceLocationId,
              updatedAt: sql`now()`,
            })
            .where(eq(productionBales.id, item.productionBaleId));
        }

        await tx.delete(baleTransferItems).where(eq(baleTransferItems.transferId, transferId));
        await tx.delete(baleTransfers).where(eq(baleTransfers.id, transferId));
      });

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Error deleting bale transfer:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/bale-transfers/:id", requireAuth, async (req, res) => {
    try {
      const { items, status, notes } = req.body;
      const transferId = parseInt(req.params.id, 10);
      if (isNaN(transferId)) return res.status(400).json({ message: "Invalid transfer ID" });

      await storage.updateBaleTransfer(transferId, {
        status,
        notes,
        updatedBy: (req.session as any).username || "system",
      });

      if (items) {
        for (const item of items) {
          if (item.id) {
            await storage.updateBaleTransferItem(item.id, {
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString(),
            });
          } else {
            await storage.createBaleTransferItem({
              transferId,
              productionBaleId: item.productionBaleId,
              quantity: item.quantity,
              weightKg: item.weightKg.toString(),
              costPerKg: item.costPerKg.toString(),
              totalCost: item.totalCost.toString(),
            });
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
