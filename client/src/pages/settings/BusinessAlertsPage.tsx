import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle2,
  EyeOff,
  RefreshCw,
  BellRing,
} from "lucide-react";
import type { BusinessAlert } from "@shared/schema";

const SEVERITY_META: Record<
  string,
  {
    label: string;
    icon: React.ElementType;
    badgeClass: string;
    rowClass: string;
  }
> = {
  critical: {
    label: "Critical",
    icon: AlertCircle,
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-200 dark:border-red-800",
    rowClass: "border-l-2 border-l-red-500",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    rowClass: "border-l-2 border-l-amber-500",
  },
  info: {
    label: "Info",
    icon: Info,
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    rowClass: "border-l-2 border-l-blue-400",
  },
};

function SeverityBadge({ severity }: { severity: string }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META["info"];
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${m.badgeClass}`}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SummaryBar({ summary }: { summary: Record<string, number> }) {
  const total = (summary.critical ?? 0) + (summary.warning ?? 0) + (summary.info ?? 0);
  if (total === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" />
        No open alerts — all systems look good
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {summary.critical > 0 && (
        <span className="flex items-center gap-1 font-medium text-red-600 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5" />
          {summary.critical} critical
        </span>
      )}
      {summary.warning > 0 && (
        <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {summary.warning} warning{summary.warning !== 1 ? "s" : ""}
        </span>
      )}
      {summary.info > 0 && (
        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <Info className="h-3.5 w-3.5" />
          {summary.info} informational
        </span>
      )}
    </div>
  );
}

interface AlertCardProps {
  alert: BusinessAlert;
  isAdmin: boolean;
  onDismiss: (id: number) => void;
  onResolve: (id: number) => void;
  onReopen: (id: number) => void;
}

function AlertCard({ alert, isAdmin, onDismiss, onResolve, onReopen }: AlertCardProps) {
  const m = SEVERITY_META[alert.severity] ?? SEVERITY_META["info"];
  return (
    <div
      className={`rounded-md border bg-card p-3 space-y-1 ${m.rowClass}`}
      data-testid={`alert-card-${alert.id}`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={alert.severity} />
          <span className="text-sm font-medium">{alert.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {alert.status === "open" && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onResolve(alert.id)}
                title="Mark as resolved"
                data-testid={`button-resolve-${alert.id}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDismiss(alert.id)}
                title="Dismiss"
                data-testid={`button-dismiss-${alert.id}`}
              >
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </>
          )}
          {alert.status !== "open" && isAdmin && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onReopen(alert.id)}
              title="Reopen"
              data-testid={`button-reopen-${alert.id}`}
            >
              <RefreshCw className="h-3 w-3 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{alert.message}</p>
      <p className="text-xs text-muted-foreground/60">
        Raised {fmtDate(alert.createdAt)}
        {alert.status === "resolved" && alert.resolvedAt &&
          ` · Resolved ${fmtDate(alert.resolvedAt)}`}
        {alert.status === "dismissed" && " · Dismissed"}
      </p>
    </div>
  );
}

interface Props {
  currentUser?: { role?: string } | null;
}

export function BusinessAlertsPage({ currentUser }: Props) {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("open");
  const isAdmin = ["Admin", "Developer", "Owner"].includes(currentUser?.role ?? "");

  const alertsQuery = useQuery<BusinessAlert[]>({
    queryKey: ["/api/business-alerts", statusFilter],
    queryFn: () =>
      fetch(`/api/business-alerts?status=${statusFilter}`, { credentials: "include" })
        .then((r) => r.json()),
  });

  const summaryQuery = useQuery<Record<string, number>>({
    queryKey: ["/api/business-alerts/summary"],
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/business-alerts/${id}/dismiss`, {}),
    onSuccess: () => {
      toast({ title: "Alert dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts"] });
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/business-alerts/${id}/resolve`, {}),
    onSuccess: () => {
      toast({ title: "Alert resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts/summary"] });
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/business-alerts/${id}/reopen`, {}),
    onSuccess: () => {
      toast({ title: "Alert reopened" });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts/summary"] });
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runChecksMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/business-alerts/run-checks", {}),
    onSuccess: () => {
      toast({ title: "Checks completed", description: "Alert list updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-alerts/summary"] });
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const alerts = alertsQuery.data ?? [];
  const summary = summaryQuery.data ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Business Alerts</h2>
          <p className="text-sm text-muted-foreground">
            Automated checks for negative stock, large withdrawals, pending approvals, and import errors.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => runChecksMutation.mutate()}
            disabled={runChecksMutation.isPending}
            data-testid="button-run-alert-checks"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${runChecksMutation.isPending ? "animate-spin" : ""}`} />
            Run Checks
          </Button>
        )}
      </div>

      {!summaryQuery.isLoading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BellRing className="h-4 w-4" />
              Open alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SummaryBar summary={summary} />
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Show:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-alert-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {alertsQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : alerts.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No {statusFilter} alerts
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              isAdmin={isAdmin}
              onDismiss={(id) => dismissMutation.mutate(id)}
              onResolve={(id) => resolveMutation.mutate(id)}
              onReopen={(id) => reopenMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
