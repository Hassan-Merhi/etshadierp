import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import { pool } from "../../../db";
import {
  previewHistoricalCostReplayWithExecutor,
  type HistoricalReplayPreviewResult,
  type ReplayFinancialImpact,
  type ReplayQueryExecutor,
} from "../../../services/factory/historicalCostReplay";

const APPLY_PATH = "/api/factory/raw-stock/recalc/historical-replay/apply";
const PREVIEW_PATH = "/api/factory/raw-stock/recalc/historical-replay";
const ADJUSTMENT_CLASSIFICATION_PATH =
  "/api/factory/raw-stock/recalc/historical-replay/adjustments/:id/valuation-basis";
const ADMIN_ROLES = ["Admin", "Developer"] as const;

function parsePositiveIntegerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => Number(entry));
  if (ids.some((entry) => !Number.isInteger(entry) || entry <= 0)) return null;
  return [...new Set(ids)].sort((left, right) => left - right);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function readCurrentNetPosition(req: any): Promise<number | null> {
  try {
    const host = req.get?.("host");
    if (!host || typeof fetch !== "function") return null;
    const response = await fetch(`${req.protocol || "http"}://${host}/api/factory/net-position`, {
      method: "GET",
      headers: {
        cookie: String(req.headers?.cookie || ""),
        accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { netPosition?: unknown };
    const value = Number(payload.netPosition);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Financial impact remains useful even when the independent Net Position route
    // cannot be reached (for example during isolated tests).
    return null;
  }
}

function scopeFinancialImpact(
  preview: HistoricalReplayPreviewResult,
  supplierIds: number[],
  currentNetPosition: number | null
): ReplayFinancialImpact | undefined {
  const base = preview.financialImpact;
  if (!base) return undefined;

  const selected = new Set(supplierIds);
  const supplierImpacts = base.supplierImpacts.filter((row) => selected.has(row.supplierId));
  const rawMaterialDifference = round2(
    supplierImpacts.reduce((sum, row) => sum + row.valueDifference, 0)
  );
  const projectedRawMaterialAsset = round2(base.currentRawMaterialAsset + rawMaterialDifference);

  return {
    ...base,
    supplierImpacts,
    rawMaterialDifference,
    projectedRawMaterialAsset,
    currentNetPosition,
    projectedNetPosition:
      currentNetPosition == null ? null : round2(currentNetPosition + rawMaterialDifference),
    otherLedgerEffect: 0,
  };
}

/**
 * Final fail-closed V7 guard and preview routes.
 *
 * - GET returns the real safety gates, blocked/unclassified rows and Net Position impact.
 * - Prepare rejects force-apply and finalized-bale writes.
 * - The successful dry-run response is augmented with the exact selected/expanded
 *   supplier financial impact returned by the signed-scope route.
 * - Historical adjustment valuation is explicitly classifiable with an audit row.
 */
export function registerHistoricalReplayPhase6GuardRoutes(app: Express): void {
  app.get(
    PREVIEW_PATH,
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const preview = await previewHistoricalCostReplayWithExecutor(
          pool as ReplayQueryExecutor,
          companyId
        );
        const currentNetPosition = await readCurrentNetPosition(req);
        if (preview.financialImpact) {
          preview.financialImpact.currentNetPosition = currentNetPosition;
          preview.financialImpact.projectedNetPosition =
            currentNetPosition == null
              ? null
              : round2(currentNetPosition + preview.financialImpact.rawMaterialDifference);
          preview.financialImpact.otherLedgerEffect = 0;
        }
        return res.json(preview);
      } catch (error: any) {
        console.error("[historical-replay v7 preview] error:", error);
        return res.status(500).json({
          message: error.message || "Failed to compute Historical Replay preview",
          code: error.code,
        });
      }
    }
  );

  app.patch(
    ADJUSTMENT_CLASSIFICATION_PATH,
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const adjustmentId = Number(req.params.id);
      const valuationBasis = String(req.body?.valuationBasis || "").toUpperCase();
      const allowed = new Set(["QUANTITY_ONLY", "VALUED_TRANSFER", "OPENING_BALANCE"]);
      if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
        return res.status(400).json({ message: "Invalid adjustment id" });
      }
      if (!allowed.has(valuationBasis)) {
        return res.status(400).json({
          message: "valuationBasis must be QUANTITY_ONLY, VALUED_TRANSFER, or OPENING_BALANCE",
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<{
          id: number;
          type: string;
          supplier_id: number | null;
          valuation_basis: string | null;
        }>(
          `SELECT id, type, supplier_id, valuation_basis
           FROM factory_raw_material_adjustments
           WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
           FOR UPDATE`,
          [adjustmentId, companyId]
        );
        const row = locked.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return res.status(404).json({ message: "Adjustment not found" });
        }
        if (String(row.type).toUpperCase() !== "ADD" || row.supplier_id == null) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message: "Only supplier-linked ADD adjustments can be classified for replay.",
          });
        }

        await client.query(
          `UPDATE factory_raw_material_adjustments
           SET valuation_basis = $1
           WHERE id = $2 AND company_id = $3`,
          [valuationBasis, adjustmentId, companyId]
        );
        await client.query(
          `INSERT INTO audit_log
             (user_id, username, company_id, action, table_name, record_id,
              record_identifier, changes, created_at)
           VALUES ($1, $2, $3, 'historical_replay_adjustment_classified',
                   'factory_raw_material_adjustments', $4, $5, $6::jsonb, NOW())`,
          [
            String(req.session.userId ?? ""),
            req.session.username ?? null,
            companyId,
            adjustmentId,
            `raw material adjustment ${adjustmentId} valuation basis`,
            JSON.stringify({
              before: row.valuation_basis,
              after: valuationBasis,
            }),
          ]
        );
        await client.query("COMMIT");
        return res.json({ success: true, adjustmentId, valuationBasis });
      } catch (error: any) {
        await client.query("ROLLBACK");
        return res.status(500).json({
          message: error.message || "Failed to classify adjustment",
          code: error.code,
        });
      } finally {
        client.release();
      }
    }
  );

  app.post(
    APPLY_PATH,
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any, next: any) => {
      const hasToken = typeof req.body?.confirmationToken === "string"
        && req.body.confirmationToken.length > 0;

      if (req.body?.includeFinalizedBales === true) {
        return res.status(409).json({
          message:
            "Finalized/sold bale costs are outside this cost-only migration. Run a separate approved COGS migration if those records must change.",
          code: "HISTORICAL_REPLAY_FINALIZED_BALES_FORBIDDEN",
        });
      }

      if (hasToken) {
        if (req.body?.dryRun === true) {
          return res.status(400).json({
            message: "A confirmation token can only be used for apply. Re-run Prepare without a token.",
            code: "HISTORICAL_REPLAY_CONFLICTING_MODE",
          });
        }
        return next();
      }

      const forceSupplierIds = parsePositiveIntegerIds(req.body?.forceSupplierIds) ?? [];
      if (forceSupplierIds.length > 0) {
        return res.status(409).json({
          message:
            "Historical Replay no longer permits force-applying quantity mismatches. Resolve the timeline first.",
          code: "HISTORICAL_REPLAY_FORCE_APPLY_FORBIDDEN",
        });
      }

      const supplierIds = parsePositiveIntegerIds(req.body?.supplierIds);
      if (!supplierIds || supplierIds.length === 0) {
        return res.status(400).json({
          message: "Select at least one safe supplier before preparing Historical Replay.",
          code: "HISTORICAL_REPLAY_EMPTY_SCOPE",
        });
      }

      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      try {
        const preview = await previewHistoricalCostReplayWithExecutor(
          pool as ReplayQueryExecutor,
          companyId
        );
        const currentNetPosition = await readCurrentNetPosition(req);
        const originalJson = res.json.bind(res);
        res.json = (payload: any) => {
          if (!payload?.dryRun) return originalJson(payload);
          const expandedSupplierIds = parsePositiveIntegerIds(payload.safeSupplierIds) ?? supplierIds;
          const financialImpact = scopeFinancialImpact(
            preview,
            expandedSupplierIds,
            currentNetPosition
          );
          return originalJson({
            ...payload,
            financialImpact,
            unclassifiedAdjustmentRows: preview.unclassifiedAdjustmentRows ?? [],
            blockedBatches: preview.blockedBatches ?? [],
          });
        };
        req.body.supplierIds = supplierIds;
        req.body.forceSupplierIds = [];
        req.body.includeFinalizedBales = false;
        return next();
      } catch (error: any) {
        return res.status(500).json({
          message: error.message || "Failed to validate Historical Replay prepare request",
          code: error.code,
        });
      }
    }
  );
}
