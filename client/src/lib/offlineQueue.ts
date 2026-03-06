const QUEUE_KEY = "erp_offline_queue";
const LAST_SYNCED_KEY = "erp_last_synced";
const QUEUE_WARN_THRESHOLD = 50;

export type QueueItemStatus = "pending" | "failed";

export interface QueueItem {
  id: string;
  url: string;
  method: string;
  body: string;
  description: string;
  timestamp: number;
  status: QueueItemStatus;
  failReason?: string;
}

function readQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function getQueue(): QueueItem[] {
  return readQueue();
}

export function enqueueRequest(
  url: string,
  method: string,
  body: string,
  description: string
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item: QueueItem = { id, url, method, body, description, timestamp: Date.now(), status: "pending" };
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);

  if (queue.length === QUEUE_WARN_THRESHOLD) {
    queueSizeWarningCallbacks.forEach((cb) => cb(queue.length));
  }

  return id;
}

export function updateItemStatus(id: string, status: QueueItemStatus, failReason?: string): void {
  const queue = readQueue().map((item) =>
    item.id === id ? { ...item, status, failReason: failReason ?? item.failReason } : item
  );
  writeQueue(queue);
}

export function removeFromQueue(id: string): void {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
}

export function getLastSynced(): number | null {
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  return raw ? parseInt(raw, 10) : null;
}

export function setLastSynced(): void {
  localStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
}

const SAFE_PATTERNS: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/pos\/sales$/ },
  { method: "POST", pattern: /^\/api\/vouchers$/ },
  { method: "POST", pattern: /^\/api\/vouchers\/payment-receipt$/ },
  { method: "POST", pattern: /^\/api\/vouchers\/journal$/ },
  { method: "PATCH", pattern: /^\/api\/vouchers\/\d+\/payment-receipt$/ },
  { method: "PATCH", pattern: /^\/api\/vouchers\/\d+\/journal$/ },
];

export function isSafeToQueue(method: string, url: string): boolean {
  return SAFE_PATTERNS.some(
    (p) => p.method === method.toUpperCase() && p.pattern.test(url)
  );
}

export function getDescriptionForRequest(url: string): string {
  if (/\/api\/pos\/sales/.test(url)) return "POS Sale";
  if (/\/api\/vouchers\/payment-receipt/.test(url)) return "Payment / Receipt";
  if (/\/api\/vouchers\/journal/.test(url)) return "Journal Entry";
  if (/\/api\/vouchers/.test(url)) return "Voucher";
  return "Action";
}

type SizeWarningCallback = (count: number) => void;
const queueSizeWarningCallbacks: SizeWarningCallback[] = [];

export function onQueueSizeWarning(cb: SizeWarningCallback): () => void {
  queueSizeWarningCallbacks.push(cb);
  return () => {
    const idx = queueSizeWarningCallbacks.indexOf(cb);
    if (idx !== -1) queueSizeWarningCallbacks.splice(idx, 1);
  };
}
