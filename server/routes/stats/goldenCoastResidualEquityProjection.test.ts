import { describe, expect, it } from "vitest";
import type { AccountBalance } from "../../netPositionHelper";
import { projectGoldenCoastResidualEquity } from "./goldenCoastResidualEquityProjection";

const OPENING_GC_SALES_CASH = 165875;

function accounts(
  overrides: {
    hadi?: number;
    cash?: number;
    freshDebit?: number;
    freshCredit?: number;
    hassanDebit?: number;
    hassanCredit?: number;
    gcSalesDebit?: number;
    gcSalesCredit?: number;
  } = {}
) {
  const hadi = overrides.hadi ?? OPENING_GC_SALES_CASH;
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
      openingBalance: OPENING_GC_SALES_CASH.toFixed(2),
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
  const freshDebit = overrides.freshDebit ?? 0;
  const freshCredit = overrides.freshCredit ?? 0;
  const hassanDebit = overrides.hassanDebit ?? 0;
  const hassanCredit = overrides.hassanCredit ?? 0;
  const gcSalesDebit = overrides.gcSalesDebit ?? 0;
  const gcSalesCredit = overrides.gcSalesCredit ?? 0;
  if (freshDebit || freshCredit) balances.set(1, { debit: freshDebit, credit: freshCredit });
  if (hassanDebit || hassanCredit) balances.set(2, { debit: hassanDebit, credit: hassanCredit });
  if (gcSalesDebit || gcSalesCredit) balances.set(3, { debit: gcSalesDebit, credit: gcSalesCredit });
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
        { name: "Stock In Hand / Stock on Floor", code: "COMPUTED", value: stock, category: "Inventory" },
        ...(cash ? [{ id: 5, name: "GC Cash", code: "GC-CASH", value: cash, category: "Cash" }] : []),
      ],
    },
    onUs: {
      total: input.tracker,
      breakdown: [{ name: "Liability", value: input.tracker }],
      accounts: [{ id: 3, name: "GC Sales Cash", code: "SP-PAY", value: input.tracker, category: "Liability" }],
    },
    equity: {
      total: 497239,
      accounts: [
        { id: 1, name: "Fresh Start FZ Equity", code: "GC-FSCAP", value: 207997, balanceSide: "Dr" },
        { id: 2, name: "Hassan Dakik Equity", code: "GC-HCAP", value: 289242, balanceSide: "Dr" },
      ],
      includedInNetPosition: true,
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

describe("Golden Coast Phase 17 balance-sheet projection", () => {
  it("counts the opening GC Sales Cash credit as a real liability without double-counting Fresh Start", () => {
    const fixture = accounts();
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: OPENING_GC_SALES_CASH }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.forUs.total).toBe(497239);
    expect(result.onUs.total).toBe(165875);
    expect(result.netPosition).toBe(331364);
    expect(result.equity.total).toBe(331364);
    expect(result.equity.includedInNetPosition).toBe(false);
    expect(result.equity.balanceSheetIdentity).toBe("assets_minus_liabilities_equals_equity");
    expect(result.equity.legacyOpeningPayableReclassification).toBe(165875);
    expect(result.equity.freshStartClaim).toBe(42122);
    expect(result.equity.hassanClaim).toBe(289242);
    expect(result.equity.unclosedEarnings).toBe(0);
    expect(result.equity.freshStartTotalEntitlement).toBe(207997);
    expect(result.onUs.accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 3, value: 165875, category: "Liability" })])
    );
    expect(result.forUs.accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 4, value: 165875, category: "HADI Intercompany" })])
    );
  });

  it("shows a post-Phase-15 sale as payable plus unclosed earnings without distributing profit to either partner", () => {
    const fixture = accounts({
      hadi: 166875,
      freshDebit: 1000,
      gcSalesCredit: 1000,
    });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 166875, stock: 330764 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.forUs.total).toBe(497639);
    expect(result.onUs.total).toBe(166875);
    expect(result.netPosition).toBe(330764);
    expect(result.equity.freshStartClaim).toBe(41122);
    expect(result.equity.hassanClaim).toBe(289242);
    expect(result.equity.partnerCapitalTotal).toBe(330364);
    expect(result.equity.unclosedEarnings).toBe(400);
    expect(result.equity.total).toBe(330764);
    expect(result.equity.freshStartTotalEntitlement).toBe(207997);
    expect(result.equity.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, value: 41122, balanceSide: "Cr" }),
        expect.objectContaining({ id: 2, value: 289242, balanceSide: "Cr" }),
        expect.objectContaining({ code: "GC-UNCL-PNL", value: 400, balanceSide: "Cr" }),
      ])
    );
  });

  it("keeps partner equity unchanged when HADI pays an existing Fresh Start payable", () => {
    const fixture = accounts({
      hadi: 164875,
      gcSalesDebit: 1000,
    });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 164875 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.forUs.total).toBe(496239);
    expect(result.onUs.total).toBe(164875);
    expect(result.netPosition).toBe(331364);
    expect(result.equity.freshStartClaim).toBe(42122);
    expect(result.equity.hassanClaim).toBe(289242);
    expect(result.equity.unclosedEarnings).toBe(0);
    expect(result.equity.freshStartTotalEntitlement).toBe(206997);
  });

  it("moves unclosed profit into the two partner ledgers only after the Phase 11 50/50 close", () => {
    const fixture = accounts({
      hadi: 166875,
      freshDebit: 1000,
      freshCredit: 200,
      hassanCredit: 200,
      gcSalesCredit: 1000,
    });
    const result = projectGoldenCoastResidualEquity({
      body: baseBody({ tracker: 166875, stock: 330764 }),
      companyAccounts: fixture.rows,
      accountBalances: fixture.balances,
    });

    expect(result.netPosition).toBe(330764);
    expect(result.equity.freshStartClaim).toBe(41322);
    expect(result.equity.hassanClaim).toBe(289442);
    expect(result.equity.partnerCapitalTotal).toBe(330764);
    expect(result.equity.unclosedEarnings).toBe(0);
    expect(result.equity.total).toBe(330764);
    expect(result.equity.freshStartTotalEntitlement).toBe(208197);
    expect(result.equity.accounts.some((account: { code?: string }) => account.code === "GC-UNCL-PNL")).toBe(false);
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
