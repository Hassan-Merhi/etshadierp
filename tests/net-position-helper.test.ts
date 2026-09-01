import { describe, expect, it } from "vitest";
import { classifyEquityAccounts, classifyNetPositionAccounts } from "../server/netPositionHelper";

const account = (overrides: Record<string, unknown>) => ({
  id: 1,
  name: "Test account",
  code: "TEST",
  accountType: "Asset",
  openingBalance: "0",
  openingBalanceSide: "Dr",
  ...overrides,
});

describe("net position account classification", () => {
  it("treats the canonical plural Loans type as a liability", () => {
    const result = classifyNetPositionAccounts(
      [account({ id: 2979, name: "Hassan Savings", accountType: "Loans" })],
      new Map([[2979, { debit: 0, credit: 28250 }]])
    );

    expect(result.forUsTotal).toBe(0);
    expect(result.onUsTotal).toBe(28250);
    expect(result.onUsAccounts[0]).toMatchObject({
      id: 2979,
      name: "Hassan Savings",
      value: 28250,
      category: "Loans",
    });
  });

  it("returns equity balances separately without adding them to net position", () => {
    const accounts = [
      account({
        id: 2977,
        name: "Fresh Start FZ Equity",
        accountType: "Equity",
        openingBalance: "207997",
        openingBalanceSide: "Dr",
      }),
      account({
        id: 2978,
        name: "Hassan Dakik Equity",
        accountType: "Equity",
        openingBalance: "289242",
        openingBalanceSide: "Dr",
      }),
    ];
    const balances = new Map<number, { debit: number; credit: number }>();

    const netPosition = classifyNetPositionAccounts(accounts, balances);
    const equity = classifyEquityAccounts(accounts, balances);

    expect(netPosition.forUsTotal).toBe(0);
    expect(netPosition.onUsTotal).toBe(0);
    expect(equity.total).toBe(497239);
    expect(equity.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 2977, value: 207997, balanceSide: "Dr" }),
        expect.objectContaining({ id: 2978, value: 289242, balanceSide: "Dr" }),
      ])
    );
  });
});