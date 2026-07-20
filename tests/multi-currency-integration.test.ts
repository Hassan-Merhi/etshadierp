import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeCurrencyCode,
  normalizeVoucherEntryAmounts,
  RateConvention,
} from "../server/services/accounting/currencyAmounts";
import { normalizeOpeningBalanceCurrency } from "../server/services/accounting/openingBalanceCurrency";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("multi-currency historical amount rules", () => {
  it("stores CFA as the project currency identifier", () => {
    expect(normalizeCurrencyCode("CFA")).toBe("CFA");
    expect(normalizeCurrencyCode("xof")).toBe("CFA");
  });

  it("preserves the native CFA amount and stores legacy debit as historical USD base", () => {
    const entry = normalizeVoucherEntryAmounts({
      transactionCurrency: "CFA",
      baseCurrency: "USD",
      transactionDebitAmount: "6000000",
      transactionCreditAmount: "0",
      historicalRate: "600",
    });

    expect(entry.transactionCurrency).toBe("CFA");
    expect(entry.transactionDebitAmount).toBe("6000000.000000");
    expect(entry.historicalExchangeRate).toBe("600.0000000000");
    expect(entry.rateConvention).toBe(RateConvention.TRANSACTION_PER_BASE);
    expect(entry.baseDebitAmount).toBe("10000.000000");
    expect(entry.debitAmount).toBe("10000.000000");
  });

  it("keeps historical sales and expenses independent of a later current rate", () => {
    const sale = normalizeVoucherEntryAmounts({
      transactionCurrency: "CFA",
      baseCurrency: "USD",
      transactionDebitAmount: "0",
      transactionCreditAmount: "6000000",
      historicalRate: "600",
    });
    const expense = normalizeVoucherEntryAmounts({
      transactionCurrency: "CFA",
      baseCurrency: "USD",
      transactionDebitAmount: "1200000",
      transactionCreditAmount: "0",
      historicalRate: "600",
    });

    expect(sale.baseCreditAmount).toBe("10000.000000");
    expect(expense.baseDebitAmount).toBe("2000.000000");
    expect(Number(sale.baseCreditAmount) - Number(expense.baseDebitAmount)).toBe(8000);
  });

  it("uses identity storage for USD", () => {
    const entry = normalizeVoucherEntryAmounts({
      transactionCurrency: "USD",
      baseCurrency: "USD",
      transactionDebitAmount: "1250.25",
      transactionCreditAmount: "0",
      historicalRate: null,
    });

    expect(entry.rateConvention).toBe(RateConvention.IDENTITY);
    expect(entry.historicalExchangeRate).toBe("1.0000000000");
    expect(entry.transactionDebitAmount).toBe("1250.250000");
    expect(entry.baseDebitAmount).toBe("1250.250000");
    expect(entry.debitAmount).toBe("1250.250000");
  });

  it("refuses a missing historical rate for CFA", () => {
    expect(() =>
      normalizeVoucherEntryAmounts({
        transactionCurrency: "CFA",
        baseCurrency: "USD",
        transactionDebitAmount: "600000",
        transactionCreditAmount: "0",
        historicalRate: null,
      }),
    ).toThrow(/valid positive rate/i);
  });
});

describe("opening balance currency rules", () => {
  it("stores a CFA opening balance with its historical USD base", () => {
    const opening = normalizeOpeningBalanceCurrency({
      openingBalance: "6000000",
      openingBalanceCurrency: "CFA",
      openingBalanceHistoricalRate: "600",
      baseCurrency: "USD",
    });

    expect(opening).toEqual({
      openingBalanceCurrency: "CFA",
      openingBalanceHistoricalRate: "600.0000000000",
      openingBalanceBaseAmount: "10000.000000",
    });
  });

  it("stores a USD opening balance as identity", () => {
    const opening = normalizeOpeningBalanceCurrency({
      openingBalance: "1250.25",
      openingBalanceCurrency: "USD",
      baseCurrency: "USD",
    });

    expect(opening).toEqual({
      openingBalanceCurrency: "USD",
      openingBalanceHistoricalRate: "1.0000000000",
      openingBalanceBaseAmount: "1250.250000",
    });
  });

  it("does not guess the currency of a non-zero opening balance", () => {
    expect(() =>
      normalizeOpeningBalanceCurrency({
        openingBalance: "1000",
        openingBalanceCurrency: null,
        baseCurrency: "USD",
      }),
    ).toThrow(/requires its currency/i);
  });
});

