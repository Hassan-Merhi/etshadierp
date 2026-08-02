import { describe, expect, it } from "vitest";

import {
  calculateAbsoluteTotal,
  calculatePLTotal,
  calculateTotal,
  formatCurrency,
  formatSmartCurrency,
  groupAccountsByParent,
  parseBalance,
  signedBalance,
} from "@/pages/analyticslegacy/accountMath";
import type { Account } from "@/pages/analyticslegacy/types";

/**
 * These functions lived as closures inside the Analytics component, so the only
 * thing that ever exercised them was rendering the page. The hierarchical
 * deduplication in particular is easy to get wrong in a way no snapshot would
 * catch - a parent counted alongside its children double-counts the money.
 */
const account = (over: Partial<Account> & Pick<Account, "accountId">): Account =>
  ({
    name: `Account ${over.accountId}`,
    balance: 0,
    balanceSide: "Dr",
    parentId: null,
    ...over,
  }) as Account;

describe("analytics account math", () => {
  it("reads balances from either numbers or numeric strings", () => {
    expect(parseBalance(12.5)).toBe(12.5);
    expect(parseBalance("12.5")).toBe(12.5);
    expect(parseBalance("not a number")).toBe(0);
    expect(parseBalance(0)).toBe(0);
  });

  it("signs Cr positive and Dr negative", () => {
    expect(signedBalance(account({ accountId: 1, balance: 100, balanceSide: "Cr" }))).toBe(100);
    expect(signedBalance(account({ accountId: 2, balance: 100, balanceSide: "Dr" }))).toBe(-100);
  });

  it("treats an account whose parent is absent from the list as a root", () => {
    const { parentAccounts, accountMap } = groupAccountsByParent([
      account({ accountId: 1 }),
      account({ accountId: 2, parentId: 1 }),
      // parent 99 is not in this list, so 3 stands on its own
      account({ accountId: 3, parentId: 99 }),
    ]);

    expect(parentAccounts.map((a) => a.accountId)).toEqual([1, 3]);
    expect(accountMap.get(1)?.map((a) => a.accountId)).toEqual([2]);
    expect(accountMap.has(99)).toBe(false);
  });

  it("counts a parent's children instead of the parent, never both", () => {
    const accounts = [
      // parent's own balance is deliberately wrong to prove it is not used
      account({ accountId: 1, balance: 999, balanceSide: "Cr" }),
      account({ accountId: 2, parentId: 1, balance: 30, balanceSide: "Cr" }),
      account({ accountId: 3, parentId: 1, balance: 20, balanceSide: "Cr" }),
      account({ accountId: 4, balance: 5, balanceSide: "Cr" }),
    ];

    expect(calculateTotal(accounts)).toBe(55);
    expect(calculateAbsoluteTotal(accounts)).toBe(55);
  });

  it("uses absolute values for the absolute total and signed ones otherwise", () => {
    const accounts = [
      account({ accountId: 1, balance: 100, balanceSide: "Cr" }),
      account({ accountId: 2, balance: 40, balanceSide: "Dr" }),
    ];

    expect(calculateTotal(accounts)).toBe(60);
    expect(calculateAbsoluteTotal(accounts)).toBe(140);
  });

  it("sums P&L sections flat, without deduplication", () => {
    // Same parent/child shape as above, but P&L sections are flat so both count.
    expect(
      calculatePLTotal([
        account({ accountId: 1, balance: 100, balanceSide: "Cr" }),
        account({ accountId: 2, parentId: 1, balance: 30, balanceSide: "Dr" }),
      ])
    ).toBe(70);
  });

  it("drops decimals on whole amounts and always formats the magnitude", () => {
    expect(formatCurrency(1500)).toBe("$1,500");
    expect(formatCurrency(1500.5)).toBe("$1,500.50");
    expect(formatCurrency(-1500)).toBe("$1,500");

    expect(formatSmartCurrency(1500)).toBe("$1,500");
    expect(formatSmartCurrency(1500.5)).toBe("$1,500.50");
    expect(formatSmartCurrency(-1500.5)).toBe("$1,500.50");
  });
});
