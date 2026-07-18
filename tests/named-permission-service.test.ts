import { describe, expect, it, vi } from "vitest";
import {
  hydrateSessionNamedPermissions,
  normalizePermissionList,
  replaceNamedPermissions,
} from "../server/services/security/namedPermissionService";

describe("named permission service", () => {
  it("normalizes, deduplicates, and sorts known permissions", () => {
    expect(
      normalizePermissionList([
        "security.anomalies.read",
        " administration.repair ",
        "security.anomalies.read",
      ])
    ).toEqual(["administration.repair", "security.anomalies.read"]);
  });

  it("rejects unknown permission names", () => {
    expect(() => normalizePermissionList(["system.superuser"])).toThrow("Invalid permissions");
  });

  it("keeps an explicitly hydrated same-company session without a database read", async () => {
    const db = { select: vi.fn() };
    const session: any = {
      userId: "user-1",
      currentCompanyId: 7,
      securityPermissions: ["administration.repair"],
    };

    await expect(hydrateSessionNamedPermissions(db, session)).resolves.toEqual(["administration.repair"]);
    expect(session.securityPermissionsCompanyId).toBe(7);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("reloads permissions after the active company changes", async () => {
    const where = vi.fn(async () => [{ permission: "security.anomalies.read" }]);
    const from = vi.fn(() => ({ where }));
    const db = { select: vi.fn(() => ({ from })) };
    const session: any = {
      userId: "user-2",
      currentCompanyId: 8,
      securityPermissionsCompanyId: 7,
      securityPermissions: ["administration.repair"],
    };

    await expect(hydrateSessionNamedPermissions(db, session)).resolves.toEqual(["security.anomalies.read"]);
    expect(session.securityPermissionsCompanyId).toBe(8);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("replaces company-scoped grants after confirming membership", async () => {
    const limit = vi.fn(async () => [{ userId: "user-3" }]);
    const membershipWhere = vi.fn(() => ({ limit }));
    const membershipFrom = vi.fn(() => ({ where: membershipWhere }));
    const deleteWhere = vi.fn(async () => undefined);
    const values = vi.fn(async () => undefined);
    const tx = {
      select: vi.fn(() => ({ from: membershipFrom })),
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ values })),
    };

    const result = await replaceNamedPermissions(tx, {
      userId: "user-3",
      companyId: 9,
      permissions: ["security.permissions.manage", "administration.repair"],
      grantedBy: "admin-1",
    });

    expect(result).toEqual(["administration.repair", "security.permissions.manage"]);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user-3",
          companyId: 9,
          permission: "administration.repair",
          grantedBy: "admin-1",
        }),
      ])
    );
  });
});
