import type { Express } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, checkPOSLocation } from "../../auth";
import { logAudit } from "../_helpers";
import { locations, insertLocationSchema } from "@shared/schema";
import { eq } from "drizzle-orm";

export function registerLocationCrudRoutes(app: Express) {
  app.get("/api/locations", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.session.currentCompanyId;

      if (!companyId) {
        return res.status(400).json({ message: "No company selected or specified" });
      }

      const locations = await storage.getAllLocations(companyId);
      res.json(locations);
    } catch (error: any) {
      logger.error("[/api/locations] Error:", { error: error });
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
        const sanitized = parsed.name.trim().replace(/[^a-zA-Z0-9]/g, "");
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
        const existing = await storage.getLocationByCode(parsed.code, req.session.currentCompanyId);
        if (existing) {
          return res.status(400).json({ message: "Location code already exists" });
        }
      }

      // Provide defaults for optional fields
      const locationData = {
        ...parsed,
        code: parsed.code!,
        city: parsed.city || "",
        state: parsed.state || "",
        country: parsed.country || "",
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
            name: { old: null, new: location.name },
            code: { old: null, new: location.code },
            city: { old: null, new: location.city || null },
            state: { old: null, new: location.state || null },
            country: { old: null, new: location.country || null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get single location by ID
  app.get("/api/locations/:locationId", requireAuth, checkPOSLocation, async (req, res) => {
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
        return res.status(403).json({
          message: "Access denied: Location belongs to a different company",
        });
      }

      res.json(location);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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

      const { name, whatsappGroupChatId, transferWaGroupChatId, supplierPartnerPayableDeductionPerQty } = req.body;
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
      if (supplierPartnerPayableDeductionPerQty !== undefined) {
        const deductionVal = parseFloat(supplierPartnerPayableDeductionPerQty);
        if (isNaN(deductionVal) || deductionVal < 0) {
          return res.status(400).json({ message: "supplierPartnerPayableDeductionPerQty must be >= 0" });
        }
        updatePayload.supplierPartnerPayableDeductionPerQty = deductionVal.toFixed(4);
      }

      const [updated] = await db.update(locations).set(updatePayload).where(eq(locations.id, locationId)).returning();

      try {
        const _locChanges: Record<string, { old?: any; new?: any }> = {};
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
      } catch {
        /* non-fatal */
      }
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
        return res.status(403).json({
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
            name: { old: location.name, new: null },
            code: { old: location.code, new: null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
