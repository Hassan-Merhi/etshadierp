import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient as useTQClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Radio, RefreshCw, Loader2, Clock, CheckCircle, XCircle, AlertTriangle,
  Minus, AlertCircle, Settings2, MapPin, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryContainer } from "@shared/schema";

interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);

const CONTAINER_STATUS_LABELS: Record<string, string> = {
  PENDING:            "Pending",
  IN_TRANSIT:         "In Transit",
  ARRIVED:            "Arrived",
  OFFLOADED:          "Offloaded",
  PARTIALLY_RECEIVED: "Partially Offloaded",
  RECEIVED:           "Received",
  AVAILABLE:          "Available",
  CLOSED:             "Closed",
  COMPLETED:          "Completed",
};

function getContainerStatusLabel(status: string): string {
  return CONTAINER_STATUS_LABELS[status] ?? status;
}

function ContainerStatusBadge({ status }: { status: string }) {
  const label = getContainerStatusLabel(status);
  if (status === "OFFLOADED") {
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{label}</Badge>;
  }
  if (status === "PARTIALLY_RECEIVED") {
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{label}</Badge>;
  }
  if (status === "IN_TRANSIT") {
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>;
  }
  if (status === "ARRIVED") {
    return <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{label}</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}

function trackingStatusBadge(
  status: string | null | undefined,
  opts?: { wasChecked?: boolean },
) {
  if (!status) {
    if (opts?.wasChecked) {
      return (
        <Badge variant="secondary" className="text-xs text-muted-foreground/70">
          No carrier data
        </Badge>
      );
    }
    return <Badge variant="secondary" className="text-xs">No data</Badge>;
  }
  const s = status.toLowerCase();
  if (s.includes("transit") || s.includes("depart") || s.includes("vessel") || s.includes("at sea")) {
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{status}</Badge>;
  }
  if (s.includes("discharg") || s.includes("arrival") || s.includes("arrived") || s.includes("port")) {
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{status}</Badge>;
  }
  if (s.includes("deliver") || s.includes("final") || s.includes("complete")) {
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{status}</Badge>;
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

interface ProgressStep {
  provider: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail?: string;
  ts: number;
}

function ProgressStepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skip") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}

interface TrackingEvent {
  id: number;
  eventTime: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  provider: string | null;
}

function EventTimelineSheet({
  containerId,
  containerNumber,
  open,
  onClose,
}: {
  containerId: number | null;
  containerNumber: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: events = [], isLoading } = useQuery<TrackingEvent[]>({
    queryKey: ["/api/factory/container-tracking", containerId, "events"],
    queryFn: async () => {
      if (!containerId) return [];
      const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/events`);
      return res.ok ? (res.json() as Promise<TrackingEvent[]>) : [];
    },
    enabled: open && !!containerId,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Event History
            <span className="font-mono text-muted-foreground font-normal text-sm">{containerNumber}</span>
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="h-4 w-4 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
                      <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Activity className="h-10 w-10 opacity-20" />
                <p className="text-sm">No tracking events yet.</p>
                <p className="text-xs">Click "Track Now" to fetch live data from the carrier.</p>
              </div>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-0">
                {events.map((ev, idx) => {
                  const dt = ev.eventTime ? new Date(ev.eventTime) : null;
                  return (
                    <li key={ev.id} className="ml-4 pb-6 last:pb-0">
                      <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full border bg-background ring-2 ring-background">
                        <span className={`h-1.5 w-1.5 rounded-full ${idx === 0 ? "bg-blue-500" : "bg-muted-foreground/40"}`} />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium leading-snug">{ev.description ?? ev.status ?? "—"}</p>
                        {ev.location && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {ev.location}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
                          {ev.provider && <span className="ml-2 opacity-60">via {ev.provider}</span>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function TrackingSettingsSheet({
  container,
  open,
  onClose,
}: {
  container: ContainerWithSupplier | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [enabled, setEnabled] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [carrierHint, setCarrierHint] = useState("");

  useEffect(() => {
    if (container) {
      const fc = container as any;
      setEnabled(fc.trackingEnabled !== false);
      setAutoUpdate(fc.trackingAutoUpdate !== false);
      setCarrierHint(fc.trackingCarrierHint ?? "");
    }
  }, [container]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!container) return;
      await factoryApiRequest("PATCH", `/api/factory/container-tracking/${container.id}/settings`, {
        trackingEnabled: enabled,
        trackingAutoUpdate: autoUpdate,
        trackingCarrierHint: carrierHint.trim() || null,
      });
    },
    onSuccess: () => {
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Tracking settings saved" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save settings", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-sm flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Tracking Settings
            {container && (
              <span className="font-mono text-muted-foreground font-normal text-sm">{container.containerNumber}</span>
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 px-6 py-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable Tracking</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow this container to be tracked via carrier APIs</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-tracking-enabled"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto Update</p>
              <p className="text-xs text-muted-foreground mt-0.5">Let the scheduler check this container automatically</p>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={setAutoUpdate}
              disabled={!enabled}
              data-testid="switch-auto-update"
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="carrier-hint-tab" className="text-sm font-medium">Carrier Hint</Label>
            <p className="text-xs text-muted-foreground">Optional — helps the system find the right carrier faster (e.g. MAERSK, CMA)</p>
            <Input
              id="carrier-hint-tab"
              value={carrierHint}
              onChange={(e) => setCarrierHint(e.target.value.toUpperCase())}
              placeholder="e.g. MAERSK"
              disabled={!enabled}
              data-testid="input-carrier-hint-tab"
            />
          </div>
        </div>
        <div className="px-6 pb-6 shrink-0">
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-tracking-settings-tab"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TrackNowProgressLog({ containerId }: { containerId: number }) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/progress`);
          const data: ProgressStep[] = res.ok ? await res.json() : [];
          if (!cancelled) setSteps(data ?? []);
        } catch {
          // ignore polling errors
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [containerId]);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Starting…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 max-w-xs">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <ProgressStepIcon status={s.status} />
          <span className="text-muted-foreground">{s.provider}</span>
          {s.detail && <span className="text-muted-foreground/60 truncate max-w-[120px]">{s.detail}</span>}
        </div>
      ))}
    </div>
  );
}

