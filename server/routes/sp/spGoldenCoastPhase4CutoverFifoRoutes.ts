import type { Express, NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { spStockMovements } from "@shared/schema";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import {
  GOLDEN_COAST_CUTOVER_DATE,
  GOLDEN_COAST_CUTOVER_FIFO_SOURCE,
  GoldenCoastPhase4CutoverError,
  buildGoldenCoastCutoverFifoPlan,
  type GoldenCoastInventorySnapshotRow,
} from "../../services/accounting/goldenCoastPhase4CutoverFifo";
import { requireSpCompany, getSpAccount } from "./spHelpers";
import { resultRows } from "../../lib/queryResult";

const phase3VoucherNumber = (companyId: number) => `GC-CUTOVER-20260901-C${companyId}`;

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function isGoldenCoastCompany(conn: DbLike, companyId: number): Promise<boolean> {
  const rows = await conn.execute(sql`
    SELECT sub_type
    FROM ledger_accounts
    WHERE company_id = ${companyId}
      AND sub_type IN ('gc_partner_capital', 'gc_owner_capital')
      AND active = true
      AND deleted_at IS NULL
  `);
  const found = new Set(resultRows(rows).map((row) => String(row.sub_type)));
  return found.has("gc_partner_capital") && found.has("gc_owner_capital");
}

async function loadSnapshotState(conn: DbLike, companyId: number) {
  const stockAccount = await getSpAccount(companyId, "sp_stock");
  if (!stockAccount) {
    throw new GoldenCoastPhase4CutoverError("Golden Coast Stock in Hand account is not configured");
  }

  const voucherRows = await conn.execute(sql`
    SELECT v.id,
           COALESCE(SUM(CASE WHEN ve.ledger_account_id = ${stockAccount.id}
             THEN CAST(ve.debit_amount AS numeric) - CAST(ve.credit_amount AS numeric)
             ELSE 0 END), 0) AS stock_in_hand_opening
    FROM vouchers v
    LEFT JOIN voucher_entries ve ON ve.voucher_id = v.id
    WHERE v.company_id = ${companyId}
      AND v.voucher_number = ${phase3VoucherNumber(companyId)}
      AND v.deleted_at IS NULL
    GROUP BY v.id
    LIMIT 1
  `);
  const voucherRow = resultRows(voucherRows)[0];

  const inventoryRows = await conn.execute(sql`
    SELECT inv.id AS inventory_id,
           inv.location_id,
           inv.stock_item_id,
           inv.quantity,
           inv.average_rate,
           si.code AS article_code,
           si.name AS description
    FROM inventory inv
    INNER JOIN locations loc ON loc.id = inv.location_id AND loc.company_id = ${companyId}
    INNER JOIN stock_items si ON si.id = inv.stock_item_id
    WHERE inv.company_id = ${companyId}
      AND CAST(COALESCE(inv.quantity, '0') AS numeric) >= 0
    ORDER BY inv.location_id, inv.stock_item_id
  `);

  const existingRows = await conn.execute(sql`
    SELECT id, stock_item_id, location_id, qty_in, qty_remaining, final_unit_cost_usd
    FROM sp_stock_movements
    WHERE company_id = ${companyId}
      AND source_type = ${GOLDEN_COAST_CUTOVER_FIFO_SOURCE}
    ORDER BY id
  `);
  const existing = resultRows(existingRows);

  const blockers: string[] = [];
  if (!voucherRow) blockers.push("Phase 3 cutover voucher has not been posted yet.");
  if (new Date().toISOString().slice(0, 10) < GOLDEN_COAST_CUTOVER_DATE) {
    blockers.push(`Opening FIFO cutover cannot be posted before ${GOLDEN_COAST_CUTOVER_DATE}.`);
  }

  let plan: ReturnType<typeof buildGoldenCoastCutoverFifoPlan> | null = null;
  if (voucherRow) {
    try {
      const inventory: GoldenCoastInventorySnapshotRow[] = resultRows(inventoryRows).map((row) => ({
        inventoryId: Number(row.inventory_id),
        locationId: Number(row.location_id),
        stockItemId: Number(row.stock_item_id),
        articleCode: String(row.article_code ?? ""),
        description: row.description == null ? null : String(row.description),
        quantity: String(row.quantity ?? "0"),
        averageRate: String(row.average_rate ?? "0"),
      }));
      plan = buildGoldenCoastCutoverFifoPlan({
        companyId,
        stockInHandOpeningUsd: String(voucherRow.stock_in_hand_opening ?? "0"),
        inventory,
      });
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (existing.length > 0) {
    blockers.push("Golden Coast cutover FIFO snapshot already exists; rerun is read-only/idempotent.");
  }

  return {
    cutoverDate: GOLDEN_COAST_CUTOVER_DATE,
    phase3VoucherNumber: phase3VoucherNumber(companyId),
    phase3Posted: !!voucherRow,
    existing,
    posted: existing.length > 0,
    plan,
    blockers,
    canPost: blockers.length === 0 && !!plan,
  };
}

async function guardLegacyGoldenCoastMutation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = await requireSpCompany(req, res);
    if (!companyId) return;
    if (!(await isGoldenCoastCompany(db, companyId))) {
      next();
      return;
    }
    res.status(410).json({
      code: "GC_LEGACY_POSTING_RETIRED",
      message:
        "This Golden Coast legacy mutation is retired by the September 1 redesign. Legacy records remain readable, but production changes must use the replacement Golden Coast workflow.",
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpGoldenCoastPhase4CutoverFifoRoutes(app: Express): void {
  // Fail closed for all known legacy financial mutation paths until their replacement
  // Golden Coast phases land. Other Supplier Partner companies keep legacy behavior.
  app.post("/api/sp/opening-stock", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/sales", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/sales/:id/reverse", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/offload", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/offload/:id/reverse", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/prepaid", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/containers", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.patch("/api/sp/containers/:id", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));
  app.post("/api/sp/containers/:id/cancel", (req, res, next) => void guardLegacyGoldenCoastMutation(req, res, next));

  app.get("/api/sp/golden-coast/phase4/cutover-fifo/status", async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      if (!(await isGoldenCoastCompany(db, companyId))) {
        return res.status(409).json({ code: "GC_PHASE4_NOT_CONFIGURED", message: "Golden Coast account setup is not configured." });
      }
      res.json(await loadSnapshotState(db, companyId));
    } catch (error) {
      if (error instanceof GoldenCoastPhase4CutoverError) {
        return res.status(409).json({ code: "GC_PHASE4_CUTOVER_BLOCKED", message: error.message });
      }
      logger.error("Golden Coast Phase 4 FIFO status failed", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/sp/golden-coast/phase4/cutover-fifo", async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const result = await db.transaction(async (tx) => {
        if (!(await isGoldenCoastCompany(tx, companyId))) {
          throw new GoldenCoastPhase4CutoverError("Golden Coast account setup is not configured");
        }
        const state = await loadSnapshotState(tx, companyId);
        if (state.posted) return { ...state, replayed: true };
        if (!state.canPost || !state.plan) {
          throw new GoldenCoastPhase4CutoverError(state.blockers.join(" ") || "Cutover FIFO is not ready");
        }
        const inserted = [];
        for (const movement of state.plan.movements) {
          const [row] = await tx.insert(spStockMovements).values(movement).returning();
          inserted.push(row);
        }
        return { ...(await loadSnapshotState(tx, companyId)), inserted, replayed: false };
      });
      res.json(result);
    } catch (error) {
      if (error instanceof GoldenCoastPhase4CutoverError) {
        return res.status(409).json({ code: "GC_PHASE4_CUTOVER_BLOCKED", message: error.message });
      }
      logger.error("Golden Coast Phase 4 FIFO cutover failed", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
