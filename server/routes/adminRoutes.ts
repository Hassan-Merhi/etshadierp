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
import { requirePrivilegedOperation } from "../services/security/privilegedOperationEnforcementAdapter";
import {
  inventoryRebuildInputSchema,
  requireValidatedUnsafeInput,
} from "../services/security/unsafeInputEnforcementAdapter";
import { requireStoredFileAccess } from "../services/security/storedFileAccessAdapter";

export function registerAdminRoutes(app: Express) {
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
}
