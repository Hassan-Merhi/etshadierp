import type { Express, Request, Response } from "express";
import Decimal from "decimal.js";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  inventory,
  ledgerAccounts,
  locations,
  spStockMovements,
  stockItems,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  privilegedMutationRateLimit,
  privilegedReadRateLimit,
} from "../../middleware/privilegedEndpointSecurity";
import {
  GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
  GoldenCoastCutoverStockBridgeError,
  assertGoldenCoastStockValueReconciles,
  planGoldenCoastCutoverStockBridge,
  type GoldenCoastCutoverStockPlan,
} from "../../services/accounting/goldenCoastCutoverStockBridge";
import {
  GOLDEN_COAST_PHASE3_CUTOVER_DATE,
  goldenCoastPhase3VoucherNumber,
} from "../../services/accounting/goldenCoastPhase3Cutover";
import { requireSpCompany } from "./spHelpers";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class GoldenCoastCutoverStockRouteError extends Error {
  constructor(
    message: string,
    readonly code = "GC_CUTOVER_STOCK_INVALID",
    readonly status = 400
  ) {
    super(message);
    this.name = "GoldenCoastCutoverStockRouteError";
  }
}

function businessDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadLegacyInventory(tx: DatabaseTransaction | typeof db, companyId: number) {
  return tx
    .select({
      locationId: inventory.locationId,
      stockItemId: inventory.stockItemId,
      stockItemCode: stockItems.code,
      stockItemName: stockItems.name,
      quantity: inventory.quantity,
      averageRate: inventory.averageRate,
      totalValue: inventory.totalValue,
    })
    .from(inventory)
    .innerJoin(locations, eq(locations.id, inventory.locationId))
    .innerJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
    .where(
      and(
        eq(inventory.companyId, companyId),
        eq(locations.companyId, companyId),
        eq(stockItems.companyId, companyId),
        isNull(locations.deletedAt),
        isNull(stockItems.deletedAt),
        gt(inventory.quantity, "0")
      )
    );
}

async function loadPhase3StockInHandOpening(tx: DatabaseTransaction | typeof db, companyId: number) {
  const stockAccounts = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, "sp_stock"),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .limit(2);
  if (stockAccounts.length !== 1) {
    throw new GoldenCoastCutoverStockRouteError(
      stockAccounts.length === 0
        ? "Canonical Stock in Hand account is missing; run Golden Coast account setup first"
        : "Canonical Stock in Hand account is ambiguous; repair duplicate sp_stock accounts before bridging opening FIFO lots",
      "GC_CUTOVER_STOCK_ACCOUNT_INVALID",
      409
    );
  }
  const stockAccount = stockAccounts[0];

  const voucherNumber = goldenCoastPhase3VoucherNumber(companyId);
  const [cutoverVoucher] = await tx
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(
      and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, voucherNumber), isNull(vouchers.deletedAt))
    )
    .limit(1);
  if (!cutoverVoucher) {
    throw new GoldenCoastCutoverStockRouteError(
      "Phase 3 cutover must be posted before opening FIFO lots can be bridged",
      "GC_CUTOVER_STOCK_PHASE3_REQUIRED",
      409
    );
  }

  const [entry] = await tx
    .select({ debitAmount: voucherEntries.debitAmount, creditAmount: voucherEntries.creditAmount })
    .from(voucherEntries)
    .where(
      and(eq(voucherEntries.voucherId, cutoverVoucher.id), eq(voucherEntries.ledgerAccountId, stockAccount.id))
    )
    .limit(1);
  if (!entry) {
    throw new GoldenCoastCutoverStockRouteError(
      "Phase 3 cutover voucher has no Stock in Hand entry",
      "GC_CUTOVER_STOCK_PHASE3_CORRUPT",
      409
    );
  }
  return new Decimal(entry.debitAmount ?? 0).minus(entry.creditAmount ?? 0).toFixed(2);
}

async function loadExistingBridgeLots(tx: DatabaseTransaction | typeof db, companyId: number) {
  return tx
    .select({
      id: spStockMovements.id,
      locationId: spStockMovements.locationId,
      stockItemId: spStockMovements.stockItemId,
      articleCode: spStockMovements.articleCode,
      description: spStockMovements.description,
      qtyIn: spStockMovements.qtyIn,
      qtyRemaining: spStockMovements.qtyRemaining,
      baseUnitCostUsd: spStockMovements.baseUnitCostUsd,
      landedUnitCostUsd: spStockMovements.landedUnitCostUsd,
      finalUnitCostUsd: spStockMovements.finalUnitCostUsd,
    })
    .from(spStockMovements)
    .where(
      and(
        eq(spStockMovements.companyId, companyId),
        eq(spStockMovements.sourceType, GOLDEN_COAST_CUTOVER_STOCK_SOURCE)
      )
    );
}

