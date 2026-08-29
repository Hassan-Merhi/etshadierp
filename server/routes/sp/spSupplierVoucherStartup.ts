import { runWithDatabaseMaintenanceScope } from "../../services/security/databaseScopeRuntimeContext";
import {
  ensureSpSupplierVoucherSyncTrigger,
  repairSpSupplierVoucherLinks,
} from "./spSupplierVoucherSync";

type SpSupplierVoucherStartupDependencies = {
  ensureTrigger: () => Promise<void>;
  repairLinks: () => Promise<number>;
  runMaintenanceScope: (reason: string, callback: () => Promise<number>) => Promise<number>;
};

const defaultDependencies: SpSupplierVoucherStartupDependencies = {
  ensureTrigger: ensureSpSupplierVoucherSyncTrigger,
  repairLinks: () => repairSpSupplierVoucherLinks(),
  runMaintenanceScope: (reason, callback) => runWithDatabaseMaintenanceScope(reason, callback),
};

/**
 * Runs the process-owned Supplier Partner voucher-link startup repair with an
 * explicit maintenance identity. Request-time setup/migration repairs continue
 * to use their verified tenant scope and never pass through this helper.
 */
export async function runSpSupplierVoucherStartup(
  dependencies: SpSupplierVoucherStartupDependencies = defaultDependencies
): Promise<number> {
  return dependencies.runMaintenanceScope("sp-supplier-voucher-sync-startup", async () => {
    await dependencies.ensureTrigger();
    return dependencies.repairLinks();
  });
}
