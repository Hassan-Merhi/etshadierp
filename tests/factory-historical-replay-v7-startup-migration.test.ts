import { describe, expect, it } from "vitest";
import {
  FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL,
} from "../server/services/factory/rawStockLockedRate";
import {
  FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL,
} from "../server/services/factory/historicalReplayV7MigrationSql";

const singleAlterOptimizer = /^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+([\s\S]+?)\s*$/i;

describe("Historical Replay V7 production startup migration", () => {
  it("is appended to the exact migration constant executed by server/index.ts", () => {
    expect(FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL).toContain(
      FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL
    );
    expect(FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL).toContain(
      "current_raw_material_cost_per_kg_usd"
    );
    expect(FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL).toContain(
      "inventory_supplier_id"
    );
    expect(FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL).toContain("valuation_basis");
  });

  it("does not match the startup runner's single-ALTER rewrite", () => {
    expect(singleAlterOptimizer.test(FACTORY_SUPPLIER_LOCKED_RATE_ADD_COLUMN_SQL)).toBe(false);
  });

  it("contains idempotent company-isolated database-boundary guards", () => {
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).toContain(
      "factory_resolve_mix_source_inventory_supplier"
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).toContain(
      "INVENTORY_SUPPLIER_COMPANY_MISMATCH"
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).toContain(
      "CONTAINER_INVENTORY_SUPPLIER_CONFLICT"
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).toContain(
      "CREATE INDEX IF NOT EXISTS factory_mix_batch_sources_inventory_supplier_idx"
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).toContain(
      "CREATE OR REPLACE FUNCTION factory_default_new_adjustment_valuation_basis"
    );
  });

  it("never runs the business-data cost replay during startup", () => {
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).not.toMatch(
      /UPDATE\s+factory_suppliers\s+SET\s+current_raw_material_cost_per_kg_usd/i
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).not.toMatch(
      /UPDATE\s+factory_mix_batches\s+SET\s+(cost_per_kg|total_cost)/i
    );
    expect(FACTORY_HISTORICAL_REPLAY_V7_SCHEMA_SQL).not.toMatch(
      /UPDATE\s+factory_bales\s+SET\s+(cost_per_kg|total_cost)/i
    );
  });
});
