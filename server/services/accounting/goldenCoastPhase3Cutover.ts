import Decimal from "decimal.js";

export const GOLDEN_COAST_PHASE3_CUTOVER_DATE = "2026-09-01";
export const GOLDEN_COAST_PHASE3_VOUCHER_NUMBER = "GC-CUTOVER-20260901";
export const GOLDEN_COAST_PHASE3_PARTNER_EQUITY_USD = "100000.00";

export type GoldenCoastPhase3MoneyInput = string | number;

export type GoldenCoastPhase3CashAccount =
  | { kind: "ledger"; id: number; name?: string }
  | { kind: "bank"; id: number; name?: string };

export interface GoldenCoastPhase3RoleAccounts {
  freshStartEquityAccountId: number;
  hassanEquityAccountId: number;
  hassanSavingsAccountId: number;
  gcSalesCashAccountId: number;
  stockOtwAccountId: number;
  stockInHandAccountId: number;
  containerReserveAccountId: number;
}

export interface GoldenCoastPhase3CutoverInput {
  companyId: number;
  stockOtwUsd: GoldenCoastPhase3MoneyInput;
  stockInHandUsd: GoldenCoastPhase3MoneyInput;
  containerReserveUsd: GoldenCoastPhase3MoneyInput;
  gcSalesCashUsd?: GoldenCoastPhase3MoneyInput;
  hassanSavingsUsd?: GoldenCoastPhase3MoneyInput;
  cashAccount: GoldenCoastPhase3CashAccount;
  accounts: GoldenCoastPhase3RoleAccounts;
}

export interface GoldenCoastPhase3VoucherEntry {
  ledgerAccountId?: number;
  bankAccountId?: number;
  debitAmount: string;
  creditAmount: string;
  narration: string;
}

export interface GoldenCoastPhase3CutoverPlan {
  cutoverDate: string;
  voucherNumber: string;
  voucherType: "Journal";
  description: string;
  totalAmount: string;
  partnerEquityPerPartnerUsd: string;
  totalPartnerEquityUsd: string;
  stockOtwUsd: string;
  stockInHandUsd: string;
  containerReserveUsd: string;
  gcSalesCashUsd: string;
  hassanSavingsUsd: string;
  openingCashUsd: string;
  profitPendingDistributionUsd: "0.00";
  entries: GoldenCoastPhase3VoucherEntry[];
}

export class GoldenCoastPhase3CutoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenCoastPhase3CutoverError";
  }
}

function decimal(value: GoldenCoastPhase3MoneyInput | undefined, field: string): Decimal {
  try {
    const parsed = new Decimal(value == null || value === "" ? 0 : value);
    if (!parsed.isFinite()) throw new Error("not finite");
    return parsed;
  } catch {
    throw new GoldenCoastPhase3CutoverError(`${field} must be a finite number`);
  }
}

function nonNegative(value: GoldenCoastPhase3MoneyInput | undefined, field: string): Decimal {
  const parsed = decimal(value, field);
  if (parsed.lt(0)) throw new GoldenCoastPhase3CutoverError(`${field} cannot be negative`);
  if (parsed.decimalPlaces() > 2) {
    throw new GoldenCoastPhase3CutoverError(`${field} cannot have more than two decimal places`);
  }
  return parsed;
}

function requiredNonNegative(value: GoldenCoastPhase3MoneyInput | undefined, field: string): Decimal {
  if (value == null || value === "") {
    throw new GoldenCoastPhase3CutoverError(`${field} is required`);
  }
  return nonNegative(value, field);
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function positiveId(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GoldenCoastPhase3CutoverError(`${field} must be a positive integer`);
  }
  return value;
}

export function goldenCoastPhase3VoucherNumber(companyId: number): string {
  return `${GOLDEN_COAST_PHASE3_VOUCHER_NUMBER}-C${positiveId(companyId, "companyId")}`;
}

function validateRoleAccounts(accounts: GoldenCoastPhase3RoleAccounts): void {
  const values = Object.entries(accounts).map(([field, value]) => positiveId(value, field));
  if (new Set(values).size !== values.length) {
    throw new GoldenCoastPhase3CutoverError("Each Golden Coast Phase 3 role must resolve to a distinct ledger account");
  }
}

function validateCashAccount(account: GoldenCoastPhase3CashAccount): void {
  if (!account || (account.kind !== "ledger" && account.kind !== "bank")) {
    throw new GoldenCoastPhase3CutoverError('cashAccount.kind must be "ledger" or "bank"');
  }
  positiveId(account.id, "cashAccount.id");
}

function ledgerDebit(accountId: number, amount: Decimal, narration: string): GoldenCoastPhase3VoucherEntry {
  return {
    ledgerAccountId: accountId,
    debitAmount: money(amount),
    creditAmount: "0.00",
    narration,
  };
}

function ledgerCredit(accountId: number, amount: Decimal, narration: string): GoldenCoastPhase3VoucherEntry {
  return {
    ledgerAccountId: accountId,
    debitAmount: "0.00",
    creditAmount: money(amount),
    narration,
  };
}

function cashDebit(
  account: GoldenCoastPhase3CashAccount,
  amount: Decimal,
  narration: string
): GoldenCoastPhase3VoucherEntry {
  return account.kind === "bank"
    ? { bankAccountId: account.id, debitAmount: money(amount), creditAmount: "0.00", narration }
    : { ledgerAccountId: account.id, debitAmount: money(amount), creditAmount: "0.00", narration };
}

