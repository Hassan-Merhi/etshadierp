import Decimal from "decimal.js";
import type { ReplayQueryExecutor, ReplayWriteScope } from "./types";
import type { ExactReplaySnapshot } from "./exactSnapshot";

function canonicalScalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "<null>";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return String(value);
}

function decimalEquals(left: unknown, right: unknown, tolerance = "0.0000001"): boolean {
  if (left == null || right == null) return left == null && right == null;
  try {
    return new Decimal(String(left))
      .minus(new Decimal(String(right)))
      .abs()
      .lte(tolerance);
  } catch {
    return canonicalScalar(left) === canonicalScalar(right);
  }
}

function invariantError(message: string): Error & { code: string } {
  return Object.assign(
    new Error(`HISTORICAL_REPLAY_INVARIANT_VIOLATION: ${message}. Rolling back.`),
    { code: "HISTORICAL_REPLAY_INVARIANT_VIOLATION" }
  );
}

function rowsById(rows: Array<{ id: number }>): Map<number, any> {
  return new Map(rows.map((row) => [Number(row.id), row]));
}

function assertSameIds(
  beforeRows: Array<{ id: number }>,
  afterRows: Array<{ id: number }>,
  label: string
): void {
  const before = [...rowsById(beforeRows).keys()].sort((a, b) => a - b);
  const after = [...rowsById(afterRows).keys()].sort((a, b) => a - b);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw invariantError(`${label} row identity changed`);
  }
}

function assertFieldsUnchanged(
  beforeRows: Array<{ id: number }>,
  afterRows: Array<{ id: number }>,
  label: string,
  fields: string[],
  decimalFields: string[] = []
): void {
  assertSameIds(beforeRows, afterRows, label);
  const afterById = rowsById(afterRows);
  for (const before of beforeRows as any[]) {
    const after = afterById.get(Number(before.id));
    for (const field of fields) {
      const same = decimalFields.includes(field)
        ? decimalEquals(before[field], after[field])
        : canonicalScalar(before[field]) === canonicalScalar(after[field]);
      if (!same) {
        throw invariantError(`${label} ${before.id} changed non-cost field ${field}`);
      }
    }
  }
}

/**
 * Proves the historical replay changed costs only. This intentionally checks
 * signed quantities, ownership, lifecycle state and dependency relationships;
 * negative inventory remains valid and is compared exactly rather than clamped.
 */
export function assertExactReplayNonCostInvariants(
  before: ExactReplaySnapshot,
  after: ExactReplaySnapshot
): void {
  assertFieldsUnchanged(
    before.containers,
    after.containers,
    "container",
    ["supplierId", "status", "companyId", "actualReceivedKg", "totalKg", "declaredKg"],
    ["actualReceivedKg", "totalKg", "declaredKg"]
  );
  assertFieldsUnchanged(
    before.rawStockRows,
    after.rawStockRows,
    "raw-stock",
    ["receivedKg", "usedKg", "containerId", "companyId", "deletedAt"],
    ["receivedKg", "usedKg"]
  );
  assertFieldsUnchanged(
    before.mixBatchSources,
    after.mixBatchSources,
    "source",
    [
      "supplierId",
      "containerId",
      "sourceBatchId",
      "sourceType",
      "sourceId",
      "weightKg",
      "quantityKg",
      "mixBatchId",
    ],
    ["weightKg", "quantityKg"]
  );
  assertFieldsUnchanged(
    before.mixBatches,
    after.mixBatches,
    "batch",
    ["totalWeightKg", "usedKg", "status", "companyId", "deletedAt"],
    ["totalWeightKg", "usedKg"]
  );
  assertFieldsUnchanged(
    before.bales,
    after.bales,
    "bale",
    [
      "weightKg",
      "quantity",
      "status",
      "mixBatchId",
      "erpLocationId",
      "pressingBatchId",
      "finalizedAt",
      "companyId",
      "deletedAt",
    ],
    ["weightKg"]
  );
  assertFieldsUnchanged(
    before.suppliers,
    after.suppliers,
    "supplier",
    ["companyId"]
  );
}

