import type { HistoricalReplayPreviewResult, ReplayQueryExecutor } from "./types";

/**
 * Receipt-relative quantity changes affect the moving-average denominator. When
 * a receipt and ADD/REMOVE/DEDUCT adjustment share a business date, missing or
 * identical timestamps make their order unprovable and the supplier must block.
 */
export async function findReceiptAdjustmentAmbiguitySupplierIds(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<number[]> {
  const result = await executor.query<{ supplier_id: number }>(
    `WITH explicit_receipts AS (
       SELECT fc.supplier_id,
              fcr.receipt_date::date AS event_date,
              fcr.created_at AS event_created_at
       FROM factory_container_receipts fcr
       JOIN factory_containers fc
         ON fc.id = fcr.container_id AND fc.company_id = fcr.company_id
       WHERE fcr.company_id = $1
         AND fcr.deleted_at IS NULL
         AND fc.deleted_at IS NULL
         AND fc.status != 'DELETED'
         AND fc.supplier_id IS NOT NULL
     ),
     fallback_receipts AS (
       SELECT fc.supplier_id,
              COALESCE(
                (
                  SELECT MIN(fde.tx_date)::date
                  FROM factory_daybook_entries fde
                  WHERE fde.company_id = fc.company_id
                    AND fde.tx_type = 'OFFLOAD_RAW_STOCK'
                    AND CASE
                          WHEN COALESCE(fde.meta_json::jsonb->>'containerId', '') ~ '^[0-9]+$'
                          THEN (fde.meta_json::jsonb->>'containerId')::int
                          ELSE NULL
                        END = fc.id
                ),
                (
                  SELECT MIN(frs.offloaded_at)::date
                  FROM factory_raw_stock frs
                  WHERE frs.company_id = fc.company_id
                    AND frs.container_id = fc.id
                    AND frs.deleted_at IS NULL
                )
              ) AS event_date,
              (
                SELECT MIN(frs.offloaded_at)
                FROM factory_raw_stock frs
                WHERE frs.company_id = fc.company_id
                  AND frs.container_id = fc.id
                  AND frs.deleted_at IS NULL
              ) AS event_created_at
       FROM factory_containers fc
       WHERE fc.company_id = $1
         AND fc.deleted_at IS NULL
         AND fc.status != 'DELETED'
         AND fc.supplier_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM factory_container_receipts fcr
           WHERE fcr.company_id = fc.company_id
             AND fcr.container_id = fc.id
             AND fcr.deleted_at IS NULL
         )
         AND (
           fc.actual_received_kg::numeric > 0
           OR EXISTS (
             SELECT 1 FROM factory_raw_stock frs
             WHERE frs.company_id = fc.company_id
               AND frs.container_id = fc.id
               AND frs.deleted_at IS NULL
           )
         )
     ),
     receipt_events AS (
       SELECT * FROM explicit_receipts
       UNION ALL
       SELECT * FROM fallback_receipts
     ),
     adjustment_events AS (
       SELECT a.*,
              CASE
                WHEN LEFT(a.date, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN LEFT(a.date, 10)::date
                ELSE NULL
              END AS event_date
       FROM factory_raw_material_adjustments a
       WHERE a.company_id = $1
         AND a.supplier_id IS NOT NULL
         AND a.deleted_at IS NULL
     )
     SELECT DISTINCT re.supplier_id
     FROM receipt_events re
     JOIN adjustment_events a
       ON a.supplier_id = re.supplier_id
      AND a.event_date = re.event_date
     WHERE re.event_date IS NOT NULL
       AND (
         re.event_created_at IS NULL
         OR a.created_at IS NULL
         OR re.event_created_at = a.created_at
       )
     ORDER BY re.supplier_id`,
    [companyId]
  );
  return [...new Set(result.rows.map((row) => Number(row.supplier_id)))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right);
}

export function applyReceiptAdjustmentAmbiguityBlocks(
  preview: HistoricalReplayPreviewResult,
  ambiguousSupplierIds: number[]
): HistoricalReplayPreviewResult {
  if (ambiguousSupplierIds.length === 0) return preview;
  const blocked = new Set(ambiguousSupplierIds);
  let newlyBlocked = 0;
  const supplierRows = preview.supplierRows.map((supplier) => {
    if (!blocked.has(supplier.supplierId)) return supplier;
    if (supplier.safeToRepair) newlyBlocked += 1;
    return {
      ...supplier,
      safeToRepair: false,
      reasons: [...new Set([...supplier.reasons, "TIMELINE_ORDER_AMBIGUOUS"])],
    };
  });
  return {
    ...preview,
    supplierRows,
    summary: {
      ...preview.summary,
      ambiguousEventOrdering: preview.summary.ambiguousEventOrdering + ambiguousSupplierIds.length,
      safeSuppliers: Math.max(0, preview.summary.safeSuppliers - newlyBlocked),
      manualReviewSuppliers: preview.summary.manualReviewSuppliers + newlyBlocked,
    },
  };
}
