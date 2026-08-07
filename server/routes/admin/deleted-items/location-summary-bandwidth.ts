import type { Request, Response } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { inventory, stockGroups, stockItems } from "@shared/schema";
import { db } from "../../../db";
import { getClientDate } from "../../../lib/dateUtils";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";

type LocationCell = {
  quantity: number;
  rate: number;
  value: number;
};

type CompactGroup = {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationCell>;
  items: [];
};

type CompactItem = {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationCell>;
};

function parseLocationIds(value: unknown): number[] {
  if (typeof value !== "string") return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => Number.parseInt(part, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ).sort((left, right) => left - right);
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addCell(target: LocationCell, quantity: number, value: number): void {
  target.quantity += quantity;
  target.value += value;
}

function finalizeCell(cell: LocationCell): LocationCell {
  return {
    quantity: cell.quantity,
    value: cell.value,
    rate: cell.quantity > 0 ? cell.value / cell.quantity : 0,
  };
}

function emptyCell(): LocationCell {
  return { quantity: 0, rate: 0, value: 0 };
}

/**
 * Handles the bandwidth-optimized profiles for GET /api/location-summary.
 *
 * `profile=summary` returns only stock-group totals plus grand totals. It never
 * serializes item rows, which keeps the initial Location Summary page payload
 * small even for companies with thousands of stock items.
 *
 * `profile=group&groupId=<id>` returns only the non-zero item rows for one
 * expanded stock group. Location cells are sparse; the client already treats a
 * missing location cell as zero. `groupId=0` represents ungrouped items.
 *
 * Returning false leaves the legacy full-payload contract untouched for any
 * older caller that has not migrated yet.
 */
export async function handleLocationSummaryBandwidthProfile(req: Request, res: Response): Promise<boolean> {
  const profile = typeof req.query.profile === "string" ? req.query.profile : "";
  if (profile !== "summary" && profile !== "group") return false;

  try {
    const companyId = req.session.currentCompanyId;
    const locationIds = parseLocationIds(req.query.locationIds);

    if (!companyId) {
      res.status(400).json({ message: "Company ID is required" });
      return true;
    }

    if (locationIds.length === 0) {
      if (profile === "group") res.json({ groupId: null, items: [] });
      else res.json({ stockGroups: [], grandTotals: {}, asOfDate: getClientDate(req) });
      return true;
    }

    if (profile === "summary") {
      const rows = await db
        .select({
          locationId: inventory.locationId,
          groupId: sql<number>`COALESCE(${stockGroups.id}, 0)::int`,
          groupCode: sql<string>`COALESCE(${stockGroups.code}, 'UNGROUPED')`,
          groupName: sql<string>`COALESCE(${stockGroups.name}, 'Ungrouped Items')`,
          quantity: sql<string>`SUM(COALESCE(${inventory.quantity}, '0')::numeric)::text`,
          value: sql<string>`SUM(COALESCE(${inventory.quantity}, '0')::numeric * COALESCE(${inventory.averageRate}, '0')::numeric)::text`,
        })
        .from(inventory)
        .innerJoin(
          stockItems,
          and(
            eq(stockItems.id, inventory.stockItemId),
            eq(stockItems.companyId, companyId),
            eq(stockItems.active, true),
            isNull(stockItems.deletedAt)
          )
        )
        .leftJoin(
          stockGroups,
          and(eq(stockGroups.id, stockItems.stockGroupId), eq(stockGroups.companyId, companyId), eq(stockGroups.active, true))
        )
        .where(
          and(
            eq(inventory.companyId, companyId),
            inArray(inventory.locationId, locationIds),
            sql`${inventory.quantity}::numeric <> 0`,
            sql`(${stockItems.stockGroupId} IS NULL OR ${stockGroups.id} IS NOT NULL)`
          )
        )
        .groupBy(inventory.locationId, stockGroups.id, stockGroups.code, stockGroups.name)
        .orderBy(sql`CASE WHEN ${stockGroups.id} IS NULL THEN 1 ELSE 0 END`, stockGroups.name);

      const groups = new Map<number, CompactGroup>();
      const grandTotals: Record<number, LocationCell> = {};

      for (const row of rows) {
        const locationId = Number(row.locationId);
        const quantity = numeric(row.quantity);
        const value = numeric(row.value);
        const groupId = Number(row.groupId);

        let group = groups.get(groupId);
        if (!group) {
          group = {
            id: groupId,
            code: row.groupCode || (groupId === 0 ? "UNGROUPED" : ""),
            name: row.groupName || (groupId === 0 ? "Ungrouped Items" : ""),
            locationData: {},
            items: [],
          };
          groups.set(groupId, group);
        }

        group.locationData[locationId] = finalizeCell({ quantity, value, rate: 0 });

        const grand = grandTotals[locationId] ?? emptyCell();
        addCell(grand, quantity, value);
        grandTotals[locationId] = grand;
      }

      for (const locationId of Object.keys(grandTotals)) {
        const id = Number(locationId);
        grandTotals[id] = finalizeCell(grandTotals[id]);
      }

      res.setHeader("X-ERP-Payload-Profile", "location-summary-groups");
      res.json({
        stockGroups: Array.from(groups.values()),
        grandTotals,
        asOfDate: getClientDate(req),
      });
      return true;
    }

    const groupId = Number.parseInt(String(req.query.groupId ?? ""), 10);
    if (!Number.isInteger(groupId) || groupId < 0) {
      res.status(400).json({ message: "groupId is required for profile=group" });
      return true;
    }

    if (groupId !== 0) {
      const existingGroup = await db
        .select({ id: stockGroups.id })
        .from(stockGroups)
        .where(and(eq(stockGroups.id, groupId), eq(stockGroups.companyId, companyId), eq(stockGroups.active, true)))
        .limit(1);
      if (existingGroup.length === 0) {
        res.status(404).json({ message: "Stock group not found" });
        return true;
      }
    }

    const itemRows = await db
      .select({
        id: stockItems.id,
        code: stockItems.code,
        name: stockItems.name,
        uom: stockItems.uom,
        locationId: inventory.locationId,
        quantity: inventory.quantity,
        averageRate: inventory.averageRate,
      })
      .from(inventory)
      .innerJoin(
        stockItems,
        and(
          eq(stockItems.id, inventory.stockItemId),
          eq(stockItems.companyId, companyId),
          eq(stockItems.active, true),
          isNull(stockItems.deletedAt)
        )
      )
      .where(
        and(
          eq(inventory.companyId, companyId),
          inArray(inventory.locationId, locationIds),
          groupId === 0 ? isNull(stockItems.stockGroupId) : eq(stockItems.stockGroupId, groupId),
          sql`${inventory.quantity}::numeric <> 0`
        )
      )
      .orderBy(stockItems.name, stockItems.id);

    const items = new Map<number, CompactItem>();
    for (const row of itemRows) {
      const itemId = Number(row.id);
      let item = items.get(itemId);
      if (!item) {
        item = {
          id: itemId,
          code: row.code,
          name: row.name,
          uom: row.uom,
          locationData: {},
        };
        items.set(itemId, item);
      }

      const quantity = numeric(row.quantity);
      const rate = numeric(row.averageRate);
      item.locationData[Number(row.locationId)] = {
        quantity,
        rate,
        value: quantity * rate,
      };
    }

    res.setHeader("X-ERP-Payload-Profile", "location-summary-group-items");
    res.json({ groupId, items: Array.from(items.values()) });
    return true;
  } catch (error: unknown) {
    logger.error("Location summary bandwidth profile error:", { error });
    res.status(500).json({ message: getErrorMessage(error) });
    return true;
  }
}
