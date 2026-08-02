import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay source priority", () => {
  it("classifies sourceBatch before supplier before direct container", () => {
    // The three cases live together in the events module of the read-model
    // directory; this asserts their relative order, so it must read the one file
    // that contains all three rather than the directory.
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/read-model/events.ts"),
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
