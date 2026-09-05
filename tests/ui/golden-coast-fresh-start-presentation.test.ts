import { describe, expect, it } from "vitest";
import {
  projectGoldenCoastFreshStartAccounts,
  projectGoldenCoastFreshStartStatement,
  resolveGoldenCoastFreshStartPresentation,
} from "../../client/src/pages/accountslegacy/goldenCoastFreshStartPresentation";

describe("Golden Coast Fresh Start Accounts presentation", () => {
  const report = {
    equity: {
      freshStartResidual: 120944.8,
      accounts: [
        {
          id: 2977,
          name: "Fresh Start FZ Equity",
          value: 120944.8,
          balanceSide: "Cr" as const,
        },
        {
          id: 2978,
          name: "Hassan Dakik Equity",
          value: 289242,
          balanceSide: "Cr" as const,
        },
      ],
    },
  };

  it("uses the exact Fresh Start residual shown by Net Position", () => {
    expect(resolveGoldenCoastFreshStartPresentation(report, 2977)).toEqual({
      accountId: 2977,
      amount: 120944.8,
      balanceSide: "Cr",
      signedBalance: -120944.8,
    });
  });

  it("replaces the Accounts Overview Fresh Start value without changing Hassan", () => {
    const presentation = resolveGoldenCoastFreshStartPresentation(report, 2977);
    const accounts = [
      {
        accountId: 2977,
        subType: "gc_partner_capital",
        balance: "42121.00",
        balanceSide: "Cr",
      },
      {
        accountId: 2978,
        subType: "gc_owner_capital",
        balance: "289242.00",
        balanceSide: "Cr",
      },
    ];

    const result = projectGoldenCoastFreshStartAccounts(accounts, presentation);

    expect(result[0]).toMatchObject({ balance: 120944.8, balanceSide: "Cr" });
    expect(result[1]).toEqual(accounts[1]);
  });

  it("makes an empty Fresh Start statement opening and closing equal Net Position", () => {
    const presentation = resolveGoldenCoastFreshStartPresentation(report, 2977);
    const result = projectGoldenCoastFreshStartStatement({
      openingBalance: 207997,
      closingBalance: 207997,
      vouchersWithBalance: [],
      presentation,
    });

    expect(result.openingBalance).toBeCloseTo(-120944.8, 8);
    expect(result.closingBalance).toBeCloseTo(-120944.8, 8);
    expect(result.vouchersWithBalance).toEqual([]);
  });

  it("preserves statement movement while shifting the running presentation to the Net Position residual", () => {
    const presentation = resolveGoldenCoastFreshStartPresentation(report, 2977);
    const rows = [
      { entryId: 1, runningBalance: 207998 },
      { entryId: 2, runningBalance: 207996 },
    ];
    const result = projectGoldenCoastFreshStartStatement({
      openingBalance: 207997,
      closingBalance: 207996,
      vouchersWithBalance: rows,
      presentation,
    });

    expect(result.openingBalance).toBeCloseTo(-120943.8, 8);
    expect(result.vouchersWithBalance[0].runningBalance).toBeCloseTo(-120942.8, 8);
    expect(result.vouchersWithBalance[1].runningBalance).toBeCloseTo(-120944.8, 8);
    expect(result.closingBalance).toBeCloseTo(-120944.8, 8);
    expect(result.vouchersWithBalance[0].runningBalance - result.openingBalance).toBeCloseTo(1, 8);
    expect(result.vouchersWithBalance[1].runningBalance - result.vouchersWithBalance[0].runningBalance).toBeCloseTo(-2, 8);
  });
});
