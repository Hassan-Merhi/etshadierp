import {
  FINALIZED_BALE_STATUSES,
  type ReplayQueryExecutor,
} from "./types";

export interface ReplayBaleClassification {
  availableIds: number[];
  finalizedIds: number[];
  byBatchId: Map<number, { availableIds: number[]; finalizedIds: number[] }>;
}

interface ClassifiedBaleRow {
  id: number;
  mix_batch_id: number | null;
  is_finalized: boolean;
}

function sortNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function finalizedStatusSql(): string {
  return FINALIZED_BALE_STATUSES.map((status) => `'${status}'`).join(",");
}

/**
 * One authoritative, company-scoped finalized-bale classifier for Historical
 * Replay. A bale is finalized when its status/finalized timestamp says so, when
 * it belongs to a live customer order, or when it has been placed on invoice
 * loading. Factory POS sale items are product-level and have no bale_id in the
 * current schema, so SOLD status is the schema-supported POS signal.
 */
async function classifyReplayBales(
  executor: ReplayQueryExecutor,
  companyId: number,
  selectorSql: string,
  selectorParams: unknown[]
): Promise<ReplayBaleClassification> {
  const result = await executor.query<ClassifiedBaleRow>(
    `SELECT fb.id,
            fb.mix_batch_id,
            (
              fb.status IN (${finalizedStatusSql()})
              OR fb.finalized_at IS NOT NULL
              OR EXISTS (
                SELECT 1
                FROM customer_order_bales cob
                JOIN customer_orders co ON co.id = cob.order_id
                WHERE cob.bale_id = fb.id
                  AND co.company_id = $1
                  AND co.deleted_at IS NULL
              )
              OR EXISTS (
                SELECT 1
                FROM factory_invoice_loading_bales filb
                WHERE filb.bale_id = fb.id
              )
            ) AS is_finalized
     FROM factory_bales fb
     WHERE fb.company_id = $1
       AND fb.deleted_at IS NULL
       AND fb.status NOT IN ('DELETED', 'REMOVED')
       AND ${selectorSql}
     ORDER BY fb.id`,
    [companyId, ...selectorParams] as any[]
  );

  const availableIds: number[] = [];
  const finalizedIds: number[] = [];
  const byBatchId = new Map<number, { availableIds: number[]; finalizedIds: number[] }>();

  for (const row of result.rows) {
    const bucket = row.mix_batch_id == null
      ? undefined
      : (byBatchId.get(row.mix_batch_id) ?? { availableIds: [], finalizedIds: [] });

    if (row.is_finalized) {
      finalizedIds.push(row.id);
      bucket?.finalizedIds.push(row.id);
    } else {
      availableIds.push(row.id);
      bucket?.availableIds.push(row.id);
    }

    if (row.mix_batch_id != null && bucket) byBatchId.set(row.mix_batch_id, bucket);
  }

  for (const bucket of byBatchId.values()) {
    bucket.availableIds = sortNumbers(bucket.availableIds);
    bucket.finalizedIds = sortNumbers(bucket.finalizedIds);
  }

  return {
    availableIds: sortNumbers(availableIds),
    finalizedIds: sortNumbers(finalizedIds),
    byBatchId,
  };
}

export async function classifyReplayBalesForBatches(
  executor: ReplayQueryExecutor,
  companyId: number,
  batchIds: number[]
): Promise<ReplayBaleClassification> {
  const ids = sortNumbers(batchIds);
  if (ids.length === 0) {
    return { availableIds: [], finalizedIds: [], byBatchId: new Map() };
  }
  return classifyReplayBales(executor, companyId, "fb.mix_batch_id = ANY($2)", [ids]);
}

export async function classifyReplayBalesByIds(
  executor: ReplayQueryExecutor,
  companyId: number,
  baleIds: number[]
): Promise<ReplayBaleClassification> {
  const ids = sortNumbers(baleIds);
  if (ids.length === 0) {
    return { availableIds: [], finalizedIds: [], byBatchId: new Map() };
  }
  return classifyReplayBales(executor, companyId, "fb.id = ANY($2)", [ids]);
}
