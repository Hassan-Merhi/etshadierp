import { createReportDomainHandler } from "./createReportDomainHandler";

export const accountingReportDomain = createReportDomainHandler("accounting", [
  "pl_summary", "cash_position", "overdue_payments", "monthly_comparison", "expense_breakdown",
  "bank_transactions", "fixed_assets_summary", "credit_notes_summary", "voucher_type_summary",
  "trial_balance", "cash_flow_summary", "ledger_account_balance", "daily_report", "debit_note_summary",
  "journal_entries", "bank_account_list", "income_breakdown", "quarterly_comparison",
]);
