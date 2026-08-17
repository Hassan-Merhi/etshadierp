import type { Pool } from "pg";

import { logger } from "../../lib/logger";

const ACCOUNTING_POSTING_REQUESTS_DDL = [
  `CREATE TABLE IF NOT EXISTS accounting_posting_requests (
     id SERIAL PRIMARY KEY,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
     idempotency_key TEXT NOT NULL,
     source_type TEXT NOT NULL,
     source_id TEXT NOT NULL,
     request_fingerprint VARCHAR(64) NOT NULL,
     voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT accounting_posting_requests_company_key_unique UNIQUE(company_id, idempotency_key)
   )`,
  `CREATE INDEX IF NOT EXISTS accounting_posting_requests_company_source_idx
     ON accounting_posting_requests(company_id, source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS accounting_posting_requests_voucher_idx
     ON accounting_posting_requests(voucher_id)`,
] as const;

/**
 * Ensures the canonical accounting idempotency table exists in every runtime
 * migration mode. Production can disable the ordered startup migration pass,
 * so voucher posting cannot rely on that pass alone for its duplicate-write
 * protection.
 */
export async function ensureAccountingPostingRequests(pool: Pool): Promise<void> {
  for (const statement of ACCOUNTING_POSTING_REQUESTS_DDL) {
    await pool.query(statement);
  }
  logger.info("[startup] ✓ Accounting posting request identities ensured");
}

export { ACCOUNTING_POSTING_REQUESTS_DDL };
