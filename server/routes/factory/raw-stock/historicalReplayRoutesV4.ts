import type { Express } from "express";
import crypto from "crypto";
import { requireAuth, requireRole } from "../../../auth";
import { pool } from "../../../db";
import {
  previewHistoricalCostReplay,
  previewHistoricalCostReplayWithExecutor,
  applyHistoricalCostReplay,
  computeReplayFingerprint,
  buildHistoricalReplayScopeInternal,
  normalizeReplayWriteScope,
  REPLAY_ALGORITHM_VERSION,
  StaleTokenError,
  type ReplayQueryExecutor,
  type ReplayWriteScope,
} from "../../../services/factory/historicalCostReplay";
import {
  signRepairToken,
  verifyRepairToken,
  ExpiredRepairTokenError,
  RepairTokenConfigurationError,
  REPAIR_TOKEN_TTL_MS,
} from "../../../services/factory/repairToken";

const ADMIN_ROLES = ["Admin", "Developer"] as const;

interface HistoricalReplayTokenPayload {
  companyId: number;
  supplierIds: number[];
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  fingerprint: string;
  scope: ReplayWriteScope;
  userId: string;
  algorithmVersion: string;
  expiresAt: number;
}

function numberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item <= 0)) return null;
  return [...new Set(value as number[])].sort((left, right) => left - right);
}

function parseReplayWriteScope(value: unknown): ReplayWriteScope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const supplierIds = numberArray(input.supplierIds);
  const containerIdsToUpdate = numberArray(input.containerIdsToUpdate);
  const rawStockIdsToUpdate = numberArray(input.rawStockIdsToUpdate);
  const sourceIdsToUpdate = numberArray(input.sourceIdsToUpdate);
  const batchIdsToUpdate = numberArray(input.batchIdsToUpdate);
  const availableBaleIdsToUpdate = numberArray(input.availableBaleIdsToUpdate);
  const finalizedBaleIdsToUpdate = numberArray(input.finalizedBaleIdsToUpdate);
  if (
    !supplierIds || !containerIdsToUpdate || !rawStockIdsToUpdate || !sourceIdsToUpdate
    || !batchIdsToUpdate || !availableBaleIdsToUpdate || !finalizedBaleIdsToUpdate
    || !Array.isArray(input.blockedBatches)
  ) {
    return null;
  }

  const blockedBatches: ReplayWriteScope["blockedBatches"] = [];
  for (const raw of input.blockedBatches) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.batchId !== "number"
      || !Number.isInteger(row.batchId)
      || typeof row.batchCode !== "string"
      || !Array.isArray(row.reasons)
      || row.reasons.some((reason) => typeof reason !== "string")
    ) {
      return null;
    }
    blockedBatches.push({
      batchId: row.batchId,
      batchCode: row.batchCode,
      reasons: [...new Set(row.reasons as string[])].sort(),
    });
  }

  return normalizeReplayWriteScope({
    supplierIds,
    containerIdsToUpdate,
    rawStockIdsToUpdate,
    sourceIdsToUpdate,
    batchIdsToUpdate,
    availableBaleIdsToUpdate,
    finalizedBaleIdsToUpdate,
    blockedBatches,
  });
}

/**
 * Registers the exact-scope Historical Replay routes before the legacy raw-stock
 * route module. Express therefore resolves these handlers first while every
 * unrelated raw-stock recalculation route remains owned by the legacy module.
 */
