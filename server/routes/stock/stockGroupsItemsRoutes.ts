import type { Express } from "express";
import { db, pool } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { requireActionAccess } from "../../lib/permissionMiddleware";
import { upload, logAudit, getCurrentExchangeRate } from "../_helpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemMergeLogs,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerSales,
  containerCharges,
  containerTrackingImportRowSchema,
  updateContainerTrackingSchema,
  bankAccounts,
  fixedAssets,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertContainerSchema,
  offloadRequestSchema,
  purchaseOrders,
  poLineItems,
  insertContainerSaleSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  FEATURE_KEYS,
  locationPriceGroups,
  stockGrades,
  stockCategories,
  insertStockGradeSchema,
  insertStockCategorySchema,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory } from "../../inventoryHelper";

export function registerStockGroupsItemsRoutes(app: Express) {
  app.get("/api/stock-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllStockGroups(req.session.currentCompanyId);
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-groups", requireAuth, requireNonPOS, async (req, res) => {
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
      const existing = await storage.getStockGroupByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({
          message: "Stock group code already exists in this company",
        });
      }

      const group = await storage.createStockGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ── Stock Grades ────────────────────────────────────────────────────────────

  app.get("/api/stock-grades", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const includeInactive = req.query.includeInactive === "true";
      const conds = [eq(stockGrades.companyId, companyId)];
      if (!includeInactive) conds.push(eq(stockGrades.active, true));
      const rows = await db
        .select()
        .from(stockGrades)
        .where(and(...conds))
        .orderBy(asc(stockGrades.name));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-grades", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertStockGradeSchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(stockGrades).values(parsed).returning();
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "create",
          tableName: "stock_grades",
          recordId: created.id,
          recordIdentifier: created.name,
          changes: { name: { old: null, new: created.name } },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(created);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/stock-grades/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db
        .select()
        .from(stockGrades)
        .where(and(eq(stockGrades.id, id), eq(stockGrades.companyId, companyId)));
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
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "update",
          tableName: "stock_grades",
          recordId: id,
          recordIdentifier: updated.name,
          changes: Object.fromEntries(
            Object.entries(updates).map(([k, v]) => [k, { old: (existing as any)[k], new: v }])
          ),
        });
      } catch {
        /* non-fatal */
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/stock-grades/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db
        .select()
        .from(stockGrades)
        .where(and(eq(stockGrades.id, id), eq(stockGrades.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock grade not found" });
      await db.update(stockGrades).set({ active: false }).where(eq(stockGrades.id, id));
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "update",
          tableName: "stock_grades",
          recordId: id,
          recordIdentifier: existing.name,
          changes: { active: { old: true, new: false } },
        });
      } catch {
        /* non-fatal */
      }
      res.json({ message: "Stock grade deactivated" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Stock Categories ─────────────────────────────────────────────────────────

  app.get("/api/stock-categories", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const includeInactive = req.query.includeInactive === "true";
      const conds = [eq(stockCategories.companyId, companyId)];
      if (!includeInactive) conds.push(eq(stockCategories.active, true));
      const rows = await db
        .select()
        .from(stockCategories)
        .where(and(...conds))
        .orderBy(asc(stockCategories.name));
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-categories", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertStockCategorySchema.parse({ ...req.body, companyId });
      const [created] = await db.insert(stockCategories).values(parsed).returning();
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "create",
          tableName: "stock_categories",
          recordId: created.id,
          recordIdentifier: created.name,
          changes: { name: { old: null, new: created.name } },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(created);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/stock-categories/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db
        .select()
        .from(stockCategories)
        .where(and(eq(stockCategories.id, id), eq(stockCategories.companyId, companyId)));
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
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "update",
          tableName: "stock_categories",
          recordId: id,
          recordIdentifier: updated.name,
          changes: Object.fromEntries(
            Object.entries(updates).map(([k, v]) => [k, { old: (existing as any)[k], new: v }])
          ),
        });
      } catch {
        /* non-fatal */
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/stock-categories/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const [existing] = await db
        .select()
        .from(stockCategories)
        .where(and(eq(stockCategories.id, id), eq(stockCategories.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Stock category not found" });
      await db.update(stockCategories).set({ active: false }).where(eq(stockCategories.id, id));
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId,
          action: "update",
          tableName: "stock_categories",
          recordId: id,
          recordIdentifier: existing.name,
          changes: { active: { old: true, new: false } },
        });
      } catch {
        /* non-fatal */
      }
      res.json({ message: "Stock category deactivated" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
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

      const conditions: any[] = [eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)];
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

      return res.json({
        data,
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      });
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
      const existing = await storage.getStockItemByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({ message: "Stock item code already exists in this company" });
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
      } catch {
        /* non-fatal */
      }
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
      const validIds = validItems.map((item) => item.id);

      if (validIds.length === 0) {
        return res.status(404).json({ message: "No valid stock items found to delete" });
      }

      // Block deletion if any item has inventory records (regardless of quantity)
      const inventoryCheck = await db.execute(
        sql`SELECT stock_item_id FROM inventory WHERE stock_item_id = ANY(ARRAY[${sql.join(
          validIds.map((id) => sql`${id}`),
          sql`, `
        )}]) GROUP BY stock_item_id`
      );
      if ((inventoryCheck.rows as any[]).length > 0) {
        const blockedIds = new Set((inventoryCheck.rows as any[]).map((r: any) => parseInt(r.stock_item_id)));
        const blockedCodes = validItems.filter((item) => blockedIds.has(item.id)).map((item) => item.code);
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
      } catch {
        /* non-fatal */
      }

      const skippedCount = ids.length - validIds.length;
      const message =
        skippedCount > 0
          ? `Successfully deleted ${validIds.length} stock item(s). ${skippedCount} item(s) were skipped (not found or belong to another company).`
          : `Successfully deleted ${validIds.length} stock item(s)`;

      res.json({
        message,
        deleted: validIds.length,
        skipped: skippedCount,
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
      const validIds = validItems.map((item) => item.id);
      if (validIds.length === 0) {
        return res.status(404).json({ message: "No valid stock items found" });
      }

      await db
        .update(stockItems)
        .set({ categoryId: isNaN(categoryId as number) ? null : categoryId })
        .where(and(inArray(stockItems.id, validIds), eq(stockItems.companyId, companyId)));

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
      const itemsById = new Map(allItems.map((i) => [i.id, i]));
      const itemsByCode = new Map<string, (typeof allItems)[0]>();
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
            await tx
              .insert(stockItemLocationPrices)
              .values({
                stockItemId: u.stockItemId,
                locationId: u.locationId,
                sellingPrice: u.sellingPrice,
              })
              .onConflictDoUpdate({
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
      } catch {
        /* non-fatal */
      }
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
      const itemsByCode = new Map<string, (typeof allItems)[0]>();
      const itemsById = new Map(allItems.map((i) => [i.id, i]));
      for (const item of allItems) {
        if (item.code && typeof item.code === "string") {
          itemsByCode.set((item.code || "").toLowerCase(), item);
        }
      }

      // Pre-fetch all code aliases and build alias lookup map (skip empty/null aliases)
      const allAliases = await storage.getAllCompanyCodeAliases(req.session.currentCompanyId);
      const itemsByAlias = new Map<string, (typeof allItems)[0]>();
      for (const alias of allAliases) {
        if (alias.aliasCode && typeof alias.aliasCode === "string") {
          const item = itemsById.get(alias.stockItemId);
          if (item) {
            itemsByAlias.set((alias.aliasCode || "").toLowerCase(), item);
          }
        }
      }

      for (const entry of openingBalances) {
        const { barcode, openingQty, openingRate, openingValue } = entry;
        if (!barcode || typeof barcode !== "string") continue;

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
          or(eq(stockItems.uom, "bale"), eq(stockItems.uom, "Bale"), eq(stockItems.uom, "BALE"))
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
      const q = ((req.query.q as string) || "").trim();
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
          AND pli.item_name ILIKE ${"%" + q + "%"}
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
        UOM: r.uom,
        Active: r.active ? "Yes" : "No",
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
      res.setHeader("Content-Disposition", 'attachment; filename="grade-category-template.xlsx"');
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
        return res.status(403).json({
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

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const prices = await storage.getStockItemLocationPrices(stockItemId, companyId);
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
            and(eq(locationPriceGroups.companyId, companyId), eq(locationPriceGroups.masterLocationId, locationId))
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
}
