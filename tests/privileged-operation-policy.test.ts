import { describe, expect, it } from "vitest";
import {
  PrivilegedOperationError,
  authorizePrivilegedOperation,
  type PrivilegedOperationRequest,
} from "../server/services/security/privilegedOperationPolicy";
import { AuthorizationDeniedError } from "../server/services/security/authorizationPolicy";

function request(
  overrides: Partial<PrivilegedOperationRequest> = {}
): PrivilegedOperationRequest {
  const now = 1_000_000;
  return {
    actor: {
      userId: 1,
      role: "Admin",
      companyId: 10,
      permissions: ["administration.repair"],
    },
    companyId: 10,
    domain: "administration",
    action: "balances.repair",
    kind: "repair",
    requiredPermission: "administration.repair",
    reason: "Repair verified projection drift",
    confirmationToken: "confirm-1",
    expectedConfirmationToken: "confirm-1",
    idempotencyKey: "repair:10:target-1:v1",
    sourceType: "reconciliation-report",
    sourceId: "report-1",
    passwordConfirmedAt: now - 1_000,
    now,
    ...overrides,
  };
}

describe("privileged operation policy", () => {
  it("allows a fully authorized, confirmed, same-company operation", () => {
    expect(authorizePrivilegedOperation(request())).toEqual({
      authorized: true,
      normalizedReason: "Repair verified projection drift",
      idempotencyKey: "repair:10:target-1:v1",
      sourceType: "reconciliation-report",
      sourceId: "report-1",
    });
  });

  it("denies cross-company operations even for Admin", () => {
    expect(() =>
      authorizePrivilegedOperation(request({ companyId: 11 }))
    ).toThrowError(AuthorizationDeniedError);
  });

  it("requires the exact privileged permission even for Admin", () => {
    try {
      authorizePrivilegedOperation(
        request({
          actor: { userId: 1, role: "Admin", companyId: 10, permissions: [] },
        })
      );
      throw new Error("expected privileged operation to be denied");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationDeniedError);
      expect((error as AuthorizationDeniedError).code).toBe("PERMISSION_REQUIRED");
    }
  });

  it("requires an explicit reason", () => {
    expect(() => authorizePrivilegedOperation(request({ reason: " " }))).toThrowError(
      PrivilegedOperationError
    );
  });

  it("requires deterministic idempotency and source identity", () => {
    expect(() =>
      authorizePrivilegedOperation(request({ idempotencyKey: "" }))
    ).toThrowError(/Forbidden/);
    expect(() =>
      authorizePrivilegedOperation(request({ sourceId: "" }))
    ).toThrowError(/Forbidden/);
  });

  it("requires an exact confirmation token when configured", () => {
    expect(() =>
      authorizePrivilegedOperation(request({ confirmationToken: "wrong" }))
    ).toThrowError(/Forbidden/);
  });

  it("requires recent password confirmation", () => {
    expect(() =>
      authorizePrivilegedOperation(
        request({ passwordConfirmedAt: 100, now: 1_000_000 })
      )
    ).toThrowError(/Forbidden/);
  });

  it("rejects future password-confirmation timestamps", () => {
    expect(() =>
      authorizePrivilegedOperation(
        request({ passwordConfirmedAt: 1_000_001, now: 1_000_000 })
      )
    ).toThrowError(/Forbidden/);
  });
});
