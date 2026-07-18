import { describe, expect, it, vi } from "vitest";
import {
  reconcileTargetTx,
  reconcileTargetsTx,
  ReconciliationValidationError,
  type ReconciliationAdapter,
  type ReconciliationTarget,
} from "../server/services/accounting/partyReconciliationService";

const target: ReconciliationTarget = {
  domain: "customer",
  companyId: 1,
  targetId: "42",
  asOfDate: "2026-07-18",
};

function adapter(canonical = "100.000000", projected = "100.000000"): ReconciliationAdapter {
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
  };
}

describe("reconcileTargetTx", () => {
  it("matches equal decimal balances exactly", async () => {
    const result = await reconcileTargetTx({}, target, adapter());
    expect(result.status).toBe("matched");
    expect(result.difference).toBe("0");
  });

  it("reports projection minus canonical ledger as the difference", async () => {
    const result = await reconcileTargetTx({}, target, adapter("100", "118.25"));
    expect(result.status).toBe("mismatch");
    expect(result.difference).toBe("18.25");
  });

  it("rejects cross-currency comparisons", async () => {
    const mixedCurrency: ReconciliationAdapter = {
      loadCanonicalLedgerBalance: vi.fn().mockResolvedValue({
        amount: "100",
        currency: "USD",
        source: "voucher_entries",
      }),
      loadProjectedBalance: vi.fn().mockResolvedValue({
        amount: "100",
        currency: "CDF",
        source: "supplier_balance",
      }),
    };

    await expect(reconcileTargetTx({}, target, mixedCurrency)).rejects.toMatchObject<
      Partial<ReconciliationValidationError>
    >({ code: "RECONCILIATION_CURRENCY_MISMATCH" });
  });
});

describe("reconcileTargetsTx", () => {
  it("summarizes matched and mismatched targets", async () => {
    const balances: Record<string, string> = { cash: "50", bank: "75.5" };
    const batchAdapter: ReconciliationAdapter = {
      loadCanonicalLedgerBalance: vi.fn(async ({ domain }) => ({
        amount: balances[domain],
        currency: "USD",
        source: "voucher_entries",
      })),
      loadProjectedBalance: vi.fn(async ({ domain }) => ({
        amount: domain === "cash" ? "50" : "70",
        currency: "USD",
        source: `${domain}_projection`,
      })),
    };

    const result = await reconcileTargetsTx(
      {},
      [
        { domain: "cash", companyId: 1, targetId: "cash-main" },
        { domain: "bank", companyId: 1, targetId: "bank-main" },
      ],
      batchAdapter
    );

    expect(result.matched).toBe(1);
    expect(result.mismatched).toBe(1);
    expect(result.results[1].difference).toBe("-5.5");
  });

  it("rejects duplicate company/domain/target/as-of keys", async () => {
    await expect(reconcileTargetsTx({}, [target, { ...target }], adapter())).rejects.toMatchObject<
      Partial<ReconciliationValidationError>
    >({ code: "RECONCILIATION_TARGET_DUPLICATE" });
  });
});
