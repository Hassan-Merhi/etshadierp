import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Users,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";

interface TransferWaSettings {
  groupChatId:    string;
  hasCredentials: boolean;
  waEnabled:      boolean;
}

interface GreenChat {
  id:   string;
  name: string;
  type: string;
}

export function TransferWhatsAppSection() {
  const { toast } = useToast();
  const [expanded,        setExpanded]        = useState(false);
  const [groupChatId,     setGroupChatId]     = useState("");
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [chatsLoading,    setChatsLoading]    = useState(false);
  const [chats,           setChats]           = useState<GreenChat[]>([]);

  const { data: settings, isLoading } = useQuery<TransferWaSettings>({
    queryKey: ["/api/git/transfer-wa-settings"],
    enabled: expanded,
  });

  useEffect(() => {
    if (settings) setGroupChatId(settings.groupChatId);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", "/api/git/transfer-wa-settings", { groupChatId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/git/transfer-wa-settings"] });
      toast({ title: "Stock Transfer WhatsApp settings saved." });
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function loadChats() {
    setChatsLoading(true);
    try {
      const res = await apiRequest("GET", "/api/whatsapp/chats");
      if (!res.ok) throw new Error("Failed to fetch chats");
      const data = (await res.json()) as GreenChat[];
      setChats(data.filter((c) => c.type === "group" || String(c.id).endsWith("@g.us")));
      setShowGroupPicker(true);
    } catch (e: any) {
      toast({ title: "Could not load chats", description: e.message, variant: "destructive" });
    } finally {
      setChatsLoading(false);
    }
  }

  const selectedChat = chats.find((c) => c.id === groupChatId);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 hover-elevate"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-toggle-transfer-wa"
      >
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="h-4 w-4 text-blue-500" />
          <div className="text-left">
            <p className="text-sm font-medium">Stock Transfers — WhatsApp</p>
            <p className="text-xs text-muted-foreground">
              Automatically send a transfer summary image to a WhatsApp group whenever a stock transfer is confirmed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {settings?.groupChatId ? (
            <Badge variant="secondary" className="text-xs">Configured</Badge>
          ) : (
            <Badge variant="outline" className="text-xs">Not set</Badge>
          )}
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-5">

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading settings…
            </div>
          ) : (
            <>
              {/* Credential check */}
              <div className="flex items-center gap-2 text-sm">
                {settings?.hasCredentials && settings?.waEnabled ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-muted-foreground">WhatsApp connected and enabled.</span>
                  </>
                ) : settings?.hasCredentials ? (
                  <>
                    <XCircle className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">
                      Credentials set but WhatsApp sending is disabled. Enable it in WhatsApp settings.
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-muted-foreground">
                      WhatsApp not configured. Set credentials in WhatsApp &amp; Notifications → Main Instance.
                    </span>
                  </>
                )}
              </div>

              <Separator />

              {/* Group selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Target Group
                </Label>
                <p className="text-xs text-muted-foreground">
                  Every confirmed stock transfer will send a summary image to this group automatically.
                  The image shows item names, quantities, and locations — no costs.
                </p>

                {groupChatId ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {selectedChat?.name ?? groupChatId}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => { setGroupChatId(""); setShowGroupPicker(false); }}
                      data-testid="button-clear-transfer-wa-group"
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No group selected.</p>
                )}

                {!showGroupPicker && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={loadChats}
                    disabled={chatsLoading || !settings?.hasCredentials}
                    data-testid="button-load-transfer-wa-chats"
                  >
                    {chatsLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Loading groups…</>
                    ) : (
                      <><Users className="h-3.5 w-3.5 mr-1.5" />Fetch WhatsApp Groups</>
                    )}
                  </Button>
                )}

                {showGroupPicker && chats.length > 0 && (
                  <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-1">
                    {chats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded text-xs hover-elevate ${
                          groupChatId === c.id ? "bg-primary/10 text-primary font-medium" : ""
                        }`}
                        onClick={() => { setGroupChatId(c.id); setShowGroupPicker(false); }}
                        data-testid={`option-transfer-wa-group-${c.id}`}
                      >
                        {c.name}
                        <span className="text-muted-foreground ml-2 font-mono">{c.id}</span>
                      </button>
                    ))}
                  </div>
                )}

                {showGroupPicker && chats.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No groups found. Make sure your WhatsApp instance is connected.
                  </p>
                )}
              </div>

              <Separator />

              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  data-testid="button-save-transfer-wa"
                >
                  {saveMutation.isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  )}
                  Save Settings
                </Button>
              </div>

              <div className="rounded-md bg-muted/40 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">What gets sent:</p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                  <li>A PNG image card with the transfer voucher number and date</li>
                  <li>From and To location names</li>
                  <li>Table of all items with quantity and unit of measure</li>
                  <li>No costs or pricing — quantities only</li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
