/**
 * Generic transaction-owned idempotency records for financial operations.
 *
 * Voucher-specific and canonical stock tables remain authoritative for their
 * existing writers. This table is the shared boundary for future migrations
 * and for non-voucher financial documents.
 */
export const financialOperationRequests: string[] = [
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
];