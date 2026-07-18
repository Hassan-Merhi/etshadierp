const LEGACY_QUEUE_KEY = "erp_offline_queue";
const LOADING_SCAN_PATTERN = /^\/api\/factory\/customer-orders\/\d+\/bales$/;

interface StoredQueueItem {
  method?: unknown;
  url?: unknown;
}

function isUnsafeLoadingScan(item: StoredQueueItem): boolean {
  return (
    String(item.method ?? "").toUpperCase() === "POST" &&
    LOADING_SCAN_PATTERN.test(String(item.url ?? ""))
  );
}

/**
 * Bale allocation depends on live stock, order status and location. Replaying an
 * old POST later is unsafe: it can target a finalized order, allocate a different
 * physical bale for the same article code, or repeatedly fail with 400. Remove
 * legacy queued loading scans and require the operator to rescan while online.
 */
export function purgeUnsafeFactoryLoadingScans(): number {
  if (typeof window === "undefined" || !window.localStorage) return 0;

  try {
    const raw = window.localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return 0;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return 0;

    const safeItems = parsed.filter((item: StoredQueueItem) => !isUnsafeLoadingScan(item));
    const removed = parsed.length - safeItems.length;
    if (removed > 0) {
      window.localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(safeItems));
      window.dispatchEvent(
        new CustomEvent("erp:offline-queue-pruned", {
          detail: { removed, reason: "unsafe-loading-scan-replay" },
        })
      );
    }
    return removed;
  } catch {
    return 0;
  }
}
