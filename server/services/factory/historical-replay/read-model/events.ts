import { resolveMixSourcePricingBasis } from "../../mixSourcePricingBasis";
import {
  factoryMixBatchSources,
  factoryMixBatches,
  factoryRawMaterialAdjustments,
  factoryContainerReceipts,
} from "@shared/schema";
import {
  type ReplayQueryExecutor,
  type CanonicalContainer,
  type BatchInfo,
  type SourceInfo,
  rowToCamel,
  numeric,
} from "../types";

export interface ContainerReceiptEvent {
  containerId: number;
  supplierId: number | null;
  effectiveDate: string;
  receiptKg: number;
  canonicalRateUsd: number;
  createdAt: number;
  stableId: number;
}

export async function buildReceiptEvents(
  executor: ReplayQueryExecutor,
  companyId: number,
  canonicals: CanonicalContainer[]
): Promise<ContainerReceiptEvent[]> {
  const containerIds = canonicals.map((item) => item.universe.container.id);
  if (containerIds.length === 0) return [];

  const receiptResult = await executor.query(
    `SELECT * FROM factory_container_receipts
     WHERE company_id = $1 AND container_id = ANY($2) AND deleted_at IS NULL`,
    [companyId, containerIds]
  );
  const receipts = receiptResult.rows.map((row) => rowToCamel<typeof factoryContainerReceipts.$inferSelect>(row));
  const byContainer = new Map<number, (typeof factoryContainerReceipts.$inferSelect)[]>();
  for (const receipt of receipts) {
    const values = byContainer.get(receipt.containerId) ?? [];
    values.push(receipt);
    byContainer.set(receipt.containerId, values);
  }

  const events: ContainerReceiptEvent[] = [];
  for (const canonical of canonicals) {
    if (canonical.fxUnresolved) continue;
    const { container, activeRawStock, offloadDate } = canonical.universe;
    const containerReceipts = byContainer.get(container.id);
    if (containerReceipts?.length) {
      for (const receipt of containerReceipts) {
        events.push({
          containerId: container.id,
          supplierId: container.supplierId ?? null,
          effectiveDate: receipt.receiptDate ? String(receipt.receiptDate).slice(0, 10) : "",
          receiptKg: numeric(receipt.receivedKg),
          canonicalRateUsd: canonical.canonicalCostPerKgUsd,
          createdAt: receipt.createdAt ? new Date(receipt.createdAt).getTime() : 0,
          stableId: receipt.id,
        });
      }
      continue;
    }

    const receivedKg = activeRawStock ? numeric(activeRawStock.receivedKg) : numeric(container.actualReceivedKg);
    if (receivedKg <= 0) continue;
    events.push({
      containerId: container.id,
      supplierId: container.supplierId ?? null,
      effectiveDate: offloadDate ?? "",
      receiptKg: receivedKg,
      canonicalRateUsd: canonical.canonicalCostPerKgUsd,
      createdAt: activeRawStock?.offloadedAt ? new Date(activeRawStock.offloadedAt).getTime() : 0,
      stableId: container.id * -1,
    });
  }
  return events;
}

export interface AdjustmentEvent {
  supplierId: number;
  effectiveDate: string;
  kind: "ADD_ADJUSTMENT" | "REMOVE_ADJUSTMENT" | "DEDUCT_ADJUSTMENT";
  adjustKg: number;
  costPerKgUsd: number | null;
  valuationBasis?: string;
  createdAt: number;
  stableId: number;
}

