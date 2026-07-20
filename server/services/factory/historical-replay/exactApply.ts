import Decimal from "decimal.js";
import { pool } from "../../../db";
import {
  REPLAY_ALGORITHM_VERSION,
  StaleTokenError,
  type ReplayApplyParams,
  type ReplayApplyResult,
  type ReplayQueryExecutor,
  type ReplayWriteScope,
} from "./types";
import {
  buildExactHistoricalReplayScopeInternal,
} from "./exactScope";
import {
  normalizeReplayWriteScope,
  replayWriteScopesEqual,
} from "./selectedScope";
import {
  computeReplayFingerprint,
  loadReplayAuthoritativeInputDigest,
} from "./fingerprint";
import { captureExactReplaySnapshot } from "./exactSnapshot";

function sortNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function assertOne(rowCount: number | null | undefined, label: string): void {
  if (rowCount !== 1) {
    throw Object.assign(
      new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: expected exactly one ${label} row, updated ${rowCount ?? 0}. Rolling back.`),
      { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
    );
  }
}

function assertSameIds(expected: number[], actual: number[], label: string): void {
  const left = JSON.stringify(sortNumbers(expected));
  const right = JSON.stringify(sortNumbers(actual));
  if (left !== right) {
    throw Object.assign(
      new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: ${label} rows no longer match the signed scope. Rolling back.`),
      { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
    );
  }
}

