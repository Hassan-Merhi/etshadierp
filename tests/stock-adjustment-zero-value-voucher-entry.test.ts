import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(process.cwd(), "server/storage/stock-ops/transfers-create.ts"), "utf8");

describe("stock adjustment zero-value accounting guard", () => {
  it("documents why Decimal.isPositive cannot guard voucher-entry inserts", () => {
    expect(new Decimal(0).isPositive()).toBe(true);
    expect(new Decimal(0).gt(0)).toBe(false);
  });

  it("uses strict greater-than-zero checks before inserting adjustment voucher entries", () => {
    expect(source).toContain("totalProductionValue.gt(0) && productionAccountId");
    expect(source).toContain("totalConsumptionValue.gt(0) && consumptionAccountId");
    expect(source).not.toContain("totalProductionValue.isPositive() && productionAccountId");
    expect(source).not.toContain("totalConsumptionValue.isPositive() && consumptionAccountId");
  });
});
