import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS stock transfer revision access", () => {
  it("bypasses the admin-only compatibility route before requireNonPOS runs", () => {
    const compatibilityRoute = readFileSync(
      "server/routes/vouchers/adminPostUpdateStockTransferRevisionRoute.ts",
      "utf8"
    );

    const routeStart = compatibilityRoute.indexOf('"/api/stock-transfers/:transferId/revisions"');
    expect(routeStart).toBeGreaterThanOrEqual(0);

    const routeRegistration = compatibilityRoute.slice(routeStart);
    const bypassIndex = routeRegistration.indexOf("bypassAdminCompatibilityForPendingRevision,");
    const requireNonPOSIndex = routeRegistration.indexOf("requireNonPOS,");

    expect(bypassIndex).toBeGreaterThanOrEqual(0);
    expect(requireNonPOSIndex).toBeGreaterThan(bypassIndex);
    expect(compatibilityRoute).toContain('if (req.body?.optional === true) return next("route");');
  });

  it("keeps POS pending revisions on the canonical location-scoped lifecycle", () => {
    const canonicalRoute = readFileSync("server/routes/vouchers/immutableStockTransferRevisionRoutes.ts", "utf8");

    expect(canonicalRoute).toContain('if (role === "POS" && parsed.optional !== true)');
    expect(canonicalRoute).toContain("sourceLocationIdLimit: assignedLocationId");
    expect(canonicalRoute).not.toContain(
      'app.post("/api/stock-transfers/:transferId/revisions", requireAuth, requireNonPOS'
    );
  });
});
