import { describe, expect, it } from "vitest";
import {
  GOLDEN_COAST_PHASE7_SOURCE_TYPE,
  GoldenCoastPhase7TransferError,
  buildGoldenCoastPhase7TransferPostings,
  goldenCoastPhase7IdempotencyKey,
  goldenCoastPhase7SourceId,
  goldenCoastPhase7TransferDigest,
  parseGoldenCoastPhase7TransferInput,
  planGoldenCoastPhase7Transfer,
  type GoldenCoastPhase7RoleAccounts,
  type GoldenCoastPhase7TransferInput,
} from "./goldenCoastPhase7HadiTransfer";

const accounts: GoldenCoastPhase7RoleAccounts = {
  gcSalesCashAccountId: 101,
  goldenCoastHadiIntercompanyAccountId: 102,
  hadiGoldenCoastIntercompanyAccountId: 201,
};

function parsedCollect(overrides: Record<string, unknown> = {}): GoldenCoastPhase7TransferInput {
  return parseGoldenCoastPhase7TransferInput({
    companyId: 14,
    parentCompanyId: 1,
    body: {
      operation: "collect_via_hadi",
      transferDate: "2026-09-10",
      amountUsd: "600.00",
      clientRequestId: "collect-001",
      reference: "September sales cash",
      hadiCashAccount: { kind: "bank", id: 301 },
      ...overrides,
    },
  });
}

function parsedRemit(overrides: Record<string, unknown> = {}): GoldenCoastPhase7TransferInput {
  return parseGoldenCoastPhase7TransferInput({
    companyId: 14,
    parentCompanyId: 1,
    body: {
      operation: "remit_from_hadi",
      transferDate: "2026-09-11",
      amountUsd: "250.00",
      clientRequestId: "remit-001",
      reference: "Partial HADI remittance",
      hadiCashAccount: { kind: "bank", id: 301 },
      goldenCoastCashAccount: { kind: "ledger", id: 401 },
      ...overrides,
    },
  });
}

function parsedPayFreshStart(overrides: Record<string, unknown> = {}): GoldenCoastPhase7TransferInput {
  return parseGoldenCoastPhase7TransferInput({
    companyId: 14,
    parentCompanyId: 1,
    body: {
      operation: "pay_fresh_start_from_hadi",
      transferDate: "2026-09-12",
      amountUsd: "300.00",
      clientRequestId: "pay-fresh-001",
      reference: "Fresh Start settlement",
      hadiCashAccount: { kind: "bank", id: 301 },
      ...overrides,
    },
  });
}

function expectTransferError(fn: () => unknown, code?: GoldenCoastPhase7TransferError["code"]): void {
  try {
    fn();
    throw new Error("Expected GoldenCoastPhase7TransferError");
  } catch (error) {
    expect(error).toBeInstanceOf(GoldenCoastPhase7TransferError);
    if (code) expect((error as GoldenCoastPhase7TransferError).code).toBe(code);
  }
}

