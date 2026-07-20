import type { Express, RequestHandler } from "express";
import Decimal from "decimal.js";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { requireAuth, requireNonPOS } from "../auth";
import { bankAccounts, companies, ledgerAccounts } from "@shared/schema";
import { normalizeOpeningBalanceCurrency } from "../services/accounting/openingBalanceCurrency";
import {
  getCashBankAccountSummary,
  getCashBankRevaluation,
} from "../services/accounting/cashBankRevaluationService";

const OPENING_FIELDS = [
  "openingBalance",
  "openingBalanceSide",
  "openingBalanceCurrency",
  "openingBalanceHistoricalRate",
  "openingBalanceBaseAmount",
] as const;

function hasOpeningPayload(body: Record<string, unknown>): boolean {
  return OPENING_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

async function getBaseCurrency(companyId: number): Promise<string> {
  const [company] = await db
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return company?.baseCurrency || "USD";
}

function normalizedOpeningPayload(
  body: Record<string, any>,
  existing: Record<string, any> | null,
  baseCurrency: string,
): Record<string, any> {
  const openingBalance = body.openingBalance ?? existing?.openingBalance ?? "0";
  const rawCurrency =
    body.openingBalanceCurrency ?? existing?.openingBalanceCurrency ?? baseCurrency;
  const normalized = normalizeOpeningBalanceCurrency({
    openingBalance,
    openingBalanceCurrency: rawCurrency,
    openingBalanceHistoricalRate:
      body.openingBalanceHistoricalRate ?? existing?.openingBalanceHistoricalRate,
    openingBalanceBaseAmount:
      body.openingBalanceBaseAmount ?? existing?.openingBalanceBaseAmount,
    baseCurrency,
  });
  return { ...body, ...normalized };
}

export const normalizeAccountOpeningBalance: RequestHandler = async (req, res, next) => {
  try {
    if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") return next();
    const isLedger = req.path === "/api/ledger-accounts" || /^\/api\/ledger-accounts\/\d+$/.test(req.path);
    const isBank = req.path === "/api/bank-accounts" || /^\/api\/bank-accounts\/\d+$/.test(req.path);
    if (!isLedger && !isBank) return next();
    if (!hasOpeningPayload(req.body || {})) return next();

    const companyId = req.session.currentCompanyId ?? Number(req.body?.companyId);
    if (!companyId) return res.status(400).json({ message: "No company selected" });
    const baseCurrency = await getBaseCurrency(companyId);

    let existing: Record<string, any> | null = null;
    const idMatch = req.path.match(/\/(\d+)$/);
    if (idMatch) {
      const id = Number.parseInt(idMatch[1], 10);
      const table = isLedger ? ledgerAccounts : bankAccounts;
      const rows = await db
        .select()
        .from(table as any)
        .where(and(eq((table as any).id, id), eq((table as any).companyId, companyId)))
        .limit(1);
      existing = (rows[0] as any) || null;
      if (!existing) return res.status(404).json({ message: "Account not found" });
    }

    req.body = normalizedOpeningPayload(req.body || {}, existing, baseCurrency);
    return next();
  } catch (error: any) {
    return res.status(400).json({ message: error.message });
  }
};

async function getHistoricalLedgerBalance(companyId: number, ledgerAccountId: number) {
  const [account] = await db
    .select()
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.id, ledgerAccountId),
        eq(ledgerAccounts.companyId, companyId),
        isNull(ledgerAccounts.deletedAt),
      ),
    )
    .limit(1);
  if (!account) return null;

  const result = await pool.query<{
    historical_net: string;
    unresolved_count: string;
    unresolved_raw_net: string;
  }>(
    `SELECT
       COALESCE(SUM(
         CASE
           WHEN ve.base_debit_amount IS NOT NULL OR ve.base_credit_amount IS NOT NULL
             THEN COALESCE(ve.base_debit_amount, 0)::numeric - COALESCE(ve.base_credit_amount, 0)::numeric
           WHEN COALESCE(UPPER(v.currency), 'USD') = 'USD'
             THEN COALESCE(ve.debit_amount, 0)::numeric - COALESCE(ve.credit_amount, 0)::numeric
           ELSE 0::numeric
         END
       ), 0)::text AS historical_net,
       COALESCE(SUM(
         CASE WHEN ve.base_debit_amount IS NULL AND ve.base_credit_amount IS NULL
                    AND COALESCE(UPPER(v.currency), 'USD') <> 'USD'
              THEN 1 ELSE 0 END
       ), 0)::text AS unresolved_count,
       COALESCE(SUM(
         CASE WHEN ve.base_debit_amount IS NULL AND ve.base_credit_amount IS NULL
                    AND COALESCE(UPPER(v.currency), 'USD') <> 'USD'
              THEN COALESCE(ve.debit_amount, 0)::numeric - COALESCE(ve.credit_amount, 0)::numeric
              ELSE 0::numeric END
       ), 0)::text AS unresolved_raw_net
     FROM voucher_entries ve
     JOIN vouchers v ON v.id = ve.voucher_id
     WHERE ve.ledger_account_id = $1
       AND v.company_id = $2
       AND v.optional = false
       AND v.deleted_at IS NULL`,
    [ledgerAccountId, companyId],
  );

  let historicalBalance = new Decimal(result.rows[0]?.historical_net || 0);
  const openingRaw = new Decimal(account.openingBalance || 0);
  const openingBalanceCurrencyUnresolved = !openingRaw.isZero() && !account.openingBalanceBaseAmount;
  if (!openingBalanceCurrencyUnresolved && !openingRaw.isZero()) {
    const openingBase = new Decimal(account.openingBalanceBaseAmount || 0);
    historicalBalance = historicalBalance.plus(account.openingBalanceSide === "Cr" ? openingBase.neg() : openingBase);
  }

  return {
    account,
    historicalBaseBalance: historicalBalance.toDecimalPlaces(6).toFixed(6),
    unresolvedLegacyEntryCount: Number.parseInt(result.rows[0]?.unresolved_count || "0", 10) || 0,
    unresolvedLegacyNetRaw: new Decimal(result.rows[0]?.unresolved_raw_net || 0).toDecimalPlaces(6).toFixed(6),
    openingBalanceCurrencyUnresolved,
    unresolvedOpeningBalanceRaw: openingBalanceCurrencyUnresolved
      ? (account.openingBalanceSide === "Cr" ? openingRaw.neg() : openingRaw).toDecimalPlaces(6).toFixed(6)
      : null,
  };
}

