import type { ReplayQueryExecutor, ReplayWriteScope } from "./types";

export interface ExactReplayContainerRow {
  id: number;
  finalPayableAmount: string | null;
  ratePerKgUsd: string | null;
  finalPayableAmountUsd: string | null;
  supplierId: number | null;
  status: string | null;
  actualReceivedKg: string | null;
  totalKg: string | null;
  declaredKg: string | null;
  companyId: number;
}

export interface ExactReplayRawStockRow {
  id: number;
  costPerKg: string | null;
  costPerKgUsd: string | null;
  receivedKg: string;
  usedKg: string;
  containerId: number;
  companyId: number;
  deletedAt: Date | string | null;
}

export interface ExactReplaySourceRow {
  id: number;
  costPerKg: string;
  totalCost: string;
  supplierId: number | null;
  containerId: number | null;
  sourceBatchId: number | null;
  sourceType: string | null;
  sourceId: number | null;
  weightKg: string;
  quantityKg: string | null;
  mixBatchId: number;
}

export interface ExactReplayBatchRow {
  id: number;
  costPerKg: string;
  totalCost: string;
  totalWeightKg: string;
  usedKg: string;
  status: string;
  companyId: number;
  deletedAt: Date | string | null;
}

export interface ExactReplayBaleRow {
  id: number;
  costPerKg: string;
  totalCost: string;
  weightKg: string;
  quantity: number;
  status: string;
  mixBatchId: number | null;
  erpLocationId: number | null;
  pressingBatchId: number | null;
  finalizedAt: Date | string | null;
  companyId: number;
  deletedAt: Date | string | null;
}

export interface ExactReplaySupplierRow {
  id: number;
  currentRawMaterialCostPerKgUsd: string | null;
  companyId: number;
}

export interface ExactReplaySnapshot {
  containers: ExactReplayContainerRow[];
  rawStockRows: ExactReplayRawStockRow[];
  mixBatchSources: ExactReplaySourceRow[];
  mixBatches: ExactReplayBatchRow[];
  bales: ExactReplayBaleRow[];
  suppliers: ExactReplaySupplierRow[];
}

function idsOrSentinel(ids: number[]): number[] {
  return ids.length > 0 ? ids : [-1];
}

export function replayBaleIdsForScope(
  scope: ReplayWriteScope,
  includeFinalizedBales: boolean
): number[] {
  const ids = includeFinalizedBales
    ? [...scope.availableBaleIdsToUpdate, ...scope.finalizedBaleIdsToUpdate]
    : [...scope.availableBaleIdsToUpdate];
  return [...new Set(ids)].sort((left, right) => left - right);
}

/** Lock every literal row authorized by the signed scope before apply or undo. */
export async function lockExactReplayScopeRows(
  executor: ReplayQueryExecutor,
  companyId: number,
  scope: ReplayWriteScope,
  baleIdsToUpdate: number[]
): Promise<void> {
  if (scope.supplierIds.length > 0) {
    await executor.query(
      `SELECT id FROM factory_suppliers
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id FOR UPDATE`,
      [scope.supplierIds, companyId]
    );
  }
  if (scope.containerIdsToUpdate.length > 0) {
    await executor.query(
      `SELECT id FROM factory_containers
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id FOR UPDATE`,
      [scope.containerIdsToUpdate, companyId]
    );
  }
  if (scope.rawStockIdsToUpdate.length > 0) {
    await executor.query(
      `SELECT id FROM factory_raw_stock
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id FOR UPDATE`,
      [scope.rawStockIdsToUpdate, companyId]
    );
  }
  if (scope.batchIdsToUpdate.length > 0) {
    await executor.query(
      `SELECT id FROM factory_mix_batches
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id FOR UPDATE`,
      [scope.batchIdsToUpdate, companyId]
    );
  }
  if (scope.sourceIdsToUpdate.length > 0) {
    await executor.query(
      `SELECT mbs.id
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
       WHERE mbs.id = ANY($1) AND mb.company_id = $2
       ORDER BY mbs.id FOR UPDATE OF mbs`,
      [scope.sourceIdsToUpdate, companyId]
    );
  }
  if (baleIdsToUpdate.length > 0) {
    await executor.query(
      `SELECT id FROM factory_bales
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id FOR UPDATE`,
      [baleIdsToUpdate, companyId]
    );
  }
}

