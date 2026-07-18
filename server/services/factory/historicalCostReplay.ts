/**
 * Historical Raw-Material Cost Replay Engine
 *
 * Replays container receipts, adjustments, and mix-batch consumption events
 * in chronological order to compute the correct supplier moving-average rate
 * at every point in time, then compares stored source costs against those
 * historically-correct rates.
 *
 * Two exported entry points:
 *   previewHistoricalCostReplay(companyId)  — pure read, never writes
 *   applyHistoricalCostReplay(...)          — writes inside a transaction after token verification
 */

import Decimal from "decimal.js";
import crypto from "crypto";
import { pool } from "../../db";
import { computeContainerLandedCost } from "./containerLandedCost";
import { resolveMixSourcePricingBasis } from "./mixSourcePricingBasis";
import { getAuthoritativeSupplierRemainingKg } from "./rawStockLockedRate";
import { db } from "../../db";
import {
  factoryContainers,
  factoryRawStock,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
  factoryContainerOtherCharges,
  factorySuppliers,
  factoryMixBatchSources,
  factoryMixBatches,
  factoryBales,
  factoryRawMaterialAdjustments,
  factoryContainerReceipts,
} from "@shared/schema";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Public result types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown inside applyHistoricalCostReplay when the live DB fingerprint no longer
 * matches the signed token fingerprint — meaning data changed between the dry-run
 * and the apply call. Callers should catch this and return HTTP 409 (Conflict).
 */
export class StaleTokenError extends Error {
  readonly code = "STALE_TOKEN" as const;
  constructor(message: string) {
    super(message);
    this.name = "StaleTokenError";
  }
}

export type ScanReason =
  | "ACTIVE_RAW_STOCK"
  | "DELETED_RAW_STOCK"
  | "RECEIPT_HISTORY"
  | "OFFLOAD_DAYBOOK"
  | "MIX_SOURCE_LINK"
  | "CONTAINER_RECEIVED_FIELD";

export interface ReplayContainerRow {
  containerId: number;
  containerNumber: string;
  status: string;
  supplierId: number | null;
  eventDate: string | null;
  storedCostPerKgUsd: number;
  canonicalCostPerKgUsd: number;
  storedTotalUsd: number;
  canonicalTotalUsd: number;
  fxUnresolved: boolean;
  safeToRepair: boolean;
  reason: string | null;
  scanReason: ScanReason;
}

export interface ReplaySourceRow {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  supplierId: number | null;
  containerId: number | null;
  pricingBasis: string;
  storedCostPerKg: number;
  expectedHistoricalCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  weightKg: number;
  safeToRepair: boolean;
  reason: string | null;
}

export interface ReplayBatchRow {
  batchId: number;
  batchCode: string;
  status: string;
  batchDate: string | null;
  storedCostPerKg: number;
  expectedCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  affectedBales: number;
}

export interface ReplaySupplierRow {
  supplierId: number;
  supplierName: string;
  startingRate: number;
  endingExpectedRate: number;
  currentStoredRate: number;
  replayRemainingKg: number;
  authoritativeRemainingKg: number;
  safeToRepair: boolean;
  reasons: string[];
  eventCount: number;
  affectedContainerCount: number;
  affectedSourceCount: number;
  affectedBatchCount: number;
  affectedBaleCount: number;
}

export interface ReplaySummary {
  totalReceivedContainers: number;
  containersScanned: number;
  omittedContainers: number;
  canonicalContainerMismatches: number;
  suppliersScanned: number;
  safeSuppliers: number;
  manualReviewSuppliers: number;
  supplierPricedSourcesScanned: number;
  sourceMismatches: number;
  batchesToUpdate: number;
  completedBatchesToUpdate: number;
  balesToUpdate: number;
  /** Bales whose status indicates they are sold/dispatched/invoiced and require includeFinalizedBales=true to update */
  finalizedBalesToUpdate: number;
  unresolvedFx: number;
  missingDates: number;
  quantityTimelineMismatches: number;
  ambiguousEventOrdering: number;
  scanCoverageError: boolean;
}

export interface HistoricalReplayPreviewResult {
  summary: ReplaySummary;
  supplierRows: ReplaySupplierRow[];
  containerRows: ReplayContainerRow[];
  sourceRows: ReplaySourceRow[];
  batchRows: ReplayBatchRow[];
}

/**
 * DEFECT 1 FIX: Exact set of DB row IDs approved for write by a signed replay token.
 * Every write loop must check the corresponding approved ID set before touching any row.
 */
