import { useState } from "react";
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
  Building2,
} from "lucide-react";

interface CompanyWaSetting {
  companyId:   number;
  companyName: string;
  groupChatId: string;
}

interface TransferWaSettings {
  companies:      CompanyWaSetting[];
  hasCredentials: boolean;
  waEnabled:      boolean;
}

interface GreenChat {
  id:   string;
  name: string;
  type: string;
}

interface CompanyRowProps {
  company:        CompanyWaSetting;
  chats:          GreenChat[];
  chatsLoading:   boolean;
  hasCredentials: boolean;
  onLoadChats:    () => void;
  onSave:         (companyId: number, groupChatId: string) => void;
  isSaving:       boolean;
}

function CompanyRow({ company, chats, chatsLoading, hasCredentials, onLoadChats, onSave, isSaving }: CompanyRowProps) {
  const [groupChatId,     setGroupChatId]     = useState(company.groupChatId);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  const selectedChat = chats.find((c) => c.id === groupChatId);
  const isDirty = groupChatId !== company.groupChatId;

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">{company.companyName}</span>
        </div>
        {groupChatId ? (
          <Badge variant="secondary" className="font-mono text-xs max-w-[200px] truncate">
            {selectedChat?.name ?? groupChatId}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">Not set</Badge>
        )}
      </div>

      <div className="space-y-2">
        {groupChatId ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => { setGroupChatId(""); setShowGroupPicker(false); }}
              data-testid={`button-clear-transfer-wa-group-${company.companyId}`}
            >
              Clear group
            </Button>
          </div>
        ) : null}

        {!showGroupPicker && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { onLoadChats(); setShowGroupPicker(true); }}
            disabled={chatsLoading || !hasCredentials}
            data-testid={`button-load-transfer-wa-chats-${company.companyId}`}
          >
            {chatsLoading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Loading groups…</>
            ) : (
              <><Users className="h-3.5 w-3.5 mr-1.5" />{groupChatId ? "Change Group" : "Select Group"}</>
            )}
          </Button>
        )}

        {showGroupPicker && chats.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto rounded-md border p-1">
            {chats.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`w-full text-left px-3 py-2 rounded text-xs hover-elevate ${
                  groupChatId === c.id ? "bg-primary/10 text-primary font-medium" : ""
                }`}
                onClick={() => { setGroupChatId(c.id); setShowGroupPicker(false); }}
                data-testid={`option-transfer-wa-group-${company.companyId}-${c.id}`}
              >
                {c.name}
                <span className="text-muted-foreground ml-2 font-mono text-xs">{c.id}</span>
              </button>
            ))}
          </div>
        )}

        {showGroupPicker && chats.length === 0 && !chatsLoading && (
          <p className="text-xs text-muted-foreground">
            No groups found. Make sure your WhatsApp instance is connected.
          </p>
        )}
      </div>

      {(isDirty || groupChatId !== company.groupChatId) && (
        <Button
          size="sm"
          onClick={() => onSave(company.companyId, groupChatId)}
          disabled={isSaving}
          data-testid={`button-save-transfer-wa-${company.companyId}`}
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Save
        </Button>
      )}

      {!isDirty && groupChatId && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSave(company.companyId, groupChatId)}
          disabled={isSaving}
          data-testid={`button-save-transfer-wa-${company.companyId}`}
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Save
        </Button>
      )}
    </div>
  );
}

export function TransferWhatsAppSection() {
  const { toast } = useToast();
  const [expanded,      setExpanded]      = useState(false);
  const [chatsLoading,  setChatsLoading]  = useState(false);
  const [chats,         setChats]         = useState<GreenChat[]>([]);
  const [savingCompany, setSavingCompany] = useState<number | null>(null);

  const { data: settings, isLoading } = useQuery<TransferWaSettings>({
    queryKey: ["/api/git/transfer-wa-settings"],
    enabled: expanded,
  });

  async function loadChats() {
    if (chats.length > 0) return; // already loaded
    setChatsLoading(true);
    try {
      const res = await apiRequest("GET", "/api/whatsapp/chats");
      if (!res.ok) throw new Error("Failed to fetch chats");
      const data = (await res.json()) as GreenChat[];
      setChats(data.filter((c) => c.type === "group" || String(c.id).endsWith("@g.us")));
    } catch (e: any) {
      toast({ title: "Could not load chats", description: e.message, variant: "destructive" });
    } finally {
      setChatsLoading(false);
    }
  }

  async function saveCompany(companyId: number, groupChatId: string) {
    setSavingCompany(companyId);
    try {
      const res = await apiRequest("PATCH", `/api/git/transfer-wa-settings/${companyId}`, { groupChatId });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save" }));
        throw new Error(err.message);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/git/transfer-wa-settings"] });
      toast({ title: "Saved", description: `Transfer WA group updated for company.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingCompany(null);
    }
  }

  const configuredCount = settings?.companies.filter((c) => c.groupChatId).length ?? 0;
  const totalCount = settings?.companies.length ?? 0;

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
              Choose which WhatsApp group each company's transfers are sent to when confirmed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {settings ? (
            configuredCount > 0 ? (
              <Badge variant="secondary" className="text-xs">
                {configuredCount}/{totalCount} configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">Not set</Badge>
            )
          ) : null}
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
                      Credentials set but WhatsApp sending is disabled.
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

              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Group per Company
                </Label>
                <p className="text-xs text-muted-foreground">
                  When a transfer is confirmed, a summary image is sent to the group configured for that company.
                  The image shows item names, quantities, and locations — no costs.
                </p>
              </div>

              <div className="space-y-2">
                {(settings?.companies ?? []).map((company) => (
                  <CompanyRow
                    key={company.companyId}
                    company={company}
                    chats={chats}
                    chatsLoading={chatsLoading}
                    hasCredentials={settings?.hasCredentials ?? false}
                    onLoadChats={loadChats}
                    onSave={saveCompany}
                    isSaving={savingCompany === company.companyId}
                  />
                ))}
              </div>

              <Separator />

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
