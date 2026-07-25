import { describe, expect, it } from "vitest";
import {
  collectCustomerLedgerPairs,
  validateCustomerLedgerPairs,
} from "../server/services/accounting/customerLinkedLedgerValidation";
import { PostingValidationError } from "../server/services/accounting/centralPostingEngine";

describe("customer linked-ledger validation", () => {
  it("collects and de-duplicates customer-ledger pairs", () => {
    expect(
      collectCustomerLedgerPairs([
        { customerId: 10, ledgerAccountId: 20, debitAmount: "1", creditAmount: "0" },
        { customerId: 10, ledgerAccountId: 20, debitAmount: "0", creditAmount: "1" },
        { bankAccountId: 30, debitAmount: "0", creditAmount: "1" },
      ])
    ).toEqual([{ customerId: 10, ledgerAccountId: 20 }]);
  });

  it("accepts the exact linked ledger for a company customer", () => {
    expect(() =>
      validateCustomerLedgerPairs(
        [{ customerId: 10, ledgerAccountId: 20 }],
        [{ id: 10, ledgerAccountId: 20 }],
        1
      )
    ).not.toThrow();
  });

  it("rejects a customer paired with an unrelated ledger", () => {
    expect(() =>
      validateCustomerLedgerPairs(
        [{ customerId: 10, ledgerAccountId: 99 }],
        [{ id: 10, ledgerAccountId: 20 }],
        1
      )
    ).toThrowError(
      expect.objectContaining<PostingValidationError>({
        code: "POSTING_LINKED_LEDGER_MISMATCH",
      })
    );
  });

  it("rejects a customer that is not owned by the active company", () => {
    expect(() =>
      validateCustomerLedgerPairs(
        [{ customerId: 10, ledgerAccountId: 20 }],
        [],
        2
      )
    ).toThrowError(
      expect.objectContaining<PostingValidationError>({
        code: "POSTING_TARGET_NOT_OWNED",
      })
    );
  });
});