describe("required database migrations", () => {
  it("adds all voucher-entry dual-currency columns", () => {
    const sql = read("migrations/20260720_002_voucher_entry_currency_fields.sql");
    for (const column of [
      "transaction_currency",
      "transaction_debit_amount",
      "transaction_credit_amount",
      "base_debit_amount",
      "base_credit_amount",
      "historical_exchange_rate",
      "rate_convention",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/UPDATE\s+voucher_entries/i);
  });

  it("adds ledger and bank opening-balance metadata", () => {
    const ledgerSql = read("migrations/20260720_003_ledger_account_opening_balance_currency.sql");
    const bankSql = read("migrations/20260720_004_bank_account_opening_balance_currency.sql");
    for (const sql of [ledgerSql, bankSql]) {
      expect(sql).toContain("opening_balance_currency");
      expect(sql).toContain("opening_balance_historical_rate");
      expect(sql).toContain("opening_balance_base_amount");
    }
  });

  it("normalizes new USD/CFA writes and protects CFA updates", () => {
    const sql = read("migrations/20260720_005_voucher_entry_currency_normalization_trigger.sql");
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE/i);
    expect(sql).toContain("ROUND(raw_debit / voucher_rate, 6)");
    expect(sql).toContain("NEW.debit_amount := NEW.base_debit_amount");
    expect(sql).toMatch(/must be edited through transaction\/base currency fields/i);
    expect(sql).toMatch(/Other currencies[\s\S]*remain explicitly unresolved/i);
  });

  it("registers every new migration in the Drizzle journal", () => {
    const journal = read("migrations/meta/_journal.json");
    expect(journal).toContain("20260720_002_voucher_entry_currency_fields");
    expect(journal).toContain("20260720_003_ledger_account_opening_balance_currency");
    expect(journal).toContain("20260720_004_bank_account_opening_balance_currency");
    expect(journal).toContain("20260720_005_voucher_entry_currency_normalization_trigger");
  });
});

describe("cash/bank revaluation safety source checks", () => {
  it("keeps native currencies separate and uses Decimal calculations", () => {
    const source = read("server/services/accounting/cashBankRevaluationService.ts");
    expect(source).toContain("nativeBalancesByCurrency");
    expect(source).toContain("new Decimal");
    expect(source).toContain("GROUP BY account_id, entry_currency");
    expect(source).not.toContain("MAX(ve.transaction_currency)");
  });

  it("does not silently classify legacy non-USD rows as USD", () => {
    const source = read("server/services/accounting/cashBankRevaluationService.ts");
    expect(source).toContain("__UNRESOLVED_LEGACY__");
    expect(source).toMatch(/COALESCE\(UPPER\(v\.currency\), 'USD'\) <> 'USD'/);
    expect(source).toContain("unresolvedLegacyEntryCount");
  });

  it("returns null current values when translation is unresolved", () => {
    const source = read("server/services/accounting/cashBankRevaluationService.ts");
    expect(source).toContain("currentTranslatedBaseBalance = totalsProvisional");
    expect(source).toContain("translationDifference = totalsProvisional");
    expect(source).toContain("currentRateMissing");
  });

  it("applies current translation only to live cash/bank Net Position rows", () => {
    const source = read("server/routes/stats/statsMultiCurrencyRoutes.ts");
    expect(source).toContain("resolvedLedgerIds");
    expect(source).toContain("Cash / Bank (Current Translation)");
    expect(source).toContain("req.query.toDate");
    expect(source).not.toMatch(/incomeTotal\s*=/);
    expect(source).not.toMatch(/expensesTotal\s*=/);
  });
});

describe("historical repair remains explicit", () => {
  it("keeps the backfill dry-run by default and does not use the latest rate", () => {
    const source = read("scripts/backfill-voucher-entry-currency-amounts.mjs");
    expect(source).toMatch(/Dry-run by default/i);
    expect(source).toMatch(/Never uses the latest company exchange rate/i);
    expect(source).toContain("timingSafeEqual");
  });
});
