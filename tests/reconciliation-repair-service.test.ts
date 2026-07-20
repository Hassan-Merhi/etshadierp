import { describe, expect, it, vi } from "vitest";
import {
  executeApprovedRepairsTx,
  generateReconciliationReportTx,
  ReconciliationRepairError,
  type ReconciliationRepairAdapter,
} from "../server/services/accounting/reconciliationRepairService";

function adapter(canonical = "100", projected = "120"): ReconciliationRepairAdapter {
  return {
    loadCanonicalLedgerBalance: vi.fn().mockResolvedValue({
      amount: canonical,
      currency: "USD",
      source: "voucher_entries",
    }),
    loadProjectedBalance: vi.fn().mockResolvedValue({
      amount: projected,
      currency: "USD",
      source: "customer_balance",
    }),
    findExistingReport: vi.fn().mockResolvedValue(null),
    persistReport: vi.fn().mockResolvedValue(undefined),
    classifyRepair: vi.fn().mockResolvedValue({
      disposition: "projection-rebuild",
      reason: "Projection is derivable from canonical voucher entries",
    }),
    assertApprovalToken: vi.fn().mockResolvedValue(undefined),
    findExistingRepair: vi.fn().mockResolvedValue(null),
    lockRepairTarget: vi.fn().mockResolvedValue(undefined),
    assertPeriodOpen: vi.fn().mockResolvedValue(undefined),
    rebuildProjectionFromCanonical: vi.fn().mockResolvedValue(undefined),
    recordRepair: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
}

const request = {
  companyId: 1,
  asOfDate: "2026-07-18",
  runKey: "daily:1:2026-07-18",
  targets: [
    {
      domain: "customer" as const,
      companyId: 1,
      targetId: "42",
      asOfDate: "2026-07-18",
    },
  ],
};

describe("generateReconciliationReportTx", () => {
  it("builds an immutable repair plan from canonical-vs-projection drift", async () => {
    const dependencies = adapter("100", "120");
    const report = await generateReconciliationReportTx(
      {},
      request,
      dependencies,
      new Date("2026-07-18T06:00:00.000Z")
    );

    expect(report).toMatchObject({ matched: 0, mismatched: 1, generatedAt: "2026-07-18T06:00:00.000Z" });
    expect(report.items[0]).toMatchObject({
      canonicalAmount: "100",
      projectedAmount: "120",
      difference: "20",
      disposition: "projection-rebuild",
    });
    expect(dependencies.persistReport).toHaveBeenCalledTimes(1);
  });

  it("returns an existing report before reading balances", async () => {
    const dependencies = adapter();
    const existing = {
      runKey: request.runKey,
      companyId: 1,
      asOfDate: request.asOfDate,
      generatedAt: "2026-07-18T06:00:00.000Z",
      matched: 1,
      mismatched: 0,
      items: [],
    };
    vi.mocked(dependencies.findExistingReport).mockResolvedValue(existing);

    await expect(generateReconciliationReportTx({}, request, dependencies)).resolves.toBe(existing);
    expect(dependencies.loadCanonicalLedgerBalance).not.toHaveBeenCalled();
    expect(dependencies.persistReport).not.toHaveBeenCalled();
  });

  it("rejects cross-company target sets", async () => {
    const dependencies = adapter();
    await expect(
      generateReconciliationReportTx(
        {},
        { ...request, targets: [{ ...request.targets[0], companyId: 2 }] },
        dependencies
      )
    ).rejects.toMatchObject<Partial<ReconciliationRepairError>>({ code: "REPAIR_COMPANY_MISMATCH" });
  });
});

describe("executeApprovedRepairsTx", () => {
  it("locks, checks period, rebuilds projection, then records repair and audit", async () => {
    const dependencies = adapter();
    const report = await generateReconciliationReportTx({}, request, dependencies);
    vi.clearAllMocks();

    const result = await executeApprovedRepairsTx(
      {},
      {
        report,
        approvalToken: "approved-token",
        idempotencyKey: "repair:daily:1:2026-07-18",
        actor: { userId: 7, username: "admin", reason: "Repair verified projection drift" },
      },
      dependencies
    );

    expect(result).toMatchObject({ repaired: 1, skipped: 0 });
    expect(dependencies.lockRepairTarget).toHaveBeenCalledTimes(1);
    expect(dependencies.assertPeriodOpen).toHaveBeenCalledTimes(1);
    expect(dependencies.rebuildProjectionFromCanonical).toHaveBeenCalledTimes(1);
    expect(dependencies.recordRepair).toHaveBeenCalledTimes(1);
    expect(dependencies.recordAudit).toHaveBeenCalledTimes(1);

    const lockOrder = vi.mocked(dependencies.lockRepairTarget).mock.invocationCallOrder[0];
    const periodOrder = vi.mocked(dependencies.assertPeriodOpen).mock.invocationCallOrder[0];
    const rebuildOrder = vi.mocked(dependencies.rebuildProjectionFromCanonical).mock.invocationCallOrder[0];
    const recordOrder = vi.mocked(dependencies.recordRepair).mock.invocationCallOrder[0];
    const auditOrder = vi.mocked(dependencies.recordAudit).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(periodOrder);
    expect(periodOrder).toBeLessThan(rebuildOrder);
    expect(rebuildOrder).toBeLessThan(recordOrder);
    expect(recordOrder).toBeLessThan(auditOrder);
  });

  it("is repeat-safe before approval, locks, writes, or audit", async () => {
    const dependencies = adapter();
    const existing = {
      reportRunKey: request.runKey,
      repaired: 1,
      skipped: 0,
      repairedTargets: request.targets,
    };
    vi.mocked(dependencies.findExistingRepair).mockResolvedValue(existing);

    const result = await executeApprovedRepairsTx(
      {},
      {
        report: {
          runKey: request.runKey,
          companyId: 1,
          asOfDate: request.asOfDate,
          generatedAt: "2026-07-18T06:00:00.000Z",
          matched: 0,
          mismatched: 1,
          items: [],
        },
        approvalToken: "approved-token",
        idempotencyKey: "repair:daily:1:2026-07-18",
        actor: { reason: "Retry" },
      },
      dependencies
    );

    expect(result).toBe(existing);
    expect(dependencies.assertApprovalToken).not.toHaveBeenCalled();
    expect(dependencies.lockRepairTarget).not.toHaveBeenCalled();
    expect(dependencies.recordAudit).not.toHaveBeenCalled();
  });

  it("does not auto-repair manual-review items", async () => {
    const dependencies = adapter();
    const report = {
      runKey: request.runKey,
      companyId: 1,
      asOfDate: request.asOfDate,
      generatedAt: "2026-07-18T06:00:00.000Z",
      matched: 0,
      mismatched: 1,
      items: [
        {
          target: request.targets[0],
          canonicalAmount: "100",
          projectedAmount: "120",
          difference: "20",
          disposition: "manual-review" as const,
          reason: "Projection cannot be rebuilt deterministically",
        },
      ],
    };

    const result = await executeApprovedRepairsTx(
      {},
      {
        report,
        approvalToken: "approved-token",
        idempotencyKey: "repair:manual-review",
        actor: { reason: "Generate approved report only" },
      },
      dependencies
    );

    expect(result).toMatchObject({ repaired: 0, skipped: 1 });
    expect(dependencies.rebuildProjectionFromCanonical).not.toHaveBeenCalled();
  });
});
