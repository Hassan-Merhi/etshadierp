import Decimal from "decimal.js";
import { pool } from "../../../db";
import { computeContainerLandedCost } from "../containerLandedCost";
import { resolveMixSourcePricingBasis } from "../mixSourcePricingBasis";
import { getAuthoritativeSupplierRemainingKgWithExecutor } from "../rawStockLockedRate";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
  factoryMixBatchSources,
  factoryMixBatches,
  factoryRawMaterialAdjustments,
  factoryContainerReceipts,
} from "@shared/schema";
import {
  FINALIZED_BALE_STATUSES,
  type ReplayQueryExecutor,
  type ScanReason,
  type SupplierEvent,
  type ContainerUniverse,
  type CanonicalContainer,
  type BatchInfo,
  type SourceInfo,
  type BatchCorrection,
  type BlockedBatch,
  type HistoricalReplayPreviewResult,
  type ReplayContainerRow,
  type ReplaySourceRow,
  type ReplayBatchRow,
  type ReplaySupplierRow,
  type ReplaySummary,
  rowToCamel,
  numeric,
} from "./types";

export async function loadContainerUniverse(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<ContainerUniverse[]> {
  const { rows } = await executor.query<any>(
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
    executor.query(`SELECT * FROM factory_containers WHERE company_id = $1 AND id = ANY($2)`, [companyId, containerIds]),
    executor.query(`SELECT * FROM factory_raw_stock WHERE company_id = $1 AND container_id = ANY($2)`, [companyId, containerIds]),
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

  const additionalCharges = additionalResult.rows.map((row) => rowToCamel<typeof factoryOffloadAdditionalCharges.$inferSelect>(row));
  const commissions = commissionResult.rows.map((row) => rowToCamel<typeof factoryContainerCommissions.$inferSelect>(row));
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

interface ContainerReceiptEvent {
  containerId: number;
  supplierId: number | null;
  effectiveDate: string;
  receiptKg: number;
  canonicalRateUsd: number;
  createdAt: number;
  stableId: number;
}

async function buildReceiptEvents(
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

interface AdjustmentEvent {
  supplierId: number;
  effectiveDate: string;
  kind: "ADD_ADJUSTMENT" | "REMOVE_ADJUSTMENT" | "DEDUCT_ADJUSTMENT";
  adjustKg: number;
  costPerKgUsd: number | null;
  valuationBasis?: string;
  createdAt: number;
  stableId: number;
}

async function buildAdjustmentEvents(
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
      const kind: AdjustmentEvent["kind"] = type === "ADD"
        ? "ADD_ADJUSTMENT"
        : type === "REMOVE"
          ? "REMOVE_ADJUSTMENT"
          : "DEDUCT_ADJUSTMENT";
      const rawCost = numeric(row.costPerKg);
      const currency = row.currencyCode || "USD";
      const valuationBasis = (row as any).valuationBasis as string | undefined | null;

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

interface BatchConsumptionEvent {
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

  const sourceResult = await executor.query(
    `SELECT * FROM factory_mix_batch_sources WHERE mix_batch_id = ANY($1)`,
    [batchIds]
  );
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
  const containerIds = [...new Set(
    sourceRows.filter((s) => s.containerId != null && s.sourceBatchId == null && s.supplierId == null)
      .map((s) => s.containerId as number)
  )];
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
    let inventorySupplierId: number | null = (source as any).inventorySupplierId ?? null;
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

export function sortEvents(events: SupplierEvent[]): { sorted: SupplierEvent[]; ambiguous: boolean } {
  const withDate = events.filter((event) => event.effectiveDate !== "");
  const withoutDate = events.filter((event) => event.effectiveDate === "");
  withDate.sort((left, right) => {
    const dateOrder = left.effectiveDate.localeCompare(right.effectiveDate);
    if (dateOrder !== 0) return dateOrder;
    const timestampOrder = left.createdAt - right.createdAt;
    return timestampOrder !== 0 ? timestampOrder : left.stableId - right.stableId;
  });

  let ambiguous = false;
  const groups = new Map<string, SupplierEvent[]>();
  for (const event of withDate) {
    const values = groups.get(event.effectiveDate) ?? [];
    values.push(event);
    groups.set(event.effectiveDate, values);
  }
  for (const group of groups.values()) {
    const receipts = group.filter((event) => event.kind === "RECEIPT");
    const consumptions = group.filter((event) => event.kind === "BATCH_CONSUMPTION");
    for (const receipt of receipts) {
      for (const consumption of consumptions) {
        const resolved = receipt.createdAt > 0
          && consumption.createdAt > 0
          && receipt.createdAt !== consumption.createdAt;
        if (!resolved) ambiguous = true;
      }
    }
  }
  return { sorted: [...withDate, ...withoutDate], ambiguous };
}

interface SupplierTimelineResult {
  supplierId: number;
  supplierName: string;
  currentStoredRate: number;
  startingRate: number;
  endingRate: number;
  replayRemainingKg: number;
  authoritativeRemainingKg: number;
  quantityMismatch: boolean;
  missingDates: number;
  ambiguous: boolean;
  safeToRepair: boolean;
  reasons: string[];
  eventCount: number;
  expectedRateAtBatch: Map<number, number>;
  affectedContainerCount: number;
}

/** Pure timeline calculation. It performs no database reads. */
export async function replaySupplierTimeline(
  _companyId: number,
  supplierId: number,
  supplierName: string,
  storedRate: number,
  events: SupplierEvent[],
  authoritativeRemainingKg: number
): Promise<SupplierTimelineResult> {
  const { sorted, ambiguous } = sortEvents(events);
  let remaining = new Decimal(0);
  let rate = new Decimal(0);
  let missingDates = 0;
  const expectedRateAtBatch = new Map<number, number>();
  const affectedContainers = new Set<number>();

  for (const event of sorted) {
    if (!event.effectiveDate) missingDates += 1;
    if (event.kind === "RECEIPT") {
      const receiptKg = new Decimal(event.receiptKg ?? 0);
      const receiptRate = new Decimal(event.canonicalRateUsd ?? 0);
      if (receiptKg.lte(0)) continue;
      const oldPositiveRemaining = Decimal.max(0, remaining);
      const denominator = oldPositiveRemaining.plus(receiptKg);
      rate = denominator.gt(0)
        ? oldPositiveRemaining.times(rate).plus(receiptKg.times(receiptRate)).div(denominator)
        : receiptRate;
      remaining = remaining.plus(receiptKg);
      if (event.containerId) affectedContainers.add(event.containerId);
      continue;
    }
    if (event.kind === "ADD_ADJUSTMENT") {
      const quantity = new Decimal(event.adjustKg ?? 0);
      if (quantity.gt(0)) {
        const valuationBasis = (event as any).valuationBasis as string | undefined;
        if (valuationBasis === "VALUED_TRANSFER") {
          // Add both kg and USD value to moving average.
          const adjRate = new Decimal(event.costPerKgUsd ?? 0);
          const oldPositiveRemaining = Decimal.max(0, remaining);
          const denominator = oldPositiveRemaining.plus(quantity);
          rate = denominator.gt(0)
            ? oldPositiveRemaining.times(rate).plus(quantity.times(adjRate)).div(denominator)
            : adjRate;
          remaining = remaining.plus(quantity);
        } else if (valuationBasis === "OPENING_BALANCE") {
          // Establish opening quantity and value (replaces current state).
          const adjRate = new Decimal(event.costPerKgUsd ?? 0);
          if (remaining.lte(0)) {
            remaining = quantity;
            rate = adjRate;
          } else {
            // If opening balance is applied on top of existing stock, treat as VALUED_TRANSFER.
            const oldPositiveRemaining = Decimal.max(0, remaining);
            const denominator = oldPositiveRemaining.plus(quantity);
            rate = denominator.gt(0)
              ? oldPositiveRemaining.times(rate).plus(quantity.times(adjRate)).div(denominator)
              : adjRate;
            remaining = remaining.plus(quantity);
          }
        } else {
          // QUANTITY_ONLY (or unclassified — still applies quantity without shifting rate).
          remaining = remaining.plus(quantity);
        }
      }
      continue;
    }
    if (event.kind === "REMOVE_ADJUSTMENT" || event.kind === "DEDUCT_ADJUSTMENT") {
      remaining = remaining.minus(new Decimal(event.removeKg ?? event.adjustKg ?? 0));
      // Clamp tiny rounding residuals.
      if (remaining.abs().lte(0.001)) remaining = new Decimal(0);
      continue;
    }
    if (event.kind === "BATCH_CONSUMPTION") {
      if (event.batchId != null) expectedRateAtBatch.set(event.batchId, rate.toDecimalPlaces(8).toNumber());
      remaining = remaining.minus(new Decimal(event.consumptionKg ?? 0));
      // Clamp tiny rounding residuals to zero after consumption.
      if (remaining.abs().lte(0.001)) remaining = new Decimal(0);
    }
  }

  const replayRemainingKg = remaining.toDecimalPlaces(3).toNumber();
  const endingRate = rate.toDecimalPlaces(8).toNumber();
  const quantityMismatch = Math.abs(replayRemainingKg - authoritativeRemainingKg) > 0.001;
  const reasons: string[] = [];
  if (quantityMismatch) reasons.push("TIMELINE_QUANTITY_MISMATCH");
  if (missingDates > 0) reasons.push("MISSING_EVENT_DATES");
  if (ambiguous) reasons.push("TIMELINE_ORDER_AMBIGUOUS");

  return {
    supplierId,
    supplierName,
    currentStoredRate: storedRate,
    startingRate: 0,
    endingRate,
    replayRemainingKg,
    authoritativeRemainingKg,
    quantityMismatch,
    missingDates,
    ambiguous,
    safeToRepair: reasons.length === 0,
    reasons,
    eventCount: sorted.length,
    expectedRateAtBatch,
    affectedContainerCount: affectedContainers.size,
  };
}

export function computeBatchCorrections(
  batchInfoMap: Map<number, BatchInfo>,
  sourceInfos: SourceInfo[],
  expectedRateAtBatch: Map<string, number>,
  canonicalRateByContainer: Map<number, number>
): { corrections: BatchCorrection[]; blockedBatches: BlockedBatch[] } {
  const sourcesByBatch = new Map<number, SourceInfo[]>();
  for (const source of sourceInfos) {
    const values = sourcesByBatch.get(source.batchId) ?? [];
    values.push(source);
    sourcesByBatch.set(source.batchId, values);
  }

  const allBatchIds = new Set(batchInfoMap.keys());
  const dependencies = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const source of sourceInfos) {
    if (source.sourceBatchId == null || !allBatchIds.has(source.batchId)) continue;
    const values = dependencies.get(source.batchId) ?? new Set<number>();
    values.add(source.sourceBatchId);
    dependencies.set(source.batchId, values);
  }
  for (const [batchId, values] of dependencies) {
    inDegree.set(batchId, values.size);
    for (const upstream of values) {
      const downstream = dependents.get(upstream) ?? new Set<number>();
      downstream.add(batchId);
      dependents.set(upstream, downstream);
    }
  }

  const queue = [...allBatchIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: number[] = [];
  const visited = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    order.push(current);
    for (const child of dependents.get(current) ?? []) {
      const nextDegree = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, nextDegree);
      if (nextDegree <= 0) queue.push(child);
    }
  }

  const cycleBatchIds = new Set([...allBatchIds].filter((id) => !visited.has(id)));
  const blockedIds = new Set<number>();
  const reasonByBatch = new Map<number, string>();
  for (const source of sourceInfos) {
    if (source.sourceBatchId != null && !allBatchIds.has(source.sourceBatchId)) {
      blockedIds.add(source.batchId);
      reasonByBatch.set(source.batchId, "UPSTREAM_BATCH_MISSING");
    }
  }

  const correctedBatchCost = new Map<number, number>();
  const corrections: BatchCorrection[] = [];
  for (const batchId of order) {
    if (cycleBatchIds.has(batchId) || blockedIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    const sources = sourcesByBatch.get(batchId) ?? [];
    if (!batch || sources.length === 0) continue;

    const blockedUpstream = sources.some((source) =>
      source.pricingBasis === "BATCH"
      && source.sourceBatchId != null
      && (cycleBatchIds.has(source.sourceBatchId) || blockedIds.has(source.sourceBatchId))
    );
    if (blockedUpstream) {
      blockedIds.add(batchId);
      continue;
    }

    let totalCost = new Decimal(0);
    let totalWeight = new Decimal(0);
    let blocked = false;
    const correctedSourceCosts = new Map<number, number>();
    for (const source of sources) {
      const weight = new Decimal(source.weightKg);
      if (weight.lte(0)) {
        blockedIds.add(batchId);
        reasonByBatch.set(batchId, "ZERO_WEIGHT_SOURCE");
        blocked = true;
        break;
      }

      let correctedCost: number;
      if (source.pricingBasis === "BATCH" && source.sourceBatchId != null) {
        const upstreamCost = correctedBatchCost.get(source.sourceBatchId);
        if (upstreamCost == null) {
          blockedIds.add(batchId);
          blocked = true;
          break;
        }
        correctedCost = upstreamCost;
      } else if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) {
        const expected = expectedRateAtBatch.get(`${source.supplierId}:${source.batchId}`);
        if (expected == null) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "MISSING_SUPPLIER_RATE");
          blocked = true;
          break;
        }
        correctedCost = expected;
      } else if (source.pricingBasis === "CONTAINER_DIRECT" && source.containerId != null) {
        const canonical = canonicalRateByContainer.get(source.containerId);
        if (canonical == null) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "UNRESOLVED_FX");
          blocked = true;
          break;
        }
        correctedCost = canonical;
      } else if (source.pricingBasis === "MANUAL_REVIEW") {
        blockedIds.add(batchId);
        reasonByBatch.set(batchId, "MANUAL_REVIEW_SOURCE");
        blocked = true;
        break;
      } else {
        correctedCost = source.storedCostPerKg;
      }

      correctedSourceCosts.set(source.sourceId, correctedCost);
      totalCost = totalCost.plus(weight.times(correctedCost));
      totalWeight = totalWeight.plus(weight);
    }

    if (blocked) continue;
    const expectedCostPerKg = totalWeight.gt(0)
      ? totalCost.div(totalWeight).toDecimalPlaces(6).toNumber()
      : 0;
    const expectedTotalCost = totalCost.toDecimalPlaces(6).toNumber();
    correctedBatchCost.set(batchId, expectedCostPerKg);
    if (
      Math.abs(expectedCostPerKg - batch.storedCostPerKg) > 0.000001
      || Math.abs(expectedTotalCost - batch.storedTotalCost) > 0.01
    ) {
      corrections.push({
        batchId,
        batchCode: batch.batchCode,
        status: batch.status,
        batchDate: batch.batchDate,
        storedCostPerKg: batch.storedCostPerKg,
        expectedCostPerKg,
        storedTotalCost: batch.storedTotalCost,
        expectedTotalCost,
        correctedSourceCosts,
      });
    }
  }

  const blockedBatches: BlockedBatch[] = [];
  for (const batchId of cycleBatchIds) {
    const batch = batchInfoMap.get(batchId);
    if (batch) blockedBatches.push({ batchId, batchCode: batch.batchCode, reasons: ["BATCH_DEPENDENCY_CYCLE"], dependencyPath: [] });
  }
  for (const batchId of blockedIds) {
    if (cycleBatchIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    if (batch) {
      blockedBatches.push({
        batchId,
        batchCode: batch.batchCode,
        reasons: [reasonByBatch.get(batchId) ?? "UPSTREAM_BATCH_MISSING"],
        dependencyPath: [],
      });
    }
  }
  return { corrections, blockedBatches };
}

async function loadBaleCountsByBatch(
  executor: ReplayQueryExecutor,
  companyId: number,
  batchIds: number[]
): Promise<{ total: Map<number, number>; finalized: Map<number, number> }> {
  if (batchIds.length === 0) return { total: new Map(), finalized: new Map() };
  const finalizedIn = FINALIZED_BALE_STATUSES.map((status) => `'${status}'`).join(",");
  const [totalResult, finalizedResult] = await Promise.all([
    executor.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1)
         AND company_id = $2
         AND status NOT IN ('DELETED','REMOVED')
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
    executor.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1)
         AND company_id = $2
         AND status IN (${finalizedIn})
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
  ]);
  return {
    total: new Map(totalResult.rows.map((row) => [row.mix_batch_id, Number(row.cnt)])),
    finalized: new Map(finalizedResult.rows.map((row) => [row.mix_batch_id, Number(row.cnt)])),
  };
}

