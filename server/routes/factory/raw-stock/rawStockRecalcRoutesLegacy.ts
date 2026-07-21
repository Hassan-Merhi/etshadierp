import type { Express } from "express";
import crypto from "crypto";
import { requireAuth, requireRole } from "../../../auth";
import {
  getRawStockRecalcPreview,
  applyRawStockRecalc,
  loadRecalcFingerprintInputs,
  computeRecalcFingerprint,
  getAffectedMixBatchesPreview,
  getZeroCostMixBatchSourcesPreview,
  getMixBatchSourceCostMismatchPreview,
  applyZeroCostMixBatchSourcesFix,
  getFullAuditScan,
  computeApplyAllDryRun,
} from "../../../services/factory/rawStockRecalc";
import {
  previewHistoricalCostReplay,
  applyHistoricalCostReplay,
  captureReplaySnapshot,
  computeReplayFingerprint,
  buildHistoricalReplayScope,
  REPLAY_ALGORITHM_VERSION,
  StaleTokenError,
} from "../../../services/factory/historicalCostReplay";
import { logAudit } from "../../helpers/auditHelpers";
import { getStableSupplierCost } from "../../../services/factory/rawStockStableCost";
import { db } from "../../../db";
import { factorySuppliers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  signRepairToken,
  verifyRepairToken,
  ExpiredRepairTokenError,
  RepairTokenConfigurationError,
  REPAIR_TOKEN_TTL_MS,
} from "../../../services/factory/repairToken";
import { pool } from "../../../db";

const ADMIN_ROLES = ["Admin", "Developer"] as const;

// ─── Undo log + consumed-token helpers ─────────────────────────────────────────

/**
 * FIX 11: ensureTokenTable removed — the consumed-tokens table is now fully defined
 * in migrations/20260718_factory_replay_consumed_tokens.sql. The migration CREATE TABLE
 * already includes all columns; no ALTER TABLE ADD COLUMN is needed.
 */

