import crypto from "crypto";
import {
  REPLAY_ALGORITHM_VERSION,
  type HistoricalReplayPreviewResult,
  type ReplayQueryExecutor,
  type ReplayWriteScope,
} from "./types";
import { normalizeReplayWriteScope } from "./selectedScope";

export interface ReplayAuthoritativeInputDigest {
  digest: string;
  counts: Record<string, number>;
}

export type ReplayPreviewWithAuthoritativeDigest = HistoricalReplayPreviewResult & {
  authoritativeInputDigest: string;
  authoritativeInputCounts: Record<string, number>;
};

interface TableDigestRow {
  row_count: string | number;
  row_digest: string;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = canonicalize(record[key]);
    return out;
  }
  return value;
}

function sortNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Produce a deterministic digest in PostgreSQL instead of transferring every
 * row to Node. Each row is hashed first, ordered deterministically, then folded
 * into one table digest. This keeps the replay preview bounded even for large
 * bale/source histories while still invalidating the token on any input change.
 */
function digestSql(innerSql: string, orderExpression: string): string {
  return `
    SELECT COUNT(*)::bigint AS row_count,
           md5(COALESCE(string_agg(row_hash, '' ORDER BY ${orderExpression}), '')) AS row_digest
    FROM (
      SELECT q.*,
             md5(row_to_json(q)::text) AS row_hash
      FROM (${innerSql}) q
    ) digested
  `;
}

/**
 * Hash every persisted row that can affect historical replay math, exact write
 * scope, bale finalization, or authoritative remaining quantity. Prepare uses
 * the pool; Apply recomputes it through the serializable, advisory-locked client.
 */
export async function loadReplayAuthoritativeInputDigest(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<ReplayAuthoritativeInputDigest> {
  const queries: Array<{ key: string; sql: string; params: unknown[] }> = [
    {
      key: "suppliers",
      sql: digestSql(
        `SELECT * FROM factory_suppliers WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "containers",
      sql: digestSql(
        `SELECT * FROM factory_containers WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "rawStock",
      sql: digestSql(
        `SELECT * FROM factory_raw_stock WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "receipts",
      sql: digestSql(
        `SELECT * FROM factory_container_receipts WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "additionalCharges",
      sql: digestSql(
        `SELECT * FROM factory_offload_additional_charges WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "commissions",
      sql: digestSql(
        `SELECT * FROM factory_container_commissions WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "otherCharges",
      sql: digestSql(
        `SELECT * FROM factory_container_other_charges WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "adjustments",
      sql: digestSql(
        `SELECT * FROM factory_raw_material_adjustments WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "mixBatches",
      sql: digestSql(
        `SELECT * FROM factory_mix_batches WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "mixSources",
      sql: digestSql(
        `SELECT mbs.*
         FROM factory_mix_batch_sources mbs
         JOIN factory_mix_batches mb ON mb.id = mbs.mix_batch_id
         WHERE mb.company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "bales",
      sql: digestSql(
        `SELECT * FROM factory_bales WHERE company_id = $1`,
        "id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "customerOrderBales",
      sql: digestSql(
        `SELECT cob.*
         FROM customer_order_bales cob
         JOIN factory_bales fb ON fb.id = cob.bale_id
         WHERE fb.company_id = $1`,
        "bale_id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "invoiceLoadingBales",
      sql: digestSql(
        `SELECT filb.*
         FROM factory_invoice_loading_bales filb
         JOIN factory_bales fb ON fb.id = filb.bale_id
         WHERE fb.company_id = $1`,
        "bale_id, row_hash"
      ),
      params: [companyId],
    },
    {
      key: "offloadDaybook",
      sql: digestSql(
        `SELECT id, company_id, tx_date, tx_type, meta_json, created_at
         FROM factory_daybook_entries
         WHERE company_id = $1 AND tx_type = 'OFFLOAD_RAW_STOCK'`,
        "id, row_hash"
      ),
      params: [companyId],
    },
  ];

  const results = await Promise.all(
    queries.map(async (query) => {
      const result = await executor.query<TableDigestRow>(query.sql, query.params as any[]);
      const row = result.rows[0];
      return {
        key: query.key,
        count: Number(row?.row_count ?? 0),
        digest: row?.row_digest ?? crypto.createHash("md5").update("").digest("hex"),
      };
    })
  );

  const counts: Record<string, number> = {};
  const tableDigests: Record<string, string> = {};
  for (const result of results) {
    counts[result.key] = result.count;
    tableDigests[result.key] = result.digest;
  }

  const payload = { companyId, counts, tableDigests };
  return {
    digest: crypto.createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex"),
    counts,
  };
}

/**
 * The signed replay token is bound to selected suppliers, frozen options, exact
 * write IDs and the authoritative database-input digest. Older previews that do
 * not carry the digest deliberately produce a different hash.
 */
export function computeReplayFingerprint(
  companyId: number,
  supplierIds: number[],
  preview: HistoricalReplayPreviewResult,
  opts: { includeCompletedBatches: boolean; includeFinalizedBales: boolean },
  scope?: ReplayWriteScope
): string {
  const normalizedScope = scope ? normalizeReplayWriteScope(scope) : undefined;
  const selectedSupplierIds = sortNumbers(supplierIds);
  const sourceIds = new Set(normalizedScope?.sourceIdsToUpdate ?? preview.sourceRows.map((row) => row.sourceId));
  const batchIds = new Set(normalizedScope?.batchIdsToUpdate ?? preview.batchRows.map((row) => row.batchId));
  const containerIds = new Set(
    normalizedScope?.containerIdsToUpdate
      ?? preview.containerRows
        .filter((row) => selectedSupplierIds.includes(row.supplierId ?? -1))
        .map((row) => row.containerId)
  );
  const securePreview = preview as Partial<ReplayPreviewWithAuthoritativeDigest>;

  const payload = {
    algorithmVersion: REPLAY_ALGORITHM_VERSION,
    companyId,
    supplierIds: selectedSupplierIds,
    includeCompletedBatches: opts.includeCompletedBatches,
    includeFinalizedBales: opts.includeFinalizedBales,
    scope: normalizedScope,
    authoritativeInputDigest: securePreview.authoritativeInputDigest ?? "MISSING_AUTHORITATIVE_INPUT_DIGEST",
    authoritativeInputCounts: securePreview.authoritativeInputCounts ?? {},
    supplierEndingRates: preview.supplierRows
      .filter((supplier) => selectedSupplierIds.includes(supplier.supplierId))
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
      .filter((source) => sourceIds.has(source.sourceId))
      .sort((left, right) => left.sourceId - right.sourceId)
      .map((source) => ({
        id: source.sourceId,
        batchId: source.batchId,
        supplierId: source.supplierId,
        containerId: source.containerId,
        pricingBasis: source.pricingBasis,
        weightKg: source.weightKg,
        storedCostPerKg: source.storedCostPerKg,
        expectedHistoricalCostPerKg: source.expectedHistoricalCostPerKg,
      })),
    batchData: preview.batchRows
      .filter((batch) => batchIds.has(batch.batchId))
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
      .filter((container) => containerIds.has(container.containerId))
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
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}
