import type { Express } from "express";
import { registerRentalRoutes } from "./rentalRouteFactory";

export function registerPropertiesRentalRoutes(app: Express) {
  registerRentalRoutes(
    app,
    "PROPERTIES",
    "/api/properties/rental",
    "Rental Income - Properties",
    "Rent Expense - Property Shops"
  );
}