export interface HistoricalReplayScope {
  /** Supplier IDs whose timelines are safe and were selected for this replay. */
  supplierIds: number[];
  /** Container IDs belonging to approved suppliers with resolved FX. */
  containerIds: number[];
  /** Source IDs that are safeToRepair and belong to approved suppliers / containers. */
  sourceIds: number[];
  /** Mix-batch IDs in the supplier-closure that pass the completed-batch gate. */
  batchIds: number[];
  /** Bale IDs that are non-finalized (or explicitly authorized) belonging to approved batches. */
  baleIds: number[];
  /** Batch IDs excluded from writes due to dependency errors. */
  blockedBatchIds: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal event types
// ─────────────────────────────────────────────────────────────────────────────

type EventKind =
  | "RECEIPT"
  | "ADD_ADJUSTMENT"
  | "REMOVE_ADJUSTMENT"
  | "DEDUCT_ADJUSTMENT"
  | "BATCH_CONSUMPTION";

interface SupplierEvent {
  kind: EventKind;
  effectiveDate: string;       // YYYY-MM-DD; "" means missing/manual review
  createdAt: number;           // epoch ms for tiebreaking (0 when unknown)
  stableId: number;            // row id for deterministic ordering
  // RECEIPT
  containerId?: number;
  canonicalRateUsd?: number;
  receiptKg?: number;
  // ADD_ADJUSTMENT
  adjustKg?: number;
  costPerKgUsd?: number | null;  // null → no rate change
  // REMOVE / DEDUCT
  removeKg?: number;
  // BATCH_CONSUMPTION
  batchId?: number;
  batchCode?: string;
  consumptionKg?: number;
  sourceIds?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: load the full container universe for the company
// ─────────────────────────────────────────────────────────────────────────────

interface ContainerUniverse {
  container: typeof factoryContainers.$inferSelect;
  supplierName: string | null;
  activeRawStock: typeof factoryRawStock.$inferSelect | null;
  deletedRawStockExists: boolean;
  receiptHistoryExists: boolean;
  offloadDaybookExists: boolean;
  mixSourceLinkExists: boolean;
  scanReason: ScanReason;
  /** Earliest reliable event date from offload daybook or raw-stock.offloadedAt */
  offloadDate: string | null;
}

async function loadContainerUniverse(companyId: number): Promise<ContainerUniverse[]> {
  // One query to get all containers with any received/offload evidence
  const { rows } = await pool.query<{
    id: number;
    supplier_name: string | null;
    actual_received_kg: string | null;
    has_active_rs: boolean;
    has_deleted_rs: boolean;
    has_receipt_history: boolean;
    has_offload_daybook: boolean;
    has_mix_source: boolean;
    earliest_offload_date: string | null;
    offloaded_at: string | null;
  }>(
    `SELECT
       fc.id,
       fs.name                             AS supplier_name,
       fc.actual_received_kg,
       (EXISTS (SELECT 1 FROM factory_raw_stock frs
                WHERE frs.container_id = fc.id AND frs.company_id = fc.company_id
                  AND frs.deleted_at IS NULL))  AS has_active_rs,
       (EXISTS (SELECT 1 FROM factory_raw_stock frs
                WHERE frs.container_id = fc.id AND frs.company_id = fc.company_id
                  AND frs.deleted_at IS NOT NULL)) AS has_deleted_rs,
       (EXISTS (SELECT 1 FROM factory_container_receipts fcr
                WHERE fcr.container_id = fc.id AND fcr.company_id = fc.company_id
                  AND fcr.deleted_at IS NULL))  AS has_receipt_history,
       (EXISTS (SELECT 1 FROM factory_daybook_entries fde
                WHERE fde.company_id = fc.company_id
                  AND fde.tx_type = 'OFFLOAD_RAW_STOCK'
                  AND (fde.meta_json::jsonb->>'containerId')::int = fc.id)) AS has_offload_daybook,
       (EXISTS (SELECT 1 FROM factory_mix_batch_sources fmbs
                WHERE fmbs.container_id = fc.id)) AS has_mix_source,
       (SELECT MIN(fde.tx_date)::text FROM factory_daybook_entries fde
        WHERE fde.company_id = fc.company_id
          AND fde.tx_type = 'OFFLOAD_RAW_STOCK'
          AND (fde.meta_json::jsonb->>'containerId')::int = fc.id) AS earliest_offload_date,
       (SELECT frs.offloaded_at::text FROM factory_raw_stock frs
        WHERE frs.container_id = fc.id AND frs.company_id = fc.company_id
        ORDER BY frs.offloaded_at LIMIT 1) AS offloaded_at
     FROM factory_containers fc
     LEFT JOIN factory_suppliers fs ON fs.id = fc.supplier_id AND fs.company_id = fc.company_id
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

  const containerIds = rows.map((r) => r.id);

  // Load full container rows, raw-stock, charges in one batch
  const [containers, allRawStock, allAdditionalCharges, allCommissions, allOtherCharges] =
    await Promise.all([
      db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.id, containerIds))),
      db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), inArray(factoryRawStock.containerId, containerIds))),
      db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(and(eq(factoryOffloadAdditionalCharges.companyId, companyId))),
      db
        .select()
        .from(factoryContainerCommissions)
        .where(and(eq(factoryContainerCommissions.companyId, companyId))),
      db
        .select()
        .from(factoryContainerOtherCharges)
        .where(and(eq(factoryContainerOtherCharges.companyId, companyId))),
    ]);

  const containerMap = new Map(containers.map((c) => [c.id, c]));
  const activeRsMap = new Map<number, typeof factoryRawStock.$inferSelect>();
  const deletedRsSet = new Set<number>();
  for (const rs of allRawStock) {
    const cid = rs.containerId as number;
    if ((rs as any).deletedAt) {
      deletedRsSet.add(cid);
    } else {
      const ex = activeRsMap.get(cid);
      if (!ex || rs.id > ex.id) activeRsMap.set(cid, rs);
    }
  }
  const chargesByContainer = new Map<number, (typeof factoryOffloadAdditionalCharges.$inferSelect)[]>();
  for (const c of allAdditionalCharges) {
    if (!chargesByContainer.has(c.containerId)) chargesByContainer.set(c.containerId, []);
    chargesByContainer.get(c.containerId)!.push(c);
  }
  const commissionByContainer = new Map<number, typeof factoryContainerCommissions.$inferSelect>();
  for (const c of allCommissions) {
    const ex = commissionByContainer.get(c.containerId);
    if (!ex || c.id > ex.id) commissionByContainer.set(c.containerId, c);
  }
  const otherChargesByContainer = new Map<number, (typeof factoryContainerOtherCharges.$inferSelect)[]>();
  for (const oc of allOtherCharges) {
    if (!otherChargesByContainer.has(oc.containerId)) otherChargesByContainer.set(oc.containerId, []);
    otherChargesByContainer.get(oc.containerId)!.push(oc);
  }

  const result: ContainerUniverse[] = [];

  for (const row of rows) {
    const container = containerMap.get(row.id);
    if (!container) continue;

    // Determine scan reason (priority order)
    let scanReason: ScanReason;
    if (row.has_active_rs) scanReason = "ACTIVE_RAW_STOCK";
    else if (row.has_deleted_rs) scanReason = "DELETED_RAW_STOCK";
    else if (row.has_receipt_history) scanReason = "RECEIPT_HISTORY";
    else if (row.has_offload_daybook) scanReason = "OFFLOAD_DAYBOOK";
    else if (row.has_mix_source) scanReason = "MIX_SOURCE_LINK";
    else scanReason = "CONTAINER_RECEIVED_FIELD";

    // Offload date: earliest daybook txDate → raw-stock offloadedAt → null
    let offloadDate: string | null = null;
    if (row.earliest_offload_date) {
      offloadDate = row.earliest_offload_date.substring(0, 10);
    } else if (row.offloaded_at) {
      offloadDate = row.offloaded_at.substring(0, 10);
    }

    result.push({
      container,
      supplierName: row.supplier_name || null,
      activeRawStock: activeRsMap.get(row.id) || null,
      deletedRawStockExists: deletedRsSet.has(row.id),
      receiptHistoryExists: row.has_receipt_history,
      offloadDaybookExists: row.has_offload_daybook,
      mixSourceLinkExists: row.has_mix_source,
      scanReason,
      offloadDate,
    });
  }

  // Attach charges info (for canonical cost computation, stored on container objects)
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: compute canonical cost for each container
// ─────────────────────────────────────────────────────────────────────────────

interface CanonicalContainer {
  universe: ContainerUniverse;
  canonicalCostPerKgUsd: number;
  canonicalTotalUsd: number;
  storedCostPerKgUsd: number;
  storedTotalUsd: number;
  fxUnresolved: boolean;
  safeToRepair: boolean;
  reason: string | null;
}

async function computeCanonicalCosts(
  companyId: number,
  universe: ContainerUniverse[]
): Promise<CanonicalContainer[]> {
  const containerIds = universe.map((u) => u.container.id);
  if (containerIds.length === 0) return [];

  const [allAdditionalCharges, allCommissions, allOtherCharges] = await Promise.all([
    db.select().from(factoryOffloadAdditionalCharges).where(eq(factoryOffloadAdditionalCharges.companyId, companyId)),
    db.select().from(factoryContainerCommissions).where(eq(factoryContainerCommissions.companyId, companyId)),
    db.select().from(factoryContainerOtherCharges).where(eq(factoryContainerOtherCharges.companyId, companyId)),
  ]);

  const chargesByContainer = new Map<number, (typeof factoryOffloadAdditionalCharges.$inferSelect)[]>();
  for (const c of allAdditionalCharges) {
    if (!chargesByContainer.has(c.containerId)) chargesByContainer.set(c.containerId, []);
    chargesByContainer.get(c.containerId)!.push(c);
  }
  const commissionByContainer = new Map<number, typeof factoryContainerCommissions.$inferSelect>();
  for (const c of allCommissions) {
    const ex = commissionByContainer.get(c.containerId);
    if (!ex || c.id > ex.id) commissionByContainer.set(c.containerId, c);
  }
  const ocByContainer = new Map<number, (typeof factoryContainerOtherCharges.$inferSelect)[]>();
  for (const oc of allOtherCharges) {
    if (!ocByContainer.has(oc.containerId)) ocByContainer.set(oc.containerId, []);
    ocByContainer.get(oc.containerId)!.push(oc);
  }

  return universe.map((u) => {
    const { container, activeRawStock } = u;
    const additionalCharges = chargesByContainer.get(container.id) || [];
    const commissionRecord = commissionByContainer.get(container.id) || null;
    const ocRows = ocByContainer.get(container.id) || [];

    const result = computeContainerLandedCost(container, additionalCharges, commissionRecord, ocRows);

    // Stored cost: from raw-stock row if active, otherwise container.ratePerKgUsd
    const storedCostPerKgUsd = activeRawStock
      ? parseFloat(activeRawStock.costPerKgUsd as string || activeRawStock.costPerKg as string || "0")
      : parseFloat((container as any).ratePerKgUsd || (container as any).ratePerKg || "0");

    const receivedKg = activeRawStock
      ? parseFloat(activeRawStock.receivedKg as string || "0")
      : parseFloat(container.actualReceivedKg || "0");

    const storedTotalUsd = storedCostPerKgUsd * receivedKg;
    const canonicalTotalUsd = result.fullCostUsd;

    return {
      universe: u,
      canonicalCostPerKgUsd: result.costPerKgUsd,
      canonicalTotalUsd,
      storedCostPerKgUsd,
      storedTotalUsd,
      fxUnresolved: result.fxUnresolved,
      safeToRepair: !result.fxUnresolved,
      reason: result.fxUnresolved ? "UNRESOLVED_FX" : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: build receipt events for each container
// ─────────────────────────────────────────────────────────────────────────────

interface ContainerReceiptEvent {
  containerId: number;
  supplierId: number | null;
  effectiveDate: string; // YYYY-MM-DD or ""
  receiptKg: number;
  canonicalRateUsd: number;
  createdAt: number;
  stableId: number;
}

async function buildReceiptEvents(
  companyId: number,
  canonicals: CanonicalContainer[]
): Promise<ContainerReceiptEvent[]> {
  const containerIds = canonicals.map((c) => c.universe.container.id);
  if (containerIds.length === 0) return [];

  // Load all active receipt rows
  const receiptRows = await db
    .select()
    .from(factoryContainerReceipts)
    .where(
      and(
        eq(factoryContainerReceipts.companyId, companyId),
        inArray(factoryContainerReceipts.containerId, containerIds),
        isNull(factoryContainerReceipts.deletedAt)
      )
    );

  const receiptsByContainer = new Map<number, (typeof factoryContainerReceipts.$inferSelect)[]>();
  for (const r of receiptRows) {
    const cid = r.containerId;
    if (!receiptsByContainer.has(cid)) receiptsByContainer.set(cid, []);
    receiptsByContainer.get(cid)!.push(r);
  }

  const events: ContainerReceiptEvent[] = [];

  for (const canonical of canonicals) {
    if (canonical.fxUnresolved) continue; // can't use unresolved containers in replay

    const { container, activeRawStock, offloadDate } = canonical.universe;
    const cid = container.id;
    const supplierId = container.supplierId || null;
    const canonicalRateUsd = canonical.canonicalCostPerKgUsd;

    const receipts = receiptsByContainer.get(cid);
    if (receipts && receipts.length > 0) {
      // Multi-receipt container: one event per active receipt
      for (const r of receipts) {
        events.push({
          containerId: cid,
          supplierId,
          effectiveDate: r.receiptDate ? String(r.receiptDate).substring(0, 10) : "",
          receiptKg: parseFloat(r.receivedKg as string || "0"),
          canonicalRateUsd,
          createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
          stableId: r.id,
        });
      }
    } else {
      // Legacy container without receipt rows: single event
      const receivedKg = activeRawStock
        ? parseFloat(activeRawStock.receivedKg as string || "0")
        : parseFloat(container.actualReceivedKg || "0");

      if (receivedKg <= 0) continue;

      // Date fallback: offload daybook → raw-stock offloadedAt → ""
      const effectiveDate = offloadDate || "";

      events.push({
        containerId: cid,
        supplierId,
        effectiveDate,
        receiptKg: receivedKg,
        canonicalRateUsd,
        createdAt: activeRawStock ? new Date((activeRawStock as any).offloadedAt || 0).getTime() : 0,
        stableId: cid * -1, // negative ID to distinguish from receipt row IDs
      });
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: build adjustment events
// ─────────────────────────────────────────────────────────────────────────────

interface AdjustmentEvent {
  supplierId: number;
  effectiveDate: string;
  kind: "ADD_ADJUSTMENT" | "REMOVE_ADJUSTMENT" | "DEDUCT_ADJUSTMENT";
  adjustKg: number;
  costPerKgUsd: number | null;
  createdAt: number;
  stableId: number;
}

async function buildAdjustmentEvents(companyId: number): Promise<AdjustmentEvent[]> {
  const rows = await db
    .select()
    .from(factoryRawMaterialAdjustments)
    .where(
      and(
        eq(factoryRawMaterialAdjustments.companyId, companyId),
        isNull(factoryRawMaterialAdjustments.deletedAt),
        sql`${factoryRawMaterialAdjustments.supplierId} IS NOT NULL`
      )
    );

  return rows.map((r) => {
    const kg = parseFloat(r.kg as string || "0");
    const type = r.type.toUpperCase();
    let kind: AdjustmentEvent["kind"];
    if (type === "ADD") kind = "ADD_ADJUSTMENT";
    else if (type === "REMOVE") kind = "REMOVE_ADJUSTMENT";
    else kind = "DEDUCT_ADJUSTMENT";

    // Only USD adjustments with a positive costPerKg shift the rate
    const rawCost = parseFloat(r.costPerKg as string || "0");
    const ccy = r.currencyCode || "USD";
    const costPerKgUsd =
      type === "ADD" && ccy === "USD" && rawCost > 0 ? rawCost : null;

    return {
      supplierId: r.supplierId!,
      effectiveDate: String(r.date).substring(0, 10),
      kind,
      adjustKg: kg,
      costPerKgUsd,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      stableId: r.id,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: build batch consumption events
// ─────────────────────────────────────────────────────────────────────────────

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

interface BatchInfo {
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  status: string;
  createdAt: number;
  storedCostPerKg: number;
  storedTotalCost: number;
  totalWeightKg: number;
}

interface SourceInfo {
  sourceId: number;
  batchId: number;
  batchCode: string;
  batchDate: string | null;
  supplierId: number | null;
  containerId: number | null;
  sourceBatchId: number | null;
  weightKg: number;
  storedCostPerKg: number;
  storedTotalCost: number;
  pricingBasis: string;
}

async function buildBatchConsumptionEvents(
  companyId: number,
  supplierIds: Set<number>
): Promise<{ events: BatchConsumptionEvent[]; batchInfoMap: Map<number, BatchInfo>; sourceInfos: SourceInfo[] }> {
  // Load all non-deleted batches and their sources
  const batchRows = await db
    .select()
    .from(factoryMixBatches)
    .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt)));

  const batchIds = batchRows.map((b) => b.id);
  if (batchIds.length === 0) {
    return { events: [], batchInfoMap: new Map(), sourceInfos: [] };
  }

  const sourceRows = await db
    .select()
    .from(factoryMixBatchSources)
    .where(inArray(factoryMixBatchSources.mixBatchId, batchIds));

  const batchInfoMap = new Map<number, BatchInfo>();
  for (const b of batchRows) {
    batchInfoMap.set(b.id, {
      batchId: b.id,
      batchCode: b.batchCode,
      batchDate: b.batchDate ? String(b.batchDate).substring(0, 10) : null,
      status: b.status,
      createdAt: new Date(b.createdAt).getTime(),
      storedCostPerKg: parseFloat(b.costPerKg as string || "0"),
      storedTotalCost: parseFloat(b.totalCost as string || "0"),
      totalWeightKg: parseFloat(b.totalWeightKg as string || "0"),
    });
  }

  const sourceInfos: SourceInfo[] = sourceRows.map((s) => ({
    sourceId: s.id,
    batchId: s.mixBatchId,
    batchCode: batchInfoMap.get(s.mixBatchId)?.batchCode || `#${s.mixBatchId}`,
    batchDate: batchInfoMap.get(s.mixBatchId)?.batchDate || null,
    supplierId: s.supplierId || null,
    containerId: s.containerId || null,
    sourceBatchId: s.sourceBatchId || null,
    weightKg: parseFloat(s.weightKg as string || "0"),
    storedCostPerKg: parseFloat(s.costPerKg as string || "0"),
    storedTotalCost: parseFloat(s.totalCost as string || "0"),
    pricingBasis: resolveMixSourcePricingBasis({
      sourceBatchId: s.sourceBatchId,
      supplierId: s.supplierId,
      containerId: s.containerId,
    }),
  }));

