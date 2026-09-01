import type { Pool } from "pg";

import { logger } from "../../lib/logger";

export const FINANCIAL_OPERATION_REQUESTS_DDL = [
  `CREATE TABLE IF NOT EXISTS financial_operation_requests (
     id BIGSERIAL PRIMARY KEY,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
     operation_name VARCHAR(160) NOT NULL,
     idempotency_key VARCHAR(180) NOT NULL,
     request_fingerprint VARCHAR(64) NOT NULL,
     state VARCHAR(20) NOT NULL DEFAULT 'processing',
     result_reference TEXT,
     result_status INTEGER,
     result_body JSONB,
     error_code VARCHAR(120),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     completed_at TIMESTAMPTZ,
     CONSTRAINT financial_operation_requests_state_check
       CHECK (state IN ('processing', 'completed', 'failed')),
     CONSTRAINT financial_operation_requests_company_key_unique
       UNIQUE (company_id, operation_name, idempotency_key)
   )`,
  `CREATE INDEX IF NOT EXISTS financial_operation_requests_lookup_idx
     ON financial_operation_requests(company_id, operation_name, idempotency_key, state)`,
  `CREATE INDEX IF NOT EXISTS financial_operation_requests_result_idx
     ON financial_operation_requests(company_id, result_reference)
     WHERE result_reference IS NOT NULL`,
] as const;

/**
 * This table is deliberately ensured outside the ordered migration pass too.
 * Production can run with startup migrations disabled, while a financial write
 * must never silently run without its durable request boundary.
 */
export async function ensureFinancialOperationRequests(pool: Pool): Promise<void> {
  for (const statement of FINANCIAL_OPERATION_REQUESTS_DDL) {
    await pool.query(statement);
  }
  logger.info("[startup] ✓ Financial operation request identities ensured");
}