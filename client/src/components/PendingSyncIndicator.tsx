import { CloudOff, RefreshCw, AlertTriangle } from "lucide-react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { OFFLINE_MODE_ENABLED } from "@/lib/featureFlags";

interface PendingSyncIndicatorProps {
  className?: string;
}

export function PendingSyncIndicator({ className = "" }: PendingSyncIndicatorProps) {
  if (!OFFLINE_MODE_ENABLED) return null;
  return <PendingSyncIndicatorInner className={className} />;
}

function PendingSyncIndicatorInner({ className = "" }: PendingSyncIndicatorProps) {
  const { isOnline, isSyncing, pendingCount, failedCount, conflictCount } = useConnectivity();

  const hasNothing = pendingCount === 0 && failedCount === 0 && conflictCount === 0;
  if (hasNothing) return null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {conflictCount > 0 && (
        <Link href="/conflicts">
          <Badge
            variant="outline"
            className="gap-1 border-orange-500/30 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 text-[11px] cursor-pointer"
            data-testid="conflict-count-badge"
            title={`${conflictCount} sync conflict${conflictCount !== 1 ? "s" : ""} — click to review`}
          >
            <AlertTriangle className="h-3 w-3" />
            {conflictCount} {conflictCount === 1 ? "conflict" : "conflicts"}
          </Badge>
        </Link>
      )}

      {!isOnline && pendingCount > 0 && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[11px]"
          data-testid="pending-sync-indicator"
          title={`${pendingCount} action${pendingCount !== 1 ? "s" : ""} queued — will sync when online`}
        >
          <CloudOff className="h-3 w-3" />
          {pendingCount} queued
        </Badge>
      )}

      {isOnline && isSyncing && (
        <Badge
          variant="outline"
          className="gap-1 border-blue-500/30 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-[11px]"
          data-testid="pending-sync-indicator"
        >
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </Badge>
      )}

      {isOnline && !isSyncing && failedCount > 0 && (
        <Badge
          variant="outline"
          className="gap-1 border-red-500/30 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-[11px]"
          data-testid="pending-sync-indicator"
          title={`${failedCount} sync failure${failedCount !== 1 ? "s" : ""} — check offline settings`}
        >
          <CloudOff className="h-3 w-3" />
          {failedCount} failed
        </Badge>
      )}

      {isOnline && !isSyncing && pendingCount > 0 && failedCount === 0 && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/30 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[11px]"
          data-testid="pending-sync-indicator"
          title={`${pendingCount} action${pendingCount !== 1 ? "s" : ""} pending sync`}
        >
          <RefreshCw className="h-3 w-3" />
          {pendingCount} pending
        </Badge>
      )}
    </div>
  );
}
