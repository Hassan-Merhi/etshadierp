const JOURNAL_REQUEST_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING_JOURNAL_IDENTITIES = 100;

const pendingJournalRequestIds = new Map<
  string,
  { requestId: string; createdAt: number }
>();

function isActiveManualJournal(
  method: string,
  url: string,
  data: unknown
): data is Record<string, unknown> {
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

function journalPayloadKey(
  method: string,
  url: string,
  data: Record<string, unknown>
): string {
  const payload = { ...data };
  delete payload.clientRequestId;
  return `${method.toUpperCase()}:${url.split("?")[0]}:${JSON.stringify(payload)}`;
}

function prunePendingJournalIdentities(): void {
  const cutoff = Date.now() - JOURNAL_REQUEST_TTL_MS;
  for (const [key, value] of pendingJournalRequestIds) {
    if (value.createdAt < cutoff) pendingJournalRequestIds.delete(key);
  }

  while (pendingJournalRequestIds.size > MAX_PENDING_JOURNAL_IDENTITIES) {
    const oldestKey = pendingJournalRequestIds.keys().next().value as string | undefined;
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
  if (typeof data.clientRequestId === "string" && data.clientRequestId.trim()) {
    return data;
  }

  prunePendingJournalIdentities();
  const key = journalPayloadKey(method, url, data);
  const existing = pendingJournalRequestIds.get(key);
  const requestId = existing?.requestId || createClientRequestId();
  if (!existing) {
    pendingJournalRequestIds.set(key, { requestId, createdAt: Date.now() });
  }

  return { ...data, clientRequestId: requestId };
}

export function releaseAccountingRequestIdentity(
  method: string,
  url: string,
  data: unknown
): void {
  if (!isActiveManualJournal(method, url, data)) return;
  pendingJournalRequestIds.delete(journalPayloadKey(method, url, data));
}
