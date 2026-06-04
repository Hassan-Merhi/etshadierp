import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { requireActionAccess } from "../lib/permissionMiddleware";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
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
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory } from "../inventoryHelper";

export function registerStockRoutes(app: Express) {
  app.get("/api/stock-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllStockGroups(
        req.session.currentCompanyId,
      );
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/stock-groups",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Inject companyId before schema validation
        const dataWithCompany = {
          ...req.body,
          companyId: req.session.currentCompanyId,
        };

        const parsed = insertStockGroupSchema.parse(dataWithCompany);

        // Check for duplicate code within the same company
        const existing = await storage.getStockGroupByCode(
          parsed.code,
          req.session.currentCompanyId,
        );
        if (existing) {
          return res
            .status(400)
            .json({
              message: "Stock group code already exists in this company",
            });
        }

        const group = await storage.createStockGroup(parsed);
        res.status(201).json(group);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // ── Stock Grades ────────────────────────────────────────────────────────────

  app.get("/api/stock-grades", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const includeInactive = req.query.includeInactive === "true";
      const conds = [eq(stockGrades.companyId, companyId)];
      if (!includeInactive) conds.push(eq(stockGrades.active, true));
      const rows = await db.select().from(stockGrades).where(and(...conds)).orderBy(asc(stockGrades.name));
      res.json(rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/stock-grades", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertStockGradeSchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(stockGrades).values(parsed).returning();
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "stock_grades", recordId: created.id, recordIdentifier: created.name, changes: { name: { old: null, new: created.name } } });
      } catch { /* non-fatal */ }
      res.status(201).json(created);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/stock-grades/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db.select().from(stockGrades).where(and(eq(stockGrades.id, id), eq(stockGrades.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock grade not found" });
      const updates: any = {};
      if (req.body.name !== undefined) {
        const n = String(req.body.name).trim();
        if (!n) return res.status(400).json({ message: "Name is required" });
        updates.name = n;
      }
      if (req.body.active !== undefined) updates.active = req.body.active;
      const [updated] = await db.update(stockGrades).set(updates).where(eq(stockGrades.id, id)).returning();
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "stock_grades", recordId: id, recordIdentifier: updated.name, changes: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, { old: (existing as any)[k], new: v }])) });
      } catch { /* non-fatal */ }
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete("/api/stock-grades/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db.select().from(stockGrades).where(and(eq(stockGrades.id, id), eq(stockGrades.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock grade not found" });
      await db.update(stockGrades).set({ active: false }).where(eq(stockGrades.id, id));
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "stock_grades", recordId: id, recordIdentifier: existing.name, changes: { active: { old: true, new: false } } });
      } catch { /* non-fatal */ }
      res.json({ message: "Stock grade deactivated" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // ── Stock Categories ─────────────────────────────────────────────────────────

  app.get("/api/stock-categories", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const includeInactive = req.query.includeInactive === "true";
      const conds = [eq(stockCategories.companyId, companyId)];
      if (!includeInactive) conds.push(eq(stockCategories.active, true));
      const rows = await db.select().from(stockCategories).where(and(...conds)).orderBy(asc(stockCategories.name));
      res.json(rows);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post("/api/stock-categories", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertStockCategorySchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(stockCategories).values(parsed).returning();
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "create", tableName: "stock_categories", recordId: created.id, recordIdentifier: created.name, changes: { name: { old: null, new: created.name } } });
      } catch { /* non-fatal */ }
      res.status(201).json(created);
    } catch (error: any) { res.status(400).json({ message: error.message }); }
  });

  app.patch("/api/stock-categories/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db.select().from(stockCategories).where(and(eq(stockCategories.id, id), eq(stockCategories.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock category not found" });
      const updates: any = {};
      if (req.body.name !== undefined) {
        const n = String(req.body.name).trim();
        if (!n) return res.status(400).json({ message: "Name is required" });
        updates.name = n;
      }
      if (req.body.active !== undefined) updates.active = req.body.active;
      const [updated] = await db.update(stockCategories).set(updates).where(eq(stockCategories.id, id)).returning();
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "stock_categories", recordId: id, recordIdentifier: updated.name, changes: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, { old: (existing as any)[k], new: v }])) });
      } catch { /* non-fatal */ }
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete("/api/stock-categories/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db.select().from(stockCategories).where(and(eq(stockCategories.id, id), eq(stockCategories.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock category not found" });
      await db.update(stockCategories).set({ active: false }).where(eq(stockCategories.id, id));
      try {
        await logAudit({ userId: req.session.userId!, username: (req.session as any).username || "unknown", companyId, action: "update", tableName: "stock_categories", recordId: id, recordIdentifier: existing.name, changes: { active: { old: true, new: false } } });
      } catch { /* non-fatal */ }
      res.json({ message: "Stock category deactivated" });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Stock Items
  app.get("/api/stock-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { page, pageSize, search, stockGroupId, active } = req.query;

      // No page param → flat array (backward-compat for dropdowns / offline sync)
      if (!page) {
        const items = await storage.getAllStockItems(companyId);
        return res.json(items);
      }

      // Paginated path
      const pageNum = Math.max(1, parseInt(page as string) || 1);
      const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize as string) || 50));
      const offset = (pageNum - 1) * pageSizeNum;

      const conditions: any[] = [
        eq(stockItems.companyId, companyId),
        isNull(stockItems.deletedAt),
      ];
      if (search && typeof search === "string" && search.trim()) {
        const q = `%${search.trim()}%`;
        conditions.push(or(ilike(stockItems.name, q), ilike(stockItems.code, q)));
      }
      if (stockGroupId && stockGroupId !== "all") {
        conditions.push(eq(stockItems.stockGroupId, parseInt(stockGroupId as string)));
      }
      const { gradeId, categoryId } = req.query;
      if (gradeId === "none") {
        conditions.push(isNull(stockItems.gradeId));
      } else if (gradeId && gradeId !== "all") {
        conditions.push(eq(stockItems.gradeId, parseInt(gradeId as string)));
      }
      if (categoryId === "none") {
        conditions.push(isNull(stockItems.categoryId));
      } else if (categoryId && categoryId !== "all") {
        conditions.push(eq(stockItems.categoryId, parseInt(categoryId as string)));
      }
      if (active === "true") {
        conditions.push(eq(stockItems.active, true));
      } else if (active === "false") {
        conditions.push(eq(stockItems.active, false));
      }
      const where = and(...conditions);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(stockItems)
        .where(where);

      const data = await db
        .select()
        .from(stockItems)
        .where(where)
        .orderBy(asc(stockItems.name))
        .limit(pageSizeNum)
        .offset(offset);

      return res.json({ data, page: pageNum, pageSize: pageSizeNum, total, totalPages: Math.ceil(total / pageSizeNum) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-items", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertStockItemSchema.parse(dataWithCompany);

      // Require a valid stock group (no null/uncategorized)
      if (!parsed.stockGroupId) {
        return res.status(400).json({ message: "Stock Group is required. Please select a valid stock group." });
      }

      // Check for duplicate code within the same company
      const existing = await storage.getStockItemByCode(
        parsed.code,
        req.session.currentCompanyId,
      );
      if (existing) {
        return res
          .status(400)
          .json({ message: "Stock item code already exists in this company" });
      }

      // Calculate opening value if qty and rate provided
      if (parsed.openingQty && parsed.openingRate) {
        const qty = parseFloat(parsed.openingQty);
        const rate = parseFloat(parsed.openingRate);
        parsed.openingValue = (qty * rate).toFixed(2);
      }

      const item = await storage.createStockItem(parsed);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "stock_items",
          recordId: item.id,
          recordIdentifier: item.name,
          changes: {
            name: { new: item.name },
            code: { new: item.code },
            uom: { new: item.uom },
            sellingPrice: { new: item.sellingPrice || "0" },
            openingQty: { new: item.openingQty || "0" },
            openingRate: { new: item.openingRate || "0" },
          },
        });
      } catch { /* non-fatal */ }
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bulk delete stock items
  app.post("/api/stock-items/bulk-delete", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { ids: rawIds } = req.body;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return res.status(400).json({ message: "Invalid or empty ids array" });
      }
      // Explicitly parse all IDs as integers to prevent "operator does not exist: integer = text"
      const ids = rawIds.map((id: any) => parseInt(id, 10)).filter((n: number) => !isNaN(n) && n > 0);
      if (ids.length === 0) {
        return res.status(400).json({ message: "No valid numeric IDs provided" });
      }

      // Get all items that exist and belong to the current company
      const validItems = await storage.bulkGetStockItemsByIds(ids, req.session.currentCompanyId);
      const validIds = validItems.map(item => item.id);
      
      if (validIds.length === 0) {
        return res.status(404).json({ message: "No valid stock items found to delete" });
      }

      // Block deletion if any item has inventory records (regardless of quantity)
      const inventoryCheck = await db.execute(
        sql`SELECT stock_item_id FROM inventory WHERE stock_item_id = ANY(ARRAY[${sql.join(validIds.map(id => sql`${id}`), sql`, `)}]) GROUP BY stock_item_id`
      );
      if ((inventoryCheck.rows as any[]).length > 0) {
        const blockedIds = new Set((inventoryCheck.rows as any[]).map((r: any) => parseInt(r.stock_item_id)));
        const blockedCodes = validItems
          .filter(item => blockedIds.has(item.id))
          .map(item => item.code);
        return res.status(400).json({
          message: `Cannot delete ${blockedCodes.length} item(s) — they have existing inventory records: ${blockedCodes.join(", ")}. Please clear all inventory first.`,
        });
      }

      await storage.bulkDeleteStockItems(validIds);
      try {
        for (const deletedItem of validItems) {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "delete",
            tableName: "stock_items",
            recordId: deletedItem.id,
            recordIdentifier: deletedItem.name,
            changes: {
              name: { old: deletedItem.name },
              code: { old: deletedItem.code },
              uom: { old: deletedItem.uom },
            },
          });
        }
      } catch { /* non-fatal */ }

      const skippedCount = ids.length - validIds.length;
      const message = skippedCount > 0
        ? `Successfully deleted ${validIds.length} stock item(s). ${skippedCount} item(s) were skipped (not found or belong to another company).`
        : `Successfully deleted ${validIds.length} stock item(s)`;

      res.json({ 
        message,
        deleted: validIds.length,
        skipped: skippedCount
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk assign category to stock items
  app.post("/api/stock-items/bulk-assign-category", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const companyId = req.session.currentCompanyId;
      const { ids: rawIds, categoryId: rawCategoryId } = req.body;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return res.status(400).json({ message: "Invalid or empty ids array" });
      }
      const ids = rawIds.map((id: any) => parseInt(id, 10)).filter((n: number) => !isNaN(n) && n > 0);
      if (ids.length === 0) {
        return res.status(400).json({ message: "No valid numeric IDs provided" });
      }
      // categoryId null means remove category
      const categoryId = rawCategoryId === null || rawCategoryId === undefined ? null : parseInt(rawCategoryId, 10);

      // Verify items belong to this company
      const validItems = await storage.bulkGetStockItemsByIds(ids, companyId);
      const validIds = validItems.map(item => item.id);
      if (validIds.length === 0) {
        return res.status(404).json({ message: "No valid stock items found" });
      }

      await db
        .update(stockItems)
        .set({ categoryId: isNaN(categoryId as number) ? null : categoryId })
        .where(and(
          inArray(stockItems.id, validIds),
          eq(stockItems.companyId, companyId)
        ));

      res.json({ message: `Category updated for ${validIds.length} item(s)`, updated: validIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk update selling prices by barcode (global or location-specific)
  app.post("/api/stock-items/bulk-update-prices", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { prices } = req.body;
      if (!Array.isArray(prices) || prices.length === 0) {
        return res.status(400).json({ message: "Invalid or empty prices array" });
      }

      const companyId = req.session.currentCompanyId;

      // Pre-fetch all items + aliases once to avoid N+1
      const allItems = await storage.getAllStockItems(companyId);
      const allAliases = await storage.getAllCompanyCodeAliases(companyId);
      const itemsById = new Map(allItems.map(i => [i.id, i]));
      const itemsByCode = new Map<string, typeof allItems[0]>();
      for (const item of allItems) {
        if (item.code) itemsByCode.set(item.code.toLowerCase(), item);
      }
      for (const alias of allAliases) {
        if (alias.aliasCode && !itemsByCode.has(alias.aliasCode.toLowerCase())) {
          const item = itemsById.get(alias.stockItemId);
          if (item) itemsByCode.set(alias.aliasCode.toLowerCase(), item);
        }
      }

      let updated = 0;
      let notFound = 0;
      type GlobalUpdate = { id: number; sellingPrice: string };
      type LocationUpdate = { stockItemId: number; locationId: number; sellingPrice: string };
      const globalUpdates: GlobalUpdate[] = [];
      const locationUpdates: LocationUpdate[] = [];

      for (const priceEntry of prices) {
        const { barcode, sellingPrice, locationId } = priceEntry;
        if (!barcode || !sellingPrice) continue;
        const item = itemsByCode.get((barcode as string).toLowerCase());
        if (item) {
          if (locationId) {
            locationUpdates.push({ stockItemId: item.id, locationId, sellingPrice });
          } else {
            globalUpdates.push({ id: item.id, sellingPrice });
          }
          updated++;
        } else {
          notFound++;
        }
      }

      if (globalUpdates.length > 0 || locationUpdates.length > 0) {
        await db.transaction(async (tx) => {
          for (const u of globalUpdates) {
            await tx.update(stockItems).set({ sellingPrice: u.sellingPrice }).where(eq(stockItems.id, u.id));
          }
          for (const u of locationUpdates) {
            await tx.insert(stockItemLocationPrices).values({
              stockItemId: u.stockItemId,
              locationId: u.locationId,
              sellingPrice: u.sellingPrice,
            }).onConflictDoUpdate({
              target: [stockItemLocationPrices.stockItemId, stockItemLocationPrices.locationId],
              set: { sellingPrice: u.sellingPrice, updatedAt: new Date() },
            });
          }
        });
      }

      const message = `Updated ${updated} price(s)${notFound > 0 ? `. ${notFound} barcode(s) not found.` : "."}`;
      try {
        if (updated > 0) {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: companyId,
            action: "update",
            tableName: "stock_items",
            recordId: 0,
            recordIdentifier: `Bulk price update (${updated} items)`,
            changes: {
              pricesUpdated: { new: updated },
              barcodesNotFound: { new: notFound },
            },
          });
        }
      } catch { /* non-fatal */ }
      res.json({ message, updated, notFound });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Opening Balances from Excel (columns: Barcode, Qty, Rate, Total Value)
  // This only updates stockItems opening fields, does NOT affect location inventory
  app.post("/api/stock-items/import-opening-balances", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { openingBalances } = req.body;
      if (!Array.isArray(openingBalances) || openingBalances.length === 0) {
        return res.status(400).json({ message: "Invalid or empty opening balances array" });
      }

      let updated = 0;
      let notFound = 0;
      const notFoundBarcodes: string[] = [];

      // Pre-fetch all stock items once for efficient lookup
      const allItems = await storage.getAllStockItems(req.session.currentCompanyId);
      // Map by primary code field (skip empty/null codes)
      const itemsByCode = new Map<string, typeof allItems[0]>();
      const itemsById = new Map(allItems.map(i => [i.id, i]));
      for (const item of allItems) {
        if (item.code && typeof item.code === 'string') {
          itemsByCode.set((item.code || "").toLowerCase(), item);
        }
      }
      
      // Pre-fetch all code aliases and build alias lookup map (skip empty/null aliases)
      const allAliases = await storage.getAllCompanyCodeAliases(req.session.currentCompanyId);
      const itemsByAlias = new Map<string, typeof allItems[0]>();
      for (const alias of allAliases) {
        if (alias.aliasCode && typeof alias.aliasCode === 'string') {
          const item = itemsById.get(alias.stockItemId);
          if (item) {
            itemsByAlias.set((alias.aliasCode || "").toLowerCase(), item);
          }
        }
      }

      for (const entry of openingBalances) {
        const { barcode, openingQty, openingRate, openingValue } = entry;
        if (!barcode || typeof barcode !== 'string') continue;

        // Find item by primary code first, then by alias (case-insensitive)
        const barcodeLC = (barcode || "").toLowerCase();
        const item = itemsByCode.get(barcodeLC) || itemsByAlias.get(barcodeLC);

        if (item) {
          // Calculate total value if not provided: qty * rate
          const qty = parseFloat(openingQty) || 0;
          const rate = parseFloat(openingRate) || 0;
          let totalValue = parseFloat(openingValue) || 0;
          
          // If total value not provided, calculate from qty * rate
          if (totalValue === 0 && qty > 0 && rate > 0) {
            totalValue = qty * rate;
          }

          await storage.updateStockItem(item.id, {
            openingQty: String(qty),
            openingRate: String(rate),
            openingValue: String(totalValue),
          });
          updated++;
        } else {
          notFound++;
          notFoundBarcodes.push(barcode);
        }
      }

      const message = `Updated opening balances for ${updated} item(s)${notFound > 0 ? `. ${notFound} barcode(s) not found: ${notFoundBarcodes.slice(0, 5).join(", ")}${notFoundBarcodes.length > 5 ? "..." : ""}` : "."}`;
      res.json({ message, updated, notFound, notFoundBarcodes });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk update UOM from "bale" to "BL"
  app.post("/api/stock-items/bulk-update-uom", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Find all stock items with UOM = "bale" for current company (case-insensitive)
      const baleItems = await db.query.stockItems.findMany({
        where: and(
          eq(stockItems.companyId, req.session.currentCompanyId),
          or(
            eq(stockItems.uom, "bale"),
            eq(stockItems.uom, "Bale"),
            eq(stockItems.uom, "BALE")
          )
        ),
      });

      if (baleItems.length === 0) {
        return res.json({ message: "No items with UOM 'bale' found to update", updated: 0 });
      }

      // Update all bale items to BL
      let updated = 0;
      for (const item of baleItems) {
        await storage.updateStockItem(item.id, { uom: "BL" });
        updated++;
      }

      res.json({ message: `Successfully updated ${updated} stock item(s) from 'bale' to 'BL'`, updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk rename stock items
  app.post("/api/stock-items/bulk-rename", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { findText, replaceWith, itemIds, wholeWordOnly, caseInsensitive } = req.body;

      if (!findText || typeof findText !== "string" || findText.trim() === "") {
        return res.status(400).json({ message: "findText is required" });
      }
      if (typeof replaceWith !== "string") {
        return res.status(400).json({ message: "replaceWith is required" });
      }
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ message: "itemIds must be a non-empty array" });
      }

      const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = wholeWordOnly ? `\\b${escaped}\\b` : escaped;
      const flags = caseInsensitive !== false ? "gi" : "g";
      const regex = new RegExp(pattern, flags);

      const results: { id: number; oldName: string; newName: string }[] = [];
      const failures: { id: number; name: string; reason: string }[] = [];

      const validItems = await storage.bulkGetStockItemsByIds(
        itemIds.map((id: any) => Number(id)),
        req.session.currentCompanyId
      );

      for (const item of validItems) {
        const newName = item.name.replace(regex, replaceWith);
        if (newName === item.name) {
          continue;
        }
        if (!newName || newName.trim() === "") {
          failures.push({ id: item.id, name: item.name, reason: "Resulting name would be empty" });
          continue;
        }
        try {
          await storage.updateStockItem(item.id, { name: newName });
          results.push({ id: item.id, oldName: item.name, newName });
        } catch (err: any) {
          failures.push({ id: item.id, name: item.name, reason: err.message });
        }
      }

      res.json({
        message: `Renamed ${results.length} item(s)`,
        updated: results.length,
        results,
        failures,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get cost dubai from OTW containers for stock items
  app.get("/api/stock-items/cost-dubai", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const result = await db.execute(sql`
        SELECT DISTINCT ON (pli.stock_item_id)
          pli.stock_item_id AS "stockItemId",
          pli.rate AS "costDubai"
        FROM po_line_items pli
        JOIN purchase_orders po ON pli.po_id = po.id
        JOIN containers c ON po.container_id = c.id
        WHERE po.company_id = ${companyId}
        ORDER BY pli.stock_item_id, pli.id DESC
      `);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Offload item search — find all offloaded containers that contain a given item
  app.get("/api/offload-item-search", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const q = (req.query.q as string || "").trim();
      if (!q) return res.json([]);

      const result = await db.execute(sql`
        SELECT
          pli.item_name       AS "itemName",
          pli.quantity        AS "quantity",
          pli.rate            AS "rate",
          pli.line_total      AS "lineTotal",
          po.po_number        AS "poNumber",
          c.container_number  AS "containerNumber",
          c.offload_date      AS "offloadDate",
          c.import_date       AS "importDate",
          c.status            AS "containerStatus",
          po.currency         AS "currency",
          s.legal_name        AS "supplierName"
        FROM po_line_items pli
        JOIN purchase_orders po ON pli.po_id = po.id
        JOIN containers c ON po.container_id = c.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.company_id = ${companyId}
          AND c.offload_date IS NOT NULL
          AND pli.item_name ILIKE ${'%' + q + '%'}
        ORDER BY c.offload_date DESC, pli.item_name
      `);
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Export last 4 sales per stock item (for Excel export)
  app.get("/api/stock-items/last-sales-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db.execute(sql`
        WITH ranked AS (
          SELECT
            si.stock_item_id   AS "stockItemId",
            sk.code            AS "itemCode",
            sk.name            AS "itemName",
            v.voucher_number   AS "voucherNumber",
            v.voucher_date     AS "voucherDate",
            COALESCE(l.name, '') AS "locationName",
            si.quantity        AS "quantity",
            si.selling_price   AS "rate",
            si.total_sales     AS "amount",
            ROW_NUMBER() OVER (
              PARTITION BY si.stock_item_id
              ORDER BY v.voucher_date DESC, v.id DESC
            ) AS rn
          FROM sales_items si
          JOIN vouchers v ON si.voucher_id = v.id
          JOIN stock_items sk ON si.stock_item_id = sk.id
          LEFT JOIN locations l ON v.location_id = l.id
          WHERE v.company_id = ${companyId}
            AND v.optional = false
        )
        SELECT "stockItemId", "itemCode", "itemName", "voucherNumber",
               "voucherDate", "locationName", "quantity", "rate", "amount", rn
        FROM ranked
        WHERE rn <= 4
        ORDER BY "itemName" ASC, rn ASC
      `);

      res.json(rows.rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Grade/Category Template Export ───────────────────────────────────────────
  // MUST be defined before /api/stock-items/:id to avoid route conflict

  app.get("/api/stock-items/export-grade-category-template", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          id: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
          uom: stockItems.uom,
          active: stockItems.active,
          sellingPrice: stockItems.sellingPrice,
          gradeName: sql<string | null>`${stockGrades.name}`,
          categoryName: sql<string | null>`${stockCategories.name}`,
        })
        .from(stockItems)
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .leftJoin(stockGrades, eq(stockItems.gradeId, stockGrades.id))
        .leftJoin(stockCategories, eq(stockItems.categoryId, stockCategories.id))
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
        .orderBy(asc(stockItems.code));

      const data = rows.map((r) => ({
        "Item ID": r.id,
        "Item Code": r.code,
        "Item Name": r.name,
        "Stock Group": r.stockGroupName,
        "UOM": r.uom,
        "Active": r.active ? "Yes" : "No",
        "Selling Price": r.sellingPrice ?? "0",
        "Current Grade": r.gradeName ?? "",
        "Current Category": r.categoryName ?? "",
      }));

      const wb = createWorkbook();
      const ws = jsonToSheet(wb, data, "Stock Items");

      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.commit();

      ws.getColumn(8).width = 20;
      ws.getColumn(9).width = 22;
      ws.columns.forEach((col, i) => {
        if (i < 7) col.width = Math.max(col.width || 12, 15);
      });

      const buffer = await writeWorkbook(wb);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=\"grade-category-template.xlsx\"");
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get single stock item by ID
  app.get("/api/stock-items/:id", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (stockItem.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Stock item belongs to a different company",
          });
      }

      res.json(stockItem);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  // Get all location prices for the current company (for export)
  app.get("/api/stock-item-location-prices/all", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const prices = await storage.getAllLocationPrices(companyId);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get location prices for a stock item
  app.get("/api/stock-items/:id/location-prices", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      const prices = await storage.getStockItemLocationPrices(stockItemId, req.session.currentCompanyId);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update or create location price for a stock item (cascades to follower locations)
  app.post("/api/stock-items/:id/location-prices", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      const { locationId, sellingPrice } = req.body;
      if (!locationId || !sellingPrice) {
        return res.status(400).json({ message: "Location ID and selling price are required" });
      }

      const companyId = req.session.currentCompanyId;

      // Save price for the target location
      await storage.upsertLocationPrice(stockItemId, locationId, sellingPrice);

      // Cascade to follower locations if this is a master location
      if (companyId) {
        const followers = await db
          .select({ followerLocationId: locationPriceGroups.followerLocationId })
          .from(locationPriceGroups)
          .where(
            and(
              eq(locationPriceGroups.companyId, companyId),
              eq(locationPriceGroups.masterLocationId, locationId)
            )
          );
        for (const f of followers) {
          await storage.upsertLocationPrice(stockItemId, f.followerLocationId, sellingPrice);
        }
      }

      res.json({ message: "Location price updated successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete location price
  app.delete("/api/stock-item-location-prices/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const priceId = parseInt(req.params.id);
      if (isNaN(priceId)) {
        return res.status(400).json({ message: "Invalid price ID" });
      }

      await storage.deleteLocationPrice(priceId);
      res.json({ message: "Location price deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Location Price Groups ──────────────────────────────────────────────────
  // GET: returns { masterLocationId, followerLocationIds[] } for each master
  app.get("/api/location-price-groups", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select()
        .from(locationPriceGroups)
        .where(eq(locationPriceGroups.companyId, companyId));

      // Group by masterLocationId
      const map = new Map<number, number[]>();
      for (const r of rows) {
        if (!map.has(r.masterLocationId)) map.set(r.masterLocationId, []);
        map.get(r.masterLocationId)!.push(r.followerLocationId);
      }
      const result = Array.from(map.entries()).map(([masterLocationId, followerLocationIds]) => ({
        masterLocationId,
        followerLocationIds,
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PUT: replaces the full group config for the company
  app.put("/api/location-price-groups", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // groups: Array<{ masterLocationId: number; followerLocationIds: number[] }>
      const { groups } = req.body as { groups: { masterLocationId: number; followerLocationIds: number[] }[] };
      if (!Array.isArray(groups)) return res.status(400).json({ message: "groups must be an array" });

      // Delete all existing for this company, then re-insert
      await db.delete(locationPriceGroups).where(eq(locationPriceGroups.companyId, companyId));

      const toInsert = groups.flatMap((g) =>
        g.followerLocationIds.map((fid) => ({
          companyId,
          masterLocationId: g.masterLocationId,
          followerLocationId: fid,
        }))
      );
      if (toInsert.length > 0) {
        await db.insert(locationPriceGroups).values(toInsert);
      }

      res.json({ message: "Price groups saved" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Price List: get all stock items with location-specific selling prices
  // Fallback rule: if no custom location price, falls back to stock item base selling price
  app.get("/api/pos/price-list", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const locationIdParam = req.query.locationId as string;
      const showAll = locationIdParam === "all";
      const locationId = showAll ? null : parseInt(locationIdParam);

      if (!showAll && isNaN(locationId as number)) {
        return res.status(400).json({ message: "locationId query parameter is required" });
      }

      const isPOS = req.user?.role === "POS";
      const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes(req.user?.role || "");

      if (showAll && isPOS) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!showAll) {
        if (isPOS) {
          const assigned = await db
            .select({ locationId: userLocations.locationId })
            .from(userLocations)
            .where(
              and(
                eq(userLocations.userId, req.user!.id),
                eq(userLocations.companyId, companyId)
              )
            );
          const assignedIds = assigned.map((r) => r.locationId);
          if (!assignedIds.includes(locationId as number)) {
            return res.status(403).json({ message: "Forbidden: location not assigned to this user" });
          }
        } else {
          const [loc] = await db
            .select({ id: locations.id })
            .from(locations)
            .where(and(eq(locations.id, locationId as number), eq(locations.companyId, companyId)));
          if (!loc) {
            return res.status(403).json({ message: "Forbidden: location not found" });
          }
        }
      }

      let rows: any[];

      if (showAll) {
        rows = await db
          .select({
            stockItemId: stockItems.id,
            code: stockItems.code,
            name: stockItems.name,
            stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
            baseSellingPrice: stockItems.sellingPrice,
            hasCustomPrice: sql<boolean>`false`,
            sellingPrice: stockItems.sellingPrice,
            quantity: sql<string>`'0'`,
          })
          .from(stockItems)
          .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
          .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
          .orderBy(stockItems.name);
      } else {
        rows = await db
          .select({
            stockItemId: stockItems.id,
            code: stockItems.code,
            name: stockItems.name,
            stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
            baseSellingPrice: stockItems.sellingPrice,
            hasCustomPrice: sql<boolean>`(${stockItemLocationPrices.sellingPrice} IS NOT NULL)`,
            sellingPrice: sql<string>`COALESCE(${stockItemLocationPrices.sellingPrice}, ${stockItems.sellingPrice})`,
            quantity: sql<string>`COALESCE(${inventory.quantity}::text, '0')`,
          })
          .from(stockItems)
          .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
          .leftJoin(
            stockItemLocationPrices,
            and(
              eq(stockItemLocationPrices.stockItemId, stockItems.id),
              eq(stockItemLocationPrices.locationId, locationId as number)
            )
          )
          .leftJoin(
            inventory,
            and(
              eq(inventory.stockItemId, stockItems.id),
              eq(inventory.locationId, locationId as number)
            )
          )
          .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
          .orderBy(stockItems.name);
      }

      // For privileged users, fetch Dubai cost (from latest PO line rate) and offloading cost
      if (isPrivileged && rows.length > 0) {
        const [dubaiCostRes, offloadCostRes] = await Promise.all([
          db.execute(sql`
            SELECT DISTINCT ON (pli.stock_item_id)
              pli.stock_item_id AS "stockItemId",
              pli.rate AS "costDubai"
            FROM po_line_items pli
            JOIN purchase_orders po ON pli.po_id = po.id
            JOIN containers c ON po.container_id = c.id
            WHERE po.company_id = ${companyId}
            ORDER BY pli.stock_item_id, pli.id DESC
          `),
          db.execute(sql`
            SELECT DISTINCT ON (pli.stock_item_id)
              pli.stock_item_id AS "stockItemId",
              co.additional_cost_per_bale AS "offloadingCost"
            FROM container_offloads co
            JOIN containers c ON co.container_id = c.id
            JOIN purchase_orders po ON po.container_id = c.id
            JOIN po_line_items pli ON pli.po_id = po.id
            WHERE c.company_id = ${companyId}
            ORDER BY pli.stock_item_id, co.offloaded_at DESC
          `),
        ]);

        const dubaiMap = new Map<number, string>();
        for (const r of dubaiCostRes.rows as any[]) {
          dubaiMap.set(Number(r.stockItemId), String(r.costDubai ?? "0"));
        }
        const offloadMap = new Map<number, string>();
        for (const r of offloadCostRes.rows as any[]) {
          offloadMap.set(Number(r.stockItemId), String(r.offloadingCost ?? "0"));
        }

        rows = rows.map((row: any) => ({
          ...row,
          costPrice: dubaiMap.get(row.stockItemId) ?? null,
          offloadingCost: offloadMap.get(row.stockItemId) ?? null,
        }));
      }

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Price list for All Locations view: one price column per configured master location
  app.get("/api/pos/price-list-by-masters", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes((req.user as any)?.role || "");

      // Get all configured master location IDs
      const groupRows = await db
        .select({ masterLocationId: locationPriceGroups.masterLocationId })
        .from(locationPriceGroups)
        .where(eq(locationPriceGroups.companyId, companyId));

      const masterIds = [...new Set(groupRows.map((r) => r.masterLocationId))];

      // Get master location names
      const masterLocations = masterIds.length > 0
        ? await db
            .select({ id: locations.id, name: locations.name })
            .from(locations)
            .where(and(eq(locations.companyId, companyId), inArray(locations.id, masterIds)))
        : [];

      // Get all active stock items
      const items = await db
        .select({
          stockItemId: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`,
          baseSellingPrice: stockItems.sellingPrice,
        })
        .from(stockItems)
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
        .orderBy(stockItems.name);

      // Get location-specific prices for all master locations in one query
      const masterPriceRows = masterIds.length > 0
        ? await db
            .select({
              stockItemId: stockItemLocationPrices.stockItemId,
              locationId: stockItemLocationPrices.locationId,
              sellingPrice: stockItemLocationPrices.sellingPrice,
            })
            .from(stockItemLocationPrices)
            .where(
              and(
                inArray(stockItemLocationPrices.locationId, masterIds),
                inArray(
                  stockItemLocationPrices.stockItemId,
                  items.map((i) => i.stockItemId)
                )
              )
            )
        : [];

      // Build a nested map: stockItemId -> locationId -> price
      const priceMap = new Map<number, Map<number, string>>();
      for (const p of masterPriceRows) {
        if (!priceMap.has(p.stockItemId)) priceMap.set(p.stockItemId, new Map());
        priceMap.get(p.stockItemId)!.set(p.locationId, p.sellingPrice);
      }

      // Attach cost data for privileged users
      let dubaiMap = new Map<number, string>();
      let offloadMap = new Map<number, string>();
      if (isPrivileged && items.length > 0) {
        const [dubaiCostRes, offloadCostRes] = await Promise.all([
          db.execute(sql`
            SELECT DISTINCT ON (pli.stock_item_id)
              pli.stock_item_id AS "stockItemId",
              pli.rate AS "costDubai"
            FROM po_line_items pli
            JOIN purchase_orders po ON pli.po_id = po.id
            JOIN containers c ON po.container_id = c.id
            WHERE po.company_id = ${companyId}
            ORDER BY pli.stock_item_id, pli.id DESC
          `),
          db.execute(sql`
            SELECT DISTINCT ON (pli.stock_item_id)
              pli.stock_item_id AS "stockItemId",
              co.additional_cost_per_bale AS "offloadingCost"
            FROM container_offloads co
            JOIN containers c ON co.container_id = c.id
            JOIN purchase_orders po ON po.container_id = c.id
            JOIN po_line_items pli ON pli.po_id = po.id
            WHERE c.company_id = ${companyId}
            ORDER BY pli.stock_item_id, co.offloaded_at DESC
          `),
        ]);
        for (const r of dubaiCostRes.rows as any[]) dubaiMap.set(Number(r.stockItemId), String(r.costDubai ?? "0"));
        for (const r of offloadCostRes.rows as any[]) offloadMap.set(Number(r.stockItemId), String(r.offloadingCost ?? "0"));
      }

      const result = items.map((item) => {
        const itemPrices: Record<number, string> = {};
        for (const mloc of masterLocations) {
          const custom = priceMap.get(item.stockItemId)?.get(mloc.id);
          itemPrices[mloc.id] = custom ?? item.baseSellingPrice ?? "0";
        }
        const base: any = { ...item, masterPrices: itemPrices };
        if (isPrivileged) {
          base.costPrice = dubaiMap.get(item.stockItemId) ?? null;
          base.offloadingCost = offloadMap.get(item.stockItemId) ?? null;
        }
        return base;
      });

      res.json({ masters: masterLocations, items: result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import stock items
  app.post(
    "/api/stock-items/import",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { items } = req.body;
        if (!Array.isArray(items)) {
          return res.status(400).json({ message: "Items must be an array" });
        }

        // Fetch all valid stock groups for this company for validation
        const validStockGroups = await storage.getAllStockGroups(
          req.session.currentCompanyId,
        );
        const validStockGroupIds = new Set(validStockGroups.map((sg) => sg.id));

        const results = {
          created: [] as any[],
          skipped: [] as any[],
          errors: [] as any[],
        };

        for (const item of items) {
          try {
            // Ensure companyId matches session
            const itemWithCompany = {
              ...item,
              companyId: req.session.currentCompanyId,
            };

            // Validate stock group - require valid stockGroupId, reject if missing or invalid
            if (
              !itemWithCompany.stockGroupId ||
              !validStockGroupIds.has(itemWithCompany.stockGroupId)
            ) {
              results.errors.push({
                code: item.code,
                name: item.name,
                error: "Missing or invalid stock group. All stock items must have a valid stock group.",
              });
              continue;
            }

            const parsed = insertStockItemSchema.parse(itemWithCompany);

            // Check for duplicate code
            const existing = await storage.getStockItemByCode(
              parsed.code,
              req.session.currentCompanyId,
            );
            if (existing) {
              results.skipped.push({
                code: parsed.code,
                name: parsed.name,
                reason: "Code already exists",
              });
              continue;
            }

            const created = await storage.createStockItem(parsed);
            results.created.push(created);
          } catch (error: any) {
            results.errors.push({
              code: item.code,
              name: item.name,
              error: error.message,
            });
          }
        }

        res.json({
          message: `Import completed: ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors`,
          results,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // ── Bulk barcode import (assigns alias codes to existing stock items) ──────────
  app.post("/api/stock-items/import-barcodes", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body as { rows: { itemCode: string; barcode: string }[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "rows must be a non-empty array" });

      // Build a lookup map: primary code (lower) → stockItem
      const allItems = await db
        .select({ id: stockItems.id, code: stockItems.code })
        .from(stockItems)
        .where(eq(stockItems.companyId, companyId));
      const itemByCode = new Map(allItems.map((i) => [i.code.trim().toLowerCase(), i.id]));

      // Also build alias → stockItemId map so we can detect barcodes already assigned
      const allAliases = await db
        .select({ aliasCode: stockItemCodeAliases.aliasCode, stockItemId: stockItemCodeAliases.stockItemId })
        .from(stockItemCodeAliases)
        .where(eq(stockItemCodeAliases.companyId, companyId));
      const aliasByCode = new Map(allAliases.map((a) => [a.aliasCode.trim().toLowerCase(), a.stockItemId]));

      let imported = 0;
      let skipped = 0;
      const notFoundCodes: string[] = [];

      for (const row of rows) {
        const itemCodeKey = (row.itemCode || "").trim().toLowerCase();
        const barcodeKey  = (row.barcode  || "").trim().toLowerCase();
        const barcodeRaw  = (row.barcode  || "").trim();

        if (!itemCodeKey || !barcodeKey) { skipped++; continue; }

        const stockItemId = itemByCode.get(itemCodeKey);
        if (!stockItemId) {
          notFoundCodes.push(row.itemCode);
          continue;
        }

        // Skip if barcode is already the primary code of this item
        if (itemCodeKey === barcodeKey) { skipped++; continue; }

        // Skip if already an alias (anywhere in the company)
        if (aliasByCode.has(barcodeKey)) { skipped++; continue; }

        try {
          await db.insert(stockItemCodeAliases).values({
            companyId,
            stockItemId,
            aliasCode: barcodeRaw,
          }).onConflictDoNothing();
          aliasByCode.set(barcodeKey, stockItemId); // prevent re-insert in same batch
          imported++;
        } catch {
          skipped++;
        }
      }

      res.json({ imported, skipped, notFound: notFoundCodes.length, notFoundCodes });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk category (stock group) update for existing stock items ───────────────
  app.post("/api/stock-items/update-categories", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body as { rows: { itemCode: string; categoryName: string }[] };
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ message: "rows must be a non-empty array" });

      // Build lookups
      const allItems = await db
        .select({ id: stockItems.id, code: stockItems.code })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)));
      const itemByCode = new Map(allItems.map((i: any) => [i.code.toLowerCase().trim(), i.id]));

      const allCats = await db
        .select({ id: stockCategories.id, name: stockCategories.name })
        .from(stockCategories)
        .where(eq(stockCategories.companyId, companyId));
      const catByName = new Map(allCats.map((c: any) => [c.name.toLowerCase().trim(), c.id]));

      let updated = 0;
      let notFound = 0;
      let categoryNotFound = 0;
      const notFoundCodes: string[] = [];
      const categoryNotFoundNames: string[] = [];

      for (const row of rows) {
        const code = String(row.itemCode || "").trim();
        const catName = String(row.categoryName || "").trim();
        if (!code || !catName) continue;

        const itemId = itemByCode.get(code.toLowerCase());
        if (!itemId) { notFound++; notFoundCodes.push(code); continue; }

        const catId = catByName.get(catName.toLowerCase());
        if (!catId) { categoryNotFound++; if (!categoryNotFoundNames.includes(catName)) categoryNotFoundNames.push(catName); continue; }

        await db.update(stockItems).set({ categoryId: catId }).where(eq(stockItems.id, itemId));
        updated++;
      }

      res.json({ updated, notFound, categoryNotFound, notFoundCodes, categoryNotFoundNames });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Grade/Category Template Import ────────────────────────────────────────────

  app.post("/api/stock-items/import-grade-category-template", requireAuth, requireNonPOS, upload.single("file"), async (req: any, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb = await readExcel(req.file.buffer);
      const sheetName = wb.SheetNames[0];
      if (!sheetName) return res.status(400).json({ message: "Excel file has no sheets" });

      const rows = sheetToJson<Record<string, any>>(wb.Sheets[sheetName]);

      // Pre-fetch all stock items for this company (by code)
      const allItems = await db
        .select({ id: stockItems.id, code: stockItems.code })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)));
      const itemByCode = new Map<string, number>(allItems.map((i) => [i.code.toLowerCase().trim(), i.id]));

      // Pre-fetch all grades and categories for this company (including inactive)
      const allGrades = await db.select().from(stockGrades).where(eq(stockGrades.companyId, companyId));
      const allCategories = await db.select().from(stockCategories).where(eq(stockCategories.companyId, companyId));
      const gradeByName = new Map<string, typeof allGrades[0]>(allGrades.map((g) => [g.name.toLowerCase().trim(), g]));
      const categoryByName = new Map<string, typeof allCategories[0]>(allCategories.map((c) => [c.name.toLowerCase().trim(), c]));

      const summary = {
        rowsProcessed: 0,
        itemsUpdated: 0,
        gradesCreated: 0,
        categoriesCreated: 0,
        skipped: 0,
        errors: [] as { row: number; reason: string }[],
      };

      for (let i = 0; i < rows.length; i++) {
        const rowNum = i + 2; // 1-indexed, row 1 is header
        const row = rows[i];
        summary.rowsProcessed++;

        // Read Item Code (required)
        const rawCode = String(row["Item Code"] ?? "").trim();
        if (!rawCode) {
          summary.skipped++;
          summary.errors.push({ row: rowNum, reason: "Item Code is empty — row skipped" });
          continue;
        }

        const stockItemId = itemByCode.get(rawCode.toLowerCase());
        if (!stockItemId) {
          summary.skipped++;
          summary.errors.push({ row: rowNum, reason: `Item Code "${rawCode}" not found in this company` });
          continue;
        }

        // Resolve grade
        const rawGrade = String(row["Current Grade"] ?? "").trim();
        let gradeId: number | null = null;
        if (rawGrade) {
          const gradeKey = rawGrade.toLowerCase();
          let grade = gradeByName.get(gradeKey);
          if (!grade) {
            // Create new grade
            const [created] = await db
              .insert(stockGrades)
              .values({ name: rawGrade, companyId, active: true })
              .returning();
            gradeByName.set(gradeKey, created);
            summary.gradesCreated++;
            grade = created;
          } else if (!grade.active) {
            // Reactivate inactive grade
            await db.update(stockGrades).set({ active: true }).where(eq(stockGrades.id, grade.id));
            grade.active = true;
          }
          gradeId = grade.id;
        }

        // Resolve category
        const rawCategory = String(row["Current Category"] ?? "").trim();
        let categoryId: number | null = null;
        if (rawCategory) {
          const catKey = rawCategory.toLowerCase();
          let category = categoryByName.get(catKey);
          if (!category) {
            const [created] = await db
              .insert(stockCategories)
              .values({ name: rawCategory, companyId, active: true })
              .returning();
            categoryByName.set(catKey, created);
            summary.categoriesCreated++;
            category = created;
          } else if (!category.active) {
            await db.update(stockCategories).set({ active: true }).where(eq(stockCategories.id, category.id));
            category.active = true;
          }
          categoryId = category.id;
        }

        // Update stock item — only gradeId and categoryId
        await db
          .update(stockItems)
          .set({ gradeId, categoryId })
          .where(eq(stockItems.id, stockItemId));

        summary.itemsUpdated++;
      }

      // Audit log
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "create",
          tableName: "stock_items",
          recordIdentifier: "bulk-grade-category-import",
          changes: {
            itemsUpdated: { old: null, new: summary.itemsUpdated },
            gradesCreated: { old: null, new: summary.gradesCreated },
            categoriesCreated: { old: null, new: summary.categoriesCreated },
            skipped: { old: null, new: summary.skipped },
          },
        });
      } catch { /* non-fatal */ }

      res.json({
        message: `Import complete: ${summary.itemsUpdated} updated, ${summary.gradesCreated} grades created, ${summary.categoriesCreated} categories created, ${summary.skipped} skipped`,
        ...summary,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock item
  app.patch(
    "/api/stock-items/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const stockItemId = parseInt(req.params.id);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Invalid stock item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Verify stock item exists and belongs to current company
        const existingItem = await storage.getStockItemById(stockItemId);
        if (!existingItem) {
          return res.status(404).json({ message: "Stock item not found" });
        }

        if (existingItem.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        // Trim and validate required fields
        const updates: any = {};

        if (req.body.code !== undefined) {
          const trimmedCode = String(req.body.code).trim();
          if (trimmedCode === "") {
            return res.status(400).json({ message: "Code is required" });
          }
          updates.code = trimmedCode;
        }

        if (req.body.name !== undefined) {
          const trimmedName = String(req.body.name).trim();
          if (trimmedName === "") {
            return res.status(400).json({ message: "Name is required" });
          }
          updates.name = trimmedName;
        }

        if (req.body.uom !== undefined) {
          const trimmedUom = String(req.body.uom).trim();
          if (trimmedUom === "") {
            return res
              .status(400)
              .json({ message: "Unit of measure is required" });
          }
          updates.uom = trimmedUom;
        }

        if (req.body.barcode !== undefined) {
          updates.barcode = req.body.barcode
            ? String(req.body.barcode).trim()
            : null;
        }

        if (req.body.stockGroupId !== undefined) {
          if (req.body.stockGroupId === null) {
            return res.status(400).json({ message: "Stock Group is required. Please select a valid stock group." });
          }
          updates.stockGroupId = req.body.stockGroupId;
        }

        if (req.body.sellingPrice !== undefined) {
          updates.sellingPrice = req.body.sellingPrice ? String(req.body.sellingPrice) : "0";
        }

        if (req.body.active !== undefined) {
          updates.active = req.body.active;
        }

        if (req.body.gradeId !== undefined) {
          updates.gradeId = req.body.gradeId === null ? null : parseInt(req.body.gradeId);
        }

        if (req.body.categoryId !== undefined) {
          updates.categoryId = req.body.categoryId === null ? null : parseInt(req.body.categoryId);
        }

        // If updating code, check for duplicates
        if (updates.code && updates.code !== existingItem.code) {
          const duplicate = await storage.getStockItemByCode(
            updates.code,
            req.session.currentCompanyId,
          );
          if (duplicate) {
            return res
              .status(400)
              .json({ message: "Stock item code already exists" });
          }
        }

        const updated = await storage.updateStockItem(stockItemId, updates);
        try {
          const _stockChanges: Record<string, { old: any; new: any }> = {};
          for (const _f of ["name", "code", "uom", "barcode", "sellingPrice", "active"] as const) {
            if (String((existingItem as any)[_f] ?? "") !== String((updated as any)[_f] ?? "")) {
              _stockChanges[_f] = { old: (existingItem as any)[_f], new: (updated as any)[_f] };
            }
          }
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "stock_items",
            recordId: updated.id,
            recordIdentifier: updated.name,
            changes: _stockChanges,
          });
        } catch { /* non-fatal */ }
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete stock item
  app.delete(
    "/api/stock-items/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const stockItemId = parseInt(req.params.id);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Invalid stock item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Verify stock item exists and belongs to current company
        const existingItem = await storage.getStockItemById(stockItemId);
        if (!existingItem) {
          return res.status(404).json({ message: "Stock item not found" });
        }

        if (existingItem.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        // Check if item has ANY inventory record (regardless of quantity)
        const anyInventory = await db.execute(
          sql`SELECT COUNT(*) as count FROM inventory WHERE stock_item_id = ${stockItemId}`
        );
        const inventoryCount = parseInt((anyInventory.rows as any[])[0]?.count || "0");

        if (inventoryCount > 0) {
          return res.status(400).json({
            message: `Cannot delete stock item "${existingItem.code}": it has inventory records in ${inventoryCount} location(s). Please transfer or adjust all inventory to zero and clear the records first.`,
          });
        }

        await storage.deleteStockItem(stockItemId);
        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "delete",
            tableName: "stock_items",
            recordId: existingItem.id,
            recordIdentifier: existingItem.name,
            changes: {
              name: { old: existingItem.name },
              code: { old: existingItem.code },
              uom: { old: existingItem.uom },
              sellingPrice: { old: existingItem.sellingPrice || "0" },
            },
          });
        } catch { /* non-fatal */ }
        res.json({ message: "Stock item deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get stock item transactions (transfers and adjustments)
  app.get(
    "/api/stock-items/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const stockItemId = parseInt(req.params.id);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Invalid stock item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Verify stock item exists and belongs to current company
        const existingItem = await storage.getStockItemById(stockItemId);
        if (!existingItem) {
          return res.status(404).json({ message: "Stock item not found" });
        }

        if (existingItem.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        const { startDate, endDate } = req.query;
        const transactions = await storage.getStockItemTransactions(
          stockItemId,
          req.session.currentCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get stock item details (last purchase, last sale, inventory locations)
  app.get("/api/stock-items/:id/details", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Verify stock item exists and belongs to current company
      const existingItem = await storage.getStockItemById(stockItemId);
      if (!existingItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (existingItem.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Stock item belongs to a different company",
          });
      }

      const fromDate = typeof req.query.from === "string" ? req.query.from : undefined;
      const toDate = typeof req.query.to === "string" ? req.query.to : undefined;

      // Get all purchases, all sales, and current locations
      const [purchases, sales, inventoryLocations] = await Promise.all([
        storage.getAllPurchasesForItem(
          stockItemId,
          req.session.currentCompanyId,
          fromDate,
          toDate,
        ),
        storage.getAllSalesForItem(stockItemId, req.session.currentCompanyId, fromDate, toDate),
        storage.getInventoryLocationsByItem(
          stockItemId,
          req.session.currentCompanyId,
        ),
      ]);

      res.json({
        purchases,
        sales,
        inventoryLocations,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher history for a stock item (all transactions - sales, transfers, consumption, production)
  app.get("/api/stock-items/:id/voucher-history", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Verify stock item exists and belongs to current company
      const existingItem = await storage.getStockItemById(stockItemId);
      if (!existingItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (existingItem.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Stock item belongs to a different company",
          });
      }

      // Get all voucher transactions for this item
      const voucherHistory = await storage.getVoucherHistoryForItem(stockItemId, req.session.currentCompanyId);

      res.json(voucherHistory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Item Code Aliases
  // Get all code aliases for a stock item
  app.get(
    "/api/stock-items/:id/code-aliases",
    requireAuth,
    async (req, res) => {
      try {
        const stockItemId = parseInt(req.params.id);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Invalid stock item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Verify stock item exists and belongs to current company
        const existingItem = await storage.getStockItemById(stockItemId);
        if (!existingItem) {
          return res.status(404).json({ message: "Stock item not found" });
        }

        if (existingItem.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        const aliases = await storage.getStockItemCodeAliases(stockItemId);
        res.json(aliases);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create a new code alias for a stock item
  app.post(
    "/api/stock-items/:id/code-aliases",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const stockItemId = parseInt(req.params.id);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Invalid stock item ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Verify stock item exists and belongs to current company
        const existingItem = await storage.getStockItemById(stockItemId);
        if (!existingItem) {
          return res.status(404).json({ message: "Stock item not found" });
        }

        if (existingItem.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        // Validate the alias (include companyId for security)
        const validatedAlias = insertStockItemCodeAliasSchema.parse({
          ...req.body,
          stockItemId,
          companyId: req.session.currentCompanyId,
        });

        const alias = await storage.createStockItemCodeAlias(validatedAlias);
        res.status(201).json(alias);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res
            .status(400)
            .json({ message: "Validation error", errors: error.errors });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete a code alias
  app.delete(
    "/api/stock-item-code-aliases/:id",
    requireAuth,
    async (req, res) => {
      try {
        const aliasId = parseInt(req.params.id);
        if (isNaN(aliasId)) {
          return res.status(400).json({ message: "Invalid alias ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Get the alias first to verify ownership
        const alias = await storage.getStockItemCodeAliasById(aliasId);
        if (!alias) {
          return res.status(404).json({ message: "Code alias not found" });
        }

        // Verify the alias belongs to the current company
        if (alias.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Code alias belongs to a different company",
            });
        }

        await storage.deleteStockItemCodeAlias(aliasId);
        res.json({ message: "Code alias deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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

        // Step 4 — soft-delete the duplicate
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