/**
 * Before undo, prove every cost field still equals the exact value written by
 * the replay. This prevents an old undo snapshot from overwriting later edits.
 */
export function assertExactReplayCurrentCostsMatchApplied(
  applied: ExactReplaySnapshot,
  current: ExactReplaySnapshot
): void {
  const checks: Array<{
    label: string;
    appliedRows: Array<{ id: number }>;
    currentRows: Array<{ id: number }>;
    fields: string[];
  }> = [
    {
      label: "container",
      appliedRows: applied.containers,
      currentRows: current.containers,
      fields: ["ratePerKgUsd", "finalPayableAmountUsd"],
    },
    {
      label: "raw-stock",
      appliedRows: applied.rawStockRows,
      currentRows: current.rawStockRows,
      fields: ["costPerKgUsd"],
    },
    {
      label: "source",
      appliedRows: applied.mixBatchSources,
      currentRows: current.mixBatchSources,
      fields: ["costPerKg", "totalCost"],
    },
    {
      label: "batch",
      appliedRows: applied.mixBatches,
      currentRows: current.mixBatches,
      fields: ["costPerKg", "totalCost"],
    },
    {
      label: "bale",
      appliedRows: applied.bales,
      currentRows: current.bales,
      fields: ["costPerKg", "totalCost"],
    },
    {
      label: "supplier",
      appliedRows: applied.suppliers,
      currentRows: current.suppliers,
      fields: ["currentRawMaterialCostPerKgUsd"],
    },
  ];

  for (const check of checks) {
    assertSameIds(check.appliedRows, check.currentRows, check.label);
    const currentById = rowsById(check.currentRows);
    for (const row of check.appliedRows as any[]) {
      const currentRow = currentById.get(Number(row.id));
      for (const field of check.fields) {
        if (!decimalEquals(row[field], currentRow[field])) {
          throw Object.assign(
            new Error(
              `Historical replay undo blocked: ${check.label} ${row.id} ${field} changed after replay. `
              + "Re-run review instead of overwriting the newer value."
            ),
            { code: "HISTORICAL_REPLAY_UNDO_STALE" }
          );
        }
      }
    }
  }
}

/**
 * Validate persisted source totals, not in-memory preview objects. Every updated
 * batch must equal the sum of its persisted source weight × persisted cost.
 */
export async function assertPersistedReplaySourceTotals(
  executor: ReplayQueryExecutor,
  companyId: number,
  scope: ReplayWriteScope
): Promise<void> {
  if (scope.batchIdsToUpdate.length === 0) return;
  const result = await executor.query<{
    batch_id: number;
    batch_total: string;
    persisted_source_total: string;
  }>(
    `SELECT mb.id AS batch_id,
            mb.total_cost AS batch_total,
            COALESCE(SUM(mbs.weight_kg * mbs.cost_per_kg), 0) AS persisted_source_total
     FROM factory_mix_batches mb
     LEFT JOIN factory_mix_batch_sources mbs ON mbs.mix_batch_id = mb.id
     WHERE mb.company_id = $1
       AND mb.id = ANY($2)
     GROUP BY mb.id, mb.total_cost
     ORDER BY mb.id`,
    [companyId, scope.batchIdsToUpdate]
  );

  if (result.rows.length !== scope.batchIdsToUpdate.length) {
    throw invariantError("persisted batch/source scope changed");
  }
  for (const row of result.rows) {
    if (
      new Decimal(row.batch_total || 0)
        .minus(new Decimal(row.persisted_source_total || 0))
        .abs()
        .gt("0.02")
    ) {
      throw invariantError(`batch ${row.batch_id} persisted source total does not equal batch total`);
    }
  }
}
