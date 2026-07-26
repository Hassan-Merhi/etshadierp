import { describe, expect, it } from "vitest";
import { classifyGlobalMaintenanceRoute } from "../server/services/security/globalMaintenanceRoutePolicy";

describe("global maintenance route policy", () => {
  it("classifies global and unattributable cleanup operations", () => {
    expect(
      classifyGlobalMaintenanceRoute(
        "POST",
        "/api/admin/recalculate-equity-adjustment-all"
      )
    ).toEqual({ operation: "recalculate-equity-all" });
    expect(
      classifyGlobalMaintenanceRoute("POST", "/api/admin/fix-orphaned-pos-data")
    ).toEqual({ operation: "fix-unattributable-pos-data" });
    expect(
      classifyGlobalMaintenanceRoute("POST", "/api/cleanup/orphaned-charges")
    ).toEqual({ operation: "cleanup-orphaned-charges" });
  });

  it("does not classify current-company repair operations", () => {
    expect(
      classifyGlobalMaintenanceRoute(
        "POST",
        "/api/admin/recalculate-equity-adjustment"
      )
    ).toBeNull();
    expect(classifyGlobalMaintenanceRoute("GET", "/api/admin/orphaned-pos-sales")).toBeNull();
  });

  it("requires the exact method", () => {
    expect(
      classifyGlobalMaintenanceRoute(
        "GET",
        "/api/admin/recalculate-equity-adjustment-all"
      )
    ).toBeNull();
  });
});
