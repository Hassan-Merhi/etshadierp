import { and, eq, inArray, isNull } from "drizzle-orm";

import { inventory, locations } from "@shared/schema";
import { db } from "../../db";
import { calculateHistoricalLocationInventory } from "../_helpers";

/**
 * ERP Stock In Hand — the value of location inventory at weighted-average cost.
 *
 * With no `toDate` this reads the live inventory table. With one it replays each
 * active location's history through calculateHistoricalLocationInventory, which
 * is why the two branches look different: only the historical path can produce
 * quantities that no longer exist today.
 *
 * Extracted verbatim from the /api/stats/net-profit handler; it returns the
 * figure rather than pushing into the caller's accumulators.
 * config/report-characterization.json pins the endpoint's output across the move.
 */
export async function computeStockInHand(companyId: number, toDate: string | null | undefined): Promise<number> {
  const activeLocationsData = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
    .execute();
  const activeLocationIds = activeLocationsData.map((l) => l.id);

  let stockOnFloor = 0;
  if (activeLocationIds.length > 0) {
    if (toDate) {
      const allHistorical = await Promise.all(
        activeLocationIds.map((locId) => calculateHistoricalLocationInventory(locId, companyId, toDate))
      );
      for (const items of allHistorical) {
        for (const inv of items) {
          const qty = parseFloat(inv.quantity || "0");
          const rate = parseFloat(inv.averageRate || "0");
          if (qty > 0) stockOnFloor += qty * rate;
        }
      }
    } else {
      const inventoryData = await db
        .select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
        .from(inventory)
        .where(inArray(inventory.locationId, activeLocationIds))
        .execute();
      for (const inv of inventoryData) {
        stockOnFloor += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
      }
    }
  }

  return Math.round((stockOnFloor + Number.EPSILON) * 100) / 100;
}
