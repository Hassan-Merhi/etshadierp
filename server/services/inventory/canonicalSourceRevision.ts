import { sql } from "drizzle-orm";

import type { CompanyScopedTransaction } from "../security/transactionCompanyScope";

/**
 * The next revision index for a source document in the canonical journal.
 *
 * Some documents are edited after they post: a POS sale is corrected by adding
 * the old quantities back and issuing the new ones. The journal is append-only,
 * so each edit appends its own reversal and reissue rather than rewriting what
 * came before, and every batch needs an idempotency key of its own.
 *
 * The index is the count of request records already recorded for the document.
 * A retry inside the same transaction sees the same count and therefore the same
 * key, so a rolled-back attempt cannot leave a gap or double-post; a genuinely
 * new edit sees the committed rows and moves on to the next index.
 */
export async function nextCanonicalSourceRevision(
  tx: CompanyScopedTransaction,
  companyId: number,
  sourceType: string,
  sourceId: string
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT count(*)::int AS "revisions"
    FROM canonical_stock_movement_requests
    WHERE company_id = ${companyId}
      AND source_type = ${sourceType}
      AND source_id = ${sourceId}
  `);

  const rows =
    typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows) ? result.rows : [];
  const revisions = Number((rows[0] as { revisions?: unknown } | undefined)?.revisions ?? 0);
  return Number.isInteger(revisions) && revisions >= 0 ? revisions : 0;
}
