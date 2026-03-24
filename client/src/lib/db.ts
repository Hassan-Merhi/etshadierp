import Dexie, { type Table } from "dexie";

// ─── Schema Types ─────────────────────────────────────────────────────────────

export interface SyncQueueItem {
  id?: number;
  idempotencyKey: string;
  mode: "erp" | "pos" | "factory";
  entityType: string;
  operation: "create" | "update" | "delete";
  payload: string;
  url: string;
  method: string;
  companyId: number | null;
  locationId: number | null;
  tempId: string | null;
  createdAt: number;
  retryCount: number;
  status: "pending" | "syncing" | "failed" | "succeeded";
  lastError: string | null;
  description: string;
}

export interface SyncState {
  id?: number;
  key: string;
  lastSyncedAt: number | null;
  lastAttemptAt: number | null;
  status: "idle" | "syncing" | "error";
  errorMessage: string | null;
}

export interface SyncLog {
  id?: number;
  timestamp: number;
  type: "sync_start" | "sync_end" | "item_success" | "item_failed" | "online" | "offline" | "error";
  message: string;
  metadata: string | null;
}

export interface Conflict {
  id?: number;
  syncQueueItemId: number;
  entityType: string;
  operation: string;
  payload: string;
  serverResponse: string;
  createdAt: number;
  resolved: boolean;
}

export interface LocalDraft {
  id?: number;
  entityType: string;
  mode: "erp" | "pos" | "factory";
  data: string;
  label: string;
  companyId: number | null;
  locationId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OfflinePackage {
  id?: number;
  key: string;
  entityType: string;
  companyId: number;
  data: string;
  downloadedAt: number;
  expiresAt: number | null;
  version: number;
}

export interface CachedEntity {
  id: string | number;
  companyId: number;
  data: string;
  updatedAt: number;
  fetchedAt: number;
}

// ─── Dexie Database ───────────────────────────────────────────────────────────

class ERPDatabase extends Dexie {
  syncQueue!: Table<SyncQueueItem, number>;
  syncState!: Table<SyncState, number>;
  syncLogs!: Table<SyncLog, number>;
  conflicts!: Table<Conflict, number>;
  localDrafts!: Table<LocalDraft, number>;
  offlinePackages!: Table<OfflinePackage, number>;
  users!: Table<CachedEntity, string | number>;
  companies!: Table<CachedEntity, string | number>;
  companySettings!: Table<CachedEntity, string | number>;
  permissions!: Table<CachedEntity, string | number>;
  locations!: Table<CachedEntity, string | number>;
  ledgerAccounts!: Table<CachedEntity, string | number>;
  bankAccounts!: Table<CachedEntity, string | number>;
  suppliers!: Table<CachedEntity, string | number>;
  customers!: Table<CachedEntity, string | number>;
  employees!: Table<CachedEntity, string | number>;
  fixedAssets!: Table<CachedEntity, string | number>;
  stockItems!: Table<CachedEntity, string | number>;
  inventoryByLocation!: Table<CachedEntity, string | number>;

  constructor() {
    super("ERPDatabase");
    this.version(1).stores({
      syncQueue:         "++id, idempotencyKey, mode, entityType, status, createdAt",
      syncState:         "++id, &key",
      syncLogs:          "++id, timestamp, type",
      conflicts:         "++id, syncQueueItemId, entityType, resolved",
      localDrafts:       "++id, entityType, mode, companyId, createdAt",
      offlinePackages:   "++id, &key, entityType, companyId",
      users:             "id, companyId, fetchedAt",
      companies:         "id, companyId, fetchedAt",
      companySettings:   "id, companyId, fetchedAt",
      permissions:       "id, companyId, fetchedAt",
      locations:         "id, companyId, fetchedAt",
      ledgerAccounts:    "id, companyId, fetchedAt",
      bankAccounts:      "id, companyId, fetchedAt",
      suppliers:         "id, companyId, fetchedAt",
      customers:         "id, companyId, fetchedAt",
      employees:         "id, companyId, fetchedAt",
      fixedAssets:       "id, companyId, fetchedAt",
      stockItems:        "id, companyId, fetchedAt",
      inventoryByLocation: "id, companyId, fetchedAt",
    });
  }
}

export const db = new ERPDatabase();

// ─── Helper Functions ─────────────────────────────────────────────────────────

export async function addToSyncQueue(
  item: Omit<SyncQueueItem, "id" | "createdAt" | "retryCount" | "status" | "lastError">
): Promise<number> {
  const id = await db.syncQueue.add({
    ...item,
    createdAt: Date.now(),
    retryCount: 0,
    status: "pending",
    lastError: null,
  });
  return id as number;
}

export async function getSyncQueueCount(): Promise<{ pending: number; failed: number }> {
  const [pending, failed] = await Promise.all([
    db.syncQueue.where("status").equals("pending").count(),
    db.syncQueue.where("status").equals("failed").count(),
  ]);
  return { pending, failed };
}

export async function getGlobalSyncState(): Promise<SyncState | null> {
  const state = await db.syncState.where("key").equals("global").first();
  return state ?? null;
}

export async function upsertGlobalSyncState(
  updates: Partial<Omit<SyncState, "id" | "key">>
): Promise<void> {
  const existing = await db.syncState.where("key").equals("global").first();
  if (existing?.id !== undefined) {
    await db.syncState.update(existing.id, updates);
  } else {
    await db.syncState.add({
      key: "global",
      lastSyncedAt: null,
      lastAttemptAt: null,
      status: "idle",
      errorMessage: null,
      ...updates,
    });
  }
}

export async function appendSyncLog(
  type: SyncLog["type"],
  message: string,
  metadata?: object
): Promise<void> {
  try {
    await db.syncLogs.add({
      timestamp: Date.now(),
      type,
      message,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    const count = await db.syncLogs.count();
    if (count > 500) {
      const oldest = await db.syncLogs.orderBy("timestamp").limit(count - 500).primaryKeys();
      await db.syncLogs.bulkDelete(oldest as number[]);
    }
  } catch {
    // Logs are best-effort; never throw
  }
}

export async function getRecentSyncLogs(limit = 50): Promise<SyncLog[]> {
  const logs = await db.syncLogs.orderBy("timestamp").reverse().limit(limit).toArray();
  return logs;
}

export async function clearSyncLogs(): Promise<void> {
  await db.syncLogs.clear();
}

export async function clearAllOfflineData(): Promise<void> {
  await Promise.all([
    db.syncQueue.clear(),
    db.syncLogs.clear(),
    db.conflicts.clear(),
    db.localDrafts.clear(),
    db.offlinePackages.clear(),
  ]);
}
