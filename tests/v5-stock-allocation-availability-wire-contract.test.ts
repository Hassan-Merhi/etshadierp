import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("V5 stock allocation availability wire contract", () => {
  it("registers the compact response middleware before the canonical allocation route", () => {
    const source = read("server/routes/factory/stock-allocation-v5/index.ts");
    const compactIndex = source.indexOf("registerV5AllocationAvailabilityView(app)");
    const canonicalIndex = source.indexOf("registerV5StockAllocationRoutes(app)");

    expect(compactIndex).toBeGreaterThan(-1);
    expect(canonicalIndex).toBeGreaterThan(-1);
    expect(compactIndex).toBeLessThan(canonicalIndex);
  });

  it("keeps Customer Loading query key while requesting the compact availability view", () => {
    const source = read("client/src/pages/factory/customerLoadingAvailability.ts");
    expect(source).toContain('const STOCK_ALLOCATION_ENDPOINT = "/api/factory/v5/stock-allocation"');
    expect(source).toContain('`${STOCK_ALLOCATION_ENDPOINT}?view=availability`');
    expect(source).toContain("pathname !== CUSTOMER_LOADING_ROUTE");
  });
});
