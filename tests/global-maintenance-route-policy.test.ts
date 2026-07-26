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

  it("classifies every account migration route as Developer maintenance", () => {
    expect(
      classifyGlobalMaintenanceRoute(
        "GET",
        "/api/admin/account-migration/companies"
      )
    ).toEqual({ operation: "account-migration" });
    expect(
      classifyGlobalMaintenanceRoute(
        "GET",
        "/api/admin/account-migration/accounts/4"
      )
    ).toEqual({ operation: "account-migration" });
    expect(
      classifyGlobalMaintenanceRoute(
        "POST",
        "/api/admin/account-migration/execute"
      )
    ).toEqual({ operation: "account-migration" });
  });

  it("classifies global system and schema operations", () => {
    expect(
      classifyGlobalMaintenanceRoute("GET", "/api/system/parent-company")
    ).toEqual({ operation: "parent-company-setting" });
    expect(
      classifyGlobalMaintenanceRoute("POST", "/api/system/parent-company")
    ).toEqual({ operation: "parent-company-setting" });
    expect(
      classifyGlobalMaintenanceRoute("GET", "/api/admin/deployment-diagnostics")
    ).toEqual({ operation: "deployment-diagnostics" });
    expect(
      classifyGlobalMaintenanceRoute("POST", "/api/admin/apply-missing-migrations")
    ).toEqual({ operation: "runtime-schema-migration" });
    expect(
      classifyGlobalMaintenanceRoute("GET", "/api/admin/schema-check")
    ).toEqual({ operation: "schema-diagnostic" });
    expect(
      classifyGlobalMaintenanceRoute("POST", "/api/admin/schema-fix")
    ).toEqual({ operation: "schema-fix" });
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
    expect(
      classifyGlobalMaintenanceRoute(
        "DELETE",
        "/api/admin/account-migration/execute"
      )
    ).toBeNull();
    expect(
      classifyGlobalMaintenanceRoute("DELETE", "/api/system/parent-company")
    ).toBeNull();
  });
});
