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
  const queue = readQueue();
  const upperMethod = method.toUpperCase();

  // Dedup: for PATCH/PUT, collapse multiple edits to the same URL into one
  if (upperMethod === "PATCH" || upperMethod === "PUT") {
    const existingIdx = queue.findIndex(
      i => i.url === url && i.method.toUpperCase() === upperMethod && i.status === "pending"
    );
    if (existingIdx !== -1) {
      // Replace body of existing item with latest payload
      queue[existingIdx] = {
        ...queue[existingIdx],
        body,
        description,
        timestamp: Date.now(),
      };
      writeQueue(queue);
      return queue[existingIdx].id;
    }
  }

  // Dedup: for DELETE, remove any pending POST/PATCH for the same URL
  if (upperMethod === "DELETE") {
    const filtered = queue.filter(
      i => !(i.url === url && i.status === "pending" && i.method.toUpperCase() !== "DELETE")
    );
    if (filtered.length !== queue.length) {
      writeQueue(filtered);
    }
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item: QueueItem = { id, url, method: upperMethod, body, description, timestamp: Date.now(), status: "pending" };
  const currentQueue = readQueue();
  currentQueue.push(item);
  writeQueue(currentQueue);

  if (currentQueue.length === QUEUE_WARN_THRESHOLD) {
    queueSizeWarningCallbacks.forEach((cb) => cb(currentQueue.length));
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
  // POS
  { method: "POST",  pattern: /^\/api\/pos\/sales$/ },
  { method: "POST",  pattern: /^\/api\/pos\/drafts$/ },
  { method: "PATCH", pattern: /^\/api\/pos\/drafts\/\d+$/ },
  // ERP Vouchers
  { method: "POST",  pattern: /^\/api\/vouchers$/ },
  { method: "POST",  pattern: /^\/api\/vouchers\/payment-receipt$/ },
  { method: "POST",  pattern: /^\/api\/vouchers\/journal$/ },
  { method: "PATCH", pattern: /^\/api\/vouchers\/\d+\/payment-receipt$/ },
  { method: "PATCH", pattern: /^\/api\/vouchers\/\d+\/journal$/ },
  { method: "PATCH", pattern: /^\/api\/vouchers\/\d+\/sales$/ },
  { method: "PUT",   pattern: /^\/api\/vouchers\/\d+\/sales$/ },
  // Factory — stock & bales
  { method: "POST",  pattern: /^\/api\/factory\/stock-entry$/ },
  { method: "POST",  pattern: /^\/api\/factory\/bale-products$/ },
  { method: "PATCH", pattern: /^\/api\/factory\/bale-products\/\d+$/ },
  // Factory — containers / loading scans
  { method: "POST",  pattern: /^\/api\/factory\/customer-orders-loading$/ },
  { method: "POST",  pattern: /^\/api\/factory\/customer-orders\/\d+\/bales$/ },
  { method: "POST",  pattern: /^\/api\/factory\/customer-orders\/\d+\/finalize-loading$/ },
  // Factory — vouchers
  { method: "POST",  pattern: /^\/api\/factory\/vouchers$/ },
  { method: "POST",  pattern: /^\/api\/factory\/vouchers\/payment-receipt$/ },
  { method: "POST",  pattern: /^\/api\/factory\/vouchers\/journal$/ },
  { method: "PATCH", pattern: /^\/api\/factory\/vouchers\/\d+\/payment-receipt$/ },
  { method: "PATCH", pattern: /^\/api\/factory\/vouchers\/\d+\/journal$/ },
  // Factory — daybook / mix batches
  { method: "POST",  pattern: /^\/api\/factory\/mix-batches$/ },
  { method: "PATCH", pattern: /^\/api\/factory\/mix-batches\/\d+$/ },
  { method: "POST",  pattern: /^\/api\/factory\/daybook$/ },
  // Stock adjustments & transfers
  { method: "POST",  pattern: /^\/api\/stock-adjustments$/ },
  { method: "POST",  pattern: /^\/api\/stock-transfers$/ },
  // Bale transfers
  { method: "POST",  pattern: /^\/api\/bale-transfers$/ },
];

export function isSafeToQueue(method: string, url: string): boolean {
  return SAFE_PATTERNS.some(
    (p) => p.method === method.toUpperCase() && p.pattern.test(url)
  );
}

export function getDescriptionForRequest(url: string): string {
  if (/\/api\/pos\/sales/.test(url)) return "POS Sale";
  if (/\/api\/pos\/drafts/.test(url)) return "POS Draft";
  if (/\/api\/vouchers\/payment-receipt/.test(url)) return "Payment / Receipt";
  if (/\/api\/vouchers\/journal/.test(url)) return "Journal Entry";
  if (/\/api\/vouchers\/\d+\/sales/.test(url)) return "Sales Voucher Update";
  if (/\/api\/vouchers/.test(url)) return "Voucher";
  if (/\/api\/factory\/stock-entry/.test(url)) return "Factory Stock Entry";
  if (/\/api\/factory\/bale-products/.test(url)) return "Bale Product";
  if (/\/api\/factory\/customer-orders-loading/.test(url)) return "Loading Order";
  if (/\/api\/factory\/customer-orders\/\d+\/bales/.test(url)) return "Loading Scan";
  if (/\/api\/factory\/customer-orders\/\d+\/finalize-loading/.test(url)) return "Finalize Loading";
  if (/\/api\/factory\/vouchers\/payment-receipt/.test(url)) return "Factory Payment";
  if (/\/api\/factory\/vouchers\/journal/.test(url)) return "Factory Journal";
  if (/\/api\/factory\/vouchers/.test(url)) return "Factory Voucher";
  if (/\/api\/factory\/mix-batches/.test(url)) return "Mix Batch";
  if (/\/api\/factory\/daybook/.test(url)) return "Factory Daybook";
  if (/\/api\/stock-adjustments/.test(url)) return "Stock Adjustment";
  if (/\/api\/stock-transfers/.test(url)) return "Stock Transfer";
  if (/\/api\/bale-transfers/.test(url)) return "Bale Transfer";
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
