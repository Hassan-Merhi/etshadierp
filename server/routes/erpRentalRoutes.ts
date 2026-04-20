import type { Express } from "express";
import { registerRentalRoutes } from "./rentalRouteFactory";

export function registerErpRentalRoutes(app: Express) {
  registerRentalRoutes(app, "ERP", "/api/erp/rental", "Rental Income - ERP", "Rent Expense - ERP Shops");
}
