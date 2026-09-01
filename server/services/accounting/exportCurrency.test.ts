import { describe, expect, it } from "vitest";
import { projectExportCurrencyRow, summarizeExportCurrencyRows } from "./exportCurrency";

describe("export currency projection", () => {
  it("keeps native and historical-base values separate", () => {
    const row = projectExportCurrencyRow({
      transactionCurrency: "CFA",
      transactionDebitAmount: "100000",
      baseDebitAmount: "166.666667",
      historicalExchangeRate: "600",
      rateConvention: "TRANSACTION_PER_BASE",
    });
    expect(row.nativeDebit).toBe("100000");
    expect(row.historicalBaseDebit).toBe("166.666667");
    expect(row.status).toBe("HISTORICAL_BASE");
  });

  it("groups native totals by currency and excludes unresolved legacy foreign rows", () => {
    const summary = summarizeExportCurrencyRows([
      { transactionCurrency: "USD", transactionDebitAmount: "10", baseDebitAmount: "10" },
      { transactionCurrency: "CFA", transactionDebitAmount: "6000", baseDebitAmount: "10" },
      { transactionCurrency: "CFA", debitAmount: "9000" },
      { transactionCurrency: null, debitAmount: "3" },
    ]);
    expect(summary.nativeDebitByCurrency).toEqual({ USD: "10.000000", CFA: "6000.000000" });
    expect(summary.historicalBaseDebitTotal).toBe("20.000000");
    expect(summary.unresolvedEntryCount).toBe(2);
    expect(summary.totalsProvisional).toBe(true);
  });
});