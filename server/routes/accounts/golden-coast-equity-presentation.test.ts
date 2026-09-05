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
        active: true,
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
        active: true,
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
        active: true,
      },
    ],
    asOfDate: "2026-09-04",
  };
}

describe("Golden Coast Accounts Overview equity presentation", () => {
  it("matches the Phase 17 Net Position Fresh Start residual instead of showing the raw Dr opening", () => {
    const result = projectGoldenCoastAccountsEquity(baseBody());
    const rows = result.accounts as any[];
    const fresh = rows.find((row) => row.subType === "gc_partner_capital");
    const hassan = rows.find((row) => row.subType === "gc_owner_capital");

    expect(fresh).toMatchObject({ balance: "42122.00", balanceSide: "Cr" });
    expect(hassan).toMatchObject({ balance: "289242.00", balanceSide: "Cr" });
  });

  it("preserves live Fresh Start debit/credit movements while applying the one-time legacy payable reclassification", () => {
    // A $1 debit after cutover makes the raw Accounts balance 207,998 Dr,
    // while the credit-normal Net Position claim correctly becomes 42,121 Cr.
    const result = projectGoldenCoastAccountsEquity(baseBody({ freshBalance: 207998, freshSide: "Dr" }));
    const rows = result.accounts as any[];
    const fresh = rows.find((row) => row.subType === "gc_partner_capital");

    expect(fresh).toMatchObject({ balance: "42121.00", balanceSide: "Cr" });
  });

  it("ignores inactive or deleted duplicate Golden Coast role rows and projects only the active ledgers", () => {
    const body = baseBody();
    body.accounts.unshift(
      {
        id: "ledger-old-fresh",
        accountId: 1001,
        name: "Fresh Start FZ Equity (Old)",
        subType: "gc_partner_capital",
        balance: "999999.00",
        balanceSide: "Dr",
        openingBalance: 999999,
        openingBalanceSide: "Dr",
        active: false,
      },
      {
        id: "ledger-old-hassan",
        accountId: 1002,
        name: "Hassan Dakik Equity (Deleted)",
        subType: "gc_owner_capital",
        balance: "888888.00",
        balanceSide: "Dr",
        openingBalance: 888888,
        openingBalanceSide: "Dr",
        active: true,
        deletedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "ledger-old-payable",
        accountId: 1003,
        name: "GC Sales Cash",
        subType: "sp_payable",
        balance: "777777.00",
        balanceSide: "Cr",
        openingBalance: 777777,
        openingBalanceSide: "Cr",
        active: false,
      }
    );

    const result = projectGoldenCoastAccountsEquity(body);
    const rows = result.accounts as any[];
    const activeFresh = rows.find((row) => row.accountId === 2977);
    const activeHassan = rows.find((row) => row.accountId === 2978);
    const inactiveFresh = rows.find((row) => row.accountId === 1001);
    const deletedHassan = rows.find((row) => row.accountId === 1002);

    expect(activeFresh).toMatchObject({ balance: "42122.00", balanceSide: "Cr" });
    expect(activeHassan).toMatchObject({ balance: "289242.00", balanceSide: "Cr" });
    expect(inactiveFresh).toMatchObject({ balance: "999999.00", balanceSide: "Dr" });
    expect(deletedHassan).toMatchObject({ balance: "888888.00", balanceSide: "Dr" });
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
