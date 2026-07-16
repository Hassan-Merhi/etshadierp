import type { Express, Request, Response } from "express";
import { registerRentalUnitsContractsRoutes } from "./rental/rentalUnitsContractsRoutes";
import { registerRentalPaymentsAccrualRoutes } from "./rental/rentalPaymentsAccrualRoutes";
import { registerRentalAccrualConfigRoutes } from "./rental/rentalAccrualConfigRoutes";
import { runRentalReconciliation } from "../services/rental/rentalReconciliationService";
import { requireAuth } from "../auth";
import { getClientDate } from "../lib/dateUtils";
import { getCompanyId } from "./rental/_rentalShared";
export { ensureMonthlyForCompany, postRentAccrualForCompany } from "./rental/_rentalShared";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops"
) {
  registerRentalUnitsContractsRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalPaymentsAccrualRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalAccrualConfigRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);

  // ── Reconciliation endpoint (Admin / Developer only) ──
  app.get(`${urlPrefix}/reconciliation`, requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      // FIX #10: restrict to Administrator / Developer roles
      const userRole = (req.session as any)?.role;
      if (userRole !== "Admin" && userRole !== "Developer") {
        return res.status(403).json({ message: "Administrator or Developer role required" });
      }
      const asOf = (req.query.asOf as string | undefined) || getClientDate(req);
      const result = await runRentalReconciliation(companyId, module, asOf);
      res.json(result);
    } catch (e: any) {
      console.error(`[${module}/rental] reconciliation:`, e);
      res.status(500).json({ message: e.message });
    }
  });
}
