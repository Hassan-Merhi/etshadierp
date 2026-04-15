import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Send, ChevronDown, ChevronRight, Loader2, Users, Clock, Calendar, CheckCircle2 } from "lucide-react";

interface Recipient  { id: number; chatId: string; name: string; isGroup: boolean; active: boolean; }

interface NpSettings {
  recipientId:   number | null;
  frequency:     string;
  sendHour:      number;
  sendDayOfWeek: number;
  enabled:       boolean;
  autoSend:      boolean;
  lastSentAt:    string | null;
}

const DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

function formatHour(h: number): string {
  if (h === 0)  return "12:00 AM";
  if (h < 12)   return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: formatHour(i) }));

function scheduleLabel(cfg: NpSettings | undefined): string {
  if (!cfg?.autoSend) return "";
  const time = formatHour(cfg.sendHour ?? 18);
  if (cfg.frequency === "daily")   return `Daily at ${time} EST`;
  if (cfg.frequency === "monthly") return `Monthly (1st) at ${time} EST`;
  if (cfg.frequency === "weekly") {
    const day = DAYS.find((d) => d.value === String(cfg.sendDayOfWeek))?.label ?? "Monday";
    return `Every ${day} at ${time} EST`;
  }
  return "Auto-Send On";
}

export function NetPositionExportSection() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/whatsapp/recipients"],
    enabled: expanded,
  });

  const { data: cfg } = useQuery<NpSettings>({
    queryKey: ["/api/whatsapp/np-settings"],
    enabled: expanded,
  });

  const groups = recipients.filter((r) => r.isGroup && r.active);

  const [recipientId,   setRecipientId]   = useState<number | null>(null);
  const [frequency,     setFrequency]     = useState("daily");
  const [sendHour,      setSendHour]      = useState(18);
  const [sendDayOfWeek, setSendDayOfWeek] = useState(1);

  const effective = {
    recipientId:   recipientId   ?? cfg?.recipientId   ?? null,
    frequency:     frequency     || cfg?.frequency     || "daily",
    sendHour:      sendHour      ?? cfg?.sendHour      ?? 18,
    sendDayOfWeek: sendDayOfWeek ?? cfg?.sendDayOfWeek ?? 1,
  };

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<NpSettings & { recipientId: number | null }>) =>
      apiRequest("PUT", "/api/whatsapp/np-settings", {
        recipientId:   effective.recipientId,
        frequency:     effective.frequency,
        sendHour:      effective.sendHour,
        sendDayOfWeek: effective.sendDayOfWeek,
        enabled:       cfg?.enabled  ?? false,
        autoSend:      cfg?.autoSend ?? false,
        ...patch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleEnabled = useMutation({
    mutationFn: (value: boolean) =>
      apiRequest("PUT", "/api/whatsapp/np-settings", {
        recipientId:   effective.recipientId,
        frequency:     effective.frequency,
        sendHour:      effective.sendHour,
        sendDayOfWeek: effective.sendDayOfWeek,
        enabled:       value,
        autoSend:      cfg?.autoSend ?? false,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleAutoSend = useMutation({
    mutationFn: (value: boolean) =>
      apiRequest("PUT", "/api/whatsapp/np-settings", {
        recipientId:   effective.recipientId,
        frequency:     effective.frequency,
        sendHour:      effective.sendHour,
        sendDayOfWeek: effective.sendDayOfWeek,
        enabled:       cfg?.enabled ?? false,
        autoSend:      value,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/np-settings"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendNow = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/whatsapp/send-np-all-now", {
        recipientId: effective.recipientId,
      }),
    onSuccess: async (res: any) => {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Net Position Export Sent", description: body.message || "Done" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const label = scheduleLabel(cfg);

  return (
    <div className="border rounded-md" data-testid="section-np-export">
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-np-export-toggle"
      >
        <div className="flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-blue-600" />
          <div>
            <p className="font-semibold">Net Position Export Schedule</p>
            <p className="text-sm text-muted-foreground">
              {label
                ? `Sends all-companies net position ZIP to a group + email — ${label}`
                : "Send all-companies net position ZIP to a WhatsApp group + email on a schedule"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cfg?.autoSend && cfg?.enabled && (
            <Badge variant="secondary" className="text-blue-700 bg-blue-100 dark:bg-blue-950 dark:text-blue-300">
              Active
            </Badge>
          )}
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-5">

          {/* ── Enable toggles ──────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable</p>
                <p className="text-xs text-muted-foreground">Allow this export schedule to run</p>
              </div>
              <Switch
                data-testid="switch-np-enabled"
                checked={cfg?.enabled ?? false}
                onCheckedChange={(v) => toggleEnabled.mutate(v)}
                disabled={toggleEnabled.isPending}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-Send</p>
                <p className="text-xs text-muted-foreground">
                  Automatically send on the configured schedule
                </p>
              </div>
              <Switch
                data-testid="switch-np-autosend"
                checked={cfg?.autoSend ?? false}
                onCheckedChange={(v) => toggleAutoSend.mutate(v)}
                disabled={!(cfg?.enabled) || toggleAutoSend.isPending}
              />
            </div>
          </div>

          <Separator />

          {/* ── WhatsApp group ──────────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              WhatsApp Group
            </Label>
            <p className="text-xs text-muted-foreground">
              The ZIP (net position Excel for every company) will be sent to this group.
              Add groups in the WhatsApp Export section above.
            </p>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No active group recipients — add one in the WhatsApp Export section.
              </p>
            ) : (
              <Select
                value={String(effective.recipientId ?? "")}
                onValueChange={(v) => setRecipientId(v ? parseInt(v) : null)}
              >
                <SelectTrigger data-testid="select-np-group" className="w-full sm:w-80">
                  <SelectValue placeholder="Pick a group…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)} data-testid={`option-np-group-${r.id}`}>
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5" />
                        {r.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Separator />

          {/* ── Schedule ────────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Schedule
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Frequency */}
              <div className="space-y-1">
                <Label className="text-xs">Frequency</Label>
                <Select
                  value={effective.frequency}
                  onValueChange={setFrequency}
                >
                  <SelectTrigger data-testid="select-np-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly (1st)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Send hour */}
              <div className="space-y-1">
                <Label className="text-xs">Send Time (EST)</Label>
                <Select
                  value={String(effective.sendHour)}
                  onValueChange={(v) => setSendHour(parseInt(v))}
                >
                  <SelectTrigger data-testid="select-np-hour">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Day of week (weekly only) */}
              {effective.frequency === "weekly" && (
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Day of Week
                  </Label>
                  <Select
                    value={String(effective.sendDayOfWeek)}
                    onValueChange={(v) => setSendDayOfWeek(parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-np-day">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          {/* Last sent */}
          {cfg?.lastSentAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-green-600" />
              Last sent: {new Date(cfg.lastSentAt).toLocaleString()}
            </div>
          )}

          <Separator />

          {/* ── Actions ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => saveSettings.mutate({})}
              disabled={saveSettings.isPending}
              data-testid="button-np-save"
            >
              {saveSettings.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : "Save Settings"}
            </Button>

            <Button
              variant="outline"
              onClick={() => sendNow.mutate()}
              disabled={sendNow.isPending}
              data-testid="button-np-send-now"
            >
              {sendNow.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                : <><Send className="h-4 w-4 mr-2" />Send Now</>}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            "Send Now" generates net position Excels for all companies (current year to date),
            bundles them in a ZIP, and sends to the selected WhatsApp group and all email recipients.
          </p>
        </div>
      )}
    </div>
  );
}
