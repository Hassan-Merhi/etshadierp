import type { Express } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import {
  inventory,
  locations,
  locationPriceGroups,
  stockGroups,
  stockItemLocationPrices,
  stockItems,
  userLocations,
} from "@shared/schema";
import { getErrorMessage } from "../../lib/httpHandlers";

type EffectivePriceListRow = {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupName: string;
  baseSellingPrice: string | null;
  hasCustomPrice: boolean;
  sellingPrice: string | null;
  quantity: string;
  costPrice?: string | null;
  offloadingCost?: string | null;
};

/**
 * Price-list route with price-group inheritance.
 *
 * A follower location reads its selling prices from its configured master
 * location while inventory quantity continues to come from the follower
 * location itself. This keeps POS/location stock independent while sharing
 * the master's price list.
 *
 * Registered before the legacy price-list route so Express resolves this
 * implementation first.
 */
export function registerEffectivePriceListRoutes(app: Express) {
  app.get("/api/pos/price-list", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const locationIdParam = req.query.locationId as string;
      const showAll = locationIdParam === "all";
      const locationId = showAll ? null : Number.parseInt(locationIdParam, 10);

      if (!showAll && Number.isNaN(locationId as number)) {
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
            .where(and(eq(userLocations.userId, req.user!.id), eq(userLocations.companyId, companyId)));
          const assignedIds = assigned.map((row) => row.locationId);
          if (!assignedIds.includes(locationId as number)) {
            return res.status(403).json({ message: "Forbidden: location not assigned to this user" });
          }
        } else {
          const [location] = await db
            .select({ id: locations.id })
            .from(locations)
            .where(and(eq(locations.id, locationId as number), eq(locations.companyId, companyId)));
          if (!location) {
            return res.status(403).json({ message: "Forbidden: location not found" });
          }
        }
      }

      let rows: EffectivePriceListRow[];

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
        // Followers inherit the master's price. Masters and ungrouped locations
        // continue to use their own location-specific price.
        const [priceGroup] = await db
          .select({ masterLocationId: locationPriceGroups.masterLocationId })
          .from(locationPriceGroups)
          .where(
            and(
              eq(locationPriceGroups.companyId, companyId),
              eq(locationPriceGroups.followerLocationId, locationId as number)
            )
          )
          .limit(1);

        const effectivePriceLocationId = priceGroup?.masterLocationId ?? (locationId as number);

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
              eq(stockItemLocationPrices.locationId, effectivePriceLocationId)
            )
          )
          .leftJoin(
            inventory,
            and(eq(inventory.stockItemId, stockItems.id), eq(inventory.locationId, locationId as number))
          )
          .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
          .orderBy(stockItems.name);
      }

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
        for (const row of dubaiCostRes.rows) {
          dubaiMap.set(Number(row.stockItemId), String(row.costDubai ?? "0"));
        }
        const offloadMap = new Map<number, string>();
        for (const row of offloadCostRes.rows) {
          offloadMap.set(Number(row.stockItemId), String(row.offloadingCost ?? "0"));
        }

        rows = rows.map((row) => ({
          ...row,
          costPrice: dubaiMap.get(row.stockItemId) ?? null,
          offloadingCost: offloadMap.get(row.stockItemId) ?? null,
        }));
      }

      res.json(rows);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
