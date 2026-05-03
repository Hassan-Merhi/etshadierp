import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import {
  upload, logAudit, getCurrentExchangeRate, syncEmployeeBalancesFromEntries,
} from "./_helpers";
import {
  locations, inventory, stockItems, stockGroups, ledgerAccounts, employees,
  employeeGroups, employeeGroupMembers, 
  suppliers, customers, customerBalances, customerOrders,
  stockTransferVouchers, stockTransferItems, stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, vouchers, voucherEntries, salesItems,
  insertLocationSchema, insertLedgerAccountSchema, updateLedgerAccountSchema,
  insertEmployeeSchema, insertEmployeeGroupSchema, insertSupplierSchema, insertCustomerSchema,
  userLocations, userCompanyRoles, companies, bankAccounts, fixedAssets,
  agentAccounts, auditLog, users, FEATURE_KEYS, stockItemCodeAliases,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";

export function registerInventoryRoutes(app: Express) {
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const inventory = await storage.getCompanyInventory(
        req.session.currentCompanyId,
      );
      res.json(inventory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Quick stock adjustment - manually add or subtract quantity at a location
  app.post("/api/inventory/quick-adjust", requireAuth, async (req, res) => {
    try {
      const { stockItemId, locationId, quantity, type } = req.body;
      
      if (!stockItemId || !locationId || !quantity || !type) {
        return res.status(400).json({ message: "Missing required fields: stockItemId, locationId, quantity, type" });
      }
      
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;
      const qty = parseFloat(quantity);
      
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ message: "Quantity must be a positive number" });
      }
      
      if (type !== "add" && type !== "subtract") {
        return res.status(400).json({ message: "Type must be 'add' or 'subtract'" });
      }

      // Verify location belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      if (location.companyId !== companyId) {
        return res.status(403).json({ message: "Location belongs to a different company" });
      }

      // Verify stock item exists and belongs to current company
      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }
      if (stockItem.companyId !== companyId) {
        return res.status(403).json({ message: "Stock item belongs to a different company" });
      }

      // Get or create inventory record - wrapped in transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Pre-check: get existing inventory to validate quantities
        const [existingInv] = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.stockItemId, stockItemId),
              eq(inventory.locationId, locationId)
            )
          )
          .limit(1);

        const currentQty = existingInv ? parseFloat(existingInv.quantity || "0") : 0;
        const adjustedQty = type === "add" ? qty : -qty;
        const newQty = currentQty + adjustedQty;

        // Validate: cannot subtract more than available
        if (newQty < 0) {
          throw new Error(`Cannot subtract ${qty} units. Only ${currentQty} units available at this location.`);
        }

        // Use adjustInventory helper to handle both insert and update
        const adjustResult = await adjustInventory(
          tx,
          locationId,
          stockItemId,
          adjustedQty,
          companyId
        );

        return {
          currentQty: adjustResult.previousQuantity,
          newQty: adjustResult.newQuantity,
          adjustedQty,
        };
      });
      res.json({
        message: `Successfully ${type === "add" ? "added" : "subtracted"} ${qty} units. New quantity: ${result.newQty}`,
        previousQuantity: result.currentQty,
        newQuantity: result.newQty,
        adjustment: result.adjustedQty,
      });
    } catch (error: any) {
      console.error("Quick adjust error:", error);
      const isBusinessError = error.message?.includes("Cannot subtract") || error.message?.includes("non-existent inventory");
      res.status(isBusinessError ? 400 : 500).json({ message: error.message });
    }
  });

  app.get("/api/inventory/reconcile", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const issues: any[] = [];

      const allInventory = await db
        .select()
        .from(inventory)
        .where(eq(inventory.companyId, companyId));

      for (const inv of allInventory) {
        const qty = parseFloat(inv.quantity || "0");
        const rate = parseFloat(inv.averageRate || "0");
        const totalValue = parseFloat(inv.totalValue || "0");
        const expectedValue = qty * rate;

        if (qty < 0) {
          issues.push({
            type: "negative_inventory",
            severity: "info",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            message: `Negative inventory: ${qty} units`,
          });
        }

        if (qty > 0 && Math.abs(totalValue - expectedValue) > 0.02) {
          issues.push({
            type: "value_mismatch",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            averageRate: rate,
            totalValue,
            expectedValue: parseFloat(expectedValue.toFixed(2)),
            difference: parseFloat((totalValue - expectedValue).toFixed(2)),
            message: `Value mismatch: stored=${totalValue}, expected=${expectedValue.toFixed(2)}`,
          });
        }

        if (rate < 0) {
          issues.push({
            type: "negative_rate",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            averageRate: rate,
            message: `Negative average rate: ${rate}`,
          });
        }

        if (qty === 0 && totalValue !== 0) {
          issues.push({
            type: "zero_qty_nonzero_value",
            severity: "warning",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            totalValue,
            message: `Zero quantity but non-zero total value: ${totalValue}`,
          });
        }
      }

      const locationIds = Array.from(new Set(allInventory.map(i => i.locationId)));
      const stockItemIds = Array.from(new Set(allInventory.map(i => i.stockItemId)));

      const duplicateCheck = new Map<string, number>();
      for (const inv of allInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        duplicateCheck.set(key, (duplicateCheck.get(key) || 0) + 1);
      }
      for (const [key, count] of Array.from(duplicateCheck.entries())) {
        if (count > 1) {
          const [locId, itemId] = key.split("-").map(Number);
          issues.push({
            type: "duplicate_inventory",
            severity: "critical",
            stockItemId: itemId,
            locationId: locId,
            duplicateCount: count,
            message: `${count} duplicate inventory records found`,
          });
        }
      }

      const summary = {
        totalRecords: allInventory.length,
        totalLocations: locationIds.length,
        totalStockItems: stockItemIds.length,
        issueCount: issues.length,
        criticalIssues: issues.filter(i => i.severity === "critical").length,
        errorIssues: issues.filter(i => i.severity === "error").length,
        warningIssues: issues.filter(i => i.severity === "warning").length,
        infoIssues: issues.filter(i => i.severity === "info").length,
        totalInventoryValue: allInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue || "0"), 0).toFixed(2),
      };

      res.json({ summary, issues });
    } catch (error: any) {
      console.error("Inventory reconciliation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get today vouchers for a location (for POS dashboard)
  app.get("/api/locations/:locationId/vouchers/today", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Verify location belongs to current company
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get today date range
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      // Get vouchers created today at this location
      const todayVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.locationId, locationId),
            gte(vouchers.createdAt, startOfDay),
            lt(vouchers.createdAt, endOfDay),
            isNull(vouchers.deletedAt)
          )
        )
        .orderBy(desc(vouchers.createdAt));

      res.json(todayVouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update cost prices by barcode for a location
  app.post(
    "/api/locations/:locationId/import-cost-prices",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const location = await storage.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (location.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Location belongs to a different company",
          });
        }

        const { updates } = req.body;
        if (!Array.isArray(updates)) {
          return res.status(400).json({ message: "Updates must be an array" });
        }

        const result = await storage.updateCostPricesByBarcode(locationId, req.session.currentCompanyId, updates);
        res.json(result);
      } catch (error: any) {
        console.error("Error updating cost prices:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Bulk import inventory for a location
  app.post(
    "/api/locations/:locationId/import-inventory",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Validate location exists and belongs to current company
        const location = await storage.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (location.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        const { items } = req.body;
        if (!Array.isArray(items)) {
          return res.status(400).json({ message: "Items must be an array" });
        }

        // Get all stock items and stock groups for code matching
        const allStockItems = await storage.getAllStockItems(
          req.session.currentCompanyId,
        );
        const allStockGroups = await storage.getAllStockGroups(
          req.session.currentCompanyId,
        );

        const results = {
          created: [] as any[],
          updated: [] as any[],
          skipped: [] as any[],
          errors: [] as any[],
        };

        // Per-session barcode registry: once a barcode resolves to an item it
        // ALWAYS resolves to that same item for the rest of this import run.
        // This prevents the same barcode from ever mapping to more than one product.
        const barcodeItemMap = new Map<string, any>();

        for (const item of items) {
          try {
            const barcodeKey = item.Item_barcode.trim().toLowerCase();

            // 1. Check session-local registry first (fastest, no DB hit)
            let stockItem: any = barcodeItemMap.get(barcodeKey) ?? null;

            // 2. If not seen this session, look up in DB (code field OR alias)
            if (!stockItem) {
              stockItem = await storage.getStockItemByCodeOrAlias(
                item.Item_barcode,
                req.session.currentCompanyId,
              ) ?? null;
              if (stockItem) barcodeItemMap.set(barcodeKey, stockItem);
            }

            // If stock item doesn't exist, create it
            if (!stockItem) {
              // ── Name-match check: if an existing item's NAME equals the
              //    uploaded barcode string, register the barcode as an alias
              //    and reuse that item instead of creating a duplicate. ─────
              const nameMatch = allStockItems.find(
                (si) => si.name.trim().toLowerCase() === barcodeKey,
              );

              if (nameMatch) {
                // Guard: only register alias if the barcode isn't already the
                // primary code of a *different* item (belt-and-suspenders check)
                const alreadyACode = allStockItems.find(
                  (si) => si.id !== nameMatch.id && si.code.trim().toLowerCase() === barcodeKey,
                );
                if (!alreadyACode) {
                  await db.insert(stockItemCodeAliases).values({
                    stockItemId: nameMatch.id,
                    aliasCode: item.Item_barcode.trim(),
                    companyId: req.session.currentCompanyId!,
                  }).onConflictDoNothing();
                }
                stockItem = alreadyACode ?? nameMatch;
                barcodeItemMap.set(barcodeKey, stockItem);
              } else {
              // Auto-detect stock group from item code prefix (first 2-3 uppercase letters)
              let stockGroupId: number | null = null;

              // Normalize and try to extract prefix from Item_barcode
              const normalizedCode = item.Item_barcode.trim().toUpperCase();

              // Try 3-letter prefix first, then 2-letter (e.g., "UN259" -> "UN", "GCC123" -> "GCC")
              const prefixes = [];
              if (normalizedCode.length >= 3)
                prefixes.push(normalizedCode.substring(0, 3));
              if (normalizedCode.length >= 2)
                prefixes.push(normalizedCode.substring(0, 2));

              for (const prefix of prefixes) {
                const stockGroup = allStockGroups.find(
                  (sg) => sg.code.toUpperCase() === prefix,
                );
                if (stockGroup) {
                  stockGroupId = stockGroup.id;
                  break; // Found a match, stop searching
                }
              }

              // Fall back to stockGroupCode column if provided and prefix didn't match
              if (
                !stockGroupId &&
                item.stockGroupCode
              ) {
                const stockGroup = allStockGroups.find(
                  (sg) =>
                    (sg.code || "").toLowerCase() === (item.stockGroupCode || "").toLowerCase(),
                );
                if (stockGroup) {
                  stockGroupId = stockGroup.id;
                }
              }

              // Require valid stock group - reject if none found
              if (!stockGroupId) {
                results.errors.push({
                  code: item.Item_barcode,
                  reason: `No matching stock group found for code prefix. Please create stock item "${item.Item_barcode}" manually with a valid stock group first.`,
                });
                continue;
              }

              // Create the stock item
              const newStockItem = await storage.createStockItem({
                companyId: req.session.currentCompanyId,
                code: item.Item_barcode,
                name: item.Item_barcode, // Use Item_barcode as name if not provided
                uom: "PCS", // Default unit
                stockGroupId: stockGroupId,
                active: true,
              });

              stockItem = newStockItem;
              allStockItems.push(newStockItem); // Add to cache for subsequent rows
              barcodeItemMap.set(barcodeKey, newStockItem); // lock barcode in session registry
              } // end else (no name match → create new)
            }

            const quantity = parseFloat(item.quantity || "0");
            const rate = parseFloat(item.rate || "0");
            const value = parseFloat(
              item.value || (quantity * rate).toString(),
            );

            // Check if inventory already exists for this item at this location
            const existingInventory =
              await storage.getLocationInventory(locationId);
            const existing = existingInventory.find(
              (inv) => inv.stockItemId === stockItem.id,
            );

            if (existing) {
              // Update existing inventory - add to existing quantities
              const newQuantity = parseFloat(existing.quantity) + quantity;
              const newTotalValue = parseFloat(existing.totalValue) + value;
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await storage.updateInventory(
                locationId,
                stockItem.id,
                newQuantity.toString(),
                newAverageRate.toString(),
                newTotalValue.toString(),
              );

              results.updated.push({
                code: item.Item_barcode,
                itemName: stockItem.name,
                addedQuantity: quantity,
                newQuantity: newQuantity,
              });
            } else {
              // Create new inventory record
              await storage.updateInventory(
                locationId,
                stockItem.id,
                quantity.toString(),
                rate.toString(),
                value.toString(),
              );

              results.created.push({
                code: item.Item_barcode,
                itemName: stockItem.name,
                quantity: quantity,
              });
            }
          } catch (error: any) {
            results.errors.push({
              code: item.code,
              error: error.message,
            });
          }
        }

        res.json({
          message: `Import completed: ${results.created.length} created, ${results.updated.length} updated, ${results.skipped.length} skipped, ${results.errors.length} errors`,
          results,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Ledger Accounts
}
