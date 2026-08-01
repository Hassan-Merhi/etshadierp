import { describe, expect, it } from "vitest";
import { canAccessGlobalMaintenanceRoute } from "../server/middleware/globalMaintenanceScope";
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

  it("classifies every account migration route", () => {
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

describe("global maintenance role scope", () => {
  it("allows Admin and Developer roles to use account migration", () => {
    const match = { operation: "account-migration" } as const;

    expect(canAccessGlobalMaintenanceRoute(match, "Admin")).toBe(true);
    expect(canAccessGlobalMaintenanceRoute(match, "Developer")).toBe(true);
  });

  it("keeps all other global maintenance operations Developer-only", () => {
    const match = { operation: "schema-fix" } as const;

    expect(canAccessGlobalMaintenanceRoute(match, "Developer")).toBe(true);
    expect(canAccessGlobalMaintenanceRoute(match, "Admin")).toBe(false);
    expect(canAccessGlobalMaintenanceRoute(match, "Normal User")).toBe(false);
    expect(canAccessGlobalMaintenanceRoute(match, undefined)).toBe(false);
  });
});
