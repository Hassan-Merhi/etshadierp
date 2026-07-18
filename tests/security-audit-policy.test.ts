import { describe, expect, it } from "vitest";
import {
  buildSecurityAuditRecord,
  detectSecurityAnomalies,
} from "../server/services/security/securityAuditPolicy";

describe("security audit policy", () => {
  it("builds a normalized append-only record", () => {
    const record = buildSecurityAuditRecord({
      kind: "authorization",
      action: "voucher.delete",
      outcome: "denied",
      companyId: 10,
      actorUserId: 5,
      reasonCode: "ROLE_NOT_ALLOWED",
      occurredAt: 1_000,
    });
    expect(record.severity).toBe("warning");
    expect(record.actorUserId).toBe("5");
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("redacts secrets and limits metadata", () => {
    const record = buildSecurityAuditRecord({
      kind: "authentication",
      action: "login",
      outcome: "failed",
      occurredAt: 1_000,
      metadata: { password: "secret", csrfToken: "token", safe: "ok", nested: { no: true } },
    });
    expect(record.metadata).toEqual({ password: "[REDACTED]", csrfToken: "[REDACTED]", safe: "ok" });
  });

  it("rejects invalid company context and missing actions", () => {
    expect(() => buildSecurityAuditRecord({ kind: "session", action: "", outcome: "failed" })).toThrow("Invalid security event");
    expect(() => buildSecurityAuditRecord({ kind: "session", action: "refresh", outcome: "failed", companyId: -1 })).toThrow("Invalid security event");
  });

  it("marks cross-company and privileged failures critical", () => {
    expect(buildSecurityAuditRecord({ kind: "company-isolation", action: "read", outcome: "denied", occurredAt: 1 }).severity).toBe("critical");
    expect(buildSecurityAuditRecord({ kind: "privileged-operation", action: "repair", outcome: "failed", occurredAt: 1 }).severity).toBe("critical");
  });

  it("detects repeated denials and category anomalies inside the window", () => {
    const events = [
      buildSecurityAuditRecord({ kind: "company-isolation", action: "voucher.read", outcome: "denied", occurredAt: 9_900 }),
      buildSecurityAuditRecord({ kind: "protected-asset", action: "download", outcome: "denied", occurredAt: 9_901 }),
      buildSecurityAuditRecord({ kind: "session", action: "refresh", outcome: "failed", occurredAt: 9_902 }),
    ];
    const anomalies = detectSecurityAnomalies(events, { now: 10_000, windowMs: 1_000, denialThreshold: 3 });
    expect(anomalies.map((item) => item.code)).toEqual([
      "REPEATED_DENIALS",
      "CROSS_COMPANY_ATTEMPT",
      "CREDENTIAL_OR_SESSION_ANOMALY",
      "PROTECTED_ASSET_PROBING",
    ]);
  });

  it("ignores allowed and expired events", () => {
    const events = [
      buildSecurityAuditRecord({ kind: "authorization", action: "read", outcome: "allowed", occurredAt: 9_999 }),
      buildSecurityAuditRecord({ kind: "authorization", action: "write", outcome: "denied", occurredAt: 1 }),
    ];
    expect(detectSecurityAnomalies(events, { now: 10_000, windowMs: 100, denialThreshold: 1 })).toEqual([]);
  });
});
