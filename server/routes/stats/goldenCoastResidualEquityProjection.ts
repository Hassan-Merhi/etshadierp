import type { Express } from "express";
import { getAccountNetBalance, round2, type AccountBalance, type AccountLike } from "../../netPositionHelper";
import { logger } from "../../lib/logger";
import { loadNetProfitData } from "./netProfitDataLoad";

type LedgerRow = AccountLike & {
  subType?: string | null;
  active?: boolean | null;
  deletedAt?: unknown;
};

type DisplayAccount = {
  id?: number;
  name: string;
  code?: string;
  value: number;
  category?: string;
  balanceSide?: "Dr" | "Cr";
  currencyRevalued?: boolean;
  translationDifference?: unknown;
};

type NetProfitSection = {
  accounts?: unknown;
  total?: unknown;
  breakdown?: unknown;
  [key: string]: unknown;
};

type NetProfitResponse = {
  [key: string]: unknown;
  forUs?: NetProfitSection;
  onUs?: NetProfitSection;
  forUsTotal?: unknown;
  onUsTotal?: unknown;
  equity?: Record<string, unknown>;
  netPositionBreakdown?: Record<string, unknown>;
  currencyRevaluation?: Record<string, unknown>;
};

const ASSET_TYPES = new Set(["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash", "Customer"]);
const LIABILITY_TYPES = new Set(["Liability", "Loan", "Loans", "Duty Agent", "Transporter Agent"]);
const INTERNAL_SP_SUBTYPES = new Set([
  "sp_stock",
  "sp_otw_clearing",
  "sp_cost_clearing",
  "sp_pay_deduction_clearing",
  "sp_opnbal",
]);
const UNCLOSED_EARNINGS_CODE = "GC-UNCL-PNL";
const FX_TRANSLATION_CODE = "GC-FX-TRANS";

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountBalance(accountId: number, balances: Map<number, AccountBalance>): AccountBalance {
  return balances.get(accountId) ?? { debit: 0, credit: 0 };
}

/**
 * Canonical Golden Coast partner capital is economically credit-normal.
 * Historical cutover rows may store the opening side as Dr, so the opening
 * magnitude is treated as the positive capital claim and subsequent ledger
 * credits increase that claim while debits reduce it.
 */
export function goldenCoastPartnerClaim(account: LedgerRow, balances: Map<number, AccountBalance>): number {
  const movement = accountBalance(account.id, balances);
  const openingClaim = Math.abs(numberValue(account.openingBalance));
  return round2(openingClaim + movement.credit - movement.debit);
}

/** Backward-compatible export retained for existing focused tests/imports. */
export function goldenCoastHassanClaim(account: LedgerRow, balances: Map<number, AccountBalance>): number {
  return goldenCoastPartnerClaim(account, balances);
}

function openingCreditNormalPayable(account: LedgerRow | null): number {
  if (!account) return 0;
  const opening = Math.abs(numberValue(account.openingBalance));
  const side = account.openingBalanceSide === "Dr" ? "Dr" : "Cr";
  return side === "Cr" ? round2(opening) : 0;
}

function currentCreditNormalPayable(account: LedgerRow | null, balances: Map<number, AccountBalance>): number {
  if (!account) return 0;
  return round2(Math.max(0, -getAccountNetBalance(account, balances)));
}

function displayCategory(account: LedgerRow, side: "asset" | "liability"): string {
  if (account.subType === "sp_hadi_intercompany") return "HADI Intercompany";
  if (account.subType === "sp_goods_otw") return "Stock OTW";
  if (account.subType === "sp_prepaid" || account.subType === "sp_prepaid_expenses") return "Prepaid";
  return account.accountType || (side === "asset" ? "Asset" : "Liability");
}

function addBreakdown(accounts: DisplayAccount[]): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    const category = account.category || "Other";
    totals.set(category, round2((totals.get(category) || 0) + numberValue(account.value)));
  }
  return [...totals.entries()]
    .filter(([, value]) => Math.abs(value) >= 0.005)
    .map(([name, value]) => ({ name, value: round2(value) }))
    .sort((a, b) => b.value - a.value);
}

function currentTranslatedLedgerAccountIds(body: NetProfitResponse): number[] {
  const raw = body.currencyRevaluation?.currentTranslatedLedgerAccountIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
}

function currentCashTranslationAdjustment(
  body: NetProfitResponse,
  forUsAccounts: DisplayAccount[],
  onUsAccounts: DisplayAccount[]
): number {
  const aggregate = Number(body.currencyRevaluation?.currentCashBankTranslationDifference);
  if (Number.isFinite(aggregate)) return round2(aggregate);

  return round2(
    [...forUsAccounts, ...onUsAccounts]
      .filter((account) => account.currencyRevalued === true)
      .reduce((total, account) => total + numberValue(account.translationDifference), 0)
  );
}

