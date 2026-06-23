import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from "react";
import { OFFLINE_MODE_ENABLED } from "@/lib/featureFlags";

export type ConnectivityStatus = "online" | "offline" | "syncing" | "error";

interface ConnectivityContextValue {
  status: ConnectivityStatus;
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: number | null;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  triggerSync: () => void;
  refreshCounts: () => Promise<void>;
}

const ConnectivityContext = createContext<ConnectivityContextValue>({
  status: "online",
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  pendingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  triggerSync: () => {},
  refreshCounts: async () => {},
});

export function useConnectivity(): ConnectivityContextValue {
  return useContext(ConnectivityContext);
}

const PING_TIMEOUT_MS = 5_000;

async function pingServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const res = await fetch("/api/health", {
      credentials: "include",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

interface Props {
  children: ReactNode;
}

// ── Stub provider (offline mode disabled) ─────────────────────────────────────
// Returns a static "always online" context with zero background work.
function StubConnectivityProvider({ children }: Props) {
  return (
    <ConnectivityContext.Provider
      value={{
        status: "online",
        isOnline: true,
        isSyncing: false,
        lastSyncedAt: null,
        pendingCount: 0,
        failedCount: 0,
        conflictCount: 0,
        triggerSync: () => {},
        refreshCounts: async () => {},
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}

// ── Full provider (offline mode enabled) ──────────────────────────────────────
function FullConnectivityProvider({ children }: Props) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    import("@/lib/db").then(({ getGlobalSyncState }) =>
      getGlobalSyncState()
        .then((state: any) => {
          if (isMountedRef.current && state?.lastSyncedAt) {
            setLastSyncedAt(state.lastSyncedAt);
          }
        })
        .catch(() => {})
    );
    if (navigator.onLine) {
      import("@/lib/refPool").then(({ ensurePoolReady }) => ensurePoolReady()).catch(() => {});
    }
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const { getSyncQueueCount, getConflictCount } = await import("@/lib/db");
      const { getQueue } = await import("@/lib/offlineQueue");
      const [{ pending: idbPending, failed: idbFailed }, conflicts] = await Promise.all([
        getSyncQueueCount(),
        getConflictCount(),
      ]);
      const legacyQueue = getQueue();
      const legacyPending = legacyQueue.filter((i: any) => i.status === "pending").length;
      const legacyFailed = legacyQueue.filter((i: any) => i.status === "failed").length;
      if (isMountedRef.current) {
        setPendingCount(idbPending + legacyPending);
        setFailedCount(idbFailed + legacyFailed);
        setConflictCount(conflicts);
      }
    } catch {
      /* Non-critical */
    }
  }, []);

  const triggerSync = useCallback(() => {
    import("@/lib/syncEngine").then(({ runSync }) => runSync()).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    const handleOnline = async () => {
      const alive = await pingServer();
      if (!mounted) return;
      setIsOnline(alive);
      if (alive) {
        import("@/lib/db").then(({ appendSyncLog }) => appendSyncLog("online", "Connection restored"));
        triggerSync();
        import("@/lib/refPool").then(({ ensurePoolReady }) => ensurePoolReady()).catch(() => {});
      }
    };
    const handleOffline = () => {
      if (!mounted) return;
      setIsOnline(false);
      import("@/lib/db").then(({ appendSyncLog }) => appendSyncLog("offline", "Connection lost"));
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const pingInterval = setInterval(async () => {
      if (!mounted) return;
      const alive = await pingServer();
      if (alive !== isOnline && mounted) {
        setIsOnline(alive);
        if (alive) {
          import("@/lib/db").then(({ appendSyncLog }) => appendSyncLog("online", "Connection verified by ping"));
          triggerSync();
          import("@/lib/refPool").then(({ ensurePoolReady }) => ensurePoolReady()).catch(() => {});
        } else {
          import("@/lib/db").then(({ appendSyncLog }) => appendSyncLog("offline", "Connection lost (ping failed)"));
        }
      }
    }, 30_000);
    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(pingInterval);
    };
  }, [isOnline, triggerSync]);

  useEffect(() => {
    void refreshCounts();
    const t = setInterval(() => void refreshCounts(), 15_000);
    return () => clearInterval(t);
  }, [refreshCounts]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const evt = e as CustomEvent<{
        syncing?: boolean;
        lastSyncedAt?: number;
        error?: string;
        conflictDetected?: boolean;
      }>;
      if (!isMountedRef.current) return;
      if (evt.detail.syncing !== undefined) setIsSyncing(evt.detail.syncing);
      if (evt.detail.lastSyncedAt) {
        setLastSyncedAt(evt.detail.lastSyncedAt);
        const { upsertGlobalSyncState } = await import("@/lib/db");
        const { queryClient } = await import("@/lib/queryClient");
        void upsertGlobalSyncState({ lastSyncedAt: evt.detail.lastSyncedAt });
        void queryClient.invalidateQueries();
      }
      void refreshCounts();
    };
    window.addEventListener("erp:sync", handler);
    return () => window.removeEventListener("erp:sync", handler);
  }, [refreshCounts]);

  const status: ConnectivityStatus = !isOnline ? "offline" : isSyncing ? "syncing" : "online";

  return (
    <ConnectivityContext.Provider
      value={{
        status,
        isOnline,
        isSyncing,
        lastSyncedAt,
        pendingCount,
        failedCount,
        conflictCount,
        triggerSync,
        refreshCounts,
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}

// ── Public export — switches between stub and full based on feature flag ───────
export function ConnectivityProvider({ children }: Props) {
  if (!OFFLINE_MODE_ENABLED) return <StubConnectivityProvider>{children}</StubConnectivityProvider>;
  return <FullConnectivityProvider>{children}</FullConnectivityProvider>;
}
