import { describe, expect, it, vi } from "vitest";
import {
  assertPeriodOpenTx,
  lockThroughTx,
  PeriodLockError,
  type PeriodLockAdapter,
} from "../server/services/accounting/periodLockService";

function adapter(overrides: Partial<PeriodLockAdapter> = {}): PeriodLockAdapter {
  return {
    findApplicableLock: vi.fn().mockResolvedValue(null),
    lockPeriodState: vi.fn().mockResolvedValue(null),
    persistLock: vi.fn().mockResolvedValue({
      id: 1,
      companyId: 1,
      domain: "accounting",
      lockedThrough: "2026-06-30",
      version: 1,
    }),
    recordAudit: vi.fn().mockResolvedValue(undefined),
    findExistingOverride: vi.fn().mockResolvedValue(false),
    recordOverride: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const tx = {};

describe("period locking integrity", () => {
  it("allows a date after the locked-through date", async () => {
    const a = adapter({
      findApplicableLock: vi.fn().mockResolvedValue({
        id: 1,
        companyId: 1,
        domain: "accounting",
        lockedThrough: "2026-06-30",
        version: 2,
      }),
    });
    await expect(
      assertPeriodOpenTx(tx, { companyId: 1, domain: "accounting", effectiveDate: "2026-07-01" }, a)
    ).resolves.toMatchObject({ open: true, overridden: false });
  });

  it("blocks writes on or before the closed date", async () => {
    const a = adapter({
      findApplicableLock: vi.fn().mockResolvedValue({
        id: 1,
        companyId: 1,
        domain: "inventory",
        lockedThrough: "2026-06-30",
        version: 2,
      }),
    });
    await expect(
      assertPeriodOpenTx(tx, { companyId: 1, domain: "inventory", effectiveDate: "2026-06-30" }, a)
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    expect(a.recordOverride).not.toHaveBeenCalled();
  });

  it("requires a reasoned and idempotent override", async () => {
    const a = adapter({
      findApplicableLock: vi.fn().mockResolvedValue({
        id: 1,
        companyId: 1,
        domain: "factory",
        lockedThrough: "2026-06-30",
        version: 2,
      }),
    });
    const result = await assertPeriodOpenTx(
      tx,
      { companyId: 1, domain: "factory", effectiveDate: "2026-06-15" },
      a,
      {
        allowed: true,
        sourceType: "approved-repair",
        sourceId: "repair-22",
        idempotencyKey: "repair-22:period-override",
        actor: { userId: 5, username: "admin", reason: "Approved historical correction" },
      }
    );
    expect(result.overridden).toBe(true);
    expect(a.findExistingOverride).toHaveBeenCalledBefore(a.recordOverride as any);
    expect(a.recordOverride).toHaveBeenCalledTimes(1);
    expect(a.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "override" }));
  });

  it("does not duplicate an existing override or its audit", async () => {
    const a = adapter({
      findApplicableLock: vi.fn().mockResolvedValue({
        id: 1,
        companyId: 1,
        domain: "accounting",
        lockedThrough: "2026-06-30",
        version: 2,
      }),
      findExistingOverride: vi.fn().mockResolvedValue(true),
    });
    await assertPeriodOpenTx(
      tx,
      { companyId: 1, domain: "accounting", effectiveDate: "2026-06-01" },
      a,
      {
        allowed: true,
        sourceType: "reversal",
        sourceId: "voucher-1",
        idempotencyKey: "voucher-1:override",
        actor: { reason: "Approved reversal" },
      }
    );
    expect(a.recordOverride).not.toHaveBeenCalled();
    expect(a.recordAudit).not.toHaveBeenCalled();
  });

  it("locks state before extending and rejects stale versions", async () => {
    const current = {
      id: 1,
      companyId: 1,
      domain: "accounting" as const,
      lockedThrough: "2026-05-31",
      version: 4,
    };
    const a = adapter({ lockPeriodState: vi.fn().mockResolvedValue(current) });
    await expect(
      lockThroughTx(
        tx,
        {
          companyId: 1,
          domain: "accounting",
          lockedThrough: "2026-06-30",
          expectedVersion: 3,
          sourceType: "month-close",
          sourceId: "2026-06",
          actor: { reason: "June close approved" },
        },
        a
      )
    ).rejects.toMatchObject({ code: "PERIOD_LOCK_STALE" });
    expect(a.persistLock).not.toHaveBeenCalled();
  });

  it("forbids reopening through the normal lock path", async () => {
    const a = adapter({
      lockPeriodState: vi.fn().mockResolvedValue({
        id: 1,
        companyId: 1,
        domain: "accounting",
        lockedThrough: "2026-06-30",
        version: 4,
      }),
    });
    await expect(
      lockThroughTx(
        tx,
        {
          companyId: 1,
          domain: "accounting",
          lockedThrough: "2026-05-31",
          expectedVersion: 4,
          sourceType: "month-close",
          sourceId: "2026-05",
          actor: { reason: "Attempted reopen" },
        },
        a
      )
    ).rejects.toBeInstanceOf(PeriodLockError);
    expect(a.persistLock).not.toHaveBeenCalled();
  });

  it("persists then audits a new lock", async () => {
    const a = adapter();
    await lockThroughTx(
      tx,
      {
        companyId: 1,
        domain: "accounting",
        lockedThrough: "2026-06-30",
        sourceType: "month-close",
        sourceId: "2026-06",
        actor: { userId: 5, reason: "Month-end approved" },
      },
      a
    );
    expect(a.lockPeriodState).toHaveBeenCalledBefore(a.persistLock as any);
    expect(a.persistLock).toHaveBeenCalledBefore(a.recordAudit as any);
    expect(a.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "lock" }));
  });
});