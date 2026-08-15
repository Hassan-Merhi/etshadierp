import { sql } from "drizzle-orm";

import type { CompanyScopedTransaction } from "../security/transactionCompanyScope";

/**
 * When the canonical stock journal started recording for a company.
 *
 * Documents posted before the journal existed have no evidence and never will:
 * the journal is append-only and is not backfilled, because inventing movement
 * rows for historical documents would fabricate exactly the evidence the
 * reconciliation is supposed to check. Without this boundary every transfer and
 * adjustment made before the journal shipped reconciles as "applied stock with
 * no evidence", which is noise, not a finding.
 *
 * Returns null when the company has no canonical movements at all, in which
 * case no document is expected to have evidence yet.
 */
export async function canonicalJournalStartedAt(tx: CompanyScopedTransaction, companyId: number): Promise<Date | null> {
  const result = await tx.execute(sql`
    SELECT min(created_at) AS "startedAt"
    FROM canonical_stock_movements
    WHERE company_id = ${companyId}
  `);

  const rows =
    typeof result === "object" && result !== null && "rows" in result && Array.isArray(result.rows) ? result.rows : [];
  const startedAt = (rows[0] as { startedAt?: unknown } | undefined)?.startedAt;
  if (startedAt == null) return null;
  const parsed = startedAt instanceof Date ? startedAt : new Date(String(startedAt));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
