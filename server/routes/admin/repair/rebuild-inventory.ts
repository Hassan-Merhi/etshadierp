/**
 * adminRepairRoutes: AdminRebuildInventory endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth, requireRole } from "../../../auth";
import {
  inventory,
  stockItems,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  purchaseOrders,
  poLineItems,
  vouchers,
  salesItems,
  locations,
  creditNoteItems,
} from "@shared/schema";
import { eq, and, or, inArray, isNull, isNotNull } from "drizzle-orm";

export function registerAdminRebuildInventoryRoutes(app: Express) {
  app.post("/api/admin/rebuild-inventory", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { dryRun = true } = req.body;

      const staleOptionalTrue = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, true),
            eq(stockTransferVouchers.inventoryApplied, true),
            isNull(vouchers.deletedAt)
          )
        );

      const staleNonOptionalFalse = await db
        .select({
          stId: stockTransferVouchers.id,
          voucherId: stockTransferVouchers.voucherId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            eq(stockTransferVouchers.inventoryApplied, false),
            isNull(vouchers.deletedAt)
          )
        );

      const staleFlagsTotalCount = staleOptionalTrue.length + staleNonOptionalFalse.length;

      if (!dryRun) {
        if (staleOptionalTrue.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: false })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleOptionalTrue.map((f) => f.stId)
              )
            );
        }
        if (staleNonOptionalFalse.length > 0) {
          await db
            .update(stockTransferVouchers)
            .set({ inventoryApplied: true })
            .where(
              inArray(
                stockTransferVouchers.id,
                staleNonOptionalFalse.map((f) => f.stId)
              )
            );
        }
      }

      const expectedInv = new Map<string, { quantity: number; totalValue: number }>();

      function addToExpected(locationId: number, stockItemId: number, qty: number, value: number) {
        const key = `${locationId}-${stockItemId}`;
        const existing = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        existing.quantity += qty;
        existing.totalValue += value;
        expectedInv.set(key, existing);
      }

      const allOffloads = await db
        .select({
          offloadId: containerOffloads.id,
          locationId: containerOffloads.locationId,
          containerId: containerOffloads.containerId,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containers.id, containerOffloads.containerId))
        .where(eq(containers.companyId, companyId));

      for (const offload of allOffloads) {
        const offloadItems = await db
          .select()
          .from(containerOffloadItems)
          .where(eq(containerOffloadItems.offloadId, offload.offloadId));

        if (offloadItems.length > 0) {
          for (const item of offloadItems) {
            const qty = parseFloat(item.quantity || "0");
            const val = parseFloat(item.totalValue || "0");
            if (qty !== 0) {
              addToExpected(offload.locationId, item.stockItemId, qty, val);
            }
          }
        } else {
          const pos = await db.select().from(purchaseOrders).where(eq(purchaseOrders.containerId, offload.containerId));
          for (const po of pos) {
            const lineItems = await db.select().from(poLineItems).where(eq(poLineItems.poId, po.id));
            for (const li of lineItems) {
              const qty = parseFloat(li.quantity || "0");
              const val = parseFloat(li.lineTotal || "0");
              if (qty !== 0) {
                addToExpected(offload.locationId, li.stockItemId, qty, val);
              }
            }
          }
        }
      }

      const activeTransfers = await db
        .select({
          stId: stockTransferVouchers.id,
          sourceLocationId: stockTransferVouchers.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockTransferVouchers.voucherId))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

      for (const transfer of activeTransfers) {
        const items = await db
          .select()
          .from(stockTransferItems)
          .where(eq(stockTransferItems.transferId, transfer.stId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const val = qty * rate;
          if (qty !== 0) {
            const srcLoc = item.sourceLocationId || transfer.sourceLocationId;
            if (srcLoc) {
              addToExpected(srcLoc, item.stockItemId, -qty, -val);
            }
            addToExpected(transfer.destinationLocationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeAdjustments = await db
        .select({
          adjId: stockAdjustmentVouchers.id,
          locationId: stockAdjustmentVouchers.locationId,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentVouchers)
        .innerJoin(vouchers, eq(vouchers.id, stockAdjustmentVouchers.voucherId))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

      for (const adj of activeAdjustments) {
        const items = await db
          .select()
          .from(stockAdjustmentItems)
          .where(eq(stockAdjustmentItems.adjustmentId, adj.adjId));

        for (const item of items) {
          let qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          if (adj.adjustmentType === "Consumption") {
            qty = -Math.abs(qty);
          } else if (adj.adjustmentType === "Production") {
            qty = Math.abs(qty);
          }
          const val = qty * rate;
          if (qty !== 0) {
            addToExpected(adj.locationId, item.stockItemId, qty, val);
          }
        }
      }

      const activeSalesVouchers = await db
        .select({
          vId: vouchers.id,
          locationId: vouchers.locationId,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            isNotNull(vouchers.locationId)
          )
        );

      for (const sale of activeSalesVouchers) {
        if (!sale.locationId) continue;
        const items = await db.select().from(salesItems).where(eq(salesItems.voucherId, sale.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const costPrice = parseFloat(item.costPrice || "0");
          if (qty !== 0) {
            addToExpected(sale.locationId, item.stockItemId, -qty, -(qty * costPrice));
          }
        }
      }

      const activeCreditDebitVouchers = await db
        .select({
          vId: vouchers.id,
          voucherType: vouchers.voucherType,
        })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            or(eq(vouchers.voucherType, "Credit Note"), eq(vouchers.voucherType, "Debit Note")),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      for (const note of activeCreditDebitVouchers) {
        const items = await db.select().from(creditNoteItems).where(eq(creditNoteItems.voucherId, note.vId));

        for (const item of items) {
          const qty = parseFloat(item.quantity || "0");
          const cost = parseFloat(item.inventoryCost || item.rate || "0");
          if (qty !== 0) {
            if (note.voucherType === "Credit Note") {
              addToExpected(item.locationId, item.stockItemId, qty, qty * cost);
            } else {
              addToExpected(item.locationId, item.stockItemId, -qty, -(qty * cost));
            }
          }
        }
      }

      const currentInventory = await db.select().from(inventory).where(eq(inventory.companyId, companyId));

      const currentMap = new Map<string, { id: number; quantity: number; totalValue: number }>();
      for (const inv of currentInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        currentMap.set(key, {
          id: inv.id,
          quantity: parseFloat(inv.quantity || "0"),
          totalValue: parseFloat(inv.totalValue || "0"),
        });
      }

      const allKeys = new Set([...expectedInv.keys(), ...currentMap.keys()]);
      const discrepancies: Array<{
        locationId: number;
        stockItemId: number;
        currentQty: number;
        expectedQty: number;
        difference: number;
        currentValue: number;
        expectedValue: number;
      }> = [];

      for (const key of allKeys) {
        const [locStr, itemStr] = key.split("-");
        const locationId = parseInt(locStr);
        const stockItemId = parseInt(itemStr);
        const expected = expectedInv.get(key) || { quantity: 0, totalValue: 0 };
        const current = currentMap.get(key) || { id: 0, quantity: 0, totalValue: 0 };

        const qtyDiff = Math.abs(expected.quantity - current.quantity);
        const valDiff = Math.abs(expected.totalValue - current.totalValue);
        if (qtyDiff > 0.001 || valDiff > 0.01) {
          discrepancies.push({
            locationId,
            stockItemId,
            currentQty: current.quantity,
            expectedQty: parseFloat(expected.quantity.toFixed(3)),
            difference: parseFloat((expected.quantity - current.quantity).toFixed(3)),
            currentValue: current.totalValue,
            expectedValue: parseFloat(expected.totalValue.toFixed(2)),
          });
        }
      }

      let fixesApplied = 0;
      if (!dryRun && discrepancies.length > 0) {
        await db.transaction(async (tx) => {
          for (const d of discrepancies) {
            const key = `${d.locationId}-${d.stockItemId}`;
            const current = currentMap.get(key);
            const avgRate = d.expectedQty !== 0 ? d.expectedValue / d.expectedQty : 0;

            if (current && current.id) {
              await tx
                .update(inventory)
                .set({
                  quantity: d.expectedQty.toFixed(3),
                  totalValue: d.expectedValue.toFixed(2),
                  averageRate: avgRate.toFixed(2),
                  lastUpdated: new Date(),
                })
                .where(eq(inventory.id, current.id));
            } else {
              await tx.insert(inventory).values({
                companyId,
                locationId: d.locationId,
                stockItemId: d.stockItemId,
                quantity: d.expectedQty.toFixed(3),
                totalValue: d.expectedValue.toFixed(2),
                averageRate: avgRate.toFixed(2),
                lastUpdated: new Date(),
              });
            }
            fixesApplied++;
          }
        });
      }

      const companyLocations = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(eq(locations.companyId, companyId));
      const companyStockItems = await db
        .select({ id: stockItems.id, name: stockItems.name, code: stockItems.code })
        .from(stockItems)
        .where(eq(stockItems.companyId, companyId));
      const locationMap = new Map(companyLocations.map((l) => [l.id, l.name]));
      const stockItemMap = new Map(companyStockItems.map((s) => [s.id, { name: s.name, code: s.code }]));

      const enrichedDiscrepancies = discrepancies.map((d) => ({
        ...d,
        locationName: locationMap.get(d.locationId) || `Location #${d.locationId}`,
        stockItemName: stockItemMap.get(d.stockItemId)?.name || `Item #${d.stockItemId}`,
        stockItemCode: stockItemMap.get(d.stockItemId)?.code || "",
      }));

      res.json({
        success: true,
        dryRun,
        staleFlagsFound: staleFlagsTotalCount,
        staleFlagsFixed: dryRun ? 0 : staleFlagsTotalCount,
        staleFlagDetails: {
          optionalWithAppliedTrue: staleOptionalTrue.length,
          nonOptionalWithAppliedFalse: staleNonOptionalFalse.length,
        },
        totalInventoryRecords: currentInventory.length,
        discrepanciesFound: discrepancies.length,
        fixesApplied,
        discrepancies: enrichedDiscrepancies,
        warnings: [
          "Quick adjustments (manual add/subtract) are not backed by vouchers and cannot be replayed. They may appear as discrepancies.",
        ],
      });
    } catch (error: unknown) {
      logger.error("Rebuild inventory error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
