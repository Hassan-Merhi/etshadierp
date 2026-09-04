import { describe, expect, it } from "vitest";
import { projectGoldenCoastAccountsEquity } from "./golden-coast-equity-presentation";

function baseBody(overrides: { freshBalance?: number; freshSide?: "Dr" | "Cr" } = {}) {
  return {
    accounts: [
      {
        id: "ledger-2977",
        accountId: 2977,
        name: "Fresh Start FZ Equity",
        subType: "gc_partner_capital",
        balance: (overrides.freshBalance ?? 207997).toFixed(2),
        balanceSide: overrides.freshSide ?? "Dr",
        openingBalance: 207997,
        openingBalanceSide: "Dr",
      },
      {
        id: "ledger-2978",
        accountId: 2978,
        name: "Hassan Dakik Equity",
        subType: "gc_owner_capital",
        balance: "289242.00",
        balanceSide: "Dr",
        openingBalance: 289242,
        openingBalanceSide: "Dr",
      },
      {
        id: "ledger-2969",
        accountId: 2969,
        name: "GC Sales Cash",
        subType: "sp_payable",
        balance: "165875.00",
        balanceSide: "Cr",
        openingBalance: 165875,
        openingBalanceSide: "Cr",
      },
    ],
    asOfDate: "2026-09-04",
  };
}

describe("Golden Coast Accounts Overview equity presentation", () => {
  it("matches the Phase 17 Net Position Fresh Start residual instead of showing the raw Dr opening", () => {
    const result = projectGoldenCoastAccountsEquity(baseBody());
    const fresh = result.accounts.find((row: any) => row.subType === "gc_partner_capital");
    const hassan = result.accounts.find((row: any) => row.subType === "gc_owner_capital");

    expect(fresh).toMatchObject({ balance: "42122.00", balanceSide: "Cr" });
    expect(hassan).toMatchObject({ balance: "289242.00", balanceSide: "Cr" });
  });

  it("preserves live Fresh Start debit/credit movements while applying the one-time legacy payable reclassification", () => {
    // A $1 debit after cutover makes the raw Accounts balance 207,998 Dr,
    // while the credit-normal Net Position claim correctly becomes 42,121 Cr.
    const result = projectGoldenCoastAccountsEquity(baseBody({ freshBalance: 207998, freshSide: "Dr" }));
    const fresh = result.accounts.find((row: any) => row.subType === "gc_partner_capital");

    expect(fresh).toMatchObject({ balance: "42121.00", balanceSide: "Cr" });
  });

  it("does not alter ordinary non-Golden-Coast account lists", () => {
    const body = {
      accounts: [
        {
          id: "ledger-1",
          accountId: 1,
          name: "Partner Equity",
          subType: "partner_capital",
          balance: "500.00",
          balanceSide: "Cr",
          openingBalance: 500,
          openingBalanceSide: "Cr",
        },
      ],
    };

    expect(projectGoldenCoastAccountsEquity(body)).toBe(body);
  });
});
