import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Operational Phase 4 bandwidth safety", () => {
  it("registers negotiated compaction after permission enforcement and before Factory handlers", () => {
    const routes = source("server/routes/factoryRoutes.ts");
    const permissionIndex = routes.indexOf("app.use(enforceOperationalPermissionScope)");
    const compactIndex = routes.indexOf("app.use(operationalBandwidthCompactResponse)");
    const handlerIndex = routes.indexOf("registerFactoryStockRoutes(app)");

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(compactIndex).toBeGreaterThan(permissionIndex);
    expect(handlerIndex).toBeGreaterThan(compactIndex);
  });

  it("targets the production heavy-read endpoints from the supplied logs", () => {
    const middleware = source("server/middleware/operationalBandwidthCompactResponse.ts");
    for (const endpoint of [
      "/api/factory/customer-proformas",
      "/api/factory/daily-bale-scans",
      "/api/factory/waste-dispatch/bales",
      "/api/factory/waste-dispatch/history",
      "/api/factory/production-value-report",
      "location-inventory",
      "verification-summary",
    ]) {
      expect(middleware).toContain(endpoint);
    }
  });

  it("keeps page-specific reductions opt-in instead of changing default API contracts", () => {
    const server = source("server/middleware/operationalBandwidthCompactResponse.ts");
    const client = source("client/src/lib/operationalPhase4BandwidthFetch.ts");

    expect(server).toContain('profile === "location-inventory-summary-v1"');
    expect(server).toContain('withoutKeys(row, ["referenceNumbers"])');
    expect(server).toContain('profile === "loading-order-state-v1"');
    expect(server).toContain('withoutKeys(payload, ["lines", "charges"])');
    expect(server).toContain('profile === "waste-dispatch-page-v1"');

    expect(client).toContain('pagePath === "/factory/location-inventory"');
    expect(client).toContain('pagePath === "/factory/sales/loading/new"');
    expect(client).toContain('pagePath === "/factory/waste-dispatch"');
  });

  it("isolates response profiles in the shared GET cache by URL as well as header", () => {
    const client = source("client/src/lib/operationalPhase4BandwidthFetch.ts");
    expect(client).toContain('const PROFILE_QUERY = "_erpProfile"');
    expect(client).toContain("profiled.searchParams.set(PROFILE_QUERY, profile)");
    expect(client).toContain("inputWithProfile(input, url, profile)");
  });

  it("normalizes through standard JSON semantics before changing the wire representation", () => {
    const middleware = source("server/middleware/operationalBandwidthCompactResponse.ts");
    expect(middleware).toContain("function normalizeLikeResJson");
    expect(middleware).toContain("JSON.stringify(payload)");
    expect(middleware).toContain("const normalized = normalizeLikeResJson(payload)");
  });

  it("installs the transparent decoder before the older bandwidth fetch compatibility layer", () => {
    const main = source("client/src/main.tsx");
    const operational = main.indexOf('import "./lib/operationalPhase4BandwidthFetch"');
    const legacy = main.indexOf('import "./lib/phase4BandwidthFetch"');
    expect(operational).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(operational);
  });

  it("keeps built-in HMD banner artwork immutable in the browser cache", () => {
    const vite = source("server/vite.ts");
    expect(vite).toContain("LABEL_BANNER_PATH");
    expect(vite).toContain('Cache-Control", "public, max-age=31536000, immutable"');
  });
});
