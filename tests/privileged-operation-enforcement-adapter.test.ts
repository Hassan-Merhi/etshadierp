import { describe, expect, it, vi } from "vitest";
import { requirePrivilegedOperation } from "../server/services/security/privilegedOperationEnforcementAdapter";

function harness(body: Record<string, unknown>, session: Record<string, unknown> = {}) {
  const req: any = {
    body,
    ip: "127.0.0.1",
    method: "POST",
    path: "/api/admin/inventory-rebuild",
    get: vi.fn(() => "vitest"),
    session: {
      userId: "user-1",
      currentRole: "Admin",
      currentCompanyId: 10,
      passwordConfirmedAt: 999_000,
      securityPermissions: ["administration.repair"],
      securityPermissionsCompanyId: 10,
      ...session,
    },
  };
  const status = vi.fn();
  const json = vi.fn();
  const res: any = { status: status.mockReturnValue({ json }) };
  const next = vi.fn();
  return { req, res, next, status, json };
}

const middleware = requirePrivilegedOperation({
  domain: "inventory",
  action: "inventory.rebuild",
  kind: "recalculate",
  requiredPermission: "administration.repair",
  sourceType: "inventory-rebuild-request",
  expectedConfirmationToken: (companyId) => `REBUILD-INVENTORY:${companyId}`,
  allowDryRun: true,
});

describe("privileged operation enforcement adapter", () => {
  it("allows the default dry-run without destructive confirmation", async () => {
    const h = harness({});
    await middleware(h.req, h.res, h.next);
    expect(h.next).toHaveBeenCalledOnce();
    expect(h.status).not.toHaveBeenCalled();
  });

  it("denies an apply without the required safety metadata", async () => {
    const h = harness({ dryRun: false });
    await middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.json).toHaveBeenCalledWith({ message: "Forbidden" });
    expect(h.next).not.toHaveBeenCalled();
  });

  it("allows a fully confirmed same-company apply", async () => {
    const now = Date.now();
    const h = harness(
      {
        dryRun: false,
        reason: "Rebuild inventory after reviewed transfer flag drift",
        confirmationToken: "REBUILD-INVENTORY:10",
        idempotencyKey: "inventory-rebuild:10:2026-07-18:v1",
        sourceId: "inventory-diagnostic-2026-07-18",
      },
      { passwordConfirmedAt: now - 1_000 },
    );
    await middleware(h.req, h.res, h.next);
    expect(h.next).toHaveBeenCalledOnce();
    expect(h.status).not.toHaveBeenCalled();
  });

  it("denies a wrong confirmation token without leaking the reason", async () => {
    const h = harness({
      dryRun: false,
      reason: "Reviewed repair",
      confirmationToken: "wrong",
      idempotencyKey: "inventory-rebuild:10:v1",
      sourceId: "diagnostic-1",
    });
    await middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.json).toHaveBeenCalledWith({ message: "Forbidden" });
  });

  it("denies explicit permission sets that omit the route permission", async () => {
    const h = harness(
      {
        dryRun: false,
        reason: "Reviewed repair",
        confirmationToken: "REBUILD-INVENTORY:10",
        idempotencyKey: "inventory-rebuild:10:v1",
        sourceId: "diagnostic-1",
      },
      { securityPermissions: ["security.anomalies.read"], securityPermissionsCompanyId: 10 },
    );
    await middleware(h.req, h.res, h.next);
    expect(h.status).toHaveBeenCalledWith(403);
    expect(h.next).not.toHaveBeenCalled();
  });
});
