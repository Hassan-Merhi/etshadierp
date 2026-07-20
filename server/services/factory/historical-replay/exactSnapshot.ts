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
  nonCostState: Record<string, unknown>;
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
  nonCostState: Record<string, unknown>;
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
  nonCostState: Record<string, unknown>;
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
  nonCostState: Record<string, unknown>;
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
  nonCostState: Record<string, unknown>;
}

export interface ExactReplaySupplierRow {
  id: number;
  currentRawMaterialCostPerKgUsd: string | null;
  companyId: number;
  nonCostState: Record<string, unknown>;
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

/**
 * Capture literal approved write IDs only. Each row also carries a JSONB image of
 * every column except the exact cost fields replay is authorized to change (and
 * updated_at, which cost writes intentionally touch). This makes cost-only
 * invariants future-proof when new business columns are added.
 */
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
      `SELECT fc.id,
              fc.final_payable_amount AS "finalPayableAmount",
              fc.rate_per_kg_usd AS "ratePerKgUsd",
              fc.final_payable_amount_usd AS "finalPayableAmountUsd",
              fc.supplier_id AS "supplierId",
              fc.status,
              fc.actual_received_kg AS "actualReceivedKg",
              fc.total_kg AS "totalKg",
              fc.declared_kg AS "declaredKg",
              fc.company_id AS "companyId",
              (to_jsonb(fc) - 'rate_per_kg_usd' - 'final_payable_amount_usd' - 'updated_at') AS "nonCostState"
       FROM factory_containers fc
       WHERE fc.id = ANY($1) AND fc.company_id = $2
       ORDER BY fc.id`,
      [containerIds, companyId]
    ),
    executor.query<ExactReplayRawStockRow>(
      `SELECT frs.id,
              frs.cost_per_kg AS "costPerKg",
              frs.cost_per_kg_usd AS "costPerKgUsd",
              frs.received_kg AS "receivedKg",
              frs.used_kg AS "usedKg",
              frs.container_id AS "containerId",
              frs.company_id AS "companyId",
              frs.deleted_at AS "deletedAt",
              (to_jsonb(frs) - 'cost_per_kg_usd' - 'updated_at') AS "nonCostState"
       FROM factory_raw_stock frs
       WHERE frs.id = ANY($1) AND frs.company_id = $2
       ORDER BY frs.id`,
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
              mbs.mix_batch_id AS "mixBatchId",
              (to_jsonb(mbs) - 'cost_per_kg' - 'total_cost') AS "nonCostState"
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
       WHERE mbs.id = ANY($1) AND mb.company_id = $2
       ORDER BY mbs.id`,
      [sourceIds, companyId]
    ),
    executor.query<ExactReplayBatchRow>(
      `SELECT mb.id,
              mb.cost_per_kg AS "costPerKg",
              mb.total_cost AS "totalCost",
              mb.total_weight_kg AS "totalWeightKg",
              mb.used_kg AS "usedKg",
              mb.status,
              mb.company_id AS "companyId",
              mb.deleted_at AS "deletedAt",
              (to_jsonb(mb) - 'cost_per_kg' - 'total_cost' - 'updated_at') AS "nonCostState"
       FROM factory_mix_batches mb
       WHERE mb.id = ANY($1) AND mb.company_id = $2
       ORDER BY mb.id`,
      [batchIds, companyId]
    ),
    executor.query<ExactReplayBaleRow>(
      `SELECT fb.id,
              fb.cost_per_kg AS "costPerKg",
              fb.total_cost AS "totalCost",
              fb.weight_kg AS "weightKg",
              fb.quantity,
              fb.status,
              fb.mix_batch_id AS "mixBatchId",
              fb.erp_location_id AS "erpLocationId",
              fb.pressing_batch_id AS "pressingBatchId",
              fb.finalized_at AS "finalizedAt",
              fb.company_id AS "companyId",
              fb.deleted_at AS "deletedAt",
              (to_jsonb(fb) - 'cost_per_kg' - 'total_cost' - 'updated_at') AS "nonCostState"
       FROM factory_bales fb
       WHERE fb.id = ANY($1) AND fb.company_id = $2
       ORDER BY fb.id`,
      [baleIds, companyId]
    ),
    executor.query<ExactReplaySupplierRow>(
      `SELECT fs.id,
              fs.current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd",
              fs.company_id AS "companyId",
              (to_jsonb(fs) - 'current_raw_material_cost_per_kg_usd' - 'updated_at') AS "nonCostState"
       FROM factory_suppliers fs
       WHERE fs.id = ANY($1) AND fs.company_id = $2
       ORDER BY fs.id`,
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
