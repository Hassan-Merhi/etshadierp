import type { Express, Request, Response } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { inventory, ledgerAccounts, locations, spStockMovements, stockItems, voucherEntries, vouchers } from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { privilegedMutationRateLimit, privilegedReadRateLimit } from "../../middleware/privilegedEndpointSecurity";
import {
  GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
  GoldenCoastCutoverStockBridgeError,
  assertGoldenCoastStockValueReconciles,
  planGoldenCoastCutoverStockBridge,
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
  const [stockAccount] = await tx
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
  if (!stockAccount) {
    throw new GoldenCoastCutoverStockRouteError(
      "Canonical Stock in Hand account is missing; run Golden Coast account setup first",
      "GC_CUTOVER_STOCK_ACCOUNT_MISSING",
      409
    );
  }

  const voucherNumber = goldenCoastPhase3VoucherNumber(companyId);
  const [cutoverVoucher] = await tx
    .select({ id: vouchers.id })
    .from(vouchers)
    .where(and(eq(vouchers.companyId, companyId), eq(vouchers.voucherNumber, voucherNumber), isNull(vouchers.deletedAt)))
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
  return (Number(entry.debitAmount ?? 0) - Number(entry.creditAmount ?? 0)).toFixed(2);
}

async function loadExistingBridgeLots(tx: DatabaseTransaction | typeof db, companyId: number) {
  return tx
    .select({
      id: spStockMovements.id,
      locationId: spStockMovements.locationId,
      stockItemId: spStockMovements.stockItemId,
      articleCode: spStockMovements.articleCode,
      qtyIn: spStockMovements.qtyIn,
      qtyRemaining: spStockMovements.qtyRemaining,
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

function existingLotsMatch(
  expected: ReturnType<typeof planGoldenCoastCutoverStockBridge>["lots"],
  existing: Awaited<ReturnType<typeof loadExistingBridgeLots>>
): boolean {
  if (expected.length !== existing.length) return false;
  const byKey = new Map(existing.map((row) => [`${row.locationId}:${row.stockItemId}`, row]));
  return expected.every((lot) => {
    const row = byKey.get(`${lot.locationId}:${lot.stockItemId}`);
    return (
      !!row &&
      row.articleCode === lot.articleCode &&
      Number(row.qtyIn).toFixed(4) === Number(lot.qtyIn).toFixed(4) &&
      Number(row.qtyRemaining).toFixed(4) === Number(lot.qtyRemaining).toFixed(4) &&
      Number(row.finalUnitCostUsd).toFixed(6) === Number(lot.finalUnitCostUsd).toFixed(6)
    );
  });
}

async function buildState(tx: DatabaseTransaction | typeof db, companyId: number) {
  const [legacyRows, existingLots, stockInHandOpeningUsd] = await Promise.all([
    loadLegacyInventory(tx, companyId),
    loadExistingBridgeLots(tx, companyId),
    loadPhase3StockInHandOpening(tx, companyId),
  ]);
  const plan = planGoldenCoastCutoverStockBridge(legacyRows);
  assertGoldenCoastStockValueReconciles(plan.totalValueUsd, stockInHandOpeningUsd);
  const replayed = existingLots.length > 0 && existingLotsMatch(plan.lots, existingLots);
  const conflict = existingLots.length > 0 && !replayed;
  return {
    cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
    plan,
    stockInHandOpeningUsd,
    existingLotCount: existingLots.length,
    bridged: replayed,
    conflict,
    canPost: !conflict && !replayed && businessDate() >= GOLDEN_COAST_PHASE3_CUTOVER_DATE,
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
            const state = await buildState(tx, companyId);
            if (state.conflict) {
              throw new GoldenCoastCutoverStockRouteError(
                "Existing Golden Coast cutover FIFO lots are partial or do not match legacy ERP inventory; reconcile them before retrying",
                "GC_CUTOVER_STOCK_CONFLICT",
                409
              );
            }
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
