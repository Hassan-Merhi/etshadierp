import Decimal from "decimal.js";
import { pool } from "../../../db";
import {
  REPLAY_ALGORITHM_VERSION,
  StaleTokenError,
  numeric,
  type ReplayApplyParams,
  type ReplayApplyResult,
  type ReplayQueryExecutor,
} from "./types";
import {
  buildHistoricalReplayScopeInternal,
  buildNotFinalizedClause,
  captureReplaySnapshot,
  computeReplayFingerprint,
} from "./scope";

export async function applyHistoricalCostReplay(
  params: ReplayApplyParams & {
    tokenHash?: string;
    onCommit?: (
      client: ReplayQueryExecutor,
      result: ReplayApplyResult,
      snapshot: Awaited<ReturnType<typeof captureReplaySnapshot>>
    ) => Promise<void>;
  }
): Promise<ReplayApplyResult> {
  const {
    companyId,
    supplierIds,
    includeCompletedBatches,
    includeFinalizedBales,
    expectedFingerprint,
    algorithmVersion,
    issuedByUserId,
    tokenHash,
    onCommit,
  } = params;

  if (algorithmVersion !== REPLAY_ALGORITHM_VERSION) {
    throw new Error(
      `Token algorithm version "${algorithmVersion}" does not match current engine "${REPLAY_ALGORITHM_VERSION}". Re-run the dry-run preview to get a fresh token.`
    );
  }

  const result: ReplayApplyResult = {
    suppliersApplied: 0,
    rawStockRowsUpdated: 0,
    sourcesUpdated: 0,
    batchesUpdated: 0,
    balesUpdated: 0,
    supplierRatesUpdated: 0,
    skippedSupplierIds: [],
  };
  if (supplierIds.length === 0) return result;

  const client = await pool.connect();
  const executor = client as unknown as ReplayQueryExecutor;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(9003, $1)`, [companyId]);

    const scope = await buildHistoricalReplayScopeInternal({
      companyId,
      selectedSupplierIds: new Set(supplierIds),
      includeCompletedBatches,
      includeFinalizedBales,
      executor,
      lockRows: true,
    });

    result.skippedSupplierIds = supplierIds.filter((id) => !scope.supplierIds.includes(id));
    if (scope._safeSupplierRows.length === 0) {
      await client.query("COMMIT");
      return result;
    }

    const safeSupplierIds = new Set(scope.supplierIds);
    const batchIdsToApply = new Set(scope.batchIdsToUpdate);
    const sourceIdsToUpdate = new Set(scope.sourceIdsToUpdate);
    const baleIdsToUpdate = includeFinalizedBales
      ? [...scope.availableBaleIdsToUpdate, ...scope.finalizedBaleIdsToUpdate]
      : [...scope.availableBaleIdsToUpdate];
    const baleIdSet = new Set(baleIdsToUpdate);

    const freshFingerprint = computeReplayFingerprint(companyId, supplierIds, scope._fullPreview, {
      includeCompletedBatches,
      includeFinalizedBales,
    });
    if (freshFingerprint !== expectedFingerprint) {
      throw new StaleTokenError(
        "Stale token — DB state changed since the dry-run was issued. Re-run the preview to obtain a fresh token."
      );
    }

    if (tokenHash) {
      const consumed = await client.query(
        `INSERT INTO factory_replay_consumed_tokens
           (token_hash, company_id, user_id, replay_algorithm_version, scope_fingerprint)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash, companyId, issuedByUserId, algorithmVersion, expectedFingerprint]
      );
      if (!consumed.rowCount) {
        throw new Error("This confirmation token has already been used. Re-run the preview to obtain a fresh token.");
      }
    }

    const snapshot = await captureReplaySnapshot(
      executor,
      companyId,
      [...safeSupplierIds],
      [...batchIdsToApply],
      scope.sourceIdsToUpdate,
      baleIdsToUpdate
    );

    for (const [rawStockId, containerId] of scope._rawStockIdToContainer) {
      const canonicalRate = scope._canonicalRateByContainer.get(containerId);
      if (canonicalRate == null) continue;
      const update = await client.query(
        `UPDATE factory_raw_stock
         SET cost_per_kg_usd = $1
         WHERE id = $2 AND company_id = $3`,
        [new Decimal(canonicalRate).toDecimalPlaces(6).toFixed(6), rawStockId, companyId]
      );
      if (update.rowCount) result.rawStockRowsUpdated += update.rowCount;
    }

    for (const containerId of scope.containerIdsToUpdate) {
      const canonicalRate = scope._canonicalRateByContainer.get(containerId);
      const canonicalTotal = scope._canonicalTotalUsdByContainer.get(containerId);
      if (canonicalRate == null || canonicalTotal == null) continue;
      await client.query(
        `UPDATE factory_containers
         SET rate_per_kg_usd = $1,
             final_payable_amount_usd = $2
         WHERE id = $3
           AND company_id = $4
           AND supplier_id = ANY($5)`,
        [
          new Decimal(canonicalRate).toDecimalPlaces(6).toFixed(6),
          new Decimal(canonicalTotal).toDecimalPlaces(6).toFixed(6),
          containerId,
          companyId,
          [...safeSupplierIds],
        ]
      );
    }

    for (const sourceRow of scope._fullPreview.sourceRows) {
      if (!sourceRow.safeToRepair || !sourceIdsToUpdate.has(sourceRow.sourceId)) continue;
      const costPerKg = new Decimal(sourceRow.expectedHistoricalCostPerKg).toDecimalPlaces(6).toFixed(6);
      const totalCost = new Decimal(sourceRow.weightKg)
        .times(sourceRow.expectedHistoricalCostPerKg)
        .toDecimalPlaces(6)
        .toFixed(6);
      const update = await client.query(
        `UPDATE factory_mix_batch_sources
         SET cost_per_kg = $1, total_cost = $2
         WHERE id = $3
           AND mix_batch_id IN (
             SELECT id FROM factory_mix_batches WHERE company_id = $4
           )`,
        [costPerKg, totalCost, sourceRow.sourceId, companyId]
      );
      if (update.rowCount) result.sourcesUpdated += update.rowCount;
    }

    for (const correction of scope._batchCorrections) {
      if (!batchIdsToApply.has(correction.batchId)) continue;
      const batchUpdate = await client.query(
        `UPDATE factory_mix_batches
         SET cost_per_kg = $1, total_cost = $2, updated_at = NOW()
         WHERE id = $3 AND company_id = $4`,
        [
          new Decimal(correction.expectedCostPerKg).toDecimalPlaces(6).toFixed(6),
          new Decimal(correction.expectedTotalCost).toDecimalPlaces(6).toFixed(6),
          correction.batchId,
          companyId,
        ]
      );
      if (batchUpdate.rowCount) result.batchesUpdated += batchUpdate.rowCount;

      const baleResult = await client.query<{ id: number; weight_kg: string }>(
        `SELECT fb.id, fb.weight_kg
         FROM factory_bales fb
         WHERE fb.mix_batch_id = $1
           AND fb.company_id = $2
           AND ${buildNotFinalizedClause(includeFinalizedBales)}`,
        [correction.batchId, companyId]
      );
      for (const bale of baleResult.rows) {
        if (!baleIdSet.has(bale.id)) continue;
        const cost = new Decimal(correction.expectedCostPerKg);
        const update = await client.query(
          `UPDATE factory_bales
           SET cost_per_kg = $1, total_cost = $2, updated_at = NOW()
           WHERE id = $3 AND company_id = $4`,
          [
            cost.toDecimalPlaces(6).toFixed(6),
            new Decimal(bale.weight_kg || "0").times(cost).toDecimalPlaces(6).toFixed(6),
            bale.id,
            companyId,
          ]
        );
        if (update.rowCount) result.balesUpdated += update.rowCount;
      }
    }

    for (const supplier of scope._safeSupplierRows) {
      if (supplier.endingExpectedRate > 0) {
        const update = await client.query(
          `UPDATE factory_suppliers
           SET current_raw_material_cost_per_kg_usd = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [
            new Decimal(supplier.endingExpectedRate).toDecimalPlaces(8).toFixed(8),
            supplier.supplierId,
            companyId,
          ]
        );
        if (update.rowCount) result.supplierRatesUpdated += update.rowCount;
      }
      result.suppliersApplied += 1;
    }

    if (batchIdsToApply.size > 0) {
      const postBatches = await client.query<{
        id: number;
        total_weight_kg: string;
        status: string;
        used_kg: string;
        company_id: number;
      }>(
        `SELECT id, total_weight_kg, status, used_kg, company_id
         FROM factory_mix_batches
         WHERE id = ANY($1)`,
        [[...batchIdsToApply]]
      );
      const before = new Map(
        (snapshot.mixBatches as Array<{
          id: number;
          totalWeightKg: string;
          status: string;
          companyId?: number;
        }>).map((batch) => [batch.id, batch])
      );
      for (const batch of postBatches.rows) {
        const original = before.get(batch.id);
        if (!original) continue;
        if (Math.abs(numeric(original.totalWeightKg) - numeric(batch.total_weight_kg)) > 0.001) {
          throw Object.assign(
            new Error(`HISTORICAL_REPLAY_INVARIANT_VIOLATION: batch ${batch.id} weight changed. Rolling back.`),
            { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
          );
        }
        if (original.status !== batch.status || (original.companyId != null && original.companyId !== batch.company_id)) {
          throw Object.assign(
            new Error(`HISTORICAL_REPLAY_INVARIANT_VIOLATION: batch ${batch.id} identity/status changed. Rolling back.`),
            { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
          );
        }
      }
    }

    if (baleIdsToUpdate.length > 0) {
      const postBales = await client.query<{
        id: number;
        weight_kg: string;
        status: string;
        mix_batch_id: number | null;
        location_id: number | null;
        company_id: number;
      }>(
        `SELECT id, weight_kg, status, mix_batch_id, location_id, company_id
         FROM factory_bales
         WHERE id = ANY($1)`,
        [baleIdsToUpdate]
      );
      const before = new Map(
        (snapshot.bales as Array<{
          id: number;
          weightKg: string;
          status: string;
          mixBatchId: number | null;
          locationId?: number | null;
          companyId?: number;
        }>).map((bale) => [bale.id, bale])
      );
      for (const bale of postBales.rows) {
        const original = before.get(bale.id);
        if (!original) continue;
        const invalid = Math.abs(numeric(original.weightKg) - numeric(bale.weight_kg)) > 0.001
          || original.status !== bale.status
          || original.mixBatchId !== bale.mix_batch_id
          || (original.locationId != null && original.locationId !== bale.location_id)
          || (original.companyId != null && original.companyId !== bale.company_id);
        if (invalid) {
          throw Object.assign(
            new Error(`HISTORICAL_REPLAY_INVARIANT_VIOLATION: bale ${bale.id} non-cost fields changed. Rolling back.`),
            { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
          );
        }
      }
    }

    for (const correction of scope._batchCorrections) {
      if (!batchIdsToApply.has(correction.batchId)) continue;
      const sources = scope._sourceInfos.filter((source) => source.batchId === correction.batchId);
      if (sources.length === 0) continue;
      let sourceTotal = new Decimal(0);
      for (const source of sources) {
        const previewSource = scope._fullPreview.sourceRows.find((row) => row.sourceId === source.sourceId);
        if (!previewSource?.safeToRepair) continue;
        sourceTotal = sourceTotal.plus(
          new Decimal(source.weightKg).times(previewSource.expectedHistoricalCostPerKg)
        );
      }
      if (sourceTotal.minus(correction.expectedTotalCost).abs().gt("0.02")) {
        throw new Error(
          `Source-cost sum invariant violated for batch ${correction.batchId} (${correction.batchCode}). Rolling back.`
        );
      }
    }

    if (onCommit) await onCommit(executor, result, snapshot);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return result;
}
