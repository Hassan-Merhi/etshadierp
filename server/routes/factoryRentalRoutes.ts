import type { Express } from "express";
import { registerRentalRoutes } from "./rentalRouteFactory";

export function registerFactoryRentalRoutes(app: Express) {
  registerRentalRoutes(
    app,
    "FACTORY",
    "/api/factory/rental",
    "Rental Income - Factory",
    "Rent Expense - Factory Shops"
  );
}
