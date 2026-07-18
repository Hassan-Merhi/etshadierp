import { queryClient, apiRequest } from "./queryClient";
import { purgeUnsafeFactoryLoadingScans } from "./factoryOfflineQueueSafety";

export type AppMode = "erp" | "factory" | "properties";

const FACTORY_PREFIX = "/api/factory/";
const ALLOWED_SHARED_PREFIXES = [
  "/api/locations",
  "/api/barcode",
  "/api/auth",
  "/api/company",
  "/api/lookup",
  "/api/chat",
  "/api/bale-transfers",
  "/api/accounts",
  "/api/ledger-accounts",
  "/api/bank-accounts",
  "/api/vouchers",
  "/api/voucher-detail",
  "/api/stock-items",
  "/api/stock-groups",
  "/api/stock-adjustments",
  "/api/stock-transfers",
  "/api/stock-transfer-import",
  "/api/containers",
  "/api/suppliers",
  "/api/customers",
  "/api/employees",
  "/api/employee-groups",
  "/api/worker-groups",
  "/api/stats",
  "/api/financial",
  "/api/reports",
  "/api/dashboard",
  "/api/companies",
  "/api/payroll",
  "/api/company-settings",
  "/api/bale-label-prints",
  "/api/deleted-items",
  "/api/orphaned-records",
  "/api/stock-group-archives",
  "/api/admin",
  "/api/whatsapp",
  "/api/my-erp-pages",
];

// Remove stale loading-scan POSTs before factory screens mount and the offline
// banner has a chance to replay them. These mutations are not safe to defer.
purgeUnsafeFactoryLoadingScans();

function isAllowedFactoryPath(url: string): boolean {
  if (url.startsWith(FACTORY_PREFIX)) return true;
  return ALLOWED_SHARED_PREFIXES.some((p) => url.startsWith(p));
}

export async function factoryApiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  if (!isAllowedFactoryPath(url)) {
    const msg = `[factoryApi] BLOCKED: Factory mode attempted non-factory endpoint: ${method} ${url}`;
    console.error(msg);
    if (import.meta.env.DEV) {
      throw new Error(msg);
    }
  }

  purgeUnsafeFactoryLoadingScans();
  try {
    return await apiRequest(method, url, data);
  } finally {
    // apiRequest may have just queued a network-failed loading scan. Remove it
    // immediately so reconnecting cannot allocate a stale or different bale.
    purgeUnsafeFactoryLoadingScans();
  }
}

export const factoryQueryClient = queryClient;

export function resolveApiPath(erpPath: string, factoryPath: string, mode: AppMode): string {
  return mode === "factory" ? factoryPath : erpPath;
}

export function getApiRequest(mode: AppMode) {
  return mode === "factory" ? factoryApiRequest : apiRequest;
}
