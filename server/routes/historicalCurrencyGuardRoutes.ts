import type { Express, RequestHandler } from "express";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { requireAuth, requireNonPOS } from "../auth";
import { getHistoricalCurrencyReadiness } from "../services/accounting/historicalCurrencyReadiness";

function isGuardedFinancialPath(pathname: string): boolean {
  // Only guard reports that aggregate across currencies and therefore require
  // complete historical base amounts. Per-account statements preserve their
  // own currency presentation and remain available for investigation.
  return (
    pathname === "/api/stats/net-profit" ||
    pathname.startsWith("/api/stats/net-position") ||
    pathname.startsWith("/api/reports/net-position") ||
    pathname.startsWith("/api/reports/net-profit")
  );
}

export const guardUnresolvedHistoricalCurrency: RequestHandler = async (req, res, next) => {
  if (req.method !== "GET" || !isGuardedFinancialPath(req.path)) return next();
  const companyId = req.session.currentCompanyId;
  if (!companyId) return next();

  try {
    const asOfDate = typeof req.query.toDate === "string"
      ? req.query.toDate
      : typeof req.query.endDate === "string"
        ? req.query.endDate
        : null;
    const readiness = await getHistoricalCurrencyReadiness(companyId, asOfDate);
    if (readiness.ready) return next();

    return res.status(409).json({
      code: "HISTORICAL_CURRENCY_DATA_UNRESOLVED",
      message:
        "This financial report is protected because historical foreign-currency entries, opening balances, or asset values are incomplete. " +
        "Open Accounts → Historical Currency Stabilization, preview only the supported repairs, review ambiguous vouchers, and apply the signed plan.",
      readiness,
      repairCenterPath: "/api/accounts/multi-currency/repair-center",
      readinessChecked: true,
    });
  } catch (error: unknown) {
    logger.error("Historical currency readiness check failed:", { error });
    return res.status(500).json({
      code: "HISTORICAL_CURRENCY_READINESS_FAILED",
      message: getErrorMessage(error),
    });
  }
};

export function registerHistoricalCurrencyGuardRoutes(app: Express) {
  app.use(guardUnresolvedHistoricalCurrency);

  app.get(
    "/api/accounts/multi-currency/readiness",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const asOfDate = typeof req.query.toDate === "string" ? req.query.toDate : null;
        return res.json(await getHistoricalCurrencyReadiness(companyId, asOfDate));
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );
}
