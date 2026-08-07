import type { Express } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { factoryContainers, factoryRawStock, factorySuppliers } from "@shared/schema";
import { requireAuth } from "../../../auth";
import { db } from "../../../db";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { isCompanyIsolationError, resolveRequestCompanyId } from "../../../services/security/requestCompanyScope";

/**
 * Available containers for first or continuation raw-stock receipt.
 *
 * PARTIALLY_RECEIVED containers remain selectable until their agreed quantity is
 * fully received. Their established landed cost is returned so later receipts
 * cannot silently change the supplier/container rate.
 *
 * Phase 3 bandwidth hardening intentionally selects only fields consumed by the
 * Offload dialog instead of returning the full factory-container record (tracking
 * diagnostics, notes, historical FX metadata, and other unrelated columns).
 */
export function registerRawStockAvailableContainerRoutes(app: Express): void {
  app.get("/api/factory/raw-stock/available-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = resolveRequestCompanyId(req);
      const containers = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
          status: factoryContainers.status,
          totalKg: factoryContainers.totalKg,
          declaredKg: factoryContainers.declaredKg,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          ratePerKg: factoryContainers.ratePerKg,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          freight: factoryContainers.freight,
          freightCurrencyCode: factoryContainers.freightCurrencyCode,
          freightSupplierId: factoryContainers.freightSupplierId,
          freightPaidBy: factoryContainers.freightPaidBy,
          freightOwnAccountId: factoryContainers.freightOwnAccountId,
          otherCharges: factoryContainers.otherCharges,
          otherChargesCurrencyCode: factoryContainers.otherChargesCurrencyCode,
          otherChargesAccountId: factoryContainers.otherChargesAccountId,
          otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          commissionSupplierId: factoryContainers.commissionSupplierId,
          commissionFxRateToUsd: factoryContainers.commissionFxRateToUsd,
          commissionFxRateConfirmed: factoryContainers.commissionFxRateConfirmed,
        })
        .from(factoryContainers)
        .leftJoin(
          factorySuppliers,
          and(eq(factorySuppliers.id, factoryContainers.supplierId), eq(factorySuppliers.companyId, companyId))
        )
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            sql`${factoryContainers.status} IN ('PENDING', 'ARRIVED', 'RECEIVED', 'PARTIALLY_RECEIVED')`,
            isNull(factoryContainers.deletedAt),
            // Do the partial-receipt completion filter in SQL so completed
            // containers never cross the network just to be discarded in JS.
            sql`(
              ${factoryContainers.status} <> 'PARTIALLY_RECEIVED'
              OR COALESCE(${factoryContainers.totalKg}, ${factoryContainers.declaredKg}, 0) <= 0
              OR COALESCE(${factoryContainers.actualReceivedKg}, 0) < COALESCE(${factoryContainers.totalKg}, ${factoryContainers.declaredKg}, 0)
            )`
          )
        )
        .orderBy(desc(factoryContainers.id));

      const partialIds = containers
        .filter((container) => container.status === "PARTIALLY_RECEIVED")
        .map((container) => container.id);
      const costByContainer = new Map<number, { costPerKg: string | null; costPerKgUsd: string | null }>();

      if (partialIds.length > 0) {
        const rows = await db
          .select({
            id: factoryRawStock.id,
            containerId: factoryRawStock.containerId,
            costPerKg: factoryRawStock.costPerKg,
            costPerKgUsd: factoryRawStock.costPerKgUsd,
          })
          .from(factoryRawStock)
          .where(
            and(
              eq(factoryRawStock.companyId, companyId),
              inArray(factoryRawStock.containerId, partialIds),
              isNull(factoryRawStock.deletedAt)
            )
          )
          .orderBy(desc(factoryRawStock.id));

        // Rows arrive newest first; keep only the latest established cost for
        // each partial container instead of repeatedly overwriting the map.
        for (const row of rows) {
          if (!costByContainer.has(row.containerId)) {
            costByContainer.set(row.containerId, {
              costPerKg: row.costPerKg,
              costPerKgUsd: row.costPerKgUsd,
            });
          }
        }
      }

      res.set("X-ERP-Payload-Profile", "raw-stock-offload-selector");
      res.set("Cache-Control", "private, max-age=30");
      res.json(
        containers.map((container) => {
          if (container.status !== "PARTIALLY_RECEIVED") return container;
          const cost = costByContainer.get(container.id);
          return {
            ...container,
            fixedCostPerKg: cost?.costPerKg ?? null,
            fixedCostPerKgUsd: cost?.costPerKgUsd ?? null,
          };
        })
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