/** Capture literal approved write IDs only. */
export async function captureExactReplaySnapshot(
  executor: ReplayQueryExecutor,
  companyId: number,
  scope: ReplayWriteScope,
  baleIdsToUpdate: number[]
): Promise<ExactReplaySnapshot> {
  const supplierIds = idsOrSentinel(scope.supplierIds);
  const containerIds = idsOrSentinel(scope.containerIdsToUpdate);
  const rawStockIds = idsOrSentinel(scope.rawStockIdsToUpdate);
  const sourceIds = idsOrSentinel(scope.sourceIdsToUpdate);
  const batchIds = idsOrSentinel(scope.batchIdsToUpdate);
  const baleIds = idsOrSentinel(baleIdsToUpdate);

  const [containerResult, rawStockResult, sourceResult, batchResult, baleResult, supplierResult] = await Promise.all([
    executor.query<ExactReplayContainerRow>(
      `SELECT id,
              final_payable_amount AS "finalPayableAmount",
              rate_per_kg_usd AS "ratePerKgUsd",
              final_payable_amount_usd AS "finalPayableAmountUsd",
              supplier_id AS "supplierId",
              status,
              actual_received_kg AS "actualReceivedKg",
              total_kg AS "totalKg",
              declared_kg AS "declaredKg",
              company_id AS "companyId"
       FROM factory_containers
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id`,
      [containerIds, companyId]
    ),
    executor.query<ExactReplayRawStockRow>(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              cost_per_kg_usd AS "costPerKgUsd",
              received_kg AS "receivedKg",
              used_kg AS "usedKg",
              container_id AS "containerId",
              company_id AS "companyId",
              deleted_at AS "deletedAt"
       FROM factory_raw_stock
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id`,
      [rawStockIds, companyId]
    ),
    executor.query<ExactReplaySourceRow>(
      `SELECT mbs.id,
              mbs.cost_per_kg AS "costPerKg",
              mbs.total_cost AS "totalCost",
              mbs.supplier_id AS "supplierId",
              mbs.container_id AS "containerId",
              mbs.source_batch_id AS "sourceBatchId",
              mbs.source_type AS "sourceType",
              mbs.source_id AS "sourceId",
              mbs.weight_kg AS "weightKg",
              mbs.quantity_kg AS "quantityKg",
              mbs.mix_batch_id AS "mixBatchId"
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
       WHERE mbs.id = ANY($1) AND mb.company_id = $2
       ORDER BY mbs.id`,
      [sourceIds, companyId]
    ),
    executor.query<ExactReplayBatchRow>(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              total_weight_kg AS "totalWeightKg",
              used_kg AS "usedKg",
              status,
              company_id AS "companyId",
              deleted_at AS "deletedAt"
       FROM factory_mix_batches
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id`,
      [batchIds, companyId]
    ),
    executor.query<ExactReplayBaleRow>(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              weight_kg AS "weightKg",
              quantity,
              status,
              mix_batch_id AS "mixBatchId",
              erp_location_id AS "erpLocationId",
              pressing_batch_id AS "pressingBatchId",
              finalized_at AS "finalizedAt",
              company_id AS "companyId",
              deleted_at AS "deletedAt"
       FROM factory_bales
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id`,
      [baleIds, companyId]
    ),
    executor.query<ExactReplaySupplierRow>(
      `SELECT id,
              current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd",
              company_id AS "companyId"
       FROM factory_suppliers
       WHERE id = ANY($1) AND company_id = $2
       ORDER BY id`,
      [supplierIds, companyId]
    ),
  ]);

  return {
    containers: containerResult.rows,
    rawStockRows: rawStockResult.rows,
    mixBatchSources: sourceResult.rows,
    mixBatches: batchResult.rows,
    bales: baleResult.rows,
    suppliers: supplierResult.rows,
  };
}
