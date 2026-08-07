/**
 * Startup schema - Phase 3 position-centric production planner snapshots.
 *
 * The legacy worker-based planner tables remain untouched for compatibility.
 * These rows snapshot the position rule + qualifying team for a plan date so
 * later rule/membership changes never rewrite an already-saved daily plan.
 */

export const productionPositionPlanner: string[] = [
  `CREATE TABLE IF NOT EXISTS factory_production_position_plan_entries (
      id                        SERIAL PRIMARY KEY,
      plan_id                   INTEGER NOT NULL REFERENCES factory_production_plans(id) ON DELETE CASCADE,
      company_id                INTEGER NOT NULL,
      position_id               INTEGER NOT NULL REFERENCES factory_production_positions(id) ON DELETE RESTRICT,
      position_name_snapshot    TEXT NOT NULL,
      target_bales              INTEGER NOT NULL DEFAULT 0,
      bonus_per_extra_bale      NUMERIC(20,4) NOT NULL DEFAULT 0,
      bonus_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
      member_snapshot           JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS factory_production_position_plan_entries_plan_position_unique
       ON factory_production_position_plan_entries (plan_id, position_id)`,
  `CREATE INDEX IF NOT EXISTS factory_production_position_plan_entries_company_position_idx
       ON factory_production_position_plan_entries (company_id, position_id)`,
];