function goldenCoastRoles(accounts: LedgerRow[]) {
  const active = accounts.filter((account) => account.active !== false && account.deletedAt == null);
  const fresh = active.find((account) => account.subType === "gc_partner_capital") ?? null;
  const hassan = active.find((account) => account.subType === "gc_owner_capital") ?? null;
  if (!fresh || !hassan) return null;

  const payableCandidates = active.filter((account) => account.subType === "sp_payable");
  const gcSalesCash =
    payableCandidates.find((account) => /gc\s*sales\s*cash/i.test(account.name || "")) ??
    (payableCandidates.length === 1 ? payableCandidates[0] : null);

  return { active, fresh, hassan, gcSalesCash };
}

/**
 * Phase 17 Golden Coast balance-sheet rule:
 *
 *   Assets - Liabilities = Total Equity
 *
 * GC Sales Cash is a real credit-normal liability. HADI Intercompany is a real
 * Golden Coast asset. Fresh Start and Hassan are displayed from their actual
 * credit-normal partner-capital ledgers. The historical GC Sales Cash opening
 * balance predates the Phase 15 capital-to-payable bridge, so that opening
 * payable is reclassified out of Fresh Start capital exactly once for the
 * balance-sheet presentation. New Phase 15 sales already debit Fresh Start and
 * therefore need no additional residual adjustment.
 *
 * Profit/loss that has not yet been closed by Phase 11 is shown separately as
 * Current Period Earnings (Unclosed). Current cash/bank translation is also
 * isolated in its own equity adjustment so unrealised FX never masquerades as
 * distributable earnings. Neither presentation line mutates partner ledgers.
 */
