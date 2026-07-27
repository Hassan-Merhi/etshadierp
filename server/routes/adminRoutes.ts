import type { Express } from "express";
import { registerDataToolsRoutes } from "./admin/dataToolsRoutes";
import { registerUserManagementRoutes } from "./admin/userManagementRoutes";
import { registerCompanySettingsRoutes } from "./admin/companySettingsRoutes";
import { registerImportExportRoutes } from "./admin/importExportRoutes";
import { registerAdminPoFixRoutes } from "./admin/adminPoFixRoutes";
import { registerAdminRepairRoutes } from "./admin/adminRepairRoutes";
import { registerDeletedItemsRoutes } from "./admin/deletedItemsRoutes";
import { registerSecurityAnomalyRoutes } from "./admin/securityAnomalyRoutes";
import { registerSecurityPermissionRoutes } from "./admin/securityPermissionRoutes";
import { registerSchemaDiagnosticRoutes } from "./admin/schemaDiagnosticRoutes";
import { requirePrivilegedOperation } from "../services/security/privilegedOperationEnforcementAdapter";
import {
  inventoryRebuildInputSchema,
  requireValidatedUnsafeInput,
} from "../services/security/unsafeInputEnforcementAdapter";
import { requireStoredFileAccess } from "../services/security/storedFileAccessAdapter";
import { enforceAdminCompanyScope } from "../middleware/adminCompanyScopeGuard";

export function registerAdminRoutes(app: Express) {
  // Admin, repair, import/export, deleted-record, and schema tools must remain in
  // the server-owned active company even when a legacy caller supplies companyId.
  for (const path of [
    "/api/admin",
    "/api/orphaned-records",
    "/api/location-summary",
    "/api/deleted-items",
    "/api/files",
  ]) {
    app.use(path, enforceAdminCompanyScope);
  }

  app.use(
    "/api/admin/rebuild-inventory",
    requireValidatedUnsafeInput({
      operation: "inventory.rebuild",
      schema: inventoryRebuildInputSchema,
    }),
    requirePrivilegedOperation({
      domain: "inventory",
      action: "inventory.rebuild",
      kind: "recalculate",
      requiredPermission: "administration.repair",
      sourceType: "inventory-rebuild-request",
      expectedConfirmationToken: (companyId) => `REBUILD-INVENTORY:${companyId}`,
      allowDryRun: true,
    })
  );

  app.use("/api/files/:id/download", requireStoredFileAccess("download"));
  app.use("/api/files/:id/preview", requireStoredFileAccess("read"));

  registerDataToolsRoutes(app);
  registerUserManagementRoutes(app);
  registerCompanySettingsRoutes(app);
  registerImportExportRoutes(app);
  registerAdminPoFixRoutes(app);
  registerAdminRepairRoutes(app);
  registerDeletedItemsRoutes(app);
  registerSecurityAnomalyRoutes(app);
  registerSecurityPermissionRoutes(app);
  registerSchemaDiagnosticRoutes(app);
}
