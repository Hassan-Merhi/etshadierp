import type { Express } from "express";
import { registerDeletedItemsRoutes } from "./deletedItemsRoutes";
import { registerAdminRepairRoutes } from "./adminRepairRoutes";
import { registerAdminPoFixRoutes } from "./adminPoFixRoutes";

export function registerDataToolsRoutes(app: Express) {
  registerDeletedItemsRoutes(app);
  registerAdminRepairRoutes(app);
  registerAdminPoFixRoutes(app);
}
