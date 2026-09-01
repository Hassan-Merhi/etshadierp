import { computeContainerLandedCost } from "../../containerLandedCost";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
} from "@shared/schema";
import {
  type ReplayQueryExecutor,
  type ScanReason,
  type ContainerUniverse,
  type CanonicalContainer,
  rowToCamel,
  numeric,
} from "../types";

export async function loadContainerUniverse(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<ContainerUniverse[]> {
  const { rows } = await executor.query(
    `SELECT
       fc.id,
       fs.name AS supplier_name,
       fc.actual_received_kg,
       EXISTS (
         SELECT 1 FROM factory_raw_stock frs
         WHERE frs.container_id = fc.id
           AND frs.company_id = fc.company_id
           AND frs.deleted_at IS NULL
       ) AS has_active_rs,
       EXISTS (
         SELECT 1 FROM factory_raw_stock frs
         WHERE frs.container_id = fc.id
           AND frs.company_id = fc.company_id
           AND frs.deleted_at IS NOT NULL
       ) AS has_deleted_rs,
       EXISTS (
         SELECT 1 FROM factory_container_receipts fcr
         WHERE fcr.container_id = fc.id
           AND fcr.company_id = fc.company_id
           AND fcr.deleted_at IS NULL
       ) AS has_receipt_history,
       EXISTS (
         SELECT 1 FROM factory_daybook_entries fde
         WHERE fde.company_id = fc.company_id
           AND fde.tx_type = 'OFFLOAD_RAW_STOCK'
           AND (fde.meta_json::jsonb->>'containerId')::int = fc.id
       ) AS has_offload_daybook,
       EXISTS (
         SELECT 1 FROM factory_mix_batch_sources fmbs
         WHERE fmbs.container_id = fc.id
       ) AS has_mix_source,
       (
         SELECT MIN(fde.tx_date)::text
         FROM factory_daybook_entries fde
         WHERE fde.company_id = fc.company_id
           AND fde.tx_type = 'OFFLOAD_RAW_STOCK'
           AND (fde.meta_json::jsonb->>'containerId')::int = fc.id
       ) AS earliest_offload_date,
       (
         SELECT frs.offloaded_at::text
         FROM factory_raw_stock frs
         WHERE frs.container_id = fc.id
           AND frs.company_id = fc.company_id
         ORDER BY frs.offloaded_at
         LIMIT 1
       ) AS offloaded_at
     FROM factory_containers fc
     LEFT JOIN factory_suppliers fs
       ON fs.id = fc.supplier_id AND fs.company_id = fc.company_id
     WHERE fc.company_id = $1
       AND fc.deleted_at IS NULL
       AND fc.status != 'DELETED'
       AND (
         fc.actual_received_kg::numeric > 0
         OR EXISTS (SELECT 1 FROM factory_raw_stock frs WHERE frs.container_id = fc.id AND frs.company_id = fc.company_id)
         OR EXISTS (SELECT 1 FROM factory_container_receipts fcr WHERE fcr.container_id = fc.id AND fcr.company_id = fc.company_id AND fcr.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM factory_daybook_entries fde WHERE fde.company_id = fc.company_id AND fde.tx_type = 'OFFLOAD_RAW_STOCK' AND (fde.meta_json::jsonb->>'containerId')::int = fc.id)
         OR EXISTS (SELECT 1 FROM factory_mix_batch_sources fmbs WHERE fmbs.container_id = fc.id)
       )
     ORDER BY fc.id`,
    [companyId]
  );

  if (rows.length === 0) return [];
  const containerIds = rows.map((row) => row.id);
  const [containerResult, rawStockResult] = await Promise.all([
    executor.query(`SELECT * FROM factory_containers WHERE company_id = $1 AND id = ANY($2)`, [
      companyId,
      containerIds,
    ]),
    executor.query(`SELECT * FROM factory_raw_stock WHERE company_id = $1 AND container_id = ANY($2)`, [
      companyId,
      containerIds,
    ]),
  ]);

  const containers = containerResult.rows.map((row) => rowToCamel<typeof factoryContainers.$inferSelect>(row));
  const rawStockRows = rawStockResult.rows.map((row) => rowToCamel<typeof factoryRawStock.$inferSelect>(row));
  const containerMap = new Map(containers.map((container) => [container.id, container]));
  const activeRawStock = new Map<number, typeof factoryRawStock.$inferSelect>();
  const deletedRawStock = new Set<number>();

  for (const rawStock of rawStockRows) {
    if (rawStock.deletedAt) {
      deletedRawStock.add(rawStock.containerId);
      continue;
    }
    const existing = activeRawStock.get(rawStock.containerId);
    if (!existing || rawStock.id > existing.id) activeRawStock.set(rawStock.containerId, rawStock);
  }

  const result: ContainerUniverse[] = [];
  for (const row of rows) {
    const container = containerMap.get(row.id);
    if (!container) continue;

    let scanReason: ScanReason;
    if (row.has_active_rs) scanReason = "ACTIVE_RAW_STOCK";
    else if (row.has_deleted_rs) scanReason = "DELETED_RAW_STOCK";
    else if (row.has_receipt_history) scanReason = "RECEIPT_HISTORY";
    else if (row.has_offload_daybook) scanReason = "OFFLOAD_DAYBOOK";
    else if (row.has_mix_source) scanReason = "MIX_SOURCE_LINK";
    else scanReason = "CONTAINER_RECEIVED_FIELD";

    const offloadDate = row.earliest_offload_date
      ? String(row.earliest_offload_date).slice(0, 10)
      : row.offloaded_at
        ? String(row.offloaded_at).slice(0, 10)
        : null;

    result.push({
      container,
      supplierName: row.supplier_name ?? null,
      activeRawStock: activeRawStock.get(row.id) ?? null,
      deletedRawStockExists: deletedRawStock.has(row.id),
      receiptHistoryExists: Boolean(row.has_receipt_history),
      offloadDaybookExists: Boolean(row.has_offload_daybook),
      mixSourceLinkExists: Boolean(row.has_mix_source),
      scanReason,
      offloadDate,
    });
  }
  return result;
}

export async function computeCanonicalCosts(
  executor: ReplayQueryExecutor,
  companyId: number,
  universe: ContainerUniverse[]
): Promise<CanonicalContainer[]> {
  if (universe.length === 0) return [];

  const [additionalResult, commissionResult, otherResult] = await Promise.all([
    executor.query(`SELECT * FROM factory_offload_additional_charges WHERE company_id = $1`, [companyId]),
    executor.query(`SELECT * FROM factory_container_commissions WHERE company_id = $1`, [companyId]),
    executor.query(`SELECT * FROM factory_container_other_charges WHERE company_id = $1`, [companyId]),
  ]);

  const additionalCharges = additionalResult.rows.map((row) =>
    rowToCamel<typeof factoryOffloadAdditionalCharges.$inferSelect>(row)
  );
  const commissions = commissionResult.rows.map((row) =>
    rowToCamel<typeof factoryContainerCommissions.$inferSelect>(row)
  );
  const otherCharges = otherResult.rows.map((row) => rowToCamel<typeof factoryContainerOtherCharges.$inferSelect>(row));
  const chargesByContainer = new Map<number, (typeof factoryOffloadAdditionalCharges.$inferSelect)[]>();
  const commissionByContainer = new Map<number, typeof factoryContainerCommissions.$inferSelect>();
  const otherByContainer = new Map<number, (typeof factoryContainerOtherCharges.$inferSelect)[]>();

  for (const charge of additionalCharges) {
    const values = chargesByContainer.get(charge.containerId) ?? [];
    values.push(charge);
    chargesByContainer.set(charge.containerId, values);
  }
  for (const commission of commissions) {
    const existing = commissionByContainer.get(commission.containerId);
    if (!existing || commission.id > existing.id) commissionByContainer.set(commission.containerId, commission);
  }
  for (const charge of otherCharges) {
    const values = otherByContainer.get(charge.containerId) ?? [];
    values.push(charge);
    otherByContainer.set(charge.containerId, values);
  }

  return universe.map((entry) => {
    const { container, activeRawStock } = entry;
    const calculation = computeContainerLandedCost(
      container,
      chargesByContainer.get(container.id) ?? [],
      commissionByContainer.get(container.id) ?? null,
      otherByContainer.get(container.id) ?? []
    );
    const storedCostPerKgUsd = activeRawStock
      ? numeric(activeRawStock.costPerKgUsd || activeRawStock.costPerKg)
      : numeric(container.ratePerKgUsd || container.ratePerKg);
    const receivedKg = activeRawStock ? numeric(activeRawStock.receivedKg) : numeric(container.actualReceivedKg);

    return {
      universe: entry,
      canonicalCostPerKgUsd: calculation.costPerKgUsd,
      canonicalTotalUsd: calculation.fullCostUsd,
      storedCostPerKgUsd,
      storedTotalUsd: storedCostPerKgUsd * receivedKg,
      fxUnresolved: calculation.fxUnresolved,
      safeToRepair: !calculation.fxUnresolved,
      reason: calculation.fxUnresolved ? "UNRESOLVED_FX" : null,
    };
  });
}
