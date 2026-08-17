/**
 * Behavioural coverage for the convergence evidence loaders.
 *
 * These three modules decide what counts as authoritative accounting and stock
 * evidence, and every one of them measured 0% covered: the reconciliation tests
 * exercised the reconciler through hand-built snapshots and never went through
 * the loaders that produce them in production. What is asserted here is the
 * fail-closed behaviour — duplicate mirrors, cross-company rows, unbalanced
 * transfer legs and malformed amounts must be rejected rather than aggregated
 * into a clean-looking total.
 */
import { describe, expect, it } from "vitest";
import { loadDatabaseAccountingConvergenceSnapshots } from "../server/services/accounting/databaseConvergenceAdapter";
import { summarizeCanonicalStockTransferEvidence } from "../server/services/inventory/canonicalStockTransferEvidence";
import { loadDatabaseCanonicalStockTransferEvidence } from "../server/services/inventory/databaseCanonicalStockTransferEvidence";

/** A read transaction whose select chain resolves to the supplied rows. */
function selectTx(rows: Record<string, unknown>[]) {
  const query: Record<string, unknown> = {};
  for (const stage of ["from", "innerJoin", "leftJoin", "where", "groupBy"]) {
    query[stage] = () => query;
  }
  query.then = (resolve: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows).then(resolve);
  return {
    select: () => query,
    execute: async () => ({ rows: [] }),
  } as never;
}

/** A transaction whose raw execute resolves to the supplied rows. */
function executeTx(rows: Record<string, unknown>[]) {
  return {
    execute: async () => ({ rows }),
    select: () => ({}) as never,
  } as never;
}

const accountingRow = {
  voucherId: 31,
  companyId: 9,
  voucherType: "Payment",
  voucherTotal: "120.000000",
  ledgerBaseDebit: "120.000000",
  ledgerBaseCredit: "120.000000",
  daybookCount: 1,
  daybookBaseAmount: "120.000000",
};

