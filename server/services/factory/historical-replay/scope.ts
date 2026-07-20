import crypto from "crypto";
import { pool } from "../../../db";
import {
  FINALIZED_BALE_STATUSES,
  REPLAY_ALGORITHM_VERSION,
  type ReplayQueryExecutor,
  type HistoricalReplayPreviewResult,
  type ReplayWriteScope,
  type ReplayScopeInternal,
  type ReplaySummary,
} from "./types";
import {
  previewHistoricalCostReplayWithExecutor,
  buildBatchConsumptionEvents,
  loadContainerUniverse,
  computeCanonicalCosts,
  computeBatchCorrections,
} from "./readModel";

export function computeReplayFingerprint(
  companyId: number,
  supplierIds: number[],
  preview: HistoricalReplayPreviewResult,
  opts: { includeCompletedBatches: boolean; includeFinalizedBales: boolean }
): string {
  const sortedSupplierIds = [...supplierIds].sort((left, right) => left - right);
  const payload = {
    algorithmVersion: REPLAY_ALGORITHM_VERSION,
    companyId,
    supplierIds: sortedSupplierIds,
    includeCompletedBatches: opts.includeCompletedBatches,
    includeFinalizedBales: opts.includeFinalizedBales,
    supplierEndingRates: preview.supplierRows
      .filter((supplier) => sortedSupplierIds.includes(supplier.supplierId))
      .sort((left, right) => left.supplierId - right.supplierId)
      .map((supplier) => ({
        id: supplier.supplierId,
        endingRate: supplier.endingExpectedRate,
        replayKg: supplier.replayRemainingKg,
        authoritativeKg: supplier.authoritativeRemainingKg,
        currentStoredRate: supplier.currentStoredRate,
        safeToRepair: supplier.safeToRepair,
      })),
    sourceData: preview.sourceRows
      .filter((source) => source.safeToRepair)
      .sort((left, right) => left.sourceId - right.sourceId)
      .map((source) => ({
        id: source.sourceId,
        supplierId: source.supplierId,
        containerId: source.containerId,
        batchId: source.batchId,
        pricingBasis: source.pricingBasis,
        weightKg: source.weightKg,
        storedCostPerKg: source.storedCostPerKg,
        expectedHistoricalCostPerKg: source.expectedHistoricalCostPerKg,
      })),
    batchData: preview.batchRows
      .sort((left, right) => left.batchId - right.batchId)
      .map((batch) => ({
        batchId: batch.batchId,
        status: batch.status,
        storedCostPerKg: batch.storedCostPerKg,
        expectedCostPerKg: batch.expectedCostPerKg,
        storedTotalCost: batch.storedTotalCost,
        expectedTotalCost: batch.expectedTotalCost,
      })),
    containerData: preview.containerRows
      .filter((container) => !container.fxUnresolved && sortedSupplierIds.includes(container.supplierId ?? -1))
      .sort((left, right) => left.containerId - right.containerId)
      .map((container) => ({
        id: container.containerId,
        supplierId: container.supplierId,
        storedCostPerKgUsd: container.storedCostPerKgUsd,
        canonicalCostPerKgUsd: container.canonicalCostPerKgUsd,
        storedTotalUsd: container.storedTotalUsd,
        canonicalTotalUsd: container.canonicalTotalUsd,
        safeToRepair: container.safeToRepair,
      })),
    summary: {
      sourceMismatches: preview.summary.sourceMismatches,
      batchesToUpdate: preview.summary.batchesToUpdate,
      completedBatchesToUpdate: preview.summary.completedBatchesToUpdate,
      balesToUpdate: preview.summary.balesToUpdate,
      finalizedBalesToUpdate: preview.summary.finalizedBalesToUpdate,
      unresolvedFx: preview.summary.unresolvedFx,
    },
    scopeIds: {
      sortedSupplierIds,
      safeSourceIds: preview.sourceRows.filter((source) => source.safeToRepair).map((source) => source.sourceId).sort((a, b) => a - b),
      batchIds: preview.batchRows.map((batch) => batch.batchId).sort((a, b) => a - b),
      containerIds: preview.containerRows
        .filter((container) => !container.fxUnresolved && sortedSupplierIds.includes(container.supplierId ?? -1))
        .map((container) => container.containerId)
        .sort((a, b) => a - b),
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildNotFinalizedClause(includeFinalizedBales: boolean): string {
  if (includeFinalizedBales) return `status NOT IN ('DELETED','REMOVED')`;
  return `status NOT IN ('DELETED','REMOVED','${FINALIZED_BALE_STATUSES.join("','")}')
          AND dispatch_batch_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM customer_order_bales WHERE bale_id = fb.id)
          AND NOT EXISTS (SELECT 1 FROM factory_invoice_loading_bales WHERE bale_id = fb.id)`;
}

export async function captureReplaySnapshot(
  client: ReplayQueryExecutor,
  companyId: number,
  supplierIds: number[],
  batchIds: number[],
  sourceIds: number[],
  baleIds: number[]
) {
  const safeSupplierIds = supplierIds.length ? supplierIds : [-1];
  const safeBatchIds = batchIds.length ? batchIds : [-1];
  const safeSourceIds = sourceIds.length ? sourceIds : [-1];
  const safeBaleIds = baleIds.length ? baleIds : [-1];

  const [rawStockResult, sourceResult, batchResult, baleResult, supplierResult, containerResult] = await Promise.all([
    client.query(
      `SELECT frs.id,
              frs.cost_per_kg AS "costPerKg",
              frs.cost_per_kg_usd AS "costPerKgUsd",
              frs.received_kg AS "receivedKg",
              frs.used_kg AS "usedKg",
              frs.container_id AS "containerId"
       FROM factory_raw_stock frs
       JOIN factory_containers fc ON fc.id = frs.container_id
       WHERE frs.company_id = $1
         AND fc.supplier_id = ANY($2)
         AND frs.deleted_at IS NULL`,
      [companyId, safeSupplierIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              supplier_id AS "supplierId",
              container_id AS "containerId",
              source_batch_id AS "sourceBatchId",
              weight_kg AS "weightKg",
              quantity_kg AS "quantityKg",
              mix_batch_id AS "mixBatchId"
       FROM factory_mix_batch_sources
       WHERE id = ANY($1)`,
      [safeSourceIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              total_weight_kg AS "totalWeightKg",
              status,
              used_kg AS "usedKg",
              company_id AS "companyId"
       FROM factory_mix_batches
       WHERE id = ANY($1)`,
      [safeBatchIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              weight_kg AS "weightKg",
              status,
              mix_batch_id AS "mixBatchId",
              location_id AS "locationId",
              company_id AS "companyId"
       FROM factory_bales
       WHERE id = ANY($1) AND company_id = $2`,
      [safeBaleIds, companyId]
    ),
    client.query(
      `SELECT id,
              current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd"
       FROM factory_suppliers
       WHERE id = ANY($1) AND company_id = $2`,
      [safeSupplierIds, companyId]
    ),
    client.query(
      `SELECT id,
              rate_per_kg_usd AS "ratePerKgUsd",
              final_payable_amount AS "finalPayableAmount",
              final_payable_amount_usd AS "finalPayableAmountUsd",
              supplier_id AS "supplierId",
              status,
              actual_received_kg AS "actualReceivedKg",
              total_kg AS "totalKg"
       FROM factory_containers
       WHERE supplier_id = ANY($1) AND company_id = $2`,
      [safeSupplierIds, companyId]
    ),
  ]);

  return {
    rawStockRows: rawStockResult.rows,
    mixBatchSources: sourceResult.rows,
    mixBatches: batchResult.rows,
    bales: baleResult.rows,
    suppliers: supplierResult.rows,
    containers: containerResult.rows,
  };
}

export async function computeReplayWriteScope(
  companyId: number,
  requestedSupplierIds: number[],
  preview: HistoricalReplayPreviewResult,
  opts: { includeCompletedBatches: boolean; includeFinalizedBales: boolean },
  executor: ReplayQueryExecutor = pool as ReplayQueryExecutor
): Promise<{
  safeSupplierIds: Set<number>;
  containerIds: Set<number>;
  batchIdsToApply: Set<number>;
  sourceIds: Set<number>;
  baleCount: number;
}> {
  const safeSupplierIds = new Set(
    preview.supplierRows
      .filter((supplier) => supplier.safeToRepair && (requestedSupplierIds.length === 0 || requestedSupplierIds.includes(supplier.supplierId)))
      .map((supplier) => supplier.supplierId)
  );
  if (safeSupplierIds.size === 0) {
    return { safeSupplierIds, containerIds: new Set(), batchIdsToApply: new Set(), sourceIds: new Set(), baleCount: 0 };
  }

  const { sourceInfos, batchInfoMap } = await buildBatchConsumptionEvents(executor, companyId, safeSupplierIds);
  const universe = await loadContainerUniverse(executor, companyId);
  const canonicals = await computeCanonicalCosts(executor, companyId, universe);
  const canonicalRates = new Map<number, number>();
  for (const canonical of canonicals) {
    if (!canonical.fxUnresolved) canonicalRates.set(canonical.universe.container.id, canonical.canonicalCostPerKgUsd);
  }
  const containerIds = new Set(
    preview.containerRows
      .filter((container) => !container.fxUnresolved && container.supplierId != null && safeSupplierIds.has(container.supplierId))
      .map((container) => container.containerId)
  );
  const expectedRates = new Map<string, number>();
  for (const source of preview.sourceRows) {
    if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) {
      const key = `${source.supplierId}:${source.batchId}`;
      if (!expectedRates.has(key)) expectedRates.set(key, source.expectedHistoricalCostPerKg);
    }
  }
  const { corrections } = computeBatchCorrections(batchInfoMap, sourceInfos, expectedRates, canonicalRates);
  const correctionIds = new Set(corrections.map((correction) => correction.batchId));
  const batchIdsToApply = new Set(
    preview.batchRows
      .filter((batch) => correctionIds.has(batch.batchId))
      .filter((batch) => opts.includeCompletedBatches || !["COMPLETED", "CLOSED"].includes(batch.status))
      .map((batch) => batch.batchId)
  );
  const sourceIds = new Set(
    preview.sourceRows
      .filter((source) => source.safeToRepair && batchIdsToApply.has(source.batchId))
      .filter((source) => {
        if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) return safeSupplierIds.has(source.supplierId);
        if (source.pricingBasis === "CONTAINER_DIRECT" && source.containerId != null) return canonicalRates.has(source.containerId);
        return false;
      })
      .map((source) => source.sourceId)
  );

  let baleCount = 0;
  if (batchIdsToApply.size) {
    const result = await executor.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
       FROM factory_bales fb
       WHERE fb.mix_batch_id = ANY($1)
         AND fb.company_id = $2
         AND ${buildNotFinalizedClause(opts.includeFinalizedBales)}`,
      [[...batchIdsToApply], companyId]
    );
    baleCount = Number.parseInt(result.rows[0]?.cnt ?? "0", 10);
  }
  return { safeSupplierIds, containerIds, batchIdsToApply, sourceIds, baleCount };
}

function emptySummary(): ReplaySummary {
  return {
    totalReceivedContainers: 0,
    containersScanned: 0,
    omittedContainers: 0,
    canonicalContainerMismatches: 0,
    suppliersScanned: 0,
    safeSuppliers: 0,
    manualReviewSuppliers: 0,
    supplierPricedSourcesScanned: 0,
    sourceMismatches: 0,
    batchesToUpdate: 0,
    completedBatchesToUpdate: 0,
    balesToUpdate: 0,
    finalizedBalesToUpdate: 0,
    unresolvedFx: 0,
    missingDates: 0,
    quantityTimelineMismatches: 0,
    ambiguousEventOrdering: 0,
    scanCoverageError: false,
  };
}

function emptyScope(): ReplayScopeInternal {
  return {
    supplierIds: [],
    containerIdsToUpdate: [],
    rawStockIdsToUpdate: [],
    sourceIdsToUpdate: [],
    batchIdsToUpdate: [],
    availableBaleIdsToUpdate: [],
    finalizedBaleIdsToUpdate: [],
    blockedBatches: [],
    _safeSupplierRows: [],
    _sourceInfos: [],
    _batchCorrections: [],
    _canonicalRateByContainer: new Map(),
    _canonicalTotalUsdByContainer: new Map(),
    _rawStockIdToContainer: new Map(),
    _fullPreview: { summary: emptySummary(), supplierRows: [], containerRows: [], sourceRows: [], batchRows: [] },
  };
}

export async function buildHistoricalReplayScope(params: {
  companyId: number;
  selectedSupplierIds: Set<number>;
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  executor: ReplayQueryExecutor;
}): Promise<ReplayWriteScope> {
  const internal = await buildHistoricalReplayScopeInternal({ ...params, lockRows: false });
  return {
    supplierIds: internal.supplierIds,
    containerIdsToUpdate: internal.containerIdsToUpdate,
    rawStockIdsToUpdate: internal.rawStockIdsToUpdate,
    sourceIdsToUpdate: internal.sourceIdsToUpdate,
    batchIdsToUpdate: internal.batchIdsToUpdate,
    availableBaleIdsToUpdate: internal.availableBaleIdsToUpdate,
    finalizedBaleIdsToUpdate: internal.finalizedBaleIdsToUpdate,
    blockedBatches: internal.blockedBatches,
  };
}

export async function buildHistoricalReplayScopeInternal(params: {
  companyId: number;
  selectedSupplierIds: Set<number>;
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  executor: ReplayQueryExecutor;
  lockRows?: boolean;
}): Promise<ReplayScopeInternal> {
  const {
    companyId,
    selectedSupplierIds,
    includeCompletedBatches,
    includeFinalizedBales,
    executor,
    lockRows = false,
  } = params;
  const supplierIdArray = [...selectedSupplierIds];
  if (supplierIdArray.length === 0) return emptyScope();

  if (lockRows) {
    await executor.query(
      `SELECT id FROM factory_suppliers WHERE id = ANY($1) AND company_id = $2 FOR UPDATE`,
      [supplierIdArray, companyId]
    );
    await executor.query(
      `SELECT id FROM factory_containers
       WHERE supplier_id = ANY($1) AND company_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [supplierIdArray, companyId]
    );
    await executor.query(
      `SELECT frs.id
       FROM factory_raw_stock frs
       JOIN factory_containers fc ON fc.id = frs.container_id
       WHERE frs.company_id = $1
         AND fc.supplier_id = ANY($2)
         AND frs.deleted_at IS NULL
       FOR UPDATE OF frs`,
      [companyId, supplierIdArray]
    );
    await executor.query(
      `SELECT mb.id
       FROM factory_mix_batches mb
       WHERE mb.company_id = $1
         AND mb.deleted_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM factory_mix_batch_sources mbs
           WHERE mbs.mix_batch_id = mb.id
             AND mbs.supplier_id = ANY($2)
         )
       FOR UPDATE OF mb`,
      [companyId, supplierIdArray]
    );
    await executor.query(
      `SELECT mbs.id
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
       WHERE mb.company_id = $1 AND mbs.supplier_id = ANY($2)
       FOR UPDATE OF mbs`,
      [companyId, supplierIdArray]
    );
  }

  const fullPreview = await previewHistoricalCostReplayWithExecutor(executor, companyId);
  const safeSupplierRows = fullPreview.supplierRows.filter(
    (supplier) => supplier.safeToRepair && selectedSupplierIds.has(supplier.supplierId)
  );
  const safeSupplierIds = new Set(safeSupplierRows.map((supplier) => supplier.supplierId));
  if (safeSupplierIds.size === 0) return { ...emptyScope(), _fullPreview: fullPreview };

  const expectedRates = new Map<string, number>();
  for (const source of fullPreview.sourceRows) {
    if (
      source.pricingBasis === "SUPPLIER_LOCKED_RATE"
      && source.supplierId != null
      && safeSupplierIds.has(source.supplierId)
    ) {
      const key = `${source.supplierId}:${source.batchId}`;
      if (!expectedRates.has(key)) expectedRates.set(key, source.expectedHistoricalCostPerKg);
    }
  }

  const { sourceInfos, batchInfoMap } = await buildBatchConsumptionEvents(executor, companyId, safeSupplierIds);
  const universe = await loadContainerUniverse(executor, companyId);
  const canonicals = await computeCanonicalCosts(executor, companyId, universe);
  const canonicalRateByContainer = new Map<number, number>();
  const canonicalTotalUsdByContainer = new Map<number, number>();
  for (const canonical of canonicals) {
    if (canonical.fxUnresolved) continue;
    canonicalRateByContainer.set(canonical.universe.container.id, canonical.canonicalCostPerKgUsd);
    canonicalTotalUsdByContainer.set(canonical.universe.container.id, canonical.canonicalTotalUsd);
  }

  const { corrections: batchCorrections, blockedBatches } = computeBatchCorrections(
    batchInfoMap,
    sourceInfos,
    expectedRates,
    canonicalRateByContainer
  );
  const batchIdsToUpdate = new Set(
    batchCorrections
      .filter((correction) => includeCompletedBatches || !["COMPLETED", "CLOSED"].includes(correction.status))
      .map((correction) => correction.batchId)
  );
  const sourceIdsToUpdate = sourceInfos
    .filter((source) => batchIdsToUpdate.has(source.batchId))
    .filter((source) => {
      if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) {
        return safeSupplierIds.has(source.supplierId);
      }
      if (source.pricingBasis === "CONTAINER_DIRECT" && source.containerId != null) {
        return canonicalRateByContainer.has(source.containerId);
      }
      return false;
    })
    .map((source) => source.sourceId);

  const containerIdsToUpdate = canonicals
    .filter((canonical) => !canonical.fxUnresolved)
    .filter((canonical) => {
      const supplierId = canonical.universe.container.supplierId;
      return supplierId != null && safeSupplierIds.has(supplierId);
    })
    .map((canonical) => canonical.universe.container.id);

  const rawStockIdToContainer = new Map<number, number>();
  if (containerIdsToUpdate.length > 0) {
    const rawStockResult = await executor.query<{ id: number; container_id: number }>(
      `SELECT id, container_id
       FROM factory_raw_stock
       WHERE company_id = $1
         AND container_id = ANY($2)
         AND deleted_at IS NULL`,
      [companyId, containerIdsToUpdate]
    );
    for (const row of rawStockResult.rows) rawStockIdToContainer.set(row.id, row.container_id);
    if (lockRows && rawStockIdToContainer.size > 0) {
      await executor.query(
        `SELECT id FROM factory_raw_stock WHERE id = ANY($1) AND company_id = $2 FOR UPDATE`,
        [[...rawStockIdToContainer.keys()], companyId]
      );
    }
  }

  const batchIdArray = [...batchIdsToUpdate];
  const availableBaleIdsToUpdate: number[] = [];
  const finalizedBaleIdsToUpdate: number[] = [];
  if (batchIdArray.length > 0) {
    const finalizedIn = FINALIZED_BALE_STATUSES.map((status) => `'${status}'`).join(",");
    const baleResult = await executor.query<{ id: number; is_finalized: boolean }>(
      `SELECT fb.id,
              (fb.status IN (${finalizedIn})
                OR fb.dispatch_batch_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM customer_order_bales cob WHERE cob.bale_id = fb.id)
                OR EXISTS (SELECT 1 FROM factory_invoice_loading_bales filb WHERE filb.bale_id = fb.id)
              ) AS is_finalized
       FROM factory_bales fb
       WHERE fb.mix_batch_id = ANY($1)
         AND fb.company_id = $2
         AND fb.status NOT IN ('DELETED','REMOVED')`,
      [batchIdArray, companyId]
    );
    for (const bale of baleResult.rows) {
      if (bale.is_finalized) finalizedBaleIdsToUpdate.push(bale.id);
      else availableBaleIdsToUpdate.push(bale.id);
    }

    if (lockRows) {
      const baleIdsToLock = includeFinalizedBales
        ? [...availableBaleIdsToUpdate, ...finalizedBaleIdsToUpdate]
        : availableBaleIdsToUpdate;
      if (baleIdsToLock.length > 0) {
        await executor.query(
          `SELECT id FROM factory_bales WHERE id = ANY($1) AND company_id = $2 FOR UPDATE`,
          [baleIdsToLock, companyId]
        );
      }
      await executor.query(
        `SELECT id FROM factory_mix_batches WHERE id = ANY($1) AND company_id = $2 FOR UPDATE`,
        [batchIdArray, companyId]
      );
      if (sourceIdsToUpdate.length > 0) {
        await executor.query(
          `SELECT mbs.id
           FROM factory_mix_batch_sources mbs
           JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
           WHERE mbs.id = ANY($1) AND mb.company_id = $2
           FOR UPDATE OF mbs`,
          [sourceIdsToUpdate, companyId]
        );
      }
    }
  }

  return {
    supplierIds: [...safeSupplierIds],
    containerIdsToUpdate,
    rawStockIdsToUpdate: [...rawStockIdToContainer.keys()],
    sourceIdsToUpdate,
    batchIdsToUpdate: batchIdArray,
    availableBaleIdsToUpdate,
    finalizedBaleIdsToUpdate,
    blockedBatches,
    _safeSupplierRows: safeSupplierRows,
    _sourceInfos: sourceInfos,
    _batchCorrections: batchCorrections,
    _canonicalRateByContainer: canonicalRateByContainer,
    _canonicalTotalUsdByContainer: canonicalTotalUsdByContainer,
    _rawStockIdToContainer: rawStockIdToContainer,
    _fullPreview: fullPreview,
  };
}

export async function classifyBalesByFinalization(
  baleIds: number[],
  includeFinalizedBales: boolean,
  executor: ReplayQueryExecutor
): Promise<{ availableIds: number[]; finalizedIds: number[] }> {
  if (baleIds.length === 0) return { availableIds: [], finalizedIds: [] };
  const finalizedIn = FINALIZED_BALE_STATUSES.map((status) => `'${status}'`).join(",");
  const result = await executor.query<{ id: number; is_finalized: boolean }>(
    `SELECT fb.id,
            (fb.status IN (${finalizedIn})
              OR fb.dispatch_batch_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM customer_order_bales cob WHERE cob.bale_id = fb.id)
              OR EXISTS (SELECT 1 FROM factory_invoice_loading_bales filb WHERE filb.bale_id = fb.id)
            ) AS is_finalized
     FROM factory_bales fb
     WHERE fb.id = ANY($1)`,
    [baleIds]
  );
  const availableIds: number[] = [];
  const finalizedIds: number[] = [];
  for (const row of result.rows) {
    if (row.is_finalized) {
      finalizedIds.push(row.id);
      if (includeFinalizedBales) availableIds.push(row.id);
    } else {
      availableIds.push(row.id);
    }
  }
  return { availableIds, finalizedIds };
}
