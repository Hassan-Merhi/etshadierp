import type { Express } from "express";
import { registerRentalUnitsContractsRoutes } from "./rentalUnitsContractsRoutes";
import { registerCentralRentalPaymentDeletionRoute } from "./centralRentalPaymentDeletionRoute";
import { registerRentalPaymentsAccrualRoutes } from "./rentalPaymentsAccrualRoutes";
import { registerRentalAccrualConfigRoutes } from "./rentalAccrualConfigRoutes";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops"
) {
  registerRentalUnitsContractsRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerCentralRentalPaymentDeletionRoute(app, module, urlPrefix);
  registerRentalPaymentsAccrualRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalAccrualConfigRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
}
