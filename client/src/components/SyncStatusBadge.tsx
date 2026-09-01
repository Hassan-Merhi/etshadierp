import { Cloud, CloudOff, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type SyncStatus = "synced" | "pending" | "local" | "failed" | "conflict";

interface SyncStatusBadgeProps {
  status: SyncStatus;
  className?: string;
}

const CONFIG: Record<SyncStatus, { label: string; icon: typeof Cloud; className: string }> = {
  synced: {
    label: "Synced",
    icon: CheckCircle2,
    className: "border-green-500/30 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  },
  pending: {
    label: "Pending sync",
    icon: Clock,
    className: "border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  local: {
    label: "Saved locally",
    icon: Cloud,
    className: "border-blue-500/30 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  },
  failed: {
    label: "Sync failed",
    icon: CloudOff,
    className: "border-red-500/30 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
  conflict: {
    label: "Conflict",
    icon: AlertCircle,
    className: "border-orange-500/30 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400",
  },
};

export function SyncStatusBadge({ status, className = "" }: SyncStatusBadgeProps) {
  const { label, icon: Icon, className: baseClass } = CONFIG[status];
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[11px] font-medium px-2 py-0.5 ${baseClass} ${className}`}
      data-testid={`sync-status-${status}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}
