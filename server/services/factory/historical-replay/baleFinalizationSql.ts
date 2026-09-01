import { FINALIZED_BALE_STATUSES } from "./types";

/**
 * Backwards-compatible SQL helper for callers that still filter bales inline.
 * Keep it aligned with the authoritative classifier and the actual schema.
 */
export function buildNotFinalizedClause(includeFinalizedBales: boolean): string {
  if (includeFinalizedBales) return `fb.status NOT IN ('DELETED','REMOVED')`;
  return `fb.status NOT IN ('DELETED','REMOVED','${FINALIZED_BALE_STATUSES.join("','")}')
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
            SELECT 1 FROM factory_invoice_loading_bales filb WHERE filb.bale_id = fb.id
          )`;
}
