import { sql } from "drizzle-orm";

export class TransactionCompanyScopeError extends Error {
  readonly code = "TRANSACTION_COMPANY_SCOPE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "TransactionCompanyScopeError";
  }
}

function positiveCompanyId(value: unknown): number {
  const companyId = Number(value);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new TransactionCompanyScopeError("companyId must be a positive integer");
  }
  return companyId;
}

/**
 * Assert the authoritative company on the current PostgreSQL transaction.
 *
 * The Phase 3 RLS-readiness policies consult app.current_company_id when it is
 * present. Central accounting/inventory services call this at the start of their
 * transaction-owned write boundary so all compatible reads and writes receive a
 * database-level tenant guard in addition to application ownership checks.
 *
 * `set_config(..., true)` is transaction-local: PostgreSQL automatically clears
 * the value at commit/rollback, preventing pooled connections from leaking one
 * company's identity into the next request.
 */
export async function assertTransactionCompanyScope(tx: any, value: unknown): Promise<number> {
  const companyId = positiveCompanyId(value);
  await tx.execute(
    sql`SELECT set_config('app.current_company_id', ${String(companyId)}, true)`,
  );
  return companyId;
}
