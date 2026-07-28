import type { Express } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { factoryContainers, factoryRawStock } from "@shared/schema";
import { requireAuth } from "../../../auth";
import { db } from "../../../db";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import {
  isCompanyIsolationError,
  resolveRequestCompanyId,
} from "../../../services/security/requestCompanyScope";

/**
 * Available containers for first or continuation raw-stock receipt.
 *
 * PARTIALLY_RECEIVED containers remain selectable until their agreed quantity is
 * fully received. Their established landed cost is returned so later receipts
 * cannot silently change the supplier/container rate.
 */
export function registerRawStockAvailableContainerRoutes(app: Express): void {
  app.get("/api/factory/raw-stock/available-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveRequestCompanyId(req);
      const containers = await db
        .select()
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            sql`${factoryContainers.status} IN ('PENDING', 'ARRIVED', 'RECEIVED', 'PARTIALLY_RECEIVED')`,
            isNull(factoryContainers.deletedAt),
          ),
        );

      const available = containers.filter((container) => {
        if (container.status !== "PARTIALLY_RECEIVED") return true;
        const agreedKg = Number(container.totalKg || container.declaredKg || 0);
        const receivedKg = Number(container.actualReceivedKg || 0);
        return agreedKg <= 0 || receivedKg < agreedKg;
      });

      const partialIds = available
        .filter((container) => container.status === "PARTIALLY_RECEIVED")
        .map((container) => container.id);
      const costByContainer = new Map<
        number,
        { costPerKg: string | null; costPerKgUsd: string | null }
      >();

      if (partialIds.length > 0) {
        const rows = await db
          .select({
            containerId: factoryRawStock.containerId,
            costPerKg: factoryRawStock.costPerKg,
            costPerKgUsd: factoryRawStock.costPerKgUsd,
          })
          .from(factoryRawStock)
          .where(
            and(
              eq(factoryRawStock.companyId, companyId),
              inArray(factoryRawStock.containerId, partialIds),
              isNull(factoryRawStock.deletedAt),
            ),
          );
        for (const row of rows) {
          costByContainer.set(row.containerId, {
            costPerKg: row.costPerKg,
            costPerKgUsd: row.costPerKgUsd,
          });
        }
      }

      res.json(
        available.map((container) => {
          if (container.status !== "PARTIALLY_RECEIVED") return container;
          const cost = costByContainer.get(container.id);
          return {
            ...container,
            fixedCostPerKg: cost?.costPerKg ?? null,
            fixedCostPerKgUsd: cost?.costPerKgUsd ?? null,
          };
        }),
      );
    } catch (error: unknown) {
      logger.error("Error fetching available raw-stock containers", { error });
      if (isCompanyIsolationError(error)) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
