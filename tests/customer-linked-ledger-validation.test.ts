import { describe, expect, it, vi } from "vitest";
import {
  assertCustomerLinkedLedgerPairs,
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
      ]),
    ).toEqual([{ customerId: 10, ledgerAccountId: 20 }]);
  });

  it.each([
    [{ customerId: 0, ledgerAccountId: 20 }],
    [{ customerId: 10.5, ledgerAccountId: 20 }],
    [{ customerId: 10, ledgerAccountId: -1 }],
    [{ customerId: 10, ledgerAccountId: 20.5 }],
  ])("rejects invalid customer-ledger identifiers", (entry) => {
    expect(() =>
      collectCustomerLedgerPairs([{ ...entry, debitAmount: "1", creditAmount: "0" }]),
    ).toThrowError(
      expect.objectContaining<PostingValidationError>({
        code: "POSTING_TARGET_ID_INVALID",
      }),
    );
  });

  it("accepts the exact linked ledger for a company customer", () => {
    expect(() =>
      validateCustomerLedgerPairs(
        [{ customerId: 10, ledgerAccountId: 20 }],
        [{ id: 10, ledgerAccountId: 20 }],
        1,
      ),
    ).not.toThrow();
  });

  it("rejects a customer paired with an unrelated ledger", () => {
    expect(() =>
      validateCustomerLedgerPairs(
        [{ customerId: 10, ledgerAccountId: 99 }],
        [{ id: 10, ledgerAccountId: 20 }],
        1,
      ),
    ).toThrowError(
      expect.objectContaining<PostingValidationError>({
        code: "POSTING_LINKED_LEDGER_MISMATCH",
      }),
    );
  });

  it("rejects a customer that is not owned by the active company", () => {
    expect(() =>
      validateCustomerLedgerPairs([{ customerId: 10, ledgerAccountId: 20 }], [], 2),
    ).toThrowError(
      expect.objectContaining<PostingValidationError>({
        code: "POSTING_TARGET_NOT_OWNED",
      }),
    );
  });

  it("returns without querying when no customer-linked pairs exist", async () => {
    const select = vi.fn();
    await expect(
      assertCustomerLinkedLedgerPairs({
        tx: { select },
        companyId: 1,
        entries: [{ bankAccountId: 30, debitAmount: "1", creditAmount: "0" }],
      }),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("queries unique customers and validates the returned ownership rows", async () => {
    const where = vi.fn().mockResolvedValue([
      { id: 10, ledgerAccountId: 20 },
      { id: 11, ledgerAccountId: 21 },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    await expect(
      assertCustomerLinkedLedgerPairs({
        tx: { select },
        companyId: 1,
        entries: [
          { customerId: 10, ledgerAccountId: 20, debitAmount: "1", creditAmount: "0" },
          { customerId: 10, ledgerAccountId: 20, debitAmount: "0", creditAmount: "1" },
          { customerId: 11, ledgerAccountId: 21, debitAmount: "1", creditAmount: "0" },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
