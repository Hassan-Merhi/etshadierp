import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { locations, stockItems } from "@shared/schema";
import {
  canonicalStockMovementAudit,
  canonicalStockMovementRequests,
  canonicalStockMovements,
} from "./canonicalStockMovementTables";
import type { db } from "../../db";
import {
  StockMovementValidationError,
  type StockMovementAdapter,
  type StockMovementRecord,
  type StockMovementResult,
} from "./stockMovementIntegrityService";

/** The concrete drizzle transaction handle, inferred from the shared client. */
type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type JournalRow = typeof canonicalStockMovements.$inferSelect;

function toRecord(row: JournalRow): StockMovementRecord {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    stockItemId: Number(row.stockItemId),
    locationId: Number(row.locationId),
    quantityDelta: String(row.quantityDelta),
    unitCost: String(row.unitCost),
    movementKind: row.movementKind as StockMovementRecord["movementKind"],
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    reversalOfMovementId: row.reversalOfMovementId == null ? null : Number(row.reversalOfMovementId),
  };
}

function resultRows(result: unknown): Record<string, unknown>[] {
  if (typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows)) {
    return result.rows as Record<string, unknown>[];
  }
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

/**
 * PostgreSQL persistence for the canonical stock movement journal.
 *
 * The journal is append-only: rows are inserted, never updated or deleted. A
 * replayed request is recognised by its idempotency key and returns the
 * movements the first attempt wrote together with the totals that attempt
 * recorded, so a retry produces no second stock effect and no recomputation
 * that could disagree with the original.
 */
export function createDatabaseStockMovementAdapter(): StockMovementAdapter<DrizzleTransaction> {
  return {
    async findExisting({ tx, companyId, source }): Promise<StockMovementResult | null> {
      const [request] = await tx
        .select({ movementIds: canonicalStockMovementRequests.movementIds })
        .from(canonicalStockMovementRequests)
        .where(
          and(
            eq(canonicalStockMovementRequests.companyId, companyId),
            eq(canonicalStockMovementRequests.idempotencyKey, source.idempotencyKey)
          )
        )
        .limit(1);
      if (!request) return null;

      const movementIds = request.movementIds ?? [];
      if (movementIds.length === 0) return null;

      const rows = await tx
        .select()
        .from(canonicalStockMovements)
        .where(and(eq(canonicalStockMovements.companyId, companyId), inArray(canonicalStockMovements.id, movementIds)))
        .orderBy(canonicalStockMovements.id);

      // The totals come from the audit row the first attempt wrote rather than
      // being re-derived here: a replay must report exactly what was posted.
      const [audit] = await tx
        .select({
          quantity: canonicalStockMovementAudit.quantity,
          value: canonicalStockMovementAudit.value,
        })
        .from(canonicalStockMovementAudit)
        .where(
          and(
            eq(canonicalStockMovementAudit.companyId, companyId),
            eq(canonicalStockMovementAudit.idempotencyKey, source.idempotencyKey)
          )
        )
        .limit(1);
      if (!audit) {
        throw new StockMovementValidationError(
          "STOCK_MOVEMENT_IDEMPOTENCY_CORRUPT",
          `Movement request ${source.idempotencyKey} has journal rows but no audit record`
        );
      }

      return {
        movements: rows.map(toRecord),
        // Normalised through Decimal so a replay reports the same string the
        // first attempt returned: the column stores 3 as "3.000000", and a
        // caller comparing the two must not see a difference that is not one.
        quantity: new Decimal(String(audit.quantity)).toFixed(),
        value: new Decimal(String(audit.value)).toFixed(),
        idempotent: true,
      };
    },

    async validateOwnership({ tx, companyId, stockItemId, locationIds }): Promise<void> {
      const [item] = await tx
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(and(eq(stockItems.id, stockItemId), eq(stockItems.companyId, companyId)))
        .limit(1);
      if (!item) {
        throw new StockMovementValidationError(
          "STOCK_MOVEMENT_ITEM_FOREIGN",
          `Stock item ${stockItemId} does not belong to company ${companyId}`
        );
      }

      // Locations are checked for existence only. Intercompany transfers are a
      // supported flow, so a location owned by another company is not by itself
      // a boundary violation — the request company still owns the movement.
      const found = await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, locationIds));
      const foundIds = new Set(found.map((row) => Number(row.id)));
      for (const locationId of locationIds) {
        if (!foundIds.has(locationId)) {
          throw new StockMovementValidationError("STOCK_MOVEMENT_LOCATION_MISSING", `Location ${locationId} not found`);
        }
      }
    },

    async lockBalances({ tx, companyId, stockItemId, locationIds }): Promise<Record<number, string>> {
      const balances: Record<number, string> = {};
      for (const locationId of locationIds) balances[locationId] = "0";
      if (locationIds.length === 0) return balances;

      // Locks the journal rows for this item/location set, then sums them, so a
      // concurrent post for the same stock waits rather than reading a balance
      // that is about to change. Aggregates cannot be locked directly, hence the
      // subquery.
      const idList = sql.join(
        locationIds.map((id) => sql`${id}`),
        sql`, `
      );
      await tx.execute(sql`
        SELECT id
        FROM canonical_stock_movements
        WHERE company_id = ${companyId}
          AND stock_item_id = ${stockItemId}
          AND location_id IN (${idList})
        FOR UPDATE
      `);
      const summed = await tx.execute(sql`
        SELECT location_id AS "locationId", coalesce(sum(quantity_delta), 0) AS "balance"
        FROM canonical_stock_movements
        WHERE company_id = ${companyId}
          AND stock_item_id = ${stockItemId}
          AND location_id IN (${idList})
        GROUP BY location_id
      `);

      for (const row of resultRows(summed)) {
        balances[Number(row.locationId)] = new Decimal(String(row.balance ?? "0")).toFixed();
      }
      return balances;
    },

    async appendMovements({ tx, request, rows }): Promise<StockMovementRecord[]> {
      const inserted = await tx
        .insert(canonicalStockMovements)
        .values(
          rows.map((row) => ({
            companyId: request.companyId,
            stockItemId: request.stockItemId,
            locationId: row.locationId,
            quantityDelta: row.quantityDelta,
            unitCost: row.unitCost,
            movementKind: request.kind,
            sourceType: request.source.sourceType,
            sourceId: request.source.sourceId,
            idempotencyKey: request.source.idempotencyKey,
            reversalOfMovementId: request.reversalOfMovementId ?? null,
            occurredAt: new Date(request.occurredAt),
          }))
        )
        .returning();
      return inserted.map(toRecord);
    },

    async recordIdempotency({ tx, companyId, source, movementIds }): Promise<void> {
      await tx.insert(canonicalStockMovementRequests).values({
        companyId,
        idempotencyKey: source.idempotencyKey,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        movementIds,
      });
    },

    async recordAudit({ tx, request, movementIds, quantity, value }): Promise<void> {
      await tx.insert(canonicalStockMovementAudit).values({
        companyId: request.companyId,
        idempotencyKey: request.source.idempotencyKey,
        sourceType: request.source.sourceType,
        sourceId: request.source.sourceId,
        movementIds,
        quantity,
        value,
        actorUserId: request.actor?.userId == null ? null : String(request.actor.userId),
        actorUsername: request.actor?.username ?? null,
        reason: request.actor?.reason ?? null,
        occurredAt: new Date(request.occurredAt),
      });
    },
  };
}
