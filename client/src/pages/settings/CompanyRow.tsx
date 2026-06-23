import { useState } from "react";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Users } from "lucide-react";

interface GreenChat {
  id: string;
  name: string;
  type: string;
}

interface CompanyWaSetting {
  companyId: number;
  companyName: string;
  groupChatId: string;
}

interface CompanyRowProps {
  company: CompanyWaSetting;
  chats: GreenChat[];
  chatsLoading: boolean;
  hasCredentials: boolean;
  onLoadChats: () => void;
  onSave: (companyId: number, groupChatId: string) => void;
  isSaving: boolean;
}

export function CompanyRow({
  company,
  chats,
  chatsLoading,
  hasCredentials,
  onLoadChats,
  onSave,
  isSaving,
}: CompanyRowProps) {
  const [groupChatId, setGroupChatId] = useState(company.groupChatId);
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
          <Badge variant="outline" className="text-xs">
            Not set
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {groupChatId ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setGroupChatId("");
                setShowGroupPicker(false);
              }}
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
            onClick={() => {
              onLoadChats();
              setShowGroupPicker(true);
            }}
            disabled={chatsLoading || !hasCredentials}
            data-testid={`button-load-transfer-wa-chats-${company.companyId}`}
          >
            {chatsLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Loading groups…
              </>
            ) : (
              <>
                <Users className="h-3.5 w-3.5 mr-1.5" />
                {groupChatId ? "Change Group" : "Select Group"}
              </>
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
                onClick={() => {
                  setGroupChatId(c.id);
                  setShowGroupPicker(false);
                }}
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
