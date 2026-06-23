import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QueuedSale {
  clientId: string;
  locationId: number;
  cashAccountId: number | null;
  paymentAccountType: string;
  paymentAccountId: number | null;
  items: Array<{
    stockItemId: number;
    quantity: number;
    rate: number;
  }>;
  notes: string;
  isCreditSale: boolean;
  voucherDate: string;
  createdAt: number;
  retries: number;
  status: "pending" | "syncing" | "failed";
  errorMessage?: string;
}

const QUEUE_STORAGE_KEY = "pos_offline_queue";
const MAX_RETRIES = 3;

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  // Load queue from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        setQueue(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load offline queue:", e);
    }
  }, []);

  // Save queue to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error("Failed to save offline queue:", e);
    }
  }, [queue]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast({
        title: "Back Online",
        description: "Connection restored. Syncing pending transactions...",
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast({
        title: "Offline Mode",
        description: "You're offline. Sales will be queued and synced when connection is restored.",
        variant: "destructive",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [toast]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && queue.some((q) => q.status === "pending" || q.status === "failed")) {
      syncQueue();
    }
  }, [isOnline]);

  // Generate unique client ID for idempotency
  const generateClientId = useCallback(() => {
    return `pos_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }, []);

  // Add a sale to the queue
  const addToQueue = useCallback(
    (saleData: Omit<QueuedSale, "clientId" | "createdAt" | "retries" | "status">) => {
      const queuedSale: QueuedSale = {
        ...saleData,
        clientId: generateClientId(),
        createdAt: Date.now(),
        retries: 0,
        status: "pending",
      };

      setQueue((prev) => [...prev, queuedSale]);

      toast({
        title: "Sale Queued",
        description: "Sale will be synced when connection is restored.",
      });

      return queuedSale.clientId;
    },
    [generateClientId, toast]
  );

  // Process a single queued sale
  const processSale = async (sale: QueuedSale): Promise<boolean> => {
    try {
      const res = await apiRequest("POST", "/api/pos/sales", {
        locationId: sale.locationId,
        cashAccountId: sale.cashAccountId,
        paymentAccountType: sale.paymentAccountType,
        paymentAccountId: sale.paymentAccountId,
        items: sale.items,
        notes: sale.notes,
        isCreditSale: sale.isCreditSale,
        voucherDate: sale.voucherDate,
        clientId: sale.clientId,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to sync sale");
      }

      return true;
    } catch (error: any) {
      console.error("Failed to process queued sale:", error);
      return false;
    }
  };

  // Sync all queued sales
  const syncQueue = useCallback(async () => {
    if (isSyncing || !isOnline) return;

    const pendingSales = queue.filter((q) => q.status === "pending" || q.status === "failed");
    if (pendingSales.length === 0) return;

    setIsSyncing(true);

    let successCount = 0;
    let failCount = 0;

    for (const sale of pendingSales) {
      // Update status to syncing
      setQueue((prev) => prev.map((q) => (q.clientId === sale.clientId ? { ...q, status: "syncing" as const } : q)));

      const success = await processSale(sale);

      if (success) {
        // Remove from queue on success
        setQueue((prev) => prev.filter((q) => q.clientId !== sale.clientId));
        successCount++;
      } else {
        // Update retry count and status
        const newRetries = sale.retries + 1;
        if (newRetries >= MAX_RETRIES) {
          setQueue((prev) =>
            prev.map((q) =>
              q.clientId === sale.clientId
                ? { ...q, status: "failed" as const, retries: newRetries, errorMessage: "Max retries reached" }
                : q
            )
          );
          failCount++;
        } else {
          setQueue((prev) =>
            prev.map((q) =>
              q.clientId === sale.clientId ? { ...q, status: "pending" as const, retries: newRetries } : q
            )
          );
        }
      }
    }

    setIsSyncing(false);

    if (successCount > 0) {
      toast({
        title: "Sync Complete",
        description: `${successCount} transaction(s) synced successfully.`,
      });
    }

    if (failCount > 0) {
      toast({
        title: "Sync Failed",
        description: `${failCount} transaction(s) failed to sync after ${MAX_RETRIES} attempts.`,
        variant: "destructive",
      });
    }
  }, [isSyncing, isOnline, queue, toast]);

  // Remove a failed sale from queue
  const removeFromQueue = useCallback((clientId: string) => {
    setQueue((prev) => prev.filter((q) => q.clientId !== clientId));
  }, []);

  // Clear entire queue
  const clearQueue = useCallback(() => {
    setQueue([]);
    localStorage.removeItem(QUEUE_STORAGE_KEY);
  }, []);

  // Retry a specific failed sale
  const retrySale = useCallback((clientId: string) => {
    setQueue((prev) =>
      prev.map((q) => (q.clientId === clientId ? { ...q, status: "pending" as const, retries: 0 } : q))
    );
  }, []);

  return {
    isOnline,
    queue,
    pendingCount: queue.filter((q) => q.status === "pending").length,
    failedCount: queue.filter((q) => q.status === "failed").length,
    isSyncing,
    addToQueue,
    syncQueue,
    removeFromQueue,
    clearQueue,
    retrySale,
  };
}
