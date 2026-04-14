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
import {
  Package,
  Send,
  ChevronDown,
  ChevronRight,
  Loader2,
  Users,
} from "lucide-react";

interface Company { id: number; name: string; }
interface Recipient { id: number; chatId: string; name: string; isGroup: boolean; active: boolean; }
interface StockSettings {
  companyId:   number | null;
  recipientId: number | null;
  autoSend:    boolean;
  enabled:     boolean;
}

export function StockReportSection() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
    enabled: expanded,
  });

  const { data: recipients = [] } = useQuery<Recipient[]>({
    queryKey: ["/api/whatsapp/recipients"],
    enabled: expanded,
  });

  const { data: cfg } = useQuery<StockSettings>({
    queryKey: ["/api/whatsapp/stock-settings"],
    enabled: expanded,
  });

  const groups = recipients.filter((r) => r.isGroup && r.active);

  const [companyId,   setCompanyId]   = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState<number | null>(null);

  const resolvedCompanyId   = companyId   ?? cfg?.companyId   ?? null;
  const resolvedRecipientId = recipientId ?? cfg?.recipientId ?? null;

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<StockSettings>) =>
      apiRequest("PUT", "/api/whatsapp/stock-settings", {
        companyId:   resolvedCompanyId,
        recipientId: resolvedRecipientId,
        autoSend:    cfg?.autoSend ?? false,
        enabled:     cfg?.enabled  ?? false,
        ...patch,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/stock-settings"] });
      toast({ title: "Stock report settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendNow = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/whatsapp/send-stock-report", {
        companyId:   resolvedCompanyId,
        recipientId: resolvedRecipientId,
      }),
    onSuccess: async (res: any) => {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Reports sent", description: body.message || "Done" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const canSend = !!(resolvedCompanyId && resolvedRecipientId);

  return (
    <div className="border rounded-md">
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-stock-report-section-toggle"
      >
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-blue-600" />
          <div>
            <p className="font-semibold">Stock + Net Position Report</p>
            <p className="text-sm text-muted-foreground">
              Send stock-with-cost PDF &amp; net position Excel to one WhatsApp group
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cfg?.enabled && cfg?.autoSend && (
            <Badge variant="secondary" className="text-blue-700 bg-blue-100 dark:bg-blue-950 dark:text-blue-300">
              Auto-Send On
            </Badge>
          )}
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-5">

          {/* ── Company ──────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Company</Label>
            <p className="text-xs text-muted-foreground">Which company's stock and net position to report on</p>
            <Select
              value={String(resolvedCompanyId ?? "")}
              onValueChange={(v) => setCompanyId(v ? parseInt(v) : null)}
            >
              <SelectTrigger data-testid="select-stock-company" className="w-full sm:w-72">
                <SelectValue placeholder="Select a company…" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)} data-testid={`option-company-${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── WhatsApp Group ───────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">WhatsApp Group</Label>
            <p className="text-xs text-muted-foreground">
              Send the reports to this group. Only active groups you've already added appear here.
            </p>
            {groups.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No active WhatsApp groups found. Add a group recipient in the WhatsApp Export section above.
              </p>
            ) : (
              <Select
                value={String(resolvedRecipientId ?? "")}
                onValueChange={(v) => setRecipientId(v ? parseInt(v) : null)}
              >
                <SelectTrigger data-testid="select-stock-recipient" className="w-full sm:w-72">
                  <SelectValue placeholder="Select a group…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)} data-testid={`option-recipient-${r.id}`}>
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

          {/* ── Auto-send ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto-Send Daily at 6 PM EST</p>
              <p className="text-xs text-muted-foreground">
                Every day at 6 PM — sends stock PDF (current inventory) + net position Excel (Jan 1 → today)
              </p>
            </div>
            <Switch
              data-testid="switch-stock-auto-send"
              checked={cfg?.autoSend ?? false}
              disabled={!canSend || saveSettings.isPending}
              onCheckedChange={(v) => saveSettings.mutate({ autoSend: v, enabled: true })}
            />
          </div>

          <Separator />

          {/* ── Save + Send Now ───────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => saveSettings.mutate({})}
              disabled={!canSend || saveSettings.isPending}
              data-testid="button-stock-save"
            >
              {saveSettings.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Settings"}
            </Button>

            <Button
              onClick={() => sendNow.mutate()}
              disabled={!canSend || sendNow.isPending}
              data-testid="button-stock-send-now"
            >
              {sendNow.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                : <><Send className="h-4 w-4 mr-2" />Send Now</>}
            </Button>

            {!canSend && (
              <p className="text-xs text-muted-foreground">Select a company and group to send.</p>
            )}
          </div>

          {/* ── What's sent ───────────────────────────────────────── */}
          <div className="rounded-md bg-muted/40 p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">What gets sent:</p>
            <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
              <li>
                <span className="font-medium text-foreground">Stock PDF</span> — current inventory with cost
                (item code, name, group, location, qty, unit cost, total value)
              </li>
              <li>
                <span className="font-medium text-foreground">Net Position Excel</span> — from 01 Jan {new Date().getFullYear()} to today
              </li>
            </ul>
          </div>

        </div>
      )}
    </div>
  );
}