/** Ensure the undo log table exists. Called once at route registration. */
async function ensureUndoLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS factory_recalc_undo_log (
      id                   SERIAL PRIMARY KEY,
      company_id           INTEGER      NOT NULL,
      user_id              INTEGER,
      username             TEXT,
      description          TEXT         NOT NULL,
      container_count      INTEGER      NOT NULL DEFAULT 0,
      container_numbers    TEXT[]       NOT NULL DEFAULT '{}',
      snapshot             JSONB        NOT NULL,
      applied_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      undone_at            TIMESTAMPTZ,
      undone_by_user_id    INTEGER,
      undone_by_username   TEXT
    )
  `);
}

/** Capture a point-in-time snapshot of every row that applyRawStockRecalc will touch. */
async function captureRecalcSnapshot(companyId: number, containerIds: number[]) {
  if (containerIds.length === 0) {
    return { containers: [], rawStockRows: [], mixBatchSources: [], mixBatches: [], bales: [], suppliers: [] };
  }

  const [
    { rows: containers },
    { rows: rawStockRows },
    { rows: mixBatchSources },
  ] = await Promise.all([
    pool.query(
      `SELECT id,
              final_payable_amount       AS "finalPayableAmount",
              rate_per_kg_usd            AS "ratePerKgUsd",
              final_payable_amount_usd   AS "finalPayableAmountUsd"
       FROM factory_containers
       WHERE id = ANY($1) AND company_id = $2`,
      [containerIds, companyId]
    ),
    pool.query(
      `SELECT id,
              cost_per_kg     AS "costPerKg",
              cost_per_kg_usd AS "costPerKgUsd"
       FROM factory_raw_stock
       WHERE container_id = ANY($1) AND company_id = $2 AND deleted_at IS NULL`,
      [containerIds, companyId]
    ),
    // Snapshot ALL sources (open + completed) so the undo is always complete
    pool.query(
      `SELECT mbs.id,
              mbs.mix_batch_id AS "mixBatchId",
              mbs.cost_per_kg  AS "costPerKg",
              mbs.total_cost   AS "totalCost"
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mbs.mix_batch_id = mb.id
       WHERE mbs.container_id = ANY($1) AND mb.company_id = $2 AND mb.deleted_at IS NULL`,
      [containerIds, companyId]
    ),
  ]);

  const batchIds = [...new Set(mixBatchSources.map((s: any) => s.mixBatchId as number))];

  let mixBatches: any[] = [];
  let bales: any[] = [];
  if (batchIds.length > 0) {
    const [{ rows: batchRows }, { rows: baleRows }] = await Promise.all([
      pool.query(
        `SELECT id, cost_per_kg AS "costPerKg", total_cost AS "totalCost"
         FROM factory_mix_batches WHERE id = ANY($1)`,
        [batchIds]
      ),
      pool.query(
        `SELECT id, cost_per_kg AS "costPerKg", total_cost AS "totalCost"
         FROM factory_bales
         WHERE mix_batch_id = ANY($1) AND company_id = $2 AND status NOT IN ('DELETED','REMOVED')`,
        [batchIds, companyId]
      ),
    ]);
    mixBatches = batchRows;
    bales = baleRows;
  }

  // Supplier locked rates
  const { rows: supplierRows } = await pool.query(
    `SELECT DISTINCT ON (fs.id)
            fs.id,
            fs.current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd"
     FROM factory_suppliers fs
     JOIN factory_containers fc ON fc.supplier_id = fs.id
     WHERE fc.id = ANY($1) AND fc.company_id = $2 AND fs.company_id = $2`,
    [containerIds, companyId]
  );

  return { containers, rawStockRows, mixBatchSources, mixBatches, bales, suppliers: supplierRows };
}

interface RecalcTokenPayload {
  companyId: number;
  containerIds: number[];
  /** Deterministic fingerprint of EVERY approved calculation input per
   * container (see computeRecalcFingerprint) — container status/updatedAt,
   * received kg, rate, currency, FX rate/confirmed state, freight, duty,
   * commission, other charges, every additional-charge row, and the current
   * vs. expected cost. Re-derived from a fresh, row-locked read inside the
   * apply transaction and rejected as STALE_TOKEN on any mismatch. */
  fingerprintByContainer: Record<number, string>;
  userId: string;
  expiresAt: number;
  /** Bound into the token so a confirm request can never silently expand scope
   * beyond what the admin saw and approved at dry-run time. */
  includeCompletedBatches: boolean;
  /** Whether to allow CLOSED/COMPLETED containers — bound in token so scope can't expand at confirm. */
  includeHistoricalContainers: boolean;
}

interface ApplyAllSafeTokenPayload {
  companyId: number;
  safeContainerIds: number[];
  userId: string;
  expiresAt: number;
  includeHistoricalContainers: boolean;
  includeCompletedBatches: boolean;
}

interface ZeroCostSourceTokenPayload {
  companyId: number;
  sourceIds: number[];
  manualRates: Record<number, number>;
  userId: string;
  expiresAt: number;
}

export function registerRawStockRecalcRoutes(app: Express) {
  // Ensure the undo log table exists (idempotent, runs once at startup).
  ensureUndoLogTable().catch((err) => console.error("[recalc] Failed to create undo log table:", err));
  // FIX 11: ensureTokenTable removed — consumed-tokens table DDL lives in migration
  // 20260718_factory_replay_consumed_tokens.sql; no startup DDL needed here.

  // Read-only diff preview — never writes anything. Admin/Developer-only: this
  // surfaces exact stored vs. corrected landed-cost figures for every container.
  app.get(
    "/api/factory/raw-stock/recalc/preview",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const rows = await getRawStockRecalcPreview(companyId);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc preview] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute recalculation preview" });
      }
    }
  );

  // Read-only preview of every mix batch (and bale count) that would be touched
  // by applying the given containers' corrected cost — the same batch-selection
  // and weighted-average math cascadeContainerCostChange uses, but never writes
  // anything. Lets the admin see the downstream blast radius before clicking Apply.
  app.post(
    "/api/factory/raw-stock/recalc/mix-batches-preview",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { containerIds, includeCompletedBatches } = req.body;
        if (!Array.isArray(containerIds) || containerIds.length === 0) {
          return res.json([]);
        }
        const parsedIds = containerIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        const rows = await getAffectedMixBatchesPreview(companyId, parsedIds, includeCompletedBatches === true);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc mix-batches-preview] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute affected mix batches preview" });
      }
    }
  );

  // Apply the corrected cost for the containers the admin approved, cascading to
  // mix batches/bales. Admin/Developer-only, dry-run by default (returns a signed,
  // expiring confirmationToken bound to companyId/containerIds/their old costs/the
  // requesting user); the actual write only happens when the caller re-submits with
  // { confirm: true, confirmationToken } and the token still matches the containers'
  // CURRENT stored cost (rejecting a stale token if anything changed since preview).
  // Refuses CLOSED/COMPLETED containers (reported, not silently skipped). Each
  // container is applied in its own transaction with a row lock, and its audit-log
  // entry is written atomically with it — see rawStockRecalc.ts.
  app.post(
    "/api/factory/raw-stock/recalc/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { containerIds, confirm, confirmationToken, includeCompletedBatches, includeHistoricalContainers } = req.body;
        const wantsCompletedBatches = includeCompletedBatches === true;
        const wantsHistorical = includeHistoricalContainers === true;
        if (!Array.isArray(containerIds) || containerIds.length === 0) {
          return res.status(400).json({ message: "containerIds must be a non-empty array" });
        }
        const parsedIds = containerIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
          .sort((a: number, b: number) => a - b);
        if (parsedIds.length === 0) {
          return res.status(400).json({ message: "containerIds must contain at least one valid id" });
        }

        const preview = await getRawStockRecalcPreview(companyId);
        const previewByContainer = new Map(preview.map((r) => [r.containerId, r]));

        if (!confirm) {
          // Fingerprint EVERY approved calculation input per container (not just its
          // old cost) so the token is bound to the exact calculation the admin saw,
          // not merely the numeric outcome.
          const fingerprintByContainer: Record<number, string> = {};
          for (const id of parsedIds) {
            const inputs = await loadRecalcFingerprintInputs(companyId, id);
            if (inputs) fingerprintByContainer[id] = computeRecalcFingerprint(inputs);
          }
          const tokenPayload: RecalcTokenPayload = {
            companyId,
            containerIds: parsedIds,
            fingerprintByContainer,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
            includeCompletedBatches: wantsCompletedBatches,
            includeHistoricalContainers: wantsHistorical,
          };
          const token = signRepairToken(tokenPayload);
          return res.json({
            dryRun: true,
            rows: parsedIds.map((id: number) => previewByContainer.get(id)).filter(Boolean),
            confirmationToken: token,
          });
        }

        let tokenPayload: RecalcTokenPayload;
        try {
          tokenPayload = verifyRepairToken<RecalcTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "TOKEN_EXPIRED", message: err.message });
          }
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        const sameIds =
          tokenPayload.containerIds.length === parsedIds.length &&
          tokenPayload.containerIds.every((id, i) => id === parsedIds[i]);
        if (
          tokenPayload.companyId !== companyId ||
          !sameIds ||
          tokenPayload.userId !== req.session.userId ||
          tokenPayload.includeCompletedBatches !== wantsCompletedBatches ||
          (tokenPayload.includeHistoricalContainers ?? false) !== wantsHistorical
        ) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        // The authoritative stale check is inside applyRawStockRecalc's row-locked
        // transaction (fingerprint recomputed from a fresh read there), so any change
        // that lands after this point but before that lock is still caught. This is a
        // cheap early-exit for the common case — no EPS tolerance; 6dp exact match.
        //
        // Skip the fingerprint check for containers already correct (changed === false):
        // idempotent replay of a token whose cost was applied in a prior call should
        // reach the service-layer no-op path rather than hitting STALE_TOKEN here.
        const freshPreview = await getRawStockRecalcPreview(companyId);
        const freshPreviewByContainer = new Map(freshPreview.map((r) => [r.containerId, r]));
        for (const id of parsedIds) {
          const freshRow = freshPreviewByContainer.get(id);
          if (freshRow && freshRow.changed === false) continue; // already correct — let service handle idempotency
          const inputs = await loadRecalcFingerprintInputs(companyId, id);
          const freshFingerprint = inputs ? computeRecalcFingerprint(inputs) : undefined;
          const tokenFingerprint = tokenPayload.fingerprintByContainer[id];
          if (tokenFingerprint && freshFingerprint && freshFingerprint !== tokenFingerprint) {
            return res.status(400).json({
              code: "STALE_TOKEN",
              message: `Container #${id} changed since the dry-run preview was issued — re-run the preview and try again.`,
            });
          }
        }

        // Capture before-state snapshot (must happen before any writes)
        const snapshot = await captureRecalcSnapshot(companyId, parsedIds);

        const results = await applyRawStockRecalc(companyId, parsedIds, {
          expectedFingerprints: tokenPayload.fingerprintByContainer,
          includeCompletedBatches: wantsCompletedBatches,
          includeHistoricalContainers: wantsHistorical,
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_raw_stock",
                recordId: result.containerId,
                recordIdentifier: `recalc/apply — container ${result.containerNumber}`,
                changes: { result: { new: { ...result, includeCompletedBatches: wantsCompletedBatches } } },
              },
              tx
            );
          },
        });

        const staleResult = results.find((r) => r.staleToken);
        if (staleResult) {
          return res.status(400).json({
            code: "STALE_TOKEN",
            message: `Container #${staleResult.containerId} changed since the dry-run preview was issued — re-run the preview and try again.`,
          });
        }

        // Persist undo snapshot (non-fatal if it fails — apply already committed)
        const appliedContainerNumbers = (snapshot.containers as any[]).map((c: any) => String(c.finalPayableAmount !== undefined ? c.id : c.id));
        const containerNumbersForDescription = results.filter((r) => r.applied).map((r) => r.containerNumber);
        try {
          await pool.query(
            `INSERT INTO factory_recalc_undo_log
               (company_id, user_id, username, description, container_count, container_numbers, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              companyId,
              req.session.userId ?? null,
              req.session.username ?? null,
              `Applied cost recalc to ${results.filter((r) => r.applied).length} container(s)`,
              parsedIds.length,
              containerNumbersForDescription,
              JSON.stringify(snapshot),
            ]
          );
        } catch (undoErr) {
          console.error("[recalc] Failed to save undo snapshot:", undoErr);
        }

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error (SESSION_SECRET missing/fallback in production):", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply recalculation" });
      }
    }
  );

  // Read-only scan for mix-batch-source rows recorded with cost 0 despite real
  // weight — a different bug from the container-level drift above: the parent
  // container's own cost can already be correct (so it never shows up as a
  // "changed" row and is never selectable there), yet its downstream batches
  // are still dragged toward zero. Independent of container selection.
  app.get(
    "/api/factory/raw-stock/recalc/zero-cost-sources",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const rows = await getZeroCostMixBatchSourcesPreview(companyId);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc zero-cost-sources] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute zero-cost mix-batch-source preview" });
      }
    }
  );

  // Apply the fix for the zero-cost mix-batch-source rows the admin approved.
  // Same dry-run → signed confirmationToken → confirm flow as recalc/apply
  // above. manualRates only ever applies to sources with no container link
  // (the service layer refuses to let a manual rate override a container-linked
  // source that already has a real cost on file).
  app.post(
    "/api/factory/raw-stock/recalc/zero-cost-sources/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { sourceIds, manualRates, confirm, confirmationToken } = req.body;
        if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
          return res.status(400).json({ message: "sourceIds must be a non-empty array" });
        }
        const parsedIds = sourceIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
          .sort((a: number, b: number) => a - b);
        if (parsedIds.length === 0) {
          return res.status(400).json({ message: "sourceIds must contain at least one valid id" });
        }
        const parsedManualRates: Record<number, number> = {};
        if (manualRates && typeof manualRates === "object") {
          for (const [key, value] of Object.entries(manualRates)) {
            const id = parseInt(key);
            const rate = parseFloat(value as any);
            if (!isNaN(id) && !isNaN(rate) && rate > 0) parsedManualRates[id] = rate;
          }
        }

        if (!confirm) {
          const preview = await getZeroCostMixBatchSourcesPreview(companyId);
          const previewById = new Map(preview.map((r) => [r.sourceId, r]));
          const tokenPayload: ZeroCostSourceTokenPayload = {
            companyId,
            sourceIds: parsedIds,
            manualRates: parsedManualRates,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
          };
          const token = signRepairToken(tokenPayload);
          return res.json({
            dryRun: true,
            rows: parsedIds.map((id: number) => previewById.get(id)).filter(Boolean),
            confirmationToken: token,
          });
        }

        let tokenPayload: ZeroCostSourceTokenPayload;
        try {
          tokenPayload = verifyRepairToken<ZeroCostSourceTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "TOKEN_EXPIRED", message: err.message });
          }
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact request — re-run the dry-run preview first.",
          });
        }

        const sameIds =
          tokenPayload.sourceIds.length === parsedIds.length &&
          tokenPayload.sourceIds.every((id, i) => id === parsedIds[i]);
        const sameRates = JSON.stringify(tokenPayload.manualRates) === JSON.stringify(parsedManualRates);
        if (tokenPayload.companyId !== companyId || !sameIds || !sameRates || tokenPayload.userId !== req.session.userId) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact request — re-run the dry-run preview first.",
          });
        }

        const results = await applyZeroCostMixBatchSourcesFix(companyId, parsedIds, {
          manualRates: parsedManualRates,
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_mix_batch_sources",
                recordId: result.sourceId,
                recordIdentifier: `zero-cost-source/apply — batch ${result.batchCode}`,
                changes: { result: { new: result } },
              },
              tx
            );
          },
        });

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error (SESSION_SECRET missing/fallback in production):", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc zero-cost-sources apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply zero-cost source fix" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Auto-apply FX rates from factory_fx_rates for UNRESOLVED_FX containers
  // POST /api/factory/raw-stock/recalc/auto-apply-fx
  // Body: { containerIds: number[] }
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/recalc/auto-apply-fx",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { containerIds } = req.body as { containerIds: number[] };
      if (!Array.isArray(containerIds) || containerIds.length === 0)
        return res.status(400).json({ message: "containerIds must be a non-empty array" });

      try {
        const cRows = await pool.query<{
          id: number; container_number: string; currency_code: string;
          fx_rate_date_import: string | null;
          fx_rate_confirmed: boolean;
          freight_fx_rate_confirmed: boolean;
          commission_fx_rate_confirmed: boolean;
        }>(
          `SELECT id, container_number, currency_code,
                  fx_rate_date_import, fx_rate_confirmed,
                  freight_fx_rate_confirmed, commission_fx_rate_confirmed
           FROM factory_containers
           WHERE id = ANY($1) AND company_id = $2 AND deleted_at IS NULL`,
          [containerIds, companyId]
        );

        const results: { containerNumber: string; rate: number | null; applied: boolean; reason?: string }[] = [];

        for (const c of cRows.rows) {
          if (c.currency_code === "USD") {
            results.push({ containerNumber: c.container_number, rate: null, applied: false, reason: "USD container — no FX needed" });
            continue;
          }

          // Best rate: most recent on/before import date, manual preferred over auto
          const refDate = c.fx_rate_date_import ?? new Date().toISOString().slice(0, 10);
          const rateRow = await pool.query<{ rate_to_usd: number; effective_date: string; source: string }>(
            `SELECT rate_to_usd, effective_date, source
             FROM factory_fx_rates
             WHERE company_id = $1 AND currency_code = $2 AND effective_date <= $3
             ORDER BY (source = 'manual') DESC, effective_date DESC
             LIMIT 1`,
            [companyId, c.currency_code, refDate]
          );

          if (rateRow.rows.length === 0) {
            results.push({ containerNumber: c.container_number, rate: null, applied: false, reason: `No ${c.currency_code} rate on file on or before ${refDate}` });
            continue;
          }

          const rate = Number(rateRow.rows[0].rate_to_usd);

          const updates: Record<string, unknown> = {
            fx_rate_to_usd: rate,
            fx_rate_confirmed: true,
          };
          if (!c.freight_fx_rate_confirmed) {
            updates.freight_fx_rate_to_usd = rate;
            updates.freight_fx_rate_confirmed = true;
          }
          if (!c.commission_fx_rate_confirmed) {
            updates.commission_fx_rate_to_usd = rate;
            updates.commission_fx_rate_confirmed = true;
          }

          const setClauses = Object.keys(updates).map((k, i) => `${k} = ${i + 2}`).join(", ");
          await pool.query(
            `UPDATE factory_containers SET ${setClauses} WHERE id = $1`,
            [c.id, ...Object.values(updates)]
          );

          await logAudit(req, {
            action: "AUTO_APPLY_FX_RATE",
            entityType: "factory_container",
            entityId: c.id,
            changes: { new: { rate, source: rateRow.rows[0].source, effectiveDate: rateRow.rows[0].effective_date } },
          });

          results.push({ containerNumber: c.container_number, rate, applied: true });
        }

        res.json({ results, applied: results.filter((r) => r.applied).length });
      } catch (err: any) {
        console.error("[recalc auto-apply-fx] error:", err);
        res.status(500).json({ message: err.message || "Failed to auto-apply FX rates" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Full audit scan — all containers, all layers, all issue codes
  // GET /api/factory/raw-stock/recalc/full-audit
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/full-audit",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getFullAuditScan(companyId);
        res.json(result);
      } catch (err: any) {
        console.error("[raw-stock recalc full-audit] error:", err);
        res.status(500).json({ message: err.message || "Failed to run full audit scan" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Source cost mismatches — full scan (not just zero-cost)
  // GET /api/factory/raw-stock/recalc/source-cost-mismatches
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/source-cost-mismatches",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getMixBatchSourceCostMismatchPreview(companyId);
        res.json(result);
      } catch (err: any) {
        console.error("[raw-stock recalc source-cost-mismatches] error:", err);
        res.status(500).json({ message: err.message || "Failed to scan source cost mismatches" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Retroactive supplier locked-rate recompute (admin-only)
  // POST /api/factory/raw-stock/supplier-rate/recompute
  // Body: { supplierId?: number, dryRun?: boolean }
  //   supplierId — omit to process ALL suppliers for this company
  //   dryRun     — when true, runs the full computation but skips writes; returns
  //                the same results array with dryRun: true so the UI can show a
  //                preview before the user explicitly confirms.
  //
  // Recalculates current_raw_material_cost_per_kg_usd using the receipt-weighted
  // stable cost across all factory_raw_stock rows (which must already carry the
  // correct cost_per_kg_usd from a prior recalc apply). Skips suppliers whose
  // stable cost is 0 (no raw-stock rows). Use after a recalc that ran while all
  // containers were fully used and the cascade skipped the locked-rate update.
  //
  // WARNING: this uses the all-time receipt-weighted average, which differs from
  // the moving-average formula used during real offloads. Use with care — prefer
  // "Restore from Audit Log" when recovering from an accidental recompute.
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/supplier-rate/recompute",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { supplierId, dryRun } = req.body;
      const isDryRun = dryRun === true;

      // DEFECT 13 FIX: The non-dryRun apply path is deprecated. Use Historical Replay.
      if (!isDryRun) {
        res.setHeader(
          "X-Deprecated",
          "This endpoint computes the all-time receipt-weighted stable average, not the timeline moving average. Prefer Historical Replay."
        );
        return res.status(410).json({
          message: "Applying supplier rate recompute is deprecated. Use the Historical Cost Replay tool instead. It uses the timeline moving-average rather than the all-time receipt-weighted average.",
          code: "USE_HISTORICAL_REPLAY",
        });
      }

      // FIX 6: Deprecation warning — this endpoint uses the all-time receipt-weighted
      // average, NOT the timeline moving-average. It can overwrite a correctly-computed
      // rate with a different value, making Historical Replay inconsistent. Prefer
      // "Historical Replay" (POST /recalc/historical-replay/apply) for any cost
      // correction. Only use this endpoint when restoring from an audit-log entry.
      res.setHeader(
        "X-Deprecated",
        "This endpoint computes the all-time receipt-weighted stable average, not the timeline moving average. Prefer Historical Replay."
      );

      try {
        // Resolve the list of supplier IDs to process
        let supplierIds: number[];
        if (supplierId != null) {
          const sid = parseInt(supplierId);
          if (isNaN(sid)) return res.status(400).json({ message: "Invalid supplierId" });
          supplierIds = [sid];
        } else {
          // Recompute all suppliers for this company
          const allSuppliers = await db
            .select({ id: factorySuppliers.id, name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(eq(factorySuppliers.companyId, companyId));
          supplierIds = allSuppliers.map((s) => s.id);
        }

        const results: Array<{
          supplierId: number;
          supplierName: string;
          oldRate: number;
          newRate: number;
          rowCount: number;
          totalReceivedKg: number;
          skipped?: string;
        }> = [];

        for (const sid of supplierIds) {
          const [existing] = await db
            .select({ currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd, name: factorySuppliers.name })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, sid), eq(factorySuppliers.companyId, companyId)));
          if (!existing) continue;

          const oldRate = parseFloat(existing.currentRawMaterialCostPerKgUsd as string || "0");
          const supplierName = existing.name || `Supplier #${sid}`;
          const { costPerKgUsd, totalReceivedKg, rows } = await db.transaction(async (tx: any) => {
            return getStableSupplierCost(tx, companyId, sid);
          });

          if (costPerKgUsd <= 0) {
            results.push({ supplierId: sid, supplierName, oldRate, newRate: 0, rowCount: 0, totalReceivedKg: 0, skipped: "No usable raw-stock rows" });
            continue;
          }
          if (Math.abs(costPerKgUsd - oldRate) < 0.000001) {
            results.push({ supplierId: sid, supplierName, oldRate, newRate: costPerKgUsd, rowCount: rows.length, totalReceivedKg, skipped: "Already correct" });
            continue;
          }

          if (!isDryRun) {
            await db
              .update(factorySuppliers)
              .set({ currentRawMaterialCostPerKgUsd: String(costPerKgUsd), updatedAt: new Date() })
              .where(and(eq(factorySuppliers.id, sid), eq(factorySuppliers.companyId, companyId)));

            await logAudit({
              userId: req.session.userId,
              username: req.session.username || req.session.userId,
              companyId,
              action: "update",
              tableName: "factory_suppliers",
              recordId: sid,
              recordIdentifier: `supplier-rate/recompute — stable avg from ${rows.length} rows, totalReceived ${totalReceivedKg}kg`,
              changes: { old: { currentRawMaterialCostPerKgUsd: oldRate }, new: { currentRawMaterialCostPerKgUsd: costPerKgUsd } },
            });
          }
          results.push({ supplierId: sid, supplierName, oldRate, newRate: costPerKgUsd, rowCount: rows.length, totalReceivedKg });
        }

        res.json({
          dryRun: isDryRun,
          updated: isDryRun ? 0 : results.filter((r) => !r.skipped).length,
          wouldUpdate: results.filter((r) => !r.skipped).length,
          skipped: results.filter((r) => !!r.skipped).length,
          results,
        });
      } catch (err: any) {
        console.error("[supplier-rate/recompute] error:", err);
        res.status(500).json({ message: err.message || "Failed to recompute supplier rate" });
      }
    }
  );

  // Read audit log for past supplier-rate/recompute events
  // GET /api/factory/raw-stock/supplier-rate/recompute-audit
  // Returns one row per supplier (most recent recompute event), with the old rate
  // that was overwritten so the user can restore it via restore-from-audit.
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/supplier-rate/recompute-audit",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      try {
        // DISTINCT ON keeps the most-recent recompute event per supplier
        const result = await pool.query(
          `SELECT DISTINCT ON (al.record_id)
             al.record_id       AS supplier_id,
             al.record_identifier,
             al.created_at      AS overwritten_at,
             al.username        AS changed_by,
             al.changes,
             fs.name            AS supplier_name,
             fs.current_raw_material_cost_per_kg_usd AS current_rate
           FROM audit_log al
           JOIN factory_suppliers fs
             ON fs.id = al.record_id
            AND fs.company_id = $1
           WHERE al.table_name = 'factory_suppliers'
             AND al.record_identifier LIKE 'supplier-rate/recompute%'
             AND al.company_id = $1
           ORDER BY al.record_id, al.created_at DESC`,
          [companyId]
        );

        const rows = result.rows.map((r: any) => {
          const changes = typeof r.changes === "string" ? JSON.parse(r.changes) : (r.changes ?? {});
          const oldRate = parseFloat(changes?.old?.currentRawMaterialCostPerKgUsd ?? 0) || 0;
          const recomputedRate = parseFloat(changes?.new?.currentRawMaterialCostPerKgUsd ?? 0) || 0;
          const currentRate = parseFloat(r.current_rate ?? 0) || 0;
          // canRestore: true only when the current rate still matches what the recompute wrote
          // (i.e. nothing else has overwritten it since)
          const canRestore = oldRate > 0 && Math.abs(currentRate - recomputedRate) < 0.000001;
          return {
            supplierId: Number(r.supplier_id),
            supplierName: r.supplier_name ?? `Supplier #${r.supplier_id}`,
            oldRate,
            recomputedRate,
            currentRate,
            overwroteAt: r.overwritten_at,
            changedBy: r.changed_by,
            canRestore,
          };
        });

        res.json(rows);
      } catch (err: any) {
        console.error("[supplier-rate/recompute-audit] error:", err);
        res.status(500).json({ message: err.message || "Failed to fetch recompute audit" });
      }
    }
  );

  // Restore supplier locked rates to the values recorded in the audit log
  // POST /api/factory/raw-stock/supplier-rate/restore-from-audit
  // Body: { restorations: [{ supplierId: number, rate: number }] }
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/supplier-rate/restore-from-audit",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { restorations } = req.body;
      if (!Array.isArray(restorations) || restorations.length === 0) {
        return res.status(400).json({ message: "restorations must be a non-empty array" });
      }

      try {
        const results: Array<{
          supplierId: number;
          supplierName: string;
          oldRate: number;
          restoredRate: number;
          status: "restored" | "error";
          reason?: string;
        }> = [];

        for (const entry of restorations) {
          const sid = parseInt(entry.supplierId);
          const rateNum = parseFloat(entry.rate);
          if (isNaN(sid) || isNaN(rateNum) || rateNum <= 0) {
            results.push({ supplierId: sid || 0, supplierName: "", oldRate: 0, restoredRate: rateNum || 0, status: "error", reason: "Invalid supplierId or rate" });
            continue;
          }

          const [existing] = await db
            .select({
              id: factorySuppliers.id,
              name: factorySuppliers.name,
              currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd,
            })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, sid), eq(factorySuppliers.companyId, companyId)));

          if (!existing) {
            results.push({ supplierId: sid, supplierName: "", oldRate: 0, restoredRate: rateNum, status: "error", reason: "Supplier not found in this company" });
            continue;
          }

          const oldRate = parseFloat(existing.currentRawMaterialCostPerKgUsd as string || "0");

          await db
            .update(factorySuppliers)
            .set({ currentRawMaterialCostPerKgUsd: String(rateNum), updatedAt: new Date() })
            .where(and(eq(factorySuppliers.id, sid), eq(factorySuppliers.companyId, companyId)));

          await logAudit({
            userId: req.session.userId,
            username: req.session.username || req.session.userId,
            companyId,
            action: "update",
            tableName: "factory_suppliers",
            recordId: sid,
            recordIdentifier: `supplier-rate/restore-from-audit — reverted to pre-recompute moving-average rate`,
            changes: { old: { currentRawMaterialCostPerKgUsd: oldRate }, new: { currentRawMaterialCostPerKgUsd: rateNum } },
          });

          results.push({
            supplierId: sid,
            supplierName: existing.name || `Supplier #${sid}`,
            oldRate,
            restoredRate: rateNum,
            status: "restored",
          });
        }

        res.json({
          restored: results.filter((r) => r.status === "restored").length,
          errors: results.filter((r) => r.status === "error").length,
          results,
        });
      } catch (err: any) {
        console.error("[supplier-rate/restore-from-audit] error:", err);
        res.status(500).json({ message: err.message || "Failed to restore supplier rates" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Apply all fixable source cost mismatches — no dry-run/token required
  // POST /api/factory/raw-stock/recalc/fix-source-mismatches
  //
  // Scans all mix_batch_source rows for cost mismatches against their
  // container's authoritative corrected rate, and applies fixes for all
  // "fixable" ones in a single pass. Safe to call after a recalc apply that
  // excluded completed batches — it will bring their source costs up to date
  // without cascading batch totals or bale costs.
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/recalc/fix-source-mismatches",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      // DEFECT 13 FIX: Supplier-priced source rows must be corrected through Historical
      // Replay (timeline-based rates), not this endpoint (container rate). Route 410.
      return res.status(410).json({
        message: "This endpoint is deprecated. Use the Historical Cost Replay tool to fix all source cost mismatches.",
        code: "USE_HISTORICAL_REPLAY",
      });
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Apply all safe repairs — dry-run → token → confirm
  // POST /api/factory/raw-stock/recalc/apply-all-safe
  // Body (dry-run): { includeHistoricalContainers?, includeCompletedBatches? }
  // Body (confirm): { confirm: true, confirmationToken: "...", ... same flags }
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/recalc/apply-all-safe",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { confirm, confirmationToken, includeHistoricalContainers, includeCompletedBatches } = req.body;
      const wantsHistorical = includeHistoricalContainers === true;
      const wantsCompletedBatches = includeCompletedBatches === true;

      try {
        if (!confirm) {
          // ── Dry-run: identify all safe containers, build token ──────────
          const dryRun = await computeApplyAllDryRun(companyId, { includeHistoricalContainers: wantsHistorical });

          // DEFECT 12 FIX: Guard against applying to SUPPLIER_LOCKED_RATE sources via
          // apply-all-safe. Filter those containers OUT of the safe set rather than
          // blocking the entire operation — the remaining containers can still be fixed.
          if (dryRun.safeContainerIds.length > 0) {
            const { rows: supplierLinkedRows } = await pool.query<{ container_id: number }>(
              `SELECT DISTINCT mbs.container_id
               FROM factory_mix_batch_sources mbs
               JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
               WHERE mbs.container_id = ANY($1)
                 AND mb.company_id = $2
                 AND mbs.supplier_id IS NOT NULL AND mbs.source_batch_id IS NULL`,
              [dryRun.safeContainerIds, companyId]
            );
            if (supplierLinkedRows.length > 0) {
              const excludedIds = new Set(supplierLinkedRows.map((r) => r.container_id));
              dryRun.safeContainerIds = dryRun.safeContainerIds.filter((id) => !excludedIds.has(id));
            }
          }
          if (dryRun.safeContainerIds.length === 0) {
            return res.json({ dryRun: true, safeCount: 0, confirmationToken: null, summary: dryRun });
          }

          // Build per-container fingerprints so we can reject stale tokens at confirm
          const fingerprintByContainer: Record<number, string> = {};
          for (const cid of dryRun.safeContainerIds) {
            const inputs = await loadRecalcFingerprintInputs(companyId, cid);
            if (inputs) fingerprintByContainer[cid] = computeRecalcFingerprint(inputs);
          }

          const tokenPayload: ApplyAllSafeTokenPayload = {
            companyId,
            safeContainerIds: dryRun.safeContainerIds,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
            includeHistoricalContainers: wantsHistorical,
            includeCompletedBatches: wantsCompletedBatches,
          };

          const token = signRepairToken(tokenPayload);
          return res.json({ dryRun: true, summary: dryRun, confirmationToken: token });
        }

        // ── Confirm: verify token, check staleness, apply ─────────────────
        if (!confirmationToken || typeof confirmationToken !== "string") {
          return res.status(400).json({ code: "MISSING_TOKEN", message: "confirmationToken is required for confirm=true" });
        }

        let tokenPayload: ApplyAllSafeTokenPayload;
        try {
          tokenPayload = verifyRepairToken<ApplyAllSafeTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "EXPIRED_TOKEN", message: "Dry-run preview has expired — please re-run it." });
          }
          return res.status(400).json({ code: "INVALID_TOKEN", message: err.message });
        }

        if (
          tokenPayload.companyId !== companyId ||
          tokenPayload.userId !== req.session.userId ||
          (tokenPayload.includeHistoricalContainers ?? false) !== wantsHistorical ||
          (tokenPayload.includeCompletedBatches ?? false) !== wantsCompletedBatches
        ) {
          return res.status(400).json({ code: "INVALID_TOKEN", message: "Token does not match this request — re-run the dry-run." });
        }

        const { safeContainerIds } = tokenPayload;

        // Capture before-state snapshot (must happen before any writes)
        const snapshot = await captureRecalcSnapshot(companyId, safeContainerIds);

        const results = await applyRawStockRecalc(companyId, safeContainerIds, {
          includeCompletedBatches: wantsCompletedBatches,
          includeHistoricalContainers: wantsHistorical,
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_raw_stock",
                recordId: result.containerId,
                recordIdentifier: `recalc/apply-all-safe — container ${result.containerNumber}`,
                changes: { result: { new: { ...result, includeHistoricalContainers: wantsHistorical } } },
              },
              tx
            );
          },
        });

        const staleResult = results.find((r) => r.staleToken);
        if (staleResult) {
          return res.status(400).json({
            code: "STALE_TOKEN",
            message: `Container #${staleResult.containerId} changed since the dry-run — re-run.`,
          });
        }

        // Persist undo snapshot (non-fatal if it fails)
        const containerNumbersForDescription = results.filter((r) => r.applied).map((r) => r.containerNumber);
        try {
          await pool.query(
            `INSERT INTO factory_recalc_undo_log
               (company_id, user_id, username, description, container_count, container_numbers, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              companyId,
              req.session.userId ?? null,
              req.session.username ?? null,
              `Applied all-safe cost recalc to ${results.filter((r) => r.applied).length} container(s)`,
              safeContainerIds.length,
              containerNumbersForDescription,
              JSON.stringify(snapshot),
            ]
          );
        } catch (undoErr) {
          console.error("[recalc] Failed to save undo snapshot:", undoErr);
        }

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error:", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc apply-all-safe] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply all safe repairs" });
      }
    }
  );

  // ── Undo log — list recent applies ─────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/undo-log",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { rows } = await pool.query(
          `SELECT id, company_id AS "companyId", user_id AS "userId", username,
                  description, container_count AS "containerCount",
                  container_numbers AS "containerNumbers",
                  applied_at AS "appliedAt",
                  undone_at AS "undoneAt",
                  undone_by_user_id AS "undoneByUserId",
                  undone_by_username AS "undoneByUsername"
           FROM factory_recalc_undo_log
           WHERE company_id = $1
           ORDER BY applied_at DESC
           LIMIT 30`,
          [companyId]
        );
        res.json(rows);
      } catch (err: any) {
        console.error("[recalc undo-log] error:", err);
        res.status(500).json({ message: err.message || "Failed to load undo log" });
      }
    }
  );

  // ── Undo — restore a previous apply from its snapshot ──────────────────────
  app.post(
    "/api/factory/raw-stock/recalc/undo",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const { undoLogId } = req.body;
        if (!undoLogId || isNaN(parseInt(undoLogId))) {
          return res.status(400).json({ message: "undoLogId is required" });
        }

        // Load the snapshot row
        const { rows } = await pool.query(
          `SELECT * FROM factory_recalc_undo_log WHERE id = $1 AND company_id = $2`,
          [parseInt(undoLogId), companyId]
        );
        const logRow = rows[0];
        if (!logRow) return res.status(404).json({ message: "Undo log entry not found" });
        if (logRow.undone_at) {
          return res.status(400).json({ message: "This recalculation has already been undone." });
        }

        const snapshot = logRow.snapshot as {
          containers: Array<{ id: number; finalPayableAmount: string; ratePerKgUsd: string; finalPayableAmountUsd: string }>;
          rawStockRows: Array<{ id: number; costPerKg: string; costPerKgUsd: string }>;
          mixBatchSources: Array<{ id: number; costPerKg: string; totalCost: string }>;
          mixBatches: Array<{ id: number; costPerKg: string; totalCost: string }>;
          bales: Array<{ id: number; costPerKg: string; totalCost: string }>;
          suppliers: Array<{ id: number; currentRawMaterialCostPerKgUsd: string }>;
        };

        // DEFECT 5 FIX: Apply the undo in a single atomic transaction with
        // advisory lock + row-level FOR UPDATE to prevent concurrent double-undo.
        // The mark-as-undone is now inside the same transaction as the restore writes.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SELECT pg_advisory_xact_lock(9003, $1)`, [companyId]);

          // Re-verify inside the lock to prevent TOCTOU double-undo.
          const { rows: lockedRows } = await client.query(
            `SELECT id, undone_at, snapshot FROM factory_recalc_undo_log
             WHERE id = $1 AND company_id = $2 FOR UPDATE`,
            [parseInt(undoLogId), companyId]
          );
          if (!lockedRows[0]) throw Object.assign(new Error("Undo log entry not found"), { undoStatus: 404 });
          if (lockedRows[0].undone_at) throw Object.assign(new Error("This recalculation has already been undone."), { undoStatus: 400 });

          const lockedSnapshot = lockedRows[0].snapshot as {
            containers: Array<{ id: number; finalPayableAmount: string; ratePerKgUsd: string; finalPayableAmountUsd: string }>;
            rawStockRows: Array<{ id: number; costPerKg: string; costPerKgUsd: string }>;
            mixBatchSources: Array<{ id: number; costPerKg: string; totalCost: string }>;
            mixBatches: Array<{ id: number; costPerKg: string; totalCost: string }>;
            bales: Array<{ id: number; costPerKg: string; totalCost: string }>;
            suppliers: Array<{ id: number; currentRawMaterialCostPerKgUsd: string }>;
          };

          // All undo UPDATEs include company_id guard.
          // FIX 9: Check rowCount === 1 after each UPDATE; if 0, rollback (row disappeared
          // or belongs to another company — signals a serious data integrity issue).
          for (const c of lockedSnapshot.containers) {
            const { rowCount: rc } = await client.query(
              `UPDATE factory_containers
               SET final_payable_amount = $1, rate_per_kg_usd = $2, final_payable_amount_usd = $3, updated_at = NOW()
               WHERE id = $4 AND company_id = $5`,
              [c.finalPayableAmount, c.ratePerKgUsd, c.finalPayableAmountUsd, c.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: container ${c.id} not found or belongs to another company.`), { undoStatus: 400 });
          }
          for (const rs of lockedSnapshot.rawStockRows) {
            const { rowCount: rc } = await client.query(
              `UPDATE factory_raw_stock SET cost_per_kg = $1, cost_per_kg_usd = $2
               WHERE id = $3 AND company_id = $4`,
              [rs.costPerKg, rs.costPerKgUsd, rs.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: raw_stock ${rs.id} not found.`), { undoStatus: 400 });
          }
          for (const src of lockedSnapshot.mixBatchSources) {
            // Sources have no direct company_id — gate via their parent batch.
            const { rowCount: rc } = await client.query(
              `UPDATE factory_mix_batch_sources SET cost_per_kg = $1, total_cost = $2
               WHERE id = $3
                 AND mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $4)`,
              [src.costPerKg, src.totalCost, src.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: source ${src.id} not found.`), { undoStatus: 400 });
          }
          for (const b of lockedSnapshot.mixBatches) {
            const { rowCount: rc } = await client.query(
              `UPDATE factory_mix_batches SET cost_per_kg = $1, total_cost = $2, updated_at = NOW()
               WHERE id = $3 AND company_id = $4`,
              [b.costPerKg, b.totalCost, b.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: mix_batch ${b.id} not found.`), { undoStatus: 400 });
          }
          for (const bale of lockedSnapshot.bales) {
            const { rowCount: rc } = await client.query(
              `UPDATE factory_bales SET cost_per_kg = $1, total_cost = $2, updated_at = NOW()
               WHERE id = $3 AND company_id = $4`,
              [bale.costPerKg, bale.totalCost, bale.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: bale ${bale.id} not found.`), { undoStatus: 400 });
          }
          for (const sup of lockedSnapshot.suppliers) {
            const { rowCount: rc } = await client.query(
              `UPDATE factory_suppliers SET current_raw_material_cost_per_kg_usd = $1, updated_at = NOW()
               WHERE id = $2 AND company_id = $3`,
              [sup.currentRawMaterialCostPerKgUsd, sup.id, companyId]
            );
            if (!rc || rc === 0) throw Object.assign(new Error(`Undo: supplier ${sup.id} not found.`), { undoStatus: 400 });
          }

          // DEFECT 7 FIX: Mark as undone atomically with the restore writes.
          await client.query(
            `UPDATE factory_recalc_undo_log
             SET undone_at = NOW(), undone_by_user_id = $1, undone_by_username = $2
             WHERE id = $3 AND company_id = $4`,
            [req.session.userId ?? null, req.session.username ?? null, parseInt(undoLogId), companyId]
          );

          // DEFECT 7 FIX: Insert undo audit log inside the same transaction.
          await client.query(
            `INSERT INTO audit_log
               (user_id, username, company_id, action, table_name, record_id, record_identifier, changes, created_at)
             VALUES ($1, $2, $3, 'undo', 'factory_recalc_undo_log', $4, $5, $6::jsonb, NOW())`,
            [
              req.session.userId ?? null,
              req.session.username ?? null,
              companyId,
              parseInt(undoLogId),
              `historical-replay undo — log ${undoLogId}`,
              JSON.stringify({
                containersRestored: lockedSnapshot.containers.length,
                rawStockRowsRestored: lockedSnapshot.rawStockRows.length,
                sourcesRestored: lockedSnapshot.mixBatchSources.length,
                batchesRestored: lockedSnapshot.mixBatches.length,
                balesRestored: lockedSnapshot.bales.length,
                suppliersRestored: lockedSnapshot.suppliers.length,
              }),
            ]
          );

          await client.query("COMMIT");
        } catch (txErr: any) {
          await client.query("ROLLBACK");
          if (txErr.undoStatus === 404) return res.status(404).json({ message: txErr.message });
          if (txErr.undoStatus === 400) return res.status(400).json({ message: txErr.message });
          throw txErr;
        } finally {
          client.release();
        }

        res.json({
          success: true,
          containersRestored: snapshot.containers.length,
          rawStockRowsRestored: snapshot.rawStockRows.length,
          mixBatchSourcesRestored: snapshot.mixBatchSources.length,
          mixBatchesRestored: snapshot.mixBatches.length,
          balesRestored: snapshot.bales.length,
          suppliersRestored: snapshot.suppliers.length,
        });
      } catch (err: any) {
        console.error("[recalc undo] error:", err);
        res.status(500).json({ message: err.message || "Failed to undo recalculation" });
      }
    }
  );

  // ─── Historical Cost Replay ──────────────────────────────────────────────

  app.get(
    "/api/factory/raw-stock/recalc/historical-replay",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const preview = await previewHistoricalCostReplay(companyId);
        res.json(preview);
      } catch (err: any) {
        console.error("[historical-replay preview] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute historical replay preview" });
      }
    }
  );

  app.post(
    "/api/factory/raw-stock/recalc/historical-replay/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const userId = (req.session as any).userId;
      const username = (req.session as any).username;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        dryRun,
        confirmationToken: providedToken,
        supplierIds = [] as number[],
        includeCompletedBatches = false,
      } = req.body;

      try {
        const {
          includeFinalizedBales = false,
        } = req.body;
        const wantsCompletedBatches: boolean = includeCompletedBatches === true;
        const wantsFinalizedBales: boolean = includeFinalizedBales === true;

        if (dryRun || !providedToken) {
          // Issue a dry-run confirmation token
          const preview = await previewHistoricalCostReplay(companyId);
          const requestedIds: number[] = Array.isArray(supplierIds) ? supplierIds : [];
          const safeSupplierIds: number[] = requestedIds.length > 0
            ? requestedIds.filter((id: number) =>
                preview.supplierRows.some((s) => s.supplierId === id && s.safeToRepair)
              )
            : preview.supplierRows.filter((s) => s.safeToRepair).map((s) => s.supplierId);

          const fingerprint = computeReplayFingerprint(companyId, safeSupplierIds, preview, {
            includeCompletedBatches: wantsCompletedBatches,
            includeFinalizedBales: wantsFinalizedBales,
          });
          const tokenPayload = {
            companyId,
            supplierIds: safeSupplierIds,
            includeCompletedBatches: wantsCompletedBatches,
            includeFinalizedBales: wantsFinalizedBales,
            fingerprint,
            userId: String(userId),
            algorithmVersion: REPLAY_ALGORITHM_VERSION,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
          };
          const confirmationToken = signRepairToken(tokenPayload);

          // FIX 6: Use buildHistoricalReplayScope for exact write scope (with row-level
          // FOR UPDATE — safe to pass pool here, locks auto-release after single-statement tx).
          const writeScope = await buildHistoricalReplayScope({
            companyId,
            selectedSupplierIds: new Set(safeSupplierIds),
            includeCompletedBatches: wantsCompletedBatches,
            includeFinalizedBales: wantsFinalizedBales,
            executor: pool,
          });
          return res.json({
            dryRun: true,
            summary: preview.summary,
            safeSupplierIds,
            suppliersToApply: preview.supplierRows.filter(s => writeScope.supplierIds.includes(s.supplierId)),
            confirmationToken,
            fingerprint,
            expiresInMs: REPAIR_TOKEN_TTL_MS,
            algorithmVersion: REPLAY_ALGORITHM_VERSION,
            // FIX 6: Richer scope shape — confirmation dialog reads from this, not from
            // preview.summary (which is not scoped to the selected suppliers).
            scope: {
              suppliers: writeScope.supplierIds.length,
              containers: writeScope.containerIdsToUpdate.length,
              rawStockRows: writeScope.rawStockIdsToUpdate.length,
              supplierSources: writeScope.sourceIdsToUpdate.length,
              batches: writeScope.batchIdsToUpdate.length,
              availableBales: writeScope.availableBaleIdsToUpdate.length,
              finalizedBales: writeScope.finalizedBaleIdsToUpdate.length,
              blockedBatches: writeScope.blockedBatches.length,
            },
          });
        }

        // Verified apply path
        let payload: any;
        try {
          payload = verifyRepairToken(providedToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res
              .status(400)
              .json({ message: "Confirmation token expired — re-run the preview to get a fresh token." });
          }
          return res.status(400).json({ message: `Invalid confirmation token: ${err.message}` });
        }

        if (payload.companyId !== companyId) {
          return res.status(400).json({ message: "Token company mismatch" });
        }
        if (payload.userId !== String(userId)) {
          return res.status(400).json({ message: "Token user mismatch — token was issued to a different user." });
        }
        if (payload.algorithmVersion !== REPLAY_ALGORITHM_VERSION) {
          return res.status(400).json({
            message: `Token algorithm version "${payload.algorithmVersion}" is outdated. Re-run the preview.`,
          });
        }

        const safeSupplierIds: number[] = payload.supplierIds || [];
        const applyCompletedBatches: boolean = payload.includeCompletedBatches ?? false;
        const applyFinalizedBales: boolean = payload.includeFinalizedBales ?? false;

        // FIX 3: applyHistoricalCostReplay rebuilds all computation inside the advisory
        // lock — we no longer need to pass a preview. Keep the preview call only for
        // generating the human-readable supplierNames for the undo log description.
        const tokenHash = crypto.createHash("sha256").update(providedToken).digest("hex");
        await ensureUndoLogTable();
        const previewForNames = await previewHistoricalCostReplay(companyId);
        const supplierNames = previewForNames.supplierRows
          .filter((s) => safeSupplierIds.includes(s.supplierId))
          .map((s) => s.supplierName)
          .join(", ");

        const result = await applyHistoricalCostReplay({
          companyId,
          supplierIds: safeSupplierIds,
          includeCompletedBatches: applyCompletedBatches,
          includeFinalizedBales: applyFinalizedBales,
          // FIX 3: preview intentionally omitted — rebuilt inside the advisory lock.
          expectedFingerprint: payload.fingerprint,
          algorithmVersion: payload.algorithmVersion,
          issuedByUserId: payload.userId,
          tokenHash,
          onCommit: async (client, applyResult, snapshot) => {
            // Insert undo log inside the same advisory-locked transaction (FIX 2).
            await client.query(
              `INSERT INTO factory_recalc_undo_log
                 (company_id, user_id, username, description, container_count, container_numbers, snapshot)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                companyId,
                userId || null,
                username || null,
                `Historical cost replay — ${safeSupplierIds.length} supplier(s): ${supplierNames}`,
                0,
                [],
                JSON.stringify(snapshot),
              ]
            );
            // DEFECT 4 FIX: audit log inside the same transaction — atomic with cost writes.
            // No try/catch: audit INSERT failure must abort the whole transaction (fail closed).
            await client.query(
              `INSERT INTO audit_log
                 (user_id, username, company_id, action, table_name, record_id, record_identifier, changes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                String(userId || ""),
                username || null,
                companyId,
                "historical_cost_replay_applied",
                "factory_suppliers",
                companyId,
                `historical_cost_replay — ${safeSupplierIds.length} supplier(s): ${supplierNames}`,
                JSON.stringify({ applied: applyResult, safeSupplierIds }),
              ]
            );
          },
        });

        res.json({ success: true, ...result });
      } catch (err: any) {
        // Structured non-500 for stale/concurrent-apply token violations.
        if (err instanceof StaleTokenError || err?.code === "STALE_TOKEN") {
          return res.status(409).json({
            message: err.message,
            code: "STALE_TOKEN",
          });
        }
        console.error("[historical-replay apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply historical replay" });
      }
    }
  );
}
