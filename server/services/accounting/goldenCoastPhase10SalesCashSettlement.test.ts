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
      paymentAccount: { kind: "bank", id: 91 },
      reference: "Direct Fresh Start payment",
      ...overrides,
    },
  });
}

describe("Golden Coast Phase 10 direct Fresh Start payment", () => {
  it("parses a post-cutover partial payment payload", () => {
    expect(settlement()).toEqual({
      companyId: 7,
      settlementDate: "2026-09-01",
      amountUsd: "600.00",
      clientRequestId: "phase10-test-1",
      paymentAccount: { kind: "bank", id: 91 },
      reference: "Direct Fresh Start payment",
    });
  });

  it("accepts receiptAccount as a legacy alias but normalizes it to paymentAccount", () => {
    const parsed = settlement({
      paymentAccount: undefined,
      receiptAccount: { kind: "ledger", id: 55 },
    });
    expect(parsed.paymentAccount).toEqual({ kind: "ledger", id: 55 });
  });

  it("rejects pre-cutover dates, invalid request ids and sub-cent amounts", () => {
    expect(() => settlement({ settlementDate: "2026-08-31" })).toThrow(/cutover date/);
    expect(() => settlement({ clientRequestId: "bad request" })).toThrow(GoldenCoastPhase10SettlementError);
    expect(() => settlement({ amountUsd: "1.001" })).toThrow(/at most 2 decimal places/);
  });

  it("allows a partial payment against a credit GC Sales Cash payable", () => {
    const parsed = settlement({ amountUsd: "600.00" });
    expect(
      planGoldenCoastPhase10Settlement({
        settlement: parsed,
        gcSalesCashDebitBalanceUsd: "-1800.00",
      })
    ).toMatchObject({
      gcSalesCashDebitBalanceBeforeUsd: "-1800.00",
      gcSalesCashDebitBalanceAfterUsd: "-1200.00",
      gcSalesCashPayableBeforeUsd: "1800.00",
      gcSalesCashPayableAfterUsd: "1200.00",
    });
  });

  it("allows an exact full payment but never overpays", () => {
    const parsed = settlement({ amountUsd: "1800.00" });
    expect(
      planGoldenCoastPhase10Settlement({
        settlement: parsed,
        gcSalesCashDebitBalanceUsd: "-1800.00",
      })
    ).toMatchObject({
      gcSalesCashDebitBalanceAfterUsd: "0.00",
      gcSalesCashPayableAfterUsd: "0.00",
    });
    expect(() =>
      planGoldenCoastPhase10Settlement({
        settlement: parsed,
        gcSalesCashDebitBalanceUsd: "-1799.99",
      })
    ).toThrow(/exceeds the current GC Sales Cash payable/);
  });

  it("treats a zero or debit GC Sales Cash balance as having nothing payable", () => {
    expect(() =>
      planGoldenCoastPhase10Settlement({
        settlement: settlement({ amountUsd: "1.00" }),
        gcSalesCashDebitBalanceUsd: "0",
      })
    ).toThrow(/payable 0.00/);
    expect(() =>
      planGoldenCoastPhase10Settlement({
        settlement: settlement({ amountUsd: "1.00" }),
        gcSalesCashDebitBalanceUsd: "50",
      })
    ).toThrow(/payable 0.00/);
  });

  it("posts Dr GC Sales Cash / Cr selected bank through the central posting request", () => {
    const parsed = settlement({ amountUsd: "250.00" });
    const plan = planGoldenCoastPhase10Settlement({
      settlement: parsed,
      gcSalesCashDebitBalanceUsd: "-1000.00",
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
    expect(posting.voucher.voucherType).toBe("Payment");
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

  it("credits a selected Cash/Bank ledger account when the payment source is a ledger", () => {
    const parsed = settlement({
      amountUsd: "125.00",
      paymentAccount: { kind: "ledger", id: 55 },
    });
    const plan = planGoldenCoastPhase10Settlement({
      settlement: parsed,
      gcSalesCashDebitBalanceUsd: "-1000.00",
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

  it("binds idempotency to the material payload, payment routing and canonical account", () => {
    const base = settlement();
    const digest = goldenCoastPhase10SettlementDigest({
      settlement: base,
      gcSalesCashAccountId: 44,
    });
    const differentBank = settlement({
      paymentAccount: { kind: "bank", id: 92 },
    });
    const differentReference = settlement({ reference: "Different payment" });

    expect(
      goldenCoastPhase10SettlementDigest({
        settlement: differentBank,
        gcSalesCashAccountId: 44,
      })
    ).not.toBe(digest);
    expect(
      goldenCoastPhase10SettlementDigest({
        settlement: differentReference,
        gcSalesCashAccountId: 44,
      })
    ).not.toBe(digest);
    expect(
      goldenCoastPhase10SettlementDigest({
        settlement: base,
        gcSalesCashAccountId: 45,
      })
    ).not.toBe(digest);
    expect(goldenCoastPhase10IdempotencyKey(7, base.clientRequestId)).toContain(base.clientRequestId);
  });
});
