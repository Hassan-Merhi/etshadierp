import { describe, expect, it } from "vitest";
import {
  AuthorizationDeniedError,
  assertAuthorized,
  decideAuthorization,
  type AuthorizationRequest,
} from "../server/services/security/authorizationPolicy";

function request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    actor: {
      userId: 1,
      role: "Manager",
      companyId: 10,
      permissions: ["inventory.read", "inventory.write"],
    },
    domain: "inventory",
    action: "stock.adjust",
    resource: { companyId: 10 },
    allowedRoles: ["Manager"],
    requiredPermissions: ["inventory.write"],
    ...overrides,
  };
}

describe("central authorization policy", () => {
  it("allows an explicitly authorized same-company request", () => {
    expect(decideAuthorization(request())).toEqual({ effect: "allow", code: "AUTHORIZED" });
  });

  it("denies unauthenticated requests", () => {
    expect(decideAuthorization(request({ actor: null }))).toEqual({
      effect: "deny",
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("denies cross-company access before privileged-role evaluation", () => {
    expect(
      decideAuthorization(
        request({
          actor: { userId: 1, role: "Admin", companyId: 10 },
          resource: { companyId: 11 },
        })
      )
    ).toEqual({ effect: "deny", code: "CROSS_COMPANY_ACCESS_DENIED" });
  });

  it("defaults to deny when no explicit policy is defined", () => {
    expect(
      decideAuthorization(request({ allowedRoles: [], requiredPermissions: [] }))
    ).toEqual({ effect: "deny", code: "POLICY_NOT_DEFINED" });
  });

  it("requires every declared permission", () => {
    expect(
      decideAuthorization(
        request({
          requiredPermissions: ["inventory.write", "inventory.approve"],
        })
      )
    ).toEqual({ effect: "deny", code: "PERMISSION_REQUIRED" });
  });

  it("allows privileged roles only after company isolation succeeds", () => {
    expect(
      decideAuthorization(
        request({
          actor: { userId: 1, role: "Developer", companyId: 10 },
          allowedRoles: ["Owner"],
          requiredPermissions: ["configuration.write"],
        })
      )
    ).toEqual({ effect: "allow", code: "AUTHORIZED" });
  });

  it("throws a non-leaking forbidden error", () => {
    expect(() =>
      assertAuthorized(request({ actor: { userId: 1, role: "POS", companyId: 10 } }))
    ).toThrowError(AuthorizationDeniedError);
    try {
      assertAuthorized(request({ actor: { userId: 1, role: "POS", companyId: 10 } }));
    } catch (error) {
      expect((error as Error).message).toBe("Forbidden");
      expect((error as AuthorizationDeniedError).code).toBe("ROLE_NOT_ALLOWED");
    }
  });
});
