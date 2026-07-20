import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay source priority", () => {
  it("classifies sourceBatch before supplier before direct container", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/readModel.ts"),
      "utf8"
    );
    const batch = source.indexOf('pricingBasis = "BATCH"');
    const supplier = source.indexOf('pricingBasis = "SUPPLIER_LOCKED_RATE"');
    const container = source.indexOf('pricingBasis = "CONTAINER_DIRECT"');
    expect(batch).toBeGreaterThan(-1);
    expect(batch).toBeLessThan(supplier);
    expect(supplier).toBeLessThan(container);
  });
});
