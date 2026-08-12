import { describe, expect, it, vi } from "vitest";

import {
  appendFinancialAuditEventTx,
  assertFinancialDateOpenTx,
  buildFinancialAuditHash,
  closeFinancialPeriodTx,
  reopenFinancialPeriodTx,
  type SqlExecutor,
} from "../server/services/accounting/financialCloseService";

function txHarness(results: Array<{ rows: any[] }> = []) {
  const query = vi.fn(async () => results.shift() ?? { rows: [] });
  return { query } as unknown as SqlExecutor & { query: ReturnType<typeof vi.fn> };
}

describe("financial close service behavior", () => {
  it("builds deterministic hashes regardless of payload key order", () => {
    const eventAt = new Date("2026-08-01T12:00:00.000Z");
    const first = buildFinancialAuditHash(
      {
        companyId: 7,
        actorUserId: 42,
        eventType: "TEST",
        entityType: "voucher",
        entityId: 99,
        eventAt,
        reason: "audit",
        payload: { z: 1, nested: { b: 2, a: 1 }, a: [3, 2, 1] },
      },
      "previous"
    );
    const second = buildFinancialAuditHash(
      {
        companyId: 7,
        actorUserId: 42,
        eventType: "TEST",
        entityType: "voucher",
        entityId: "99",
        eventAt,
        reason: "audit",
        payload: { a: [3, 2, 1], nested: { a: 1, b: 2 }, z: 1 },
      },
      "previous"
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("appends an immutable audit event linked to the previous hash", async () => {
    const tx = txHarness([{ rows: [{ event_hash: "prev-hash" }] }, { rows: [] }]);
    const eventAt = new Date("2026-08-02T09:30:00.000Z");

    const hash = await appendFinancialAuditEventTx(tx, {
      companyId: 3,
      actorUserId: 8,
      eventType: "POSTED",
      entityType: "voucher",
      entityId: 123,
      eventAt,
      reason: "posted",
      payload: { amount: "12.50" },
    });

    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(tx.query.mock.calls[0][1]).toEqual([3]);
    expect(tx.query.mock.calls[1][1]).toEqual([
      3,
      8,
      "POSTED",
      "voucher",
      "123",
      eventAt,
      "posted",
      JSON.stringify({ amount: "12.50" }),
      "prev-hash",
      hash,
    ]);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows open dates and rejects dates inside closed periods", async () => {
    const openTx = txHarness([{ rows: [] }]);
    await expect(assertFinancialDateOpenTx(openTx, 4, "2026-08-05")).resolves.toBeUndefined();

    const closedTx = txHarness([{ rows: [{ id: "period-1" }] }]);
    await expect(assertFinancialDateOpenTx(closedTx, 4, "2026-08-05")).rejects.toThrow("FINANCIAL_PERIOD_CLOSED");
  });

  it("requires a close reason before changing period state", async () => {
    const tx = txHarness();
    await expect(
      closeFinancialPeriodTx(tx, {
        companyId: 1,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        actorUserId: 9,
        reason: "   ",
      })
    ).rejects.toThrow("CLOSE_REASON_REQUIRED");
    expect(tx.query).not.toHaveBeenCalled();
  });

  it("closes a period and records the immutable audit event", async () => {
    const tx = txHarness([{ rows: [] }, { rows: [] }, { rows: [] }]);

    await closeFinancialPeriodTx(tx, {
      companyId: 2,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      actorUserId: 11,
      reason: "month end",
    });

    expect(tx.query).toHaveBeenCalledTimes(3);
    expect(tx.query.mock.calls[0][1]).toEqual([2, "2026-07-01", "2026-07-31", 11, "month end"]);
    expect(tx.query.mock.calls[1][1]).toEqual([2]);
    expect(tx.query.mock.calls[2][1]).toEqual(
      expect.arrayContaining([
        2,
        11,
        "FINANCIAL_PERIOD_CLOSED",
        "financial-period",
        "2026-07-01:2026-07-31",
        "month end",
      ])
    );
  });

  it("requires a reopen reason and a matching closed period", async () => {
    const tx = txHarness();
    await expect(
      reopenFinancialPeriodTx(tx, {
        companyId: 2,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        actorUserId: 11,
        reason: "",
      })
    ).rejects.toThrow("REOPEN_REASON_REQUIRED");

    const missingTx = txHarness([{ rows: [] }]);
    await expect(
      reopenFinancialPeriodTx(missingTx, {
        companyId: 2,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        actorUserId: 11,
        reason: "correction",
      })
    ).rejects.toThrow("CLOSED_PERIOD_NOT_FOUND");
  });

  it("reopens a closed period and appends an immutable audit event", async () => {
    const tx = txHarness([{ rows: [{ id: "period-2" }] }, { rows: [{ event_hash: "previous" }] }, { rows: [] }]);

    await reopenFinancialPeriodTx(tx, {
      companyId: 5,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      actorUserId: 15,
      reason: "approved correction",
    });

    expect(tx.query).toHaveBeenCalledTimes(3);
    expect(tx.query.mock.calls[0][1]).toEqual([5, "2026-06-01", "2026-06-30", 15, "approved correction"]);
    expect(tx.query.mock.calls[1][1]).toEqual([5]);
    expect(tx.query.mock.calls[2][1]).toEqual(
      expect.arrayContaining([
        5,
        15,
        "FINANCIAL_PERIOD_REOPENED",
        "financial-period",
        "2026-06-01:2026-06-30",
        "approved correction",
        expect.any(String),
        "previous",
        expect.stringMatching(/^[a-f0-9]{64}$/),
      ])
    );
  });
});
