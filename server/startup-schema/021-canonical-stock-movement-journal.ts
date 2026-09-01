/**
 * Canonical stock movement journal (ERP 90/100 Phase 4).
 *
 * Append-only evidence for every stock movement posted through the canonical
 * stock boundary, plus the idempotency and audit records that make a replayed
 * request a no-op. Convergence reconciliation compares source documents against
 * these rows, so without them the reconciler has nothing to read.
 *
 * The tables were authored as `migrations/0017_canonical_stock_movement_journal.sql`,
 * which is not registered in the drizzle journal and which no wired runner
 * executes — production sets `RUN_STARTUP_MIGRATIONS=false` and CI uses
 * `drizzle-kit push`. They are defined here as well so the ordered startup pass
 * creates them, and in `shared/schema/inventory.ts` so `push` does. Every
 * statement is `IF NOT EXISTS`, so this is idempotent on a database that
 * already has them.
 *
 * Part of the ordered `startupMigrations` array assembled in ./index.ts.
 */
export const canonicalStockMovementJournal: string[] = [
  `CREATE TABLE IF NOT EXISTS canonical_stock_movements (
     id BIGSERIAL PRIMARY KEY,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
     stock_item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
     location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
     quantity_delta NUMERIC(18, 6) NOT NULL,
     unit_cost NUMERIC(18, 6) NOT NULL,
     movement_kind TEXT NOT NULL,
     source_type TEXT NOT NULL,
     source_id TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     reversal_of_movement_id BIGINT REFERENCES canonical_stock_movements(id) ON DELETE RESTRICT,
     occurred_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT canonical_stock_movements_quantity_nonzero CHECK (quantity_delta <> 0),
     CONSTRAINT canonical_stock_movements_unit_cost_nonnegative CHECK (unit_cost >= 0)
   )`,
  `CREATE INDEX IF NOT EXISTS canonical_stock_movements_company_source_idx
     ON canonical_stock_movements(company_id, source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS canonical_stock_movements_company_item_location_idx
     ON canonical_stock_movements(company_id, stock_item_id, location_id)`,
  `CREATE INDEX IF NOT EXISTS canonical_stock_movements_reversal_idx
     ON canonical_stock_movements(reversal_of_movement_id)
     WHERE reversal_of_movement_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS canonical_stock_movement_requests (
     id BIGSERIAL PRIMARY KEY,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
     idempotency_key TEXT NOT NULL,
     source_type TEXT NOT NULL,
     source_id TEXT NOT NULL,
     movement_ids BIGINT[] NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT canonical_stock_movement_requests_company_key_unique
       UNIQUE(company_id, idempotency_key)
   )`,
  `CREATE INDEX IF NOT EXISTS canonical_stock_movement_requests_source_idx
     ON canonical_stock_movement_requests(company_id, source_type, source_id)`,

  `CREATE TABLE IF NOT EXISTS canonical_stock_movement_audit (
     id BIGSERIAL PRIMARY KEY,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
     idempotency_key TEXT NOT NULL,
     source_type TEXT NOT NULL,
     source_id TEXT NOT NULL,
     movement_ids BIGINT[] NOT NULL,
     quantity NUMERIC(18, 6) NOT NULL,
     value NUMERIC(24, 6) NOT NULL,
     actor_user_id TEXT,
     actor_username TEXT,
     reason TEXT,
     occurred_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS canonical_stock_movement_audit_company_source_idx
     ON canonical_stock_movement_audit(company_id, source_type, source_id)`,
];
