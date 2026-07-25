export const criticalTables = Object.freeze([
  "companies",
  "users",
  "user_company_roles",
  "vouchers",
  "voucher_entries",
  "ledger_accounts",
  "bank_accounts",
  "stock_items",
  "inventory",
  "exchange_rates",
  "salary_advances",
  "fiscal_period_closures",
]);

export const criticalColumns = Object.freeze([
  ["companies", "company_type"],
  ["companies", "base_currency"],
  ["user_company_roles", "can_delete_records"],
  ["vouchers", "currency"],
  ["voucher_entries", "transaction_currency"],
  ["voucher_entries", "base_debit_amount"],
  ["voucher_entries", "base_credit_amount"],
  ["voucher_entries", "historical_exchange_rate"],
  ["voucher_entries", "rate_convention"],
  ["ledger_accounts", "opening_balance_currency"],
  ["ledger_accounts", "opening_balance_base_amount"],
  ["ledger_accounts", "opening_balance_native_amount"],
  ["ledger_accounts", "category"],
  ["bank_accounts", "opening_balance_currency"],
  ["bank_accounts", "opening_balance_base_amount"],
  ["bank_accounts", "opening_balance_native_amount"],
  ["exchange_rates", "from_currency"],
  ["exchange_rates", "to_currency"],
  ["exchange_rates", "effective_date"],
  ["salary_advances", "remaining_balance"],
  ["salary_advances", "fully_paid"],
]);

export const criticalIndexes = Object.freeze([
  "exchange_rates_company_date_pair_unique",
]);

export function evaluateCriticalSchema({ tables = [], columns = [], indexes = [] } = {}) {
  const tableSet = new Set(tables);
  const columnSet = new Set(columns.map(({ tableName, columnName }) => `${tableName}.${columnName}`));
  const indexSet = new Set(indexes);

  const missingTables = criticalTables.filter((tableName) => !tableSet.has(tableName));
  const missingColumns = criticalColumns
    .map(([tableName, columnName]) => `${tableName}.${columnName}`)
    .filter((qualifiedName) => !columnSet.has(qualifiedName));
  const missingIndexes = criticalIndexes.filter((indexName) => !indexSet.has(indexName));

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    missingTables,
    missingColumns,
    missingIndexes,
  };
}
