import type { Express } from "express";
import { registerRawStockReceiptRoutes } from "./rawStockReceiptRoutes";
import { registerRawStockAvailableContainerRoutes } from "./rawStockAvailableContainerRoutes";
import { registerRawStockAdjRoutes } from "./rawStockAdjRoutes";

export function registerRawStockCrudRoutes(app: Express) {
  registerRawStockReceiptRoutes(app);
  // Register the corrected endpoint before the legacy adjustment module, whose
  // duplicate handler remains temporarily for compatibility but is unreachable.
  registerRawStockAvailableContainerRoutes(app);
  registerRawStockAdjRoutes(app);
}
