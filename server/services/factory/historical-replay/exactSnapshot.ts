import type { ReplayQueryExecutor, ReplayWriteScope } from "./types";

function idsOrSentinel(ids: number[]): number[] {
  return ids.length > 0 ? ids : [-1];
}

/**
 * Snapshot literal approved write IDs only. The legacy snapshot selected every
 * raw-stock/container row belonging to a supplier, which made undo broader than
 * the reviewed replay scope. This snapshot is cost-undo compatible with the
 * existing undo route while also retaining non-cost fields for later invariants.
 */
export async function captureExactReplaySnapshot(
  executor: ReplayQueryExecutor,
  companyId: number,
  scope: ReplayWriteScope,
  baleIdsToUpdate: number[]
) {
  const supplierIds = idsOrSentinel(scope.supplierIds);
  const containerIds = idsOrSentinel(scope.containerIdsToUpdate);
  const rawStockIds = idsOrSentinel(scope.rawStockIdsToUpdate);
  const sourceIds = idsOrSentinel(scope.sourceIdsToUpdate);
  const batchIds = idsOrSentinel(scope.batchIdsToUpdate);
  const baleIds = idsOrSentinel(baleIdsToUpdate);

  const [containerResult, rawStockResult, sourceResult, batchResult, baleResult, supplierResult] = await Promise.all([
    executor.query(
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
       WHERE id = ANY($1) AND company_id = $2`,
      [containerIds, companyId]
    ),
    executor.query(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              cost_per_kg_usd AS "costPerKgUsd",
              received_kg AS "receivedKg",
              used_kg AS "usedKg",
              container_id AS "containerId",
              company_id AS "companyId",
              deleted_at AS "deletedAt"
       FROM factory_raw_stock
       WHERE id = ANY($1) AND company_id = $2`,
      [rawStockIds, companyId]
    ),
    executor.query(
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
       WHERE mbs.id = ANY($1) AND mb.company_id = $2`,
      [sourceIds, companyId]
    ),
    executor.query(
      `SELECT id,
              cost_per_kg AS "costPerKg",
              total_cost AS "totalCost",
              total_weight_kg AS "totalWeightKg",
              used_kg AS "usedKg",
              status,
              company_id AS "companyId",
              deleted_at AS "deletedAt"
       FROM factory_mix_batches
       WHERE id = ANY($1) AND company_id = $2`,
      [batchIds, companyId]
    ),
    executor.query(
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
       WHERE id = ANY($1) AND company_id = $2`,
      [baleIds, companyId]
    ),
    executor.query(
      `SELECT id,
              current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd",
              company_id AS "companyId"
       FROM factory_suppliers
       WHERE id = ANY($1) AND company_id = $2`,
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
