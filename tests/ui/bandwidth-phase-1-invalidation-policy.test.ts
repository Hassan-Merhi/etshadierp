// Regression contract for the production bandwidth hotspots observed on August 5, 2026.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getBandwidthInvalidationScope,
  shouldClearBandwidthEntry,
} from "../../client/src/lib/bandwidthInvalidationPolicy";

describe("Bandwidth Phase 1 invalidation policy", () => {
  it("preserves reference snapshots for ordinary live workflow writes", () => {
    expect(getBandwidthInvalidationScope("/api/factory/customer-orders/88/bales")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/vouchers")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/stock-transfers/44/finalize")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/factory/customer-proforma-lines/42")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/factory/customer-proformas/42")).toBe("live");
    expect(shouldClearBandwidthEntry("live", "live")).toBe(true);
    expect(shouldClearBandwidthEntry("reference", "live")).toBe(false);
  });

  it("clears every snapshot when the selected scope or reference data changes", () => {
    const fullInvalidationPaths = [
      "/api/auth/set-company",
      "/api/auth/logout",
      "/api/locations/12",
      "/api/ledger-accounts/7",
      "/api/factory/settings",
      "/api/factory/workers/9",
      "/api/factory/customers/31",
      "/api/stock-items/55",
    ];

    for (const pathname of fullInvalidationPaths) {
      expect(getBandwidthInvalidationScope(pathname), pathname).toBe("all");
    }
    expect(shouldClearBandwidthEntry("live", "all")).toBe(true);
    expect(shouldClearBandwidthEntry("reference", "all")).toBe(true);
  });

  it("does not broaden similar business paths into full invalidations", () => {
    expect(getBandwidthInvalidationScope("/api/factory/customer-orders/12/link-proforma")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/accounts/vouchers/12")).toBe("live");
    expect(getBandwidthInvalidationScope("/api/factory/daily-bale-scans")).toBe("live");
  });

  it("contains the canonical production hotspots identified in the August bandwidth snapshots", () => {
    const source = readFileSync(resolve("client/src/lib/bandwidthPhase1HotspotGuard.ts"), "utf8");
    const requiredRoutes = [
      "shipping-container-rows",
      "invoice-container-tracking",
      "customer-orders\\/\\d+\\/verification-summary",
      "audit-log",
      "vouchers\\/\\d+",
      "locations",
      "factory\\/bale-products",
    ];

    for (const route of requiredRoutes) {
      expect(source, route).toContain(route);
    }
    expect(source).not.toContain("factory\\/api\\/factory\\/bale-products");
    expect(source).toContain("BANDWIDTH_INVALIDATION_CHANNEL");
    expect(source).toContain('scope: "reference"');
  });

  it("keeps reference generations reusable across ordinary live writes", () => {
    const requestGuard = readFileSync(resolve("client/src/lib/requestStormGuard.ts"), "utf8");
    const hotspotGuard = readFileSync(resolve("client/src/lib/bandwidthPhase1HotspotGuard.ts"), "utf8");

    for (const source of [requestGuard, hotspotGuard]) {
      expect(source).toContain("generationForScope");
      expect(source).toContain("bumpWriteGeneration");
      expect(source).toContain("referenceWriteGeneration");
      expect(source).toContain("getBandwidthInvalidationScope(url.pathname)");
      expect(source).toContain("BANDWIDTH_INVALIDATION_CHANNEL");
    }

    expect(requestGuard).toMatch(/customer-proformas\$\/,[\s\S]*scope: "live"/);
    expect(requestGuard).toMatch(/factory\\\/bale-products\$\/,[\s\S]*scope: "reference"/);
  });
});
