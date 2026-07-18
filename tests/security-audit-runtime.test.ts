import { describe, expect, it } from "vitest";
import { detectSecurityAnomalies } from "../server/services/security/securityAuditPolicy";
import { toAuditLogInsert } from "../server/services/security/securityAuditRuntime";

describe("security audit runtime", () => {
  it("maps a privileged denial to the existing append-only audit table", () => {
    const { record, insert } = toAuditLogInsert(
      {
        kind: "privileged-operation",
        action: "inventory.rebuild",
        outcome: "denied",
        companyId: 7,
        actorUserId: "user-3",
        targetType: "inventory-rebuild-request",
        targetId: "42",
        reasonCode: "CONFIRMATION_REQUIRED",
        occurredAt: 1_700_000_000_000,
        metadata: {
          role: "Admin",
          confirmationToken: "must-not-be-stored",
          password: "must-not-be-stored",
        },
      },
      "admin"
    );

    expect(insert.userId).toBe("user-3");
    expect(insert.username).toBe("admin");
    expect(insert.companyId).toBe(7);
    expect(insert.action).toBe("SECURITY:privileged-operation:inventory.rebuild:denied");
    expect(insert.tableName).toBe("security_events");
    expect(insert.recordId).toBe(42);
    expect(insert.recordIdentifier).toBe(record.eventKey);
    expect(record.severity).toBe("critical");
    expect(record.metadata.confirmationToken).toBe("[REDACTED]");
    expect(record.metadata.password).toBe("[REDACTED]");
  });

  it("does not coerce non-numeric target identifiers into audit record ids", () => {
    const { insert } = toAuditLogInsert(
      {
        kind: "protected-asset",
        action: "attachment.download",
        outcome: "denied",
        companyId: 9,
        actorUserId: "user-4",
        targetType: "storage-key",
        targetId: "container-docs/file.pdf",
        occurredAt: 1_700_000_000_100,
      },
      "operator"
    );
    expect(insert.recordId).toBeNull();
  });

  it("surfaces privileged failures and repeated denials in the active window", () => {
    const now = 1_700_000_100_000;
    const events = Array.from({ length: 5 }, (_, index) =>
      toAuditLogInsert(
        {
          kind: "privileged-operation",
          action: "inventory.rebuild",
          outcome: "denied",
          companyId: 3,
          actorUserId: "user-5",
          occurredAt: now - index * 1_000,
        },
        "admin"
      ).record
    );

    const anomalies = detectSecurityAnomalies(events, { now, denialThreshold: 5 });
    expect(anomalies.map((item) => item.code)).toEqual(
      expect.arrayContaining(["REPEATED_DENIALS", "PRIVILEGED_OPERATION_FAILURE"])
    );
  });
});
