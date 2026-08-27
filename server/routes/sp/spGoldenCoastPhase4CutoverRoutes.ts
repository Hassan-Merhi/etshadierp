import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { spStockMovements } from "@shared/schema";
import { requireAuth, requireRole } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { resultRows } from "../../lib/queryResult";
import {
  privilegedMutationRateLimit,
  privilegedReadRateLimit,
  privilegedRequestBudget,
} from "../../middleware/privilegedEndpointSecurity";
import {
  GOLDEN_COAST_PHASE4_CONFIRMATION,
  GOLDEN_COAST_PHASE4_CUTOVER_DATE,
  GOLDEN_COAST_PHASE4_OPENING_SOURCE,
  GoldenCoastPhase4Error,
  assertGoldenCoastPostCutoverMutationDates,
  reconcileGoldenCoastOpeningInventory,
  type GoldenCoastOpeningInventoryRow,
} from "../../services/accounting/goldenCoastPhase4Cutover";
import { requireSpCompany } from "./spHelpers";

const requestBudget = privilegedRequestBudget({ maxBodyBytes: 8 * 1024, maxCollectionItems: 10 });
const LEGACY_RETIRED_CODE = "GC_LEGACY_POSTING_RETIRED";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function phase3VoucherNumber(companyId: number): string {
  return `GC-CUTOVER-20260901-C${companyId}`;
}

function retiredLegacyWrite(_req: Request, res: Response): void {
  res.status(410).json({
    code: LEGACY_RETIRED_CODE,
    message:
      "This Golden Coast legacy posting path is retired. Use the September 1 cutover and canonical Supplier Partner flows.",
  });
}

function postCutoverMutationDateGuard(req: Request, res: Response, next: NextFunction): void {
  if (today() < GOLDEN_COAST_PHASE4_CUTOVER_DATE) return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  // Migration/setup/cutover endpoints intentionally operate on historical state and
  // have their own privileged guards. The production mutation surface is protected here.
  if (
    req.path.startsWith("/migration") ||
    req.path.startsWith("/setup") ||
    req.path.startsWith("/golden-coast")
  ) {
    return next();
  }

  try {
    assertGoldenCoastPostCutoverMutationDates(req.body);
    next();
  } catch (error) {
    if (error instanceof GoldenCoastPhase4Error) {
      res.status(409).json({ code: "GC_PRE_CUTOVER_READ_ONLY", message: error.message });
      return;
    }
    next(error);
  }
}

async function loadOpeningSnapshot(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number
): Promise<GoldenCoastOpeningInventoryRow[]> {
  const rows = resultRows(
    await executor.execute(sql`
      SELECT
        inv.stock_item_id AS "stockItemId",
        inv.location_id AS "locationId",
        si.code AS "articleCode",
        CAST(inv.quantity AS text) AS quantity,
        CAST(COALESCE(inv.average_rate, 0) AS text) AS "averageRate"
      FROM inventory inv
      JOIN locations loc ON loc.id = inv.location_id AND loc.company_id = ${companyId} AND loc.deleted_at IS NULL
      JOIN stock_items si ON si.id = inv.stock_item_id
      WHERE inv.company_id = ${companyId}
        AND COALESCE(CAST(inv.quantity AS numeric), 0) > 0
      ORDER BY inv.location_id ASC, inv.stock_item_id ASC
    `)
  );

  return rows.map((row) => ({
    stockItemId: Number(row.stockItemId),
    locationId: Number(row.locationId),
    articleCode: String(row.articleCode ?? ""),
    quantity: String(row.quantity ?? "0"),
    averageRate: String(row.averageRate ?? "0"),
  }));
}

async function loadStockInHandOpeningUsd(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number
): Promise<string | null> {
  const rows = resultRows(
    await executor.execute(sql`
      SELECT CAST(COALESCE(SUM(CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)), 0) AS text) AS value
      FROM vouchers v
      JOIN voucher_entries ve ON ve.voucher_id = v.id
      JOIN ledger_accounts la ON la.id = ve.ledger_account_id
      WHERE v.company_id = ${companyId}
        AND v.voucher_number = ${phase3VoucherNumber(companyId)}
        AND v.deleted_at IS NULL
        AND la.company_id = ${companyId}
        AND la.sub_type = 'sp_stock'
    `)
  );
  const value = rows[0]?.value;
  return value == null ? null : String(value);
}

