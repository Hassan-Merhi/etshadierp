import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Historical Replay V7 final safety wiring", () => {
  it("does not hardcode financial safety gates to zero", () => {
    const securePreview = read(
      "server/services/factory/historical-replay/securePreview.ts"
    );
    expect(securePreview).toContain("loadV7SafetyState");
    expect(securePreview).toContain("unresolvedInventorySupplierSources");
    expect(securePreview).toContain("unclassifiedValuedAdjustments");
    expect(securePreview).toContain("BATCH_DEPENDENCY_CYCLE");
    expect(securePreview).toContain("allSafetyGatesPassed");
    expect(securePreview).not.toContain(
      "unresolvedInventorySupplierSources: supplierOutputRows.reduce"
    );
  });

  it("expands selected suppliers before exact scope and rejects blocked batches", () => {
    const exactScope = read(
      "server/services/factory/historical-replay/exactScopeV7Final.ts"
    );
    expect(exactScope).toContain("expandConnectedSupplierClosure");
    expect(exactScope).toContain("connectedScopeIsComplete");
    expect(exactScope).toContain("scope.blockedBatches.length > 0");
    expect(exactScope).toContain("expectedSupplierIds");
  });

  it("forbids force-apply and finalized-bale writes", () => {
    const guard = read(
      "server/routes/factory/raw-stock/historicalReplayPhase6GuardRoutes.ts"
    );
    expect(guard).toContain("HISTORICAL_REPLAY_FORCE_APPLY_FORBIDDEN");
    expect(guard).toContain("HISTORICAL_REPLAY_FINALIZED_BALES_FORBIDDEN");
    expect(guard).toContain("includeFinalizedBales = false");
  });

  it("provides explicit adjustment classification with an audit entry", () => {
    const guard = read(
      "server/routes/factory/raw-stock/historicalReplayPhase6GuardRoutes.ts"
    );
    expect(guard).toContain("adjustments/:id/valuation-basis");
    expect(guard).toContain("historical_replay_adjustment_classified");
    expect(guard).toContain("QUANTITY_ONLY");
    expect(guard).toContain("VALUED_TRANSFER");
    expect(guard).toContain("OPENING_BALANCE");
  });

  it("keeps the migration cost-only and reversible replay separate", () => {
    const migration = read(
      "migrations/20260721_001_factory_mix_batch_sources_inventory_supplier.sql"
    );
    expect(migration).toContain("Schema only");
    expect(migration).not.toMatch(/UPDATE\s+factory_mix_batches\s+SET\s+cost/i);
    expect(migration).not.toMatch(/UPDATE\s+factory_suppliers\s+SET\s+current_raw_material/i);
    expect(migration).toContain("factory_mix_source_inventory_supplier_trg");
  });
});
