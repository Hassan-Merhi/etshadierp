import { describe, expect, it } from "vitest";
import { buildFinancialAuditHash } from "./financialCloseService";

const base = {
  companyId: 7,
  actorUserId: 11,
  eventType: "FINANCIAL_PERIOD_CLOSED",
  entityType: "financial-period",
  entityId: "2026-07-01:2026-07-31",
  reason: "Month-end close",
  payload: { periodEnd: "2026-07-31", periodStart: "2026-07-01" },
  eventAt: new Date("2026-07-31T20:00:00.000Z"),
};

describe("financialCloseService", () => {
  it("builds deterministic hashes regardless of payload key order", () => {
    const first = buildFinancialAuditHash(base, null);
    const second = buildFinancialAuditHash({ ...base, payload: { periodStart: "2026-07-01", periodEnd: "2026-07-31" } }, null);
    expect(first).toBe(second);
  });

  it("chains each event to the previous hash", () => {
    const first = buildFinancialAuditHash(base, null);
    const second = buildFinancialAuditHash({ ...base, eventType: "FINANCIAL_PERIOD_REOPENED" }, first);
    expect(second).not.toBe(buildFinancialAuditHash({ ...base, eventType: "FINANCIAL_PERIOD_REOPENED" }, null));
  });

  it("changes the hash when financially relevant content changes", () => {
    expect(buildFinancialAuditHash(base, null)).not.toBe(
      buildFinancialAuditHash({ ...base, reason: "Different reason" }, null),
    );
  });
});
