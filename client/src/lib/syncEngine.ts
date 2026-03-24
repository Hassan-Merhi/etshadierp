import {
  db,
  appendSyncLog,
  upsertGlobalSyncState,
  type SyncQueueItem,
} from "./db";
import {
  getQueue,
  removeFromQueue,
  updateItemStatus as updateLegacyStatus,
  setLastSynced,
} from "./offlineQueue";

let syncInProgress = false;

export function isSyncInProgress(): boolean {
  return syncInProgress;
}

function emitSyncEvent(detail: {
  syncing?: boolean;
  lastSyncedAt?: number;
  error?: string;
}) {
  window.dispatchEvent(new CustomEvent("erp:sync", { detail }));
}

async function processIdbItem(item: SyncQueueItem): Promise<"ok" | "failed" | "auth"> {
  try {
    const res = await fetch(item.url, {
      method: item.method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: item.payload || undefined,
    });

    if (res.status === 401) return "auth";

    if (res.ok) {
      await db.syncQueue.delete(item.id!);
      await appendSyncLog("item_success", `Synced ${item.entityType} (${item.operation})`, {
        url: item.url,
      });
      return "ok";
    }

    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    let errMsg = errText;
    try { errMsg = JSON.parse(errText)?.message || errText; } catch {}
    await db.syncQueue.update(item.id!, {
      status: "failed",
      lastError: errMsg,
      retryCount: (item.retryCount || 0) + 1,
    });
    await appendSyncLog("item_failed", `Failed ${item.entityType}: ${errMsg}`, {
      url: item.url,
    });
    return "failed";
  } catch (err: any) {
    const msg = err?.message || "Network error";
    await db.syncQueue.update(item.id!, {
      status: "failed",
      lastError: msg,
      retryCount: (item.retryCount || 0) + 1,
    });
    return "failed";
  }
}

async function processLegacyItem(
  item: ReturnType<typeof getQueue>[0]
): Promise<"ok" | "failed" | "auth"> {
  try {
    const res = await fetch(item.url, {
      method: item.method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: item.body || undefined,
    });

    if (res.status === 401) return "auth";

    if (res.ok) {
      removeFromQueue(item.id);
      return "ok";
    }

    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    let errMsg = errText;
    try { errMsg = JSON.parse(errText)?.message || errText; } catch {}
    updateLegacyStatus(item.id, "failed", errMsg);
    return "failed";
  } catch {
    updateLegacyStatus(item.id, "failed", "Network error");
    return "failed";
  }
}

export async function runSync(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  emitSyncEvent({ syncing: true });
  await upsertGlobalSyncState({
    lastAttemptAt: Date.now(),
    status: "syncing",
    errorMessage: null,
  });
  await appendSyncLog("sync_start", "Sync started");

  let authFailed = false;

  try {
    // 1. Process IndexedDB queue
    const idbPending = await db.syncQueue.where("status").equals("pending").toArray();
    for (const item of idbPending) {
      const result = await processIdbItem(item);
      if (result === "auth") {
        authFailed = true;
        break;
      }
    }

    // 2. Process legacy localStorage queue (if auth still valid)
    if (!authFailed) {
      const legacyPending = getQueue().filter((i) => i.status === "pending");
      for (const item of legacyPending) {
        const result = await processLegacyItem(item);
        if (result === "auth") {
          authFailed = true;
          break;
        }
      }
    }

    const now = Date.now();
    setLastSynced();
    await upsertGlobalSyncState({
      lastSyncedAt: now,
      lastAttemptAt: now,
      status: "idle",
      errorMessage: null,
    });
    emitSyncEvent({ syncing: false, lastSyncedAt: now });
    await appendSyncLog("sync_end", "Sync completed");
  } catch (err: any) {
    const msg = err?.message || "Sync error";
    await upsertGlobalSyncState({ status: "error", errorMessage: msg });
    emitSyncEvent({ syncing: false, error: msg });
    await appendSyncLog("error", `Sync error: ${msg}`);
  } finally {
    syncInProgress = false;
  }

  if (authFailed) {
    window.location.href = "/login";
  }
}
