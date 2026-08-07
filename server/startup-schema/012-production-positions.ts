/**
 * Startup schema migrations - Factory production positions and effective-dated
 * incentive configuration.
 *
 * These tables intentionally preserve rule and membership history so later
 * production/bonus phases can snapshot the exact configuration that applied on
 * a production date.
 */

export const productionPositions: string[] = [
  `CREATE TABLE IF NOT EXISTS factory_production_positions (
      id          SERIAL PRIMARY KEY,
      company_id  INTEGER NOT NULL,
      name        VARCHAR(160) NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_by  VARCHAR(100),
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_production_positions_company_name_unique
       ON factory_production_positions (company_id, name)`,
  `CREATE INDEX IF NOT EXISTS factory_production_positions_company_active_idx
       ON factory_production_positions (company_id, active)`,

  `CREATE TABLE IF NOT EXISTS factory_production_position_rules (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      position_id           INTEGER NOT NULL REFERENCES factory_production_positions(id) ON DELETE CASCADE,
      effective_from        DATE NOT NULL,
      effective_to          DATE,
      target_bales          INTEGER NOT NULL DEFAULT 0,
      bonus_per_extra_bale  NUMERIC(20,4) NOT NULL DEFAULT 0,
      bonus_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
      created_by            VARCHAR(100),
      created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_production_position_rules_position_effective_unique
       ON factory_production_position_rules (position_id, effective_from)`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_rules_company_position_idx
       ON factory_production_position_rules (company_id, position_id)`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_rules_effective_idx
       ON factory_production_position_rules (position_id, effective_from, effective_to)`,

  `CREATE TABLE IF NOT EXISTS factory_production_position_memberships (
      id             SERIAL PRIMARY KEY,
      company_id     INTEGER NOT NULL,
      position_id    INTEGER NOT NULL REFERENCES factory_production_positions(id) ON DELETE CASCADE,
      worker_id      INTEGER NOT NULL REFERENCES factory_workers(id) ON DELETE RESTRICT,
      effective_from DATE NOT NULL,
      effective_to   DATE,
      created_by     VARCHAR(100),
      created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_memberships_position_worker_effective_idx
       ON factory_production_position_memberships (position_id, worker_id, effective_from)`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_memberships_company_position_idx
       ON factory_production_position_memberships (company_id, position_id)`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_memberships_worker_effective_idx
       ON factory_production_position_memberships (worker_id, effective_from, effective_to)`,
];
