import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ShieldAlert, AlertTriangle, Loader2, ShieldCheck, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { BackupStatus } from "./ExportCenterTypes";
import { RunRow } from "./BackupRunRow";

export function BackupStatusCard({ status, onRefresh, isRefreshing }: {
  status: BackupStatus;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const { toast } = useToast();
  const [dismissing, setDismissing] = useState(false);

  const hasAnyRun = status.recentRuns.length > 0;
  const now = Date.now();
  const stuckRuns = status.recentRuns.filter(
    r => r.status === "running" && (now - new Date(r.startedAt).getTime()) > 5 * 60 * 1000
  );
  const hasRunning = status.recentRuns.some(r => r.status === "running");

  const dismissStuck = async () => {
    setDismissing(true);
    try {
      const data = (await (await apiRequest("POST", "/api/export/cleanup-stuck-runs")).json()) as any;
      toast({
        title: data.cleared > 0
          ? `Dismissed ${data.cleared} stalled run${data.cleared === 1 ? "" : "s"}`
          : "No stalled runs found",
        description: data.cleared > 0 ? "They are now marked as failed." : undefined,
      });
      onRefresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Dismiss failed", description: e.message });
    } finally {
      setDismissing(false);
    }
  };

  const headerIcon = stuckRuns.length > 0
    ? <AlertTriangle className="h-4 w-4 text-amber-500" />
    : hasRunning
      ? <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      : !hasAnyRun
        ? <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        : status.recentRuns[0]?.status === "success"
          ? <ShieldCheck className="h-4 w-4 text-green-600" />
          : status.recentRuns[0]?.status === "partial_failed"
            ? <AlertTriangle className="h-4 w-4 text-amber-500" />
            : status.recentRuns[0]?.status === "failed"
              ? <ShieldAlert className="h-4 w-4 text-destructive" />
              : <ShieldCheck className="h-4 w-4 text-muted-foreground" />;

  return (
    <Card data-testid="card-backup-status">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            {headerIcon}
            Backup Status
          </CardTitle>
          <div className="flex items-center gap-1">
            {stuckRuns.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={dismissStuck}
                disabled={dismissing}
                data-testid="button-dismiss-stuck-runs"
                className="text-xs h-8"
              >
                {dismissing
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  : <XCircle className="h-3 w-3 mr-1" />}
                Dismiss stalled
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={onRefresh}
              disabled={isRefreshing}
              data-testid="button-refresh-backup-status"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <CardDescription>
          {stuckRuns.length > 0
            ? `${stuckRuns.length} run${stuckRuns.length === 1 ? "" : "s"} appear stalled — click "Dismiss stalled" to clear`
            : hasRunning
              ? "A backup is currently in progress..."
              : hasAnyRun
                ? `Last ${status.recentRuns.length} run${status.recentRuns.length === 1 ? "" : "s"} — newest first`
                : "No backup runs recorded yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Configuration issues */}
        {status.issues.length > 0 && (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {status.issues.length === 1 ? "1 issue" : `${status.issues.length} issues`} blocking automatic send
            </p>
            <ul className="space-y-0.5">
              {status.issues.map((issue, i) => (
                <li key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">•</span>{issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Run history */}
        {hasAnyRun ? (
          <div className="space-y-2">
            {status.recentRuns.map(run => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No backup runs recorded yet. Trigger a manual send or wait for the scheduled run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
