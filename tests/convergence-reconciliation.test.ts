import { describe, expect, it, vi } from "vitest";
import {
  ConvergenceReconciliationError,
  reconcileConvergenceTx,
  type ConvergenceReconciliationAdapter,
} from "../server/services/accounting/convergenceReconciliation";

function txStub() {
  return { execute: vi.fn().mockResolvedValue(undefined) };
}

function adapter(input?: Partial<ConvergenceReconciliationAdapter>): ConvergenceReconciliationAdapter {
  return {
    loadAccountingSnapshots: async () => [],
    loadStockSnapshots: async () => [],
    ...input,
  };
}

describe("reconcileConvergenceTx", () => {
  it("reports exact decimal accounting, Daybook, stock quantity, and stock value mismatches without repairing data", async () => {
    const result = await reconcileConvergenceTx(
      txStub(),
      7,
      adapter({
        loadAccountingSnapshots: async () => [
          {
            voucherId: 101,
            companyId: 7,
            voucherBaseDebit: "10.000001",
            voucherBaseCredit: "10.000001",
            ledgerBaseDebit: "10.000000",
            ledgerBaseCredit: "10.000001",
            daybookBaseAmount: "9.999999",
            expectsDaybook: true,
          },
        ],
        loadStockSnapshots: async () => [
          {
            sourceType: "stock-transfer",
            sourceId: "501",
            companyId: 7,
            documentQuantity: "3.000001",
            movementQuantity: "3.000000",
            documentValue: "18.000006",
            movementValue: "18.000000",
          },
        ],
      })
    );

    expect(result.clean).toBe(false);
    expect(result.discrepancies.map((row) => row.code)).toEqual([
      "VOUCHER_LEDGER_DEBIT_MISMATCH",
      "LEDGER_NOT_BALANCED",
      "DAYBOOK_AMOUNT_MISMATCH",
      "STOCK_QUANTITY_MISMATCH",
      "STOCK_VALUE_MISMATCH",
    ]);
  });

  it("fails closed when an adapter returns a cross-company accounting snapshot", async () => {
    await expect(
      reconcileConvergenceTx(
        txStub(),
        7,
        adapter({
          loadAccountingSnapshots: async () => [
            {
              voucherId: 101,
              companyId: 8,
              voucherBaseDebit: "1",
              voucherBaseCredit: "1",
              ledgerBaseDebit: "1",
              ledgerBaseCredit: "1",
              daybookBaseAmount: null,
              expectsDaybook: false,
            },
          ],
        })
      )
    ).rejects.toMatchObject({ code: "CONVERGENCE_COMPANY_MISMATCH" });
  });

  it("rejects duplicate authoritative snapshots instead of double-counting reconciliation evidence", async () => {
    const duplicate = {
      voucherId: 101,
      companyId: 7,
      voucherBaseDebit: "1",
      voucherBaseCredit: "1",
      ledgerBaseDebit: "1",
      ledgerBaseCredit: "1",
      daybookBaseAmount: null,
      expectsDaybook: false,
    };

    await expect(
      reconcileConvergenceTx(
        txStub(),
        7,
        adapter({ loadAccountingSnapshots: async () => [duplicate, duplicate] })
      )
    ).rejects.toMatchObject({ code: "CONVERGENCE_DUPLICATE_SNAPSHOT" });
  });

  it("requires both stock source identity components and flags unexpected Daybook mirrors", async () => {
    const result = await reconcileConvergenceTx(
      txStub(),
      7,
      adapter({
        loadAccountingSnapshots: async () => [
          {
            voucherId: 201,
            companyId: 7,
            voucherBaseDebit: "5",
            voucherBaseCredit: "5",
            ledgerBaseDebit: "5",
            ledgerBaseCredit: "5",
            daybookBaseAmount: "5",
            expectsDaybook: false,
          },
        ],
      })
    );
    expect(result.discrepancies).toEqual([
      {
        domain: "accounting",
        identity: "voucher:201",
        code: "DAYBOOK_UNEXPECTED",
        expected: "missing",
        actual: "5",
      },
    ]);

    await expect(
      reconcileConvergenceTx(
        txStub(),
        7,
        adapter({
          loadStockSnapshots: async () => [
            {
              sourceType: "",
              sourceId: "501",
              companyId: 7,
              documentQuantity: "1",
              movementQuantity: "1",
              documentValue: "1",
              movementValue: "1",
            },
          ],
        })
      )
    ).rejects.toBeInstanceOf(ConvergenceReconciliationError);
  });
});