export default function FactoryOtwTrackingTab() {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [trackingNowId, setTrackingNowId] = useState<number | null>(null);
  const [timelineId, setTimelineId] = useState<number | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<ContainerWithSupplier | null>(null);

  const { data: containers, isLoading } = useQuery<ContainerWithSupplier[]>({
    queryKey: ["/api/factory/containers"],
  });

  const today = new Date().toDateString();
  const otwContainers = (containers || []).filter((c) => STATUS_ACTIVE.has(c.status));
  const checkedToday = otwContainers.filter((c) => {
    const fc = c as any;
    return fc.trackingLastCheckedAt && new Date(fc.trackingLastCheckedAt).toDateString() === today;
  }).length;
  const withErrors = otwContainers.filter((c) => !!(c as any).trackingError).length;
  const timelineContainer = otwContainers.find((c) => c.id === timelineId) ?? null;

  const trackNowMutation = useMutation({
    mutationFn: async (containerId: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/container-tracking/${containerId}/track-now`, {});
      return res.json();
    },
    onMutate: (id) => { setTrackingNowId(id); },
    onSuccess: (data) => {
      setTrackingNowId(null);
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({
        title: data.success ? "Tracking updated" : "Tracking failed",
        description: data.success
          ? `${data.containerNumber}: ${data.lastStatus ?? "Status fetched"}`
          : `${data.containerNumber}: ${data.error ?? "Unknown error"}`,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (err: any) => {
      setTrackingNowId(null);
      toast({
        title: "Tracking failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (otwContainers.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Radio className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground">No containers currently on the way.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">OTW Containers</p>
            <p className="text-2xl font-bold tabular-nums">{otwContainers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Checked Today</p>
            <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">{checkedToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">With Errors</p>
            <p className={`text-2xl font-bold tabular-nums ${withErrors > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {withErrors}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Main table ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 flex-wrap">
          <CardTitle className="text-base">OTW Container Tracking</CardTitle>
          <span className="text-sm text-muted-foreground">{otwContainers.length} container{otwContainers.length !== 1 ? "s" : ""}</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Container</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tracking Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otwContainers.map((c) => {
                  const fc = c as any;
                  const lastChecked: Date | null = fc.trackingLastCheckedAt ? new Date(fc.trackingLastCheckedAt) : null;
                  const isTracking = trackingNowId === c.id;
                  const hasError = !!fc.trackingError;
                  const isEnabled = fc.trackingEnabled !== false;
                  const isValidNum = /^[A-Z]{4}\d{7}$/.test((c.containerNumber || "").trim().toUpperCase());

                  return (
                    <TableRow
                      key={c.id}
                      data-testid={`row-otw-tab-container-${c.id}`}
                      className="cursor-pointer"
                      onClick={() => setTimelineId(c.id)}
                    >
                      <TableCell className="pl-4 font-mono text-sm font-medium">
                        <div className="flex flex-col gap-0.5">
                          <span>{c.containerNumber}</span>
                          {!isValidNum && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Invalid format
                            </span>
                          )}
                          {fc.trackingDetectedCarrier && (
                            <span className="text-xs text-muted-foreground">{fc.trackingDetectedCarrier}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(c as any).supplierName ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell>
                        <ContainerStatusBadge status={c.status ?? "PENDING"} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {isTracking ? (
                          <TrackNowProgressLog containerId={c.id} />
                        ) : hasError ? (
                          <div className="flex flex-col gap-0.5">
                            {trackingStatusBadge(fc.trackingLastStatus, { wasChecked: !!lastChecked })}
                            {(() => {
                              const err: string = fc.trackingError ?? "";
                              const isTimeout = err.toLowerCase().includes("timed out") || err.toLowerCase().includes("timeout");
                              return (
                                <span className={`text-xs flex items-center gap-1 ${isTimeout ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}>
                                  {isTimeout ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}
                                  {isTimeout ? "Carrier did not respond — try again later" : err.slice(0, 60) + (err.length > 60 ? "…" : "")}
                                </span>
                              );
                            })()}
                          </div>
                        ) : (
                          trackingStatusBadge(fc.trackingLastStatus, { wasChecked: !!lastChecked })
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                        {fc.trackingLastLocation ?? <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.arrivalDate ? (
                          <span className={`font-mono ${new Date(c.arrivalDate) < new Date() ? "text-amber-600 dark:text-amber-400" : ""}`}>
                            {c.arrivalDate}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {lastChecked ? (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lastChecked.toLocaleDateString()} {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSettingsContainer(c)}
                                data-testid={`button-otw-tab-settings-${c.id}`}
                              >
                                <Settings2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Tracking Settings</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isTracking || !isEnabled || !isValidNum}
                                onClick={() => trackNowMutation.mutate(c.id)}
                                data-testid={`button-otw-tab-track-now-${c.id}`}
                              >
                                {isTracking ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {!isEnabled ? "Tracking disabled" : !isValidNum ? "Invalid container number format" : "Track Now"}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EventTimelineSheet
        containerId={timelineId}
        containerNumber={timelineContainer?.containerNumber ?? ""}
        open={!!timelineId}
        onClose={() => setTimelineId(null)}
      />

      <TrackingSettingsSheet
        container={settingsContainer}
        open={!!settingsContainer}
        onClose={() => setSettingsContainer(null)}
      />
    </div>
  );
}
