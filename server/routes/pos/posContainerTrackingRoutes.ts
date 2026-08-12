import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { locations, poLineItems, stockItems } from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { fetchActiveContainers, type RawContainerRow } from "../../lib/gitHelpers";
import { storage } from "../../storage";

type PosTrackingContext = {
  companyId: number;
  location: {
    id: number;
    name: string;
    code: string;
  };
};

function normalizeLocationLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function containerMatchesAssignedLocation(
  container: Pick<RawContainerRow, "shopName">,
  context: PosTrackingContext
): boolean {
  const shop = normalizeLocationLabel(container.shopName);
  if (!shop) return false;

  const assignedLabels = [context.location.name, context.location.code].map(normalizeLocationLabel).filter(Boolean);

  return assignedLabels.some((label) => label === shop);
}

async function resolvePosTrackingContext(req: Request, res: Response): Promise<PosTrackingContext | null> {
  const companyId = req.session.currentCompanyId;
  if (!companyId) {
    res.status(400).json({ message: "No company selected" });
    return null;
  }

  const rawLocationId = req.user?.assignedLocationId ?? req.session.currentLocationId;
  const assignedLocationId = Number(rawLocationId);
  if (!Number.isInteger(assignedLocationId) || assignedLocationId <= 0) {
    res.status(403).json({ message: "No location is assigned to this POS user" });
    return null;
  }

  const [location] = await db
    .select({ id: locations.id, name: locations.name, code: locations.code })
    .from(locations)
    .where(
      and(
        eq(locations.id, assignedLocationId),
        eq(locations.companyId, companyId),
        eq(locations.active, true),
        isNull(locations.deletedAt)
      )
    )
    .limit(1);

  if (!location) {
    res.status(403).json({ message: "The assigned POS location is unavailable" });
    return null;
  }

  return { companyId, location };
}

export function registerPosContainerTrackingRoutes(app: Express): void {
  app.get("/api/pos/containers-otw", requireAuth, requireRole("POS"), async (req, res) => {
    try {
      const context = await resolvePosTrackingContext(req, res);
      if (!context) return;

      const rows = await fetchActiveContainers([context.companyId]);
      const containers = rows
        .filter((row) => containerMatchesAssignedLocation(row, context))
        .map((row) => ({
          id: row.id,
          containerNumber: row.containerNumber,
          eta: row.eta,
          numberPlate: row.numberPlate,
          trackingLocation: row.trackingLocation,
          agent: row.agent,
          transporter: row.transporter,
        }));

      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      return res.json({
        assignedLocation: context.location,
        total: containers.length,
        containers,
      });
    } catch (error) {
      return res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to load containers",
      });
    }
  });

  app.get("/api/pos/containers-otw/:id", requireAuth, requireRole("POS"), async (req, res) => {
    try {
      const context = await resolvePosTrackingContext(req, res);
      if (!context) return;

      const containerId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(containerId) || containerId <= 0) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      const [container] = await fetchActiveContainers([context.companyId], { containerId });
      if (!container || !containerMatchesAssignedLocation(container, context)) {
        return res.status(404).json({ message: "Container not found" });
      }

      const purchaseOrders = await storage.getPurchaseOrdersByContainer(containerId);
      const poIds = purchaseOrders.map((po) => po.id);
      const lineItems =
        poIds.length === 0
          ? []
          : await db
              .select({
                id: poLineItems.id,
                itemName: poLineItems.itemName,
                quantity: poLineItems.quantity,
                stockItemName: stockItems.name,
              })
              .from(poLineItems)
              .leftJoin(
                stockItems,
                and(eq(stockItems.id, poLineItems.stockItemId), eq(stockItems.companyId, context.companyId))
              )
              .where(inArray(poLineItems.poId, poIds))
              .orderBy(poLineItems.id);

      const items = lineItems.map((item) => ({
        itemName: item.stockItemName || item.itemName || "Item",
        quantity: String(item.quantity ?? "0"),
      }));
      const totalQty = items.reduce((sum, item) => {
        const quantity = Number.parseFloat(item.quantity);
        return sum + (Number.isFinite(quantity) ? quantity : 0);
      }, 0);

      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=30");
      return res.json({
        container: {
          id: container.id,
          containerNumber: container.containerNumber,
        },
        items,
        totalQty,
      });
    } catch (error) {
      return res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to load container",
      });
    }
  });
}
