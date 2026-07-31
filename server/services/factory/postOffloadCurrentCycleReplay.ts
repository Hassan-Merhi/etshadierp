import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { pool } from "../../db";

export type PostOffloadCurrentCycleReplayStatus =
  | "current_cycle_applied"
  | "no_changes"
  | "failed";

export interface PostOffloadCurrentCycleReplayResult {
  status: PostOffloadCurrentCycleReplayStatus;
  policy: "CURRENT_CYCLE_ONLY";
  supplierId: number | null;
  containerId: number;
  chargeId?: number | null;
  cycleStartAt?: string;
  reason?: string;
  code?: string;
  sourceRowsUpdated?: number;
  batchesUpdated?: number;
  balesUpdated?: number;
  olderBatchesFrozen: true;
}

interface CurrentCycleReplayParams {
  companyId: number;
  containerId: number;
  chargeId?: number | null;
  mutationAction: "CREATE" | "EDIT" | "UNDO" | "LEGACY_REBUILD";
  userId: string;
  username?: string | null;
}

interface CycleContextRow {
  supplier_id: number | null;
  container_number: string | null;
  offloaded_at: Date | string | null;
}

interface SupplierRateRow {
  rate: string | null;
}

interface LatestOffloadRow {
  container_id: number;
  offloaded_at: Date | string | null;
}

interface SourceRow {
  source_id: number;
  mix_batch_id: number;
  weight_kg: string;
  old_cost_per_kg: string;
  old_total_cost: string;
  batch_status: string;
}

interface ChildSourceRow {
  source_id: number;
  mix_batch_id: number;
  weight_kg: string;
  batch_status: string;
}

interface BatchRow {
  id: number;
  batch_code: string;
  status: string;
  cost_per_kg: string;
  total_cost: string;
}