  // Group supplier-priced sources by (supplierId, batchId)
  // These are sources where pricingBasis === "SUPPLIER_LOCKED_RATE"
  const consumptionBySupplierBatch = new Map<string, BatchConsumptionEvent>();

  for (const src of sourceInfos) {
    if (src.pricingBasis !== "SUPPLIER_LOCKED_RATE" || src.supplierId == null) continue;
    if (!supplierIds.has(src.supplierId)) continue;

    const key = `${src.supplierId}:${src.batchId}`;
    const batch = batchInfoMap.get(src.batchId)!;

    if (!consumptionBySupplierBatch.has(key)) {
      const effectiveDate = batch.batchDate || "";
      consumptionBySupplierBatch.set(key, {
        supplierId: src.supplierId,
        effectiveDate,
        batchId: src.batchId,
        batchCode: batch.batchCode,
        consumptionKg: 0,
        sourceIds: [],
        createdAt: batch.createdAt,
        stableId: src.batchId,
      });
    }

    const evt = consumptionBySupplierBatch.get(key)!;
    evt.consumptionKg += src.weightKg;
    evt.sourceIds.push(src.sourceId);
  }

  return {
    events: Array.from(consumptionBySupplierBatch.values()),
    batchInfoMap,
    sourceInfos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: event sorting + ambiguity detection
// ─────────────────────────────────────────────────────────────────────────────

export function sortEvents(events: SupplierEvent[]): { sorted: SupplierEvent[]; ambiguous: boolean } {
  // Primary: effectiveDate (empty dates sort last)
  // Secondary: createdAt
  // Tertiary: stableId
  const withDate = events.filter((e) => e.effectiveDate !== "");
  const withoutDate = events.filter((e) => e.effectiveDate === "");

  // Single authoritative sort: effectiveDate → createdAt → stableId.
  // No event-type priority forcing — the true sequence is determined by persisted
  // timestamps. If timestamps establish the order (receipt.createdAt ≠ batch.createdAt
  // and both are non-zero), we trust them and the replay is non-ambiguous.
  withDate.sort((a, b) => {
    const dateCmp = a.effectiveDate.localeCompare(b.effectiveDate);
    if (dateCmp !== 0) return dateCmp;
    const tsCmp = a.createdAt - b.createdAt;
    if (tsCmp !== 0) return tsCmp;
    return a.stableId - b.stableId;
  });

  // Detect truly ambiguous event ordering.
  // A RECEIPT and BATCH_CONSUMPTION are ambiguous ONLY when:
  //   1. They share the same effective business date, AND
  //   2. Their createdAt timestamps are equal or both missing (cannot establish order), AND
  //   3. Swapping their order would change the rate applied to the batch.
  // When timestamps differ, the sort above has already placed them in the correct
  // chronological order — that is NOT ambiguous.
  let ambiguous = false;
  const dateGroups = new Map<string, SupplierEvent[]>();
  for (const e of withDate) {
    if (!dateGroups.has(e.effectiveDate)) dateGroups.set(e.effectiveDate, []);
    dateGroups.get(e.effectiveDate)!.push(e);
  }
  for (const [, group] of dateGroups) {
    const receipts = group.filter((e) => e.kind === "RECEIPT");
    const consumptions = group.filter((e) => e.kind === "BATCH_CONSUMPTION");
    if (receipts.length === 0 || consumptions.length === 0) continue;
    // Check every pair — if any pair cannot be resolved by timestamp, mark ambiguous.
    for (const rcv of receipts) {
      for (const con of consumptions) {
        // Timestamps resolve the order when both are non-zero and distinct.
        const canResolveByTimestamp = rcv.createdAt !== con.createdAt
          && rcv.createdAt > 0
          && con.createdAt > 0;
        if (!canResolveByTimestamp) {
          ambiguous = true;
        }
      }
    }
  }

  return { sorted: [...withDate, ...withoutDate], ambiguous };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: replay the supplier timeline
// ─────────────────────────────────────────────────────────────────────────────

interface ReplayState {
  remaining: Decimal;
  rate: Decimal;
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
  /** Map: batchId → expected supplier rate at consumption point */
  expectedRateAtBatch: Map<number, number>;
  affectedContainerCount: number;
}

/** @internal exported for tests only — use applyHistoricalCostReplay for production writes */
export async function replaySupplierTimeline(
  companyId: number,
  supplierId: number,
  supplierName: string,
  storedRate: number,
  events: SupplierEvent[]
): Promise<SupplierTimelineResult> {
  const { sorted, ambiguous } = sortEvents(events);

  let state: ReplayState = { remaining: new Decimal(0), rate: new Decimal(0) };
  const expectedRateAtBatch = new Map<number, number>();
  let missingDates = 0;
  const affectedContainerIds = new Set<number>();
  const reasons: string[] = [];

  const startingRate = 0; // determined by replay

  for (const evt of sorted) {
    if (evt.effectiveDate === "") missingDates++;

    switch (evt.kind) {
      case "RECEIPT": {
        const rcvKg = new Decimal(evt.receiptKg || 0);
        const canonRate = new Decimal(evt.canonicalRateUsd || 0);
        if (rcvKg.lte(0)) break;

        // newRate = (max(0,signedRemaining) × oldRate + receiptKg × canonRate)
        //           ÷ (max(0,signedRemaining) + receiptKg)
        // Per spec: use max(0, signedRemaining) as the old-quantity term so that
        // a negative-stock position does not dilute the new receipt's rate.
        // After the receipt, signedRemaining increases unconditionally (may still be negative).
        const oldPositiveRemaining = Decimal.max(0, state.remaining);
        const denominator = oldPositiveRemaining.plus(rcvKg);
        const newRate = denominator.gt(0)
          ? oldPositiveRemaining.times(state.rate).plus(rcvKg.times(canonRate)).div(denominator)
          : canonRate;

        state = { remaining: state.remaining.plus(rcvKg), rate: newRate };
        if (evt.containerId) affectedContainerIds.add(evt.containerId);
        break;
      }
      case "ADD_ADJUSTMENT": {
        const addKg = new Decimal(evt.adjustKg || 0);
        if (addKg.lte(0)) break;

        // FIX 8: ADD adjustments are strictly quantity-only — they never update the
        // supplier moving-average rate. A stored costPerKg on an ADD row is ambiguous:
        // it could be a legacy data entry, a unit-conversion artefact, or a real
        // opening-balance — the replay engine cannot distinguish them automatically.
        // Only RECEIPT events (generated by the offload workflow) are authorised to
        // move the rate. Legacy ADD rows with non-zero cost that should establish the
        // rate must be converted to RECEIPT events by an admin before the timeline is
        // marked safe to repair.
        state = { remaining: state.remaining.plus(addKg), rate: state.rate };
        break;
      }
      case "REMOVE_ADJUSTMENT":
      case "DEDUCT_ADJUSTMENT": {
        // Preserve signed quantity — do NOT clamp to zero. The system allows negative
        // raw-material positions; clamping would produce incorrect replay totals.
        const rmKg = new Decimal(evt.removeKg || evt.adjustKg || 0);
        state = { remaining: state.remaining.minus(rmKg), rate: state.rate };
        break;
      }
      case "BATCH_CONSUMPTION": {
        // Record expected rate BEFORE consumption
        if (evt.batchId != null) {
          expectedRateAtBatch.set(evt.batchId, state.rate.toDecimalPlaces(8).toNumber());
        }
        // Preserve signed quantity — do NOT clamp to zero. Consumption can push
        // signedRemainingKg negative when batches consume more than received at
        // that point in the timeline.
        const consumedKg = new Decimal(evt.consumptionKg || 0);
        state = { remaining: state.remaining.minus(consumedKg), rate: state.rate };
        break;
      }
    }
  }

  const endingRate = state.rate.toDecimalPlaces(8).toNumber();
  const replayRemainingKg = state.remaining.toDecimalPlaces(3).toNumber();

  // Check quantity reconciliation against the authoritative remaining
  const authoritativeRemainingKg = await getAuthoritativeSupplierRemainingKg(db, companyId, supplierId);
  const diff = Math.abs(replayRemainingKg - authoritativeRemainingKg);
  const quantityMismatch = diff > 0.001;

  let safeToRepair = true;
  if (quantityMismatch) {
    safeToRepair = false;
    reasons.push("TIMELINE_QUANTITY_MISMATCH");
  }
  if (missingDates > 0) {
    safeToRepair = false;
    reasons.push("MISSING_EVENT_DATES");
  }
  if (ambiguous) {
    // Per spec: ambiguous event ordering (receipt + consumption on same date where the
    // true order cannot be established) must block automatic repair. The admin must
    // resolve the ambiguity before applying. safeToRepair is set regardless of whether
    // quantity reconciles.
    safeToRepair = false;
    reasons.push("TIMELINE_ORDER_AMBIGUOUS");
  }

  return {
    supplierId,
    supplierName,
    currentStoredRate: storedRate,
    startingRate,
    endingRate,
    replayRemainingKg,
    authoritativeRemainingKg,
    quantityMismatch,
    missingDates,
    ambiguous,
    safeToRepair,
    reasons,
    eventCount: sorted.length,
    expectedRateAtBatch,
    affectedContainerCount: affectedContainerIds.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 8: compute batch corrections (dependency order)
// ─────────────────────────────────────────────────────────────────────────────

interface BatchCorrection {
  batchId: number;
  batchCode: string;
  status: string;
  batchDate: string | null;
  storedCostPerKg: number;
  expectedCostPerKg: number;
  storedTotalCost: number;
  expectedTotalCost: number;
  correctedSourceCosts: Map<number, number>; // sourceId → corrected costPerKg
}

/** DEFECT 12 FIX: Batches excluded from corrections (cycle or missing upstream). */
interface BlockedBatch {
  batchId: number;
  batchCode: string;
  reasons: string[];
  dependencyPath: number[];
}

function computeBatchCorrections(
  batchInfoMap: Map<number, BatchInfo>,
  sourceInfos: SourceInfo[],
  /** supplierTimeline.expectedRateAtBatch for all suppliers combined */
  expectedRateAtBatch: Map<string, number>, // `${supplierId}:${batchId}` → rate
  canonicalRateByContainer: Map<number, number>
): { corrections: BatchCorrection[]; blockedBatches: BlockedBatch[] } {
  // Build corrected cost per source
  const correctedCostBySource = new Map<number, number>();
  const sourcesGroupedByBatch = new Map<number, SourceInfo[]>();

  for (const src of sourceInfos) {
    if (!sourcesGroupedByBatch.has(src.batchId)) sourcesGroupedByBatch.set(src.batchId, []);
    sourcesGroupedByBatch.get(src.batchId)!.push(src);
  }

  // We need to process batches in dependency order (upstream before downstream)
  // Build dependency graph
  const allBatchIds = new Set(batchInfoMap.keys());
  const batchDepGraph = new Map<number, Set<number>>(); // batchId → Set<upstreamBatchId>
  for (const src of sourceInfos) {
    if (src.sourceBatchId != null && allBatchIds.has(src.batchId)) {
      if (!batchDepGraph.has(src.batchId)) batchDepGraph.set(src.batchId, new Set());
      batchDepGraph.get(src.batchId)!.add(src.sourceBatchId);
    }
  }

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, Set<number>>(); // upstream → Set<downstream>
  for (const [batchId, deps] of batchDepGraph) {
    inDegree.set(batchId, (inDegree.get(batchId) || 0) + deps.size);
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep)!.add(batchId);
    }
  }

  const queue: number[] = [];
  for (const batchId of allBatchIds) {
    if ((inDegree.get(batchId) || 0) === 0) queue.push(batchId);
  }

  const processOrder: number[] = [];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    processOrder.push(current);
    for (const downstream of dependents.get(current) || []) {
      const newDeg = (inDegree.get(downstream) || 0) - 1;
      inDegree.set(downstream, newDeg);
      if (newDeg <= 0) queue.push(downstream);
    }
  }

  // FIX 13: Any batchId that survives the toposort unvisited is part of a dependency cycle.
  // Mark those batches as not-safe-to-repair (they are excluded from corrections below).
  const cycleBatchIds = new Set<number>();
  for (const batchId of allBatchIds) {
    if (!visited.has(batchId)) {
      cycleBatchIds.add(batchId);
    }
  }
  // Also detect missing upstream batches: a BATCH-type source whose sourceBatchId is not
  // in allBatchIds means the upstream was deleted or belongs to a different company.
  const missingUpstreamBatchIds = new Set<number>();
  for (const src of sourceInfos) {
    if (src.sourceBatchId != null && !allBatchIds.has(src.sourceBatchId)) {
      missingUpstreamBatchIds.add(src.batchId); // the consumer is blocked
    }
  }

  // Corrected costPerKg per batch (computed as we process in order)
  const correctedBatchCost = new Map<number, number>(); // batchId → corrected costPerKg

  const corrections: BatchCorrection[] = [];

  for (const batchId of processOrder) {
    // FIX 13: skip batches in a dependency cycle or with missing upstream batches
    if (cycleBatchIds.has(batchId) || missingUpstreamBatchIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    if (!batch) continue;
    const sources = sourcesGroupedByBatch.get(batchId) || [];
    if (sources.length === 0) continue;

    // DEFECT 9 FIX: Propagate blocked status from upstream batches recursively.
    // Since processOrder is topological (upstream before downstream), any blocked
    // upstream that was added to missingUpstreamBatchIds mid-loop is visible here.
    const hasBlockedUpstreamBatch = sources.some(
      (s) =>
        s.pricingBasis === "BATCH" &&
        s.sourceBatchId != null &&
        (cycleBatchIds.has(s.sourceBatchId) || missingUpstreamBatchIds.has(s.sourceBatchId))
    );
    if (hasBlockedUpstreamBatch) {
      missingUpstreamBatchIds.add(batchId); // propagate the block downstream
      continue;
    }

    let dTotalCost = new Decimal(0);
    let dTotalWeight = new Decimal(0);
    const correctedSourceCosts = new Map<number, number>();

    // DEFECT 9 FIX: flag is set when the safety-net path detects an unresolvable
    // upstream inside the inner source loop. The outer loop checks this flag and
    // skips computing/registering any correction for the blocked batch, preventing
    // partial-total corrections from being emitted.
    let batchBlockedMidLoop = false;

    for (const src of sources) {
      const dWeight = new Decimal(src.weightKg);
      let correctedCostPerKg: number;

      if (src.pricingBasis === "BATCH" && src.sourceBatchId != null) {
        // DEFECT 9 FIX: No ?? fallback — upstream MUST have a corrected cost by now
        // because the pre-loop blocked-upstream check already skipped any batch whose
        // BATCH-type sources reference a blocked upstream.
        if (!correctedBatchCost.has(src.sourceBatchId)) {
          // Safety net — should not occur in normal operation since the pre-loop check
          // handles it, but guard here to be safe.
          missingUpstreamBatchIds.add(batchId); // mark blocked so downstream batches skip too
          batchBlockedMidLoop = true;
          break; // break inner loop; outer loop checks batchBlockedMidLoop below
        }
        correctedCostPerKg = correctedBatchCost.get(src.sourceBatchId)!;
      } else if (src.pricingBasis === "SUPPLIER_LOCKED_RATE" && src.supplierId != null) {
        // Use expected historical supplier rate at this batch; skip if unavailable.
        const key = `${src.supplierId}:${src.batchId}`;
        if (!expectedRateAtBatch.has(key)) continue;
        correctedCostPerKg = expectedRateAtBatch.get(key)!;
      } else if (src.pricingBasis === "CONTAINER_DIRECT" && src.containerId != null) {
        // Use canonical container rate; skip if FX unresolved.
        if (!canonicalRateByContainer.has(src.containerId)) continue;
        correctedCostPerKg = canonicalRateByContainer.get(src.containerId)!;
      } else {
        correctedCostPerKg = src.storedCostPerKg;
      }

      correctedSourceCosts.set(src.sourceId, correctedCostPerKg);
      correctedCostBySource.set(src.sourceId, correctedCostPerKg);

      dTotalCost = dTotalCost.plus(dWeight.times(new Decimal(correctedCostPerKg)));
      dTotalWeight = dTotalWeight.plus(dWeight);
    }

    // DEFECT 9 FIX: Do NOT register any correction or correctedBatchCost entry for a
    // batch that was blocked mid-loop. Registering a partial-total correction would
    // emit incorrect expected costs and let downstream batches use those wrong values.
    if (batchBlockedMidLoop) continue;

    const expectedCostPerKg = dTotalWeight.gt(0) ? dTotalCost.div(dTotalWeight).toDecimalPlaces(6).toNumber() : 0;
    const expectedTotalCost = dTotalCost.toDecimalPlaces(6).toNumber();

    correctedBatchCost.set(batchId, expectedCostPerKg);

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

  // DEFECT 12 FIX: Collect blocked batches and return alongside filtered corrections.
  const blockedBatches: BlockedBatch[] = [];
  for (const batchId of cycleBatchIds) {
    const batch = batchInfoMap.get(batchId);
    if (batch) {
      blockedBatches.push({ batchId, batchCode: batch.batchCode, reasons: ["DEPENDENCY_CYCLE"], dependencyPath: [] });
    }
  }
  for (const batchId of missingUpstreamBatchIds) {
    const batch = batchInfoMap.get(batchId);
    if (batch) {
      blockedBatches.push({ batchId, batchCode: batch.batchCode, reasons: ["UPSTREAM_BATCH_MISSING"], dependencyPath: [] });
    }
  }

  const filteredCorrections = corrections.filter((c) => {
    // Only include batches that actually need updating
    const diffCpk = Math.abs(c.expectedCostPerKg - c.storedCostPerKg);
    const diffTot = Math.abs(c.expectedTotalCost - c.storedTotalCost);
    return diffCpk > 0.000001 || diffTot > 0.01;
  });

  return { corrections: filteredCorrections, blockedBatches };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 9: count affected bales per batch
// ─────────────────────────────────────────────────────────────────────────────

interface BaleCountResult {
  total: Map<number, number>;
  finalized: Map<number, number>;
}

async function loadBaleCountsByBatch(
  companyId: number,
  batchIds: number[]
): Promise<BaleCountResult> {
  if (batchIds.length === 0) return { total: new Map(), finalized: new Map() };

  const finalizedIn = FINALIZED_BALE_STATUSES.map((s) => `'${s}'`).join(",");

  const [{ rows: totalRows }, { rows: finalizedRows }] = await Promise.all([
    pool.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1) AND company_id = $2 AND status NOT IN ('DELETED','REMOVED')
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
    pool.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1) AND company_id = $2 AND status IN (${finalizedIn})
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
  ]);

  const total = new Map<number, number>();
  for (const r of totalRows) total.set(r.mix_batch_id, parseInt(r.cnt));
  const finalized = new Map<number, number>();
  for (const r of finalizedRows) finalized.set(r.mix_batch_id, parseInt(r.cnt));
  return { total, finalized };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main preview function
// ─────────────────────────────────────────────────────────────────────────────

export async function previewHistoricalCostReplay(
  companyId: number
): Promise<HistoricalReplayPreviewResult> {
  // 1. Load universe
  const universe = await loadContainerUniverse(companyId);

  // 2. Compute canonical costs
  const canonicals = await computeCanonicalCosts(companyId, universe);

  // Build canonical rate map
  const canonicalRateByContainer = new Map<number, number>();
  for (const c of canonicals) {
    if (!c.fxUnresolved) {
      canonicalRateByContainer.set(c.universe.container.id, c.canonicalCostPerKgUsd);
    }
  }

  // Group containers by supplier
  const supplierIds = new Set<number>();
  for (const c of canonicals) {
    if (c.universe.container.supplierId) supplierIds.add(c.universe.container.supplierId);
  }

  // 3. Load all suppliers
  const supplierRows = supplierIds.size > 0
    ? await db
        .select()
        .from(factorySuppliers)
        .where(
          and(
            eq(factorySuppliers.companyId, companyId),
            inArray(factorySuppliers.id, [...supplierIds])
          )
        )
    : [];
  const supplierMap = new Map(supplierRows.map((s) => [s.id, s]));

  // 4. Build receipt events
  const receiptEvents = await buildReceiptEvents(companyId, canonicals);
  const receiptEventsBySupplierId = new Map<number, ContainerReceiptEvent[]>();
  for (const e of receiptEvents) {
    if (!e.supplierId) continue;
    if (!receiptEventsBySupplierId.has(e.supplierId)) receiptEventsBySupplierId.set(e.supplierId, []);
    receiptEventsBySupplierId.get(e.supplierId)!.push(e);
  }

  // 5. Build adjustment events
  const adjustmentEvents = await buildAdjustmentEvents(companyId);
  const adjustmentEventsBySupplierId = new Map<number, AdjustmentEvent[]>();
  for (const e of adjustmentEvents) {
    if (!adjustmentEventsBySupplierId.has(e.supplierId)) adjustmentEventsBySupplierId.set(e.supplierId, []);
    adjustmentEventsBySupplierId.get(e.supplierId)!.push(e);
  }

  // 6. Build batch consumption events
  const { events: consumptionEvents, batchInfoMap, sourceInfos } =
    await buildBatchConsumptionEvents(companyId, supplierIds);

  const consumptionEventsBySupplierId = new Map<number, BatchConsumptionEvent[]>();
  for (const e of consumptionEvents) {
    if (!consumptionEventsBySupplierId.has(e.supplierId)) consumptionEventsBySupplierId.set(e.supplierId, []);
    consumptionEventsBySupplierId.get(e.supplierId)!.push(e);
  }

  // 7. Replay each supplier timeline
  const timelineResults: SupplierTimelineResult[] = [];
  const allExpectedRatesAtBatch = new Map<string, number>(); // `${supplierId}:${batchId}` → rate

  for (const supplierId of supplierIds) {
    const supplier = supplierMap.get(supplierId);
    if (!supplier) continue;

    const storedRate = parseFloat(supplier.currentRawMaterialCostPerKgUsd as string || "0");
    const supplierName = supplier.name;

    // Build combined event list for this supplier
    const allEvents: SupplierEvent[] = [];

    for (const e of receiptEventsBySupplierId.get(supplierId) || []) {
      allEvents.push({
        kind: "RECEIPT",
        effectiveDate: e.effectiveDate,
        createdAt: e.createdAt,
        stableId: e.stableId,
        containerId: e.containerId,
        canonicalRateUsd: e.canonicalRateUsd,
        receiptKg: e.receiptKg,
      });
    }

    for (const e of adjustmentEventsBySupplierId.get(supplierId) || []) {
      allEvents.push({
        kind: e.kind,
        effectiveDate: e.effectiveDate,
        createdAt: e.createdAt,
        stableId: e.stableId,
        adjustKg: e.adjustKg,
        costPerKgUsd: e.costPerKgUsd,
        removeKg: e.kind !== "ADD_ADJUSTMENT" ? e.adjustKg : undefined,
      });
    }

    for (const e of consumptionEventsBySupplierId.get(supplierId) || []) {
      allEvents.push({
        kind: "BATCH_CONSUMPTION",
        effectiveDate: e.effectiveDate,
        createdAt: e.createdAt,
        stableId: e.stableId,
        batchId: e.batchId,
        batchCode: e.batchCode,
        consumptionKg: e.consumptionKg,
        sourceIds: e.sourceIds,
      });
    }

    if (allEvents.length === 0) continue;

    const timeline = await replaySupplierTimeline(
      companyId,
      supplierId,
      supplierName,
      storedRate,
      allEvents
    );
    timelineResults.push(timeline);

    for (const [batchId, rate] of timeline.expectedRateAtBatch) {
      allExpectedRatesAtBatch.set(`${supplierId}:${batchId}`, rate);
    }
  }

  // 8. Compute batch corrections (DEFECT 12 FIX: returns {corrections, blockedBatches})
  const { corrections: batchCorrections, blockedBatches: batchBlockedBatches } = computeBatchCorrections(
    batchInfoMap,
    sourceInfos,
    allExpectedRatesAtBatch,
    canonicalRateByContainer
  );

  const correctionByBatchId = new Map(batchCorrections.map((c) => [c.batchId, c]));

  // 9. Count affected bales (total + finalized separately)
  const correctedBatchIds = batchCorrections.map((c) => c.batchId);
  const baleCountsByBatch = await loadBaleCountsByBatch(companyId, correctedBatchIds);

  // ─── Build output rows ───────────────────────────────────────────────────

  // Container rows
  const containerRows: ReplayContainerRow[] = canonicals.map((c) => {
    const { container, scanReason, offloadDate } = c.universe;
    return {
      containerId: container.id,
      containerNumber: container.containerNumber,
      status: container.status,
      supplierId: container.supplierId || null,
      eventDate: offloadDate,
      storedCostPerKgUsd: c.storedCostPerKgUsd,
      canonicalCostPerKgUsd: c.canonicalCostPerKgUsd,
      storedTotalUsd: c.storedTotalUsd,
      canonicalTotalUsd: c.canonicalTotalUsd,
      fxUnresolved: c.fxUnresolved,
      safeToRepair: c.safeToRepair,
      reason: c.reason,
      scanReason,
    };
  });

  // Source rows
  const sourceRows: ReplaySourceRow[] = [];
  for (const src of sourceInfos) {
    if (src.pricingBasis === "MANUAL_REVIEW") continue;

    let expectedHistoricalCostPerKg: number;
    let safeToRepair = true;
    let reason: string | null = null;

    if (src.pricingBasis === "SUPPLIER_LOCKED_RATE" && src.supplierId != null) {
      const key = `${src.supplierId}:${src.batchId}`;
      const expectedRate = allExpectedRatesAtBatch.get(key);
      if (expectedRate == null) {
        // Supplier not in safe timelines or batch not in consumption events
        expectedHistoricalCostPerKg = src.storedCostPerKg;
        safeToRepair = false;
        reason = "SUPPLIER_TIMELINE_UNAVAILABLE";
      } else {
        expectedHistoricalCostPerKg = expectedRate;
        // Check if supplier timeline was safe
        const timeline = timelineResults.find((t) => t.supplierId === src.supplierId);
        if (timeline && !timeline.safeToRepair) {
          safeToRepair = false;
          reason = timeline.reasons[0] || "TIMELINE_NOT_SAFE";
        }
      }
    } else if (src.pricingBasis === "CONTAINER_DIRECT" && src.containerId != null) {
      const canonRate = canonicalRateByContainer.get(src.containerId);
      if (canonRate == null) {
        expectedHistoricalCostPerKg = src.storedCostPerKg;
        safeToRepair = false;
        reason = "UNRESOLVED_FX";
      } else {
        expectedHistoricalCostPerKg = canonRate;
      }
    } else if (src.pricingBasis === "BATCH" && src.sourceBatchId != null) {
      const correction = correctionByBatchId.get(src.sourceBatchId);
      expectedHistoricalCostPerKg = correction?.expectedCostPerKg ?? src.storedCostPerKg;
    } else {
      continue;
    }

    const diff = Math.abs(expectedHistoricalCostPerKg - src.storedCostPerKg);
    if (diff < 0.000001) continue; // no mismatch

    sourceRows.push({
      sourceId: src.sourceId,
      batchId: src.batchId,
      batchCode: src.batchCode,
      batchDate: src.batchDate,
      supplierId: src.supplierId,
      containerId: src.containerId,
      pricingBasis: src.pricingBasis,
      storedCostPerKg: src.storedCostPerKg,
      expectedHistoricalCostPerKg,
      storedTotalCost: src.storedTotalCost,
      expectedTotalCost: new Decimal(src.weightKg).times(expectedHistoricalCostPerKg).toDecimalPlaces(6).toNumber(),
      weightKg: src.weightKg,
      safeToRepair,
      reason,
    });
  }

  // Batch rows
  const batchRows: ReplayBatchRow[] = batchCorrections.map((c) => ({
    batchId: c.batchId,
    batchCode: c.batchCode,
    status: c.status,
    batchDate: c.batchDate,
    storedCostPerKg: c.storedCostPerKg,
    expectedCostPerKg: c.expectedCostPerKg,
    storedTotalCost: c.storedTotalCost,
    expectedTotalCost: c.expectedTotalCost,
    affectedBales: baleCountsByBatch.total.get(c.batchId) || 0,
  }));

  // Supplier rows
  const supplierOutputRows: ReplaySupplierRow[] = timelineResults.map((t) => {
    const affectedSourceCount = sourceInfos.filter(
      (s) => s.supplierId === t.supplierId && s.pricingBasis === "SUPPLIER_LOCKED_RATE"
    ).length;
    const affectedBatchIds = new Set(
      batchCorrections
        .filter((b) =>
          sourceInfos.some((s) => s.batchId === b.batchId && s.supplierId === t.supplierId)
        )
        .map((b) => b.batchId)
    );
    const affectedBaleCount = [...affectedBatchIds].reduce(
      (sum, bId) => sum + (baleCountsByBatch.total.get(bId) || 0),
      0
    );
    return {
      supplierId: t.supplierId,
      supplierName: t.supplierName,
      startingRate: t.startingRate,
      endingExpectedRate: t.endingRate,
      currentStoredRate: t.currentStoredRate,
      replayRemainingKg: t.replayRemainingKg,
      authoritativeRemainingKg: t.authoritativeRemainingKg,
      safeToRepair: t.safeToRepair,
      reasons: t.reasons,
      eventCount: t.eventCount,
      affectedContainerCount: t.affectedContainerCount,
      affectedSourceCount,
      affectedBatchCount: affectedBatchIds.size,
      affectedBaleCount,
    };
  });

  // Summary
  const totalReceivedContainers = universe.length;
  const containersScanned = canonicals.length;
  const completedBatchIds = new Set(
    batchCorrections.filter((b) => ["COMPLETED", "CLOSED"].includes(b.status)).map((b) => b.batchId)
  );
  const totalBaleCount = batchRows.reduce((s, b) => s + b.affectedBales, 0);
  const finalizedBaleCount = correctedBatchIds.reduce(
    (sum, bId) => sum + (baleCountsByBatch.finalized.get(bId) || 0),
    0
  );

  const summary: ReplaySummary = {
    totalReceivedContainers,
    containersScanned,
    omittedContainers: totalReceivedContainers - containersScanned,
    canonicalContainerMismatches: canonicals.filter(
      (c) => !c.fxUnresolved && Math.abs(c.canonicalCostPerKgUsd - c.storedCostPerKgUsd) > 0.000001
    ).length,
    suppliersScanned: timelineResults.length,
    safeSuppliers: timelineResults.filter((t) => t.safeToRepair).length,
    manualReviewSuppliers: timelineResults.filter((t) => !t.safeToRepair).length,
    supplierPricedSourcesScanned: sourceInfos.filter(
      (s) => s.pricingBasis === "SUPPLIER_LOCKED_RATE"
    ).length,
    sourceMismatches: sourceRows.length,
    batchesToUpdate: batchCorrections.length,
    completedBatchesToUpdate: completedBatchIds.size,
    balesToUpdate: totalBaleCount,
    finalizedBalesToUpdate: finalizedBaleCount,
    unresolvedFx: canonicals.filter((c) => c.fxUnresolved).length,
    missingDates: timelineResults.reduce((s, t) => s + t.missingDates, 0),
    quantityTimelineMismatches: timelineResults.filter((t) => t.quantityMismatch).length,
    ambiguousEventOrdering: timelineResults.filter((t) => t.ambiguous).length,
    scanCoverageError: containersScanned !== totalReceivedContainers,
  };

  return { summary, supplierRows: supplierOutputRows, containerRows, sourceRows, batchRows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint for apply token
// ─────────────────────────────────────────────────────────────────────────────

export function computeReplayFingerprint(
  companyId: number,
  supplierIds: number[],
  preview: HistoricalReplayPreviewResult,
  opts: { includeCompletedBatches: boolean; includeFinalizedBales: boolean }
): string {
  const sortedSupplierIds = [...supplierIds].sort((a, b) => a - b);
  const payload = {
    algorithmVersion: REPLAY_ALGORITHM_VERSION,
    companyId,
    supplierIds: sortedSupplierIds,
    includeCompletedBatches: opts.includeCompletedBatches,
    includeFinalizedBales: opts.includeFinalizedBales,
    supplierEndingRates: preview.supplierRows
      .filter((s) => sortedSupplierIds.includes(s.supplierId))
      .sort((a, b) => a.supplierId - b.supplierId)
      .map((s) => ({
        id: s.supplierId,
        endingRate: s.endingExpectedRate,
        replayKg: s.replayRemainingKg,
        authoritativeKg: s.authoritativeRemainingKg,
        currentStoredRate: s.currentStoredRate,
        safeToRepair: s.safeToRepair,
      })),
    // DEFECT 3 FIX: Include ALL safeToRepair source rows (SUPPLIER_LOCKED_RATE and
    // CONTAINER_DIRECT) so any cost change on any row invalidates the fingerprint.
    // Previous filter excluded CONTAINER_DIRECT rows (supplierId=null) — now they are covered.
    sourceData: preview.sourceRows
      .filter((s) => s.safeToRepair)
      .sort((a, b) => a.sourceId - b.sourceId)
      .map((s) => ({
        id: s.sourceId,
        supplierId: s.supplierId ?? null,
        containerId: s.containerId ?? null,
        batchId: s.batchId,
        pricingBasis: s.pricingBasis,
        weightKg: s.weightKg,
        storedCostPerKg: s.storedCostPerKg,
        expectedHistoricalCostPerKg: s.expectedHistoricalCostPerKg,
      })),
    batchData: preview.batchRows
      .sort((a, b) => a.batchId - b.batchId)
      .map((b) => ({
        batchId: b.batchId,
        status: b.status,
        storedCostPerKg: b.storedCostPerKg,
        expectedCostPerKg: b.expectedCostPerKg,
        storedTotalCost: b.storedTotalCost,
        expectedTotalCost: b.expectedTotalCost,
      })),
    // DEFECT 2 FIX: Include container data in fingerprint so any container-cost
    // change (FX rate confirmed, additional charges added, etc.) invalidates the token.
    containerData: preview.containerRows
      .filter((c) => !c.fxUnresolved && sortedSupplierIds.includes(c.supplierId ?? -1))
      .sort((a, b) => a.containerId - b.containerId)
      .map((c) => ({
        id: c.containerId,
        supplierId: c.supplierId,
        storedCostPerKgUsd: c.storedCostPerKgUsd,
        canonicalCostPerKgUsd: c.canonicalCostPerKgUsd,
        storedTotalUsd: c.storedTotalUsd,
        canonicalTotalUsd: c.canonicalTotalUsd,
        safeToRepair: c.safeToRepair,
      })),
    summary: {
      sourceMismatches: preview.summary.sourceMismatches,
      batchesToUpdate: preview.summary.batchesToUpdate,
      completedBatchesToUpdate: preview.summary.completedBatchesToUpdate,
      balesToUpdate: preview.summary.balesToUpdate,
      finalizedBalesToUpdate: preview.summary.finalizedBalesToUpdate,
      unresolvedFx: preview.summary.unresolvedFx,
    },
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply function
// ─────────────────────────────────────────────────────────────────────────────

/** Bale statuses that represent sold/dispatched/invoiced bales requiring explicit authorization to update */
export const FINALIZED_BALE_STATUSES = [
  "SOLD",
  "DISPATCHED",
  "RESERVED_FOR_DISPATCH",
  "RESERVED_FOR_ORDER",
  "FINALIZED",
] as const;

export interface ReplayApplyParams {
  companyId: number;
  /** Only apply timelines for these supplier IDs. Pass [] to apply all safe. */
  supplierIds: number[];
  includeCompletedBatches: boolean;
  /**
   * When false (default), bales whose status is in FINALIZED_BALE_STATUSES are skipped.
   * Set true only when the admin has explicitly authorized updating sold/dispatched/invoiced bales.
   */
  includeFinalizedBales: boolean;
  preview: HistoricalReplayPreviewResult;
  /** Re-derived fingerprint from the verified token — must match preview fingerprint */
  expectedFingerprint: string;
  /** Replay algorithm/version identifier — verified at apply to reject tokens from old versions */
  algorithmVersion: string;
  /** userId who issued the dry-run token — must match the applying user */
  issuedByUserId: string;
}

export interface ReplayApplyResult {
  suppliersApplied: number;
  rawStockRowsUpdated: number;
  sourcesUpdated: number;
  batchesUpdated: number;
  balesUpdated: number;
  supplierRatesUpdated: number;
  skippedSupplierIds: number[];
}

/** DEFECT 8 FIX: Single source of truth for the finalized-bale exclusion SQL fragment. */
function buildNotFinalizedClause(includeFinalizedBales: boolean): string {
  if (includeFinalizedBales) {
    return `status NOT IN ('DELETED','REMOVED')`;
  }
  return `status NOT IN ('DELETED','REMOVED','${FINALIZED_BALE_STATUSES.join("','")}')
         AND dispatch_batch_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM customer_order_bales WHERE bale_id = fb.id)
         AND NOT EXISTS (SELECT 1 FROM factory_invoice_loading_bales WHERE bale_id = fb.id)`;
}

/**
 * Capture snapshot of only the exact records that will be written by this replay.
 * FIX 14: scope snapshot to the token-approved supplier/source/batch/bale IDs,
 * not to the entire company's data. Runs inside the caller's transaction so the
 * reads are consistent with the writes that follow.
 */
export async function captureReplaySnapshot(
  client: { query: Function },
  companyId: number,
  supplierIds: number[],
  batchIds: number[],
  sourceIds: number[],
  baleIds: number[]
) {
  const safeSupplierIds = supplierIds.length > 0 ? supplierIds : [-1];
  const safeBatchIds = batchIds.length > 0 ? batchIds : [-1];
  const safeSourceIds = sourceIds.length > 0 ? sourceIds : [-1];
  const safeBaleIds = baleIds.length > 0 ? baleIds : [-1];

  const [
    { rows: rawStockRows },
    { rows: mixBatchSources },
    { rows: mixBatches },
    { rows: bales },
    { rows: supplierRates },
    { rows: containerRows },
  ] = await Promise.all([
    client.query(
      `SELECT frs.id,
              frs.cost_per_kg        AS "costPerKg",
              frs.cost_per_kg_usd    AS "costPerKgUsd"
       FROM factory_raw_stock frs
       JOIN factory_containers fc ON fc.id = frs.container_id
       WHERE frs.company_id = $1
         AND fc.supplier_id = ANY($2)
         AND frs.deleted_at IS NULL`,
      [companyId, safeSupplierIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg  AS "costPerKg",
              total_cost   AS "totalCost"
       FROM factory_mix_batch_sources
       WHERE id = ANY($1)`,
      [safeSourceIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg     AS "costPerKg",
              total_cost      AS "totalCost",
              total_weight_kg AS "totalWeightKg",
              status          AS "status"
       FROM factory_mix_batches
       WHERE id = ANY($1)`,
      [safeBatchIds]
    ),
    client.query(
      `SELECT id,
              cost_per_kg  AS "costPerKg",
              total_cost   AS "totalCost",
              weight_kg    AS "weightKg",
              status       AS "status",
              mix_batch_id AS "mixBatchId"
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
    // DEFECT 6 FIX: capture container cost fields so the undo log can restore them
    // after DEFECT 7 writes update rate_per_kg_usd / final_payable_amount_usd.
    client.query(
      `SELECT id,
              rate_per_kg_usd          AS "ratePerKgUsd",
              final_payable_amount     AS "finalPayableAmount",
              final_payable_amount_usd AS "finalPayableAmountUsd"
       FROM factory_containers
       WHERE supplier_id = ANY($1) AND company_id = $2`,
      [safeSupplierIds, companyId]
    ),
  ]);
  return { rawStockRows, mixBatchSources, mixBatches, bales, suppliers: supplierRates, containers: containerRows };
}

/** Canonical algorithm version — increment whenever the replay formula changes. */
export const REPLAY_ALGORITHM_VERSION = "v2-signed-quantity-max0-receipt";

/**
 * DEFECT 3 FIX: Compute the exact write scope for a Historical Replay dry-run.
 *
 * Uses the same supplier-closure logic as applyHistoricalCostReplay so the
 * confirmation-dialog scope counts exactly match what the apply will write.
 *
 * Suitable for use in the dry-run route handler (before the advisory lock, as
 * it is read-only — no writes or row locks).
 */
export async function computeReplayWriteScope(
  companyId: number,
  requestedSupplierIds: number[],
  preview: HistoricalReplayPreviewResult,
  opts: { includeCompletedBatches: boolean; includeFinalizedBales: boolean }
): Promise<{
  safeSupplierIds: Set<number>;
  containerIds: Set<number>;
  batchIdsToApply: Set<number>;
  sourceIds: Set<number>;
  /** Count of bales that would be updated (approximate — sampled via pool, not locked). */
  baleCount: number;
}> {
  // Build the safe-supplier set using the same filter as applyHistoricalCostReplay.
  const safeTimelines = preview.supplierRows.filter(
    (s) => s.safeToRepair && (requestedSupplierIds.length === 0 || requestedSupplierIds.includes(s.supplierId))
  );
  const safeSupplierIds = new Set(safeTimelines.map((s) => s.supplierId));

  if (safeSupplierIds.size === 0) {
    return { safeSupplierIds, containerIds: new Set(), batchIdsToApply: new Set(), sourceIds: new Set(), baleCount: 0 };
  }

  // Build canonical rates (same logic as apply).
  const { sourceInfos, batchInfoMap } = await buildBatchConsumptionEvents(companyId, safeSupplierIds);
  const canonicals = await computeCanonicalCosts(companyId, await loadContainerUniverse(companyId));
  const canonicalRateByContainer = new Map<number, number>();
  for (const c of canonicals) {
    if (!c.fxUnresolved) canonicalRateByContainer.set(c.universe.container.id, c.canonicalCostPerKgUsd);
  }

  // Container scope: same containers that would be updated.
  const containerIds = new Set(
    preview.containerRows
      .filter((c) => !c.fxUnresolved && c.supplierId != null && safeSupplierIds.has(c.supplierId))
      .map((c) => c.containerId)
  );

  // Rebuild expected rates from preview.
  const allExpectedRatesAtBatch = new Map<string, number>();
  for (const srcRow of preview.sourceRows) {
    if (srcRow.pricingBasis === "SUPPLIER_LOCKED_RATE" && srcRow.supplierId != null) {
      const key = `${srcRow.supplierId}:${srcRow.batchId}`;
      if (!allExpectedRatesAtBatch.has(key)) {
        allExpectedRatesAtBatch.set(key, srcRow.expectedHistoricalCostPerKg);
      }
    }
  }

  const { corrections: batchCorrections } = computeBatchCorrections(
    batchInfoMap,
    sourceInfos,
    allExpectedRatesAtBatch,
    canonicalRateByContainer
  );

  // Batch scope — same gates as apply.
  const COMPLETED_STATUSES = ["COMPLETED", "CLOSED"];
  const batchCorrectionIds = new Set(batchCorrections.map((c) => c.batchId));
  const batchIdsToApply = new Set(
    preview.batchRows
      .filter((b) => {
        if (!batchCorrectionIds.has(b.batchId)) return false;
        if (COMPLETED_STATUSES.includes(b.status) && !opts.includeCompletedBatches) return false;
        return true;
      })
      .map((b) => b.batchId)
  );

  // Source scope — same three-gate filter as apply.
  const sourceIds = new Set(
    preview.sourceRows
      .filter((s) => {
        if (!s.safeToRepair) return false;
        if (!batchIdsToApply.has(s.batchId)) return false;
        if (s.pricingBasis === "SUPPLIER_LOCKED_RATE" && s.supplierId != null)
          return safeSupplierIds.has(s.supplierId);
        if (s.pricingBasis === "CONTAINER_DIRECT" && s.containerId != null)
          return canonicalRateByContainer.has(s.containerId);
        return false;
      })
      .map((s) => s.sourceId)
  );

  // Bale count — approximate (not locked, but consistent with what apply would pick).
  let baleCount = 0;
  if (batchIdsToApply.size > 0) {
    const notFinalizedClause = buildNotFinalizedClause(opts.includeFinalizedBales);
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM factory_bales fb
       WHERE fb.mix_batch_id = ANY($1) AND fb.company_id = $2 AND ${notFinalizedClause}`,
      [[...batchIdsToApply], companyId]
    );
    baleCount = parseInt(rows[0]?.cnt ?? "0", 10);
  }

  return { safeSupplierIds, containerIds, batchIdsToApply, sourceIds, baleCount };
}

export async function applyHistoricalCostReplay(
  params: ReplayApplyParams & {
    /**
     * FIX 16: SHA-256 hex hash of the signed token being consumed. Stored in
     * factory_replay_consumed_tokens inside the apply transaction so the same
     * token cannot apply twice even if the caller retries concurrently.
     */
    tokenHash?: string;
    /**
     * FIX 2: Called inside the transaction after all cost writes succeed but before
     * COMMIT. The route uses this to insert the undo-log row and audit-log row in the
     * same atomic unit as the cost writes. The callback receives the snapshot so the
     * route can store it without an extra DB round-trip.
     */
    onCommit?: (
      client: any,
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
    preview,
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

  // DEFECT 2 FIX: Fingerprint check moved inside the advisory lock (see below).

  // Filter to requested, safe suppliers
  const safeTimelines = preview.supplierRows.filter(
    (s) => s.safeToRepair && (supplierIds.length === 0 || supplierIds.includes(s.supplierId))
  );

  const safeSupplierIds = new Set(safeTimelines.map((s) => s.supplierId));

  const result: ReplayApplyResult = {
    suppliersApplied: 0,
    rawStockRowsUpdated: 0,
    sourcesUpdated: 0,
    batchesUpdated: 0,
    balesUpdated: 0,
    supplierRatesUpdated: 0,
    skippedSupplierIds: preview.supplierRows
      .filter((s) => !safeSupplierIds.has(s.supplierId))
      .map((s) => s.supplierId),
  };

  if (safeTimelines.length === 0) return result;

  // Re-compute corrections from preview data. sourceInfos is already scoped to safeSupplierIds,
  // so batchInfoMap only contains batches with sources from the selected suppliers (FIX 3).
  const { sourceInfos, batchInfoMap } = await buildBatchConsumptionEvents(companyId, safeSupplierIds);
  const canonicals = await computeCanonicalCosts(
    companyId,
    await loadContainerUniverse(companyId)
  );
  const canonicalRateByContainer = new Map<number, number>();
  // DEFECT 8 FIX: Also track canonical total USD per container for accurate container UPDATE.
  const canonicalTotalUsdByContainer = new Map<number, number>();
  for (const c of canonicals) {
    if (!c.fxUnresolved) {
      canonicalRateByContainer.set(c.universe.container.id, c.canonicalCostPerKgUsd);
      canonicalTotalUsdByContainer.set(c.universe.container.id, c.canonicalTotalUsd);
    }
  }

  // Rebuild expected rates from preview
  const allExpectedRatesAtBatch = new Map<string, number>();
  for (const srcRow of preview.sourceRows) {
    if (srcRow.pricingBasis === "SUPPLIER_LOCKED_RATE" && srcRow.supplierId != null) {
      const key = `${srcRow.supplierId}:${srcRow.batchId}`;
      if (!allExpectedRatesAtBatch.has(key)) {
        allExpectedRatesAtBatch.set(key, srcRow.expectedHistoricalCostPerKg);
      }
    }
  }

  // DEFECT 12 FIX (apply caller): destructure named return.
  const { corrections: batchCorrections } = computeBatchCorrections(
    batchInfoMap,
    sourceInfos,
    allExpectedRatesAtBatch,
    canonicalRateByContainer
  );

  // FIX 3: Build exact batch scope — only batches in batchCorrections are in the supplier
  // closure for the selected suppliers. preview.batchRows is not filtered by supplier so
  // using it directly would include batches from unselected suppliers.
  const COMPLETED_STATUSES = ["COMPLETED", "CLOSED"];
  const batchCorrectionIds = new Set(batchCorrections.map((c) => c.batchId));
  const batchIdsToApply = new Set(
    preview.batchRows
      .filter((b) => {
        if (!batchCorrectionIds.has(b.batchId)) return false; // not in supplier closure
        if (COMPLETED_STATUSES.includes(b.status) && !includeCompletedBatches) return false;
        return true;
      })
      .map((b) => b.batchId)
  );

  // Collect the exact IDs of every record that will be touched (FIX 14 — exact snapshot scope).
  // DEFECT 1 FIX (complete): A source is in-scope ONLY when:
  //   1. It is safeToRepair, AND
  //   2. Its batch is in batchIdsToApply (supplier-closure + completed-gate), AND
  //   3. Its supplier/container satisfies the pricing-basis membership check.
  // Without gate 2, CONTAINER_DIRECT sources in batches outside the selected-supplier
  // closure (e.g., a shared batch that also uses a different supplier's material) could
  // be written when the user only approved a subset of suppliers.
  const sourceIdsToUpdate = preview.sourceRows
    .filter((s) => {
      if (!s.safeToRepair) return false;
      // Gate 2: batch must be in the approved write scope.
      if (!batchIdsToApply.has(s.batchId)) return false;
      // Gate 3: pricing-basis-specific supplier/container membership.
      if (s.pricingBasis === "SUPPLIER_LOCKED_RATE" && s.supplierId != null) {
        return safeSupplierIds.has(s.supplierId);
      }
      if (s.pricingBasis === "CONTAINER_DIRECT" && s.containerId != null) {
        return canonicalRateByContainer.has(s.containerId);
      }
      return false;
    })
    .map((s) => s.sourceId);

  // Pre-compute bale IDs that will be updated so snapshot is exact.
  // We query them before the transaction to scope the snapshot correctly.
  const baleIdsToUpdate: number[] = [];
  if (batchIdsToApply.size > 0) {
    // Finalised bales are excluded unless opted in (FIX 10: use real relationship check,
    // not hardcoded status list)
    // DEFECT 8 FIX: Use shared helper — eliminates duplicated inline clause.
    const notFinalizedClause = buildNotFinalizedClause(includeFinalizedBales);
    const { rows: baleIdRows } = await pool.query<{ id: number }>(
      `SELECT fb.id FROM factory_bales fb
       WHERE fb.mix_batch_id = ANY($1) AND fb.company_id = $2 AND ${notFinalizedClause}`,
      [[...batchIdsToApply], companyId]
    );
    for (const r of baleIdRows) baleIdsToUpdate.push(r.id);
  }

  // Acquire company-level advisory lock and apply ALL writes in one transaction (FIX 2)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Advisory lock: namespace 9003 = historical replay
    await client.query(`SELECT pg_advisory_xact_lock(9003, $1)`, [companyId]);

    // DEFECT 2 FIX (complete): Lock-consistent fingerprint verification.
    //
    // After acquiring the advisory lock we SELECT FOR UPDATE ALL rows that will be
    // written (both SUPPLIER_LOCKED_RATE and CONTAINER_DIRECT source rows + all batch
    // rows). This blocks concurrent writers on those rows for the lifetime of this
    // transaction, then we rebuild a fresh preview clone with the live DB stored costs
    // and recompute the fingerprint. Comparing the fresh fingerprint against
    // expectedFingerprint (from the signed token) detects:
    //   - data that changed between dry-run and apply (stale token), AND
    //   - any tampered token payload (fingerprint mismatch).
    {
      // All safe source rows — includes CONTAINER_DIRECT (supplierId=null)
      const allSafeSourceIds = preview.sourceRows
        .filter((s) => s.safeToRepair)
        .map((s) => s.sourceId);

      const batchIdArr = [...batchIdsToApply];

      // Sequential queries: pg client connections are single-connection serial.
      let freshSrcRows: { id: number; cost_per_kg: string }[] = [];
      let freshBatchRows: { id: number; cost_per_kg: string; total_cost: string }[] = [];

      if (allSafeSourceIds.length > 0) {
        const { rows } = await client.query<{ id: number; cost_per_kg: string }>(
          `SELECT id, cost_per_kg FROM factory_mix_batch_sources WHERE id = ANY($1) FOR UPDATE`,
          [allSafeSourceIds]
        );
        freshSrcRows = rows;
      }
      if (batchIdArr.length > 0) {
        const { rows } = await client.query<{ id: number; cost_per_kg: string; total_cost: string }>(
          `SELECT id, cost_per_kg, total_cost FROM factory_mix_batches WHERE id = ANY($1) FOR UPDATE`,
          [batchIdArr]
        );
        freshBatchRows = rows;
      }

      // DEFECT 2 FIX (complete): Lock container rows for approved suppliers too.
      const supplierIdArr = [...safeSupplierIds];
      let freshContainerRows: { id: number; rate_per_kg_usd: string; final_payable_amount_usd: string }[] = [];
      if (supplierIdArr.length > 0) {
        const { rows } = await client.query<{ id: number; rate_per_kg_usd: string; final_payable_amount_usd: string }>(
          `SELECT id, rate_per_kg_usd, final_payable_amount_usd
           FROM factory_containers
           WHERE supplier_id = ANY($1) AND company_id = $2 AND deleted_at IS NULL
           FOR UPDATE`,
          [supplierIdArr, companyId]
        );
        freshContainerRows = rows;
      }

      const freshSrcCost = new Map(freshSrcRows.map((r) => [r.id, r.cost_per_kg]));
      const freshBatchCost = new Map(
        freshBatchRows.map((r) => [r.id, { cost: r.cost_per_kg, total: r.total_cost }])
      );
      const freshContainerCost = new Map(
        freshContainerRows.map((r) => [r.id, { rate: r.rate_per_kg_usd, totalUsd: r.final_payable_amount_usd }])
      );

      // Build fresh preview clone: replace stored costs with live DB values.
      const freshPreview: HistoricalReplayPreviewResult = {
        ...preview,
        sourceRows: preview.sourceRows.map((s) => {
          const live = freshSrcCost.get(s.sourceId);
          return live !== undefined ? { ...s, storedCostPerKg: parseFloat(live) } : s;
        }),
        batchRows: preview.batchRows.map((b) => {
          const live = freshBatchCost.get(b.batchId);
          return live !== undefined
            ? { ...b, storedCostPerKg: parseFloat(live.cost), storedTotalCost: parseFloat(live.total) }
            : b;
        }),
        // DEFECT 2 FIX: Include live container costs in freshPreview so the
        // recomputed fingerprint reflects any changes to containers since dry-run.
        containerRows: preview.containerRows.map((c) => {
          const live = freshContainerCost.get(c.containerId);
          return live !== undefined
            ? { ...c, storedCostPerKgUsd: parseFloat(live.rate), storedTotalUsd: parseFloat(live.totalUsd) }
            : c;
        }),
      };

      // Recompute fingerprint from live DB state and validate against signed token value.
      const freshFingerprint = computeReplayFingerprint(companyId, supplierIds, freshPreview, {
        includeCompletedBatches,
        includeFinalizedBales,
      });
      if (freshFingerprint !== expectedFingerprint) {
        throw new StaleTokenError(
          "Stale token — DB state changed since the dry-run was issued. Re-run the preview to obtain a fresh token."
        );
      }
    }

    // FIX 16 / DEFECT 17: Token table is created by migration; consume the token and
    // record algorithm version + scope fingerprint (DEFECT 11 FIX).
    if (tokenHash) {
      const { rowCount } = await client.query(
        `INSERT INTO factory_replay_consumed_tokens
           (token_hash, company_id, user_id, replay_algorithm_version, scope_fingerprint)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (token_hash) DO NOTHING`,
        [tokenHash, companyId, issuedByUserId, algorithmVersion, expectedFingerprint]
      );
      if (!rowCount || rowCount === 0) {
        throw new Error("This confirmation token has already been used. Re-run the preview to obtain a fresh token.");
      }
    }

    // FIX 14: Capture snapshot of exact records inside the same transaction so the
    // pre-image is consistent with the writes that follow (reads see the locked rows).
    const snapshot = await captureReplaySnapshot(
      client,
      companyId,
      [...safeSupplierIds],
      [...batchIdsToApply],
      sourceIdsToUpdate,
      baleIdsToUpdate
    );

    // 1. Update raw-stock costs for each supplier's containers.
    //    Only cost_per_kg_usd is updated — cost_per_kg is the native-currency landed
    //    cost and must never be overwritten with a USD value.
    for (const timeline of safeTimelines) {
      const { rows: rsRows } = await client.query<{ id: number; container_id: number }>(
        `SELECT frs.id, frs.container_id
         FROM factory_raw_stock frs
         JOIN factory_containers fc ON fc.id = frs.container_id
         WHERE frs.company_id = $1 AND fc.supplier_id = $2 AND frs.deleted_at IS NULL`,
        [companyId, timeline.supplierId]
      );

      for (const rs of rsRows) {
        const canonRate = canonicalRateByContainer.get(rs.container_id);
        if (canonRate == null) continue;
        // DEFECT 1 FIX: company_id guard prevents cross-company write.
        await client.query(
          `UPDATE factory_raw_stock SET cost_per_kg_usd = $1 WHERE id = $2 AND company_id = $3`,
          [new Decimal(canonRate).toDecimalPlaces(6).toFixed(6), rs.id, companyId]
        );
        result.rawStockRowsUpdated++;
      }
    }

    // DEFECT 8 FIX: Update factory_containers using the canonicalTotalUsd from
    // the landed-cost computation, NOT `kg * rate`. This is the authoritative total
    // that accounts for all invoice adjustments and cannot be reconstructed from the
    // rate alone (e.g. when actual_received_kg differs from total_kg or charges are split).
    // DEFECT 1 FIX: Only update containers whose supplier is in the approved safe set.
    for (const [containerId, canonRate] of canonicalRateByContainer) {
      const canonTotalUsd = canonicalTotalUsdByContainer.get(containerId);
      if (canonTotalUsd == null) continue; // no canonical total computed — skip
      await client.query(
        `UPDATE factory_containers
         SET rate_per_kg_usd          = $1,
             final_payable_amount_usd = $2
         WHERE id = $3
           AND company_id = $4
           AND supplier_id = ANY($5)`,
        [
          new Decimal(canonRate).toDecimalPlaces(6).toFixed(6),
          new Decimal(canonTotalUsd).toDecimalPlaces(6).toFixed(6),
          containerId,
          companyId,
          [...safeSupplierIds],
        ]
      );
    }

    // DEFECT 1 FIX: Pre-build an approved sourceId Set from the scoped filter computed
    // above. Write loop uses set membership — this is the authoritative gate; no inline
    // re-evaluation of supplier/container membership inside the hot path.
    const sourceIdsToUpdateSet = new Set(sourceIdsToUpdate);

    // 2. Update mix-batch source costs
    for (const srcRow of preview.sourceRows) {
      if (!srcRow.safeToRepair) continue;
      // DEFECT 1 FIX: Use pre-computed approved set (covers both SUPPLIER_LOCKED_RATE
      // and CONTAINER_DIRECT; any source not in the set is outside the approved scope).
      if (!sourceIdsToUpdateSet.has(srcRow.sourceId)) continue;

      const newCostPerKg = new Decimal(srcRow.expectedHistoricalCostPerKg).toDecimalPlaces(6).toFixed(6);
      const newTotalCost = new Decimal(srcRow.weightKg)
        .times(srcRow.expectedHistoricalCostPerKg)
        .toDecimalPlaces(6)
        .toFixed(6);

      // DEFECT 1 FIX: scoped via mix_batch_id subquery to guard against cross-company write.
      await client.query(
        `UPDATE factory_mix_batch_sources SET cost_per_kg = $1, total_cost = $2
         WHERE id = $3
           AND mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = $4)`,
        [newCostPerKg, newTotalCost, srcRow.sourceId, companyId]
      );
      result.sourcesUpdated++;
    }

    // 3. Update batch costs and cascade to bales (FIX 10: relationship-based finalized check)
    for (const correction of batchCorrections) {
      if (!batchIdsToApply.has(correction.batchId)) continue;

      // DEFECT 1 FIX: company_id guard.
      await client.query(
        `UPDATE factory_mix_batches SET cost_per_kg = $1, total_cost = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4`,
        [
          new Decimal(correction.expectedCostPerKg).toDecimalPlaces(6).toFixed(6),
          new Decimal(correction.expectedTotalCost).toDecimalPlaces(6).toFixed(6),
          correction.batchId,
          companyId,
        ]
      );
      result.batchesUpdated++;

      // DEFECT 8 FIX + FIX 10: Use shared helper for finalized-bale detection.
      const notFinalizedClause = buildNotFinalizedClause(includeFinalizedBales);
      const { rows: baleRows } = await client.query<{ id: number; weight_kg: string }>(
        `SELECT fb.id, fb.weight_kg FROM factory_bales fb
         WHERE fb.mix_batch_id = $1 AND fb.company_id = $2 AND ${notFinalizedClause}`,
        [correction.batchId, companyId]
      );
      for (const bale of baleRows) {
        const dWeight = new Decimal(bale.weight_kg || "0");
        const dCost = new Decimal(correction.expectedCostPerKg);
        // DEFECT 1 FIX: company_id guard.
        await client.query(
          `UPDATE factory_bales SET cost_per_kg = $1, total_cost = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4`,
          [
            dCost.toDecimalPlaces(6).toFixed(6),
            dWeight.times(dCost).toDecimalPlaces(6).toFixed(6),
            bale.id,
            companyId,
          ]
        );
        result.balesUpdated++;
      }
    }

    // 4. Update supplier locked rates
    for (const timeline of safeTimelines) {
      if (timeline.endingExpectedRate > 0) {
        await client.query(
          `UPDATE factory_suppliers SET current_raw_material_cost_per_kg_usd = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [
            new Decimal(timeline.endingExpectedRate).toDecimalPlaces(8).toFixed(8),
            timeline.supplierId,
            companyId,
          ]
        );
        result.supplierRatesUpdated++;
      }
      result.suppliersApplied++;
    }

    // DEFECT 10 FIX: Pre-commit cost-only invariant check.
    // Historical replay only writes cost fields. If any non-cost field (weight, status,
    // mix_batch_id, location) changed during our transaction, something is seriously wrong.
    // Throw HISTORICAL_REPLAY_INVARIANT_VIOLATION so callers know to investigate.
    {
      const batchIdArr = [...batchIdsToApply];
      if (batchIdArr.length > 0) {
        const { rows: postBatches } = await client.query<{ id: number; total_weight_kg: string; status: string }>(
          `SELECT id, total_weight_kg, status FROM factory_mix_batches WHERE id = ANY($1)`,
          [batchIdArr]
        );
        const preByBatch = new Map<number, { totalWeightKg: string; status: string }>(
          (snapshot.mixBatches as Array<{ id: number; totalWeightKg: string; status: string }>).map((b) => [b.id, { totalWeightKg: b.totalWeightKg, status: b.status }])
        );
        for (const post of postBatches) {
          const pre = preByBatch.get(post.id);
          if (!pre) continue;
          if (Math.abs(parseFloat(pre.totalWeightKg) - parseFloat(post.total_weight_kg)) > 0.001) {
            throw Object.assign(
              new Error(
                `HISTORICAL_REPLAY_INVARIANT_VIOLATION: batch ${post.id} weight changed from ${pre.totalWeightKg} to ${post.total_weight_kg}. Rolling back.`
              ),
              { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
            );
          }
          if (pre.status !== post.status) {
            throw Object.assign(
              new Error(
                `HISTORICAL_REPLAY_INVARIANT_VIOLATION: batch ${post.id} status changed from ${pre.status} to ${post.status}. Rolling back.`
              ),
              { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
            );
          }
        }
      }

      // Also verify bale non-cost fields didn't change.
      if (baleIdsToUpdate.length > 0) {
        const { rows: postBales } = await client.query<{
          id: number; weight_kg: string; status: string; mix_batch_id: number | null;
        }>(
          `SELECT id, weight_kg, status, mix_batch_id FROM factory_bales WHERE id = ANY($1)`,
          [baleIdsToUpdate]
        );
        const preByBale = new Map<number, { weightKg: string; status: string; mixBatchId: number | null }>(
          (snapshot.bales as Array<{ id: number; weightKg: string; status: string; mixBatchId: number | null }>).map(
            (b) => [b.id, { weightKg: b.weightKg, status: b.status, mixBatchId: b.mixBatchId }]
          )
        );
        for (const post of postBales) {
          const pre = preByBale.get(post.id);
          if (!pre) continue;
          if (Math.abs(parseFloat(pre.weightKg) - parseFloat(post.weight_kg)) > 0.001) {
            throw Object.assign(
              new Error(
                `HISTORICAL_REPLAY_INVARIANT_VIOLATION: bale ${post.id} weight changed from ${pre.weightKg} to ${post.weight_kg}. Rolling back.`
              ),
              { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
            );
          }
          if (pre.status !== post.status) {
            throw Object.assign(
              new Error(
                `HISTORICAL_REPLAY_INVARIANT_VIOLATION: bale ${post.id} status changed from ${pre.status} to ${post.status}. Rolling back.`
              ),
              { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
            );
          }
          if (pre.mixBatchId !== post.mix_batch_id) {
            throw Object.assign(
              new Error(
                `HISTORICAL_REPLAY_INVARIANT_VIOLATION: bale ${post.id} mix_batch_id changed from ${pre.mixBatchId} to ${post.mix_batch_id}. Rolling back.`
              ),
              { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
            );
          }
        }
      }
    }

    // DEFECT 9+11 FIX: Source-cost sum invariant — verify each updated batch's source cost
    // sum matches the expected total cost before committing.
    // DEFECT 9 FIX: Skip sources that are NOT safeToRepair (no ?? storedCostPerKg fallback).
    for (const correction of batchCorrections) {
      if (!batchIdsToApply.has(correction.batchId)) continue;
      const sourcesForBatch = sourceInfos.filter((s) => s.batchId === correction.batchId);
      if (sourcesForBatch.length === 0) continue;
      let dSumCost = new Decimal(0);
      for (const src of sourcesForBatch) {
        const previewSrc = preview.sourceRows.find((ps) => ps.sourceId === src.sourceId);
        // DEFECT 9 FIX: Skip this source from the invariant sum if it is not safeToRepair.
        // Using a storedCostPerKg fallback would mask genuine invariant violations.
        if (!previewSrc || !previewSrc.safeToRepair) continue;
        const correctedCost = previewSrc.expectedHistoricalCostPerKg;
        dSumCost = dSumCost.plus(new Decimal(src.weightKg).times(correctedCost));
      }
      const expectedTotal = new Decimal(correction.expectedTotalCost);
      if (dSumCost.minus(expectedTotal).abs().gt(new Decimal("0.02"))) {
        throw new Error(
          `Source-cost sum invariant violated for batch ${correction.batchId} (${correction.batchCode}): ` +
            `source sum ${dSumCost.toFixed(6)} diverges from expected total ${expectedTotal.toFixed(6)} by > 0.02. Rolling back.`
        );
      }
    }

    // FIX 2: Run the route-injected callback (undo log + audit log) inside the same
    // transaction so they are committed or rolled back atomically with the cost writes.
    if (onCommit) {
      await onCommit(client, result, snapshot);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return result;
}
