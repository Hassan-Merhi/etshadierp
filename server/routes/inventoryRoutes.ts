import type { Express } from "express";

import { registerInventoryMovementRoutes } from "./inventory-movement";
import { registerInventoryListRoutes } from "./inventory/inventoryListRoutes";
import { registerInventoryQuickAdjustRoutes } from "./inventory/inventoryQuickAdjustRoutes";

export function registerInventoryRoutes(app: Express) {
  registerInventoryListRoutes(app);
  registerInventoryQuickAdjustRoutes(app);
  registerInventoryMovementRoutes(app);
}
