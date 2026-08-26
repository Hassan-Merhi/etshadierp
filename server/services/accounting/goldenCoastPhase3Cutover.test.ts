import { describe, expect, it } from "vitest";

import {
  GOLDEN_COAST_PHASE3_CUTOVER_DATE,
  GOLDEN_COAST_PHASE3_PARTNER_EQUITY_USD,
  GOLDEN_COAST_PHASE3_VOUCHER_NUMBER,
  GoldenCoastPhase3CutoverError,
  buildGoldenCoastPhase3CutoverPlan,
  goldenCoastPhase3VoucherNumber,
  type GoldenCoastPhase3CutoverInput,
} from "./goldenCoastPhase3Cutover";

const accounts = {
  freshStartEquityAccountId: 101,
  hassanEquityAccountId: 102,
  hassanSavingsAccountId: 103,
  gcSalesCashAccountId: 104,
  stockOtwAccountId: 105,
  stockInHandAccountId: 106,
  containerReserveAccountId: 107,
};

function input(overrides: Partial<GoldenCoastPhase3CutoverInput> = {}): GoldenCoastPhase3CutoverInput {
  return {
    companyId: 7,
    stockOtwUsd: "44000.00",
    stockInHandUsd: "0.00",
    containerReserveUsd: "22300.00",
    gcSalesCashUsd: "0.00",
    hassanSavingsUsd: "0.00",
    cashAccount: { kind: "bank", id: 22, name: "Operating Bank" },
    accounts,
    ...overrides,
  };
}

function total(
  entries: ReturnType<typeof buildGoldenCoastPhase3CutoverPlan>["entries"],
  field: "debitAmount" | "creditAmount"
) {
  return entries.reduce((sum, entry) => sum + Number(entry[field]), 0);
}

