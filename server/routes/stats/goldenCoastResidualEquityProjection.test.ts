import { describe, expect, it } from "vitest";
import type { AccountBalance } from "../../netPositionHelper";
import { projectGoldenCoastResidualEquity } from "./goldenCoastResidualEquityProjection";

function accounts(
  overrides: {
    hadi?: number;
    hassanCredit?: number;
    tracker?: number;
    cash?: number;
  } = {}
) {
  const hadi = overrides.hadi ?? 165875;
  const tracker = overrides.tracker ?? hadi;
  const cash = overrides.cash ?? 0;
  const rows = [
    {
      id: 1,
      name: "Fresh Start FZ Equity",
      code: "GC-FSCAP",
      accountType: "Equity",
      subType: "gc_partner_capital",
      openingBalance: "207997.00",
      openingBalanceSide: "Dr",
      active: true,
      deletedAt: null,
    },
    {
      id: 2,
      name: "Hassan Dakik Equity",
      code: "GC-HCAP",
      accountType: "Equity",
      subType: "gc_owner_capital",
      openingBalance: "289242.00",
      openingBalanceSide: "Dr",
      active: true,
      deletedAt: null,
    },
    {
      id: 3,
      name: "GC Sales Cash",
      code: "SP-PAY",
      accountType: "Liability",
      subType: "sp_payable",
      openingBalance: tracker.toFixed(2),
      openingBalanceSide: "Cr",
      active: true,
      deletedAt: null,
    },
    {
      id: 4,
      name: "HADI L'SHI — Intercompany",
      code: "SP-HADI-IC",
      accountType: "Intercompany",
      subType: "sp_hadi_intercompany",
      openingBalance: hadi.toFixed(2),
      openingBalanceSide: "Dr",
      active: true,
      deletedAt: null,
    },
  ];
  if (cash > 0) {
    rows.push({
      id: 5,
      name: "GC Cash",
      code: "GC-CASH",
      accountType: "Cash",
      subType: "Cash",
      openingBalance: cash.toFixed(2),
      openingBalanceSide: "Dr",
      active: true,
      deletedAt: null,
    });
  }

  const balances = new Map<number, AccountBalance>();
  if (overrides.hassanCredit) balances.set(2, { debit: 0, credit: overrides.hassanCredit });
  return { rows, balances };
}

function baseBody(input: { tracker: number; cash?: number; stock?: number }) {
  const stock = input.stock ?? 331364;
  const cash = input.cash ?? 0;
  return {
    forUs: {
      total: stock + cash,
      breakdown: [{ name: "Inventory", value: stock }, ...(cash ? [{ name: "Cash", value: cash }] : [])],
      accounts: [
        {
          name: "Stock In Hand / Stock on Floor",
          code: "COMPUTED",
          value: stock,
          category: "Inventory",
        },
        ...(cash
          ? [
              {
                id: 5,
                name: "GC Cash",
                code: "GC-CASH",
                value: cash,
                category: "Cash",
              },
            ]
          : []),
      ],
    },
    onUs: {
      total: input.tracker,
      breakdown: [{ name: "Liability", value: input.tracker }],
      accounts: [
        {
          id: 3,
          name: "GC Sales Cash",
          code: "SP-PAY",
          value: input.tracker,
          category: "Liability",
        },
      ],
    },
    equity: {
      total: 497239,
      accounts: [
        {
          id: 1,
          name: "Fresh Start FZ Equity",
          code: "GC-FSCAP",
          value: 207997,
          balanceSide: "Dr",
        },
        {
          id: 2,
          name: "Hassan Dakik Equity",
          code: "GC-HCAP",
          value: 289242,
          balanceSide: "Dr",
        },
      ],
    },
    netPosition: stock + cash - input.tracker,
    netWorth: stock + cash - input.tracker,
    forUsTotal: stock + cash,
    onUsTotal: input.tracker,
    netPositionBreakdown: {
      assets: { total: stock + cash, breakdown: [] },
      liabilities: { total: input.tracker, breakdown: [] },
      equity: { total: 497239, accounts: [] },
      netPosition: stock + cash - input.tracker,
    },
  };
}

describe("Golden Coast residual equity projection", () => {
  it("matches the 1-Sep balance sheet: Fresh Start = net assets - Hassan", () => {
    const fixture = accounts({ hadi: 165875, tracker: 165875 });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 165875 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.forUs.total).toBe(497239);
    expect(result.onUs.total).toBe(0);
    expect(result.netPosition).toBe(497239);
    expect(result.equity.hassanClaim).toBe(289242);
    expect(result.equity.freshStartResidual).toBe(207997);
    expect(result.equity.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, value: 207997, balanceSide: "Cr" }),
        expect.objectContaining({ id: 2, value: 289242, balanceSide: "Cr" }),
      ])
    );
    expect(result.onUs.accounts.some((account: { id?: number }) => account.id === 3)).toBe(false);
    expect(result.forUs.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 4,
          value: 165875,
          category: "HADI Intercompany",
        }),
      ])
    );
  });

  it("keeps Fresh Start unchanged when value only moves from HADI into GC cash", () => {
    const fixture = accounts({ hadi: 125875, tracker: 165875, cash: 40000 });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 165875, cash: 40000 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.forUs.total).toBe(497239);
    expect(result.equity.freshStartResidual).toBe(207997);
  });

  it("reduces Fresh Start dollar-for-dollar when a real asset leaves and Hassan is unchanged", () => {
    const fixture = accounts({ hadi: 125875, tracker: 125875 });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 125875 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.netPosition).toBe(457239);
    expect(result.equity.hassanClaim).toBe(289242);
    expect(result.equity.freshStartResidual).toBe(167997);
  });

  it("leaves half of a closed profit in Fresh Start after Hassan receives his half", () => {
    const fixture = accounts({
      hadi: 166175,
      tracker: 166175,
      hassanCredit: 150,
    });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 166175 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.netPosition).toBe(497539);
    expect(result.equity.hassanClaim).toBe(289392);
    expect(result.equity.freshStartResidual).toBe(208147);
  });

  it("does nothing to an ordinary Supplier Partner without Golden Coast equity roles", () => {
    const body = baseBody({ tracker: 100 });
    const result = projectGoldenCoastResidualEquity({
      body,
      companyAccounts: [
        {
          id: 3,
          name: "Supplier Cash Payable",
          code: "SP-PAY",
          accountType: "Liability",
          subType: "sp_payable",
          openingBalance: "100",
          openingBalanceSide: "Cr",
          active: true,
          deletedAt: null,
        },
      ],
      accountBalances: new Map(),
    });
    expect(result).toBe(body);
  });
});
