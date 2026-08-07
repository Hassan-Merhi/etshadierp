/**
 * Startup schema - Phase 4 production-bonus proposal/decision lifecycle.
 *
 * These records are non-cash proposal/audit data. Approved allocations are
 * folded into the existing factory_payrolls.bonuses aggregate; payroll remains
 * the only accounting/payment source so production bonuses cannot double-pay.
 */

export const productionBonusPayroll: string[] = [
  `CREATE TABLE IF NOT EXISTS factory_production_bonus_runs (
      id                          SERIAL PRIMARY KEY,
      company_id                  INTEGER NOT NULL,
      plan_id                     INTEGER,
      plan_entry_id               INTEGER,
      production_date             DATE NOT NULL,
      position_id                 INTEGER NOT NULL REFERENCES factory_production_positions(id) ON DELETE RESTRICT,
      position_name_snapshot      TEXT NOT NULL,
      target_bales                INTEGER NOT NULL DEFAULT 0,
      actual_bales                INTEGER NOT NULL DEFAULT 0,
      extra_bales                 INTEGER NOT NULL DEFAULT 0,
      bonus_per_extra_bale        NUMERIC(20,4) NOT NULL DEFAULT 0,
      bonus_pool                  NUMERIC(20,2) NOT NULL DEFAULT 0,
      member_count                INTEGER NOT NULL DEFAULT 0,
      status                      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      generated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_prod_bonus_runs_company_date_position_unique
       ON factory_production_bonus_runs (company_id, production_date, position_id)`,
  `CREATE INDEX IF NOT EXISTS factory_prod_bonus_runs_company_date_idx
       ON factory_production_bonus_runs (company_id, production_date)`,
  `CREATE INDEX IF NOT EXISTS factory_prod_bonus_runs_position_idx
       ON factory_production_bonus_runs (position_id)`,

  `CREATE TABLE IF NOT EXISTS factory_production_bonus_allocations (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      run_id                INTEGER NOT NULL REFERENCES factory_production_bonus_runs(id) ON DELETE CASCADE,
      worker_id             INTEGER NOT NULL REFERENCES factory_workers(id) ON DELETE RESTRICT,
      worker_name_snapshot  TEXT NOT NULL,
      amount                NUMERIC(20,2) NOT NULL DEFAULT 0,
      decision_status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      payroll_id            INTEGER REFERENCES factory_payrolls(id) ON DELETE SET NULL,
      decided_by            TEXT,
      decided_at            TIMESTAMP,
      decision_note         TEXT,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_prod_bonus_allocations_run_worker_unique
       ON factory_production_bonus_allocations (run_id, worker_id)`,
  `CREATE INDEX IF NOT EXISTS factory_prod_bonus_allocations_company_worker_idx
       ON factory_production_bonus_allocations (company_id, worker_id)`,
  `CREATE INDEX IF NOT EXISTS factory_prod_bonus_allocations_payroll_idx
       ON factory_production_bonus_allocations (payroll_id)`,
  `CREATE INDEX IF NOT EXISTS factory_prod_bonus_allocations_decision_idx
       ON factory_production_bonus_allocations (company_id, decision_status)`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'factory_prod_bonus_runs_status_check'
      ) THEN
        ALTER TABLE factory_production_bonus_runs
          ADD CONSTRAINT factory_prod_bonus_runs_status_check
          CHECK (status IN ('PENDING','PARTIAL','APPROVED','REJECTED'));
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'factory_prod_bonus_allocations_status_check'
      ) THEN
        ALTER TABLE factory_production_bonus_allocations
          ADD CONSTRAINT factory_prod_bonus_allocations_status_check
          CHECK (decision_status IN ('PENDING','APPROVED','REJECTED'));
      END IF;
    END $$`,
];
