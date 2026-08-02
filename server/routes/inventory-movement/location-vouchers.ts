/**
 * inventoryMovementRoutes: LocationVoucher endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { eq, and, desc, isNull, gte, lt } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, checkPOSLocation } from "../../auth";
import { vouchers } from "@shared/schema";

export function registerLocationVoucherRoutes(app: Express) {
  // Get today vouchers for a location (for POS dashboard)
  app.get("/api/locations/:locationId/vouchers/today", requireAuth, checkPOSLocation, async (req, res) => {
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
