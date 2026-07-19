import { describe, expect, it } from "vitest";
import { calculateBalanceSheetTotal, groupBalanceSheetAccounts, type BalanceSheetAccount } from "./balanceSheetModel";

const account = (overrides: Partial<BalanceSheetAccount>): BalanceSheetAccount => ({
  id: "1",
  accountId: 1,
  type: "ledger",
  code: "1000",
  name: "Account",
  balance: 100,
  balanceSide: "Dr",
  active: true,
  ...overrides,
});

describe("balanceSheetModel", () => {
  it("groups supported account types in one pass", () => {
    const groups = groupBalanceSheetAccounts([
      account({ id: "asset", accountType: "Asset" }),
      account({ id: "bank", type: "bank" }),
      account({ id: "supplier", type: "supplier", balanceSide: "Cr" }),
      account({ id: "equity", accountType: "Equity", balanceSide: "Cr" }),
    ]);

    expect(groups.assets.map(({ id }) => id)).toEqual(["asset", "bank"]);
    expect(groups.liabilities.map(({ id }) => id)).toEqual(["supplier"]);
    expect(groups.equity.map(({ id }) => id)).toEqual(["equity"]);
  });

  it("respects the natural debit or credit side when totaling", () => {
    const rows = [
      account({ balance: 125, balanceSide: "Dr" }),
      account({ id: "2", balance: 25, balanceSide: "Cr" }),
    ];

    expect(calculateBalanceSheetTotal(rows, "Dr")).toBe(100);
    expect(calculateBalanceSheetTotal(rows, "Cr")).toBe(-100);
  });
});
