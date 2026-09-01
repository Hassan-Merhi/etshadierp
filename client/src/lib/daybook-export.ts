export type DaybookExportValue = Record<string, unknown>;

export function buildDetailedDaybookRows(
  vouchers: DaybookExportValue[],
  formatDate: (date: string | Date) => string
): DaybookExportValue[] {
  return vouchers.flatMap((v) => {
    const entries = Array.isArray(v.entries) ? (v.entries as DaybookExportValue[]) : [];
    if (entries.length === 0) {
      return [{
        "Voucher Number": v.voucherNumber,
        Date: formatDate(v.voucherDate as string | Date),
        Type: v.voucherType,
        Description: v.description || "",
        Currency: v.currency || v.transactionCurrency || "USD",
        "Native Debit": v.transactionDebitAmount ?? "",
        "Native Credit": v.transactionCreditAmount ?? "",
        "Historical Base Debit": v.baseDebitAmount ?? "",
        "Historical Base Credit": v.baseCreditAmount ?? "",
        "Currency Status": v.currencyStatus || "LEGACY_BASE",
      }];
    }
    return entries.map((entry) => ({
      "Voucher Number": v.voucherNumber,
      Date: formatDate(v.voucherDate as string | Date),
      Type: v.voucherType,
      Description: entry.narration || v.description || "",
      Account: entry.accountName || "",
      Currency: entry.transactionCurrency || v.currency || "USD",
      "Native Debit": entry.transactionDebitAmount ?? entry.debitAmount ?? "",
      "Native Credit": entry.transactionCreditAmount ?? entry.creditAmount ?? "",
      "Historical Base Debit": entry.baseDebitAmount ?? "",
      "Historical Base Credit": entry.baseCreditAmount ?? "",
      "Historical Exchange Rate": entry.historicalExchangeRate ?? v.exchangeRate ?? "",
      "Currency Status":
        entry.currencyStatus || (entry.baseDebitAmount != null ? "HISTORICAL_BASE" : "LEGACY_BASE"),
    }));
  });
}