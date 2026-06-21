import type { Express } from "express";
import { registerDataToolsRoutes } from "./admin/dataToolsRoutes";
import { registerUserManagementRoutes } from "./admin/userManagementRoutes";
import { registerCompanySettingsRoutes } from "./admin/companySettingsRoutes";
import { registerImportExportRoutes } from "./admin/importExportRoutes";

export function registerAdminRoutes(app: Express) {
  registerDataToolsRoutes(app);
  registerUserManagementRoutes(app);
  registerCompanySettingsRoutes(app);
  registerImportExportRoutes(app);
}