function planFromExistingLots(
  existing: Awaited<ReturnType<typeof loadExistingBridgeLots>>
): GoldenCoastCutoverStockPlan {
  const seen = new Set<string>();
  let totalQuantity = new Decimal(0);
  let totalValue = new Decimal(0);
  const lots = existing.map((row) => {
    if (!row.locationId || !row.stockItemId) {
      throw new GoldenCoastCutoverStockBridgeError(
        "Existing cutover FIFO lot is missing its location or stock item link"
      );
    }
    const key = `${row.locationId}:${row.stockItemId}`;
    if (seen.has(key)) {
      throw new GoldenCoastCutoverStockBridgeError(`Duplicate existing cutover FIFO lot for ${key}`);
    }
    seen.add(key);

    const qtyIn = new Decimal(row.qtyIn ?? 0);
    const qtyRemaining = new Decimal(row.qtyRemaining ?? 0);
    const finalUnitCost = new Decimal(row.finalUnitCostUsd ?? 0);
    if (qtyIn.lte(0) || finalUnitCost.lte(0) || qtyRemaining.lt(0) || qtyRemaining.gt(qtyIn)) {
      throw new GoldenCoastCutoverStockBridgeError(
        `Existing cutover FIFO lot ${row.id} has invalid quantity or cost state`
      );
    }
    totalQuantity = totalQuantity.plus(qtyIn);
    totalValue = totalValue.plus(qtyIn.times(finalUnitCost));

    return {
      locationId: row.locationId,
      stockItemId: row.stockItemId,
      articleCode: row.articleCode,
      description: row.description,
      qtyIn: qtyIn.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      qtyRemaining: qtyRemaining.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      baseUnitCostUsd: new Decimal(row.baseUnitCostUsd ?? 0)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6),
      landedUnitCostUsd: new Decimal(row.landedUnitCostUsd ?? 0)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6),
      finalUnitCostUsd: finalUnitCost.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
    };
  });

  lots.sort((a, b) => a.locationId - b.locationId || a.stockItemId - b.stockItemId);
  return {
    cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
    sourceType: GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
    lots,
    totalQuantity: totalQuantity.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    totalValueUsd: totalValue.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  };
}

async function buildState(tx: DatabaseTransaction | typeof db, companyId: number) {
  const [existingLots, stockInHandOpeningUsd] = await Promise.all([
    loadExistingBridgeLots(tx, companyId),
    loadPhase3StockInHandOpening(tx, companyId),
  ]);

  if (existingLots.length > 0) {
    const plan = planFromExistingLots(existingLots);
    assertGoldenCoastStockValueReconciles(plan.totalValueUsd, stockInHandOpeningUsd);
    return {
      cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
      plan,
      stockInHandOpeningUsd,
      existingLotCount: existingLots.length,
      bridged: true,
      conflict: false,
      canPost: false,
    };
  }

  const legacyRows = await loadLegacyInventory(tx, companyId);
  const plan = planGoldenCoastCutoverStockBridge(legacyRows);
  assertGoldenCoastStockValueReconciles(plan.totalValueUsd, stockInHandOpeningUsd);
  const zeroStockOpening = plan.lots.length === 0 && new Decimal(stockInHandOpeningUsd).eq(0);
  return {
    cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
    plan,
    stockInHandOpeningUsd,
    existingLotCount: 0,
    bridged: zeroStockOpening,
    conflict: false,
    canPost: !zeroStockOpening && businessDate() >= GOLDEN_COAST_PHASE3_CUTOVER_DATE,
  };
}

function respondKnownError(res: Response, error: unknown): boolean {
  if (error instanceof GoldenCoastCutoverStockRouteError) {
    res.status(error.status).json({ message: error.message, code: error.code });
    return true;
  }
  if (error instanceof GoldenCoastCutoverStockBridgeError) {
    res.status(409).json({ message: error.message, code: "GC_CUTOVER_STOCK_RECONCILIATION_FAILED" });
    return true;
  }
  return false;
}

export function registerSpGoldenCoastCutoverStockBridgeRoutes(app: Express): void {
  app.get(
    "/api/sp/golden-coast/cutover-stock-bridge/status",
    privilegedReadRateLimit,
    requireAuth,
    (req: Request, res: Response) => {
      void (async () => {
        try {
          const companyId = await requireSpCompany(req, res);
          if (!companyId) return;
          res.json(await buildState(db, companyId));
        } catch (error) {
          if (respondKnownError(res, error)) return;
          logger.error("Golden Coast cutover stock bridge status failed", { error });
          res.status(500).json({ message: getErrorMessage(error) });
        }
      })();
    }
  );

  app.post(
    "/api/sp/golden-coast/cutover-stock-bridge",
    privilegedMutationRateLimit,
    requireAuth,
    requireRole("Admin"),
    (req: Request, res: Response) => {
      void (async () => {
        try {
          const companyId = await requireSpCompany(req, res);
          if (!companyId) return;
          if (businessDate() < GOLDEN_COAST_PHASE3_CUTOVER_DATE) {
            throw new GoldenCoastCutoverStockRouteError(
              `Opening FIFO bridge cannot be posted before ${GOLDEN_COAST_PHASE3_CUTOVER_DATE}`,
              "GC_CUTOVER_STOCK_NOT_OPEN",
              409
            );
          }

          const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(64177, ${companyId})`);
            const state = await buildState(tx, companyId);
            if (state.bridged) return { ...state, replayed: true };

            if (state.plan.lots.length > 0) {
              await tx.insert(spStockMovements).values(
                state.plan.lots.map((lot) => ({
                  companyId,
                  sourceType: GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
                  articleCode: lot.articleCode,
                  description: lot.description,
                  stockItemId: lot.stockItemId,
                  locationId: lot.locationId,
                  qtyIn: lot.qtyIn,
                  qtyRemaining: lot.qtyRemaining,
                  baseUnitCostUsd: lot.baseUnitCostUsd,
                  landedUnitCostUsd: lot.landedUnitCostUsd,
                  finalUnitCostUsd: lot.finalUnitCostUsd,
                }))
              );
            }

            return { ...(await buildState(tx, companyId)), replayed: false };
          });
          res.json(result);
        } catch (error) {
          if (respondKnownError(res, error)) return;
          logger.error("Golden Coast cutover stock bridge failed", { error });
          res.status(500).json({ message: getErrorMessage(error) });
        }
      })();
    }
  );
}
