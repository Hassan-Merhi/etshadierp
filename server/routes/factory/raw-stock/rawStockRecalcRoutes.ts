import type { Express } from "express";
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

// ─── Undo log helpers ─────────────────────────────────────────────────────────

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
  // Retroactive supplier locked-rate recompute (admin-only, no dry-run needed)
  // POST /api/factory/raw-stock/supplier-rate/recompute
  // Body: { supplierId?: number }  — omit to recompute ALL suppliers
  //
  // Recalculates current_raw_material_cost_per_kg_usd using the receipt-weighted
  // stable cost across all factory_raw_stock rows (which must already carry the
  // correct cost_per_kg_usd from a prior recalc apply). Skips suppliers whose
  // stable cost is 0 (no raw-stock rows). Use after a recalc that ran while all
  // containers were fully used and the cascade skipped the locked-rate update.
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/supplier-rate/recompute",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { supplierId } = req.body;

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
            .select({ id: factorySuppliers.id })
            .from(factorySuppliers)
            .where(eq(factorySuppliers.companyId, companyId));
          supplierIds = allSuppliers.map((s) => s.id);
        }

        const results: Array<{ supplierId: number; oldRate: number; newRate: number; rowCount: number; skipped?: string }> = [];

        for (const sid of supplierIds) {
          const [existing] = await db
            .select({ currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, sid), eq(factorySuppliers.companyId, companyId)));
          if (!existing) continue;

          const oldRate = parseFloat(existing.currentRawMaterialCostPerKgUsd as string || "0");
          const { costPerKgUsd, totalReceivedKg, rows } = await db.transaction(async (tx: any) => {
            return getStableSupplierCost(tx, companyId, sid);
          });

          if (costPerKgUsd <= 0) {
            results.push({ supplierId: sid, oldRate, newRate: 0, rowCount: 0, skipped: "No usable raw-stock rows" });
            continue;
          }
          if (Math.abs(costPerKgUsd - oldRate) < 0.000001) {
            results.push({ supplierId: sid, oldRate, newRate: costPerKgUsd, rowCount: rows.length, skipped: "Already correct" });
            continue;
          }

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
          results.push({ supplierId: sid, oldRate, newRate: costPerKgUsd, rowCount: rows.length });
        }

        res.json({
          updated: results.filter((r) => !r.skipped).length,
          skipped: results.filter((r) => !!r.skipped).length,
          results,
        });
      } catch (err: any) {
        console.error("[supplier-rate/recompute] error:", err);
        res.status(500).json({ message: err.message || "Failed to recompute supplier rate" });
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
      try {
        const mismatches = await getMixBatchSourceCostMismatchPreview(companyId);
        const fixableIds = mismatches.filter((r) => r.fixable).map((r) => r.sourceId);
        if (fixableIds.length === 0) {
          return res.json({ applied: 0, skipped: 0, results: [] });
        }
        const results = await applyZeroCostMixBatchSourcesFix(companyId, fixableIds, {
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_mix_batch_sources",
                recordId: result.sourceId,
                recordIdentifier: `fix-source-mismatches — batch ${result.batchCode}`,
                changes: { result: { new: result } },
              },
              tx
            );
          },
        });
        res.json({
          applied: results.filter((r) => r.applied).length,
          skipped: results.filter((r) => !r.applied).length,
          results,
        });
      } catch (err: any) {
        console.error("[recalc fix-source-mismatches] error:", err);
        res.status(500).json({ message: err.message || "Failed to fix source mismatches" });
      }
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

        // Apply the undo in a single DB transaction using a pool client
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          for (const c of snapshot.containers) {
            await client.query(
              `UPDATE factory_containers
               SET final_payable_amount = $1, rate_per_kg_usd = $2, final_payable_amount_usd = $3, updated_at = NOW()
               WHERE id = $4`,
              [c.finalPayableAmount, c.ratePerKgUsd, c.finalPayableAmountUsd, c.id]
            );
          }
          for (const rs of snapshot.rawStockRows) {
            await client.query(
              `UPDATE factory_raw_stock SET cost_per_kg = $1, cost_per_kg_usd = $2 WHERE id = $3`,
              [rs.costPerKg, rs.costPerKgUsd, rs.id]
            );
          }
          for (const src of snapshot.mixBatchSources) {
            await client.query(
              `UPDATE factory_mix_batch_sources SET cost_per_kg = $1, total_cost = $2 WHERE id = $3`,
              [src.costPerKg, src.totalCost, src.id]
            );
          }
          for (const b of snapshot.mixBatches) {
            await client.query(
              `UPDATE factory_mix_batches SET cost_per_kg = $1, total_cost = $2, updated_at = NOW() WHERE id = $3`,
              [b.costPerKg, b.totalCost, b.id]
            );
          }
          for (const bale of snapshot.bales) {
            await client.query(
              `UPDATE factory_bales SET cost_per_kg = $1, total_cost = $2, updated_at = NOW() WHERE id = $3`,
              [bale.costPerKg, bale.totalCost, bale.id]
            );
          }
          for (const sup of snapshot.suppliers) {
            await client.query(
              `UPDATE factory_suppliers SET current_raw_material_cost_per_kg_usd = $1, updated_at = NOW() WHERE id = $2`,
              [sup.currentRawMaterialCostPerKgUsd, sup.id]
            );
          }

          await client.query("COMMIT");
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        } finally {
          client.release();
        }

        // Mark the log entry as undone
        await pool.query(
          `UPDATE factory_recalc_undo_log
           SET undone_at = NOW(), undone_by_user_id = $1, undone_by_username = $2
           WHERE id = $3`,
          [req.session.userId ?? null, req.session.username ?? null, parseInt(undoLogId)]
        );

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
}
