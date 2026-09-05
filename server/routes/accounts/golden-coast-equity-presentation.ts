import type { Express } from "express";

type AccountsAllRow = {
  id?: string;
  accountId?: number;
  name?: string | null;
  subType?: string | null;
  balance?: string | number | null;
  balanceSide?: string | null;
  openingBalance?: string | number | null;
  openingBalanceSide?: string | null;
  active?: boolean | null;
  deletedAt?: unknown;
  [key: string]: unknown;
};

type AccountsAllResponse = {
  accounts?: unknown;
  [key: string]: unknown;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function signedAmount(value: unknown, side: unknown): number {
  const magnitude = Math.abs(numberValue(value));
  return side === "Cr" ? -magnitude : magnitude;
}

function creditNormalPartnerClaim(row: AccountsAllRow): number {
  const openingMagnitude = Math.abs(numberValue(row.openingBalance));
  const signedOpening = signedAmount(row.openingBalance, row.openingBalanceSide);
  const signedCurrent = signedAmount(row.balance, row.balanceSide);
  const debitMinusCreditMovement = signedCurrent - signedOpening;

  // Golden Coast cutover partner capital is economically credit-normal even
  // though the historical opening rows were stored on the Dr side.
  return openingMagnitude - debitMinusCreditMovement;
}

function withCreditNormalBalance(row: AccountsAllRow, claim: number): AccountsAllRow {
  return {
    ...row,
    balance: Math.abs(claim).toFixed(2),
    balanceSide: claim >= 0 ? "Cr" : "Dr",
  };
}

/**
 * Accounts Overview normally reports each ledger using its stored opening side.
 * Golden Coast is a special historical cutover: the partner-capital openings
 * were stored as Dr, while Phase 17 correctly presents them as credit-normal
 * partner claims and removes the legacy opening GC Sales Cash payable from
 * Fresh Start once.
 *
 * Keep the ledger untouched; only make /api/accounts/all use the same Golden
 * Coast presentation truth as Net Position.
 */
export function projectGoldenCoastAccountsEquity(body: AccountsAllResponse): AccountsAllResponse {
  if (!body || typeof body !== "object" || !Array.isArray(body.accounts)) return body;

  const rows = body.accounts as AccountsAllRow[];
  // Match Net Position role selection exactly: historical/retired Golden Coast
  // ledgers remain in /api/accounts/all, but must never win role selection over
  // the currently active capital/payable accounts.
  const activeRows = rows.filter((row) => row.active !== false && row.deletedAt == null);
  const fresh = activeRows.find((row) => row.subType === "gc_partner_capital");
  const hassan = activeRows.find((row) => row.subType === "gc_owner_capital");
  if (!fresh || !hassan) return body;

  const payableCandidates = activeRows.filter((row) => row.subType === "sp_payable");
  const gcSalesCash =
    payableCandidates.find((row) => /gc\s*sales\s*cash/i.test(row.name || "")) ??
    (payableCandidates.length === 1 ? payableCandidates[0] : undefined);

  const legacyOpeningPayable =
    gcSalesCash?.openingBalanceSide === "Cr" ? Math.abs(numberValue(gcSalesCash.openingBalance)) : 0;

  const freshClaim = creditNormalPartnerClaim(fresh) - legacyOpeningPayable;
  const hassanClaim = creditNormalPartnerClaim(hassan);

  return {
    ...body,
    accounts: rows.map((row) => {
      if (row === fresh) return withCreditNormalBalance(row, freshClaim);
      if (row === hassan) return withCreditNormalBalance(row, hassanClaim);
      return row;
    }),
  };
}

export function registerGoldenCoastAccountsEquityPresentation(app: Express): void {
  // Response middleware only: preserve the existing /api/accounts/all route and
  // route-manifest ordering while adjusting the final Accounts Overview payload.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path !== "/api/accounts/all") return next();

    const originalJson = res.json.bind(res);
    res.json = ((body: AccountsAllResponse) => originalJson(projectGoldenCoastAccountsEquity(body))) as typeof res.json;
    return next();
  });
}
