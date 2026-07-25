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

const JOURNAL_REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_JOURNAL_IDENTITIES = 100;
const pendingJournalRequestIds = new Map<string, { requestId: string; createdAt: number }>();

// Remove stale loading-scan POSTs before factory screens mount and the offline
// banner has a chance to replay them. These mutations are not safe to defer.
purgeUnsafeFactoryLoadingScans();

function isAllowedFactoryPath(url: string): boolean {
  if (url.startsWith(FACTORY_PREFIX)) return true;
  return ALLOWED_SHARED_PREFIXES.some((p) => url.startsWith(p));
}

type RequestDelegate = (method: string, url: string, data?: unknown) => Promise<Response>;

function isActiveManualJournal(method: string, url: string, data: unknown): data is Record<string, unknown> {
  return (
    method.toUpperCase() === "POST" &&
    url.split("?")[0] === "/api/vouchers/journal" &&
    !!data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data as Record<string, unknown>).optional !== true
  );
}

function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `journal-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function journalPayloadKey(method: string, url: string, data: Record<string, unknown>): string {
  const { clientRequestId: _ignored, ...payload } = data;
  return `${method.toUpperCase()}:${url.split("?")[0]}:${JSON.stringify(payload)}`;
}

function prunePendingJournalIdentities(): void {
  const cutoff = Date.now() - JOURNAL_REQUEST_TTL_MS;
  for (const [key, value] of pendingJournalRequestIds) {
    if (value.createdAt < cutoff) pendingJournalRequestIds.delete(key);
  }

  while (pendingJournalRequestIds.size > MAX_PENDING_JOURNAL_IDENTITIES) {
    const oldestKey = pendingJournalRequestIds.keys().next().value;
    if (!oldestKey) break;
    pendingJournalRequestIds.delete(oldestKey);
  }
}

/**
 * Active manual journals receive a stable identity before apiRequest sees them.
 * The same payload reuses its identity after an uncertain network result. A
 * successful response, a definite client error, or safe offline queueing releases
 * the in-memory identity; the queued JSON body still keeps its own request ID.
 */
export function attachAccountingRequestIdentity(
  method: string,
  url: string,
  data: unknown
): unknown {
  if (!isActiveManualJournal(method, url, data)) return data;
  if (typeof data.clientRequestId === "string" && data.clientRequestId.trim()) return data;

  prunePendingJournalIdentities();
  const key = journalPayloadKey(method, url, data);
  const existing = pendingJournalRequestIds.get(key);
  const requestId = existing?.requestId || createClientRequestId();
  if (!existing) pendingJournalRequestIds.set(key, { requestId, createdAt: Date.now() });

  return { ...data, clientRequestId: requestId };
}

export function releaseAccountingRequestIdentity(method: string, url: string, data: unknown): void {
  if (!isActiveManualJournal(method, url, data)) return;
  pendingJournalRequestIds.delete(journalPayloadKey(method, url, data));
}

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
  const preparedData = freezeHistoricalReplayApplyRequest(method, url, data);
  const outboundData = attachAccountingRequestIdentity(method, url, preparedData);

  try {
    const response = await delegate(method, url, outboundData);
    releaseAccountingRequestIdentity(method, url, outboundData);
    if (prepareRequest && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      rememberHistoricalReplayPreparation(payload);
    }
    return response;
  } catch (error: any) {
    // OfflineQueued means the exact body (including clientRequestId) is persisted.
    // A 4xx is a definite rejection. Keep the identity only for network errors,
    // timeouts, and 5xx responses where the commit outcome may be uncertain.
    if (error?.name === "OfflineQueued" || (Number(error?.status) >= 400 && Number(error?.status) < 500)) {
      releaseAccountingRequestIdentity(method, url, outboundData);
    }
    throw error;
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
