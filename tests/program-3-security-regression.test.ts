import { describe, expect, it } from "vitest";
import { decideAuthorization } from "../server/services/security/authorizationPolicy";
import { authorizePrivilegedOperation } from "../server/services/security/privilegedOperationPolicy";
import {
  buildSecurityAuditRecord,
  detectSecurityAnomalies,
} from "../server/services/security/securityAuditPolicy";
import {
  UnsafeInputError,
  validateUnsafeOperationInput,
} from "../server/services/security/unsafeOperationValidation";

describe("Program 3 security regression suite", () => {
  it("keeps company isolation ahead of privileged-role authorization", () => {
    expect(
      decideAuthorization({
        actor: { userId: 1, role: "Admin", companyId: 10 },
        domain: "accounting",
        action: "voucher.read",
        resource: { companyId: 11 },
        allowedRoles: ["Admin"],
      })
    ).toEqual({ effect: "deny", code: "CROSS_COMPANY_ACCESS_DENIED" });
  });

  it("requires exact permission, confirmation, provenance, and recent password confirmation for privileged work", () => {
    const now = 1_000_000;
    expect(
      authorizePrivilegedOperation({
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
        reason: "Repair confirmed reconciliation drift",
        confirmationToken: "confirm-1",
        expectedConfirmationToken: "confirm-1",
        idempotencyKey: "repair:10:balance:v1",
        sourceType: "reconciliation-report",
        sourceId: "report-1",
        passwordConfirmedAt: now - 1_000,
        now,
      }).authorized
    ).toBe(true);
  });

  it("rejects unknown fields and unsafe numeric input before mutation logic", () => {
    expect(() =>
      validateUnsafeOperationInput({
        operation: "stock.adjust",
        payload: { stockItemId: Number.POSITIVE_INFINITY, hiddenOverride: true },
        schema: {
          fields: {
            stockItemId: { kind: "positive-integer", required: true },
          },
        },
      })
    ).toThrowError(UnsafeInputError);
  });

  it("redacts secrets and classifies repeated cross-company denials", () => {
    const events = [1, 2, 3].map((offset) =>
      buildSecurityAuditRecord({
        kind: "company-isolation",
        action: "voucher.read",
        outcome: "denied",
        companyId: 10,
        actorUserId: 1,
        occurredAt: 10_000 - offset,
        metadata: { authorization: "Bearer secret", safeContext: "voucher" },
      })
    );

    expect(events[0].metadata.authorization).toBe("[REDACTED]");
    expect(
      detectSecurityAnomalies(events, {
        now: 10_000,
        windowMs: 1_000,
        denialThreshold: 3,
      }).map((item) => item.code)
    ).toEqual(["REPEATED_DENIALS", "CROSS_COMPANY_ATTEMPT"]);
  });
});
