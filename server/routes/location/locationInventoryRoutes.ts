import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { buildSafeFilename, contentDisposition } from "../../lib/contentDisposition";
import { requireAuth, checkPOSLocation } from "../../auth";
import { calculateHistoricalLocationInventory } from "../_helpers";
import { getClientDate } from "../../lib/dateUtils";
import { generateStockPdf } from "../../helpers/generateStockPdf";
import { inventory, stockItems, companies, stockGroups } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export function registerLocationInventoryRoutes(app: Express) {
  app.get("/api/locations/:locationId/inventory-rates", requireAuth, checkPOSLocation, async (req, res) => {
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
      const stockItemIds = stockItemIdsParam
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0);
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
        .where(and(eq(inventory.locationId, locationId), inArray(inventory.stockItemId, stockItemIds)));

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory - Get inventory for a specific location
  app.get("/api/locations/:locationId/inventory", requireAuth, checkPOSLocation, async (req, res) => {
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
        return res.status(403).json({
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

      const includeZero = req.query.includeZero === "true";

      // Use the location's own companyId as source of truth (not session, which
      // may lag or differ in multi-company contexts). Access check above already
      // confirmed location.companyId === session.currentCompanyId.
      const inventoryCompanyId = location.companyId;

      let inventory;
      if (asOfDate) {
        inventory = await calculateHistoricalLocationInventory(locationId, inventoryCompanyId, asOfDate);
      } else {
        inventory = await storage.getLocationInventory(inventoryCompanyId, locationId, includeZero);
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
      console.error(`[inventory] ERROR locationId=${req.params.locationId}:`, error?.message ?? error);
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory Export - Export full inventory details to Excel
  app.get("/api/locations/:locationId/inventory/export", requireAuth, checkPOSLocation, async (req, res) => {
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
        return res.status(403).json({
          message: "Access denied: Location belongs to a different company",
        });
      }

      const inventory = await storage.getLocationInventory(req.session.currentCompanyId!, locationId);

      // Filter out zero-quantity items
      const filteredInventory = inventory.filter((item: any) => parseFloat(item.quantity || "0") !== 0);

      // Build Excel workbook data
      const workbookData = filteredInventory.map((item: any) => ({
        "Item Code": item.stockItemCode || "",
        "Item Name": item.stockItemName || "",
        "Group Code": item.stockGroupCode || "",
        "Group Name": item.stockGroupName || "Unassigned",
        UOM: item.stockItemUom || "",
        Quantity: parseFloat(item.quantity || "0"),
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
      XLSX.utils.book_append_sheet(workbook, worksheet, `${location.name} Inventory`);

      // Generate Excel file as buffer
      const excelBuffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "buffer",
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader(
        "Content-Disposition",
        contentDisposition(buildSafeFilename([location.name, "inventory", getClientDate(req)], "xlsx"))
      );
      res.send(excelBuffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory PDF — Godown Summary (with or without cost)
  app.get("/api/locations/:locationId/inventory/pdf", requireAuth, checkPOSLocation, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const location = await storage.getLocationById(locationId);
      if (!location) return res.status(404).json({ message: "Location not found" });
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const companyId = req.session.currentCompanyId!;
      const [co] = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      const companyName = co?.name || "Company";

      const includeCost = req.query.includeCost !== "0" && req.query.includeCost !== "false";

      const { buffer } = await generateStockPdf(companyId, companyName, locationId, location.name, includeCost);

      const safeDate = getClientDate(req).replace(/-/g, "");
      const safeName = location.name.replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
      const suffix = includeCost ? "with_cost" : "no_cost";
      const fileName = `${safeName}_Godown_${safeDate}_${suffix}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory PDF — single Stock Group only
  app.get(
    "/api/locations/:locationId/inventory/pdf/stock-group/:groupId",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
      try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

        // ":groupId" of "none" exports the "Unassigned" pseudo-group (items with no stock group).
        const groupIdParam = req.params.groupId;
        const stockGroupId = groupIdParam === "none" ? null : parseInt(groupIdParam);
        if (stockGroupId !== null && isNaN(stockGroupId)) {
          return res.status(400).json({ message: "Invalid stock group ID" });
        }

        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Access denied" });
        }

        const companyId = req.session.currentCompanyId!;
        const [co] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId))
          .limit(1);
        const companyName = co?.name || "Company";

        const includeCost = req.query.includeCost !== "0" && req.query.includeCost !== "false";

        const { buffer, rowCount } = await generateStockPdf(
          companyId,
          companyName,
          locationId,
          location.name,
          includeCost,
          stockGroupId
        );
        if (rowCount === 0) {
          return res.status(404).json({ message: "No stock items found for this group at this location" });
        }

        let groupNameForFile = "Unassigned";
        if (stockGroupId !== null) {
          const [grp] = await db
            .select({ name: stockGroups.name })
            .from(stockGroups)
            .where(eq(stockGroups.id, stockGroupId))
            .limit(1);
          groupNameForFile = (grp?.name || String(stockGroupId)).replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
        }
        const safeDate = getClientDate(req).replace(/-/g, "");
        const safeName = location.name.replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
        const suffix = includeCost ? "with_cost" : "no_cost";
        const fileName = `${safeName}_${groupNameForFile}_${safeDate}_${suffix}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.send(buffer);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );
}
