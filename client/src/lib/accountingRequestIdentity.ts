const ACCOUNTING_REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_ACCOUNTING_IDENTITIES = 100;

const pendingAccountingRequestIds = new Map<
  string,
  { requestId: string; createdAt: number }
>();

type AccountingRequestPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isActiveManualJournal(
  method: string,
  pathname: string,
  data: unknown
): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" &&
    pathname === "/api/vouchers/journal" &&
    isRecord(data) &&
    data.optional !== true
  );
}

function isActivePaymentReceipt(
  method: string,
  pathname: string,
  data: unknown
): data is AccountingRequestPayload {
  return (
    method.toUpperCase() === "POST" &&
    pathname === "/api/vouchers/payment-receipt" &&
    isRecord(data) &&
    data.optional !== true &&
    (data.voucherType === "Payment" || data.voucherType === "Receipt")
  );
}

function isActiveGenericVoucher(
  method: string,
  pathname: string,
  data: unknown
): data is AccountingRequestPayload {
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

export function isProtectedAccountingRequest(
  method: string,
  url: string,
  data: unknown
): data is AccountingRequestPayload {
  const pathname = url.split("?")[0];
  return (
    isActiveManualJournal(method, pathname, data) ||
    isActivePaymentReceipt(method, pathname, data) ||
    isActiveGenericVoucher(method, pathname, data)
  );
}

function createClientRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `accounting-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function accountingPayloadKey(
  method: string,
  url: string,
  data: AccountingRequestPayload
): string {
  const payload = { ...data };
  delete payload.clientRequestId;
  return `${method.toUpperCase()}:${url.split("?")[0]}:${JSON.stringify(payload)}`;
}

function prunePendingAccountingIdentities(): void {
  const cutoff = Date.now() - ACCOUNTING_REQUEST_TTL_MS;
  for (const [key, value] of pendingAccountingRequestIds) {
    if (value.createdAt < cutoff) pendingAccountingRequestIds.delete(key);
  }

  while (pendingAccountingRequestIds.size > MAX_PENDING_ACCOUNTING_IDENTITIES) {
    const oldestKey = pendingAccountingRequestIds.keys().next().value as string | undefined;
    if (!oldestKey) break;
    pendingAccountingRequestIds.delete(oldestKey);
  }
}

/**
 * Protected accounting writes receive a stable identity before the request is
 * sent. The same payload reuses its identity after an uncertain network result.
 * A successful response or definite 4xx rejection releases the identity; queued
 * JSON retains its own request ID and server-side replay protection.
 */
export function attachAccountingRequestIdentity(
  method: string,
  url: string,
  data: unknown
): unknown {
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
  }

  return { ...data, clientRequestId: requestId };
}

export function releaseAccountingRequestIdentity(
  method: string,
  url: string,
  data: unknown
): void {
  if (!isProtectedAccountingRequest(method, url, data)) return;
  pendingAccountingRequestIds.delete(accountingPayloadKey(method, url, data));
}

export function shouldReleaseAccountingRequestIdentity(status: number): boolean {
  return (status >= 200 && status < 400) || (status >= 400 && status < 500);
}