async function openingLotCount(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number
): Promise<number> {
  const rows = resultRows(
    await executor.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sp_stock_movements
      WHERE company_id = ${companyId} AND source_type = ${GOLDEN_COAST_PHASE4_OPENING_SOURCE}
    `)
  );
  return Number(rows[0]?.count ?? 0);
}

async function phase4Status(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number
) {
  const [snapshot, stockInHandOpeningUsd, existingLotCount] = await Promise.all([
    loadOpeningSnapshot(executor, companyId),
    loadStockInHandOpeningUsd(executor, companyId),
    openingLotCount(executor, companyId),
  ]);
  const phase3Posted = stockInHandOpeningUsd !== null;
  const reconciliation = phase3Posted
    ? reconcileGoldenCoastOpeningInventory({ stockInHandOpeningUsd: stockInHandOpeningUsd!, rows: snapshot })
    : null;
  const cutoverOpen = today() >= GOLDEN_COAST_PHASE4_CUTOVER_DATE;

  return {
    cutoverDate: GOLDEN_COAST_PHASE4_CUTOVER_DATE,
    phase3VoucherNumber: phase3VoucherNumber(companyId),
    phase3Posted,
    cutoverOpen,
    existingLotCount,
    snapshot,
    reconciliation,
    canBuild:
      phase3Posted && cutoverOpen && existingLotCount === 0 && reconciliation !== null && reconciliation.reconciled,
  };
}

function validateMutationIntent(req: Request): void {
  if (req.body?.confirmation !== GOLDEN_COAST_PHASE4_CONFIRMATION) {
    throw new GoldenCoastPhase4Error(`confirmation must be exactly ${GOLDEN_COAST_PHASE4_CONFIRMATION}`);
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10) throw new GoldenCoastPhase4Error("A meaningful reason of at least 10 characters is required");
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new GoldenCoastPhase4Error("Idempotency-Key header is required and must be at least 8 characters");
  }
}

async function handleStatus(req: Request, res: Response): Promise<void> {
  try {
    const companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    res.json(await phase4Status(db, companyId));
  } catch (error) {
    logger.error("Golden Coast Phase 4 status failed", { error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function handleBuildOpeningFifo(req: Request, res: Response): Promise<void> {
  let companyId: number | null = null;
  try {
    companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    validateMutationIntent(req);
    if (today() < GOLDEN_COAST_PHASE4_CUTOVER_DATE) {
      res.status(409).json({
        code: "GC_PHASE4_CUTOVER_NOT_OPEN",
        message: `Opening FIFO cannot be built before ${GOLDEN_COAST_PHASE4_CUTOVER_DATE}`,
      });
      return;
    }

    const selectedCompanyId = companyId;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${9100000 + selectedCompanyId})`);
      const existing = await openingLotCount(tx, selectedCompanyId);
      if (existing > 0) {
        return { replayed: true, rowsCreated: 0, status: await phase4Status(tx, selectedCompanyId) };
      }

      const status = await phase4Status(tx, selectedCompanyId);
      if (!status.phase3Posted) {
        throw new GoldenCoastPhase4Error("Phase 3 cutover must be posted before the opening FIFO bridge is built");
      }
      if (!status.reconciliation?.reconciled) {
        throw new GoldenCoastPhase4Error(
          `Legacy inventory value (${status.reconciliation?.totalValueUsd ?? "unknown"}) does not reconcile to Phase 3 Stock in Hand (${status.reconciliation?.stockInHandOpeningUsd ?? "unknown"})`
        );
      }

      if (status.snapshot.length > 0) {
        await tx.insert(spStockMovements).values(
          status.snapshot.map((row) => ({
            companyId: selectedCompanyId,
            sourceType: GOLDEN_COAST_PHASE4_OPENING_SOURCE,
            articleCode: row.articleCode,
            description: `Golden Coast ${GOLDEN_COAST_PHASE4_CUTOVER_DATE} opening FIFO bridge`,
            stockItemId: row.stockItemId,
            locationId: row.locationId,
            qtyIn: String(row.quantity),
            qtyRemaining: String(row.quantity),
            baseUnitCostUsd: String(row.averageRate),
            landedUnitCostUsd: String(row.averageRate),
            finalUnitCostUsd: String(row.averageRate),
          }))
        );
      }

      return {
        replayed: false,
        rowsCreated: status.snapshot.length,
        status: await phase4Status(tx, selectedCompanyId),
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof GoldenCoastPhase4Error) {
      res.status(409).json({ code: "GC_PHASE4_INVALID", message: error.message });
      return;
    }
    logger.error("Golden Coast Phase 4 FIFO bridge failed", { companyId, error });
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpGoldenCoastPhase4CutoverRoutes(app: Express): void {
  // Register before the historical handlers. Express stops here after sending 410,
  // making the superseded Phase 1 accounting/opening-stock mutation paths unreachable.
  app.post("/api/golden-coast/accounting/phase1/post", requireAuth, retiredLegacyWrite);
  app.post("/api/sp/opening-stock", requireAuth, retiredLegacyWrite);

  app.use("/api/sp", postCutoverMutationDateGuard);

  app.get(
    "/api/sp/golden-coast/phase4/status",
    privilegedReadRateLimit,
    requireAuth,
    (req, res) => void handleStatus(req, res)
  );
  app.post(
    "/api/sp/golden-coast/phase4/opening-fifo",
    privilegedMutationRateLimit,
    requestBudget,
    requireAuth,
    requireRole("Admin"),
    (req, res) => void handleBuildOpeningFifo(req, res)
  );
}
