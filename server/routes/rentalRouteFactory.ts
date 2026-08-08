import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../lib/httpHandlers";
import { logger } from "../lib/logger";
import { registerRentalUnitsContractsRoutes } from "./rental/units-contracts";
import { registerCentralRentalPaymentDeletionRoute } from "./rental/centralRentalPaymentDeletionRoute";
import { registerRentalPaymentsAccrualRoutes } from "./rental/rentalPaymentsAccrualRoutes";
import { registerRentalAccrualConfigRoutes } from "./rental/rentalAccrualConfigRoutes";
import { runRentalReconciliation } from "../services/rental/rentalReconciliationService";
import { reclassifyLegacyDeferredRentForProperties } from "../services/rental/reclassifyDeferredRentService";
import { requireAuth } from "../auth";
import { getClientDate } from "../lib/dateUtils";
import { getCompanyId } from "./rental/shared";
export { ensureMonthlyForCompany, postRentAccrualForCompany } from "./rental/shared";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops"
) {
  // Properties-mode landlord accounting now recognises rent immediately on receipt.
  // Run the legacy Deferred Rent Revenue cleanup automatically at route startup.
  // If startup happens before a fresh database is fully ready, the middleware below
  // retries on the first Properties request. A successful run becomes a process no-op.
  if (module === "PROPERTIES") {
    const ensurePropertiesIncomeCleanup = () =>
      reclassifyLegacyDeferredRentForProperties().catch((error: unknown) => {
        logger.error("[PROPERTIES/rental] deferred-rent reclassification failed", {
          error: getErrorMessage(error),
        });
      });

    void ensurePropertiesIncomeCleanup();
    app.use(urlPrefix, (_req, _res, next) => {
      void ensurePropertiesIncomeCleanup();
      next();
    });
  }

  registerRentalUnitsContractsRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  // The central route owns DELETE /payments/:id. Registration order keeps the
  // legacy creation, bulk, detail, and accrual handlers unchanged.
  registerCentralRentalPaymentDeletionRoute(app, module, urlPrefix);
  registerRentalPaymentsAccrualRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalAccrualConfigRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);

  // ── Reconciliation endpoint (Admin / Developer only) ──
  app.get(`${urlPrefix}/reconciliation`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      // Authentication stores the active role in currentRole. Keep the legacy
      // role fallback for older sessions while enforcing the same Admin/Developer gate.
      const session = req.session as any;
      const userRole = session?.currentRole ?? session?.role;
      if (userRole !== "Admin" && userRole !== "Developer") {
        return res.status(403).json({ message: "Administrator or Developer role required" });
      }
      const asOf = (req.query.asOf as string | undefined) || getClientDate(req);
      const result = await runRentalReconciliation(companyId, module, asOf);
      res.json(result);
    } catch (e: unknown) {
      logger.error(`[${module}/rental] reconciliation:`, { error: e });
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });
}