describe("Golden Coast Phase 3 opening-balance cutover", () => {
  it("locks the cutover to September 1, 2026 and two $100,000 partner-equity targets", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input());

    expect(plan.cutoverDate).toBe(GOLDEN_COAST_PHASE3_CUTOVER_DATE);
    expect(plan.cutoverDate).toBe("2026-09-01");
    expect(plan.voucherNumber).toBe(`${GOLDEN_COAST_PHASE3_VOUCHER_NUMBER}-C7`);
    expect(plan.voucherNumber).toBe(goldenCoastPhase3VoucherNumber(7));
    expect(plan.partnerEquityPerPartnerUsd).toBe(GOLDEN_COAST_PHASE3_PARTNER_EQUITY_USD);
    expect(plan.totalPartnerEquityUsd).toBe("200000.00");
    expect(plan.profitPendingDistributionUsd).toBe("0.00");
  });

  it("namespaces the globally unique voucher number by company", () => {
    expect(goldenCoastPhase3VoucherNumber(7)).toBe("GC-CUTOVER-20260901-C7");
    expect(goldenCoastPhase3VoucherNumber(8)).toBe("GC-CUTOVER-20260901-C8");
    expect(goldenCoastPhase3VoucherNumber(7)).not.toBe(goldenCoastPhase3VoucherNumber(8));
  });

  it("calculates the residual cash/bank opening balance instead of using a permanent clearing account", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input());

    // $200,000 total partner equity - $44,000 Stock OTW - $22,300 reserve.
    expect(plan.openingCashUsd).toBe("133700.00");
    expect(plan.stockOtwUsd).toBe("44000.00");
    expect(plan.containerReserveUsd).toBe("22300.00");
    expect(plan.entries.some((entry) => entry.bankAccountId === 22 && entry.debitAmount === "133700.00")).toBe(true);
  });

  it("posts Fresh Start and Hassan as separate 50/50 equity credits", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input());
    const freshStart = plan.entries.find((entry) => entry.ledgerAccountId === accounts.freshStartEquityAccountId);
    const hassan = plan.entries.find((entry) => entry.ledgerAccountId === accounts.hassanEquityAccountId);

    expect(freshStart?.creditAmount).toBe("100000.00");
    expect(hassan?.creditAmount).toBe("100000.00");
    expect(freshStart?.debitAmount).toBe("0.00");
    expect(hassan?.debitAmount).toBe("0.00");
  });

  it("carries an existing GC Sales Cash payable and Hassan Savings loan as opening liabilities", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input({ gcSalesCashUsd: "12500.50", hassanSavingsUsd: "7500.25" }));

    expect(plan.gcSalesCashUsd).toBe("12500.50");
    expect(plan.hassanSavingsUsd).toBe("7500.25");
    expect(plan.openingCashUsd).toBe("153700.75");
    expect(plan.entries.find((entry) => entry.ledgerAccountId === accounts.gcSalesCashAccountId)?.creditAmount).toBe(
      "12500.50"
    );
    expect(plan.entries.find((entry) => entry.ledgerAccountId === accounts.hassanSavingsAccountId)?.creditAmount).toBe(
      "7500.25"
    );
  });

  it("supports an active Cash/Bank ledger account instead of a bank-account row", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input({ cashAccount: { kind: "ledger", id: 55 } }));
    const cash = plan.entries.find((entry) => entry.ledgerAccountId === 55);
    expect(cash?.debitAmount).toBe("133700.00");
    expect(cash?.bankAccountId).toBeUndefined();
  });

  it("omits zero-value asset and liability lines while preserving a balanced journal", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(
      input({
        stockOtwUsd: 0,
        stockInHandUsd: 0,
        containerReserveUsd: 0,
        gcSalesCashUsd: 0,
        hassanSavingsUsd: 0,
      })
    );

    expect(plan.entries).toHaveLength(3);
    expect(plan.openingCashUsd).toBe("200000.00");
    expect(total(plan.entries, "debitAmount")).toBe(200000);
    expect(total(plan.entries, "creditAmount")).toBe(200000);
  });

  it("is balanced to the cent for stock, reserve, cash, equity and carried liabilities", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(
      input({
        stockOtwUsd: "44000.25",
        stockInHandUsd: "32000.10",
        containerReserveUsd: "22300.15",
        gcSalesCashUsd: "8500.50",
        hassanSavingsUsd: "1100.20",
      })
    );

    expect(total(plan.entries, "debitAmount")).toBeCloseTo(total(plan.entries, "creditAmount"), 8);
    expect(plan.totalAmount).toBe("209600.70");
  });

  it("rejects omitted required asset balances instead of silently treating them as zero", () => {
    const missingStockOtw = input() as GoldenCoastPhase3CutoverInput & {
      stockOtwUsd?: string;
    };
    delete missingStockOtw.stockOtwUsd;
    expect(() => buildGoldenCoastPhase3CutoverPlan(missingStockOtw as GoldenCoastPhase3CutoverInput)).toThrow(
      /stockOtwUsd is required/
    );

    const missingStockInHand = input() as GoldenCoastPhase3CutoverInput & {
      stockInHandUsd?: string;
    };
    delete missingStockInHand.stockInHandUsd;
    expect(() => buildGoldenCoastPhase3CutoverPlan(missingStockInHand as GoldenCoastPhase3CutoverInput)).toThrow(
      /stockInHandUsd is required/
    );

    const missingReserve = input() as GoldenCoastPhase3CutoverInput & {
      containerReserveUsd?: string;
    };
    delete missingReserve.containerReserveUsd;
    expect(() => buildGoldenCoastPhase3CutoverPlan(missingReserve as GoldenCoastPhase3CutoverInput)).toThrow(
      /containerReserveUsd is required/
    );
  });

  it("keeps optional carried liabilities defaultable to zero", () => {
    const plan = buildGoldenCoastPhase3CutoverPlan(input({ gcSalesCashUsd: undefined, hassanSavingsUsd: undefined }));
    expect(plan.gcSalesCashUsd).toBe("0.00");
    expect(plan.hassanSavingsUsd).toBe("0.00");
  });

  it("rejects negative opening balances", () => {
    expect(() => buildGoldenCoastPhase3CutoverPlan(input({ stockOtwUsd: "-0.01" }))).toThrow(
      GoldenCoastPhase3CutoverError
    );
    expect(() => buildGoldenCoastPhase3CutoverPlan(input({ hassanSavingsUsd: -1 }))).toThrow(
      /hassanSavingsUsd cannot be negative/
    );
  });

  it("rejects sub-cent values so the central posting engine cannot round the cutover out of balance", () => {
    expect(() => buildGoldenCoastPhase3CutoverPlan(input({ containerReserveUsd: "1.001" }))).toThrow(
      /two decimal places/
    );
  });

  it("rejects a negative residual cash position instead of manufacturing a credit cash line", () => {
    expect(() =>
      buildGoldenCoastPhase3CutoverPlan(
        input({ stockOtwUsd: "150000", stockInHandUsd: "60000", containerReserveUsd: 0 })
      )
    ).toThrow(/non-cash assets exceed partner equity/);
  });

  it("rejects duplicate canonical role ids", () => {
    expect(() =>
      buildGoldenCoastPhase3CutoverPlan(
        input({ accounts: { ...accounts, hassanEquityAccountId: accounts.freshStartEquityAccountId } })
      )
    ).toThrow(/distinct ledger account/);
  });

  it("rejects invalid company and cash targets", () => {
    expect(() => buildGoldenCoastPhase3CutoverPlan(input({ companyId: 0 }))).toThrow(
      /companyId must be a positive integer/
    );
    expect(() => buildGoldenCoastPhase3CutoverPlan(input({ cashAccount: { kind: "bank", id: 0 } }))).toThrow(
      /cashAccount.id must be a positive integer/
    );
    expect(() =>
      buildGoldenCoastPhase3CutoverPlan(input({ cashAccount: { kind: "wallet" as "bank", id: 4 } }))
    ).toThrow(/cashAccount.kind/);
  });
});