export async function applyExactHistoricalCostReplay(
  params: ReplayApplyParams & {
    tokenHash?: string;
    onCommit?: (
      client: ReplayQueryExecutor,
      result: ReplayApplyResult,
      snapshot: Awaited<ReturnType<typeof captureExactReplaySnapshot>>
    ) => Promise<void>;
  }
): Promise<ReplayApplyResult> {
  const {
    companyId,
    supplierIds,
    includeCompletedBatches,
    includeFinalizedBales,
    expectedFingerprint,
    expectedScope,
    algorithmVersion,
    issuedByUserId,
    tokenHash,
    onCommit,
  } = params;

  if (algorithmVersion !== REPLAY_ALGORITHM_VERSION) {
    throw new StaleTokenError(
      `Token algorithm version "${algorithmVersion}" does not match current engine "${REPLAY_ALGORITHM_VERSION}". Re-run the preview.`
    );
  }
  if (!expectedScope) {
    throw new StaleTokenError(
      "This token predates exact signed replay scopes. Re-run Prepare Historical Replay."
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
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query(`SELECT pg_advisory_xact_lock(9003, $1)`, [companyId]);

    const scope = await buildExactHistoricalReplayScopeInternal({
      companyId,
      selectedSupplierIds: new Set(supplierIds),
      includeCompletedBatches,
      includeFinalizedBales,
      executor,
      lockRows: true,
    });
    const publicScope = normalizeReplayWriteScope(scope);
    const signedScope = normalizeReplayWriteScope(expectedScope);

    if (!replayWriteScopesEqual(signedScope, publicScope)) {
      throw new StaleTokenError(
        "Stale token — exact supplier/container/raw-stock/source/batch/bale scope changed since Prepare."
      );
    }

    const authoritative = await loadReplayAuthoritativeInputDigest(executor, companyId);
    Object.assign(scope._fullPreview, {
      authoritativeInputDigest: authoritative.digest,
      authoritativeInputCounts: authoritative.counts,
    });
    const freshFingerprint = computeReplayFingerprint(
      companyId,
      supplierIds,
      scope._fullPreview,
      { includeCompletedBatches, includeFinalizedBales },
      publicScope
    );
    if (freshFingerprint !== expectedFingerprint) {
      throw new StaleTokenError(
        "Stale token — authoritative replay inputs changed since Prepare. Re-run the preview."
      );
    }

    result.skippedSupplierIds = supplierIds.filter((id) => !publicScope.supplierIds.includes(id));
    if (publicScope.supplierIds.length === 0) {
      await client.query("COMMIT");
      return result;
    }

    if (tokenHash) {
      const consumed = await client.query(
        `INSERT INTO factory_replay_consumed_tokens
           (token_hash, company_id, user_id, replay_algorithm_version, scope_fingerprint)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash, companyId, issuedByUserId, algorithmVersion, expectedFingerprint]
      );
      if (consumed.rowCount !== 1) {
        throw new StaleTokenError(
          "This confirmation token has already been used. Re-run Prepare Historical Replay."
        );
      }
    }

    const approvedSupplierIds = new Set(publicScope.supplierIds);
    const approvedContainerIds = new Set(publicScope.containerIdsToUpdate);
    const approvedRawStockIds = new Set(publicScope.rawStockIdsToUpdate);
    const approvedSourceIds = new Set(publicScope.sourceIdsToUpdate);
    const approvedBatchIds = new Set(publicScope.batchIdsToUpdate);
    const approvedBaleIds = includeFinalizedBales
      ? sortNumbers([...publicScope.availableBaleIdsToUpdate, ...publicScope.finalizedBaleIdsToUpdate])
      : sortNumbers(publicScope.availableBaleIdsToUpdate);

    const snapshot = await captureExactReplaySnapshot(
      executor,
      companyId,
      publicScope,
      approvedBaleIds
    );
    assertSameIds(publicScope.containerIdsToUpdate, snapshot.containers.map((row: any) => Number(row.id)), "container snapshot");
    assertSameIds(publicScope.rawStockIdsToUpdate, snapshot.rawStockRows.map((row: any) => Number(row.id)), "raw-stock snapshot");
    assertSameIds(publicScope.sourceIdsToUpdate, snapshot.mixBatchSources.map((row: any) => Number(row.id)), "source snapshot");
    assertSameIds(publicScope.batchIdsToUpdate, snapshot.mixBatches.map((row: any) => Number(row.id)), "batch snapshot");
    assertSameIds(approvedBaleIds, snapshot.bales.map((row: any) => Number(row.id)), "bale snapshot");
    assertSameIds(publicScope.supplierIds, snapshot.suppliers.map((row: any) => Number(row.id)), "supplier snapshot");

    for (const rawStockId of publicScope.rawStockIdsToUpdate) {
      if (!approvedRawStockIds.has(rawStockId)) throw new Error("Unapproved raw-stock ID");
      const containerId = scope._rawStockIdToContainer.get(rawStockId);
      const canonicalRate = containerId == null ? undefined : scope._canonicalRateByContainer.get(containerId);
      if (containerId == null || canonicalRate == null || !approvedContainerIds.has(containerId)) {
        throw Object.assign(
          new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: raw-stock ${rawStockId} has no approved container correction.`),
          { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
        );
      }
      const update = await client.query(
        `UPDATE factory_raw_stock
         SET cost_per_kg_usd = $1
         WHERE id = $2
           AND company_id = $3
           AND container_id = $4
           AND deleted_at IS NULL`,
        [new Decimal(canonicalRate).toDecimalPlaces(6).toFixed(6), rawStockId, companyId, containerId]
      );
      assertOne(update.rowCount, `raw-stock ${rawStockId}`);
      result.rawStockRowsUpdated += 1;
    }

    for (const containerId of publicScope.containerIdsToUpdate) {
      if (!approvedContainerIds.has(containerId)) throw new Error("Unapproved container ID");
      const canonicalRate = scope._canonicalRateByContainer.get(containerId);
      const canonicalTotalUsd = scope._canonicalTotalUsdByContainer.get(containerId);
      if (canonicalRate == null || canonicalTotalUsd == null) {
        throw Object.assign(
          new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: container ${containerId} has no canonical landed-cost result.`),
          { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
        );
      }
      const update = await client.query(
        `UPDATE factory_containers
         SET rate_per_kg_usd = $1,
             final_payable_amount_usd = $2,
             updated_at = NOW()
         WHERE id = $3
           AND company_id = $4
           AND supplier_id = ANY($5)
           AND deleted_at IS NULL`,
        [
          new Decimal(canonicalRate).toDecimalPlaces(6).toFixed(6),
          new Decimal(canonicalTotalUsd).toDecimalPlaces(6).toFixed(6),
          containerId,
          companyId,
          sortNumbers([...approvedSupplierIds]),
        ]
      );
      assertOne(update.rowCount, `container ${containerId}`);
    }

    const sourceCorrections = scope._sourceCorrections ?? new Map();
    for (const sourceId of publicScope.sourceIdsToUpdate) {
      if (!approvedSourceIds.has(sourceId)) throw new Error("Unapproved source ID");
      const correction = sourceCorrections.get(sourceId);
      if (!correction || !approvedBatchIds.has(correction.batchId)) {
        throw Object.assign(
          new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: source ${sourceId} has no approved correction.`),
          { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
        );
      }
      const update = await client.query(
        `UPDATE factory_mix_batch_sources mbs
         SET cost_per_kg = $1,
             total_cost = $2
         FROM factory_mix_batches mb
         WHERE mbs.id = $3
           AND mbs.mix_batch_id = $4
           AND mb.id = mbs.mix_batch_id
           AND mb.company_id = $5`,
        [
          new Decimal(correction.expectedCostPerKg).toDecimalPlaces(6).toFixed(6),
          new Decimal(correction.expectedTotalCost).toDecimalPlaces(6).toFixed(6),
          sourceId,
          correction.batchId,
          companyId,
        ]
      );
      assertOne(update.rowCount, `source ${sourceId}`);
      result.sourcesUpdated += 1;
    }

    const correctionByBatchId = new Map(scope._batchCorrections.map((correction) => [correction.batchId, correction]));
    for (const batchId of publicScope.batchIdsToUpdate) {
      if (!approvedBatchIds.has(batchId)) throw new Error("Unapproved batch ID");
      const correction = correctionByBatchId.get(batchId);
      if (!correction) {
        throw Object.assign(
          new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: batch ${batchId} has no approved correction.`),
          { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
        );
      }
      const update = await client.query(
        `UPDATE factory_mix_batches
         SET cost_per_kg = $1,
             total_cost = $2,
             updated_at = NOW()
         WHERE id = $3
           AND company_id = $4
           AND deleted_at IS NULL`,
        [
          new Decimal(correction.expectedCostPerKg).toDecimalPlaces(6).toFixed(6),
          new Decimal(correction.expectedTotalCost).toDecimalPlaces(6).toFixed(6),
          batchId,
          companyId,
        ]
      );
      assertOne(update.rowCount, `batch ${batchId}`);
      result.batchesUpdated += 1;
    }

    if (approvedBaleIds.length > 0) {
      const baleRows = await client.query<{
        id: number;
        mix_batch_id: number | null;
        weight_kg: string;
      }>(
        `SELECT id, mix_batch_id, weight_kg
         FROM factory_bales
         WHERE id = ANY($1)
           AND company_id = $2
           AND deleted_at IS NULL
         ORDER BY id`,
        [approvedBaleIds, companyId]
      );
      assertSameIds(approvedBaleIds, baleRows.rows.map((row) => row.id), "approved bale");

      for (const bale of baleRows.rows) {
        if (bale.mix_batch_id == null || !approvedBatchIds.has(bale.mix_batch_id)) {
          throw Object.assign(
            new Error(`HISTORICAL_REPLAY_SCOPE_VIOLATION: bale ${bale.id} no longer belongs to an approved batch.`),
            { code: "HISTORICAL_REPLAY_SCOPE_VIOLATION" }
          );
        }
        const correction = correctionByBatchId.get(bale.mix_batch_id);
        if (!correction) throw new Error(`Missing correction for bale ${bale.id}`);
        const cost = new Decimal(correction.expectedCostPerKg);
        const update = await client.query(
          `UPDATE factory_bales
           SET cost_per_kg = $1,
               total_cost = $2,
               updated_at = NOW()
           WHERE id = $3
             AND company_id = $4
             AND mix_batch_id = $5
             AND deleted_at IS NULL`,
          [
            cost.toDecimalPlaces(6).toFixed(6),
            new Decimal(bale.weight_kg || "0").times(cost).toDecimalPlaces(6).toFixed(6),
            bale.id,
            companyId,
            bale.mix_batch_id,
          ]
        );
        assertOne(update.rowCount, `bale ${bale.id}`);
        result.balesUpdated += 1;
      }
    }

    const supplierRowById = new Map(scope._safeSupplierRows.map((supplier) => [supplier.supplierId, supplier]));
    for (const supplierId of publicScope.supplierIds) {
      if (!approvedSupplierIds.has(supplierId)) throw new Error("Unapproved supplier ID");
      const supplier = supplierRowById.get(supplierId);
      if (!supplier) throw new Error(`Missing supplier replay result ${supplierId}`);
      if (supplier.endingExpectedRate > 0) {
        const update = await client.query(
          `UPDATE factory_suppliers
           SET current_raw_material_cost_per_kg_usd = $1,
               updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [
            new Decimal(supplier.endingExpectedRate).toDecimalPlaces(8).toFixed(8),
            supplierId,
            companyId,
          ]
        );
        assertOne(update.rowCount, `supplier ${supplierId}`);
        result.supplierRatesUpdated += 1;
      }
      result.suppliersApplied += 1;
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
