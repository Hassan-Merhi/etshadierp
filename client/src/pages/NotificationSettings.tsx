import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bell, Truck, FileText, ArrowLeftRight, CheckCircle2, X, Loader2, Plus, Shield,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NotifRule {
  id: number;
  eventType: string;
  recipientUserId: string;
  isEnabled: boolean;
}

interface UserItem {
  id: string;
  username: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  {
    id: "LOADING_STARTED",
    label: "Loading Started",
    description: "Triggered when a new loading order is created.",
    icon: Truck,
    group: "Loading",
  },
  {
    id: "LOADING_FINALIZED",
    label: "Loading Finalized",
    description: "Triggered when bales are submitted for verification.",
    icon: CheckCircle2,
    group: "Loading",
  },
  {
    id: "INVOICE_PENDING",
    label: "Invoice Pending Verification",
    description: "Triggered when a loading is submitted and awaiting verification.",
    icon: FileText,
    group: "Invoice",
  },
  {
    id: "INVOICE_FINALIZED",
    label: "Invoice Finalized",
    description: "Triggered when an invoice is approved and posted.",
    icon: CheckCircle2,
    group: "Invoice",
  },
  {
    id: "INTERCOMPANY_REQUEST",
    label: "Intercompany Payment Request",
    description: "Triggered when a new intercompany payment request is created.",
    icon: ArrowLeftRight,
    group: "Intercompany",
  },
] as const;

const GROUP_ICONS: Record<string, typeof Truck> = {
  Loading: Truck,
  Invoice: FileText,
  Intercompany: ArrowLeftRight,
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NotificationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Per-event "adding user" state
  const [pendingAdd, setPendingAdd] = useState<Record<string, string>>({});

  const { data: rules = [], isLoading: rulesLoading } = useQuery<NotifRule[]>({
    queryKey: ["/api/notification-rules"],
    queryFn: async () => {
      const r = await fetch("/api/notification-rules", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load rules");
      return r.json();
    },
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<UserItem[]>({
    queryKey: ["/api/notification-users"],
    queryFn: async () => {
      const r = await fetch("/api/notification-users", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load users");
      return r.json();
    },
  });

  // Build map: eventType → list of recipient user ids
  const ruleMap: Record<string, string[]> = {};
  for (const rule of rules) {
    if (!ruleMap[rule.eventType]) ruleMap[rule.eventType] = [];
    ruleMap[rule.eventType].push(rule.recipientUserId);
  }

  const saveMutation = useMutation({
    mutationFn: ({ eventType, recipientUserIds }: { eventType: string; recipientUserIds: string[] }) =>
      apiRequest("PUT", "/api/notification-rules", { eventType, recipientUserIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-rules"] });
      toast({ title: "Saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addRecipient = (eventType: string, userId: string) => {
    const current = ruleMap[eventType] ?? [];
    if (current.includes(userId)) return;
    saveMutation.mutate({ eventType, recipientUserIds: [...current, userId] });
    setPendingAdd(prev => ({ ...prev, [eventType]: "" }));
  };

  const removeRecipient = (eventType: string, userId: string) => {
    const current = ruleMap[eventType] ?? [];
    saveMutation.mutate({ eventType, recipientUserIds: current.filter(id => id !== userId) });
  };

  const getUserName = (uid: string) => allUsers.find(u => u.id === uid)?.username ?? uid;

  const groups = Array.from(new Set(EVENT_TYPES.map(e => e.group)));

  if (rulesLoading || usersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Notification Settings</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure which users receive notifications for each system event.
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
          <Shield className="h-3.5 w-3.5" />
          Visible to Admin, Owner, and Developer roles only.
        </div>
      </div>

      <Separator />

      {/* Groups */}
      {groups.map(group => {
        const GroupIcon = GROUP_ICONS[group] ?? Bell;
        const groupEvents = EVENT_TYPES.filter(e => e.group === group);
        return (
          <section key={group} className="space-y-3">
            <div className="flex items-center gap-2">
              <GroupIcon className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{group}</h2>
            </div>
            <div className="space-y-3">
              {groupEvents.map(event => {
                const EventIcon = event.icon;
                const recipients = ruleMap[event.id] ?? [];
                const unselected = allUsers.filter(u => !recipients.includes(u.id));
                const isSaving = saveMutation.isPending;

                return (
                  <Card key={event.id} data-testid={`card-event-${event.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start gap-2">
                        <EventIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div>
                          <CardTitle className="text-sm">{event.label}</CardTitle>
                          <CardDescription className="text-xs mt-0.5">{event.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Current recipients */}
                      {recipients.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No recipients — no one will be notified.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {recipients.map(uid => (
                            <Badge
                              key={uid}
                              variant="secondary"
                              className="gap-1.5 pr-1"
                              data-testid={`badge-recipient-${event.id}-${uid}`}
                            >
                              {getUserName(uid)}
                              <button
                                onClick={() => removeRecipient(event.id, uid)}
                                disabled={isSaving}
                                className="rounded-sm opacity-60 hover:opacity-100 transition-opacity"
                                data-testid={`button-remove-${event.id}-${uid}`}
                                title="Remove"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Add recipient */}
                      {unselected.length > 0 && (
                        <div className="flex gap-2">
                          <Select
                            value={pendingAdd[event.id] ?? ""}
                            onValueChange={v => setPendingAdd(prev => ({ ...prev, [event.id]: v }))}
                          >
                            <SelectTrigger
                              className="flex-1 text-xs"
                              data-testid={`select-add-recipient-${event.id}`}
                            >
                              <SelectValue placeholder="Add recipient…" />
                            </SelectTrigger>
                            <SelectContent>
                              {unselected.map(u => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.username}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={!pendingAdd[event.id] || isSaving}
                            onClick={() => {
                              const uid = pendingAdd[event.id];
                              if (uid) addRecipient(event.id, uid);
                            }}
                            data-testid={`button-add-recipient-${event.id}`}
                          >
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