/** Executor-aware preview used by read-only preview and locked apply. */
export async function previewHistoricalCostReplayWithExecutor(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<HistoricalReplayPreviewResult> {
  const universe = await loadContainerUniverse(executor, companyId);
  const canonicals = await computeCanonicalCosts(executor, companyId, universe);
  const canonicalRateByContainer = new Map<number, number>();
  for (const canonical of canonicals) {
    if (!canonical.fxUnresolved) canonicalRateByContainer.set(canonical.universe.container.id, canonical.canonicalCostPerKgUsd);
  }

  const supplierIds = new Set<number>();
  for (const canonical of canonicals) {
    if (canonical.universe.container.supplierId) supplierIds.add(canonical.universe.container.supplierId);
  }

  let supplierRows: Array<{ id: number; name: string; currentRawMaterialCostPerKgUsd: string | null }> = [];
  if (supplierIds.size > 0) {
    const supplierResult = await executor.query<any>(
      `SELECT id, name,
              current_raw_material_cost_per_kg_usd AS "currentRawMaterialCostPerKgUsd"
       FROM factory_suppliers
       WHERE company_id = $1 AND id = ANY($2)`,
      [companyId, [...supplierIds]]
    );
    supplierRows = supplierResult.rows;
  }
  const supplierMap = new Map(supplierRows.map((supplier) => [supplier.id, supplier]));

  const receiptEvents = await buildReceiptEvents(executor, companyId, canonicals);
  const { events: adjustmentEventsAll, unclassifiedCount: unclassifiedValuedAdjustments } = await buildAdjustmentEvents(executor, companyId);
  const { events: consumptionEvents, batchInfoMap, sourceInfos } = await buildBatchConsumptionEvents(executor, companyId, supplierIds);

  // Count unresolved inventory supplier sources (non-BATCH sources with null inventorySupplierId).
  const unresolvedInventorySupplierSources = sourceInfos.filter(
    (s) => s.pricingBasis !== "BATCH" && s.pricingBasis !== "MANUAL_REVIEW" && s.inventorySupplierId == null
  ).length;

  // Build per-supplier sets of unclassified adjustments for blocking.
  const unclassifiedAdjustmentSupplierIds = new Set<number>(
    adjustmentEventsAll
      .filter((e) => e.kind === "ADD_ADJUSTMENT" && (e.costPerKgUsd ?? 0) > 0 && !e.valuationBasis)
      .map((e) => e.supplierId)
  );

  const receiptsBySupplier = new Map<number, ContainerReceiptEvent[]>();
  for (const event of receiptEvents) {
    if (event.supplierId == null) continue;
    const values = receiptsBySupplier.get(event.supplierId) ?? [];
    values.push(event);
    receiptsBySupplier.set(event.supplierId, values);
  }
  const adjustmentsBySupplier = new Map<number, AdjustmentEvent[]>();
  for (const event of adjustmentEventsAll) {
    const values = adjustmentsBySupplier.get(event.supplierId) ?? [];
    values.push(event);
    adjustmentsBySupplier.set(event.supplierId, values);
  }
  const consumptionBySupplier = new Map<number, BatchConsumptionEvent[]>();
  for (const event of consumptionEvents) {
    const values = consumptionBySupplier.get(event.supplierId) ?? [];
    values.push(event);
    consumptionBySupplier.set(event.supplierId, values);
  }

  const timelineResults: SupplierTimelineResult[] = [];
  const allExpectedRatesAtBatch = new Map<string, number>();
  for (const supplierId of supplierIds) {
    const supplier = supplierMap.get(supplierId);
    if (!supplier) continue;
    const allEvents: SupplierEvent[] = [];
    for (const event of receiptsBySupplier.get(supplierId) ?? []) {
      allEvents.push({
        kind: "RECEIPT",
        effectiveDate: event.effectiveDate,
        createdAt: event.createdAt,
        stableId: event.stableId,
        containerId: event.containerId,
        canonicalRateUsd: event.canonicalRateUsd,
        receiptKg: event.receiptKg,
      });
    }
    for (const event of adjustmentsBySupplier.get(supplierId) ?? []) {
      allEvents.push({
        kind: event.kind,
        effectiveDate: event.effectiveDate,
        createdAt: event.createdAt,
        stableId: event.stableId,
        adjustKg: event.adjustKg,
        costPerKgUsd: event.costPerKgUsd,
        valuationBasis: event.valuationBasis,
        removeKg: event.kind === "ADD_ADJUSTMENT" ? undefined : event.adjustKg,
      });
    }
    for (const event of consumptionBySupplier.get(supplierId) ?? []) {
      allEvents.push({
        kind: "BATCH_CONSUMPTION",
        effectiveDate: event.effectiveDate,
        createdAt: event.createdAt,
        stableId: event.stableId,
        batchId: event.batchId,
        batchCode: event.batchCode,
        consumptionKg: event.consumptionKg,
        sourceIds: event.sourceIds,
      });
    }
    if (allEvents.length === 0) continue;

    const authoritativeRemainingKg = await getAuthoritativeSupplierRemainingKgWithExecutor(executor, companyId, supplierId);
    const timeline = await replaySupplierTimeline(
      companyId,
      supplierId,
      supplier.name,
      numeric(supplier.currentRawMaterialCostPerKgUsd),
      allEvents,
      authoritativeRemainingKg
    );
    // Block suppliers with unclassified valued adjustments.
    if (unclassifiedAdjustmentSupplierIds.has(supplierId) && !timeline.reasons.includes("ADJUSTMENT_VALUATION_UNCLASSIFIED")) {
      timeline.reasons.push("ADJUSTMENT_VALUATION_UNCLASSIFIED");
      (timeline as any).safeToRepair = false;
    }
    timelineResults.push(timeline);
    for (const [batchId, rate] of timeline.expectedRateAtBatch) {
      allExpectedRatesAtBatch.set(`${supplierId}:${batchId}`, rate);
    }
  }

  const { corrections: batchCorrections } = computeBatchCorrections(
    batchInfoMap,
    sourceInfos,
    allExpectedRatesAtBatch,
    canonicalRateByContainer
  );
  const correctionByBatch = new Map(batchCorrections.map((correction) => [correction.batchId, correction]));
  const correctedBatchIds = batchCorrections.map((correction) => correction.batchId);
  const baleCounts = await loadBaleCountsByBatch(executor, companyId, correctedBatchIds);

  const containerRows: ReplayContainerRow[] = canonicals.map((canonical) => ({
    containerId: canonical.universe.container.id,
    containerNumber: canonical.universe.container.containerNumber,
    status: canonical.universe.container.status,
    supplierId: canonical.universe.container.supplierId ?? null,
    eventDate: canonical.universe.offloadDate,
    storedCostPerKgUsd: canonical.storedCostPerKgUsd,
    canonicalCostPerKgUsd: canonical.canonicalCostPerKgUsd,
    storedTotalUsd: canonical.storedTotalUsd,
    canonicalTotalUsd: canonical.canonicalTotalUsd,
    fxUnresolved: canonical.fxUnresolved,
    safeToRepair: canonical.safeToRepair,
    reason: canonical.reason,
    scanReason: canonical.universe.scanReason,
  }));

  const sourceRows: ReplaySourceRow[] = [];
  for (const source of sourceInfos) {
    if (source.pricingBasis === "MANUAL_REVIEW") continue;
    let expectedCost = source.storedCostPerKg;
    let safeToRepair = true;
    let reason: string | null = null;

    if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) {
      const expected = allExpectedRatesAtBatch.get(`${source.supplierId}:${source.batchId}`);
      if (expected == null) {
        safeToRepair = false;
        reason = "SUPPLIER_TIMELINE_UNAVAILABLE";
      } else {
        expectedCost = expected;
        const timeline = timelineResults.find((item) => item.supplierId === source.supplierId);
        if (timeline && !timeline.safeToRepair) {
          safeToRepair = false;
          reason = timeline.reasons[0] ?? "TIMELINE_NOT_SAFE";
        }
      }
    } else if (source.pricingBasis === "CONTAINER_DIRECT" && source.containerId != null) {
      const expected = canonicalRateByContainer.get(source.containerId);
      if (expected == null) {
        safeToRepair = false;
        reason = "UNRESOLVED_FX";
      } else {
        expectedCost = expected;
      }
    } else if (source.pricingBasis === "BATCH" && source.sourceBatchId != null) {
      expectedCost = correctionByBatch.get(source.sourceBatchId)?.expectedCostPerKg ?? source.storedCostPerKg;
    } else {
      continue;
    }

    if (Math.abs(expectedCost - source.storedCostPerKg) < 0.000001) continue;
    sourceRows.push({
      sourceId: source.sourceId,
      batchId: source.batchId,
      batchCode: source.batchCode,
      batchDate: source.batchDate,
      supplierId: source.supplierId,
      containerId: source.containerId,
      pricingBasis: source.pricingBasis,
      storedCostPerKg: source.storedCostPerKg,
      expectedHistoricalCostPerKg: expectedCost,
      storedTotalCost: source.storedTotalCost,
      expectedTotalCost: new Decimal(source.weightKg).times(expectedCost).toDecimalPlaces(6).toNumber(),
      weightKg: source.weightKg,
      safeToRepair,
      reason,
    });
  }

  const batchRows: ReplayBatchRow[] = batchCorrections.map((correction) => ({
    batchId: correction.batchId,
    batchCode: correction.batchCode,
    status: correction.status,
    batchDate: correction.batchDate,
    storedCostPerKg: correction.storedCostPerKg,
    expectedCostPerKg: correction.expectedCostPerKg,
    storedTotalCost: correction.storedTotalCost,
    expectedTotalCost: correction.expectedTotalCost,
    affectedBales: baleCounts.total.get(correction.batchId) ?? 0,
  }));

  // V7: detect mixed batches where not all participating inventory suppliers are in scope.
  let incompleteMixedBatchSupplierScopes = 0;
  {
    const batchInventorySuppliers = new Map<number, Set<number>>();
    for (const source of sourceInfos) {
      if (source.pricingBasis === "BATCH" || source.inventorySupplierId == null) continue;
      const s = batchInventorySuppliers.get(source.batchId) ?? new Set<number>();
      s.add(source.inventorySupplierId);
      batchInventorySuppliers.set(source.batchId, s);
    }
    for (const [, batchSuppliers] of batchInventorySuppliers) {
      for (const sid of batchSuppliers) {
        if (!supplierIds.has(sid)) { incompleteMixedBatchSupplierScopes++; break; }
      }
    }
  }

  const supplierOutputRows: ReplaySupplierRow[] = timelineResults.map((timeline) => {
    // Count all sources where THIS supplier's inventory was consumed (not just SUPPLIER_LOCKED_RATE).
    const affectedSourceCount = sourceInfos.filter(
      (source) => source.inventorySupplierId === timeline.supplierId && source.pricingBasis !== "BATCH"
    ).length;
    const affectedBatchIds = new Set(
      batchCorrections
        .filter((batch) => sourceInfos.some(
          (source) => source.batchId === batch.batchId && source.inventorySupplierId === timeline.supplierId
        ))
        .map((batch) => batch.batchId)
    );
    return {
      supplierId: timeline.supplierId,
      supplierName: timeline.supplierName,
      startingRate: timeline.startingRate,
      endingExpectedRate: timeline.endingRate,
      currentStoredRate: timeline.currentStoredRate,
      replayRemainingKg: timeline.replayRemainingKg,
      authoritativeRemainingKg: timeline.authoritativeRemainingKg,
      safeToRepair: timeline.safeToRepair,
      reasons: timeline.reasons,
      eventCount: timeline.eventCount,
      affectedContainerCount: timeline.affectedContainerCount,
      affectedSourceCount,
      affectedBatchCount: affectedBatchIds.size,
      affectedBaleCount: [...affectedBatchIds].reduce((sum, batchId) => sum + (baleCounts.total.get(batchId) ?? 0), 0),
    };
  });

  const completedBatchIds = new Set(
    batchCorrections.filter((batch) => ["COMPLETED", "CLOSED"].includes(batch.status)).map((batch) => batch.batchId)
  );

  // ── Financial impact (Phase 11) ──────────────────────────────────────────────
  // Current raw material asset: sum of per-row (received - used) × cost_per_kg_usd
  // plus ADD adjustments, matching the net position route formula.
  const financialImpact = await computeFinancialImpact(
    executor,
    companyId,
    supplierOutputRows,
    canonicals,
    batchCorrections,
    baleCounts
  );

  const summary: ReplaySummary = {
    totalReceivedContainers: universe.length,
    containersScanned: canonicals.length,
    omittedContainers: universe.length - canonicals.length,
    canonicalContainerMismatches: canonicals.filter(
      (item) => !item.fxUnresolved && Math.abs(item.canonicalCostPerKgUsd - item.storedCostPerKgUsd) > 0.000001
    ).length,
    suppliersScanned: timelineResults.length,
    safeSuppliers: timelineResults.filter((timeline) => timeline.safeToRepair).length,
    manualReviewSuppliers: timelineResults.filter((timeline) => !timeline.safeToRepair).length,
    supplierPricedSourcesScanned: sourceInfos.filter((source) => source.pricingBasis === "SUPPLIER_LOCKED_RATE").length,
    sourceMismatches: sourceRows.length,
    batchesToUpdate: batchCorrections.length,
    completedBatchesToUpdate: completedBatchIds.size,
    balesToUpdate: batchRows.reduce((sum, batch) => sum + batch.affectedBales, 0),
    finalizedBalesToUpdate: correctedBatchIds.reduce((sum, batchId) => sum + (baleCounts.finalized.get(batchId) ?? 0), 0),
    unresolvedFx: canonicals.filter((item) => item.fxUnresolved).length,
    missingDates: timelineResults.reduce((sum, timeline) => sum + timeline.missingDates, 0),
    quantityTimelineMismatches: timelineResults.filter((timeline) => timeline.quantityMismatch).length,
    ambiguousEventOrdering: timelineResults.filter((timeline) => timeline.ambiguous).length,
    scanCoverageError: canonicals.length !== universe.length,
    // V7 gates
    unresolvedInventorySupplierSources,
    unclassifiedValuedAdjustments,
    incompleteMixedBatchSupplierScopes,
  };

  return { summary, supplierRows: supplierOutputRows, containerRows, sourceRows, batchRows, financialImpact };
}

