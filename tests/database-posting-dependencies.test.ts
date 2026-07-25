import { describe, expect, it } from "vitest";
import { collectPostingTargetIds } from "../server/services/accounting/databasePostingDependencies";
import { PostingValidationError } from "../server/services/accounting/centralPostingEngine";

describe("collectPostingTargetIds", () => {
  it("groups and de-duplicates accounting targets", () => {
    expect(
      collectPostingTargetIds([
        { ledgerAccountId: 10, debitAmount: "50", creditAmount: "0" },
        { bankAccountId: 20, debitAmount: "0", creditAmount: "50" },
        { ledgerAccountId: 10, debitAmount: "5", creditAmount: "0" },
        { customerId: 30, debitAmount: "0", creditAmount: "5" },
      ])
    ).toEqual({
      ledgerAccountId: [10],
      bankAccountId: [20],
      fixedAssetId: [],
      supplierId: [],
      employeeId: [],
      customerId: [30],
      factorySupplierId: [],
    });
  });

  it("rejects invalid target identifiers before database access", () => {
    expect(() =>
      collectPostingTargetIds([
        { ledgerAccountId: 0, debitAmount: "10", creditAmount: "0" },
        { bankAccountId: 2, debitAmount: "0", creditAmount: "10" },
      ])
    ).toThrowError(expect.objectContaining<PostingValidationError>({ code: "POSTING_TARGET_ID_INVALID" }));
  });
});
