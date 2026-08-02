import type { Express } from "express";
import { registerDeletedItemsRoutes } from "./deleted-items";
import { registerAdminRepairRoutes } from "./repair";
import { registerAdminPoFixRoutes } from "./adminPoFixRoutes";

export function registerDataToolsRoutes(app: Express) {
  registerDeletedItemsRoutes(app);
  registerAdminRepairRoutes(app);
  registerAdminPoFixRoutes(app);
}