export function registerHistoricalReplayRoutesV4(app: Express): void {
  app.get(
    "/api/factory/raw-stock/recalc/historical-replay",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const preview = await previewHistoricalCostReplay(companyId);
        res.json(preview);
      } catch (error: any) {
        console.error("[historical-replay v4 preview] error:", error);
        res.status(500).json({ message: error.message || "Failed to compute historical replay preview" });
      }
    }
  );

  app.post(
    "/api/factory/raw-stock/recalc/historical-replay/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      const userId = String(req.session.userId ?? "");
      const username = req.session.username ?? null;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const providedToken = req.body?.confirmationToken;
      const isDryRun = req.body?.dryRun === true || !providedToken;
      const wantsCompletedBatches = req.body?.includeCompletedBatches === true;
      const wantsFinalizedBales = req.body?.includeFinalizedBales === true;

      try {
        if (isDryRun) {
          const requestedIds = numberArray(req.body?.supplierIds) ?? [];
          const prepareClient = await pool.connect();
          try {
            await prepareClient.query("BEGIN");
            await prepareClient.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
            const executor = prepareClient as unknown as ReplayQueryExecutor;

            // Selection, exact scope, human-readable preview and authoritative
            // digest all come from the same repeatable-read database snapshot.
            const selectionPreview = await previewHistoricalCostReplayWithExecutor(executor, companyId);
            const previewSafeIds = selectionPreview.supplierRows
              .filter((supplier) => supplier.safeToRepair)
              .map((supplier) => supplier.supplierId);
            const selectedSafeIds = requestedIds.length > 0
              ? requestedIds.filter((id) => previewSafeIds.includes(id))
              : previewSafeIds;

            const internalScope = await buildHistoricalReplayScopeInternal({
              companyId,
              selectedSupplierIds: new Set(selectedSafeIds),
              includeCompletedBatches: wantsCompletedBatches,
              includeFinalizedBales: wantsFinalizedBales,
              executor,
              lockRows: false,
            });
            const normalizedScope = normalizeReplayWriteScope(internalScope);
            const preview = internalScope._fullPreview;
            const safeSupplierIds = normalizedScope.supplierIds;
            const fingerprint = computeReplayFingerprint(
              companyId,
              safeSupplierIds,
              preview,
              {
                includeCompletedBatches: wantsCompletedBatches,
                includeFinalizedBales: wantsFinalizedBales,
              },
              normalizedScope
            );

            const tokenPayload: HistoricalReplayTokenPayload = {
              companyId,
              supplierIds: safeSupplierIds,
              includeCompletedBatches: wantsCompletedBatches,
              includeFinalizedBales: wantsFinalizedBales,
              fingerprint,
              scope: normalizedScope,
              userId,
              algorithmVersion: REPLAY_ALGORITHM_VERSION,
              expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
            };
            const confirmationToken = signRepairToken(tokenPayload);
            await prepareClient.query("COMMIT");

            return res.json({
              dryRun: true,
              summary: preview.summary,
              safeSupplierIds,
              suppliersToApply: preview.supplierRows.filter((supplier) =>
                safeSupplierIds.includes(supplier.supplierId)
              ),
              confirmationToken,
              fingerprint,
              expiresInMs: REPAIR_TOKEN_TTL_MS,
              algorithmVersion: REPLAY_ALGORITHM_VERSION,
              frozenOptions: {
                includeCompletedBatches: wantsCompletedBatches,
                includeFinalizedBales: wantsFinalizedBales,
              },
              scope: {
                suppliers: normalizedScope.supplierIds.length,
                containers: normalizedScope.containerIdsToUpdate.length,
                rawStockRows: normalizedScope.rawStockIdsToUpdate.length,
                supplierSources: normalizedScope.sourceIdsToUpdate.length,
                batches: normalizedScope.batchIdsToUpdate.length,
                availableBales: normalizedScope.availableBaleIdsToUpdate.length,
                finalizedBales: wantsFinalizedBales
                  ? normalizedScope.finalizedBaleIdsToUpdate.length
                  : 0,
                excludedFinalizedBales: wantsFinalizedBales
                  ? 0
                  : normalizedScope.finalizedBaleIdsToUpdate.length,
                blockedBatches: normalizedScope.blockedBatches.length,
              },
            });
          } catch (error) {
            await prepareClient.query("ROLLBACK");
            throw error;
          } finally {
            prepareClient.release();
          }
        }

        let payload: HistoricalReplayTokenPayload;
        try {
          payload = verifyRepairToken<HistoricalReplayTokenPayload>(providedToken);
        } catch (error: any) {
          if (error instanceof ExpiredRepairTokenError) {
            return res.status(400).json({
              message: "Confirmation token expired — re-run Prepare Historical Replay.",
            });
          }
          return res.status(400).json({ message: `Invalid confirmation token: ${error.message}` });
        }

        if (payload.companyId !== companyId) {
          return res.status(400).json({ message: "Token company mismatch" });
        }
        if (payload.userId !== userId) {
          return res.status(400).json({ message: "Token user mismatch — token belongs to another user." });
        }
        if (payload.algorithmVersion !== REPLAY_ALGORITHM_VERSION) {
          return res.status(400).json({ message: "Replay algorithm changed — re-run Prepare Historical Replay." });
        }

        const signedScope = parseReplayWriteScope(payload.scope);
        const signedSupplierIds = numberArray(payload.supplierIds);
        if (!signedScope || !signedSupplierIds) {
          return res.status(400).json({
            message: "Token predates exact signed replay scopes — re-run Prepare Historical Replay.",
          });
        }
        if (JSON.stringify(signedSupplierIds) !== JSON.stringify(signedScope.supplierIds)) {
          return res.status(400).json({ message: "Token supplier scope is inconsistent." });
        }

        const supplierNameResult = signedSupplierIds.length > 0
          ? await pool.query<{ name: string }>(
              `SELECT name
               FROM factory_suppliers
               WHERE id = ANY($1) AND company_id = $2
               ORDER BY id`,
              [signedSupplierIds, companyId]
            )
          : { rows: [] as Array<{ name: string }> };
        const supplierNames = supplierNameResult.rows.map((row) => row.name).join(", ");
        const tokenHash = crypto.createHash("sha256").update(providedToken).digest("hex");

        const result = await applyHistoricalCostReplay({
          companyId,
          supplierIds: signedSupplierIds,
          includeCompletedBatches: payload.includeCompletedBatches === true,
          includeFinalizedBales: payload.includeFinalizedBales === true,
          expectedFingerprint: payload.fingerprint,
          expectedScope: signedScope,
          algorithmVersion: payload.algorithmVersion,
          issuedByUserId: payload.userId,
          tokenHash,
          onCommit: async (client, applyResult, snapshot) => {
            await client.query(
              `INSERT INTO factory_recalc_undo_log
                 (company_id, user_id, username, description, container_count, container_numbers, snapshot)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                companyId,
                req.session.userId ?? null,
                username,
                `Historical cost replay — ${signedSupplierIds.length} supplier(s): ${supplierNames}`,
                signedScope.containerIdsToUpdate.length,
                [],
                JSON.stringify(snapshot),
              ]
            );
            await client.query(
              `INSERT INTO audit_log
                 (user_id, username, company_id, action, table_name, record_id, record_identifier, changes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                userId,
                username,
                companyId,
                "historical_cost_replay_applied",
                "factory_suppliers",
                companyId,
                `historical_cost_replay — ${signedSupplierIds.length} supplier(s): ${supplierNames}`,
                JSON.stringify({
                  applied: applyResult,
                  supplierIds: signedSupplierIds,
                  scope: signedScope,
                  options: {
                    includeCompletedBatches: payload.includeCompletedBatches,
                    includeFinalizedBales: payload.includeFinalizedBales,
                  },
                  fingerprint: payload.fingerprint,
                }),
              ]
            );
          },
        });

        return res.json({ success: true, ...result });
      } catch (error: any) {
        if (
          error instanceof StaleTokenError
          || error?.code === "STALE_TOKEN"
          || error?.code === "HISTORICAL_REPLAY_SCOPE_VIOLATION"
        ) {
          return res.status(409).json({
            message: error.message,
            code: error?.code ?? "STALE_TOKEN",
          });
        }
        if (error instanceof RepairTokenConfigurationError) {
          return res.status(500).json({
            message: error.message,
            code: "REPAIR_TOKEN_MISCONFIGURED",
          });
        }
        console.error("[historical-replay v4 apply] error:", error);
        return res.status(500).json({
          message: error.message || "Failed to apply historical replay",
        });
      }
    }
  );
}
