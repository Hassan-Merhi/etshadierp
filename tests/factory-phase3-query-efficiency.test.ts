import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 3 factory database query efficiency", () => {
  it("finalizes a loading with one set-based bale update inside the transaction", () => {
    const loading = source("server/routes/factory/customer-orders/finalize-loading/loading.ts");

    expect(loading).toContain("db.transaction");
    expect(loading).toContain("inArray(factoryBales.id, baleIds)");
    expect(loading).toContain("eq(factoryBales.companyId, companyId)");
    expect(loading).toContain('status: "SOLD"');
    expect(loading).toContain("writeDaybookEntry(tx");
    expect(loading).not.toMatch(/for\s*\(const\s+b\s+of\s+bales\)[\s\S]{0,500}update\(factoryBales\)/);
  });

  it("does not run bilingual snapshot work for loading-note metadata edits", () => {
    const routes = source("server/routes/factory/factoryBilingualSnapshotRoutes.ts");

    expect(routes).toContain("isSnapshotNeutralWrite");
    expect(routes).toContain("loading-note");
    expect(routes).toContain("if (isSnapshotNeutralWrite(req)) return false");
  });

  it("uses entity-scoped snapshot backfills for ordinary writes", () => {
    const routes = source("server/routes/factory/factoryBilingualSnapshotRoutes.ts");
    const service = source("server/services/factoryBilingualSnapshotService.ts");

    expect(routes).toContain("scopeFromRequest");
    expect(routes).toContain("applyFactoryBilingualSnapshotBackfillForScope");
    expect(routes).toContain("orderId");
    expect(service).toContain("FactoryBilingualSnapshotScope");
    expect(service).toContain("targetScopeGuard");
    expect(service).toContain("t.order_id=${orderId}");
  });

  it("loads snapshot schema capabilities once instead of probing each dependency", () => {
    const service = source("server/services/factoryBilingualSnapshotService.ts");

    expect(service).toContain("snapshotSchemaAvailabilityPromise");
    expect(service).toContain("loadSnapshotSchemaAvailability");
    expect(service).toContain("information_schema.columns");
    expect(service).not.toContain("SELECT to_regclass");
  });

  it("keeps the explicit admin backfill as the full-company repair path", () => {
    const routes = source("server/routes/factory/factoryBilingualSnapshotRoutes.ts");

    expect(routes).toContain('"/api/factory/bilingual-snapshots/backfill"');
    expect(routes).toContain("APPLY_ARABIC_SNAPSHOT_BACKFILL");
    expect(routes).toContain("applyFactoryBilingualSnapshotBackfill(");
  });
});