interface BatchAggregateRow {
  total_weight_kg: string;
  total_cost: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function decimal(value: string | number | null | undefined): Decimal {
  try {
    const parsed = new Decimal(value ?? 0);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function updateSourceCost(
  client: PoolClient,
  sourceId: number,
  weightKg: string,
  rate: Decimal
): Promise<void> {
  const total = decimal(weightKg).times(rate).toDecimalPlaces(6).toFixed(6);
  await client.query(
    `UPDATE factory_mix_batch_sources
     SET cost_per_kg = $1,
         total_cost = $2
     WHERE id = $3`,
    [rate.toDecimalPlaces(6).toFixed(6), total, sourceId]
  );
}

async function recomputeBatch(
  client: PoolClient,
  companyId: number,
  batchId: number
): Promise<{
  batchCode: string;
  status: string;
  oldCostPerKg: string;
  newCostPerKg: string;
  oldTotalCost: string;
  newTotalCost: string;
  balesUpdated: number;
}> {
  const batchResult = await client.query<BatchRow>(
    `SELECT id, batch_code, status, cost_per_kg, total_cost
     FROM factory_mix_batches
     WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [batchId, companyId]
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new Error(`Current-cycle batch ${batchId} was not found.`);

  const aggregateResult = await client.query<BatchAggregateRow>(
    `SELECT COALESCE(SUM(weight_kg), 0)::text AS total_weight_kg,
            COALESCE(SUM(total_cost), 0)::text AS total_cost
     FROM factory_mix_batch_sources
     WHERE mix_batch_id = $1`,
    [batchId]
  );
  const totalWeight = decimal(aggregateResult.rows[0]?.total_weight_kg);
  const totalCost = decimal(aggregateResult.rows[0]?.total_cost);
  const nextRate = totalWeight.gt(0) ? totalCost.div(totalWeight) : new Decimal(0);
  const formattedRate = nextRate.toDecimalPlaces(6).toFixed(6);
  const formattedTotal = totalCost.toDecimalPlaces(6).toFixed(6);

  await client.query(
    `UPDATE factory_mix_batches
     SET cost_per_kg = $1,
         total_cost = $2,
         updated_at = NOW()
     WHERE id = $3 AND company_id = $4`,
    [formattedRate, formattedTotal, batchId, companyId]
  );

  const baleResult = await client.query(
    `UPDATE factory_bales fb
     SET cost_per_kg = $3,
         total_cost = ROUND(fb.weight_kg::numeric * $3::numeric, 6),
         updated_at = NOW()
     WHERE fb.company_id = $1
       AND fb.mix_batch_id = $2
       AND fb.status NOT IN (
         'DELETED', 'REMOVED', 'SOLD', 'DISPATCHED',
         'RESERVED_FOR_DISPATCH', 'RESERVED_FOR_ORDER', 'FINALIZED'
       )
       AND fb.finalized_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM customer_order_bales cob
         JOIN customer_orders co ON co.id = cob.order_id
         WHERE cob.bale_id = fb.id
           AND co.company_id = fb.company_id
           AND co.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1
         FROM factory_invoice_loading_bales filb
         WHERE filb.bale_id = fb.id
       )`,
    [companyId, batchId, formattedRate]
  );

  return {
    batchCode: batch.batch_code,
    status: batch.status,
    oldCostPerKg: decimal(batch.cost_per_kg).toDecimalPlaces(6).toFixed(6),
    newCostPerKg: formattedRate,
    oldTotalCost: decimal(batch.total_cost).toDecimalPlaces(6).toFixed(6),
    newTotalCost: formattedTotal,
    balesUpdated: baleResult.rowCount ?? 0,
  };
}

/**
 * Reprice only the latest supplier container cycle after a post-offload charge.
 *
 * Batches created before the affected container offload remain frozen. Supplier
 * source rows created from that offload forward use the supplier's corrected
 * locked rate, while source-batch rows retain their stored parent cost. Eligible
 * dependent batches are then recomputed in dependency order. Sold/finalized
 * bales remain untouched.
 */
export async function replayPostOffloadCurrentCycleCosts(
  params: CurrentCycleReplayParams
): Promise<PostOffloadCurrentCycleReplayResult> {
  const {
    companyId,
    containerId,
    chargeId = null,
    mutationAction,
    userId,
    username = null,
  } = params;
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(9016, $1)", [companyId]);

    const contextResult = await client.query<CycleContextRow>(
      `SELECT c.supplier_id,
              c.container_number,
              rs.offloaded_at
       FROM factory_containers c
       JOIN factory_raw_stock rs
         ON rs.container_id = c.id
        AND rs.company_id = c.company_id
       WHERE c.id = $1
         AND c.company_id = $2
         AND c.deleted_at IS NULL
       ORDER BY rs.offloaded_at ASC, rs.id ASC
       LIMIT 1
       FOR UPDATE OF c, rs`,
      [containerId, companyId]
    );
    const context = contextResult.rows[0];
    if (!context?.supplier_id || !context.offloaded_at) {
      await client.query("COMMIT");
      transactionStarted = false;
      return {
        status: "no_changes",
        policy: "CURRENT_CYCLE_ONLY",
        supplierId: context?.supplier_id ?? null,
        containerId,
        chargeId,
        reason: "The container has no supplier-backed offload cycle to reprice.",
        olderBatchesFrozen: true,
      };
    }

    const supplierId = context.supplier_id;
    const cycleStartAt = iso(context.offloaded_at);

    const latestResult = await client.query<LatestOffloadRow>(
      `SELECT c.id AS container_id,
              MIN(rs.offloaded_at) AS offloaded_at
       FROM factory_containers c
       JOIN factory_raw_stock rs
         ON rs.container_id = c.id
        AND rs.company_id = c.company_id
       WHERE c.company_id = $1
         AND c.supplier_id = $2
         AND c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY MIN(rs.offloaded_at) DESC, c.id DESC
       LIMIT 1`,
      [companyId, supplierId]
    );
    const latest = latestResult.rows[0];
    if (!latest || latest.container_id !== containerId) {
      await client.query("COMMIT");
      transactionStarted = false;
      return {
        status: "no_changes",
        policy: "CURRENT_CYCLE_ONLY",
        supplierId,
        containerId,
        chargeId,
        cycleStartAt,
        reason:
          "The affected container is not the supplier's latest offload cycle; older batch history remains frozen.",
        olderBatchesFrozen: true,
      };
    }

    const rateResult = await client.query<SupplierRateRow>(
      `SELECT current_raw_material_cost_per_kg_usd AS rate
       FROM factory_suppliers
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [supplierId, companyId]
    );
    const supplierRate = decimal(rateResult.rows[0]?.rate);
    if (supplierRate.lte(0)) {
      throw new Error("The supplier's current locked raw-material rate is missing or invalid.");
    }

    const initialResult = await client.query<SourceRow>(
      `SELECT mbs.id AS source_id,
              mbs.mix_batch_id,
              mbs.weight_kg,
              mbs.cost_per_kg AS old_cost_per_kg,
              mbs.total_cost AS old_total_cost,
              mb.status AS batch_status
       FROM factory_mix_batch_sources mbs
       JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
       WHERE mb.company_id = $1
         AND mb.deleted_at IS NULL
         AND mb.created_at >= $3::timestamptz
         AND mbs.source_batch_id IS NULL
         AND COALESCE(mbs.inventory_supplier_id, mbs.supplier_id) = $2
       ORDER BY mb.created_at, mb.id, mbs.id
       FOR UPDATE OF mbs, mb`,
      [companyId, supplierId, cycleStartAt]
    );

    if (initialResult.rows.length === 0) {
      await client.query("COMMIT");
      transactionStarted = false;
      return {
        status: "no_changes",
        policy: "CURRENT_CYCLE_ONLY",
        supplierId,
        containerId,
        chargeId,
        cycleStartAt,
        reason: "No mix batches were created in the affected container cycle.",
        sourceRowsUpdated: 0,
        batchesUpdated: 0,
        balesUpdated: 0,
        olderBatchesFrozen: true,
      };
    }

    let sourceRowsUpdated = 0;
    const initialBatchIds = new Set<number>();
    const sourceBefore = initialResult.rows.map((row) => ({
      sourceId: row.source_id,
      batchId: row.mix_batch_id,
      costPerKg: decimal(row.old_cost_per_kg).toDecimalPlaces(6).toFixed(6),
      totalCost: decimal(row.old_total_cost).toDecimalPlaces(6).toFixed(6),
    }));

    for (const source of initialResult.rows) {
      await updateSourceCost(client, source.source_id, source.weight_kg, supplierRate);
      sourceRowsUpdated += 1;
      initialBatchIds.add(source.mix_batch_id);
    }

    const closure = new Set<number>(initialBatchIds);
    const discoveryQueue = [...initialBatchIds];
    const edges = new Map<number, Map<number, ChildSourceRow[]>>();

    while (discoveryQueue.length > 0) {
      const parentBatchId = discoveryQueue.shift()!;
      const childResult = await client.query<ChildSourceRow>(
        `SELECT mbs.id AS source_id,
                mbs.mix_batch_id,
                mbs.weight_kg,
                mb.status AS batch_status
         FROM factory_mix_batch_sources mbs
         JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
         WHERE mbs.source_batch_id = $1
           AND mb.company_id = $2
           AND mb.deleted_at IS NULL
           AND mb.created_at >= $3::timestamptz
         ORDER BY mb.created_at, mb.id, mbs.id
         FOR UPDATE OF mbs, mb`,
        [parentBatchId, companyId, cycleStartAt]
      );

      const children = new Map<number, ChildSourceRow[]>();
      for (const row of childResult.rows) {
        const rows = children.get(row.mix_batch_id) ?? [];
        rows.push(row);
        children.set(row.mix_batch_id, rows);
        if (!closure.has(row.mix_batch_id)) {
          closure.add(row.mix_batch_id);
          discoveryQueue.push(row.mix_batch_id);
        }
      }
      edges.set(parentBatchId, children);
    }

    const indegree = new Map<number, number>();
    for (const batchId of closure) indegree.set(batchId, 0);
    for (const children of edges.values()) {
      for (const childBatchId of children.keys()) {
        if (closure.has(childBatchId)) {
          indegree.set(childBatchId, (indegree.get(childBatchId) ?? 0) + 1);
        }
      }
    }

    const ready = [...closure].filter((batchId) => (indegree.get(batchId) ?? 0) === 0).sort((a, b) => a - b);
    const batchChanges: Array<Record<string, unknown>> = [];
    let batchesUpdated = 0;
    let balesUpdated = 0;

    while (ready.length > 0) {
      const batchId = ready.shift()!;
      const batch = await recomputeBatch(client, companyId, batchId);
      batchesUpdated += 1;
      balesUpdated += batch.balesUpdated;
      batchChanges.push({ batchId, ...batch });

      const children = edges.get(batchId) ?? new Map<number, ChildSourceRow[]>();
      for (const [childBatchId, childSources] of children) {
        for (const source of childSources) {
          await updateSourceCost(client, source.source_id, source.weight_kg, decimal(batch.newCostPerKg));
          sourceRowsUpdated += 1;
        }
        const nextIndegree = (indegree.get(childBatchId) ?? 0) - 1;
        indegree.set(childBatchId, nextIndegree);
        if (nextIndegree === 0) {
          ready.push(childBatchId);
          ready.sort((a, b) => a - b);
        }
      }
    }

    if (batchesUpdated !== closure.size) {
      throw new Error("A cycle was detected in the current-cycle mix-batch dependency graph.");
    }

    await client.query(
      `INSERT INTO audit_log
         (user_id, username, company_id, action, table_name, record_id,
          record_identifier, changes, created_at)
       VALUES ($1, $2, $3, 'post_offload_current_cycle_replay_applied',
               'factory_offload_additional_charges', $4, $5, $6::jsonb, NOW())`,
      [
        userId || null,
        username,
        companyId,
        chargeId ?? containerId,
        `post-offload ${mutationAction.toLowerCase()} current cycle — ${context.container_number || containerId}`,
        JSON.stringify({
          policy: "CURRENT_CYCLE_ONLY",
          mutationAction,
          supplierId,
          containerId,
          chargeId,
          cycleStartAt,
          supplierRate: supplierRate.toDecimalPlaces(6).toFixed(6),
          sourceBefore,
          batchChanges,
          sourceRowsUpdated,
          batchesUpdated,
          balesUpdated,
          olderBatchesFrozen: true,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return {
      status: "current_cycle_applied",
      policy: "CURRENT_CYCLE_ONLY",
      supplierId,
      containerId,
      chargeId,
      cycleStartAt,
      reason: "Current-cycle mix-batch costs were recalculated; older batches remain frozen.",
      sourceRowsUpdated,
      batchesUpdated,
      balesUpdated,
      olderBatchesFrozen: true,
    };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    return {
      status: "failed",
      policy: "CURRENT_CYCLE_ONLY",
      supplierId: null,
      containerId,
      chargeId,
      reason: errorMessage(error),
      code: errorCode(error),
      olderBatchesFrozen: true,
    };
  } finally {
    client.release();
  }
}
