import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import { upload, logAudit, getCurrentExchangeRate } from "../_helpers";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemMergeLogs,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers,
  locations, employees, userLocations, auditLog, interCompanyTransfers,
  insertInterCompanyTransferSchema, FEATURE_KEYS,
  locationPriceGroups,
  stockGrades, stockCategories, insertStockGradeSchema, insertStockCategorySchema,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory } from "../../inventoryHelper";


export function registerStockMergeRoutes(app: Express) {
  // Update stock transfer item
  app.patch("/api/stock-transfer-items/:id", requireAuth, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate numeric fields if provided
      if (req.body.quantity !== undefined) {
        const qty = parseFloat(req.body.quantity);
        if (isNaN(qty)) {
          return res
            .status(400)
            .json({ message: "Quantity must be a valid number" });
        }
      }
      if (req.body.rate !== undefined) {
        const rate = parseFloat(req.body.rate);
        if (isNaN(rate) || rate < 0) {
          return res
            .status(400)
            .json({ message: "Rate must be a valid non-negative number" });
        }
      }
      if (req.body.stockItemId !== undefined) {
        const stockItemId = parseInt(req.body.stockItemId);
        if (isNaN(stockItemId)) {
          return res
            .status(400)
            .json({ message: "Stock item ID must be a valid number" });
        }
      }

      const updated = await storage.updateStockTransferItem(itemId, req.body);
      try {
        const _sti: Record<string, any> = {};
        if (req.body.quantity !== undefined) _sti.quantity = { new: String(req.body.quantity) };
        if (req.body.rate !== undefined) _sti.rate = { new: String(req.body.rate) };
        if (req.body.stockItemId !== undefined) _sti.stockItemId = { new: String(req.body.stockItemId) };
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "stock_transfer_items",
          recordId: itemId,
          recordIdentifier: `Transfer item #${itemId}`,
          changes: _sti,
        });
      } catch { /* non-fatal */ }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock adjustment item
  app.patch(
    "/api/stock-adjustment-items/:id",
    requireAuth,
    async (req, res) => {
      try {
        const itemId = parseInt(req.params.id);
        if (isNaN(itemId)) {
          return res.status(400).json({ message: "Invalid item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Validate numeric fields if provided
        if (req.body.quantity !== undefined) {
          const qty = parseFloat(req.body.quantity);
          if (isNaN(qty)) {
            return res
              .status(400)
              .json({ message: "Quantity must be a valid number" });
          }
        }
        if (req.body.rate !== undefined) {
          const rate = parseFloat(req.body.rate);
          if (isNaN(rate) || rate < 0) {
            return res
              .status(400)
              .json({ message: "Rate must be a valid non-negative number" });
          }
        }
        if (req.body.stockItemId !== undefined) {
          const stockItemId = parseInt(req.body.stockItemId);
          if (isNaN(stockItemId)) {
            return res
              .status(400)
              .json({ message: "Stock item ID must be a valid number" });
          }
        }

        const updated = await storage.updateStockAdjustmentItem(
          itemId,
          req.body,
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Query - Aggregated stock data across all locations
  app.get("/api/stock-query", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all stock items for the company (excluding deleted)
      const allStockItems = await db
        .select({
          id: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          uom: stockItems.uom,
          stockGroupId: stockItems.stockGroupId,
          stockGroupCode: stockGroups.code,
          stockGroupName: stockGroups.name,
          openingQty: stockItems.openingQty,
          openingRate: stockItems.openingRate,
          openingValue: stockItems.openingValue,
          sellingPrice: stockItems.sellingPrice,
          active: stockItems.active,
        })
        .from(stockItems)
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(stockItems.companyId, req.session.currentCompanyId), isNull(stockItems.deletedAt)));

      // Get all inventory records for the company to calculate current qty and value
      const inventoryRecords = await db
        .select({
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(eq(locations.companyId, req.session.currentCompanyId));

      // Aggregate inventory by stock item - calculate value dynamically as qty * rate
      const inventoryMap = new Map<
        number,
        { totalQty: number; totalValue: number }
      >();

      for (const record of inventoryRecords) {
        const existing = inventoryMap.get(record.stockItemId) || {
          totalQty: 0,
          totalValue: 0,
        };
        const qty = parseFloat(record.quantity || "0");
        const rate = parseFloat(record.averageRate || "0");
        existing.totalQty += qty;
        existing.totalValue += qty * rate;
        inventoryMap.set(record.stockItemId, existing);
      }

      // Combine stock items with aggregated inventory
      const result = allStockItems.map((item) => {
        const inv = inventoryMap.get(item.id) || { totalQty: 0, totalValue: 0 };
        return {
          ...item,
          currentQty: inv.totalQty.toFixed(3),
          currentValue: inv.totalValue.toFixed(2),
        };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Group Location Archives - Archive/Restore stock groups at specific locations
  app.get("/api/stock-group-archives", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const archives = await storage.getStockGroupLocationArchives(req.session.currentCompanyId);
      res.json(archives);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/stock-group-archives/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const archive = await storage.getStockGroupLocationArchiveById(
        parseInt(req.params.id),
        req.session.currentCompanyId
      );
      if (!archive) {
        return res.status(404).json({ message: "Archive not found" });
      }
      const items = await storage.getStockGroupLocationArchiveItems(archive.id);
      res.json({ archive, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-group-archives", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { locationId, stockGroupId, notes } = req.body;
      if (!locationId) {
        return res.status(400).json({ message: "Location ID is required" });
      }
      const archive = await storage.archiveStockGroupAtLocation(
        req.session.currentCompanyId,
        parseInt(locationId),
        stockGroupId !== null && stockGroupId !== undefined ? parseInt(stockGroupId) : null,
        req.user!.id,
        notes
      );
      res.json(archive);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-group-archives/:id/restore", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const archive = await storage.restoreStockGroupLocationArchive(
        parseInt(req.params.id),
        req.session.currentCompanyId
      );
      res.json(archive);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/stock-group-archives/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const permanent = req.query.permanent === 'true';
      if (permanent) {
        await storage.permanentlyDeleteStockGroupLocationArchive(
          parseInt(req.params.id),
          req.session.currentCompanyId
        );
      } else {
        await storage.deleteStockGroupLocationArchive(
          parseInt(req.params.id),
          req.session.currentCompanyId
        );
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Stock Item Merge ────────────────────────────────────────────────────────

  // Preview: GET /api/stock-items/:id/merge-preview?duplicateId=<id>
  app.get("/api/stock-items/:id/merge-preview", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const keptId = parseInt(req.params.id);
      const duplicateId = parseInt(req.query.duplicateId as string);
      if (isNaN(keptId) || isNaN(duplicateId)) return res.status(400).json({ message: "Invalid item IDs" });
      if (keptId === duplicateId) return res.status(400).json({ message: "Cannot merge an item into itself" });

      const [keptItem] = await db.select().from(stockItems)
        .where(and(eq(stockItems.id, keptId), eq(stockItems.companyId, companyId)));
      const [duplicateItem] = await db.select().from(stockItems)
        .where(and(eq(stockItems.id, duplicateId), eq(stockItems.companyId, companyId)));

      if (!keptItem) return res.status(404).json({ message: "Kept item not found in this company" });
      if (!duplicateItem) return res.status(404).json({ message: "Duplicate item not found in this company" });
      if (duplicateItem.deletedAt) return res.status(400).json({ message: "Duplicate item is already deleted or merged" });

      const warnings: string[] = [];
      if (keptItem.uom !== duplicateItem.uom) {
        warnings.push(`UOM mismatch: kept item is "${keptItem.uom}", duplicate is "${duplicateItem.uom}". Phase 1 blocks this merge.`);
      }

      const keptInv = await db.select().from(inventory)
        .where(and(eq(inventory.stockItemId, keptId), eq(inventory.companyId, companyId)));
      const dupInv = await db.select().from(inventory)
        .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.companyId, companyId)));

      const allLocationIds = [...new Set([...keptInv.map(r => r.locationId), ...dupInv.map(r => r.locationId)])];
      const locationRows = allLocationIds.length > 0
        ? await db.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, allLocationIds))
        : [];
      const locationNameMap = new Map(locationRows.map(l => [l.id, l.name]));

      const keptMap = new Map(keptInv.map(r => [r.locationId, r]));
      const dupMap = new Map(dupInv.map(r => [r.locationId, r]));

      const impactLocations: any[] = [];
      for (const locId of Array.from(dupMap.keys())) {
        const dupRow = dupMap.get(locId)!;
        const keptRow = keptMap.get(locId);
        const dupQty   = parseFloat(dupRow.quantity);
        const dupValue = parseFloat(dupRow.totalValue);
        const dupRate  = parseFloat(dupRow.averageRate);
        const keptQty   = keptRow ? parseFloat(keptRow.quantity)    : 0;
        const keptValue = keptRow ? parseFloat(keptRow.totalValue)  : 0;
        const keptRate  = keptRow ? parseFloat(keptRow.averageRate) : 0;
        const combinedQty   = keptQty + dupQty;
        const combinedValue = keptValue + dupValue;
        const combinedRate  = combinedQty > 0 ? combinedValue / combinedQty : 0;
        impactLocations.push({
          locationId: locId,
          locationName: locationNameMap.get(locId) ?? `Location ${locId}`,
          keptQty, keptValue, keptRate,
          dupQty, dupValue, dupRate,
          combinedQty, combinedValue, combinedRate,
          action: keptRow ? "combine" : "reassign",
        });
      }
      for (const locId of Array.from(keptMap.keys())) {
        if (!dupMap.has(locId)) {
          const r = keptMap.get(locId)!;
          impactLocations.push({
            locationId: locId,
            locationName: locationNameMap.get(locId) ?? `Location ${locId}`,
            keptQty: parseFloat(r.quantity), keptValue: parseFloat(r.totalValue), keptRate: parseFloat(r.averageRate),
            dupQty: 0, dupValue: 0, dupRate: 0,
            combinedQty: parseFloat(r.quantity), combinedValue: parseFloat(r.totalValue), combinedRate: parseFloat(r.averageRate),
            action: "no_change",
          });
        }
      }

      const totalValueBefore = [...keptInv, ...dupInv].reduce((s, r) => s + parseFloat(r.totalValue), 0);
      const totalValueAfter  = impactLocations.reduce((s, l) => s + l.combinedValue, 0);

      const keptAliases = await db.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, keptId));
      const dupAliases  = await db.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, duplicateId));
      const keptAliasCodes = new Set([keptItem.code, ...keptAliases.map(a => a.aliasCode)]);
      const conflictCount = dupAliases.filter(a => keptAliasCodes.has(a.aliasCode)).length
        + (keptAliasCodes.has(duplicateItem.code) ? 1 : 0);
      if (conflictCount > 0) {
        warnings.push(`${conflictCount} alias code(s) conflict with kept item codes and will be skipped.`);
      }

      return res.json({
        keptItem:      { id: keptItem.id,      code: keptItem.code,      name: keptItem.name,      uom: keptItem.uom },
        duplicateItem: { id: duplicateItem.id, code: duplicateItem.code, name: duplicateItem.name, uom: duplicateItem.uom },
        uomMismatch: keptItem.uom !== duplicateItem.uom,
        inventoryImpact: impactLocations,
        totalValueBefore,
        totalValueAfter,
        warnings,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // Execute: POST /api/stock-items/:id/merge
  app.post("/api/stock-items/:id/merge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: number = req.user?.id ?? req.session.userId;

      const keptId      = parseInt(req.params.id);
      const duplicateId = parseInt(req.body.duplicateId);
      const { confirm, notes } = req.body;

      if (isNaN(keptId) || isNaN(duplicateId)) return res.status(400).json({ message: "Invalid item IDs" });
      if (keptId === duplicateId) return res.status(400).json({ message: "Cannot merge an item into itself" });
      if (confirm !== "MERGE") return res.status(400).json({ message: 'Type "MERGE" to confirm' });

      const [keptItem] = await db.select().from(stockItems)
        .where(and(eq(stockItems.id, keptId), eq(stockItems.companyId, companyId)));
      const [duplicateItem] = await db.select().from(stockItems)
        .where(and(eq(stockItems.id, duplicateId), eq(stockItems.companyId, companyId)));

      if (!keptItem)      return res.status(404).json({ message: "Kept item not found in this company" });
      if (!duplicateItem) return res.status(404).json({ message: "Duplicate item not found in this company" });
      if (duplicateItem.deletedAt) return res.status(400).json({ message: "Duplicate item is already deleted or merged" });
      if (keptItem.uom !== duplicateItem.uom) {
        return res.status(400).json({ message: `UOM mismatch: "${keptItem.uom}" vs "${duplicateItem.uom}". Phase 1 blocks UOM mismatches.` });
      }

      // Capture pre-merge inventory
      const keptInvBefore = await db.select().from(inventory)
        .where(and(eq(inventory.stockItemId, keptId), eq(inventory.companyId, companyId)));
      const dupInvBefore  = await db.select().from(inventory)
        .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.companyId, companyId)));

      const totalValueBefore = [...keptInvBefore, ...dupInvBefore].reduce((s, r) => s + parseFloat(r.totalValue), 0);

      const snapshotBefore: Record<string, unknown> = {};
      for (const r of [...keptInvBefore, ...dupInvBefore]) {
        snapshotBefore[`${r.stockItemId}_${r.locationId}`] = {
          stockItemId: r.stockItemId, locationId: r.locationId,
          quantity: r.quantity, averageRate: r.averageRate, totalValue: r.totalValue,
        };
      }

      await db.transaction(async (tx) => {
        const keptMap = new Map(keptInvBefore.map(r => [r.locationId, r]));

        // Step 1 — combine / reassign inventory per location
        for (const dupRow of dupInvBefore) {
          const locId   = dupRow.locationId;
          const keptRow = keptMap.get(locId);
          if (!keptRow) {
            // Case 1: only dup has stock here — just remap the row
            await tx.update(inventory)
              .set({ stockItemId: keptId, lastUpdated: new Date() })
              .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.locationId, locId)));
          } else {
            // Case 2: both have stock — weighted-average combine
            const combinedQty   = parseFloat(keptRow.quantity)   + parseFloat(dupRow.quantity);
            const combinedValue = parseFloat(keptRow.totalValue) + parseFloat(dupRow.totalValue);
            const combinedRate  = combinedQty > 0 ? combinedValue / combinedQty : 0;
            await tx.update(inventory)
              .set({
                quantity:    combinedQty.toFixed(3),
                totalValue:  combinedValue.toFixed(2),
                averageRate: combinedRate.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(and(eq(inventory.stockItemId, keptId), eq(inventory.locationId, locId)));
            await tx.delete(inventory)
              .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.locationId, locId)));
          }
        }

        // Step 2 — transfer aliases (skip conflicts)
        const dupAliases  = await tx.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, duplicateId));
        const keptAliases = await tx.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, keptId));
        const keptAliasCodes = new Set([keptItem.code, ...keptAliases.map(a => a.aliasCode)]);
        for (const alias of dupAliases) {
          if (keptAliasCodes.has(alias.aliasCode)) continue;
          await tx.update(stockItemCodeAliases).set({ stockItemId: keptId }).where(eq(stockItemCodeAliases.id, alias.id));
          keptAliasCodes.add(alias.aliasCode);
        }
        // Register dup's own code as alias of kept (if no conflict)
        if (!keptAliasCodes.has(duplicateItem.code)) {
          await tx.insert(stockItemCodeAliases).values({
            companyId,
            stockItemId: keptId,
            aliasCode: duplicateItem.code,
            description: `Merged from: ${duplicateItem.name}`,
          });
        }

        // Step 3 — location prices: kept wins on conflict, delete dup's conflicting rows
        const dupPrices  = await tx.select().from(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, duplicateId));
        const keptPrices = await tx.select().from(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, keptId));
        const keptPriceLocations = new Set(keptPrices.map(p => p.locationId));
        for (const price of dupPrices) {
          if (!keptPriceLocations.has(price.locationId)) {
            await tx.update(stockItemLocationPrices).set({ stockItemId: keptId }).where(eq(stockItemLocationPrices.id, price.id));
          } else {
            await tx.delete(stockItemLocationPrices).where(eq(stockItemLocationPrices.id, price.id));
          }
        }

        // Step 4a — re-point all PO line items from the duplicate to the kept item
        await tx.update(poLineItems)
          .set({ stockItemId: keptId, itemName: keptItem.name })
          .where(eq(poLineItems.stockItemId, duplicateId));

        // Step 4b — soft-delete the duplicate
        await tx.update(stockItems)
          .set({ active: false, deletedAt: new Date(), name: `[MERGED] ${duplicateItem.name}` })
          .where(eq(stockItems.id, duplicateId));

        // Step 5 — integrity check
        const keptInvAfter = await tx.select().from(inventory)
          .where(and(eq(inventory.stockItemId, keptId), eq(inventory.companyId, companyId)));
        const totalValueAfter = keptInvAfter.reduce((s, r) => s + parseFloat(r.totalValue), 0);
        if (Math.abs(totalValueAfter - totalValueBefore) > 0.02) {
          throw new Error(`Value integrity check failed — before: ${totalValueBefore.toFixed(2)}, after: ${totalValueAfter.toFixed(2)}`);
        }

        // Step 6 — capture post-merge snapshot (used for audit log outside the tx)
        const snapshotAfter: Record<string, unknown> = {};
        for (const r of keptInvAfter) {
          snapshotAfter[`${r.stockItemId}_${r.locationId}`] = {
            stockItemId: r.stockItemId, locationId: r.locationId,
            quantity: r.quantity, averageRate: r.averageRate, totalValue: r.totalValue,
          };
        }
        // Store for use after the transaction commits
        (req as any)._mergeSnapshotAfter = snapshotAfter;
      });

      // Step 7 — audit log (outside transaction so it never rolls back the merge)
      try {
        await db.insert(stockItemMergeLogs).values({
          companyId,
          keptItemId:     keptId,
          keptItemCode:   keptItem.code.slice(0, 50),
          keptItemName:   keptItem.name,
          mergedItemId:   duplicateId,
          mergedItemCode: duplicateItem.code.slice(0, 50),
          mergedItemName: duplicateItem.name,
          snapshotBefore,
          snapshotAfter:  (req as any)._mergeSnapshotAfter ?? {},
          mergedByUserId: userId,
          notes:          notes ?? null,
        });
      } catch (auditErr: any) {
        // Audit log failure is non-fatal — merge already committed
        console.error("[Merge] Audit log insert failed (merge succeeded):", auditErr?.message);
      }

      return res.json({ success: true, keptItemId: keptId, mergedItemId: duplicateId });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk Merge: POST /api/stock-items/bulk-merge ─────────────────────────
  // Accepts an array of { oldCode, keepCode } pairs.
  // Resolves each code to an item ID (checking aliases too), then runs the
  // same merge logic as the single-merge endpoint for each pair.
  // Returns a per-pair results array — no pair failure aborts the others.
  app.post("/api/stock-items/bulk-merge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: number = req.user?.id ?? req.session.userId;

      const pairs: { oldCode: string; keepCode: string }[] = req.body.pairs ?? [];
      if (!Array.isArray(pairs) || pairs.length === 0)
        return res.status(400).json({ message: "pairs array is required and must not be empty" });
      if (pairs.length > 500)
        return res.status(400).json({ message: "Maximum 500 pairs per request" });

      // Helper: resolve a code to a stock item (checks direct code first, then aliases)
      async function resolveItem(code: string) {
        const trimmed = code.trim().toUpperCase();
        // Direct match
        const [direct] = await db
          .select()
          .from(stockItems)
          .where(
            and(
              eq(stockItems.companyId, companyId!),
              sql`UPPER(${stockItems.code}) = ${trimmed}`,
              isNull(stockItems.deletedAt),
            )
          )
          .limit(1);
        if (direct) return direct;
        // Alias match
        const [aliasRow] = await db
          .select({ stockItemId: stockItemCodeAliases.stockItemId })
          .from(stockItemCodeAliases)
          .where(
            and(
              eq(stockItemCodeAliases.companyId, companyId!),
              sql`UPPER(${stockItemCodeAliases.aliasCode}) = ${trimmed}`,
            )
          )
          .limit(1);
        if (!aliasRow) return null;
        const [fromAlias] = await db
          .select()
          .from(stockItems)
          .where(
            and(
              eq(stockItems.id, aliasRow.stockItemId),
              isNull(stockItems.deletedAt),
            )
          )
          .limit(1);
        return fromAlias ?? null;
      }

      type PairResult = {
        oldCode: string;
        keepCode: string;
        status: "success" | "skipped" | "error";
        reason?: string;
        keptItemName?: string;
        oldItemName?: string;
        keptItemId?: number;
        mergedItemId?: number;
      };

      const results: PairResult[] = [];

      for (const pair of pairs) {
        const { oldCode, keepCode } = pair;
        if (!oldCode || !keepCode) {
          results.push({ oldCode: oldCode ?? "", keepCode: keepCode ?? "", status: "skipped", reason: "Missing code" });
          continue;
        }

        try {
          const [keptItem, duplicateItem] = await Promise.all([
            resolveItem(keepCode),
            resolveItem(oldCode),
          ]);

          if (!keptItem) {
            results.push({ oldCode, keepCode, status: "skipped", reason: `Keep code "${keepCode}" not found` });
            continue;
          }
          if (!duplicateItem) {
            results.push({ oldCode, keepCode, status: "skipped", reason: `Old code "${oldCode}" not found` });
            continue;
          }
          if (keptItem.id === duplicateItem.id) {
            results.push({ oldCode, keepCode, status: "skipped", reason: "Old and keep codes resolve to the same item", keptItemName: keptItem.name, oldItemName: duplicateItem.name });
            continue;
          }
          if (duplicateItem.deletedAt) {
            results.push({ oldCode, keepCode, status: "skipped", reason: "Old item is already merged or deleted", keptItemName: keptItem.name, oldItemName: duplicateItem.name });
            continue;
          }
          if (keptItem.uom !== duplicateItem.uom) {
            results.push({ oldCode, keepCode, status: "skipped", reason: `UOM mismatch: "${keptItem.uom}" vs "${duplicateItem.uom}"`, keptItemName: keptItem.name, oldItemName: duplicateItem.name });
            continue;
          }

          const keptId      = keptItem.id;
          const duplicateId = duplicateItem.id;

          const keptInvBefore = await db.select().from(inventory)
            .where(and(eq(inventory.stockItemId, keptId), eq(inventory.companyId, companyId)));
          const dupInvBefore  = await db.select().from(inventory)
            .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.companyId, companyId)));

          const totalValueBefore = [...keptInvBefore, ...dupInvBefore].reduce((s, r) => s + parseFloat(r.totalValue), 0);

          const snapshotBefore: Record<string, unknown> = {};
          for (const r of [...keptInvBefore, ...dupInvBefore]) {
            snapshotBefore[`${r.stockItemId}_${r.locationId}`] = {
              stockItemId: r.stockItemId, locationId: r.locationId,
              quantity: r.quantity, averageRate: r.averageRate, totalValue: r.totalValue,
            };
          }

          let snapshotAfter: Record<string, unknown> = {};

          await db.transaction(async (tx) => {
            const keptMap = new Map(keptInvBefore.map(r => [r.locationId, r]));

            for (const dupRow of dupInvBefore) {
              const locId   = dupRow.locationId;
              const keptRow = keptMap.get(locId);
              if (!keptRow) {
                await tx.update(inventory)
                  .set({ stockItemId: keptId, lastUpdated: new Date() })
                  .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.locationId, locId)));
              } else {
                const combinedQty   = parseFloat(keptRow.quantity)   + parseFloat(dupRow.quantity);
                const combinedValue = parseFloat(keptRow.totalValue) + parseFloat(dupRow.totalValue);
                const combinedRate  = combinedQty > 0 ? combinedValue / combinedQty : 0;
                await tx.update(inventory)
                  .set({
                    quantity:    combinedQty.toFixed(3),
                    totalValue:  combinedValue.toFixed(2),
                    averageRate: combinedRate.toFixed(2),
                    lastUpdated: new Date(),
                  })
                  .where(and(eq(inventory.stockItemId, keptId), eq(inventory.locationId, locId)));
                await tx.delete(inventory)
                  .where(and(eq(inventory.stockItemId, duplicateId), eq(inventory.locationId, locId)));
              }
            }

            const dupAliases  = await tx.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, duplicateId));
            const keptAliases = await tx.select().from(stockItemCodeAliases).where(eq(stockItemCodeAliases.stockItemId, keptId));
            const keptAliasCodes = new Set([keptItem.code, ...keptAliases.map(a => a.aliasCode)]);
            for (const alias of dupAliases) {
              if (keptAliasCodes.has(alias.aliasCode)) continue;
              await tx.update(stockItemCodeAliases).set({ stockItemId: keptId }).where(eq(stockItemCodeAliases.id, alias.id));
              keptAliasCodes.add(alias.aliasCode);
            }
            if (!keptAliasCodes.has(duplicateItem.code)) {
              await tx.insert(stockItemCodeAliases).values({
                companyId,
                stockItemId: keptId,
                aliasCode: duplicateItem.code,
                description: `Merged from: ${duplicateItem.name}`,
              });
            }

            const dupPrices  = await tx.select().from(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, duplicateId));
            const keptPrices = await tx.select().from(stockItemLocationPrices).where(eq(stockItemLocationPrices.stockItemId, keptId));
            const keptPriceLocations = new Set(keptPrices.map(p => p.locationId));
            for (const price of dupPrices) {
              if (!keptPriceLocations.has(price.locationId)) {
                await tx.update(stockItemLocationPrices).set({ stockItemId: keptId }).where(eq(stockItemLocationPrices.id, price.id));
              } else {
                await tx.delete(stockItemLocationPrices).where(eq(stockItemLocationPrices.id, price.id));
              }
            }

            // Re-point all PO line items from the duplicate to the kept item
            await tx.update(poLineItems)
              .set({ stockItemId: keptId, itemName: keptItem.name })
              .where(eq(poLineItems.stockItemId, duplicateId));

            await tx.update(stockItems)
              .set({ active: false, deletedAt: new Date(), name: `[MERGED] ${duplicateItem.name}` })
              .where(eq(stockItems.id, duplicateId));

            const keptInvAfter = await tx.select().from(inventory)
              .where(and(eq(inventory.stockItemId, keptId), eq(inventory.companyId, companyId)));
            const totalValueAfter = keptInvAfter.reduce((s, r) => s + parseFloat(r.totalValue), 0);
            if (Math.abs(totalValueAfter - totalValueBefore) > 0.02) {
              throw new Error(`Value integrity check failed — before: ${totalValueBefore.toFixed(2)}, after: ${totalValueAfter.toFixed(2)}`);
            }

            for (const r of keptInvAfter) {
              snapshotAfter[`${r.stockItemId}_${r.locationId}`] = {
                stockItemId: r.stockItemId, locationId: r.locationId,
                quantity: r.quantity, averageRate: r.averageRate, totalValue: r.totalValue,
              };
            }
          });

          // Audit log (non-fatal)
          try {
            await db.insert(stockItemMergeLogs).values({
              companyId,
              keptItemId:     keptId,
              keptItemCode:   keptItem.code.slice(0, 50),
              keptItemName:   keptItem.name,
              mergedItemId:   duplicateId,
              mergedItemCode: duplicateItem.code.slice(0, 50),
              mergedItemName: duplicateItem.name,
              snapshotBefore,
              snapshotAfter,
              mergedByUserId: userId,
              notes: `Bulk merge via Excel`,
            });
          } catch (_auditErr) { /* non-fatal */ }

          results.push({
            oldCode, keepCode,
            status: "success",
            keptItemName:   keptItem.name,
            oldItemName:    duplicateItem.name,
            keptItemId:     keptId,
            mergedItemId:   duplicateId,
          });
        } catch (pairErr: any) {
          results.push({ oldCode, keepCode, status: "error", reason: pairErr.message });
        }
      }

      return res.json({ results });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Reconcile OTW Names: POST /api/stock-items/reconcile-otw-names ──────────
  // Re-points any po_line_items that still reference a merged/deleted stock item
  // to the kept item, updating both stockItemId and itemName in one pass.
  app.post("/api/stock-items/reconcile-otw-names", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let totalFixed = 0;

      // ── Pass 1: fix via merge logs (mergedItemId → keptItemId) ───────────
      const mergeLogs = await db.select().from(stockItemMergeLogs)
        .where(eq(stockItemMergeLogs.companyId, companyId));

      const coveredByLog = new Set<number>(); // deleted item IDs already handled by a log

      for (const log of mergeLogs) {
        coveredByLog.add(log.mergedItemId);
        const [keptItem] = await db.select({ id: stockItems.id, name: stockItems.name })
          .from(stockItems)
          .where(eq(stockItems.id, log.keptItemId));
        if (!keptItem) continue;

        const updated = await db.update(poLineItems)
          .set({ stockItemId: keptItem.id, itemName: keptItem.name })
          .where(eq(poLineItems.stockItemId, log.mergedItemId))
          .returning({ id: poLineItems.id });

        totalFixed += updated.length;
      }

      // ── Pass 2: fix po_line_items that reference a deleted stock item with
      //            no merge log — resolve via stockItemCodeAliases fallback ──
      // Find distinct deleted stockItemIds referenced by po_line_items
      const deletedRefsRaw = await db.execute(
        sql`SELECT DISTINCT pli.stock_item_id AS "stockItemId", si.code AS "code"
            FROM po_line_items pli
            JOIN stock_items si ON si.id = pli.stock_item_id
            WHERE si.company_id = ${companyId}
              AND si.deleted_at IS NOT NULL`,
      );
      const deletedRefs: { stockItemId: number; code: string }[] =
        ((deletedRefsRaw as any).rows ?? (deletedRefsRaw as unknown as any[]));

      // Only process those NOT already handled by a merge log
      const uncovered = deletedRefs.filter(r => !coveredByLog.has(r.stockItemId));

      for (const ref of uncovered) {
        // Look up the kept item via stockItemCodeAliases:
        // when a merge happens, the old code is stored as an alias on the kept item
        const [alias] = await db
          .select({ stockItemId: stockItemCodeAliases.stockItemId })
          .from(stockItemCodeAliases)
          .where(and(
            eq(stockItemCodeAliases.companyId, companyId),
            eq(stockItemCodeAliases.aliasCode,  ref.code),
          ));

        if (!alias) continue;

        const [keptItem] = await db.select({ id: stockItems.id, name: stockItems.name })
          .from(stockItems)
          .where(and(eq(stockItems.id, alias.stockItemId), isNull(stockItems.deletedAt)));
        if (!keptItem) continue;

        const updated = await db.update(poLineItems)
          .set({ stockItemId: keptItem.id, itemName: keptItem.name })
          .where(eq(poLineItems.stockItemId, ref.stockItemId))
          .returning({ id: poLineItems.id });

        totalFixed += updated.length;
      }

      return res.json({ fixed: totalFixed, mergesChecked: mergeLogs.length, aliasesChecked: uncovered.length });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Merge Logs: GET /api/stock-items/merge-logs ──────────────────────────
  app.get("/api/stock-items/merge-logs", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const logs = await db.select().from(stockItemMergeLogs)
        .where(eq(stockItemMergeLogs.companyId, companyId))
        .orderBy(desc(stockItemMergeLogs.mergedAt))
        .limit(50);
      return res.json(logs);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Historical merge reconstruction: GET /api/stock-items/merge-logs/historical ──
  // Rebuilds pre-feature merge history from the alias breadcrumbs that the merge
  // logic always writes: aliasCode = merged item's code, description = "Merged from: …".
  // Excludes any merges already present in stock_item_merge_logs (already covered).
  app.get("/api/stock-items/merge-logs/historical", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db.execute(sql`
        SELECT
          a.stock_item_id        AS "keptItemId",
          si_kept.code           AS "keptItemCode",
          si_kept.name           AS "keptItemName",
          si_merged.id           AS "mergedItemId",
          si_merged.code         AS "mergedItemCode",
          REPLACE(si_merged.name, '[MERGED] ', '') AS "mergedItemName",
          COALESCE(si_merged.deleted_at, a.created_at) AS "mergedAt",
          a.description          AS "notes"
        FROM stock_item_code_aliases a
        JOIN stock_items si_kept
          ON si_kept.id = a.stock_item_id
         AND si_kept.company_id = a.company_id
        JOIN stock_items si_merged
          ON si_merged.code = a.alias_code
         AND si_merged.company_id = a.company_id
         AND si_merged.active = false
        WHERE a.company_id = ${companyId}
          AND a.description LIKE 'Merged from:%'
          AND si_merged.id NOT IN (
            SELECT merged_item_id FROM stock_item_merge_logs WHERE company_id = ${companyId}
          )
        ORDER BY COALESCE(si_merged.deleted_at, a.created_at) DESC
        LIMIT 200
      `);

      const data = ((rows as any).rows ?? (rows as any)).map((r: any) => ({
        ...r,
        id: null,
        source: "historical",
      }));

      return res.json(data);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Historical restore: POST /api/stock-items/merge-logs/historical-restore ──
  // Restores a historically merged item without a snapshot:
  //   1. Sets item active=true, clears deletedAt, strips "[MERGED] " from name
  //   2. Deletes the alias that was routing the old code → kept item
  // Inventory is NOT touched — user must manually redistribute quantities.
  app.post("/api/stock-items/merge-logs/historical-restore", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { mergedItemId, keptItemId } = req.body;
      if (!mergedItemId || !keptItemId) {
        return res.status(400).json({ message: "mergedItemId and keptItemId are required" });
      }

      // Load the soft-deleted merged item
      const [mergedItem] = await db
        .select()
        .from(stockItems)
        .where(and(
          eq(stockItems.id, mergedItemId),
          eq(stockItems.companyId, companyId),
          eq(stockItems.active, false),
        ))
        .limit(1);

      if (!mergedItem) {
        return res.status(404).json({ message: "Merged item not found or already active" });
      }

      // Strip the [MERGED] prefix from the name
      const restoredName = mergedItem.name.replace(/^\[MERGED\]\s*/i, "");

      // Step 1 — Restore the merged item
      await db.update(stockItems)
        .set({ active: true, deletedAt: null, name: restoredName })
        .where(and(eq(stockItems.id, mergedItemId), eq(stockItems.companyId, companyId)));

      // Step 2 — Remove the alias that routed the old code → kept item
      await db.delete(stockItemCodeAliases)
        .where(and(
          eq(stockItemCodeAliases.companyId, companyId),
          eq(stockItemCodeAliases.stockItemId, keptItemId),
          eq(stockItemCodeAliases.aliasCode, mergedItem.code),
        ));

      return res.json({
        success: true,
        restoredName,
        message: `"${restoredName}" has been restored as a separate active item. Its code alias has been removed. Please manually adjust inventory quantities between this item and the kept item.`,
      });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // ── Unmerge: POST /api/stock-items/merge-logs/:logId/unmerge ─────────────
  // Reverses a previous merge using the saved snapshotBefore.
  // Restores: item active status, inventory quantities/values, and the main code alias.
  // NOTE: Location prices deleted during merge and transferred aliases cannot be recovered.
  app.post("/api/stock-items/merge-logs/:logId/unmerge", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: number = req.user?.id ?? req.session.userId;

      const logId = parseInt(req.params.logId);
      if (isNaN(logId)) return res.status(400).json({ message: "Invalid log ID" });

      const [log] = await db.select().from(stockItemMergeLogs)
        .where(and(eq(stockItemMergeLogs.id, logId), eq(stockItemMergeLogs.companyId, companyId)));
      if (!log) return res.status(404).json({ message: "Merge log not found" });

      const { keptItemId, mergedItemId, mergedItemName, mergedItemCode, snapshotBefore } = log;

      // Verify the merged item still exists and is soft-deleted (i.e. still unmerge-able)
      const [mergedItem] = await db.select().from(stockItems)
        .where(and(eq(stockItems.id, mergedItemId), eq(stockItems.companyId, companyId)));
      if (!mergedItem) return res.status(404).json({ message: "Merged item record not found" });
      if (!mergedItem.deletedAt) return res.status(400).json({ message: "This item does not appear to be merged — it is currently active" });

      await db.transaction(async (tx) => {
        // Step 1 — Restore the merged item (undo soft-delete)
        await tx.update(stockItems)
          .set({ active: true, deletedAt: null, name: mergedItemName })
          .where(eq(stockItems.id, mergedItemId));

        // Step 2 — Restore inventory from snapshotBefore
        // The snapshot has entries keyed as `${stockItemId}_${locationId}`
        type SnapEntry = { stockItemId: number; locationId: number; quantity: string; averageRate: string; totalValue: string };
        const snapEntries: SnapEntry[] = Object.values(snapshotBefore as Record<string, unknown>).map((v: any) => ({
          stockItemId: Number(v.stockItemId),
          locationId:  Number(v.locationId),
          quantity:    String(v.quantity),
          averageRate: String(v.averageRate),
          totalValue:  String(v.totalValue),
        }));

        // Collect the locations touched by either item in the snapshot
        const keptLocations = snapEntries.filter(e => e.stockItemId === keptItemId).map(e => e.locationId);
        const dupLocations  = snapEntries.filter(e => e.stockItemId === mergedItemId).map(e => e.locationId);
        const allLocations  = [...new Set([...keptLocations, ...dupLocations])];

        // Delete current inventory rows for both items at those locations (we'll re-insert from snapshot)
        if (allLocations.length > 0) {
          await tx.delete(inventory)
            .where(and(
              eq(inventory.companyId, companyId),
              inArray(inventory.locationId, allLocations),
              inArray(inventory.stockItemId, [keptItemId, mergedItemId]),
            ));
        }

        // Re-insert each snapshot row
        for (const entry of snapEntries) {
          // Check if a row already exists (e.g. at a location not in our delete list)
          const [existing] = await tx.select().from(inventory)
            .where(and(
              eq(inventory.stockItemId, entry.stockItemId),
              eq(inventory.locationId,  entry.locationId),
              eq(inventory.companyId,   companyId),
            ));
          if (existing) {
            await tx.update(inventory)
              .set({ quantity: entry.quantity, averageRate: entry.averageRate, totalValue: entry.totalValue, lastUpdated: new Date() })
              .where(and(eq(inventory.stockItemId, entry.stockItemId), eq(inventory.locationId, entry.locationId), eq(inventory.companyId, companyId)));
          } else {
            await tx.insert(inventory).values({
              companyId,
              stockItemId:  entry.stockItemId,
              locationId:   entry.locationId,
              quantity:     entry.quantity,
              averageRate:  entry.averageRate,
              totalValue:   entry.totalValue,
              lastUpdated:  new Date(),
            });
          }
        }

        // Step 3 — Delete the code alias created during merge (mergedItemCode → keptItemId)
        await tx.delete(stockItemCodeAliases)
          .where(and(
            eq(stockItemCodeAliases.stockItemId, keptItemId),
            eq(stockItemCodeAliases.aliasCode,   mergedItemCode),
            eq(stockItemCodeAliases.companyId,   companyId),
          ));

        // Step 4 — Delete the merge log so the same merge cannot be unmerged twice
        await tx.delete(stockItemMergeLogs).where(eq(stockItemMergeLogs.id, logId));
      });

      await logAudit(userId, companyId, "unmerge_stock_item", {
        logId, keptItemId, mergedItemId, mergedItemName,
      });

      return res.json({ success: true, message: `"${mergedItemName}" has been restored as a separate item.` });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  // Bank Accounts
}
