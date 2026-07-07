import { type Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { InsertDraftPosSale, userLocations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function registerPosDraftRoutes(app: Express): void {
  // Get last sold prices for all stock items in the company
  // Get last sold prices for all stock items (based on location's company)
  app.get("/api/pos/last-sold-prices", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.query.locationId as string);
      if (!locationId || isNaN(locationId)) {
        return res.status(400).json({ message: "Location ID is required" });
      }
      // Get the location and verify it belongs to the current company
      const location = await storage.getLocationById(locationId);
      if (!location || location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Invalid location" });
      }
      // POS users may only query prices for their assigned location(s)
      if (req.user?.role === "POS") {
        const assignedLocs = await db
          .select({ locationId: userLocations.locationId })
          .from(userLocations)
          .where(and(eq(userLocations.userId, req.user.id), eq(userLocations.companyId, req.session.currentCompanyId!)));
        const allowedIds = assignedLocs.map((l) => l.locationId);
        if (!allowedIds.includes(locationId)) {
          return res.status(403).json({ message: "You can only access data for your assigned locations" });
        }
      }
      const prices = await storage.getLastSoldPrices(req.session.currentCompanyId!);
      res.json(prices);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Draft POS Sales Routes
  // Get all drafts for current user
  app.get("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const drafts = await storage.getAllDraftPosSales(userId, locationId);
      res.json(drafts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific draft by ID
  app.get("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const draft = await storage.getDraftPosSaleById(id);

      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Verify the draft belongs to the current user
      if (draft.userId !== req.user?.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new draft
  app.post("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const draftData: InsertDraftPosSale = {
        userId,
        locationId,
        paymentAccountType: paymentAccountType || null,
        paymentAccountId: paymentAccountId || null,
        isCreditSale: isCreditSale || false,
        notes: notes || null,
      };

      const draft = await storage.createDraftPosSale(draftData, items);
      res.status(201).json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update an existing draft
  app.patch("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      const updateData: Partial<InsertDraftPosSale> = {};
      if (locationId !== undefined) updateData.locationId = locationId;
      if (paymentAccountType !== undefined) updateData.paymentAccountType = paymentAccountType;
      if (paymentAccountId !== undefined) updateData.paymentAccountId = paymentAccountId;
      if (isCreditSale !== undefined) updateData.isCreditSale = isCreditSale;
      if (notes !== undefined) updateData.notes = notes;

      const draft = await storage.updateDraftPosSale(id, updateData, items);
      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a draft
  app.delete("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteDraftPosSale(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
