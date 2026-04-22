import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives, stockItemCodeAliases,
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

  // Stock Items
  app.get("/api/stock-items", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const items = await storage.getAllStockItems(companyId);
      res.json(items);
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

      let updated = 0;
      let notFound = 0;

      for (const priceEntry of prices) {
        const { barcode, sellingPrice, locationId } = priceEntry;
        if (!barcode || !sellingPrice) continue;

        const companyId = req.session.currentCompanyId;
        const item = await storage.getStockItemByBarcode(barcode, companyId);
        if (item) {
          if (locationId) {
            // Update location-specific price
            await storage.upsertLocationPrice(item.id, locationId, sellingPrice);
          } else {
            // Update global price
            await storage.updateStockItem(item.id, { sellingPrice });
          }
          updated++;
        } else {
          notFound++;
        }
      }

      const message = `Updated ${updated} price(s)${notFound > 0 ? `. ${notFound} barcode(s) not found.` : "."}`;
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

  // Export last 4 sales per stock item (for Excel export)
  app.get("/api/stock-items/last-sales-export", requireAuth, async (req, res) => {
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

      const isPOS = req.user?.role?.startsWith("POS");
      const isPrivileged = ["Admin", "Owner", "Manager"].includes(req.user?.role || "");

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

      const isPrivileged = ["Admin", "Owner", "Manager"].includes((req.user as any)?.role || "");

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

      // Get all purchases, all sales, and current locations
      const [purchases, sales, inventoryLocations] = await Promise.all([
        storage.getAllPurchasesForItem(
          stockItemId,
          req.session.currentCompanyId,
        ),
        storage.getAllSalesForItem(stockItemId, req.session.currentCompanyId),
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

  // Bank Accounts
}
