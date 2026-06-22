import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Calendar, Clock, CheckCircle2, Users, Send, Download, RefreshCw, Settings2, Loader2, Info, ChevronDown } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { NpSettings, WaRecipient } from "./ExportCenterTypes";
import { StatusBadge } from "./ExportStatusBadge";
import { fmtTime, scheduleLabel } from "./ExportCenterHelpers";
import { DAYS, HOURS } from "./ExportCenterConstants";

interface NetPositionTabProps {
  npSettings?: NpSettings;
  waGroups: WaRecipient[];
  npEff: {
    recipientId: number | null;
    frequency: string;
    sendHour: number;
    sendDayOfWeek: number;
  };
  setNpRecipientId: (id: number | null) => void;
  setNpFrequency: (f: string) => void;
  setNpSendHour: (h: number) => void;
  setNpSendDayOfWeek: (d: number) => void;
  npWaGroupName: string | null;
  npScheduleText: string;
  npDefaultEnd: string;
  npDefaultStart: string;
  downloadNpExcel: () => void;
}

export function NetPositionTab({
  npSettings,
  waGroups,
  npEff,
  setNpRecipientId,
  setNpFrequency,
  setNpSendHour,
  setNpSendDayOfWeek,
  npWaGroupName,
  npScheduleText,
  npDefaultEnd,
  npDefaultStart,
  downloadNpExcel,
}: NetPositionTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const npActive = !!(npSettings?.enabled && npSettings?.autoSend && npSettings?.recipientId);
  const npNeedsSetup = !!(npSettings?.enabled && (!npSettings?.recipientId || !npSettings?.autoSend));

  const npSendNow = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp/send-net-position", {}),
    onSuccess: () => toast({ title: "Sent Now", description: "The ZIP has been queued for WhatsApp delivery." }),
    onError: (e: any) => toast({ variant: "destructive", title: "Send failed", description: e.message }),
  });

  const npSaveSettings = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/whatsapp/np-settings", {
      recipientId: npEff.recipientId,
      frequency: npEff.frequency,
      sendHour: npEff.sendHour,
      sendDayOfWeek: npEff.sendDayOfWeek,
      enabled: npSettings?.enabled ?? false,
      autoSend: npSettings?.autoSend ?? false,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const npToggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PUT", "/api/whatsapp/np-settings", {
      ...npEff,
      enabled,
      autoSend: npSettings?.autoSend ?? false,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
  });

  const npToggleAutoSend = useMutation({
    mutationFn: (autoSend: boolean) => apiRequest("PUT", "/api/whatsapp/np-settings", {
      ...npEff,
      enabled: npSettings?.enabled ?? true,
      autoSend,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
  });

  return (
    <div className="space-y-4 mt-4">
      <Card data-testid="card-np-status">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">Net Position Export</p>
                <StatusBadge active={npActive} needsSetup={npNeedsSetup} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3 shrink-0" />
                  Range: Jan 1, {new Date().getFullYear()} → today
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  Schedule: {npScheduleText || "Not configured"}
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  Last sent: {fmtTime(npSettings?.lastSentAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3 w-3 shrink-0" />
                  WhatsApp group: {npWaGroupName ? npWaGroupName : <span className="text-amber-600">Not selected</span>}
                </span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-testid="button-np-actions">
                  Actions <ChevronDown className="h-4 w-4 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => npSendNow.mutate()} disabled={npSendNow.isPending} data-testid="menu-np-send-now">
                  <Send className="h-4 w-4 mr-2" />
                  {npSendNow.isPending ? "Sending…" : "Send Now"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadNpExcel} data-testid="menu-np-download">
                  <Download className="h-4 w-4 mr-2" /> Download Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => qc.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] })} data-testid="menu-np-refresh">
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh Status
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-md bg-muted/40 border px-3 py-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Date range: </span>
          Jan 1, {new Date().getFullYear()} → today ({npDefaultEnd}). Every send covers from the start of the current year up to the run date.
        </p>
      </div>

      <Card data-testid="card-np-settings">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Schedule Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> WhatsApp Group
            </Label>
            <p className="text-xs text-muted-foreground">A ZIP with one net position Excel per company will be sent to this group.</p>
            {waGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No active group recipients — add one in the Recipients section below.</p>
            ) : (
              <Select
                value={String(npEff.recipientId ?? "")}
                onValueChange={v => setNpRecipientId(v ? parseInt(v) : null)}
              >
                <SelectTrigger data-testid="select-np-group" className="w-full sm:w-80">
                  <SelectValue placeholder="Pick a group…" />
                </SelectTrigger>
                <SelectContent>
                  {waGroups.map(r => (
                    <SelectItem key={r.id} value={String(r.id)} data-testid={`option-np-group-${r.id}`}>
                      <div className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />{r.name}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" /> Send Schedule
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Frequency</Label>
                <Select value={npEff.frequency} onValueChange={v => setNpFrequency(v)}>
                  <SelectTrigger data-testid="select-np-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly (1st of month)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Send Time (EST)</Label>
                <Select value={String(npEff.sendHour)} onValueChange={v => setNpSendHour(parseInt(v))}>
                  <SelectTrigger data-testid="select-np-hour"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {npEff.frequency === "weekly" && (
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />Day of Week</Label>
                  <Select value={String(npEff.sendDayOfWeek)} onValueChange={v => setNpSendDayOfWeek(parseInt(v))}>
                    <SelectTrigger data-testid="select-np-day"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable</p>
                <p className="text-xs text-muted-foreground">Activate this export schedule</p>
              </div>
              <Switch data-testid="switch-np-enabled"
                checked={npSettings?.enabled ?? false}
                onCheckedChange={v => npToggleEnabled.mutate(v)}
                disabled={npToggleEnabled.isPending} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Send</p>
                <p className="text-xs text-muted-foreground">Run automatically on the configured schedule</p>
              </div>
              <Switch data-testid="switch-np-autosend"
                checked={npSettings?.autoSend ?? false}
                onCheckedChange={v => npToggleAutoSend.mutate(v)}
                disabled={!(npSettings?.enabled) || npToggleAutoSend.isPending} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => npSaveSettings.mutate()} disabled={npSaveSettings.isPending} data-testid="button-np-save">
              {npSaveSettings.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Settings"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            "Send Now" (via the Actions menu) immediately sends the ZIP ({npDefaultStart} → {npDefaultEnd}) to the selected WhatsApp group. The scheduler checks every hour and sends automatically when the time matches.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