export async function buildAdjustmentEvents(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<{ events: AdjustmentEvent[]; unclassifiedCount: number }> {
  const result = await executor.query(
    `SELECT * FROM factory_raw_material_adjustments
     WHERE company_id = $1 AND deleted_at IS NULL AND supplier_id IS NOT NULL`,
    [companyId]
  );
  let unclassifiedCount = 0;
  const events: AdjustmentEvent[] = result.rows
    .map((row) => rowToCamel<typeof factoryRawMaterialAdjustments.$inferSelect>(row))
    .map((row) => {
      const type = String(row.type).toUpperCase();
      const kind: AdjustmentEvent["kind"] =
        type === "ADD" ? "ADD_ADJUSTMENT" : type === "REMOVE" ? "REMOVE_ADJUSTMENT" : "DEDUCT_ADJUSTMENT";
      const rawCost = numeric(row.costPerKg);
      const currency = row.currencyCode || "USD";
      const valuationBasis = row.valuationBasis as string | undefined | null;

      // Flag unclassified valued ADD adjustments — must block apply for that supplier.
      if (type === "ADD" && rawCost > 0 && !valuationBasis) {
        unclassifiedCount += 1;
      }

      return {
        supplierId: row.supplierId!,
        effectiveDate: row.date ? String(row.date).slice(0, 10) : "",
        kind,
        adjustKg: numeric(row.kg),
        // Pass cost and valuationBasis for use in replaySupplierTimeline.
        costPerKgUsd: type === "ADD" && currency === "USD" && rawCost > 0 ? rawCost : null,
        valuationBasis: valuationBasis ?? undefined,
        createdAt: row.createdAt ? new Date(row.createdAt).getTime() : 0,
        stableId: row.id,
      } as AdjustmentEvent & { valuationBasis?: string };
    });
  return { events, unclassifiedCount };
}

export interface BatchConsumptionEvent {
  supplierId: number;
  effectiveDate: string;
  batchId: number;
  batchCode: string;
  consumptionKg: number;
  sourceIds: number[];
  createdAt: number;
  stableId: number;
}

export async function buildBatchConsumptionEvents(
  executor: ReplayQueryExecutor,
  companyId: number,
  supplierIds: Set<number>
): Promise<{
  events: BatchConsumptionEvent[];
  batchInfoMap: Map<number, BatchInfo>;
  sourceInfos: SourceInfo[];
}> {
  const batchResult = await executor.query(
    `SELECT * FROM factory_mix_batches WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  const batchRows = batchResult.rows.map((row) => rowToCamel<typeof factoryMixBatches.$inferSelect>(row));
  const batchIds = batchRows.map((batch) => batch.id);
  if (batchIds.length === 0) return { events: [], batchInfoMap: new Map(), sourceInfos: [] };

  const sourceResult = await executor.query(`SELECT * FROM factory_mix_batch_sources WHERE mix_batch_id = ANY($1)`, [
    batchIds,
  ]);
  const sourceRows = sourceResult.rows.map((row) => rowToCamel<typeof factoryMixBatchSources.$inferSelect>(row));
  const batchInfoMap = new Map<number, BatchInfo>();
  for (const batch of batchRows) {
    batchInfoMap.set(batch.id, {
      batchId: batch.id,
      batchCode: batch.batchCode,
      batchDate: batch.batchDate ? String(batch.batchDate).slice(0, 10) : null,
      status: batch.status,
      createdAt: batch.createdAt ? new Date(batch.createdAt).getTime() : 0,
      storedCostPerKg: numeric(batch.costPerKg),
      storedTotalCost: numeric(batch.totalCost),
      totalWeightKg: numeric(batch.totalWeightKg),
    });
  }

  // Source type priority for inventory ownership resolution:
  //   1. pricingBasis = "BATCH"          → upstream batch already deducted; skip consumption event
  //   2. pricingBasis = "SUPPLIER_LOCKED_RATE" → use supplierId (or inventorySupplierId) as owner
  //   3. pricingBasis = "CONTAINER_DIRECT"     → use container's supplierId via inventorySupplierId

  // Load container supplier map for fallback inventory-supplier derivation
  // when the persisted inventory_supplier_id column is null (pre-V7 rows).
  const containerIds = [
    ...new Set(
      sourceRows
        .filter((s) => s.containerId != null && s.sourceBatchId == null && s.supplierId == null)
        .map((s) => s.containerId as number)
    ),
  ];
  const containerSupplierMap = new Map<number, number | null>();
  if (containerIds.length > 0) {
    const res = await executor.query<{ id: number; supplier_id: number | null }>(
      `SELECT id, supplier_id FROM factory_containers WHERE id = ANY($1)`,
      [containerIds]
    );
    for (const row of res.rows) containerSupplierMap.set(row.id, row.supplier_id ?? null);
  }

  const sourceInfos = sourceRows.map<SourceInfo>((source) => {
    // Prefer the persisted column (added by V7 migration). Fall back to derivation
    // for defensive compatibility with pre-migration rows.
    let inventorySupplierId: number | null = source.inventorySupplierId ?? null;
    if (inventorySupplierId == null && source.sourceBatchId == null) {
      if (source.supplierId != null) {
        inventorySupplierId = source.supplierId;
      } else if (source.containerId != null) {
        inventorySupplierId = containerSupplierMap.get(source.containerId) ?? null;
      }
    }
    return {
      sourceId: source.id,
      batchId: source.mixBatchId,
      batchCode: batchInfoMap.get(source.mixBatchId)?.batchCode ?? `#${source.mixBatchId}`,
      batchDate: batchInfoMap.get(source.mixBatchId)?.batchDate ?? null,
      supplierId: source.supplierId ?? null,
      containerId: source.containerId ?? null,
      sourceBatchId: source.sourceBatchId ?? null,
      weightKg: numeric(source.weightKg),
      storedCostPerKg: numeric(source.costPerKg),
      storedTotalCost: numeric(source.totalCost),
      pricingBasis: resolveMixSourcePricingBasis({
        sourceBatchId: source.sourceBatchId,
        supplierId: source.supplierId,
        containerId: source.containerId,
      }),
      inventorySupplierId,
    };
  });

  const eventMap = new Map<string, BatchConsumptionEvent>();
  for (const source of sourceInfos) {
    // BATCH sources don't directly deduct supplier inventory (the upstream batch already did).
    if (source.pricingBasis === "BATCH") continue;
    // MANUAL_REVIEW sources are blocked — no consumption event.
    if (source.pricingBasis === "MANUAL_REVIEW") continue;
    // Use inventorySupplierId (explicit ownership), not supplierId (pricing ownership).
    const inventorySupplierId = source.inventorySupplierId;
    if (inventorySupplierId == null) continue; // INVENTORY_SUPPLIER_UNRESOLVED — counted in summary
    if (!supplierIds.has(inventorySupplierId)) continue;
    const batch = batchInfoMap.get(source.batchId);
    if (!batch) continue;
    const key = `${inventorySupplierId}:${source.batchId}`;
    let event = eventMap.get(key);
    if (!event) {
      event = {
        supplierId: inventorySupplierId,
        effectiveDate: batch.batchDate ?? "",
        batchId: source.batchId,
        batchCode: batch.batchCode,
        consumptionKg: 0,
        sourceIds: [],
        createdAt: batch.createdAt,
        stableId: source.batchId,
      };
      eventMap.set(key, event);
    }
    event.consumptionKg += source.weightKg;
    event.sourceIds.push(source.sourceId);
  }
  return { events: [...eventMap.values()], batchInfoMap, sourceInfos };
}
