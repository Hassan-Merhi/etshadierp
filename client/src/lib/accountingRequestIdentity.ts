const ACCOUNTING_REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_ACCOUNTING_IDENTITIES = 100;
const ACCOUNTING_REQUEST_STORAGE_KEY = "erp_pending_accounting_request_ids_v2";

const pendingAccountingRequestIds = new Map<string, { requestId: string; createdAt: number }>();

type AccountingRequestPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isActiveManualJournal(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" &&
    (pathname === "/api/vouchers/journal" || pathname === "/api/vouchers/journal-entries") &&
    isRecord(data) &&
    data.optional !== true
  );
}

function isActivePaymentReceipt(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" &&
    pathname === "/api/vouchers/payment-receipt" &&
    isRecord(data) &&
    data.optional !== true &&
    (data.voucherType === "Payment" || data.voucherType === "Receipt")
  );
}

function isActiveDirectVoucher(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  return method.toUpperCase() === "POST" && pathname === "/api/vouchers" && isRecord(data) && data.optional !== true;
}

function isActiveGenericVoucher(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  if (
    method.toUpperCase() !== "POST" ||
    pathname !== "/api/vouchers/with-entries" ||
    !isRecord(data) ||
    !isRecord(data.voucher)
  ) {
    return false;
  }

  return data.voucher.optional !== true;
}

function isCompanyTransfer(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" &&
    (pathname === "/api/simple-company-transfer" || pathname === "/api/inter-company-transfers") &&
    isRecord(data)
  );
}

function isActiveStockTransfer(method: string, pathname: string, data: unknown): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" && pathname === "/api/stock-transfers" && isRecord(data) && data.voucherId == null
  );
}

function isPhase4OperationalAccountingRequest(
  method: string,
  pathname: string,
  data: unknown
): data is AccountingRequestPayload {
  if (method.toUpperCase() !== "POST" || !isRecord(data)) return false;

  if (pathname === "/api/salary-advances" || pathname.startsWith("/api/salary-advances/")) return true;
  if (pathname.startsWith("/api/erp-payroll/")) return true;
  if (pathname.startsWith("/api/payroll/")) return true;
  if (pathname.startsWith("/api/employees/") && /(?:salary|advance)/i.test(pathname)) return true;
  if (pathname === "/api/factory/supplier-payments") return true;
  if (pathname.startsWith("/api/factory/employee")) return true;
  if (pathname.startsWith("/api/factory/pos")) return true;
  if (pathname === "/api/factory/advances" || pathname.startsWith("/api/factory/advances/")) return true;
  if (/^\/api\/factory\/workers\/[^/]+\/bulk-repay-advances$/.test(pathname)) return true;
  if (pathname === "/api/factory/payrolls/mark-paid-bulk") return true;

  return false;
}

export function isProtectedAccountingRequest(
  method: string,
  url: string,
  data: unknown
): data is AccountingRequestPayload {
  const pathname = url.split("?")[0];
  return (
    isActiveManualJournal(method, pathname, data) ||
    isActivePaymentReceipt(method, pathname, data) ||
    isActiveDirectVoucher(method, pathname, data) ||
    isActiveGenericVoucher(method, pathname, data) ||
    isCompanyTransfer(method, pathname, data) ||
    isActiveStockTransfer(method, pathname, data) ||
    isPhase4OperationalAccountingRequest(method, pathname, data)
  );
}

function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `accounting-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function accountingPayloadKey(method: string, url: string, data: AccountingRequestPayload): string {
  const payload = { ...data };
  delete payload.clientRequestId;
  return `${method.toUpperCase()}:${url.split("?")[0]}:${JSON.stringify(payload)}`;
}

function persistPendingAccountingIdentities(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ACCOUNTING_REQUEST_STORAGE_KEY, JSON.stringify([...pendingAccountingRequestIds.entries()]));
  } catch {
    // Storage may be unavailable (privacy mode / quota). In-memory reuse still works.
  }
}

function hydratePendingAccountingIdentities(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(ACCOUNTING_REQUEST_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry;
      if (typeof key !== "string" || !isRecord(value)) continue;
      if (typeof value.requestId !== "string" || typeof value.createdAt !== "number") continue;
      pendingAccountingRequestIds.set(key, { requestId: value.requestId, createdAt: value.createdAt });
    }
  } catch {
    // Ignore corrupt/stale browser storage and start clean.
  }
}

function prunePendingAccountingIdentities(): void {
  const cutoff = Date.now() - ACCOUNTING_REQUEST_TTL_MS;
  let changed = false;
  for (const [key, value] of pendingAccountingRequestIds) {
    if (value.createdAt < cutoff) {
      pendingAccountingRequestIds.delete(key);
      changed = true;
    }
  }

  while (pendingAccountingRequestIds.size > MAX_PENDING_ACCOUNTING_IDENTITIES) {
    const oldestKey = pendingAccountingRequestIds.keys().next().value as string | undefined;
    if (!oldestKey) break;
    pendingAccountingRequestIds.delete(oldestKey);
    changed = true;
  }

  if (changed) persistPendingAccountingIdentities();
}

hydratePendingAccountingIdentities();
prunePendingAccountingIdentities();

export function attachAccountingRequestIdentity(method: string, url: string, data: unknown): unknown {
  if (!isProtectedAccountingRequest(method, url, data)) return data;
  if (typeof data.clientRequestId === "string" && data.clientRequestId.trim()) {
    return data;
  }

  prunePendingAccountingIdentities();
  const key = accountingPayloadKey(method, url, data);
  const existing = pendingAccountingRequestIds.get(key);
  const requestId = existing?.requestId || createClientRequestId();
  if (!existing) {
    pendingAccountingRequestIds.set(key, { requestId, createdAt: Date.now() });
    persistPendingAccountingIdentities();
  }

  return { ...data, clientRequestId: requestId };
}

export function releaseAccountingRequestIdentity(method: string, url: string, data: unknown): void {
  if (!isProtectedAccountingRequest(method, url, data)) return;
  pendingAccountingRequestIds.delete(accountingPayloadKey(method, url, data));
  persistPendingAccountingIdentities();
}

export function shouldReleaseAccountingRequestIdentity(status: number): boolean {
  return (status >= 200 && status < 400) || (status >= 400 && status < 500);
}