export function projectGoldenCoastResidualEquity(input: {
  body: NetProfitResponse;
  companyAccounts: LedgerRow[];
  accountBalances: Map<number, AccountBalance>;
}): NetProfitResponse {
  const { body, companyAccounts, accountBalances } = input;
  if (!body || typeof body !== "object" || !body.forUs || !body.onUs) return body;

  const roles = goldenCoastRoles(companyAccounts);
  if (!roles) return body;

  const forUsAccounts: DisplayAccount[] = Array.isArray(body.forUs.accounts)
    ? body.forUs.accounts.map((account: DisplayAccount) => ({ ...account }))
    : [];
  const onUsAccounts: DisplayAccount[] = Array.isArray(body.onUs.accounts)
    ? body.onUs.accounts.map((account: DisplayAccount) => ({ ...account }))
    : [];
  let forUsTotal = numberValue(body.forUs.total ?? body.forUsTotal);
  let onUsTotal = numberValue(body.onUs.total ?? body.onUsTotal);

  const existingIds = new Set<number>(
    [...forUsAccounts, ...onUsAccounts]
      .map((account) => Number(account.id ?? 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  for (const accountId of currentTranslatedLedgerAccountIds(body)) existingIds.add(accountId);

  // The generic Supplier Partner dashboard intentionally uses a narrow account
  // set. Golden Coast needs the complete real balance sheet: OTW, prepaid,
  // Cash/Bank, customer balances, HADI Intercompany and liabilities including
  // the canonical GC Sales Cash payable. Internal clearing/duplicate-stock
  // accounts remain excluded. Current-translated cash ledger IDs remain marked
  // as represented even when translation made the display row exactly zero.
  for (const account of roles.active) {
    if (existingIds.has(account.id)) continue;
    if (INTERNAL_SP_SUBTYPES.has(account.subType || "")) continue;
    if (account.id === roles.fresh.id || account.id === roles.hassan.id) continue;

    const isHadiIntercompany = account.subType === "sp_hadi_intercompany";
    const isAsset = ASSET_TYPES.has(account.accountType || "") || isHadiIntercompany;
    const isLiability = LIABILITY_TYPES.has(account.accountType || "");
    if (!isAsset && !isLiability) continue;

    const net = round2(getAccountNetBalance(account, accountBalances));
    if (Math.abs(net) < 0.005) continue;

    if (isLiability) {
      if (net < 0) {
        const value = round2(Math.abs(net));
        onUsTotal = round2(onUsTotal + value);
        onUsAccounts.push({
          id: account.id,
          name: account.name,
          code: account.code || "",
          value,
          category: displayCategory(account, "liability"),
        });
      } else {
        const value = round2(net);
        forUsTotal = round2(forUsTotal + value);
        forUsAccounts.push({
          id: account.id,
          name: account.name,
          code: account.code || "",
          value,
          category: `${displayCategory(account, "asset")} Deposit`,
        });
      }
      existingIds.add(account.id);
      continue;
    }

    if (net > 0) {
      const value = round2(net);
      forUsTotal = round2(forUsTotal + value);
      forUsAccounts.push({
        id: account.id,
        name: account.name,
        code: account.code || "",
        value,
        category: displayCategory(account, "asset"),
      });
    } else {
      const value = round2(Math.abs(net));
      onUsTotal = round2(onUsTotal + value);
      onUsAccounts.push({
        id: account.id,
        name: account.name,
        code: account.code || "",
        value,
        category: `${displayCategory(account, "liability")} Overdraft`,
      });
    }
    existingIds.add(account.id);
  }

  forUsTotal = round2(forUsTotal);
  onUsTotal = round2(onUsTotal);
  const netPosition = round2(forUsTotal - onUsTotal);

  const legacyOpeningPayableReclassification = openingCreditNormalPayable(roles.gcSalesCash);
  const freshLedgerClaim = goldenCoastPartnerClaim(roles.fresh, accountBalances);
  const freshStartClaim = round2(freshLedgerClaim - legacyOpeningPayableReclassification);
  const hassanClaim = goldenCoastPartnerClaim(roles.hassan, accountBalances);
  const partnerCapitalTotal = round2(freshStartClaim + hassanClaim);
  const currencyTranslationAdjustment = currentCashTranslationAdjustment(body, forUsAccounts, onUsAccounts);
  const unclosedEarnings = round2(netPosition - partnerCapitalTotal - currencyTranslationAdjustment);
  const gcSalesCashPayable = currentCreditNormalPayable(roles.gcSalesCash, accountBalances);
  const freshStartTotalEntitlement = round2(freshStartClaim + gcSalesCashPayable);

  const equityAccounts: DisplayAccount[] = [
    {
      id: roles.fresh.id,
      name: roles.fresh.name,
      code: roles.fresh.code || "",
      value: round2(Math.abs(freshStartClaim)),
      category: "Partner Capital / Equity",
      balanceSide: freshStartClaim >= 0 ? "Cr" : "Dr",
    },
    {
      id: roles.hassan.id,
      name: roles.hassan.name,
      code: roles.hassan.code || "",
      value: round2(Math.abs(hassanClaim)),
      category: "Partner Capital / Equity",
      balanceSide: hassanClaim >= 0 ? "Cr" : "Dr",
    },
  ];

  if (Math.abs(unclosedEarnings) >= 0.005) {
    equityAccounts.push({
      name: "Current Period Earnings (Unclosed)",
      code: UNCLOSED_EARNINGS_CODE,
      value: round2(Math.abs(unclosedEarnings)),
      category: "Current Period Earnings",
      balanceSide: unclosedEarnings >= 0 ? "Cr" : "Dr",
    });
  }
  if (Math.abs(currencyTranslationAdjustment) >= 0.005) {
    equityAccounts.push({
      name: "Current FX Translation Adjustment",
      code: FX_TRANSLATION_CODE,
      value: round2(Math.abs(currencyTranslationAdjustment)),
      category: "Currency Translation",
      balanceSide: currencyTranslationAdjustment >= 0 ? "Cr" : "Dr",
    });
  }

  const equity = {
    ...(body.equity || {}),
    total: netPosition,
    accounts: equityAccounts,
    includedInNetPosition: false,
    balanceSheetIdentity: "assets_minus_liabilities_equals_equity",
    residualFormula: "ledger_partner_capital_plus_unclosed_earnings_plus_fx_translation",
    freshStartResidual: freshStartClaim,
    freshStartClaim,
    freshStartLedgerClaim: freshLedgerClaim,
    freshStartTotalEntitlement,
    hassanClaim,
    partnerCapitalTotal,
    unclosedEarnings,
    currencyTranslationAdjustment,
    gcSalesCashPayable,
    legacyOpeningPayableReclassification,
  };

  const forUsBreakdown = addBreakdown(forUsAccounts);
  const onUsBreakdown = addBreakdown(onUsAccounts);
  const netPositionBreakdown = {
    ...(body.netPositionBreakdown || {}),
    assets: { total: forUsTotal, breakdown: forUsBreakdown },
    liabilities: { total: onUsTotal, breakdown: onUsBreakdown },
    equity,
    netPosition,
  };

  return {
    ...body,
    forUs: {
      ...body.forUs,
      total: forUsTotal,
      breakdown: forUsBreakdown,
      accounts: forUsAccounts,
    },
    onUs: {
      ...body.onUs,
      total: onUsTotal,
      breakdown: onUsBreakdown,
      accounts: onUsAccounts,
    },
    equity,
    netPosition,
    netWorth: netPosition,
    netPositionLabel: netPosition >= 0 ? "Net Assets" : "Net Liabilities",
    netPositionBreakdown,
    forUsTotal,
    onUsTotal,
  };
}

/**
 * Installs a response projection immediately before the existing Net Profit
 * route. The accounting engine stays unchanged for every other company type.
 */
export function registerGoldenCoastResidualEquityProjection(app: Express): void {
  app.use("/api/stats/net-profit", async (req, res, next) => {
    if (req.method !== "GET") return next();
    const companyId = req.session.currentCompanyId;
    if (!companyId) return next();

    try {
      const toDate = req.query.toDate ? String(req.query.toDate) : null;
      const reportData = await loadNetProfitData(companyId, toDate);
      if (reportData.companyRecord?.companyType !== "supplier_partner") return next();
      if (!goldenCoastRoles(reportData.companyAccounts as LedgerRow[])) return next();

      const originalJson = res.json.bind(res);
      res.json = ((body: NetProfitResponse) =>
        originalJson(
          projectGoldenCoastResidualEquity({
            body,
            companyAccounts: reportData.companyAccounts as LedgerRow[],
            accountBalances: reportData.accountBalances,
          })
        )) as typeof res.json;
    } catch (error) {
      logger.warn("Golden Coast balance-sheet projection unavailable; using base Net Position response", { error });
    }

    return next();
  });
}
