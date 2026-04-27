import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MessageCircle,
  Search,
  Check,
  X,
  Loader2,
  Users,
  RefreshCw,
} from "lucide-react";

interface Location {
  id: number;
  name: string;
  whatsappGroupChatId?: string | null;
}

interface WaChat {
  id: string;
  name: string;
  type: string;
}

export function PosWhatsAppSection() {
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string>("");
  const [chatSearch, setChatSearch] = useState("");

  const { data: locations = [], isLoading: locLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: waChats = [], isLoading: chatsLoading, refetch: refetchChats } = useQuery<WaChat[]>({
    queryKey: ["/api/whatsapp/chats"],
    enabled: dialogOpen,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, name, whatsappGroupChatId }: { id: number; name: string; whatsappGroupChatId: string | null }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name, whatsappGroupChatId });
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({
        title: updated.whatsappGroupChatId ? "Group linked" : "Group removed",
        description: updated.whatsappGroupChatId
          ? `"${updated.name}" will now receive shift reports.`
          : `WhatsApp group removed from "${updated.name}".`,
      });
      setDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openDialog(loc: Location) {
    setEditingLocation(loc);
    setSelectedChatId(loc.whatsappGroupChatId ?? "");
    setChatSearch("");
    setDialogOpen(true);
  }

  function handleSave() {
    if (!editingLocation) return;
    saveMutation.mutate({
      id: editingLocation.id,
      name: editingLocation.name,
      whatsappGroupChatId: selectedChatId || null,
    });
  }

  const filteredChats = waChats
    .filter((c) => c.type === "group")
    .filter((c) => c.name.toLowerCase().includes(chatSearch.toLowerCase()));

  const configuredCount = locations.filter((l) => l.whatsappGroupChatId).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            <h2 className="text-2xl font-semibold">POS WhatsApp Groups</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Assign a WhatsApp group to each POS location. When a shift ends with low stock, a report will be sent to that group automatically.
          </p>
        </div>
        {configuredCount > 0 && (
          <Badge variant="secondary" data-testid="badge-configured-count">
            <Users className="h-3 w-3 mr-1" />
            {configuredCount} of {locations.length} configured
          </Badge>
        )}
      </div>

      {/* Location list */}
      {locLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading locations…
        </div>
      ) : locations.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">No POS locations found.</p>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => {
            const chatId = loc.whatsappGroupChatId;
            return (
              <div
                key={loc.id}
                className="flex items-center justify-between gap-4 rounded-md border bg-card px-4 py-3 flex-wrap"
                data-testid={`row-location-${loc.id}`}
              >
                {/* Location name + status */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${chatId ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm leading-tight" data-testid={`text-location-name-${loc.id}`}>
                      {loc.name}
                    </p>
                    {chatId ? (
                      <p className="text-xs text-muted-foreground font-mono truncate mt-0.5" data-testid={`text-chat-id-${loc.id}`}>
                        {chatId}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">No group configured</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {chatId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={saveMutation.isPending}
                      onClick={() =>
                        saveMutation.mutate({ id: loc.id, name: loc.name, whatsappGroupChatId: null })
                      }
                      data-testid={`button-remove-group-${loc.id}`}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openDialog(loc)}
                    data-testid={`button-set-group-${loc.id}`}
                  >
                    <MessageCircle className={`h-3.5 w-3.5 mr-1.5 ${chatId ? "text-green-600 dark:text-green-400" : ""}`} />
                    {chatId ? "Change Group" : "Set Group"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* WhatsApp group picker dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set WhatsApp Group</DialogTitle>
            <DialogDescription>
              Choose the group for <strong>{editingLocation?.name}</strong>. Stock reports will be sent here when a shift ends with low stock.
            </DialogDescription>
          </DialogHeader>

          {/* Search + refresh */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search groups…"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                className="pl-8"
                data-testid="input-chat-search"
              />
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => refetchChats()}
              disabled={chatsLoading}
              data-testid="button-refresh-chats"
              title="Refresh groups"
            >
              <RefreshCw className={`h-4 w-4 ${chatsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {/* Group list */}
          <div className="border rounded-md overflow-y-auto max-h-64">
            {chatsLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading groups…
              </div>
            ) : (
              <>
                {/* None option */}
                <button
                  className={`w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2 ${!selectedChatId ? "bg-muted font-medium" : ""}`}
                  onClick={() => setSelectedChatId("")}
                  data-testid="option-no-group"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                  No group (disabled)
                  {!selectedChatId && <Check className="h-4 w-4 ml-auto text-green-600 dark:text-green-400" />}
                </button>
                {filteredChats.length === 0 && (
                  <p className="text-center text-muted-foreground text-sm py-4">
                    {waChats.filter((c) => c.type === "group").length === 0
                      ? "No WhatsApp groups found. Make sure the WhatsApp instance is connected."
                      : "No groups match your search."}
                  </p>
                )}
                {filteredChats.map((chat) => (
                  <button
                    key={chat.id}
                    className={`w-full text-left px-3 py-2 text-sm hover-elevate flex items-center gap-2 ${selectedChatId === chat.id ? "bg-muted font-medium" : ""}`}
                    onClick={() => setSelectedChatId(chat.id)}
                    data-testid={`option-chat-${chat.id}`}
                  >
                    <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{chat.name}</span>
                    {selectedChatId === chat.id && <Check className="h-4 w-4 ml-auto shrink-0 text-green-600 dark:text-green-400" />}
                  </button>
                ))}
              </>
            )}
          </div>

          {selectedChatId && (
            <p className="text-xs text-muted-foreground">
              Selected ID: <code className="font-mono">{selectedChatId}</code>
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-wa-group">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-wa-group"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
