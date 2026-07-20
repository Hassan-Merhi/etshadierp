import { queryClient, apiRequest } from "./queryClient";
import {
  isUnsafeFactoryLoadingScanRequest,
  purgeUnsafeFactoryLoadingScans,
} from "./factoryOfflineQueueSafety";
import {
  forgetHistoricalReplayPreparation,
  freezeHistoricalReplayApplyRequest,
  historicalReplayTokenFromRequest,
  isHistoricalReplayPrepareRequest,
  rememberHistoricalReplayPreparation,
} from "./historicalReplayPreparedRequest";

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

type RequestDelegate = (method: string, url: string, data?: unknown) => Promise<Response>;

/**
 * Shared replay guard for both ERP and Factory app modes. The UI may pass current
 * checkbox state, but a token-backed apply is rebuilt from the server-prepared
 * frozen state before it reaches apiRequest.
 */
async function requestWithPreparedReplayState(
  delegate: RequestDelegate,
  method: string,
  url: string,
  data?: unknown
): Promise<Response> {
  const prepareRequest = isHistoricalReplayPrepareRequest(method, url, data);
  const token = historicalReplayTokenFromRequest(method, url, data);
  const outboundData = freezeHistoricalReplayApplyRequest(method, url, data);
  try {
    const response = await delegate(method, url, outboundData);
    if (prepareRequest && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      rememberHistoricalReplayPreparation(payload);
    }
    return response;
  } finally {
    // A token apply is intentionally one-shot in the client. On any response or
    // network error, force a fresh Prepare rather than reusing potentially stale
    // review state. The server independently enforces one-time use transactionally.
    if (token) forgetHistoricalReplayPreparation(token);
  }
}

async function factoryApiRequestBase(method: string, url: string, data?: unknown): Promise<Response> {
  if (!isAllowedFactoryPath(url)) {
    const msg = `[factoryApi] BLOCKED: Factory mode attempted non-factory endpoint: ${method} ${url}`;
    console.error(msg);
    if (import.meta.env.DEV) {
      throw new Error(msg);
    }
  }

  const unsafeLoadingScan = isUnsafeFactoryLoadingScanRequest(method, url);
  purgeUnsafeFactoryLoadingScans();

  try {
    return await apiRequest(method, url, data);
  } catch (error: any) {
    if (unsafeLoadingScan && error?.name === "OfflineQueued") {
      purgeUnsafeFactoryLoadingScans();
      const onlineOnlyError: any = new Error(
        "Loading scans require an internet connection. Reconnect and scan this bale again; it was not queued."
      );
      onlineOnlyError.name = "OnlineRequired";
      throw onlineOnlyError;
    }
    throw error;
  } finally {
    // apiRequest may have just queued a network-failed loading scan. Remove it
    // immediately so reconnecting cannot allocate a stale or different bale.
    purgeUnsafeFactoryLoadingScans();
  }
}

export function factoryApiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  return requestWithPreparedReplayState(factoryApiRequestBase, method, url, data);
}

export const factoryQueryClient = queryClient;

export function resolveApiPath(erpPath: string, factoryPath: string, mode: AppMode): string {
  return mode === "factory" ? factoryPath : erpPath;
}

export function getApiRequest(mode: AppMode): RequestDelegate {
  if (mode === "factory") return factoryApiRequest;
  return (method, url, data) => requestWithPreparedReplayState(apiRequest, method, url, data);
}
