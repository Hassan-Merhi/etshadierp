import type { Express } from "express";
import { registerDataToolsRoutes } from "./admin/dataToolsRoutes";
import { registerUserManagementRoutes } from "./admin/userManagementRoutes";
import { registerCompanySettingsRoutes } from "./admin/companySettingsRoutes";
import { registerImportExportRoutes } from "./admin/importExportRoutes";
import { registerAdminPoFixRoutes } from "./admin/adminPoFixRoutes";
import { registerAdminRepairRoutes } from "./admin/adminRepairRoutes";
import { registerDeletedItemsRoutes } from "./admin/deletedItemsRoutes";

export function registerAdminRoutes(app: Express) {
  registerDataToolsRoutes(app);
  registerUserManagementRoutes(app);
  registerCompanySettingsRoutes(app);
  registerImportExportRoutes(app);
  registerAdminPoFixRoutes(app);
  registerAdminRepairRoutes(app);
  registerDeletedItemsRoutes(app);
}
