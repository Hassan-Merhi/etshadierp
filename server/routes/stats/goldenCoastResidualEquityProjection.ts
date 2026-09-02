import type { Express } from "express";
import { getAccountNetBalance, round2, type AccountBalance } from "../../netPositionHelper";
import { logger } from "../../lib/logger";
import { loadNetProfitData } from "./netProfitDataLoad";

type LedgerRow = {
  id: number;
  name: string;
  code?: string | null;
  accountType?: string | null;
  subType?: string | null;
  openingBalance?: string | null;
  openingBalanceSide?: string | null;
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
};

type NetProfitResponse = Record<string, any>;

const ASSET_TYPES = new Set(["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash", "Customer"]);
const LIABILITY_TYPES = new Set(["Liability", "Loan", "Loans", "Duty Agent", "Transporter Agent"]);
const INTERNAL_SP_SUBTYPES = new Set([
  "sp_stock",
  "sp_otw_clearing",
  "sp_cost_clearing",
  "sp_pay_deduction_clearing",
  "sp_opnbal",
]);

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountBalance(accountId: number, balances: Map<number, AccountBalance>): AccountBalance {
  return balances.get(accountId) ?? { debit: 0, credit: 0 };
}

/**
 * Golden Coast equity is economically credit-normal. Some legacy opening
 * imports stored the side as Dr, so use the opening magnitude and subsequent
 * credit-minus-debit activity for the Hassan claim. If a very old data set was
 * posted entirely through vouchers in the opposite direction, fall back to the
 * current ledger magnitude rather than turning Hassan's claim negative.
 */
export function goldenCoastHassanClaim(
  account: LedgerRow,
  balances: Map<number, AccountBalance>
): number {
  const movement = accountBalance(account.id, balances);
  const openingClaim = Math.abs(numberValue(account.openingBalance));
  const creditNormalClaim = round2(openingClaim + movement.credit - movement.debit);
  if (creditNormalClaim >= -0.005) return Math.max(0, creditNormalClaim);
  return round2(Math.abs(getAccountNetBalance(account as any, balances)));
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

function removeAccountById(accounts: DisplayAccount[], accountId: number): { accounts: DisplayAccount[]; removed: number } {
  let removed = 0;
  const kept = accounts.filter((account) => {
    if (Number(account.id ?? 0) !== accountId) return true;
    removed += numberValue(account.value);
    return false;
  });
  return { accounts: kept, removed: round2(removed) };
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
 * Final Golden Coast balance-sheet rule:
 *
 *   Fresh Start = Net Assets - Hassan Dakik Account
 *
 * GC Sales Cash is an operational gross-sales settlement tracker, not an
 * additional balance-sheet liability. HADI Intercompany is a real GC asset.
 * Other genuine GC assets/liabilities continue to participate in Net Assets.
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

  let forUsAccounts: DisplayAccount[] = Array.isArray(body.forUs.accounts)
    ? body.forUs.accounts.map((account: DisplayAccount) => ({ ...account }))
    : [];
  let onUsAccounts: DisplayAccount[] = Array.isArray(body.onUs.accounts)
    ? body.onUs.accounts.map((account: DisplayAccount) => ({ ...account }))
    : [];
  let forUsTotal = numberValue(body.forUs.total ?? body.forUsTotal);
  let onUsTotal = numberValue(body.onUs.total ?? body.onUsTotal);

  // Remove the legacy/on-ledger GC Sales Cash tracker from financial Net Assets.
  // Its operational settlement balance remains available through the Golden
  // Coast sales-cash/HADI workflows; it must not be counted a second time here.
  if (roles.gcSalesCash) {
    const removedAsset = removeAccountById(forUsAccounts, roles.gcSalesCash.id);
    const removedLiability = removeAccountById(onUsAccounts, roles.gcSalesCash.id);
    forUsAccounts = removedAsset.accounts;
    onUsAccounts = removedLiability.accounts;
    forUsTotal = round2(forUsTotal - removedAsset.removed);
    onUsTotal = round2(onUsTotal - removedLiability.removed);
  }

  const existingIds = new Set<number>(
    [...forUsAccounts, ...onUsAccounts]
      .map((account) => Number(account.id ?? 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  );

  // The generic Supplier Partner dashboard intentionally uses a narrow set of
  // accounts. Golden Coast's residual-equity model needs the full real asset
  // base: OTW, prepaid balances, Cash/Bank, customer assets and the HADI
  // intercompany receivable. Internal clearing/duplicate-stock ledgers stay out.
  for (const account of roles.active) {
    if (existingIds.has(account.id)) continue;
    if (INTERNAL_SP_SUBTYPES.has(account.subType || "")) continue;
    if (account.id === roles.fresh.id || account.id === roles.hassan.id) continue;
    if (roles.gcSalesCash && account.id === roles.gcSalesCash.id) continue;

    const isHadiIntercompany = account.subType === "sp_hadi_intercompany";
    const isAsset = ASSET_TYPES.has(account.accountType || "") || isHadiIntercompany;
    const isLiability = LIABILITY_TYPES.has(account.accountType || "");
    if (!isAsset && !isLiability) continue;

    const net = round2(getAccountNetBalance(account as any, accountBalances));
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
  const hassanClaim = goldenCoastHassanClaim(roles.hassan, accountBalances);
  const freshStartResidual = round2(netPosition - hassanClaim);

  const equityAccounts: DisplayAccount[] = [
    {
      id: roles.fresh.id,
      name: roles.fresh.name,
      code: roles.fresh.code || "",
      value: round2(Math.abs(freshStartResidual)),
      category: "Residual Partner Equity",
      balanceSide: freshStartResidual >= 0 ? "Cr" : "Dr",
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
  const equity = {
    ...(body.equity || {}),
    total: netPosition,
    accounts: equityAccounts,
    residualFormula: "net_assets_minus_hassan",
    freshStartResidual: freshStartResidual,
    hassanClaim,
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
    forUs: { ...body.forUs, total: forUsTotal, breakdown: forUsBreakdown, accounts: forUsAccounts },
    onUs: { ...body.onUs, total: onUsTotal, breakdown: onUsBreakdown, accounts: onUsAccounts },
    equity,
    netPosition,
    netWorth: netPosition,
    netPositionLabel: netPosition >= 0 ? "We have more than we owe" : "We owe more than we have",
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
      logger.warn("Golden Coast residual-equity projection unavailable; using base Net Position response", { error });
    }

    return next();
  });
}