function pushIfPositive(
  entries: GoldenCoastPhase3VoucherEntry[],
  amount: Decimal,
  factory: () => GoldenCoastPhase3VoucherEntry
): void {
  if (amount.gt(0)) entries.push(factory());
}

/**
 * Builds the one-time September 1 Golden Coast opening-balance journal.
 *
 * Phase 2 establishes two $100,000 / 50% partner-equity targets. Phase 3 turns
 * those targets into an actual balanced opening position without inventing a
 * permanent clearing balance. Stock OTW, Stock in Hand and Container Reserve
 * are debited at the supplied cutover values; existing settlement liabilities
 * may be carried in as GC Sales Cash / Hassan Savings credits; the remaining
 * amount needed to satisfy Assets = Equity + Liabilities is the opening cash or
 * bank debit. Profit Pending Distribution deliberately starts at zero.
 */
export function buildGoldenCoastPhase3CutoverPlan(
  input: GoldenCoastPhase3CutoverInput
): GoldenCoastPhase3CutoverPlan {
  if (!input || typeof input !== "object") {
    throw new GoldenCoastPhase3CutoverError("Phase 3 cutover input is required");
  }
  const companyId = positiveId(input.companyId, "companyId");
  validateRoleAccounts(input.accounts);
  validateCashAccount(input.cashAccount);

  const stockOtw = requiredNonNegative(input.stockOtwUsd, "stockOtwUsd");
  const stockInHand = requiredNonNegative(input.stockInHandUsd, "stockInHandUsd");
  const containerReserve = requiredNonNegative(input.containerReserveUsd, "containerReserveUsd");
  const gcSalesCash = nonNegative(input.gcSalesCashUsd, "gcSalesCashUsd");
  const hassanSavings = nonNegative(input.hassanSavingsUsd, "hassanSavingsUsd");
  const partnerEquity = new Decimal(GOLDEN_COAST_PHASE3_PARTNER_EQUITY_USD);
  const totalPartnerEquity = partnerEquity.times(2);

  const nonCashAssets = stockOtw.plus(stockInHand).plus(containerReserve);
  const liabilitiesAndEquity = totalPartnerEquity.plus(gcSalesCash).plus(hassanSavings);
  const openingCash = liabilitiesAndEquity.minus(nonCashAssets);

  if (openingCash.lt(0)) {
    throw new GoldenCoastPhase3CutoverError(
      `Opening non-cash assets exceed partner equity plus carried settlement liabilities by ${money(openingCash.abs())}; ` +
        "do not force a negative cash balance — correct the cutover values first"
    );
  }

  const description = `Golden Coast opening balance cutover — ${GOLDEN_COAST_PHASE3_CUTOVER_DATE}`;
  const entries: GoldenCoastPhase3VoucherEntry[] = [];

  pushIfPositive(entries, stockOtw, () =>
    ledgerDebit(input.accounts.stockOtwAccountId, stockOtw, `${description} — Stock OTW`)
  );
  pushIfPositive(entries, stockInHand, () =>
    ledgerDebit(input.accounts.stockInHandAccountId, stockInHand, `${description} — Stock in Hand`)
  );
  pushIfPositive(entries, containerReserve, () =>
    ledgerDebit(input.accounts.containerReserveAccountId, containerReserve, `${description} — Container Reserve`)
  );
  pushIfPositive(entries, openingCash, () =>
    cashDebit(input.cashAccount, openingCash, `${description} — residual cash/bank`)
  );

  entries.push(
    ledgerCredit(
      input.accounts.freshStartEquityAccountId,
      partnerEquity,
      `${description} — Fresh Start FZ 50% opening equity`
    ),
    ledgerCredit(
      input.accounts.hassanEquityAccountId,
      partnerEquity,
      `${description} — Hassan Dakik 50% opening equity`
    )
  );
  pushIfPositive(entries, gcSalesCash, () =>
    ledgerCredit(input.accounts.gcSalesCashAccountId, gcSalesCash, `${description} — carried GC Sales Cash payable`)
  );
  pushIfPositive(entries, hassanSavings, () =>
    ledgerCredit(input.accounts.hassanSavingsAccountId, hassanSavings, `${description} — carried Hassan Savings loan`)
  );

  const debitTotal = entries.reduce((sum, entry) => sum.plus(entry.debitAmount), new Decimal(0));
  const creditTotal = entries.reduce((sum, entry) => sum.plus(entry.creditAmount), new Decimal(0));
  if (!debitTotal.eq(creditTotal) || debitTotal.lte(0)) {
    throw new GoldenCoastPhase3CutoverError(
      `Phase 3 cutover is not balanced: debit ${money(debitTotal)} credit ${money(creditTotal)}`
    );
  }

  return {
    cutoverDate: GOLDEN_COAST_PHASE3_CUTOVER_DATE,
    voucherNumber: goldenCoastPhase3VoucherNumber(companyId),
    voucherType: "Journal",
    description,
    totalAmount: money(debitTotal),
    partnerEquityPerPartnerUsd: money(partnerEquity),
    totalPartnerEquityUsd: money(totalPartnerEquity),
    stockOtwUsd: money(stockOtw),
    stockInHandUsd: money(stockInHand),
    containerReserveUsd: money(containerReserve),
    gcSalesCashUsd: money(gcSalesCash),
    hassanSavingsUsd: money(hassanSavings),
    openingCashUsd: money(openingCash),
    profitPendingDistributionUsd: "0.00",
    entries,
  };
}