describe("Golden Coast Phase 7 HADI transfer planner", () => {
  it("parses collection, remittance, and Fresh Start payment with the right cash targets", () => {
    expect(parsedCollect()).toMatchObject({ operation: "collect_via_hadi", goldenCoastCashAccount: null });
    expect(parsedRemit()).toMatchObject({
      operation: "remit_from_hadi",
      goldenCoastCashAccount: { kind: "ledger", id: 401 },
    });
    expect(parsedPayFreshStart()).toMatchObject({
      operation: "pay_fresh_start_from_hadi",
      goldenCoastCashAccount: null,
      hadiCashAccount: { kind: "bank", id: 301 },
    });
  });

  it("only allows a Golden Coast cash destination on remittance back to GC", () => {
    expectTransferError(() => parsedRemit({ goldenCoastCashAccount: null }));
    expectTransferError(() => parsedCollect({ goldenCoastCashAccount: { kind: "ledger", id: 401 } }));
    expectTransferError(() => parsedPayFreshStart({ goldenCoastCashAccount: { kind: "ledger", id: 401 } }));
  });

  it("rejects invalid operations, bad amounts, pre-cutover dates, and same-company routing", () => {
    expectTransferError(() => parsedCollect({ operation: "generic_transfer" }));
    expectTransferError(() => parsedCollect({ amountUsd: "0" }));
    expectTransferError(() => parsedCollect({ amountUsd: "-1" }));
    expectTransferError(() => parsedCollect({ amountUsd: "1.001" }));
    expectTransferError(() => parsedCollect({ transferDate: "2026-08-31" }), "GC_PHASE7_PRE_CUTOVER_DATE");
    expectTransferError(
      () =>
        parseGoldenCoastPhase7TransferInput({
          companyId: 14,
          parentCompanyId: 14,
          body: {
            operation: "pay_fresh_start_from_hadi",
            transferDate: "2026-09-12",
            amountUsd: "10",
            clientRequestId: "same-company",
            hadiCashAccount: { kind: "bank", id: 1 },
          },
        }),
      "GC_PHASE7_SCOPE_INVALID"
    );
  });

  it("collection increases the GC payable and HADI-held amount even when GC Sales Cash is already credit", () => {
    const plan = planGoldenCoastPhase7Transfer({
      transfer: parsedCollect(),
      balances: {
        gcSalesCashDebitBalanceUsd: "-1000.00",
        outstandingHadiCollectionsUsd: "1000.00",
      },
    });
    expect(plan.gcSalesCashDebitBalanceBeforeUsd).toBe("-1000.00");
    expect(plan.gcSalesCashDebitBalanceAfterUsd).toBe("-1600.00");
    expect(plan.outstandingHadiCollectionsAfterUsd).toBe("1600.00");
  });

  it("Fresh Start payment reduces both the GC payable and HADI-held sales cash", () => {
    const plan = planGoldenCoastPhase7Transfer({
      transfer: parsedPayFreshStart(),
      balances: {
        gcSalesCashDebitBalanceUsd: "-1000.00",
        outstandingHadiCollectionsUsd: "1000.00",
      },
    });
    expect(plan.gcSalesCashDebitBalanceAfterUsd).toBe("-700.00");
    expect(plan.outstandingHadiCollectionsBeforeUsd).toBe("1000.00");
    expect(plan.outstandingHadiCollectionsAfterUsd).toBe("700.00");
  });

  it("rejects a Fresh Start payment above the payable", () => {
    expectTransferError(
      () =>
        planGoldenCoastPhase7Transfer({
          transfer: parsedPayFreshStart({ amountUsd: "1000.01" }),
          balances: { gcSalesCashDebitBalanceUsd: "-1000", outstandingHadiCollectionsUsd: "1500" },
        }),
      "GC_PHASE7_PAYMENT_EXCEEDS_PAYABLE"
    );
  });

  it("rejects a Fresh Start payment above the HADI-held amount", () => {
    expectTransferError(
      () =>
        planGoldenCoastPhase7Transfer({
          transfer: parsedPayFreshStart({ amountUsd: "500.01" }),
          balances: { gcSalesCashDebitBalanceUsd: "-1000", outstandingHadiCollectionsUsd: "500" },
        }),
      "GC_PHASE7_REMITTANCE_EXCEEDS_COLLECTIONS"
    );
  });

  it("remittance back to GC reduces HADI-held cash but does not settle the Fresh Start payable", () => {
    const plan = planGoldenCoastPhase7Transfer({
      transfer: parsedRemit(),
      balances: { gcSalesCashDebitBalanceUsd: "-1200", outstandingHadiCollectionsUsd: "700" },
    });
    expect(plan.gcSalesCashDebitBalanceAfterUsd).toBe("-1200.00");
    expect(plan.outstandingHadiCollectionsAfterUsd).toBe("450.00");
  });

  it("fails closed if HADI-use history exceeds HADI collections", () => {
    expectTransferError(
      () =>
        planGoldenCoastPhase7Transfer({
          transfer: parsedPayFreshStart({ amountUsd: "1" }),
          balances: { gcSalesCashDebitBalanceUsd: "-100", outstandingHadiCollectionsUsd: "-0.01" },
        }),
      "GC_PHASE7_SCOPE_INVALID"
    );
  });

  it("builds collection as GC Dr HADI IC / Cr GC Sales Cash and HADI Dr cash / Cr GC intercompany", () => {
    const transfer = parsedCollect();
    const plan = planGoldenCoastPhase7Transfer({
      transfer,
      balances: { gcSalesCashDebitBalanceUsd: "0", outstandingHadiCollectionsUsd: "0" },
    });
    const batch = buildGoldenCoastPhase7TransferPostings({
      plan,
      accounts,
      transferDigest: goldenCoastPhase7TransferDigest({ transfer, accounts }),
      goldenCoastExchangeRate: null,
      hadiExchangeRate: null,
    });
    const gc = batch.postings.find((posting) => posting.role === "golden_coast")?.request;
    const hadi = batch.postings.find((posting) => posting.role === "hadi")?.request;
    expect(gc?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 102, debitAmount: "600", creditAmount: "0" }),
        expect.objectContaining({ ledgerAccountId: 101, debitAmount: "0", creditAmount: "600" }),
      ])
    );
    expect(hadi?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bankAccountId: 301, debitAmount: "600", creditAmount: "0" }),
        expect.objectContaining({ ledgerAccountId: 201, debitAmount: "0", creditAmount: "600" }),
      ])
    );
  });

  it("builds Fresh Start payment as GC Dr payable / Cr HADI IC and HADI Dr GC IC / Cr cash", () => {
    const transfer = parsedPayFreshStart();
    const plan = planGoldenCoastPhase7Transfer({
      transfer,
      balances: { gcSalesCashDebitBalanceUsd: "-1000", outstandingHadiCollectionsUsd: "1000" },
    });
    const batch = buildGoldenCoastPhase7TransferPostings({
      plan,
      accounts,
      transferDigest: goldenCoastPhase7TransferDigest({ transfer, accounts }),
      goldenCoastExchangeRate: null,
      hadiExchangeRate: null,
    });
    const gc = batch.postings.find((posting) => posting.role === "golden_coast")?.request;
    const hadi = batch.postings.find((posting) => posting.role === "hadi")?.request;
    expect(gc?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 101, debitAmount: "300", creditAmount: "0" }),
        expect.objectContaining({ ledgerAccountId: 102, debitAmount: "0", creditAmount: "300" }),
      ])
    );
    expect(hadi?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 201, debitAmount: "300", creditAmount: "0" }),
        expect.objectContaining({ bankAccountId: 301, debitAmount: "0", creditAmount: "300" }),
      ])
    );
  });

  it("builds remittance back to GC without touching GC Sales Cash", () => {
    const transfer = parsedRemit();
    const plan = planGoldenCoastPhase7Transfer({
      transfer,
      balances: { gcSalesCashDebitBalanceUsd: "-1200", outstandingHadiCollectionsUsd: "700" },
    });
    const batch = buildGoldenCoastPhase7TransferPostings({
      plan,
      accounts,
      transferDigest: goldenCoastPhase7TransferDigest({ transfer, accounts }),
      goldenCoastExchangeRate: null,
      hadiExchangeRate: null,
    });
    const gc = batch.postings.find((posting) => posting.role === "golden_coast")?.request;
    expect(gc?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerAccountId: 401, debitAmount: "250", creditAmount: "0" }),
        expect.objectContaining({ ledgerAccountId: 102, debitAmount: "0", creditAmount: "250" }),
      ])
    );
    expect(gc?.entries.some((entry) => entry.ledgerAccountId === 101)).toBe(false);
  });

  it("uses payload-bound deterministic digests and stable company/request idempotency", () => {
    const original = parsedPayFreshStart();
    const same = parsedPayFreshStart();
    const changed = parsedPayFreshStart({ amountUsd: "301" });
    expect(goldenCoastPhase7TransferDigest({ transfer: original, accounts })).toBe(
      goldenCoastPhase7TransferDigest({ transfer: same, accounts })
    );
    expect(goldenCoastPhase7TransferDigest({ transfer: original, accounts })).not.toBe(
      goldenCoastPhase7TransferDigest({ transfer: changed, accounts })
    );
    expect(goldenCoastPhase7IdempotencyKey(14, "request-1", "golden_coast")).toBe(
      `${GOLDEN_COAST_PHASE7_SOURCE_TYPE}:14:request-1:golden_coast`
    );
  });

  it("records Fresh Start payments as HADI cash uses in the existing outstanding-history prefix", () => {
    expect(goldenCoastPhase7SourceId("pay_fresh_start_from_hadi", "abc123", "golden_coast")).toBe(
      "remit_from_hadi:abc123:golden_coast"
    );
  });

  it("refuses a collapsed GC Sales Cash/intercompany mapping", () => {
    const transfer = parsedPayFreshStart();
    const badAccounts = { ...accounts, goldenCoastHadiIntercompanyAccountId: accounts.gcSalesCashAccountId };
    const plan = planGoldenCoastPhase7Transfer({
      transfer,
      balances: { gcSalesCashDebitBalanceUsd: "-1000", outstandingHadiCollectionsUsd: "1000" },
    });
    expectTransferError(
      () =>
        buildGoldenCoastPhase7TransferPostings({
          plan,
          accounts: badAccounts,
          transferDigest: goldenCoastPhase7TransferDigest({ transfer, accounts: badAccounts }),
          goldenCoastExchangeRate: null,
          hadiExchangeRate: null,
        }),
      "GC_PHASE7_SCOPE_INVALID"
    );
  });
});
