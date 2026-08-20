import { describe, expect, it, vi } from "vitest";

import {
  ConvergenceReconciliationError,
  type ConvergenceReconciliationResult,
} from "../server/services/accounting/convergenceReconciliation";
import {
  runScheduledConvergenceReconciliation,
} from "../server/services/accounting/scheduledConvergenceReconciliation";

function cleanResult(companyId: number): ConvergenceReconciliationResult {
  return {
    companyId,
    accountingSnapshots: 4,
    stockSnapshots: 3,
    discrepancies: [],
    clean: true,
  };
}

describe("scheduled convergence reconciliation", () => {
  it("checks every company and summarizes discrepancies without repairing anything", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const reconcileCompany = vi.fn(async (companyId: number): Promise<ConvergenceReconciliationResult> => {
      if (companyId === 1) return cleanResult(companyId);
      return {
        companyId,
        accountingSnapshots: 8,
        stockSnapshots: 5,
        discrepancies: [
          {
            domain: "accounting",
            identity: "voucher:91",
            code: "DAYBOOK_MISSING",
            expected: "125",
            actual: "missing",
          },
          {
            domain: "inventory",
            identity: "stock-transfer:44",
            code: "STOCK_VALUE_MISMATCH",
            expected: "300",
            actual: "295",
          },
        ],
        clean: false,
      };
    });

    const summary = await runScheduledConvergenceReconciliation({
      listCompanyIds: async () => [1, 2],
      reconcileCompany,
      info,
      warn,
      error,
    });

    expect(reconcileCompany).toHaveBeenCalledTimes(2);
    expect(reconcileCompany).toHaveBeenNthCalledWith(1, 1);
    expect(reconcileCompany).toHaveBeenNthCalledWith(2, 2);
    expect(summary).toEqual({
      companies: 2,
      clean: 1,
      withDiscrepancies: 1,
      rejected: 0,
      failed: 0,
      discrepancies: 2,
    });
    expect(warn).toHaveBeenCalledWith(
      "Scheduled convergence reconciliation found discrepancies",
      expect.objectContaining({
        companyId: 2,
        discrepancyCount: 2,
        discrepancyCodes: ["DAYBOOK_MISSING", "STOCK_VALUE_MISMATCH"],
      })
    );
    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "Scheduled convergence reconciliation complete",
      expect.objectContaining(summary)
    );
  });

  it("fails closed per company and continues checking the remaining tenants", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const reconcileCompany = vi.fn(async (companyId: number): Promise<ConvergenceReconciliationResult> => {
      if (companyId === 1) {
        throw new ConvergenceReconciliationError("CONVERGENCE_DUPLICATE_SNAPSHOT", "duplicate evidence");
      }
      if (companyId === 2) throw new Error("database unavailable");
      return cleanResult(companyId);
    });

    const summary = await runScheduledConvergenceReconciliation({
      listCompanyIds: async () => [1, 2, 3],
      reconcileCompany,
      info,
      warn,
      error,
    });

    expect(reconcileCompany).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({
      companies: 3,
      clean: 1,
      withDiscrepancies: 0,
      rejected: 1,
      failed: 1,
      discrepancies: 0,
    });
    expect(warn).toHaveBeenCalledWith(
      "Scheduled convergence reconciliation rejected untrustworthy evidence",
      expect.objectContaining({
        companyId: 1,
        code: "CONVERGENCE_DUPLICATE_SNAPSHOT",
      })
    );
    expect(error).toHaveBeenCalledWith(
      "Scheduled convergence reconciliation failed for company",
      expect.objectContaining({ companyId: 2 })
    );
    expect(info).toHaveBeenCalledWith(
      "Scheduled convergence reconciliation complete",
      expect.objectContaining(summary)
    );
  });

  it("reports an empty company set as a successful no-op", async () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const reconcileCompany = vi.fn(async (companyId: number) => cleanResult(companyId));

    const summary = await runScheduledConvergenceReconciliation({
      listCompanyIds: async () => [],
      reconcileCompany,
      info,
      warn,
      error,
    });

    expect(reconcileCompany).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(summary).toEqual({
      companies: 0,
      clean: 0,
      withDiscrepancies: 0,
      rejected: 0,
      failed: 0,
      discrepancies: 0,
    });
  });
});
