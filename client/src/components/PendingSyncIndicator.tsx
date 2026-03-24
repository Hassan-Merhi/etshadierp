import { CloudOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { Badge } from "@/components/ui/badge";

interface PendingSyncIndicatorProps {
  className?: string;
}

export function PendingSyncIndicator({ className = "" }: PendingSyncIndicatorProps) {
  const { isOnline, isSyncing, pendingCount, failedCount } = useConnectivity();

  if (pendingCount === 0 && failedCount === 0) return null;

  if (!isOnline && pendingCount > 0) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[11px] ${className}`}
        data-testid="pending-sync-indicator"
        title={`${pendingCount} action${pendingCount !== 1 ? "s" : ""} queued — will sync when online`}
      >
        <CloudOff className="h-3 w-3" />
        {pendingCount} queued
      </Badge>
    );
  }

  if (isSyncing) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-blue-500/30 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-[11px] ${className}`}
        data-testid="pending-sync-indicator"
      >
        <RefreshCw className="h-3 w-3 animate-spin" />
        Syncing {pendingCount > 0 ? `(${pendingCount})` : ""}
      </Badge>
    );
  }

  if (failedCount > 0) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-red-500/30 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-[11px] ${className}`}
        data-testid="pending-sync-indicator"
        title={`${failedCount} sync failure${failedCount !== 1 ? "s" : ""} — check offline settings`}
      >
        <CloudOff className="h-3 w-3" />
        {failedCount} failed
      </Badge>
    );
  }

  if (pendingCount > 0) {
    return (
      <Badge
        variant="outline"
        className={`gap-1 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[11px] ${className}`}
        data-testid="pending-sync-indicator"
        title={`${pendingCount} action${pendingCount !== 1 ? "s" : ""} pending sync`}
      >
        <RefreshCw className="h-3 w-3" />
        {pendingCount} pending
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`gap-1 border-green-500/30 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 text-[11px] ${className}`}
      data-testid="pending-sync-indicator"
    >
      <CheckCircle2 className="h-3 w-3" />
      All synced
    </Badge>
  );
}
