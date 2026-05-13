import { getClientDate } from "../lib/dateUtils";
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
  agentAccounts, auditLog, users, FEATURE_KEYS,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";

export function registerLocationRoutes(app: Express) {
  app.get("/api/locations", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : req.session.currentCompanyId;

      if (!companyId) {
        return res
          .status(400)
          .json({ message: "No company selected or specified" });
      }

      const locations = await storage.getAllLocations(companyId);
      res.json(locations);
    } catch (error: any) {
      console.error("[/api/locations] Error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/locations", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const parsed = insertLocationSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
      });

      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: remove non-alphanumeric, take first 6 letters, uppercase
        const sanitized = parsed.name.trim().replace(/[^a-zA-Z0-9]/g, '');
        let baseCode = sanitized.substring(0, 6).toUpperCase();
        
        // Fallback if baseCode is empty after sanitization
        if (!baseCode || baseCode.length === 0) {
          baseCode = "LOC";
        }
        
        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getLocationByCode(code, req.session.currentCompanyId)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getLocationByCode(
          parsed.code,
          req.session.currentCompanyId,
        );
        if (existing) {
          return res
            .status(400)
            .json({ message: "Location code already exists" });
        }
      }

      // Provide defaults for optional fields
      const locationData = {
        ...parsed,
        city: parsed.city || '',
        state: parsed.state || '',
        country: parsed.country || '',
      };

      const location = await storage.createLocation(locationData);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "locations",
          recordId: location.id,
          recordIdentifier: location.name,
          changes: {
            name: { new: location.name },
            code: { new: location.code },
            city: { new: location.city || null },
            state: { new: location.state || null },
            country: { new: location.country || null },
          },
        });
      } catch { /* non-fatal */ }
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get single location by ID
  app.get(
    "/api/locations/:locationId",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        res.json(location);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Rename (update) location
  app.patch("/api/locations/:locationId", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const location = await storage.getLocationById(locationId);
      if (!location) return res.status(404).json({ message: "Location not found" });
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { name, whatsappGroupChatId, transferWaGroupChatId } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name is required" });
      }

      const updatePayload: Record<string, any> = { name: name.trim() };
      if (whatsappGroupChatId !== undefined) {
        updatePayload.whatsappGroupChatId = whatsappGroupChatId || null;
      }
      if (transferWaGroupChatId !== undefined) {
        updatePayload.transferWaGroupChatId = transferWaGroupChatId || null;
      }

      const [updated] = await db
        .update(locations)
        .set(updatePayload)
        .where(eq(locations.id, locationId))
        .returning();

      try {
        const _locChanges: Record<string, { old: any; new: any }> = {};
        if (location.name !== updated.name) _locChanges.name = { old: location.name, new: updated.name };
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "locations",
          recordId: updated.id,
          recordIdentifier: updated.name,
          changes: _locChanges,
        });
      } catch { /* non-fatal */ }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete location
  app.delete("/api/locations/:locationId", requireAuth, async (req, res) => {
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
        return res
          .status(403)
          .json({
            message: "Access denied: Location belongs to a different company",
          });
      }

      await storage.deleteLocation(locationId);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "locations",
          recordId: location.id,
          recordIdentifier: location.name,
          changes: {
            name: { old: location.name },
            code: { old: location.code },
          },
        });
      } catch { /* non-fatal */ }
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get(
    "/api/locations/:locationId/inventory-rates",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        const location = await storage.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ message: "Location not found" });
        }
        if (location.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
        }

        const stockItemIdsParam = req.query.stockItemIds as string;
        if (!stockItemIdsParam) {
          return res.status(400).json({ message: "stockItemIds query parameter is required" });
        }
        const stockItemIds = stockItemIdsParam.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
        if (stockItemIds.length === 0) {
          return res.json([]);
        }

        const rows = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            totalValue: inventory.totalValue,
            stockItemName: stockItems.name,
          })
          .from(inventory)
          .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
          .where(
            and(
              eq(inventory.locationId, locationId),
              inArray(inventory.stockItemId, stockItemIds)
            )
          );

        res.json(rows);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Location Inventory - Get inventory for a specific location
  app.get(
    "/api/locations/:locationId/inventory",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        // Validate location exists
        const location = await storage.getLocationById(locationId);
        if (!location) {
          return res.status(404).json({ message: "Location not found" });
        }

        // Verify location belongs to current company
        if (location.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        // Check for asOfDate query parameter for historical inventory
const rawAsOfDate = req.query.asOfDate as string | undefined;

// Normalize asOfDate to YYYY-MM-DD (supports DD/MM/YYYY too)
let asOfDate: string | undefined = undefined;

if (rawAsOfDate) {
  const s = rawAsOfDate.trim();

  // DD/MM/YYYY -> YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("/");
    asOfDate = `${yyyy}-${mm}-${dd}`;
  }
  // YYYY-MM-DD (already OK)
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    asOfDate = s;
  }
  // Try parse other formats (ISO, etc.)
  else {
    const d = new Date(s);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ message: "Invalid asOfDate format. Use YYYY-MM-DD" });
    }
    asOfDate = d.toISOString().slice(0, 10);
  }
}

let inventory;
if (asOfDate) {
  const companyId = req.session.currentCompanyId!;
  inventory = await calculateHistoricalLocationInventory(locationId, companyId, asOfDate);
} else {
  inventory = await storage.getLocationInventory(locationId);
}

        // Filter sensitive data for POS users (they should only see quantity)
        const isPOS = req.user?.role === "POS";
        if (isPOS) {
          const filteredInventory = inventory.map((item: any) => ({
            ...item,
            averageRate: null,
            totalValue: null,
          }));
          res.json(filteredInventory);
        } else {
          res.json(inventory);
        }
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Location Inventory Export - Export full inventory details to Excel
  app.get(
    "/api/locations/:locationId/inventory/export",
    requireAuth,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

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

        const inventory = await storage.getLocationInventory(locationId);

        // Filter out zero-quantity items
        const filteredInventory = inventory.filter(
          (item: any) => parseFloat(item.quantity || "0") !== 0
        );

        // Build Excel workbook data
        const workbookData = filteredInventory.map((item: any) => ({
          "Item Code": item.stockItemCode || "",
          "Item Name": item.stockItemName || "",
          "Group Code": item.stockGroupCode || "",
          "Group Name": item.stockGroupName || "Unassigned",
          "UOM": item.stockItemUom || "",
          "Quantity": parseFloat(item.quantity || "0"),
          "Cost/Unit": parseFloat(item.averageRate || "0"),
          "Total Value": parseFloat(item.totalValue || "0"),
        }));

        // Use XLSX to create workbook (via ExcelJS if available, else JSON export)
        const XLSX = await import("xlsx");
        const worksheet = XLSX.utils.json_to_sheet(workbookData);

        // Set column widths
        const colWidths = [
          { wch: 15 },
          { wch: 30 },
          { wch: 15 },
          { wch: 25 },
          { wch: 10 },
          { wch: 15 },
          { wch: 15 },
          { wch: 15 },
        ];
        worksheet["!cols"] = colWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          workbook,
          worksheet,
          `${location.name} Inventory`
        );

        // Generate Excel file as buffer
        const excelBuffer = XLSX.write(workbook, {
          bookType: "xlsx",
          type: "buffer",
        });

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${location.name}_inventory_${getClientDate(req)}.xlsx"`
        );
        res.send(excelBuffer);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Company Inventory - Get all inventory across all locations for current company
}
