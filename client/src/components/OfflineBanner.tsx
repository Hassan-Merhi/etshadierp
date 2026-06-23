import { useEffect, useRef, useState } from "react";
import { OFFLINE_MODE_ENABLED } from "@/lib/featureFlags";
import { WifiOff, RefreshCw, Trash2, RotateCcw, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getQueue,
  removeFromQueue,
  updateItemStatus,
  setLastSynced,
  getLastSynced,
  onQueueSizeWarning,
  type QueueItem,
} from "@/lib/offlineQueue";
import { queryClient } from "@/lib/queryClient";
import { useConnectivity } from "@/contexts/ConnectivityContext";

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function OfflineBanner() {
  if (!OFFLINE_MODE_ENABLED) return null;
  return <OfflineBannerInner />;
}

function OfflineBannerInner() {
  const { isOnline, isSyncing: globalSyncing, lastSyncedAt, refreshCounts } = useConnectivity();

  const [localSyncing, setLocalSyncing] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>(() => getQueue());
  const [lastSynced, setLastSyncedState] = useState<number | null>(() => getLastSynced());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const { toast } = useToast();
  const syncingRef = useRef(false);

  const isSyncing = localSyncing || globalSyncing;

  const refreshQueue = () => setQueue(getQueue());

  // Sync lastSynced from global context
  useEffect(() => {
    if (lastSyncedAt) {
      setLastSyncedState(lastSyncedAt);
    }
  }, [lastSyncedAt]);

  useEffect(() => {
    const unsubWarn = onQueueSizeWarning((count) => {
      toast({
        title: "Many pending offline actions",
        description: `You have ${count}+ actions queued. Connect to the internet soon to sync.`,
        variant: "destructive",
      });
    });
    return unsubWarn;
  }, [toast]);

  const replayQueue = async () => {
    if (syncingRef.current) return;
    const pending = getQueue().filter((i) => i.status === "pending");
    if (pending.length === 0) {
      setLastSynced();
      setLastSyncedState(getLastSynced());
      return;
    }

    syncingRef.current = true;
    setLocalSyncing(true);

    let succeeded = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: item.body || undefined,
        });

        if (res.status === 401) {
          syncingRef.current = false;
          setLocalSyncing(false);
          refreshQueue();
          const remaining = getQueue().filter((i) => i.status === "pending").length;
          toast({
            title: "Session expired",
            description: `Please log in again. Your ${remaining} pending action(s) are saved and will sync after login.`,
            variant: "destructive",
          });
          window.location.href = "/login";
          return;
        }

        if (res.ok) {
          removeFromQueue(item.id);
          succeeded++;
        } else {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          let errMsg = errText;
          try {
            errMsg = JSON.parse(errText)?.message || errText;
          } catch {}
          updateItemStatus(item.id, "failed", errMsg);
          failed++;
        }
      } catch {
        updateItemStatus(item.id, "failed", "Network error during sync");
        failed++;
      }
    }

    setLastSynced();
    setLastSyncedState(getLastSynced());
    refreshQueue();
    void refreshCounts();
    queryClient.invalidateQueries();
    syncingRef.current = false;
    setLocalSyncing(false);

    if (succeeded > 0) {
      toast({ title: `${succeeded} action(s) synced`, description: "Your offline data has been saved." });
    }
    if (failed > 0) {
      toast({
        title: `${failed} action(s) failed to sync`,
        description: "Tap the offline banner to review and retry.",
        variant: "destructive",
      });
    }
  };

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline) {
      const pending = getQueue().filter((i) => i.status === "pending");
      if (pending.length > 0) {
        void replayQueue();
      }
    }
    refreshQueue();
  }, [isOnline]);

  useEffect(() => {
    refreshQueue();
  }, [drawerOpen]);

  const pendingCount = queue.filter((i) => i.status === "pending").length;
  const failedCount = queue.filter((i) => i.status === "failed").length;
  const totalCount = queue.length;

  const handleDiscard = (id: string) => setDiscardTarget(id);

  const confirmDiscard = () => {
    if (discardTarget) {
      removeFromQueue(discardTarget);
      refreshQueue();
      void refreshCounts();
      setDiscardTarget(null);
    }
  };

  const handleRetry = async (item: QueueItem) => {
    updateItemStatus(item.id, "pending");
    refreshQueue();
    if (isOnline) {
      await replayQueue();
    } else {
      toast({ title: "Still offline", description: "Cannot retry — no connection." });
      updateItemStatus(item.id, "failed", item.failReason);
      refreshQueue();
    }
  };

  const handleManualSync = async () => {
    if (!isOnline) {
      toast({ title: "No connection", description: "Cannot sync — still offline.", variant: "destructive" });
      return;
    }
    await replayQueue();
  };

  const isOffline = !isOnline;

  if (!isOffline && totalCount === 0) return null;

  return (
    <>
      <div
        className={`w-full px-3 py-1.5 flex items-center gap-2 cursor-pointer text-sm font-medium transition-colors ${
          isOffline
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-b border-amber-500/30"
            : failedCount > 0
              ? "bg-red-500/10 text-red-700 dark:text-red-400 border-b border-red-500/20"
              : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-b border-blue-500/20"
        }`}
        onClick={() => setDrawerOpen(true)}
        data-testid="offline-banner"
      >
        {isSyncing ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1 min-w-0 truncate">
          {isSyncing
            ? `Syncing ${pendingCount} action(s)...`
            : isOffline
              ? pendingCount > 0
                ? `Offline — ${pendingCount} action(s) pending sync`
                : "You are offline"
              : failedCount > 0
                ? `${failedCount} action(s) failed to sync — tap to review`
                : `${pendingCount} action(s) pending sync`}
        </span>
        {totalCount > 0 && (
          <Badge variant="outline" className="text-xs shrink-0" data-testid="badge-offline-count">
            {totalCount}
          </Badge>
        )}
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
          <SheetHeader className="shrink-0">
            <SheetTitle>Pending Actions</SheetTitle>
            <SheetDescription>
              {isOffline
                ? "These will sync automatically when you reconnect."
                : "Tap Sync Now to retry all pending actions."}
            </SheetDescription>
          </SheetHeader>

          {!isOffline && pendingCount > 0 && (
            <div className="shrink-0 pt-2">
              <Button size="sm" onClick={handleManualSync} disabled={isSyncing} data-testid="button-sync-now">
                {isSyncing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync Now
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-2 space-y-2">
            {queue.length === 0 ? (
              <div className="text-center text-muted-foreground py-10 text-sm">No pending actions</div>
            ) : (
              queue.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border p-3 flex flex-col gap-1"
                  data-testid={`queue-item-${item.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium text-sm truncate">{item.description}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <SyncStatusBadge status={item.status === "failed" ? "failed" : "pending"} />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDiscard(item.id)}
                        data-testid={`button-discard-${item.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  {item.status === "failed" && item.failReason && (
                    <p className="text-xs text-destructive mt-0.5">{item.failReason}</p>
                  )}
                  {item.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 self-start"
                      onClick={() => handleRetry(item)}
                      data-testid={`button-retry-${item.id}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Retry
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="shrink-0 border-t pt-3 text-xs text-muted-foreground">
            {lastSynced ? (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last synced {formatRelativeTime(lastSynced)}
              </span>
            ) : (
              <span>Not yet synced this session</span>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!discardTarget}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this action?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove it from the queue. It will not be saved to the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} data-testid="button-confirm-discard">
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
