import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("supplier partner net position inclusion", () => {
  it("includes Golden Coast customer assets, Loan/Loans liabilities, and balance-sheet-native equity", () => {
    const source = read("server/routes/stats/goldenCoastResidualEquityProjection.ts");
    expect(source).toContain('"Customer"');
    expect(source).toContain('"Loan"');
    expect(source).toContain('"Loans"');
    expect(source).toContain("const netPosition = round2(forUsTotal - onUsTotal)");
    expect(source).toContain(
      'residualFormula: "ledger_partner_capital_plus_unclosed_earnings_plus_fx_translation"'
    );
    expect(source).toContain("const freshStartTotalEntitlement = round2(freshStartClaim + gcSalesCashPayable)");
    expect(source).toContain("for (const accountId of currentTranslatedLedgerAccountIds(body)) existingIds.add(accountId)");
  });

  it("does not let current-cash translation erase supplier-partner equity", () => {
    const source = read("server/routes/stats/statsMultiCurrencyRoutes.ts");
    expect(source).toContain("payload.equity?.includedInNetPosition === true");
    expect(source).toContain("plus(equityContribution)");
    expect(source).toContain("payload.netWorth = netPosition");
    expect(source).toContain("currentTranslatedLedgerAccountIds");
    expect(source).toContain("currentCashBankTranslationDifference");
  });

  it("keeps historical/monthly and Excel calculations aligned", () => {
    const asOf = read("server/helpers/calculateNetPositionAsOf.ts");
    const excel = read("server/routes/stats/statsNetPositionRoutes.ts");
    for (const source of [asOf, excel]) {
      expect(source).toContain("classifyEquityAccounts");
      expect(source).toContain('a.accountType === "Loan"');
      expect(source).toContain('a.accountType === "Loans"');
      expect(source).toContain('a.subType === "Accounts Receivable"');
      expect(source).toContain("equityContribution");
      expect(source).toContain("forUsTotal - onUsTotal + equityContribution");
    }
  });
});