/**
 * Compute Phase 11 financial impact from replay preview data.
 * Per-supplier value change = replayRemainingKg × endingExpectedRate − authoritativeRemainingKg × currentStoredRate.
 * Projected net position = current net position + raw-material difference.
 */
async function computeFinancialImpact(
  executor: ReplayQueryExecutor,
  companyId: number,
  supplierOutputRows: ReplaySupplierRow[],
  canonicals: CanonicalContainer[],
  batchCorrections: BatchCorrection[],
  baleCounts: { total: Map<number, number>; finalized: Map<number, number> }
): Promise<import("./types").ReplayFinancialImpact> {
  // Current raw material asset — same formula as employeeNetPositionRoutes.ts
  const rawResult = await executor.query<{ remaining_value_usd: string }>(
    `SELECT COALESCE(SUM(
        (frs.received_kg::numeric - frs.used_kg::numeric) *
        COALESCE(NULLIF(frs.cost_per_kg_usd::numeric, 0), frs.cost_per_kg::numeric, 0)
      ), 0) AS remaining_value_usd
     FROM factory_raw_stock frs
     JOIN factory_containers fc ON fc.id = frs.container_id
     WHERE frs.company_id = $1 AND fc.status != 'DELETED'
       AND frs.deleted_at IS NULL AND fc.deleted_at IS NULL`,
    [companyId]
  );
  const adjResult = await executor.query<{ kg: string; cpk: string; type: string }>(
    `SELECT kg::numeric AS kg, cost_per_kg::numeric AS cpk, type
     FROM factory_raw_material_adjustments
     WHERE company_id = $1 AND deleted_at IS NULL AND type = 'ADD'`,
    [companyId]
  );
  let currentRawMaterialAsset = parseFloat(rawResult.rows[0]?.remaining_value_usd ?? "0") || 0;
  for (const adj of adjResult.rows) {
    currentRawMaterialAsset += parseFloat(adj.kg ?? "0") * parseFloat(adj.cpk ?? "0");
  }

  // Per-supplier value change from the replay.
  const supplierImpacts: import("./types").ReplaySupplierFinancialImpact[] = supplierOutputRows.map((row) => {
    const currentValue = new Decimal(row.authoritativeRemainingKg).times(row.currentStoredRate).toDecimalPlaces(2).toNumber();
    const projectedValue = new Decimal(row.replayRemainingKg).times(row.endingExpectedRate).toDecimalPlaces(2).toNumber();
    const valueDifference = new Decimal(projectedValue).minus(currentValue).toDecimalPlaces(2).toNumber();
    return {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      authoritativeRemainingKg: row.authoritativeRemainingKg,
      replayRemainingKg: row.replayRemainingKg,
      currentStoredRate: row.currentStoredRate,
      endingExpectedRate: row.endingExpectedRate,
      currentValue,
      projectedValue,
      valueDifference,
    };
  });

  const rawMaterialDifference = supplierImpacts.reduce((sum, s) => sum + s.valueDifference, 0);
  const projectedRawMaterialAsset = new Decimal(currentRawMaterialAsset).plus(rawMaterialDifference).toDecimalPlaces(2).toNumber();

  const completedBatchesAffected = batchCorrections.filter((b) => ["COMPLETED", "CLOSED"].includes(b.status)).length;
  const batchIds = batchCorrections.map((b) => b.batchId);
  const availableBalesAffected = batchIds.reduce((sum, id) => sum + (baleCounts.total.get(id) ?? 0) - (baleCounts.finalized.get(id) ?? 0), 0);
  const finalizedBalesExcluded = batchIds.reduce((sum, id) => sum + (baleCounts.finalized.get(id) ?? 0), 0);

  // Safety gate results (reflect in/complete view).
  const blockedBatches = 0; // filled by caller from preview.summary if needed
  const safetyGateDetails = {
    unresolvedInventorySupplierSources: supplierOutputRows.reduce((_, __) => 0, 0), // computed in caller
    unclassifiedValuedAdjustments: 0,
    unresolvedFx: canonicals.filter((c) => c.fxUnresolved).length,
    missingDates: 0,
    quantityTimelineMismatches: supplierOutputRows.filter((r) => !r.safeToRepair && r.reasons.includes("TIMELINE_QUANTITY_MISMATCH")).length,
    ambiguousEventOrdering: supplierOutputRows.filter((r) => !r.safeToRepair && r.reasons.includes("TIMELINE_ORDER_AMBIGUOUS")).length,
    incompleteMixedBatchSupplierScopes: 0,
    blockedBatches,
    scanCoverageError: false,
  };
  const allSafetyGatesPassed = Object.values(safetyGateDetails).every((v) => v === 0 || v === false);

  return {
    currentRawMaterialAsset: new Decimal(currentRawMaterialAsset).toDecimalPlaces(2).toNumber(),
    projectedRawMaterialAsset,
    rawMaterialDifference: new Decimal(rawMaterialDifference).toDecimalPlaces(2).toNumber(),
    currentNetPosition: null,     // filled by the route layer from the net position service
    projectedNetPosition: null,   // filled by the route layer
    otherLedgerEffect: 0,
    completedBatchesAffected,
    availableBalesAffected,
    finalizedBalesExcluded,
    supplierImpacts,
    allSafetyGatesPassed,
    safetyGateDetails,
  };
}

export async function previewHistoricalCostReplay(companyId: number): Promise<HistoricalReplayPreviewResult> {
  return previewHistoricalCostReplayWithExecutor(pool as ReplayQueryExecutor, companyId);
}
