import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Opening-balance bale assignment safety", () => {
  const source = readFileSync(
    resolve(process.cwd(), "server/routes/factory/raw-stock/openingBalanceAssignmentRoutesV5.ts"),
    "utf8"
  );

  it("coordinates with replay and locks all operational rows", () => {
    expect(source).toContain("pg_advisory_xact_lock(9003");
    expect(source).toContain("pg_advisory_xact_lock(9004");
    expect(source).toContain("FOR UPDATE OF frs, fc");
    expect(source).toContain("ORDER BY id\n           FOR UPDATE");
  });

  it("never treats a native-currency direct cost as USD", () => {
    expect(source).toContain("rawStock.cost_per_kg_usd == null");
    expect(source).toContain("Resolve its FX/cost before assigning bales");
    expect(source).not.toContain("cost_per_kg_usd ?? rawStock.cost_per_kg");
  });

  it("writes supplier-linked consumption without changing the supplier rate", () => {
    expect(source).toContain("SUPPLIER_LOCKED_RATE");
    expect(source).toContain("supplierRateChanged: false");
    expect(source).not.toContain("getLockedSupplierRate");
    expect(source).not.toContain("applyOffloadMovingAverage");
  });
});
