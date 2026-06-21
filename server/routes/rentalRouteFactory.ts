import type { Express } from "express";
import { registerRentalUnitsContractsRoutes } from "./rental/rentalUnitsContractsRoutes";
import { registerRentalPaymentsAccrualRoutes } from "./rental/rentalPaymentsAccrualRoutes";
import { registerRentalAccrualConfigRoutes } from "./rental/rentalAccrualConfigRoutes";

type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export function registerRentalRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops",
) {
  registerRentalUnitsContractsRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalPaymentsAccrualRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
  registerRentalAccrualConfigRoutes(app, module, urlPrefix, incomeAccountName, shopExpenseAccountName);
}