describe("database accounting convergence snapshots", () => {
  it("treats the voucher total as the document expectation and entries as ledger evidence", async () => {
    const [snapshot] = await loadDatabaseAccountingConvergenceSnapshots({
      tx: selectTx([accountingRow]),
      companyId: 9,
    });

    expect(snapshot).toMatchObject({
      voucherId: 31,
      companyId: 9,
      voucherBaseDebit: "120.000000",
      voucherBaseCredit: "120.000000",
      ledgerBaseDebit: "120.000000",
      ledgerBaseCredit: "120.000000",
      daybookBaseAmount: "120.000000",
      expectsDaybook: true,
    });
  });

  it("expects a Daybook mirror for Payment and Receipt only", async () => {
    const [payment] = await loadDatabaseAccountingConvergenceSnapshots({
      tx: selectTx([accountingRow]),
      companyId: 9,
    });
    const [journal] = await loadDatabaseAccountingConvergenceSnapshots({
      tx: selectTx([{ ...accountingRow, voucherType: "Journal", daybookCount: 0, daybookBaseAmount: null }]),
      companyId: 9,
    });

    expect(payment.expectsDaybook).toBe(true);
    expect(journal.expectsDaybook).toBe(false);
    expect(journal.daybookBaseAmount).toBeNull();
  });

  it("fails closed on a duplicate Daybook mirror instead of hiding it in an aggregate", async () => {
    await expect(
      loadDatabaseAccountingConvergenceSnapshots({
        tx: selectTx([{ ...accountingRow, daybookCount: 2 }]),
        companyId: 9,
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_DUPLICATE_DAYBOOK" });
  });

  it("rejects a row that crossed the requested company boundary", async () => {
    await expect(
      loadDatabaseAccountingConvergenceSnapshots({
        tx: selectTx([{ ...accountingRow, companyId: 10 }]),
        companyId: 9,
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_COMPANY_MISMATCH" });
  });

  it("rejects a malformed monetary amount rather than coercing it", async () => {
    await expect(
      loadDatabaseAccountingConvergenceSnapshots({
        tx: selectTx([{ ...accountingRow, voucherTotal: "   " }]),
        companyId: 9,
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_DATABASE_ROW_INVALID" });
  });
});

const SOURCE_LOCATION = 11;
const DESTINATION_LOCATION = 12;

const issueLeg = {
  companyId: 4,
  sourceType: "stock-transfer",
  sourceId: "77",
  locationId: SOURCE_LOCATION,
  stockItemId: 900,
  quantityDelta: "-5",
  unitCost: "2.5",
};
const receiptLeg = { ...issueLeg, locationId: DESTINATION_LOCATION, quantityDelta: "5" };

describe("canonical stock transfer evidence", () => {
  it("reports the receipt leg once both sides balance", () => {
    const [evidence] = summarizeCanonicalStockTransferEvidence({
      companyId: 4,
      rows: [issueLeg, receiptLeg],
    });

    // Net aggregation would report zero for a transfer; the summariser compares
    // the positive leg and requires the negative one to match it exactly.
    expect(evidence).toMatchObject({
      sourceType: "stock-transfer",
      sourceId: "77",
      companyId: 4,
      movementQuantity: "5",
      movementValue: "12.5",
    });
  });

  it("reports what an edited transfer currently accounts for, not what it ever moved", () => {
    // Ten units posted, then edited down to two. The journal is append-only, so
    // all six rows survive: the original pair, the reversal pair, and the new
    // pair. Summing the positive legs reports 10 + 10 + 2 = 22 against a
    // document of 2, and every edited transfer becomes a false discrepancy.
    const [evidence] = summarizeCanonicalStockTransferEvidence({
      companyId: 4,
      rows: [
        { ...issueLeg, quantityDelta: "-10", unitCost: "3" },
        { ...receiptLeg, quantityDelta: "10", unitCost: "3" },
        { ...receiptLeg, quantityDelta: "-10", unitCost: "3" },
        { ...issueLeg, quantityDelta: "10", unitCost: "3" },
        { ...issueLeg, quantityDelta: "-2", unitCost: "3" },
        { ...receiptLeg, quantityDelta: "2", unitCost: "3" },
      ],
    });

    expect(evidence).toMatchObject({ sourceId: "77", movementQuantity: "2", movementValue: "6" });
  });

  it("keeps two stock items at one location on separate balances", () => {
    // Netting is keyed by location *and* item. Here one item arrives at
    // location 12 while a different item leaves it. Keyed by location alone the
    // two cancel, location 12 nets to nothing, and the transfer reports half
    // the stock it moved. The items are independent balances and stay that way.
    const [evidence] = summarizeCanonicalStockTransferEvidence({
      companyId: 4,
      rows: [
        { ...issueLeg, locationId: 11, stockItemId: 900, quantityDelta: "-10", unitCost: "1" },
        { ...issueLeg, locationId: 12, stockItemId: 900, quantityDelta: "10", unitCost: "1" },
        { ...issueLeg, locationId: 12, stockItemId: 901, quantityDelta: "-10", unitCost: "1" },
        { ...issueLeg, locationId: 13, stockItemId: 901, quantityDelta: "10", unitCost: "1" },
      ],
    });

    expect(evidence.movementQuantity).toBe("20");
  });

  it("rejects a reversal priced differently from the leg it reverses", () => {
    // Quantity nets to zero on both sides, so a quantity-only check sees a
    // clean cancellation. The value does not net, and that is the discrepancy.
    expect(() =>
      summarizeCanonicalStockTransferEvidence({
        companyId: 4,
        rows: [
          { ...issueLeg, quantityDelta: "-5", unitCost: "2" },
          { ...receiptLeg, quantityDelta: "5", unitCost: "2" },
          { ...receiptLeg, quantityDelta: "-5", unitCost: "3" },
          { ...issueLeg, quantityDelta: "5", unitCost: "3" },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_UNBALANCED" }));
  });

  it("rejects a transfer whose legs do not balance", () => {
    expect(() =>
      summarizeCanonicalStockTransferEvidence({
        companyId: 4,
        rows: [issueLeg, { ...receiptLeg, quantityDelta: "4" }],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_UNBALANCED" }));
  });

  it("rejects a lone leg with no counterpart", () => {
    expect(() => summarizeCanonicalStockTransferEvidence({ companyId: 4, rows: [receiptLeg] })).toThrowError(
      expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_UNBALANCED" })
    );
  });

  it("rejects evidence from another company", () => {
    expect(() =>
      summarizeCanonicalStockTransferEvidence({ companyId: 4, rows: [{ ...issueLeg, companyId: 5 }, receiptLeg] })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_COMPANY_MISMATCH" }));
  });

  it("rejects a movement from a different stock domain", () => {
    expect(() =>
      summarizeCanonicalStockTransferEvidence({
        companyId: 4,
        rows: [{ ...issueLeg, sourceType: "stock-adjustment" }, receiptLeg],
      })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_UNEXPECTED_STOCK_EVIDENCE" }));
  });

  it("rejects a zero quantity or a negative unit cost", () => {
    expect(() =>
      summarizeCanonicalStockTransferEvidence({ companyId: 4, rows: [{ ...issueLeg, quantityDelta: "0" }] })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_INVALID" }));
    expect(() =>
      summarizeCanonicalStockTransferEvidence({ companyId: 4, rows: [{ ...issueLeg, unitCost: "-1" }] })
    ).toThrowError(expect.objectContaining({ code: "CONVERGENCE_STOCK_EVIDENCE_INVALID" }));
  });
});

const document = {
  sourceType: "stock-transfer" as const,
  sourceId: "77",
  transferId: 77,
  voucherId: 500,
  companyId: 4,
  documentQuantity: "5",
  documentValue: "12.5",
};

describe("database canonical stock transfer evidence", () => {
  it("returns no evidence when there are no documents to ask about", async () => {
    const evidence = await loadDatabaseCanonicalStockTransferEvidence({
      tx: executeTx([{ ...issueLeg }]),
      companyId: 4,
      documents: [],
    });
    expect(evidence).toEqual([]);
  });

  it("summarises the movements belonging to the requested documents", async () => {
    const [evidence] = await loadDatabaseCanonicalStockTransferEvidence({
      tx: executeTx([issueLeg, receiptLeg]),
      companyId: 4,
      documents: [document],
    });

    expect(evidence).toMatchObject({ sourceId: "77", movementQuantity: "5", movementValue: "12.5" });
  });

  it("rejects a movement the caller never asked about", async () => {
    await expect(
      loadDatabaseCanonicalStockTransferEvidence({
        tx: executeTx([
          { ...issueLeg, sourceId: "99" },
          { ...receiptLeg, sourceId: "99" },
        ]),
        companyId: 4,
        documents: [document],
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_UNEXPECTED_STOCK_EVIDENCE" });
  });

  it("rejects a movement row from another company", async () => {
    await expect(
      loadDatabaseCanonicalStockTransferEvidence({
        tx: executeTx([{ ...issueLeg, companyId: 5 }, receiptLeg]),
        companyId: 4,
        documents: [document],
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_COMPANY_MISMATCH" });
  });

  it("rejects a document set that names the same transfer twice", async () => {
    await expect(
      loadDatabaseCanonicalStockTransferEvidence({
        tx: executeTx([issueLeg, receiptLeg]),
        companyId: 4,
        documents: [document, document],
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_DUPLICATE_SNAPSHOT" });
  });

  it("rejects a document that crossed the requested company boundary", async () => {
    await expect(
      loadDatabaseCanonicalStockTransferEvidence({
        tx: executeTx([issueLeg, receiptLeg]),
        companyId: 4,
        documents: [{ ...document, companyId: 5 }],
      })
    ).rejects.toMatchObject({ code: "CONVERGENCE_COMPANY_MISMATCH" });
  });
});
