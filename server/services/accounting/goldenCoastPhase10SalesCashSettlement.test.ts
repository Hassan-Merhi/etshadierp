import { describe, expect, it } from "vitest";
import {
  GOLDEN_COAST_PHASE10_SOURCE_TYPE,
  GoldenCoastPhase10SettlementError,
  buildGoldenCoastPhase10SettlementPosting,
  goldenCoastPhase10IdempotencyKey,
  goldenCoastPhase10SettlementDigest,
  parseGoldenCoastPhase10SettlementInput,
  planGoldenCoastPhase10Settlement,
} from "./goldenCoastPhase10SalesCashSettlement";

function settlement(overrides: Record<string, unknown> = {}) {
  return parseGoldenCoastPhase10SettlementInput({
    companyId: 7,
    body: {
      settlementDate: "2026-09-01",
      amountUsd: "600.00",
      clientRequestId: "phase10-test-1",
      receiptAccount: { kind: "bank", id: 91 },
      reference: "Direct collection",
      ...overrides,
    },
  });
}

describe("Golden Coast Phase 10 GC Sales Cash settlement", () => {
  it("parses a post-cutover partial settlement payload", () => {
    expect(settlement()).toEqual({
      companyId: 7,
      settlementDate: "2026-09-01",
      amountUsd: "600.00",
      transferFeeUsd: "0.00",
      clientRequestId: "phase10-test-1",
      receiptAccount: { kind: "bank", id: 91 },
      reference: "Direct collection",
    });
  });

  it("rejects pre-cutover dates, invalid request ids and sub-cent amounts", () => {
    expect(() => settlement({ settlementDate: "2026-08-31" })).toThrow(/cutover date/);
    expect(() => settlement({ clientRequestId: "bad request" })).toThrow(GoldenCoastPhase10SettlementError);
    expect(() => settlement({ amountUsd: "1.001" })).toThrow(/at most 2 decimal places/);
    expect(() => settlement({ transferFeeUsd: "-0.01" })).toThrow(/transferFeeUsd cannot be negative/);
    expect(() => settlement({ transferFeeUsd: "1.001" })).toThrow(/at most 2 decimal places/);
  });

  it("relieves the payable by the full settlement and adds the fee to the cash outflow", () => {
    const parsed = settlement({ amountUsd: "600.00", transferFeeUsd: "12.50" });
    expect(
      planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" })
    ).toMatchObject({
      // The fee is an expense, so it never shrinks what Fresh Start is owed.
      gcSalesCashPayableBalanceAfterUsd: "1200.00",
      cashOutflowUsd: "612.50",
    });
  });

  it("caps the settlement against the payable without counting the fee", () => {
    const parsed = settlement({ amountUsd: "1800.00", transferFeeUsd: "25.00" });
    expect(
      planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" })
    ).toMatchObject({ gcSalesCashPayableBalanceAfterUsd: "0.00", cashOutflowUsd: "1825.00" });
  });

  it("posts the fee to Shared Charges and the total to the paying account", () => {
    const parsed = settlement({ amountUsd: "600.00", transferFeeUsd: "12.50" });
    const plan = planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" });
    const posting = buildGoldenCoastPhase10SettlementPosting({
      plan,
      gcSalesCashAccountId: 44,
      sharedChargesAccountId: 66,
      settlementDigest: goldenCoastPhase10SettlementDigest({
        settlement: parsed,
        gcSalesCashAccountId: 44,
        sharedChargesAccountId: 66,
      }),
    });

    expect(posting.entries).toHaveLength(3);
    expect(posting.entries[0]).toMatchObject({ ledgerAccountId: 44, debitAmount: "600", creditAmount: "0" });
    expect(posting.entries[1]).toMatchObject({ ledgerAccountId: 66, debitAmount: "12.5", creditAmount: "0" });
    expect(posting.entries[2]).toMatchObject({ bankAccountId: 91, debitAmount: "0", creditAmount: "612.5" });
  });

  it("requires a distinct Shared Charges account whenever a fee is charged", () => {
    const parsed = settlement({ amountUsd: "600.00", transferFeeUsd: "12.50" });
    const plan = planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" });
    const digest = goldenCoastPhase10SettlementDigest({ settlement: parsed, gcSalesCashAccountId: 44 });
    expect(() =>
      buildGoldenCoastPhase10SettlementPosting({ plan, gcSalesCashAccountId: 44, settlementDigest: digest })
    ).toThrow(/sharedChargesAccountId/);
    expect(() =>
      buildGoldenCoastPhase10SettlementPosting({
        plan,
        gcSalesCashAccountId: 44,
        sharedChargesAccountId: 44,
        settlementDigest: digest,
      })
    ).toThrow(/distinct accounts/);
  });

  it("binds replay identity to the transfer fee as well as the amount", () => {
    const base = settlement({ transferFeeUsd: "0" });
    const withFee = settlement({ transferFeeUsd: "12.50" });
    expect(goldenCoastPhase10SettlementDigest({ settlement: base, gcSalesCashAccountId: 44 })).not.toBe(
      goldenCoastPhase10SettlementDigest({ settlement: withFee, gcSalesCashAccountId: 44 })
    );
  });

  it("allows a partial payment and reports the remaining GC Sales Cash payable", () => {
    const parsed = settlement({ amountUsd: "600.00" });
    expect(
      planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" })
    ).toMatchObject({
      gcSalesCashPayableBalanceBeforeUsd: "1800.00",
      gcSalesCashPayableBalanceAfterUsd: "1200.00",
    });
  });

  it("allows an exact full settlement but never over-collects", () => {
    const parsed = settlement({ amountUsd: "1800.00" });
    expect(
      planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1800.00" })
    ).toMatchObject({ gcSalesCashPayableBalanceAfterUsd: "0.00" });
    expect(() =>
      planGoldenCoastPhase10Settlement({ settlement: parsed, gcSalesCashPayableBalanceUsd: "1799.99" })
    ).toThrow(/exceeds the outstanding GC Sales Cash payable/);
  });

  it("treats a zero or overpaid (debit) GC Sales Cash balance as having nothing to settle", () => {
    expect(() =>
      planGoldenCoastPhase10Settlement({
        settlement: settlement({ amountUsd: "1.00" }),
        gcSalesCashPayableBalanceUsd: "0",
      })
    ).toThrow(/payable 0.00/);
    expect(() =>
      planGoldenCoastPhase10Settlement({
        settlement: settlement({ amountUsd: "1.00" }),
        gcSalesCashPayableBalanceUsd: "-50",
      })
    ).toThrow(/payable 0.00/);
  });

  it("posts Dr GC Sales Cash / Cr selected bank through the central posting request", () => {
    const parsed = settlement({ amountUsd: "250.00" });
    const plan = planGoldenCoastPhase10Settlement({
      settlement: parsed,
      gcSalesCashPayableBalanceUsd: "1000.00",
    });
    const digest = goldenCoastPhase10SettlementDigest({
      settlement: parsed,
      gcSalesCashAccountId: 44,
    });
    const posting = buildGoldenCoastPhase10SettlementPosting({
      plan,
      gcSalesCashAccountId: 44,
      settlementDigest: digest,
    });

    expect(posting.source).toEqual({
      sourceType: GOLDEN_COAST_PHASE10_SOURCE_TYPE,
      sourceId: `settlement:${digest}`,
      idempotencyKey: goldenCoastPhase10IdempotencyKey(7, "phase10-test-1"),
    });
    expect(posting.voucher).toMatchObject({ voucherType: "Payment" });
    expect(posting.entries).toHaveLength(2);
    expect(posting.entries[0]).toMatchObject({
      ledgerAccountId: 44,
      debitAmount: "250",
      creditAmount: "0",
    });
    expect(posting.entries[1]).toMatchObject({
      bankAccountId: 91,
      debitAmount: "0",
      creditAmount: "250",
    });
  });

  it("credits a selected Cash/Bank ledger account when the payment target is a ledger", () => {
    const parsed = settlement({ amountUsd: "125.00", receiptAccount: { kind: "ledger", id: 55 } });
    const plan = planGoldenCoastPhase10Settlement({
      settlement: parsed,
      gcSalesCashPayableBalanceUsd: "1000.00",
    });
    const digest = goldenCoastPhase10SettlementDigest({
      settlement: parsed,
      gcSalesCashAccountId: 44,
    });
    const posting = buildGoldenCoastPhase10SettlementPosting({
      plan,
      gcSalesCashAccountId: 44,
      settlementDigest: digest,
    });

    expect(posting.entries[1]).toMatchObject({
      ledgerAccountId: 55,
      debitAmount: "0",
      creditAmount: "125",
    });
    expect(posting.entries[1].bankAccountId).toBeUndefined();
  });

  it("binds idempotency to the material payload, receipt routing and canonical account", () => {
    const base = settlement();
    const digest = goldenCoastPhase10SettlementDigest({ settlement: base, gcSalesCashAccountId: 44 });
    const differentBank = settlement({ receiptAccount: { kind: "bank", id: 92 } });
    const differentReference = settlement({ reference: "Different collection" });

    expect(goldenCoastPhase10SettlementDigest({ settlement: differentBank, gcSalesCashAccountId: 44 })).not.toBe(
      digest
    );
    expect(goldenCoastPhase10SettlementDigest({ settlement: differentReference, gcSalesCashAccountId: 44 })).not.toBe(
      digest
    );
    expect(goldenCoastPhase10SettlementDigest({ settlement: base, gcSalesCashAccountId: 45 })).not.toBe(digest);
    expect(goldenCoastPhase10IdempotencyKey(7, base.clientRequestId)).toContain(base.clientRequestId);
  });
});
