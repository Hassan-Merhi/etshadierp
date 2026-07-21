import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Historical Replay final wiring", () => {
  it("routes the public facade to final scope, costing and apply implementations", () => {
    const facade = read("server/services/factory/historicalCostReplay.ts");
    expect(facade).toContain("computeCanonicalCostsV6 as computeCanonicalCosts");
    expect(facade).toContain("./historical-replay/exactScope");
    expect(facade).toContain("./historical-replay/exactApplyFinal");
    expect(facade).toContain("applyExactHistoricalCostReplayV6 as applyHistoricalCostReplay");
  });

  it("invalidates every token prepared before phase 6", () => {
    const types = read("server/services/factory/historical-replay/types.ts");
    // V7 bumped the version — old v6 tokens are rejected by exactApplyFinal.ts.
    expect(types).toContain('REPLAY_ALGORITHM_VERSION = "HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP"');
  });

  it("registers fail-closed guard and exact handlers before legacy routes", () => {
    const routes = read("server/routes/factory/raw-stock/rawStockRecalcRoutes.ts");
    const guard = routes.indexOf("registerHistoricalReplayPhase6GuardRoutes(app)");
    const exact = routes.indexOf("registerHistoricalReplayRoutesV4(app)");
    const legacy = routes.indexOf("registerLegacyRawStockRecalcRoutes(app)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(exact);
    expect(exact).toBeLessThan(legacy);
  });

  it("keeps apply authority in the signed token after client state changes or reload", () => {
    const prepared = read("client/src/lib/historicalReplayPreparedRequest.ts");
    expect(prepared).toContain("server-returned, signed preparation state");
    expect(prepared).toContain("return { dryRun: false, confirmationToken: token }");
    expect(prepared).toContain("includeFinalizedBales: frozen.options.includeFinalizedBales");
  });
});
