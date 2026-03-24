import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { appendSyncLog, getGlobalSyncState, upsertGlobalSyncState, getSyncQueueCount } from "@/lib/db";
import { getQueue } from "@/lib/offlineQueue";

export type ConnectivityStatus = "online" | "offline" | "syncing" | "error";

interface ConnectivityContextValue {
  status: ConnectivityStatus;
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: number | null;
  pendingCount: number;
  failedCount: number;
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

export function ConnectivityProvider({ children }: Props) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const isMountedRef = useRef(true);

  // Load last sync time from IndexedDB on mount
  useEffect(() => {
    isMountedRef.current = true;
    getGlobalSyncState()
      .then((state) => {
        if (isMountedRef.current && state?.lastSyncedAt) {
          setLastSyncedAt(state.lastSyncedAt);
        }
      })
      .catch(() => {});
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const { pending: idbPending, failed: idbFailed } = await getSyncQueueCount();
      const legacyQueue = getQueue();
      const legacyPending = legacyQueue.filter((i) => i.status === "pending").length;
      const legacyFailed = legacyQueue.filter((i) => i.status === "failed").length;
      if (isMountedRef.current) {
        setPendingCount(idbPending + legacyPending);
        setFailedCount(idbFailed + legacyFailed);
      }
    } catch {
      // Non-critical
    }
  }, []);

  const triggerSync = useCallback(() => {
    import("@/lib/syncEngine")
      .then(({ runSync }) => runSync())
      .catch(() => {});
  }, []);

  // Browser online/offline events + periodic server ping
  useEffect(() => {
    const handleOnline = async () => {
      const alive = await pingServer();
      if (!isMountedRef.current) return;
      setIsOnline(alive);
      if (alive) {
        void appendSyncLog("online", "Connection restored");
        triggerSync();
      }
    };

    const handleOffline = () => {
      if (!isMountedRef.current) return;
      setIsOnline(false);
      void appendSyncLog("offline", "Connection lost");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const pingInterval = setInterval(async () => {
      if (!isMountedRef.current) return;
      const alive = await pingServer();
      if (alive !== isOnline && isMountedRef.current) {
        setIsOnline(alive);
        if (alive) {
          void appendSyncLog("online", "Connection verified by ping");
          triggerSync();
        } else {
          void appendSyncLog("offline", "Connection lost (ping failed)");
        }
      }
    }, 30_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(pingInterval);
    };
  }, [isOnline, triggerSync]);

  // Refresh counts periodically
  useEffect(() => {
    void refreshCounts();
    const t = setInterval(() => void refreshCounts(), 15_000);
    return () => clearInterval(t);
  }, [refreshCounts]);

  // Listen to sync engine events
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = e as CustomEvent<{
        syncing?: boolean;
        lastSyncedAt?: number;
        error?: string;
      }>;
      if (!isMountedRef.current) return;
      if (evt.detail.syncing !== undefined) setIsSyncing(evt.detail.syncing);
      if (evt.detail.lastSyncedAt) {
        setLastSyncedAt(evt.detail.lastSyncedAt);
        void upsertGlobalSyncState({ lastSyncedAt: evt.detail.lastSyncedAt });
      }
      void refreshCounts();
    };
    window.addEventListener("erp:sync", handler);
    return () => window.removeEventListener("erp:sync", handler);
  }, [refreshCounts]);

  const status: ConnectivityStatus = !isOnline
    ? "offline"
    : isSyncing
    ? "syncing"
    : "online";

  return (
    <ConnectivityContext.Provider
      value={{
        status,
        isOnline,
        isSyncing,
        lastSyncedAt,
        pendingCount,
        failedCount,
        triggerSync,
        refreshCounts,
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}