export function registerAccountCurrencyRoutes(app: Express) {
  // Must register before the legacy account/bank routes. These handlers intentionally
  // use the existing URLs so old clients receive safe results without a migration.
  app.get("/api/bank-accounts/revaluation", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      return res.json(await getCashBankRevaluation(companyId));
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/accounts/ledger/:id/balance", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid account ID" });

      const cashSummary = await getCashBankAccountSummary(companyId, "ledger", id);
      if (cashSummary) {
        const displayBalance = cashSummary.currentTranslatedBaseBalance ?? cashSummary.historicalBaseBalance;
        return res.json({
          balance: Number(displayBalance),
          ...cashSummary,
        });
      }

      const historical = await getHistoricalLedgerBalance(companyId, id);
      if (historical) {
        return res.json({
          balance: Number(historical.historicalBaseBalance),
          historicalBaseBalance: historical.historicalBaseBalance,
          currentTranslatedBaseBalance: null,
          translationDifference: null,
          nativeBalancesByCurrency: {},
          totalsProvisional:
            historical.openingBalanceCurrencyUnresolved || historical.unresolvedLegacyEntryCount > 0,
          ...historical,
        });
      }

      const bankSummary = await getCashBankAccountSummary(companyId, "bank", id);
      if (!bankSummary) return res.status(404).json({ message: "Account not found" });
      const displayBalance = bankSummary.currentTranslatedBaseBalance ?? bankSummary.historicalBaseBalance;
      return res.json({ balance: Number(displayBalance), ...bankSummary });
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/accounts/ledger/:id/currency-balances", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid account ID" });
      const summary =
        (await getCashBankAccountSummary(companyId, "ledger", id)) ||
        (await getCashBankAccountSummary(companyId, "bank", id));
      if (!summary) return res.json([]);
      return res.json(
        Object.entries(summary.nativeBalancesByCurrency).map(([currency, net]) => {
          const value = new Decimal(net);
          return {
            currency,
            totalDebit: value.gte(0) ? value.toNumber() : 0,
            totalCredit: value.lt(0) ? value.abs().toNumber() : 0,
            net: value.toNumber(),
            historicalBaseBalance: summary.historicalBaseBalance,
            currentTranslatedBaseBalance: summary.currentTranslatedBaseBalance,
            translationDifference: summary.translationDifference,
            totalsProvisional: summary.totalsProvisional,
          };
        }),
      );
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });
}
