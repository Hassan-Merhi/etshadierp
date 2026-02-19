import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, MessageCircle, Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useToast } from "@/hooks/use-toast";
import type { DirectMessage } from "@shared/schema";

interface ChatUser {
  id: string;
  username: string;
  active: boolean;
  unreadCount: number;
}

export default function Chat() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { toast } = useToast();

  const { data: chatUsers = [], isLoading: usersLoading } = useQuery<ChatUser[]>({
    queryKey: ["/api/chat/users"],
    refetchInterval: 5000,
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<DirectMessage[]>({
    queryKey: ["/api/chat/conversations", selectedUserId],
    queryFn: async () => {
      if (!selectedUserId) return [];
      const res = await fetch(`/api/chat/conversations/${selectedUserId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedUserId,
    refetchInterval: 3000,
  });

  const sendMutation = useMutation({
    mutationFn: async (data: { receiverId: string; message: string }) => {
      return await modeApiRequest("POST", "/api/chat/messages", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/users"] });
      setMessageText("");
      inputRef.current?.focus();
    },
    onError: (error: any) => {
      toast({
        title: "Message failed to send",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await modeApiRequest("POST", `/api/chat/mark-read/${userId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/users"] });
    },
  });

  useEffect(() => {
    if (selectedUserId) {
      markReadMutation.mutate(selectedUserId);
    }
  }, [selectedUserId, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!messageText.trim() || !selectedUserId) return;
    sendMutation.mutate({ receiverId: selectedUserId, message: messageText.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const selectedUser = chatUsers.find((u) => u.id === selectedUserId);

  const getInitials = (username: string) => {
    return username.slice(0, 2).toUpperCase();
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex gap-3" data-testid="chat-page">
      <Card className="w-64 shrink-0 flex flex-col">
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">Conversations</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {usersLoading ? (
            <div className="p-3 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : chatUsers.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No users available</div>
          ) : (
            chatUsers.map((user) => (
              <button
                key={user.id}
                className={`w-full flex items-center gap-3 p-3 text-left hover-elevate transition-colors ${selectedUserId === user.id ? "bg-accent" : ""}`}
                onClick={() => setSelectedUserId(user.id)}
                data-testid={`button-chat-user-${user.id}`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{getInitials(user.username)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium truncate">{user.username}</span>
                    {user.unreadCount > 0 && (
                      <Badge variant="default" className="text-xs min-w-5 justify-center">{user.unreadCount}</Badge>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </Card>

      <Card className="flex-1 flex flex-col">
        {!selectedUserId ? (
          <CardContent className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose a user from the list to start chatting</p>
            </div>
          </CardContent>
        ) : (
          <>
            <div className="p-3 border-b flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{selectedUser ? getInitials(selectedUser.username) : "?"}</AvatarFallback>
              </Avatar>
              <span className="font-semibold text-sm">{selectedUser?.username}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-3/4" />)}
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-8">
                  No messages yet. Say hello!
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.senderId !== selectedUserId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                      data-testid={`message-${msg.id}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-3 py-2 ${
                          isMine
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                        <div className={`flex items-center gap-1 mt-1 ${isMine ? "justify-end" : "justify-start"}`}>
                          <span className={`text-xs ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {formatTime(msg.createdAt as unknown as string)}
                          </span>
                          {isMine && (
                            msg.readAt
                              ? <CheckCheck className={`h-3 w-3 ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
                              : <Check className={`h-3 w-3 ${isMine ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  disabled={sendMutation.isPending}
                  data-testid="input-chat-message"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={!messageText.trim() || sendMutation.isPending}
                  data-testid="button-send-message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
