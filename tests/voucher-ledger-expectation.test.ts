/**
 * Per-type ledger expectations for convergence reconciliation.
 *
 * The reconciliation began with one rule for every voucher — debits equal
 * credits and each side equals the document total — and two types broke it
 * immediately: Stock Transfer posts no ledger entry at all, and Stock
 * Adjustment posts exactly one because the contra side is inventory, which is
 * not a ledger account here. Both were excluded by name, which works right up
 * until a third type appears and nobody notices.
 *
 * These tests pin the classification and, more importantly, pin what happens to
 * a type nobody classified: it is reported, not skipped.
 */
import { describe, expect, it } from "vitest";
import {
  classifiedVoucherTypes,
  classifyVoucherLedgerExpectation,
} from "../server/services/accounting/voucherLedgerExpectation";
import {
  reconcileConvergenceTx,
  type AccountingConvergenceSnapshot,
} from "../server/services/accounting/convergenceReconciliation";

const tx = { execute: async () => ({ rows: [] }) } as never;

function adapterFor(accounting: AccountingConvergenceSnapshot[]) {
  return {
    loadAccountingSnapshots: async () => accounting,
    loadStockSnapshots: async () => [],
  };
}

function snapshot(overrides: Partial<AccountingConvergenceSnapshot>): AccountingConvergenceSnapshot {
  return {
    voucherId: 1,
    companyId: 7,
    voucherBaseDebit: "50",
    voucherBaseCredit: "50",
    ledgerBaseDebit: "50",
    ledgerBaseCredit: "50",
    daybookBaseAmount: null,
    expectsDaybook: false,
    ...overrides,
  };
}

describe("voucher ledger expectations", () => {
  it("classifies the types that post a balanced double entry", () => {
    for (const type of ["Journal", "Payment", "Receipt", "Sales", "Purchase", "Credit Note", "Debit Note"]) {
      expect(classifyVoucherLedgerExpectation(type)).toBe("balanced");
    }
  });

  it("classifies the inventory documents that post one side or none", () => {
    // The contra side of an adjustment is inventory, not a ledger account.
    expect(classifyVoucherLedgerExpectation("Stock Adjustment")).toBe("single-sided");
    // Waste is dispatched as an adjustment under this voucher type.
    expect(classifyVoucherLedgerExpectation("Consumption")).toBe("single-sided");
    for (const type of ["Stock Transfer", "StockTransfer", "Transfer"]) {
      expect(classifyVoucherLedgerExpectation(type)).toBe("none");
    }
  });

  it("treats an unknown or empty type as unclassified rather than harmless", () => {
    expect(classifyVoucherLedgerExpectation("Some New Voucher")).toBe("unclassified");
    expect(classifyVoucherLedgerExpectation("")).toBe("unclassified");
    expect(classifyVoucherLedgerExpectation(null)).toBe("unclassified");
    expect(classifiedVoucherTypes()).not.toContain("Some New Voucher");
  });
});

describe("reconciliation by ledger expectation", () => {
  it("still checks both sides of a balanced voucher", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({ voucherId: 11, ledgerExpectation: "balanced", ledgerBaseCredit: "40" }),
      ])
    );

    expect(result.clean).toBe(false);
    expect(result.discrepancies.map((entry) => entry.code)).toContain("VOUCHER_LEDGER_CREDIT_MISMATCH");
  });

  it("does not demand ledger evidence from a document that posts none", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({
          voucherId: 12,
          ledgerExpectation: "none",
          ledgerBaseDebit: "0",
          ledgerBaseCredit: "0",
        }),
      ])
    );

    // A stock transfer's convergence is checked on the stock side; reporting it
    // here would flag every transfer ever made.
    expect(result.discrepancies).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("accepts a single-sided posting on either side", async () => {
    const credited = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({ voucherId: 13, ledgerExpectation: "single-sided", ledgerBaseDebit: "0", ledgerBaseCredit: "50" }),
      ])
    );
    const debited = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({ voucherId: 14, ledgerExpectation: "single-sided", ledgerBaseDebit: "50", ledgerBaseCredit: "0" }),
      ])
    );

    expect(credited.discrepancies).toEqual([]);
    expect(debited.discrepancies).toEqual([]);
  });

  it("reports a single-sided type that posted both sides or neither", async () => {
    const both = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({ voucherId: 15, ledgerExpectation: "single-sided", ledgerBaseDebit: "50", ledgerBaseCredit: "50" }),
      ])
    );
    const neither = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({ voucherId: 16, ledgerExpectation: "single-sided", ledgerBaseDebit: "0", ledgerBaseCredit: "0" }),
      ])
    );

    // Exempting a type from the balance rule is not the same as exempting it
    // from every rule: it still has to post the one entry it claims to.
    expect(both.discrepancies.map((entry) => entry.code)).toContain("SINGLE_SIDED_LEDGER_INVALID");
    expect(neither.discrepancies.map((entry) => entry.code)).toContain("SINGLE_SIDED_LEDGER_INVALID");
  });

  it("reports an unclassified voucher type instead of skipping it", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([snapshot({ voucherId: 17, ledgerExpectation: "unclassified" })])
    );

    // Without this a new posting path could be added and never reconciled
    // against anything, which is the failure the whole report exists to catch.
    expect(result.clean).toBe(false);
    expect(result.discrepancies.map((entry) => entry.code)).toContain("VOUCHER_TYPE_UNCLASSIFIED");
  });

  it("reports a cancelled voucher whose Daybook mirror outlived it", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({
          voucherId: 19,
          voucherCancelled: true,
          expectsDaybook: true,
          daybookBaseAmount: "50",
        }),
      ])
    );

    expect(result.clean).toBe(false);
    expect(result.discrepancies.map((entry) => entry.code)).toContain("CANCELLED_VOUCHER_DAYBOOK_MIRROR");
  });

  it("does not judge the ledger entries a cancelled voucher keeps as history", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([
        snapshot({
          voucherId: 20,
          voucherCancelled: true,
          expectsDaybook: true,
          ledgerBaseDebit: "0",
          ledgerBaseCredit: "0",
        }),
      ])
    );

    // The document no longer stands, so comparing entries against it would
    // report every cancellation ever made as a defect.
    expect(result.discrepancies).toEqual([]);
  });

  it("defaults an adapter that states no expectation to the balanced rule", async () => {
    const result = await reconcileConvergenceTx(
      tx,
      7,
      adapterFor([snapshot({ voucherId: 18, ledgerBaseDebit: "10" })])
    );

    expect(result.discrepancies.map((entry) => entry.code)).toContain("VOUCHER_LEDGER_DEBIT_MISMATCH");
  });
});
